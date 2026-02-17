/* eslint-env node */
import { authorizeBearerRequest } from "./requestAuth.js";

const DEFAULT_SEASON_ID =
  String(process.env.POINTS_SEASON_ID || process.env.VITE_POINTS_SEASON_ID || "").trim();

const DEFAULTS = {
  budgetCapCrx: 10_000,
  baseMinCrx: 20,
  baseMaxCrx: 50,
  bonusMinCrx: 50,
  bonusMaxCrx: 150,
  activationWindowDays: 14,
  volumeThresholdUsd: 100,
  microLpUsd: 100,
  immediatePct: 0.3,
  streamDays: 45,
  finalizationWindowHours: 48,
  claimOpensAtMs: null,
  claimSignatureTtlMs: 10 * 60 * 1000,
};

const WHITELIST_KEY_PREFIX = "presale:wallet:";
const SCAN_BATCH_SIZE = 1000;
const MAX_SCAN_ROUNDS = 2000;

const clamp = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

const toNumberSafe = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toBool = (value) =>
  value === true ||
  value === 1 ||
  value === "1" ||
  value === "true" ||
  value === "TRUE";

const toMsSafe = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  if (num < 1e12) return Math.floor(num * 1000);
  return Math.floor(num);
};

const parseTime = (value) => {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeAddress = (value) =>
  value ? String(value).trim().toLowerCase() : "";

const fnv1a32 = (input) => {
  const text = String(input || "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const deterministicInRange = (address, min, max, salt) => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  if (max <= min) return min;
  const hash = fnv1a32(`${salt}:${normalizeAddress(address)}`);
  const ratio = hash / 0xffffffff;
  return min + (max - min) * ratio;
};

const round6 = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1e6) / 1e6;
};

