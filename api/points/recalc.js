import { kv } from "@vercel/kv";
import {
  buildPointsSummary,
  getLeaderboardRewardsConfig,
} from "../../src/server/leaderboardRewardsLib.js";
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

const getSecrets = () =>
  [process.env.POINTS_INGEST_TOKEN, process.env.CRON_SECRET]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

const authorizeRequest = (req, secrets) => {
  const list = Array.isArray(secrets) ? secrets : [secrets];
  const active = list.filter(Boolean);
  if (!active.length) return true;
  const authHeader = req.headers?.authorization || "";
  const token = req.query?.token || "";
  return active.some(
    (secret) =>
      authHeader === `Bearer ${secret}` ||
      authHeader === secret ||
      token === secret
  );
};

export default async function handler(req, res) {
  const secrets = getSecrets();
  if (!secrets.length) {
    res.status(503).json({
      error: "Missing required env: set POINTS_INGEST_TOKEN or CRON_SECRET",
    });
    return;
  }
  if (!authorizeRequest(req, secrets)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { seasonId, startBlock, startMs, missing: missingSeasonEnv } = getSeasonConfig();
  const targetSeason = req.query?.seasonId || seasonId;
  const { v3Url, v3Key } = getSubgraphConfig();
  if (!v3Url) {
    res.status(503).json({ error: "V3 subgraph not configured" });
    return;
  }
  if (!targetSeason || missingSeasonEnv?.length) {
    res.status(503).json({
      error: `Missing required env: ${missingSeasonEnv?.join(", ") || "POINTS_SEASON_ID"}`,
    });
    return;
  }

  const keys = getKeys(targetSeason);
  const addr = getAddressConfig();
  if (addr?.missing?.length) {
    res.status(503).json({
      error: `Missing required env: ${addr.missing.join(", ")}`,
    });
    return;
  }

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
    const seasonBoostActive = now >= startMs;
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
        startBlock,
      });

      const points = computePoints({
        volumeUsd,
        lpUsdTotal: lpData.lpUsd,
        lpUsdCrxEth: lpData.lpUsdCrxEth,
        lpUsdCrxUsdm: lpData.lpUsdCrxUsdm,
        boostEnabled: seasonBoostActive,
      });

      return {
        wallet,
        volumeUsd,
        rawVolumeUsd: points.rawVolumeUsd,
        effectiveVolumeUsd: points.effectiveVolumeUsd,
        scoringMode: points.scoringMode,
        feeBps: points.feeBps,
        volumeCapUsd: points.volumeCapUsd,
        diminishingFactor: points.diminishingFactor,
        basePoints: points.basePoints,
        bonusPoints: points.bonusPoints,
        points: points.totalPoints,
        boostedVolumeUsd: points.boostedVolumeUsd,
        boostedVolumeCap: points.boostedVolumeCap,
        multiplier: points.effectiveMultiplier,
        baseMultiplier: points.effectiveMultiplier,
        lpUsd: points.lpUsd,
        lpUsdCrxEth: points.lpUsdCrxEth,
        lpUsdCrxUsdm: points.lpUsdCrxUsdm,
        lpPoints: points.lpPoints,
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
        rawVolumeUsd: entry.rawVolumeUsd,
        effectiveVolumeUsd: entry.effectiveVolumeUsd,
        scoringMode: entry.scoringMode,
        scoringFeeBps: entry.feeBps,
        volumeCapUsd: entry.volumeCapUsd,
        diminishingFactor: entry.diminishingFactor,
        points: entry.points,
        basePoints: entry.basePoints,
        bonusPoints: entry.bonusPoints,
        boostedVolumeUsd: entry.boostedVolumeUsd,
        boostedVolumeCap: entry.boostedVolumeCap,
        multiplier: entry.multiplier,
        baseMultiplier: entry.baseMultiplier,
        lpUsd: entry.lpUsd,
        lpUsdCrxEth: entry.lpUsdCrxEth,
        lpUsdCrxUsdm: entry.lpUsdCrxUsdm,
        lpPoints: entry.lpPoints,
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

    const leaderboardEntries = await kv.zrange(keys.leaderboard, 0, -1, {
      withScores: true,
    });
    let walletCount = 0;
    let totalPoints = 0;
    for (let i = 0; i < leaderboardEntries.length; i += 2) {
      const score = Number(leaderboardEntries[i + 1] || 0);
      if (!Number.isFinite(score) || score <= 0) continue;
      walletCount += 1;
      totalPoints += score;
    }
    const rewardsConfig = getLeaderboardRewardsConfig(targetSeason);
    const scoringSample = computed[0] || {};
    const summary = buildPointsSummary({
      seasonId: targetSeason,
      walletCount,
      totalPoints,
      scoringMode: scoringSample.scoringMode || "",
      scoringFeeBps: scoringSample.feeBps || 0,
      volumeCapUsd: scoringSample.volumeCapUsd || 0,
      diminishingFactor: scoringSample.diminishingFactor || 0,
      config: rewardsConfig,
      nowMs: now,
    });
    await kv.hset(keys.summary, summary);
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
