import { kv } from "@vercel/kv";
import {
  computeLpData,
  computePoints,
  fetchTokenPrices,
  getAddressConfig,
  getConcurrency,
  getKeys,
  getSeasonConfig,
  getSubgraphConfig,
  normalizeAddress,
  runWithConcurrency,
  toNumberSafe,
} from "../../src/server/pointsLib.js";

const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 1000;

const clampNumber = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
};

const authorizeRequest = (req, secret) => {
  if (!secret) return true;
  const authHeader = req.headers?.authorization || "";
  const token = req.query?.token || "";
  return (
    authHeader === `Bearer ${secret}` ||
    authHeader === secret ||
    token === secret
  );
};

export default async function handler(req, res) {
  const secret = process.env.POINTS_INGEST_TOKEN || "";
  if (!authorizeRequest(req, secret)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { seasonId } = getSeasonConfig();
  const targetSeason = req.query?.seasonId || seasonId;
  const { v3Url, v3Key } = getSubgraphConfig();
  if (!v3Url) {
    res.status(503).json({ error: "V3 subgraph not configured" });
    return;
  }

  const keys = getKeys(targetSeason);
  const addr = getAddressConfig();

  const cursor = clampNumber(req.query?.cursor, 0, Number.MAX_SAFE_INTEGER, 0);
  const limitParam = req.query?.limit;
  const limit =
    limitParam === undefined || limitParam === null || limitParam === ""
      ? null
      : clampNumber(limitParam, 1, MAX_LIMIT, DEFAULT_LIMIT);

  try {
    const allMembers = await kv.zrange(keys.leaderboard, 0, -1);
    if (!allMembers.length) {
      res.status(200).json({
        ok: true,
        seasonId: targetSeason,
        processed: 0,
        cursor,
        nextCursor: null,
        done: true,
      });
      return;
    }

    const seen = new Set();
    const normalized = [];
    allMembers.forEach((member) => {
      const wallet = normalizeAddress(member);
      if (!wallet || seen.has(wallet)) return;
      seen.add(wallet);
      normalized.push(wallet);
    });
    normalized.sort();
    const sliceLimit = limit ?? normalized.length;
    const wallets = normalized.slice(cursor, cursor + sliceLimit);
    if (!wallets.length) {
      res.status(200).json({
        ok: true,
        seasonId: targetSeason,
        processed: 0,
        cursor,
        nextCursor: null,
        done: true,
      });
      return;
    }

    const readPipeline = kv.pipeline();
    wallets.forEach((wallet) => {
      readPipeline.hgetall(keys.user(wallet));
    });
    const userRows = await readPipeline.exec();

    const priceMap = await fetchTokenPrices({
      url: v3Url,
      apiKey: v3Key,
      tokenIds: [addr.crx, addr.weth].filter(Boolean),
    });
    if (addr.usdm) priceMap[addr.usdm] = 1;
    if (addr.weth && !Number.isFinite(priceMap[addr.weth])) {
      priceMap[addr.weth] = 0;
    }

    const now = Date.now();
    const concurrency = getConcurrency?.() || 4;

    const computed = await runWithConcurrency(wallets, concurrency, async (wallet, idx) => {
      const row = userRows?.[idx] || {};
      const volumeUsd = toNumberSafe(row?.volumeUsd) ?? 0;

      const lpData = await computeLpData({
        url: v3Url,
        apiKey: v3Key,
        wallet,
        addr,
        priceMap,
      });

      const points = computePoints({
        volumeUsd,
        lpUsd: lpData.lpUsd,
        baseMultiplier: lpData.hasBoostLp ? lpData.baseMultiplier : 1,
        hasRangeData: lpData.hasRangeData,
        hasInRange: lpData.hasInRange,
      });

      return {
        wallet,
        volumeUsd,
        basePoints: points.basePoints,
        bonusPoints: points.bonusPoints,
        points: points.totalPoints,
        boostedVolumeUsd: points.boostedVolumeUsd,
        boostedVolumeCap: points.boostedVolumeCap,
        multiplier: points.effectiveMultiplier,
        baseMultiplier: lpData.hasBoostLp ? lpData.baseMultiplier : 1,
        lpUsd: lpData.lpUsd,
        lpInRangePct: lpData.lpInRangePct,
        hasBoostLp: lpData.hasBoostLp,
        hasRangeData: lpData.hasRangeData,
        hasInRange: lpData.hasInRange,
        lpAgeSeconds: lpData.lpAgeSeconds,
      };
    });

    const writePipeline = kv.pipeline();
    computed.forEach((entry) => {
      writePipeline.zadd(keys.leaderboard, {
        score: entry.points,
        member: entry.wallet,
      });
      writePipeline.hset(keys.user(entry.wallet), {
        address: entry.wallet,
        volumeUsd: entry.volumeUsd,
        points: entry.points,
        basePoints: entry.basePoints,
        bonusPoints: entry.bonusPoints,
        boostedVolumeUsd: entry.boostedVolumeUsd,
        boostedVolumeCap: entry.boostedVolumeCap,
        multiplier: entry.multiplier,
        baseMultiplier: entry.baseMultiplier,
        lpUsd: entry.lpUsd,
        lpInRangePct: entry.lpInRangePct,
        hasBoostLp: entry.hasBoostLp ? 1 : 0,
        hasRangeData: entry.hasRangeData ? 1 : 0,
        hasInRange: entry.hasInRange ? 1 : 0,
        lpAgeSeconds: entry.lpAgeSeconds ?? "",
        updatedAt: now,
      });
    });
    writePipeline.set(keys.updatedAt, now);
    await writePipeline.exec();

    const rankPipeline = kv.pipeline();
    computed.forEach((entry) => {
      rankPipeline.zrevrank(keys.leaderboard, entry.wallet);
    });
    const rankResults = await rankPipeline.exec();

    const rankWrite = kv.pipeline();
    computed.forEach((entry, idx) => {
      const rankValue = Number(rankResults?.[idx]);
      if (Number.isFinite(rankValue)) {
        rankWrite.hset(keys.user(entry.wallet), { rank: rankValue + 1 });
      }
    });
    await rankWrite.exec();

    const nextCursor =
      cursor + wallets.length >= normalized.length ? null : cursor + wallets.length;

    res.status(200).json({
      ok: true,
      seasonId: targetSeason,
      processed: wallets.length,
      cursor,
      nextCursor,
      done: nextCursor === null,
      totalWallets: normalized.length,
      updatedAt: now,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
