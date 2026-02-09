// src/shared/lib/points.js
import {
  BOOST_CAP_MULTIPLIER,
  MULTIPLIER_TIERS,
  OUT_OF_RANGE_FACTOR,
} from "../config/points";
import { CRX_ADDRESS, USDM_ADDRESS, WETH_ADDRESS } from "../config/addresses";

const normalizeAddress = (addr) => (addr ? String(addr).toLowerCase() : "");

export const isBoostPair = (token0, token1) => {
  const a = normalizeAddress(token0);
  const b = normalizeAddress(token1);
  if (!a || !b) return false;
  const crx = normalizeAddress(CRX_ADDRESS);
  const usdm = normalizeAddress(USDM_ADDRESS);
  const weth = normalizeAddress(WETH_ADDRESS);
  if (!crx || (!usdm && !weth)) return false;
  const hasCrx = a === crx || b === crx;
  const hasWeth = weth && (a === weth || b === weth);
  const hasUsdm = usdm && (a === usdm || b === usdm);
  return hasCrx && (hasWeth || hasUsdm);
};

export const getMultiplierTier = (ageSeconds, tiers = MULTIPLIER_TIERS) => {
  const safeAge = Number.isFinite(ageSeconds) && ageSeconds > 0 ? ageSeconds : 0;
  const ordered = [...(tiers || [])].sort(
    (a, b) => Number(a.minSeconds || 0) - Number(b.minSeconds || 0)
  );
  if (!ordered.length) {
    return {
      multiplier: 1,
      tier: null,
      nextTier: null,
      progressPct: 0,
      secondsToNext: null,
    };
  }
  let current = ordered[0];
  let next = null;
  for (let i = 0; i < ordered.length; i += 1) {
    const tier = ordered[i];
    if (safeAge >= (tier.minSeconds || 0)) {
      current = tier;
      next = ordered[i + 1] || null;
    } else {
      next = tier;
      break;
    }
  }
  if (!current) current = ordered[0];
  const currentMin = Number(current.minSeconds || 0);
  const nextMin = next ? Number(next.minSeconds || 0) : null;
  const progressPct = nextMin && nextMin > currentMin
    ? Math.max(0, Math.min(1, (safeAge - currentMin) / (nextMin - currentMin)))
    : 1;
  const secondsToNext = nextMin && nextMin > safeAge ? nextMin - safeAge : null;
  return {
    multiplier: Number(current.multiplier || 1),
    tier: current,
    nextTier: next,
    progressPct,
    secondsToNext,
  };
};

const toNumberSafe = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const computeBoostedCap = (lpUsd, boostMultiplier = BOOST_CAP_MULTIPLIER) => {
  const lp = toNumberSafe(lpUsd);
  if (lp === null || lp <= 0) return 0;
  const mult = Number.isFinite(boostMultiplier) ? boostMultiplier : BOOST_CAP_MULTIPLIER;
  return lp * mult;
};

export const computePoints = ({
  volumeUsd,
  lpUsd,
  multiplier,
  inRangeFactor = 1,
  boostMultiplier = BOOST_CAP_MULTIPLIER,
}) => {
  const volume = toNumberSafe(volumeUsd) ?? 0;
  const cap = toNumberSafe(lpUsd) !== null ? computeBoostedCap(lpUsd, boostMultiplier) : null;
  const baseMultiplier = Number.isFinite(multiplier) ? Number(multiplier) : 1;
  const rangeFactor = Number.isFinite(inRangeFactor) ? inRangeFactor : 1;
  const effectiveMultiplier =
    baseMultiplier > 1 ? 1 + (baseMultiplier - 1) * rangeFactor : 1;
  const eligibleVolume = cap !== null ? Math.min(volume, cap) : 0;
  const bonusPoints =
    baseMultiplier > 1 && cap !== null
      ? eligibleVolume * (effectiveMultiplier - 1)
      : 0;
  return {
    basePoints: volume,
    bonusPoints,
    totalPoints: volume + bonusPoints,
    boostedVolumeCap: cap,
    boostedVolumeUsd: eligibleVolume,
    effectiveMultiplier,
  };
};

export const resolveInRangeFactor = ({ hasRangeData, hasInRange }) => {
  if (!hasRangeData) return 1;
  return hasInRange ? 1 : OUT_OF_RANGE_FACTOR;
};
