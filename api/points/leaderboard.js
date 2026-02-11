import { kv } from "@vercel/kv";
import {
  buildPointsSummary,
  computeLeaderboardReward,
  getLeaderboardRewardsConfig,
  normalizeAddress,
  parsePointsSummaryRow,
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

const getKeys = (seasonId) => {
  const base = `points:${seasonId}`;
  return {
    leaderboard: `${base}:leaderboard`,
    summary: `${base}:summary`,
    updatedAt: `${base}:updatedAt`,
    user: (address) => `${base}:user:${address}`,
  };
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const buildSummaryFromEntries = async ({
  entries,
  keys,
  seasonId,
  rewardsConfig,
  sampleRow,
  nowMs,
}) => {
  let walletCount = 0;
  let totalPoints = 0;
  for (let i = 0; i < entries.length; i += 2) {
    const score = Number(entries[i + 1] || 0);
    if (!Number.isFinite(score) || score <= 0) continue;
    walletCount += 1;
    totalPoints += score;
  }
  const summary = buildPointsSummary({
    seasonId,
    walletCount,
    totalPoints,
    scoringMode: sampleRow?.scoringMode || "",
    scoringFeeBps: sampleRow?.scoringFeeBps || 0,
    volumeCapUsd: sampleRow?.volumeCapUsd || 0,
    diminishingFactor: sampleRow?.diminishingFactor || 0,
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

  const { seasonId: seasonParam } = req.query || {};
  const { seasonId, missing: missingSeasonEnv } = getSeasonConfig();
  const targetSeason = seasonParam || seasonId;
  if (!targetSeason || missingSeasonEnv?.length) {
    res.status(503).json({
      error: `Missing required env: ${missingSeasonEnv?.join(", ") || "POINTS_SEASON_ID"}`,
    });
    return;
  }

  const keys = getKeys(targetSeason);
  const rewardsConfig = getLeaderboardRewardsConfig(targetSeason);
  const nowMs = Date.now();

  try {
    const entries = await kv.zrange(keys.leaderboard, 0, 99, {
      rev: true,
      withScores: true,
    });

    const addresses = [];
    for (let i = 0; i < entries.length; i += 2) {
      const address = normalizeAddress(entries[i]);
      const score = Number(entries[i + 1] || 0);
      if (!address) continue;
      addresses.push({ address, score });
    }

    const userRows = addresses.length
      ? await (() => {
          const pipeline = kv.pipeline();
          addresses.forEach(({ address }) => pipeline.hgetall(keys.user(address)));
          return pipeline.exec();
        })()
      : [];

    let summary = parsePointsSummaryRow(await kv.hgetall(keys.summary));
    if (!summary) {
      summary = await buildSummaryFromEntries({
        entries,
        keys,
        seasonId: targetSeason,
        rewardsConfig,
        sampleRow: userRows?.[0] || null,
        nowMs,
      });
    }

    const totalPoints = toNumber(summary?.totalPoints, 0);
    const seasonRewardCrx = toNumber(
      summary?.seasonRewardCrx,
      rewardsConfig.seasonRewardCrx
    );

    const items = addresses.map(({ address, score }, idx) => {
      const row = userRows?.[idx] || {};
      const points = toNumber(row?.points, score);
      const multiplier = toNumber(row?.multiplier, 1);
      const lpUsd = toNumber(row?.lpUsd, 0);
      const rank = toNumber(row?.rank, idx + 1);
      const reward = computeLeaderboardReward({
        userPoints: points,
        totalPoints,
        seasonRewardCrx,
      });
      return {
        address,
        points,
        multiplier,
        lpUsd,
        rank: Number.isFinite(rank) && rank > 0 ? rank : idx + 1,
        rewardCrx: reward.rewardCrx,
        rewardSharePct: reward.sharePct,
      };
    });

    const updatedAt = await kv.get(keys.updatedAt);
    res.status(200).json({
      seasonId: targetSeason,
      updatedAt: updatedAt || null,
      leaderboard: items,
      summary: {
        ...(summary || {}),
        seasonRewardCrx,
        totalPoints,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
