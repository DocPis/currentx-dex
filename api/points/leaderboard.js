import { kv } from "@vercel/kv";
import {
  buildPointsSummary,
  computeLeaderboardRewardsTable,
  getLeaderboardRewardsConfig,
  normalizeAddress,
  parsePointsSummaryRow,
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

const filterLeaderboardRows = (entries, excludedAddresses = new Set(), limit = 100) => {
  const rows = [];
  for (let i = 0; i < entries.length; i += 2) {
    const address = normalizeAddress(entries[i]);
    const score = Number(entries[i + 1] || 0);
    if (!address || excludedAddresses.has(address)) continue;
    rows.push({ address, score });
    if (rows.length >= limit) break;
  }
  return rows;
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
  excludedAddresses,
}) => {
  const { walletCount, totalPoints } = computeTotalsFromEntries(
    entries,
    excludedAddresses
  );
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
  const excludedAddresses = getExcludedAddresses();

  try {
    const topEntries = await kv.zrange(keys.leaderboard, 0, 999, {
      rev: true,
      withScores: true,
    });
    const addresses = filterLeaderboardRows(topEntries, excludedAddresses, 100);

    const needsFilteredTotals = excludedAddresses.size > 0;
    const allEntries =
      !needsFilteredTotals
        ? null
        : await kv.zrange(keys.leaderboard, 0, -1, { withScores: true });

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
        entries: allEntries || topEntries,
        keys,
        seasonId: targetSeason,
        rewardsConfig,
        sampleRow: userRows?.[0] || null,
        nowMs,
        excludedAddresses,
      });
    }

    const computedTotals = needsFilteredTotals
      ? computeTotalsFromEntries(allEntries || [], excludedAddresses)
      : null;
    const walletCount = computedTotals
      ? computedTotals.walletCount
      : toNumber(summary?.walletCount, 0);
    const totalPoints = computedTotals
      ? computedTotals.totalPoints
      : toNumber(summary?.totalPoints, 0);
    const summarySeasonRewardCrx = toNumber(summary?.seasonRewardCrx, NaN);
    const configuredSeasonRewardCrx = toNumber(rewardsConfig?.seasonRewardCrx, 0);
    const seasonRewardCrx =
      Number.isFinite(summarySeasonRewardCrx) && summarySeasonRewardCrx > 0
        ? summarySeasonRewardCrx
        : configuredSeasonRewardCrx;
    const rankedEntries = addresses.map(({ address, score }, idx) => {
      const row = userRows?.[idx] || {};
      return {
        address,
        points: Math.max(0, toNumber(row?.points, score)),
        rank: idx + 1,
      };
    });
    const userRowsByAddress = new Map(
      addresses.map(({ address }, idx) => [address, userRows?.[idx] || null])
    );
    const rewardsTable = computeLeaderboardRewardsTable({
      entries: rankedEntries,
      userRowsByAddress,
      seasonRewardCrx,
      config: rewardsConfig,
      nowMs,
      requireTop100Finalization: false,
    });

    const items = addresses.map(({ address, score }, idx) => {
      const row = userRows?.[idx] || {};
      const points = toNumber(row?.points, score);
      const multiplier = toNumber(row?.multiplier, 1);
      const lpUsd = toNumber(row?.lpUsd, 0);
      const rewardCrx = toNumber(rewardsTable?.rewardsByAddress?.get(address), 0);
      const rewardSharePct = seasonRewardCrx > 0
        ? round6((rewardCrx / seasonRewardCrx) * 100)
        : 0;
      return {
        address,
        points,
        multiplier,
        lpUsd,
        rank: idx + 1,
        rewardCrx,
        rewardSharePct,
      };
    });

    const updatedAt = await kv.get(keys.updatedAt);
    res.status(200).json({
      seasonId: targetSeason,
      updatedAt: updatedAt || null,
      leaderboard: items,
      summary: {
        ...(summary || {}),
        walletCount,
        seasonRewardCrx,
        totalPoints,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
