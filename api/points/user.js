import { kv } from "@vercel/kv";
import {
  buildPointsSummary,
  computeLeaderboardRewardsTable,
  getLeaderboardClaimState,
  getLeaderboardRewardsConfig,
  normalizeAddress,
  parsePointsSummaryRow,
  parseRewardClaimRow,
  round6,
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

const parseAddressList = (...values) =>
  values
    .flatMap((value) => String(value || "").split(/[\s,;]+/))
    .map((value) => String(value || "").trim())
    .map((value) => value.replace(/^['"()[\]]+|['"()[\]]+$/g, ""))
    .map((value) => {
      const match = value.match(/0x[a-fA-F0-9]{40}/);
      return match ? match[0] : value;
    })
    .map((value) => normalizeAddress(value))
    .filter((value) => /^0x[a-f0-9]{40}$/.test(value))
    .filter(Boolean);

const getExcludedAddresses = () =>
  new Set(
    parseAddressList(
      process.env.POINTS_LEADERBOARD_EXCLUDED_ADDRESSES,
      process.env.POINTS_LEADERBOARD_EXCLUDED_ADDRESS,
      process.env.POINTS_EXCLUDED_ADDRESSES,
      process.env.POINTS_EXCLUDED_ADDRESS,
      process.env.VITE_POINTS_EXCLUDED_ADDRESSES
    )
  );

const computeTotalsFromEntries = (entries, excludedAddresses = new Set()) => {
  let walletCount = 0;
  let totalPoints = 0;
  for (let i = 0; i < entries.length; i += 2) {
    const address = normalizeAddress(entries[i]);
    const score = Number(entries[i + 1] || 0);
    if (!address || excludedAddresses.has(address)) continue;
    if (!Number.isFinite(score) || score <= 0) continue;
    walletCount += 1;
    totalPoints += score;
  }
  return { walletCount, totalPoints };
};

const findFilteredRank = (entries, targetAddress, excludedAddresses = new Set()) => {
  if (!targetAddress) return null;
  let rank = 0;
  for (let i = 0; i < entries.length; i += 2) {
    const address = normalizeAddress(entries[i]);
    const score = Number(entries[i + 1] || 0);
    if (!address || excludedAddresses.has(address)) continue;
    if (!Number.isFinite(score) || score <= 0) continue;
    rank += 1;
    if (address === targetAddress) return rank;
  }
  return null;
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
    userByAddress: (wallet) => `${base}:user:${normalizeAddress(wallet)}`,
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
  rows,
  excludedAddresses,
}) => {
  const entries = rows || (await kv.zrange(keys.leaderboard, 0, -1, { withScores: true }));
  const { walletCount, totalPoints } = computeTotalsFromEntries(entries, excludedAddresses);
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
  const excludedAddresses = getExcludedAddresses();
  const excludedFromLeaderboard = excludedAddresses.has(normalized);

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

    const leaderboardEntries = await kv.zrange(keys.leaderboard, 0, -1, {
      rev: true,
      withScores: true,
    });
    const filteredTotals = computeTotalsFromEntries(leaderboardEntries, excludedAddresses);
    const filteredRank = excludedFromLeaderboard
      ? null
      : findFilteredRank(leaderboardEntries, normalized, excludedAddresses);

    let summary = parsePointsSummaryRow(summaryRow);
    if (!summary) {
      summary = await buildSummaryFromLeaderboard({
        keys,
        seasonId: targetSeason,
        rewardsConfig,
        sampleUserRow: userRow,
        nowMs,
        rows: leaderboardEntries,
        excludedAddresses,
      });
    }

    const walletCount = filteredTotals.walletCount;
    const totalPoints = filteredTotals.totalPoints;
    const summarySeasonRewardCrx = toNumber(summary?.seasonRewardCrx, NaN);
    const configuredSeasonRewardCrx = toNumber(rewardsConfig?.seasonRewardCrx, 0);
    const seasonRewardCrx =
      Number.isFinite(summarySeasonRewardCrx) && summarySeasonRewardCrx > 0
        ? summarySeasonRewardCrx
        : configuredSeasonRewardCrx;
    const rankedEntries = [];
    for (let i = 0; i < leaderboardEntries.length; i += 2) {
      const address = normalizeAddress(leaderboardEntries[i]);
      const points = Number(leaderboardEntries[i + 1] || 0);
      if (!address || excludedAddresses.has(address)) continue;
      if (!Number.isFinite(points) || points <= 0) continue;
      rankedEntries.push({
        address,
        points,
        rank: rankedEntries.length + 1,
      });
    }
    const top100Addresses = rankedEntries.slice(0, 100).map((entry) => entry.address);
    const top100Rows = top100Addresses.length
      ? await (() => {
          const pipeline = kv.pipeline();
          top100Addresses.forEach((address) =>
            pipeline.hgetall(keys.userByAddress(address))
          );
          return pipeline.exec();
        })()
      : [];
    const userRowsByAddress = new Map(
      top100Addresses.map((address, idx) => [address, top100Rows?.[idx] || null])
    );
    const rewardsTable = computeLeaderboardRewardsTable({
      entries: rankedEntries,
      userRowsByAddress,
      seasonRewardCrx,
      config: rewardsConfig,
      nowMs,
      requireTop100Finalization: false,
    });
    const rewardCrx = excludedFromLeaderboard
      ? 0
      : toNumber(rewardsTable?.rewardsByAddress?.get(normalized), 0);
    const sharePct = seasonRewardCrx > 0 ? round6((rewardCrx / seasonRewardCrx) * 100) : 0;
    const rewardBreakdown = {
      rewardCrx,
      sharePct,
    };

    const parsedRewardRow = parseRewardClaimRow(rewardRow);
    const rewardSnapshotCrx =
      excludedFromLeaderboard
        ? 0
        : parsedRewardRow?.totalRewardSnapshotCrx > 0
        ? parsedRewardRow.totalRewardSnapshotCrx
        : rewardBreakdown.rewardCrx;
    const claimState = getLeaderboardClaimState({
      totalRewardCrx: rewardSnapshotCrx,
      claimRow: excludedFromLeaderboard ? null : parsedRewardRow,
      config: rewardsConfig,
      nowMs,
    });
    const rankValue = excludedFromLeaderboard
      ? ""
      : Number.isFinite(filteredRank) && filteredRank > 0
        ? filteredRank
        : userRow?.rank;

    res.status(200).json({
      seasonId: targetSeason,
      address: normalized,
      exists: true,
      user: {
        ...userRow,
        rank: rankValue,
        excludedFromLeaderboard,
        seasonReward: {
          totalPointsSeason: totalPoints,
          seasonAllocationCrx: seasonRewardCrx,
          sharePct: rewardBreakdown.sharePct,
          rewardCrx: rewardBreakdown.rewardCrx,
          rewardSnapshotCrx,
          claimCount: excludedFromLeaderboard ? 0 : parsedRewardRow?.claimCount || 0,
          lastClaimAt: excludedFromLeaderboard ? null : parsedRewardRow?.lastClaimAt || null,
          ...claimState,
        },
      },
      summary: summary
        ? {
            ...summary,
            walletCount,
            totalPoints,
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
