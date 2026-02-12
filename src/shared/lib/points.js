// src/shared/lib/points.js
import { CRX_ADDRESS, USDM_ADDRESS, WETH_ADDRESS } from "../config/addresses";

const normalizeAddress = (addr) => (addr ? String(addr).toLowerCase() : "");

const toNumberSafe = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

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

export const getBoostPairType = (token0, token1) => {
  const a = normalizeAddress(token0);
  const b = normalizeAddress(token1);
  const crx = normalizeAddress(CRX_ADDRESS);
  const usdm = normalizeAddress(USDM_ADDRESS);
  const weth = normalizeAddress(WETH_ADDRESS);
  const hasCrx = a === crx || b === crx;
  if (!hasCrx) return null;
  if (usdm && (a === usdm || b === usdm)) return "CRX/USDM";
  if (weth && (a === weth || b === weth)) return "CRX/ETH";
  return null;
};

export const getBoostPairMultiplier = (token0, token1) => {
  const type = getBoostPairType(token0, token1);
  if (type === "CRX/USDM") return 3;
  if (type === "CRX/ETH") return 2;
  return 1;
};

export const computePoints = ({
  volumeUsd,
  lpUsdTotal = null,
  lpUsdCrxEth = 0,
  lpUsdCrxUsdm = 0,
  boostEnabled = true,
}) => {
  const volume = toNumberSafe(volumeUsd) ?? 0;
  const lpEth = Math.max(0, toNumberSafe(lpUsdCrxEth) ?? 0);
  const lpUsdm = Math.max(0, toNumberSafe(lpUsdCrxUsdm) ?? 0);
  const lpPoints = boostEnabled !== false ? lpEth * 2 + lpUsdm * 3 : 0;
  const normalizedTotalLpUsd = toNumberSafe(lpUsdTotal);
  const totalLpUsd =
    normalizedTotalLpUsd !== null
      ? Math.max(0, normalizedTotalLpUsd)
      : lpEth + lpUsdm;
  const effectiveMultiplier =
    boostEnabled !== false
      ? lpUsdm > 0
        ? 3
        : lpEth > 0
          ? 2
          : 1
      : 1;

  return {
    basePoints: volume,
    bonusPoints: lpPoints,
    totalPoints: volume + lpPoints,
    boostedVolumeCap: 0,
    boostedVolumeUsd: 0,
    lpPoints,
    lpUsd: totalLpUsd,
    lpUsdCrxEth: lpEth,
    lpUsdCrxUsdm: lpUsdm,
    effectiveMultiplier,
  };
};
