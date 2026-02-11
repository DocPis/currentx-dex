/* eslint-env node */
import {
  buildPointsClaimMessage,
  computeProRataReward,
  normalizeAddress,
  parseSeasonIndex,
  round6,
} from "../shared/lib/pointsRewards.js";

const DEFAULTS = {
  totalSupplyCrx: 1_000_000,
  leaderboardRewardsPct: 0.4,
  seasonAllocationsCrx: [120_000, 90_000, 70_000, 50_000, 40_000, 30_000],
  finalizationWindowHours: 48,
  claimSignatureTtlMs: 10 * 60 * 1000,
};

const parseTime = (value) => {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const clampNumber = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

const pickEnvValue = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
};

const parseSeasonAllocations = (raw) =>
  String(raw || "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((num) => Number.isFinite(num) && num >= 0)
    .map((num) => round6(num));

const getSeasonAllocation = (seasonId, allocations, explicitSeasonReward) => {
  const explicit = Number(explicitSeasonReward);
  if (Number.isFinite(explicit) && explicit >= 0) return round6(explicit);
  const list = Array.isArray(allocations) && allocations.length
    ? allocations
    : DEFAULTS.seasonAllocationsCrx;
  const explicitIndex = Number(process.env.POINTS_SEASON_INDEX);
  const seasonIndex =
    (Number.isFinite(explicitIndex) && explicitIndex > 0
      ? Math.floor(explicitIndex)
      : parseSeasonIndex(seasonId)) || 1;
  const idx = Math.max(0, seasonIndex - 1);
  return round6(list[idx] ?? list[list.length - 1] ?? 0);
};

export const getLeaderboardRewardsConfig = (seasonIdOverride) => {
  const seasonId =
    seasonIdOverride ||
    pickEnvValue(process.env.POINTS_SEASON_ID, process.env.VITE_POINTS_SEASON_ID);
  const seasonEndMs =
    parseTime(process.env.POINTS_SEASON_END) ||
    parseTime(process.env.VITE_POINTS_SEASON_END);
  const finalizationWindowHours = clampNumber(
    process.env.POINTS_FINALIZATION_WINDOW_HOURS,
    0,
    168,
    DEFAULTS.finalizationWindowHours
  );
  const defaultClaimOpensAt = Number.isFinite(seasonEndMs)
    ? seasonEndMs + finalizationWindowHours * 60 * 60 * 1000
    : null;

  const totalSupplyCrx = clampNumber(
    process.env.POINTS_TOTAL_SUPPLY_CRX,
    1,
    10_000_000_000,
    DEFAULTS.totalSupplyCrx
  );
  const leaderboardRewardsPct = clampNumber(
    process.env.POINTS_LEADERBOARD_REWARDS_PCT,
    0,
    1,
    DEFAULTS.leaderboardRewardsPct
  );
  const leaderboardRewardsTotalCrx = round6(totalSupplyCrx * leaderboardRewardsPct);
  const configuredAllocations = parseSeasonAllocations(
    process.env.POINTS_LEADERBOARD_SEASON_ALLOCATIONS
  );
  const seasonAllocationsCrx = configuredAllocations.length
    ? configuredAllocations
    : DEFAULTS.seasonAllocationsCrx;
  const seasonRewardCrx = getSeasonAllocation(
    seasonId,
    seasonAllocationsCrx,
    process.env.POINTS_SEASON_REWARD_CRX
  );

  return {
    seasonId,
    totalSupplyCrx,
    leaderboardRewardsPct,
    leaderboardRewardsTotalCrx,
    seasonAllocationsCrx,
    seasonRewardCrx,
    immediatePct: 1,
    streamDays: 0,
    seasonEndMs,
    finalizationWindowHours,
    claimOpensAtMs:
      parseTime(process.env.POINTS_REWARDS_CLAIM_OPENS_AT) || defaultClaimOpensAt,
    claimSignatureTtlMs: clampNumber(
      process.env.POINTS_REWARD_CLAIM_SIGNATURE_TTL_MS,
      60 * 1000,
      24 * 60 * 60 * 1000,
      DEFAULTS.claimSignatureTtlMs
    ),
  };
};

export const parsePointsSummaryRow = (row) => {
  if (!row || typeof row !== "object") return null;
  return {
    seasonId: String(row.seasonId || ""),
    walletCount: toNumber(row.walletCount, 0),
    totalPoints: toNumber(row.totalPoints, 0),
    seasonRewardCrx: toNumber(row.seasonRewardCrx, 0),
    immediatePct: toNumber(row.immediatePct, 0),
    streamDays: toNumber(row.streamDays, 0),
    claimOpensAt: toNumber(row.claimOpensAt, null),
    claimOpen:
      row.claimOpen === true ||
      row.claimOpen === 1 ||
      row.claimOpen === "1" ||
      row.claimOpen === "true",
    scoringMode: String(row.scoringMode || ""),
    scoringFeeBps: toNumber(row.scoringFeeBps, 0),
    volumeCapUsd: toNumber(row.volumeCapUsd, 0),
    diminishingFactor: toNumber(row.diminishingFactor, 0),
    updatedAt: toNumber(row.updatedAt, null),
  };
};

export const parseRewardClaimRow = (row) => {
  if (!row || typeof row !== "object") return null;
  return {
    address: normalizeAddress(row.address),
    seasonId: String(row.seasonId || ""),
    totalRewardSnapshotCrx: toNumber(row.totalRewardSnapshotCrx, 0),
    immediateClaimedCrx: toNumber(row.immediateClaimedCrx, 0),
    streamedClaimedCrx: toNumber(row.streamedClaimedCrx, 0),
    claimCount: toNumber(row.claimCount, 0),
    lastClaimAt: toNumber(row.lastClaimAt, null),
    updatedAt: toNumber(row.updatedAt, null),
  };
};

export const buildPointsSummary = ({
  seasonId,
  walletCount,
  totalPoints,
  scoringMode,
  scoringFeeBps,
  volumeCapUsd,
  diminishingFactor,
  config,
  nowMs = Date.now(),
}) => {
  const claimOpensAt = Number(config?.claimOpensAtMs);
  const claimOpen = Number.isFinite(claimOpensAt) ? nowMs >= claimOpensAt : false;
  return {
    seasonId: String(seasonId || config?.seasonId || ""),
    walletCount: Math.max(0, Math.floor(toNumber(walletCount, 0))),
    totalPoints: round6(toNumber(totalPoints, 0)),
    seasonRewardCrx: round6(toNumber(config?.seasonRewardCrx, 0)),
    immediatePct: 1,
    streamDays: 0,
    claimOpensAt: Number.isFinite(claimOpensAt) ? claimOpensAt : "",
    claimOpen: claimOpen ? 1 : 0,
    scoringMode: String(scoringMode || ""),
    scoringFeeBps: Math.max(0, toNumber(scoringFeeBps, 0)),
    volumeCapUsd: Math.max(0, round6(toNumber(volumeCapUsd, 0))),
    diminishingFactor: Math.max(0, round6(toNumber(diminishingFactor, 0))),
    updatedAt: nowMs,
  };
};

export const computeLeaderboardReward = ({
  userPoints,
  totalPoints,
  seasonRewardCrx,
}) => computeProRataReward({ userPoints, totalPoints, seasonRewardCrx });

export const getLeaderboardClaimState = ({
  totalRewardCrx,
  claimRow,
  config,
  nowMs = Date.now(),
}) => {
  const totalReward = round6(Math.max(0, toNumber(totalRewardCrx, 0)));
  const claimOpensAt = toNumber(config?.claimOpensAtMs, null);
  const claimOpen = Number.isFinite(claimOpensAt) ? nowMs >= claimOpensAt : false;

  const immediateClaimed = round6(Math.max(0, toNumber(claimRow?.immediateClaimedCrx, 0)));
  const streamedClaimed = round6(Math.max(0, toNumber(claimRow?.streamedClaimedCrx, 0)));
  const totalClaimedCrx = round6(immediateClaimed + streamedClaimed);
  const remainingCrx = round6(Math.max(0, totalReward - totalClaimedCrx));
  const claimableNowCrx = claimOpen ? remainingCrx : 0;

  return {
    totalRewardCrx: totalReward,
    immediatePct: 1,
    streamDays: 0,
    claimOpen,
    claimOpensAt,
    streamStartAt: Number.isFinite(claimOpensAt) ? claimOpensAt : null,
    streamEndsAt: Number.isFinite(claimOpensAt) ? claimOpensAt : null,
    streamDurationMs: 0,
    streamProgress: claimOpen ? 1 : 0,
    immediateTotalCrx: totalReward,
    streamedTotalCrx: 0,
    vestedStreamedCrx: 0,
    immediateClaimedCrx: immediateClaimed,
    streamedClaimedCrx: streamedClaimed,
    immediateRemainingCrx: remainingCrx,
    streamedRemainingCrx: 0,
    claimableNowCrx: round6(claimableNowCrx),
    totalClaimedCrx,
  };
};

export const computeLeaderboardClaimPayout = ({
  totalRewardCrx,
  claimRow,
  config,
  nowMs = Date.now(),
}) => {
  const state = getLeaderboardClaimState({
    totalRewardCrx,
    claimRow,
    config,
    nowMs,
  });
  if (!state.claimOpen || state.claimableNowCrx <= 0) {
    return {
      ...state,
      claimImmediateCrx: 0,
      claimStreamedCrx: 0,
      claimTotalCrx: 0,
      nextImmediateClaimedCrx: round6(claimRow?.immediateClaimedCrx || 0),
      nextStreamedClaimedCrx: round6(claimRow?.streamedClaimedCrx || 0),
    };
  }
  const claimImmediateCrx = round6(state.claimableNowCrx);
  const claimStreamedCrx = 0;
  const nextImmediateClaimedCrx = round6(
    (claimRow?.immediateClaimedCrx || 0) + claimImmediateCrx
  );
  const nextStreamedClaimedCrx = round6(
    (claimRow?.streamedClaimedCrx || 0) + claimStreamedCrx
  );
  return {
    ...state,
    claimImmediateCrx,
    claimStreamedCrx,
    claimTotalCrx: round6(claimImmediateCrx + claimStreamedCrx),
    nextImmediateClaimedCrx,
    nextStreamedClaimedCrx,
  };
};

export {
  buildPointsClaimMessage,
  normalizeAddress,
  round6,
};
