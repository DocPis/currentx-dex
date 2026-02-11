import { kv } from "@vercel/kv";
import {
  authorizeRequest,
  computeClaimPayout,
  getWhitelistKeys,
  getWhitelistRewardsConfig,
  normalizeAddress,
  parseStoredRewardRow,
  scanWhitelistWallets,
} from "../../src/server/whitelistRewardsLib.js";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

const toInt = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.floor(num);
};

const clamp = (value, min, max, fallback) => {
  const parsed = toInt(value, fallback);
  return Math.min(max, Math.max(min, parsed));
};

const toBool = (value) =>
  value === true ||
  value === 1 ||
  value === "1" ||
  value === "true" ||
  value === "TRUE";

const buildRow = ({ address, parsed, rank, config, nowMs }) => {
  const payoutPreview = computeClaimPayout(parsed, config, nowMs);
  return {
    address,
    rank,
    user: parsed,
    claimState: payoutPreview,
    claimPreview: {
      amountCrx: payoutPreview.claimTotalCrx,
      immediateCrx: payoutPreview.claimImmediateCrx,
      streamedCrx: payoutPreview.claimStreamedCrx,
    },
  };
};

export default async function handler(req, res) {
  const secret =
    process.env.WHITELIST_REWARDS_TOKEN || process.env.POINTS_INGEST_TOKEN || "";
  if (!authorizeRequest(req, secret)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const config = getWhitelistRewardsConfig(req.query?.seasonId);
  const keys = getWhitelistKeys(config.seasonId);
  const nowMs = Date.now();

  const address = normalizeAddress(req.query?.address || "");
  const onlyClaimable = toBool(req.query?.onlyClaimable);
  const cursor = clamp(req.query?.cursor, 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = clamp(req.query?.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);

  try {
    if (address) {
      const raw = await kv.hgetall(keys.user(address));
      const parsed = parseStoredRewardRow(raw);
      if (!parsed?.address) {
        res.status(404).json({
          error: "Wallet not found in whitelist rewards",
          seasonId: config.seasonId,
          address,
        });
        return;
      }
      const rankRaw = await kv.zrevrank(keys.leaderboard, address);
      const rank = Number.isFinite(Number(rankRaw)) ? Number(rankRaw) + 1 : null;
      const row = buildRow({ address, parsed, rank, config, nowMs });
      res.status(200).json({
        ok: true,
        seasonId: config.seasonId,
        nowMs,
        mode: "single",
        result: row,
      });
      return;
    }

    let members = await kv.zrange(keys.leaderboard, cursor, cursor + limit - 1, {
      rev: true,
    });
    let totalWallets = await kv.zcard(keys.leaderboard);

    if (!members?.length && cursor === 0) {
      members = await scanWhitelistWallets(kv);
      totalWallets = members.length;
    }

    const addresses = (Array.isArray(members) ? members : [])
      .map((wallet) => normalizeAddress(wallet))
      .filter(Boolean);

    if (!addresses.length) {
      res.status(200).json({
        ok: true,
        seasonId: config.seasonId,
        nowMs,
        mode: "batch",
        cursor,
        nextCursor: null,
        totalWallets: Number(totalWallets || 0),
        items: [],
      });
      return;
    }

    const readPipeline = kv.pipeline();
    addresses.forEach((wallet) => {
      readPipeline.hgetall(keys.user(wallet));
    });
    const rows = await readPipeline.exec();

    const items = addresses
      .map((wallet, idx) => {
        const parsed = parseStoredRewardRow(rows?.[idx]);
        if (!parsed?.address) return null;
        const rank = Number.isFinite(totalWallets)
          ? cursor + idx + 1
          : null;
        return buildRow({
          address: wallet,
          parsed,
          rank,
          config,
          nowMs,
        });
      })
      .filter(Boolean)
      .filter((row) =>
        onlyClaimable ? (row?.claimState?.claimTotalCrx || 0) > 0 : true
      );

    const nextCursor =
      cursor + addresses.length >= Number(totalWallets || 0)
        ? null
        : cursor + addresses.length;

    res.status(200).json({
      ok: true,
      seasonId: config.seasonId,
      nowMs,
      mode: "batch",
      cursor,
      nextCursor,
      limit,
      totalWallets: Number(totalWallets || 0),
      onlyClaimable,
      items,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}

