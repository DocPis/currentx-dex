import { kv } from "@vercel/kv";
import {
  buildPointsSummary,
  computeLeaderboardReward,
  getLeaderboardClaimState,
  getLeaderboardRewardsConfig,
  normalizeAddress,
  parsePointsSummaryRow,
  parseRewardClaimRow,
} from "../../src/server/leaderboardRewardsLib.js";

const parseTime = (value) => {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const pickEnvValue = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
};

const getSeasonConfig = () => {
  const seasonId = pickEnvValue(
    process.env.POINTS_SEASON_ID,
    process.env.VITE_POINTS_SEASON_ID
  );
  const startMs =
    parseTime(process.env.POINTS_SEASON_START) ||
    parseTime(process.env.VITE_POINTS_SEASON_START);
  const endMs =
    parseTime(process.env.POINTS_SEASON_END) ||
    parseTime(process.env.VITE_POINTS_SEASON_END);
  const missing = [];
  if (!seasonId) missing.push("POINTS_SEASON_ID");
  if (!Number.isFinite(startMs)) missing.push("POINTS_SEASON_START");
  return {
    seasonId,
    startMs,
    endMs: Number.isFinite(endMs) ? endMs : null,
    missing,
  };
};

const getKeys = (seasonId, address) => {
  const base = `points:${seasonId}`;
  return {
    leaderboard: `${base}:leaderboard`,
    summary: `${base}:summary`,
    updatedAt: `${base}:updatedAt`,
    user: address ? `${base}:user:${address}` : null,
    rewardUser: address ? `${base}:reward:user:${address}` : null,
  };
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const buildSummaryFromLeaderboard = async ({
  keys,
  seasonId,
  rewardsConfig,
  sampleUserRow,
  nowMs,
}) => {
  const rows = await kv.zrange(keys.leaderboard, 0, -1, { withScores: true });
  let walletCount = 0;
  let totalPoints = 0;
  for (let i = 0; i < rows.length; i += 2) {
    const score = Number(rows[i + 1] || 0);
    if (!Number.isFinite(score) || score <= 0) continue;
    walletCount += 1;
    totalPoints += score;
  }
  const summary = buildPointsSummary({
    seasonId,
    walletCount,
    totalPoints,
    scoringMode: sampleUserRow?.scoringMode || "",
    scoringFeeBps: sampleUserRow?.scoringFeeBps || 0,
    volumeCapUsd: sampleUserRow?.volumeCapUsd || 0,
    diminishingFactor: sampleUserRow?.diminishingFactor || 0,
    config: rewardsConfig,
    nowMs,
  });
  await kv.hset(keys.summary, summary);
  return parsePointsSummaryRow(summary);
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { seasonId: seasonParam, address } = req.query || {};
  const { seasonId, missing: missingSeasonEnv } = getSeasonConfig();
  const targetSeason = seasonParam || seasonId;
  if (!targetSeason || missingSeasonEnv?.length) {
    res.status(503).json({
      error: `Missing required env: ${missingSeasonEnv?.join(", ") || "POINTS_SEASON_ID"}`,
    });
    return;
  }
  const normalized = normalizeAddress(address);
  if (!normalized) {
    res.status(400).json({ error: "Missing address" });
    return;
  }

  const keys = getKeys(targetSeason, normalized);
  const nowMs = Date.now();
  const rewardsConfig = getLeaderboardRewardsConfig(targetSeason);

  try {
    const [userRow, summaryRow, rewardRow] = await Promise.all([
      kv.hgetall(keys.user),
      kv.hgetall(keys.summary),
      kv.hgetall(keys.rewardUser),
    ]);

    if (!userRow) {
      res.status(200).json({
        seasonId: targetSeason,
        address: normalized,
        exists: false,
        user: null,
      });
      return;
    }

    let summary = parsePointsSummaryRow(summaryRow);
    if (!summary) {
      summary = await buildSummaryFromLeaderboard({
        keys,
        seasonId: targetSeason,
        rewardsConfig,
        sampleUserRow: userRow,
        nowMs,
      });
    }

    const userPoints = toNumber(userRow?.points, 0);
    const totalPoints = toNumber(summary?.totalPoints, 0);
    const seasonRewardCrx = toNumber(
      summary?.seasonRewardCrx,
      rewardsConfig.seasonRewardCrx
    );
    const rewardBreakdown = computeLeaderboardReward({
      userPoints,
      totalPoints,
      seasonRewardCrx,
    });

    const parsedRewardRow = parseRewardClaimRow(rewardRow);
    const rewardSnapshotCrx =
      parsedRewardRow?.totalRewardSnapshotCrx > 0
        ? parsedRewardRow.totalRewardSnapshotCrx
        : rewardBreakdown.rewardCrx;
    const claimState = getLeaderboardClaimState({
      totalRewardCrx: rewardSnapshotCrx,
      claimRow: parsedRewardRow,
      config: rewardsConfig,
      nowMs,
    });

    res.status(200).json({
      seasonId: targetSeason,
      address: normalized,
      exists: true,
      user: {
        ...userRow,
        seasonReward: {
          totalPointsSeason: totalPoints,
          seasonAllocationCrx: seasonRewardCrx,
          sharePct: rewardBreakdown.sharePct,
          rewardCrx: rewardBreakdown.rewardCrx,
          rewardSnapshotCrx,
          claimCount: parsedRewardRow?.claimCount || 0,
          lastClaimAt: parsedRewardRow?.lastClaimAt || null,
          ...claimState,
        },
      },
      summary: summary || null,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
