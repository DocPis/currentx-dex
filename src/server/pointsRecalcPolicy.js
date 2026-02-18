/* eslint-env node */

const DEFAULT_PRIORITY_RANK_LIMIT = 100;
const DEFAULT_PRIORITY_TIMEOUT_MS = 20_000;

const clampInt = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
};

const toFiniteNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toNonNegative = (value) => Math.max(0, toFiniteNumber(value, 0));

export const getLpPriorityRankLimit = () =>
  clampInt(process.env.POINTS_RECALC_LP_PRIORITY_RANK, 1, 5000, DEFAULT_PRIORITY_RANK_LIMIT);

export const getLpPriorityTimeoutMs = (baseTimeoutMs, maxTimeoutMs) => {
  const base = clampInt(baseTimeoutMs, 1000, maxTimeoutMs, 10_000);
  const preferredDefault = Math.max(base, DEFAULT_PRIORITY_TIMEOUT_MS);
  return clampInt(
    process.env.POINTS_RECALC_LP_PRIORITY_TIMEOUT_MS,
    1000,
    maxTimeoutMs,
    preferredDefault
  );
};

export const resolveLpRecalcPolicy = ({
  row,
  fastMode,
  priorityRankLimit,
}) => {
  const rankRaw = toFiniteNumber(row?.rank, NaN);
  const rank = Number.isFinite(rankRaw) && rankRaw > 0 ? Math.floor(rankRaw) : null;

  const lpUsd = toNonNegative(row?.lpUsd);
  const lpUsdCrxEth = toNonNegative(row?.lpUsdCrxEth);
  const lpUsdCrxUsdm = toNonNegative(row?.lpUsdCrxUsdm);
  const lpCandidateFromRow =
    Number(row?.lpCandidate || 0) > 0 || Number(row?.hasBoostLp || 0) > 0;
  const lpCandidateFromStoredLp = lpUsd > 0 || lpUsdCrxEth > 0 || lpUsdCrxUsdm > 0;
  const lpCandidate = lpCandidateFromRow || lpCandidateFromStoredLp;

  const limit = clampInt(priorityRankLimit, 1, 5000, DEFAULT_PRIORITY_RANK_LIMIT);
  const isPriorityRank = Number.isFinite(rank) && rank > 0 && rank <= limit;

  // In fast mode we only refresh likely LP wallets and priority leaderboard wallets.
  // In non-fast mode we still refresh everyone for completeness.
  const shouldRefreshLp = !fastMode || lpCandidate || isPriorityRank;
  // On-chain fallback is expensive: use it for likely LP wallets and priority ranks.
  const allowOnchain = lpCandidate || isPriorityRank;

  return {
    rank,
    lpCandidate,
    isPriorityRank,
    shouldRefreshLp,
    allowOnchain,
  };
};
