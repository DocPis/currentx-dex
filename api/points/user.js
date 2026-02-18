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
import { maybeTriggerPointsSelfHeal } from "../../src/server/pointsSelfHeal.js";
import {
  CRX_ADDRESS as CANONICAL_CRX_ADDRESS,
  USDM_ADDRESS as CANONICAL_USDM_ADDRESS,
  WETH_ADDRESS as CANONICAL_WETH_ADDRESS,
} from "../../src/shared/config/addresses.js";
import {
  computeLpData,
  computePoints,
  fetchTokenPrices,
  getAddressConfig,
  getSeasonConfig as getPointsSeasonRuntimeConfig,
  getSubgraphConfig,
} from "../../src/server/pointsLib.js";

const SCAN_BATCH_SIZE = 1000;
const MAX_SCAN_ROUNDS = 2000;
const USER_LP_REFRESH_COOLDOWN_MS = 15 * 60 * 1000;
const USER_LP_REFRESH_TIMEOUT_MS = 20_000;

const pickEnvValue = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
};
const parseTime = (value) => {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
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
  const seasonStartMs =
    parseTime(process.env.POINTS_SEASON_START) ||
    parseTime(process.env.VITE_POINTS_SEASON_START);
  const seasonEndMs =
    parseTime(process.env.POINTS_SEASON_END) ||
    parseTime(process.env.VITE_POINTS_SEASON_END);
  const missing = [];
  if (!seasonId) missing.push("POINTS_SEASON_ID");
  return {
    seasonId,
    seasonStartMs: Number.isFinite(seasonStartMs) ? seasonStartMs : null,
    seasonEndMs: Number.isFinite(seasonEndMs) ? seasonEndMs : null,
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

const normalizeScanResult = (result) => {
  if (Array.isArray(result)) {
    const [cursor, keys] = result;
    return {
      cursor: String(cursor ?? "0"),
      keys: Array.isArray(keys) ? keys : [],
    };
  }
  if (result && typeof result === "object") {
    const cursor = result.cursor ?? result.nextCursor ?? result[0] ?? "0";
    const keys = result.keys ?? result.result ?? result[1] ?? [];
    return {
      cursor: String(cursor ?? "0"),
      keys: Array.isArray(keys) ? keys : [],
    };
  }
  return { cursor: "0", keys: [] };
};

const scanKeysByPattern = async (pattern) => {
  if (typeof kv.scan !== "function") {
    if (typeof kv.keys === "function") {
      const raw = await kv.keys(pattern);
      return Array.isArray(raw) ? raw : [];
    }
    return [];
  }

  let cursor = "0";
  const seen = new Set();
  const keys = [];
  for (let i = 0; i < MAX_SCAN_ROUNDS; i += 1) {
    const raw = await kv.scan(cursor, {
      match: pattern,
      count: SCAN_BATCH_SIZE,
    });
    const parsed = normalizeScanResult(raw);
    (parsed.keys || []).forEach((key) => {
      if (typeof key !== "string" || seen.has(key)) return;
      seen.add(key);
      keys.push(key);
    });
    if (parsed.cursor === "0" || parsed.cursor === cursor) break;
    cursor = parsed.cursor;
  }
  return keys;
};

const extractSeasonIdFromUpdatedAtKey = (key) => {
  const match = String(key || "").match(/^points:([^:]+):updatedAt$/);
  return match ? String(match[1] || "").trim() : "";
};

const extractSeasonIdFromLeaderboardKey = (key) => {
  const match = String(key || "").match(/^points:([^:]+):leaderboard$/);
  return match ? String(match[1] || "").trim() : "";
};

const discoverSeasonIdFromKv = async () => {
  const updatedAtKeys = await scanKeysByPattern("points:*:updatedAt");
  const seasonIds = Array.from(
    new Set(updatedAtKeys.map((key) => extractSeasonIdFromUpdatedAtKey(key)).filter(Boolean))
  );

  if (seasonIds.length) {
    const pipeline = kv.pipeline();
    seasonIds.forEach((id) => pipeline.get(`points:${id}:updatedAt`));
    const values = await pipeline.exec();
    let bestSeason = "";
    let bestUpdatedAt = -1;
    for (let i = 0; i < seasonIds.length; i += 1) {
      const updatedAt = Number(values?.[i] ?? 0);
      if (!Number.isFinite(updatedAt) || updatedAt <= bestUpdatedAt) continue;
      bestUpdatedAt = updatedAt;
      bestSeason = seasonIds[i];
    }
    return bestSeason || seasonIds[0];
  }

  const leaderboardKeys = await scanKeysByPattern("points:*:leaderboard");
  const fallback = leaderboardKeys
    .map((key) => extractSeasonIdFromLeaderboardKey(key))
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
  return fallback[0] || "";
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

const withTimeout = async (promise, timeoutMs, message) => {
  const safeTimeout = Math.max(1000, Math.floor(Number(timeoutMs) || 0));
  let timeoutId = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), safeTimeout);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const maybeRefreshMissingLpForUser = async ({
  address,
  userRow,
  keys,
  nowMs,
}) => {
  if (!userRow || !address) return userRow;

  const currentLpUsd = toNumber(userRow?.lpUsd, 0);
  const currentLpEth = toNumber(userRow?.lpUsdCrxEth, 0);
  const currentLpUsdm = toNumber(userRow?.lpUsdCrxUsdm, 0);
  if (currentLpUsd > 0 || currentLpEth > 0 || currentLpUsdm > 0) {
    return userRow;
  }

  const lastRefreshAt = toNumber(userRow?.lpRefreshAt, 0);
  if (
    Number.isFinite(lastRefreshAt) &&
    lastRefreshAt > 0 &&
    nowMs - lastRefreshAt < USER_LP_REFRESH_COOLDOWN_MS
  ) {
    return userRow;
  }

  const addr = getAddressConfig();
  const { startMs, startBlock } = getPointsSeasonRuntimeConfig();
  const { v3Url, v3Key } = getSubgraphConfig();
  if (!v3Url || addr?.missing?.length) {
    await kv.hset(keys.user, { lpRefreshAt: nowMs });
    return {
      ...userRow,
      lpRefreshAt: nowMs,
    };
  }

  let priceMap = {};
  const anchorTokenIds = Array.from(
    new Set(
      [addr.crx, addr.weth, CANONICAL_CRX_ADDRESS, CANONICAL_WETH_ADDRESS]
        .map((token) => normalizeAddress(token))
        .filter(Boolean)
    )
  );
  try {
    priceMap = await fetchTokenPrices({
      url: v3Url,
      apiKey: v3Key,
      tokenIds: anchorTokenIds,
    });
  } catch {
    priceMap = {};
  }
  [addr.usdm, CANONICAL_USDM_ADDRESS]
    .map((token) => normalizeAddress(token))
    .filter(Boolean)
    .forEach((token) => {
      priceMap[token] = 1;
    });
  [addr.weth, CANONICAL_WETH_ADDRESS]
    .map((token) => normalizeAddress(token))
    .filter(Boolean)
    .forEach((token) => {
      if (!Number.isFinite(Number(priceMap?.[token]))) {
        priceMap[token] = 0;
      }
    });

  let lpData = null;
  try {
    lpData = await withTimeout(
      computeLpData({
        url: v3Url,
        apiKey: v3Key,
        wallet: address,
        addr,
        priceMap,
        startBlock,
        allowOnchain: true,
        allowStakerScan: true,
      }),
      USER_LP_REFRESH_TIMEOUT_MS,
      `User LP refresh timeout for ${address}`
    );
  } catch {
    lpData = null;
  }

  if (!lpData) {
    await kv.hset(keys.user, { lpRefreshAt: nowMs });
    return {
      ...userRow,
      lpRefreshAt: nowMs,
    };
  }

  const volumeUsd = Math.max(0, toNumber(userRow?.volumeUsd, 0));
  const seasonBoostActive = Number.isFinite(startMs) ? nowMs >= startMs : true;
  const points = computePoints({
    volumeUsd,
    lpUsdTotal: lpData.lpUsd,
    lpUsdCrxEth: lpData.lpUsdCrxEth,
    lpUsdCrxUsdm: lpData.lpUsdCrxUsdm,
    boostEnabled: seasonBoostActive,
  });
  const lpCandidate =
    Number(userRow?.lpCandidate || 0) > 0 ||
    Boolean(lpData?.hasBoostLp) ||
    Number(lpData?.lpUsd || 0) > 0;

  const patch = {
    address,
    volumeUsd,
    rawVolumeUsd: points.rawVolumeUsd,
    effectiveVolumeUsd: points.effectiveVolumeUsd,
    scoringMode: points.scoringMode,
    scoringFeeBps: points.feeBps,
    volumeCapUsd: points.volumeCapUsd,
    diminishingFactor: points.diminishingFactor,
    points: points.totalPoints,
    basePoints: points.basePoints,
    bonusPoints: points.bonusPoints,
    boostedVolumeUsd: points.boostedVolumeUsd,
    boostedVolumeCap: points.boostedVolumeCap,
    multiplier: points.effectiveMultiplier,
    baseMultiplier: points.effectiveMultiplier,
    lpUsd: points.lpUsd,
    lpUsdCrxEth: points.lpUsdCrxEth,
    lpUsdCrxUsdm: points.lpUsdCrxUsdm,
    lpPoints: points.lpPoints,
    lpInRangePct: lpData.lpInRangePct,
    hasBoostLp: lpData.hasBoostLp ? 1 : 0,
    lpCandidate: lpCandidate ? 1 : "",
    hasRangeData: lpData.hasRangeData ? 1 : 0,
    hasInRange: lpData.hasInRange ? 1 : 0,
    lpAgeSeconds: lpData.lpAgeSeconds ?? "",
    lpRefreshAt: nowMs,
    updatedAt: nowMs,
  };

  const writePipeline = kv.pipeline();
  writePipeline.hset(keys.user, patch);
  writePipeline.zadd(keys.leaderboard, {
    score: points.totalPoints,
    member: address,
  });
  await writePipeline.exec();

  const rankRaw = await kv.zrevrank(keys.leaderboard, address);
  const rank = Number(rankRaw);
  if (Number.isFinite(rank)) {
    await kv.hset(keys.user, { rank: rank + 1 });
  }

  return {
    ...userRow,
    ...patch,
    rank: Number.isFinite(rank) ? rank + 1 : userRow?.rank,
  };
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { seasonId: seasonParam, address } = req.query || {};
  const {
    seasonId: configuredSeasonId,
    seasonStartMs,
    seasonEndMs,
    missing: missingSeasonEnv,
  } = getSeasonConfig();
  let targetSeason = seasonParam || configuredSeasonId;
  if (!targetSeason) {
    try {
      targetSeason = await discoverSeasonIdFromKv();
    } catch {
      targetSeason = "";
    }
  }
  if (!targetSeason) {
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
    const [rawUserRow, summaryRow, rewardRow, updatedAtRaw] = await Promise.all([
      kv.hgetall(keys.user),
      kv.hgetall(keys.summary),
      kv.hgetall(keys.rewardUser),
      kv.get(keys.updatedAt),
    ]);

    void maybeTriggerPointsSelfHeal({
      kv,
      req,
      seasonId: targetSeason,
      updatedAtMs: Number(updatedAtRaw || summaryRow?.updatedAt || 0),
      reason: "user_read",
      includeWhitelist: false,
    }).catch(() => {
      // best effort self-heal; never block user response
    });

    if (!rawUserRow) {
      res.status(200).json({
        seasonId: targetSeason,
        address: normalized,
        exists: false,
        user: null,
      });
      return;
    }

    let userRow = rawUserRow;
    userRow = await maybeRefreshMissingLpForUser({
      address: normalized,
      userRow,
      keys,
      nowMs,
    });

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
    const leaderboardPreviewConfig = {
      ...rewardsConfig,
      top100MinVolumeUsd: 0,
      top100RequireFinalization: false,
    };
    const rewardsTable = computeLeaderboardRewardsTable({
      entries: rankedEntries,
      userRowsByAddress,
      seasonRewardCrx,
      config: leaderboardPreviewConfig,
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
    const claimCount = excludedFromLeaderboard
      ? 0
      : Math.max(0, Math.floor(toNumber(parsedRewardRow?.claimCount, 0)));
    const frozenRewardSnapshotCrx = toNumber(parsedRewardRow?.totalRewardSnapshotCrx, 0);
    const hasFrozenSnapshot = claimCount > 0 && frozenRewardSnapshotCrx > 0;
    const rewardSnapshotCrx =
      excludedFromLeaderboard
        ? 0
        : hasFrozenSnapshot
        ? frozenRewardSnapshotCrx
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
      seasonStart: seasonStartMs,
      seasonEnd: seasonEndMs,
      seasonOngoing:
        Number.isFinite(seasonStartMs) &&
        (!Number.isFinite(seasonEndMs) || nowMs < seasonEndMs),
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
          claimCount,
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
