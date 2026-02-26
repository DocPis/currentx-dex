import { kv } from "@vercel/kv";
import {
  buildPointsSummary,
  computeLeaderboardRewardsTable,
  getLeaderboardRewardsConfig,
  normalizeAddress,
  parsePointsSummaryRow,
  round6,
} from "../../src/server/leaderboardRewardsLib.js";
import { maybeTriggerPointsSelfHeal } from "../../src/server/pointsSelfHeal.js";

const SCAN_BATCH_SIZE = 1000;
const MAX_SCAN_ROUNDS = 2000;

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
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { seasonId: seasonParam } = req.query || {};
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
    let allEntries = null;
    if (needsFilteredTotals) {
      allEntries = await kv.zrange(keys.leaderboard, 0, -1, { withScores: true });
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
      const summaryEntries =
        allEntries || (await kv.zrange(keys.leaderboard, 0, -1, { withScores: true }));
      summary = await buildSummaryFromEntries({
        entries: summaryEntries,
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
    // UI preview rewards should remain visible even if some user hashes are stale/missing.
    // Fallback row keeps volume eligibility aligned with visible points score.
    const userRowsByAddress = new Map(
      addresses.map(({ address, score }, idx) => {
        const row = userRows?.[idx] || null;
        if (row && Object.keys(row).length) {
          return [address, row];
        }
        return [
          address,
          {
            points: score,
            volumeUsd: score,
            washFlag: 0,
          },
        ];
      })
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

    const items = addresses.map(({ address, score }, idx) => {
      const row = userRows?.[idx] || {};
      const points = toNumber(row?.points, score);
      const multiplier = toNumber(row?.multiplier, 1);
      const lpUsd = toNumber(row?.lpUsd, 0);
      const rank = idx + 1;
      const snapshot24hPoints = toNumber(row?.snapshot24hPoints, points);
      const snapshot24hRankRaw = toNumber(row?.snapshot24hRank, NaN);
      const snapshot24hRank =
        Number.isFinite(snapshot24hRankRaw) && snapshot24hRankRaw > 0
          ? snapshot24hRankRaw
          : NaN;
      const snapshot24hAt = toNumber(row?.snapshot24hAt, null);
      const pointsChange24h = round6(points - snapshot24hPoints);
      const rankChange24h = Number.isFinite(snapshot24hRank)
        ? Math.floor(snapshot24hRank) - rank
        : 0;
      const rewardCrx = toNumber(rewardsTable?.rewardsByAddress?.get(address), 0);
      const rewardSharePct = seasonRewardCrx > 0
        ? round6((rewardCrx / seasonRewardCrx) * 100)
        : 0;
      return {
        address,
        points,
        multiplier,
        lpUsd,
        rank,
        rewardCrx,
        rewardSharePct,
        pointsChange24h,
        rankChange24h,
        snapshot24hAt,
      };
    });
    const visibleRewardsCrx = round6(
      items.reduce((sum, row) => sum + toNumber(row?.rewardCrx, 0), 0)
    );

    const updatedAt = await kv.get(keys.updatedAt);
    void maybeTriggerPointsSelfHeal({
      kv,
      req,
      seasonId: targetSeason,
      updatedAtMs: Number(updatedAt || summary?.updatedAt || 0),
      reason: "leaderboard_read",
      includeWhitelist: false,
    }).catch(() => {
      // best effort self-heal; never block leaderboard response
    });
    res.status(200).json({
      seasonId: targetSeason,
      seasonStart: seasonStartMs,
      seasonEnd: seasonEndMs,
      seasonOngoing:
        Number.isFinite(seasonStartMs) &&
        (!Number.isFinite(seasonEndMs) || nowMs < seasonEndMs),
      updatedAt: updatedAt || null,
      leaderboard: items,
      summary: {
        ...(summary || {}),
        walletCount,
        seasonRewardCrx,
        top100Only: Boolean(rewardsTable?.top100Only),
        top100PoolCrx: toNumber(rewardsTable?.top100PoolCrx, 0),
        baseOthersPoolCrx: toNumber(rewardsTable?.baseOthersPoolCrx, 0),
        othersPoolCrx: toNumber(rewardsTable?.effectiveOthersPoolCrx, 0),
        top100UnassignedCrx: toNumber(rewardsTable?.top100UnassignedCrx, 0),
        visibleRewardsCrx,
        totalPoints,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