const parseScanResult = (result) => {
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

export const getWhitelistRewardsConfig = (seasonIdOverride) => {
  const seasonId = seasonIdOverride || DEFAULT_SEASON_ID;
  const seasonEndMs =
    parseTime(process.env.POINTS_SEASON_END) ||
    parseTime(process.env.VITE_POINTS_SEASON_END);
  const finalizationWindowHours = clamp(
    process.env.POINTS_FINALIZATION_WINDOW_HOURS,
    0,
    168,
    DEFAULTS.finalizationWindowHours
  );
  const defaultClaimOpensAt = Number.isFinite(seasonEndMs)
    ? seasonEndMs + finalizationWindowHours * 60 * 60 * 1000
    : DEFAULTS.claimOpensAtMs;
  return {
    seasonId,
    budgetCapCrx: clamp(
      process.env.WHITELIST_BUDGET_CAP_CRX,
      1,
      1_000_000_000,
      DEFAULTS.budgetCapCrx
    ),
    baseMinCrx: clamp(
      process.env.WHITELIST_BASE_MIN_CRX,
      0,
      1_000_000,
      DEFAULTS.baseMinCrx
    ),
    baseMaxCrx: clamp(
      process.env.WHITELIST_BASE_MAX_CRX,
      0,
      1_000_000,
      DEFAULTS.baseMaxCrx
    ),
    bonusMinCrx: clamp(
      process.env.WHITELIST_BONUS_MIN_CRX,
      0,
      1_000_000,
      DEFAULTS.bonusMinCrx
    ),
    bonusMaxCrx: clamp(
      process.env.WHITELIST_BONUS_MAX_CRX,
      0,
      1_000_000,
      DEFAULTS.bonusMaxCrx
    ),
    activationWindowDays: clamp(
      process.env.WHITELIST_ACTIVATION_WINDOW_DAYS,
      1,
      365,
      DEFAULTS.activationWindowDays
    ),
    volumeThresholdUsd: clamp(
      process.env.WHITELIST_VOLUME_THRESHOLD_USD,
      0,
      10_000_000,
      DEFAULTS.volumeThresholdUsd
    ),
    microLpUsd: clamp(
      process.env.WHITELIST_MICRO_LP_USD,
      0,
      10_000_000,
      DEFAULTS.microLpUsd
    ),
    immediatePct: clamp(
      process.env.WHITELIST_IMMEDIATE_PCT,
      0,
      1,
      DEFAULTS.immediatePct
    ),
    streamDays: clamp(
      process.env.WHITELIST_STREAM_DAYS,
      1,
      365,
      DEFAULTS.streamDays
    ),
    seasonEndMs,
    finalizationWindowHours,
    claimOpensAtMs:
      parseTime(process.env.WHITELIST_CLAIM_OPENS_AT) ||
      parseTime(process.env.VITE_WHITELIST_CLAIM_OPENS_AT) ||
      defaultClaimOpensAt,
    claimSignatureTtlMs: clamp(
      process.env.WHITELIST_CLAIM_SIGNATURE_TTL_MS,
      60 * 1000,
      24 * 60 * 60 * 1000,
      DEFAULTS.claimSignatureTtlMs
    ),
  };
};

export const getWhitelistKeys = (seasonId) => {
  const base = `whitelist:${seasonId}`;
  return {
    summary: `${base}:summary`,
    updatedAt: `${base}:updatedAt`,
    leaderboard: `${base}:leaderboard`,
    user: (address) => `${base}:user:${normalizeAddress(address)}`,
    pointsUser: (address) =>
      `points:${seasonId}:user:${normalizeAddress(address)}`,
  };
};

export const getPresaleKey = (address) =>
  `${WHITELIST_KEY_PREFIX}${normalizeAddress(address)}`;

export const authorizeRequest = (req, secret) => {
  return authorizeBearerRequest(req, secret);
};

export const scanWhitelistWallets = async (kv) => {
  if (typeof kv.scan !== "function") {
    if (typeof kv.keys === "function") {
      const raw = await kv.keys(`${WHITELIST_KEY_PREFIX}*`);
      return (Array.isArray(raw) ? raw : [])
        .map((key) => normalizeAddress(String(key).slice(WHITELIST_KEY_PREFIX.length)))
        .filter(Boolean)
        .sort();
    }
    return [];
  }

  let cursor = "0";
  const seen = new Set();
  for (let i = 0; i < MAX_SCAN_ROUNDS; i += 1) {
    const raw = await kv.scan(cursor, {
      match: `${WHITELIST_KEY_PREFIX}*`,
      count: SCAN_BATCH_SIZE,
    });
    const parsed = parseScanResult(raw);
    (parsed.keys || []).forEach((key) => {
      if (typeof key !== "string") return;
      const wallet = normalizeAddress(key.slice(WHITELIST_KEY_PREFIX.length));
      if (!wallet) return;
      seen.add(wallet);
    });
    if (parsed.cursor === "0" || parsed.cursor === cursor) break;
    cursor = parsed.cursor;
  }
  return Array.from(seen).sort();
};

export const evaluateWallet = ({
  wallet,
  presaleRow,
  pointsRow,
  existingRewardRow,
  config,
  nowMs,
}) => {
  const whitelistedAt =
    toMsSafe(presaleRow?.ts, null) ??
    toMsSafe(existingRewardRow?.whitelistedAt, nowMs);
  const windowEndsAt =
    whitelistedAt + Math.floor(config.activationWindowDays * 86400 * 1000);
  const withinWindow = nowMs <= windowEndsAt;

  const volumeUsd = toNumberSafe(pointsRow?.volumeUsd, 0);
  const lpUsd = toNumberSafe(pointsRow?.lpUsd, 0);
  const hasSwap = volumeUsd > 0;
  const metVolumeThreshold = volumeUsd >= config.volumeThresholdUsd;
  const metMicroLp = lpUsd >= config.microLpUsd;
  const activationNow = hasSwap && (metVolumeThreshold || metMicroLp);

  const previousActivatedAt = toMsSafe(existingRewardRow?.activatedAt, null);
  const activatedAt =
    previousActivatedAt ??
    (withinWindow && activationNow ? nowMs : null);
  const activationQualified = Boolean(activatedAt);

  const baseRewardRaw = deterministicInRange(
    wallet,
    config.baseMinCrx,
    Math.max(config.baseMinCrx, config.baseMaxCrx),
    "whitelist-base"
  );
  const bonusRewardRaw = activationQualified
    ? deterministicInRange(
        wallet,
        config.bonusMinCrx,
        Math.max(config.bonusMinCrx, config.bonusMaxCrx),
        "whitelist-bonus"
      )
    : 0;

  return {
    wallet,
    whitelistedAt,
    windowEndsAt,
    withinWindow,
    volumeUsd,
    lpUsd,
    hasSwap,
    metVolumeThreshold,
    metMicroLp,
    activationQualified,
    activatedAt,
    baseRewardRaw,
    bonusRewardRaw,
    existingImmediateClaimedCrx: toNumberSafe(
      existingRewardRow?.immediateClaimedCrx,
      0
    ),
    existingStreamedClaimedCrx: toNumberSafe(
      existingRewardRow?.streamedClaimedCrx,
      0
    ),
    existingLastClaimAt: toMsSafe(existingRewardRow?.lastClaimAt, null),
    existingClaimCount: toNumberSafe(existingRewardRow?.claimCount, 0),
  };
};

export const applyBudgetCap = (entries, config) => {
  const list = Array.isArray(entries) ? entries : [];
  const baseTotalRaw = list.reduce((sum, row) => sum + (row.baseRewardRaw || 0), 0);
  const bonusTotalRaw = list.reduce((sum, row) => sum + (row.bonusRewardRaw || 0), 0);
  const cap = Math.max(0, Number(config.budgetCapCrx || 0));

  let baseScale = 1;
  let bonusScale = 1;
  if (baseTotalRaw > cap && baseTotalRaw > 0) {
    baseScale = cap / baseTotalRaw;
    bonusScale = 0;
  } else {
    const remaining = Math.max(0, cap - baseTotalRaw);
    if (bonusTotalRaw > remaining && bonusTotalRaw > 0) {
      bonusScale = remaining / bonusTotalRaw;
    }
  }

  return list.map((row) => {
    const baseRewardCrx = round6((row.baseRewardRaw || 0) * baseScale);
    const activationBonusCrx = round6((row.bonusRewardRaw || 0) * bonusScale);
    const totalRewardCrx = round6(baseRewardCrx + activationBonusCrx);
    const immediateClaimableCrx = round6(totalRewardCrx * config.immediatePct);
    const streamedCrx = round6(Math.max(0, totalRewardCrx - immediateClaimableCrx));
    const streamStartAt = row.activatedAt || row.whitelistedAt;
    return {
      ...row,
      baseScale: round6(baseScale),
      bonusScale: round6(bonusScale),
      baseRewardCrx,
      activationBonusCrx,
      totalRewardCrx,
      immediateClaimableCrx,
      streamedCrx,
      streamStartAt,
    };
  });
};

export const buildSummary = (entries, config, nowMs) => {
  const list = Array.isArray(entries) ? entries : [];
  const walletCount = list.length;
  const activatedCount = list.filter((row) => row.activationQualified).length;
  const baseAllocatedCrx = round6(
    list.reduce((sum, row) => sum + (row.baseRewardCrx || 0), 0)
  );
  const bonusAllocatedCrx = round6(
    list.reduce((sum, row) => sum + (row.activationBonusCrx || 0), 0)
  );
  const totalAllocatedCrx = round6(baseAllocatedCrx + bonusAllocatedCrx);
  const totalImmediateCrx = round6(
    list.reduce((sum, row) => sum + (row.immediateClaimableCrx || 0), 0)
  );
  const totalStreamedCrx = round6(
    list.reduce((sum, row) => sum + (row.streamedCrx || 0), 0)
  );

  return {
    seasonId: config.seasonId,
    walletCount,
    activatedCount,
    budgetCapCrx: round6(config.budgetCapCrx),
    baseAllocatedCrx,
    bonusAllocatedCrx,
    totalAllocatedCrx,
    totalImmediateCrx,
    totalStreamedCrx,
    immediatePct: round6(config.immediatePct),
    streamDays: config.streamDays,
    updatedAt: nowMs,
  };
};

export const parseStoredRewardRow = (row) => {
  if (!row || typeof row !== "object") return null;
  return {
    address: normalizeAddress(row.address),
    seasonId: String(row.seasonId || ""),
    whitelisted: toBool(row.whitelisted),
    whitelistedAt: toMsSafe(row.whitelistedAt, null),
    activationWindowDays: toNumberSafe(row.activationWindowDays, 0),
    windowEndsAt: toMsSafe(row.windowEndsAt, null),
    withinWindow: toBool(row.withinWindow),
    activationQualified: toBool(row.activationQualified),
    activatedAt: toMsSafe(row.activatedAt, null),
    hasSwap: toBool(row.hasSwap),
    metVolumeThreshold: toBool(row.metVolumeThreshold),
    metMicroLp: toBool(row.metMicroLp),
    volumeUsd: toNumberSafe(row.volumeUsd, 0),
    lpUsd: toNumberSafe(row.lpUsd, 0),
    volumeThresholdUsd: toNumberSafe(row.volumeThresholdUsd, 0),
    microLpUsd: toNumberSafe(row.microLpUsd, 0),
    baseRewardCrx: toNumberSafe(row.baseRewardCrx, 0),
    activationBonusCrx: toNumberSafe(row.activationBonusCrx, 0),
    totalRewardCrx: toNumberSafe(row.totalRewardCrx, 0),
    immediateClaimableCrx: toNumberSafe(row.immediateClaimableCrx, 0),
    streamedCrx: toNumberSafe(row.streamedCrx, 0),
    immediatePct: toNumberSafe(row.immediatePct, 0),
    streamDays: toNumberSafe(row.streamDays, 0),
    streamStartAt: toMsSafe(row.streamStartAt, null),
    immediateClaimedCrx: toNumberSafe(row.immediateClaimedCrx, 0),
    streamedClaimedCrx: toNumberSafe(row.streamedClaimedCrx, 0),
    lastClaimAt: toMsSafe(row.lastClaimAt, null),
    claimCount: toNumberSafe(row.claimCount, 0),
    budgetBaseScale: toNumberSafe(row.budgetBaseScale, 1),
    budgetBonusScale: toNumberSafe(row.budgetBonusScale, 1),
    pending: toBool(row.pending),
    updatedAt: toMsSafe(row.updatedAt, null),
  };
};

export const parseStoredSummaryRow = (row) => {
  if (!row || typeof row !== "object") return null;
  return {
    seasonId: String(row.seasonId || ""),
    walletCount: toNumberSafe(row.walletCount, 0),
    activatedCount: toNumberSafe(row.activatedCount, 0),
    budgetCapCrx: toNumberSafe(row.budgetCapCrx, 0),
    baseAllocatedCrx: toNumberSafe(row.baseAllocatedCrx, 0),
    bonusAllocatedCrx: toNumberSafe(row.bonusAllocatedCrx, 0),
    totalAllocatedCrx: toNumberSafe(row.totalAllocatedCrx, 0),
    totalImmediateCrx: toNumberSafe(row.totalImmediateCrx, 0),
    totalStreamedCrx: toNumberSafe(row.totalStreamedCrx, 0),
    immediatePct: toNumberSafe(row.immediatePct, 0),
    streamDays: toNumberSafe(row.streamDays, 0),
    updatedAt: toMsSafe(row.updatedAt, null),
  };
};

export const getWhitelistClaimState = (rewardRow, config, nowMs = Date.now()) => {
  const totalRewardCrx = toNumberSafe(rewardRow?.totalRewardCrx, 0);
  const immediateClaimableCrx = toNumberSafe(rewardRow?.immediateClaimableCrx, 0);
  const streamedCrx = toNumberSafe(rewardRow?.streamedCrx, 0);
  const immediateClaimedCrx = toNumberSafe(rewardRow?.immediateClaimedCrx, 0);
  const streamedClaimedCrx = toNumberSafe(rewardRow?.streamedClaimedCrx, 0);
  const streamStartAt = toMsSafe(rewardRow?.streamStartAt, null);
  const streamDays = Math.max(1, toNumberSafe(rewardRow?.streamDays, config?.streamDays || 1));
  const streamDurationMs = streamDays * 86400 * 1000;

  const claimOpensAt = toMsSafe(config?.claimOpensAtMs, null);
  const claimOpen = Number.isFinite(claimOpensAt) ? nowMs >= claimOpensAt : false;

  const elapsedMs = streamStartAt ? Math.max(0, nowMs - streamStartAt) : 0;
  const streamProgress =
    streamStartAt && streamDurationMs > 0
      ? Math.min(1, elapsedMs / streamDurationMs)
      : 0;
  const vestedStreamedCrx = round6(streamedCrx * streamProgress);

  const immediateRemainingCrx = round6(
    Math.max(0, immediateClaimableCrx - immediateClaimedCrx)
  );
  const streamedRemainingCrx = round6(
    Math.max(0, vestedStreamedCrx - streamedClaimedCrx)
  );
  const totalClaimedCrx = round6(immediateClaimedCrx + streamedClaimedCrx);
  const claimableNowCrx = claimOpen
    ? round6(immediateRemainingCrx + streamedRemainingCrx)
    : 0;

  return {
    claimOpen,
    claimOpensAt,
    claimableNowCrx,
    immediateRemainingCrx,
    streamedRemainingCrx,
    vestedStreamedCrx,
    totalClaimedCrx,
    totalRewardCrx: round6(totalRewardCrx),
    streamProgress: round6(streamProgress),
    streamStartAt: streamStartAt || null,
    streamDurationMs,
    streamEndsAt: streamStartAt ? streamStartAt + streamDurationMs : null,
  };
};

export const computeClaimPayout = (rewardRow, config, nowMs = Date.now()) => {
  const state = getWhitelistClaimState(rewardRow, config, nowMs);
  if (!state.claimOpen || state.claimableNowCrx <= 0) {
    return {
      ...state,
      claimImmediateCrx: 0,
      claimStreamedCrx: 0,
      claimTotalCrx: 0,
      nextImmediateClaimedCrx: toNumberSafe(rewardRow?.immediateClaimedCrx, 0),
      nextStreamedClaimedCrx: toNumberSafe(rewardRow?.streamedClaimedCrx, 0),
      nextTotalClaimedCrx: state.totalClaimedCrx,
    };
  }

  const immediateRemainingCrx = state.immediateRemainingCrx;
  const claimTotalCrx = state.claimableNowCrx;
  const claimImmediateCrx = round6(Math.min(claimTotalCrx, immediateRemainingCrx));
  const claimStreamedCrx = round6(Math.max(0, claimTotalCrx - claimImmediateCrx));
  const nextImmediateClaimedCrx = round6(
    toNumberSafe(rewardRow?.immediateClaimedCrx, 0) + claimImmediateCrx
  );
  const nextStreamedClaimedCrx = round6(
    toNumberSafe(rewardRow?.streamedClaimedCrx, 0) + claimStreamedCrx
  );

  return {
    ...state,
    claimImmediateCrx,
    claimStreamedCrx,
    claimTotalCrx,
    nextImmediateClaimedCrx,
    nextStreamedClaimedCrx,
    nextTotalClaimedCrx: round6(nextImmediateClaimedCrx + nextStreamedClaimedCrx),
  };
};
