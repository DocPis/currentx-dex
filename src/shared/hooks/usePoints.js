// src/shared/hooks/usePoints.js
import { useQuery } from "@tanstack/react-query";
import { Contract, formatUnits } from "ethers";
import { TOKENS } from "../config/tokens";
import {
  UNIV3_FACTORY_ADDRESS,
  UNIV3_POSITION_MANAGER_ADDRESS,
  WETH_ADDRESS,
  USDM_ADDRESS,
  CRX_ADDRESS,
} from "../config/addresses";
import {
  UNIV3_FACTORY_ABI,
  UNIV3_POOL_ABI,
  UNIV3_POSITION_MANAGER_ABI,
} from "../config/abis";
import {
  fetchTokenPrices,
  fetchUserSwapVolume,
  fetchV3PositionsCreatedAt,
} from "../config/subgraph";
import { getReadOnlyProvider } from "../config/web3";
import {
  SEASON_ID,
  SEASON_START_MS,
  SEASON_END_MS,
  SEASON_ONGOING,
} from "../config/points";
import {
  computePoints,
  getMultiplierTier,
  isBoostPair,
  resolveInRangeFactor,
} from "../lib/points";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const Q96 = 2n ** 96n;

const normalizeAddress = (value) => (value ? String(value).toLowerCase() : "");

const buildDecimalsMap = () => {
  const map = {};
  Object.values(TOKENS || {}).forEach((token) => {
    if (!token?.address) return;
    map[String(token.address).toLowerCase()] = token.decimals ?? 18;
  });
  if (WETH_ADDRESS) map[String(WETH_ADDRESS).toLowerCase()] = 18;
  if (USDM_ADDRESS) map[String(USDM_ADDRESS).toLowerCase()] = 18;
  if (CRX_ADDRESS) map[String(CRX_ADDRESS).toLowerCase()] = 18;
  return map;
};

const DECIMALS_BY_ADDRESS = buildDecimalsMap();

const tickToSqrtPriceX96 = (tick) => {
  if (!Number.isFinite(tick)) return null;
  const ratio = Math.pow(1.0001, Number(tick));
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const sqrt = Math.sqrt(ratio);
  if (!Number.isFinite(sqrt) || sqrt <= 0) return null;
  const scaled = sqrt * Number(Q96);
  if (!Number.isFinite(scaled) || scaled <= 0) return null;
  return BigInt(Math.floor(scaled));
};

const getAmountsForLiquidity = (sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, liquidity) => {
  if (
    !sqrtPriceX96 ||
    !sqrtPriceAX96 ||
    !sqrtPriceBX96 ||
    !liquidity ||
    liquidity <= 0n
  ) {
    return null;
  }
  let sqrtA = sqrtPriceAX96;
  let sqrtB = sqrtPriceBX96;
  if (sqrtA > sqrtB) {
    [sqrtA, sqrtB] = [sqrtB, sqrtA];
  }
  if (sqrtPriceX96 <= sqrtA) {
    const amount0 = (liquidity * (sqrtB - sqrtA) * Q96) / (sqrtB * sqrtA);
    return { amount0, amount1: 0n };
  }
  if (sqrtPriceX96 < sqrtB) {
    const amount0 = (liquidity * (sqrtB - sqrtPriceX96) * Q96) / (sqrtB * sqrtPriceX96);
    const amount1 = (liquidity * (sqrtPriceX96 - sqrtA)) / Q96;
    return { amount0, amount1 };
  }
  const amount1 = (liquidity * (sqrtB - sqrtA)) / Q96;
  return { amount0: 0n, amount1 };
};

const fetchBoostPositions = async (address) => {
  if (!address || !UNIV3_POSITION_MANAGER_ADDRESS || !UNIV3_FACTORY_ADDRESS) {
    return {
      positions: [],
      positionIds: [],
      lpUsd: 0,
      lpInRangePct: 0,
      hasInRange: false,
      hasRangeData: false,
      pricesAvailable: true,
    };
  }

  const provider = getReadOnlyProvider(false, true);
  const manager = new Contract(
    UNIV3_POSITION_MANAGER_ADDRESS,
    UNIV3_POSITION_MANAGER_ABI,
    provider
  );

  const balanceRaw = await manager.balanceOf(address);
  const count = Math.min(Number(balanceRaw || 0), 50);
  if (!count) {
    return {
      positions: [],
      positionIds: [],
      lpUsd: 0,
      lpInRangePct: 0,
      hasInRange: false,
      hasRangeData: false,
      pricesAvailable: true,
    };
  }

  const ids = await Promise.all(
    Array.from({ length: count }, (_, idx) =>
      manager.tokenOfOwnerByIndex(address, idx)
    )
  );
  const positionsRaw = await Promise.all(ids.map((id) => manager.positions(id)));
  const positions = positionsRaw.map((pos, idx) => ({
    tokenId: ids[idx]?.toString?.() || String(ids[idx]),
    token0: pos?.token0,
    token1: pos?.token1,
    fee: Number(pos?.fee ?? 0),
    tickLower: Number(pos?.tickLower ?? 0),
    tickUpper: Number(pos?.tickUpper ?? 0),
    liquidity: pos?.liquidity ?? 0n,
  }));

  const active = positions.filter(
    (pos) => (pos?.liquidity ?? 0n) > 0n && isBoostPair(pos.token0, pos.token1)
  );

  if (!active.length) {
    return {
      positions: [],
      positionIds: [],
      lpUsd: 0,
      lpInRangePct: 0,
      hasInRange: false,
      hasRangeData: false,
      pricesAvailable: true,
    };
  }

  const factory = new Contract(
    UNIV3_FACTORY_ADDRESS,
    UNIV3_FACTORY_ABI,
    provider
  );

  const poolState = new Map();
  const uniquePools = new Map();
  active.forEach((pos) => {
    const key = `${normalizeAddress(pos.token0)}:${normalizeAddress(pos.token1)}:${pos.fee}`;
    if (!uniquePools.has(key)) uniquePools.set(key, pos);
  });

  await Promise.all(
    Array.from(uniquePools.values()).map(async (pos) => {
      let poolAddress = await factory.getPool(pos.token0, pos.token1, pos.fee);
      if (!poolAddress || poolAddress === ZERO_ADDRESS) {
        poolAddress = await factory.getPool(pos.token1, pos.token0, pos.fee);
      }
      if (!poolAddress || poolAddress === ZERO_ADDRESS) return;
      try {
        const pool = new Contract(poolAddress, UNIV3_POOL_ABI, provider);
        const slot0 = await pool.slot0();
        if (!slot0?.sqrtPriceX96) return;
        poolState.set(
          `${normalizeAddress(pos.token0)}:${normalizeAddress(pos.token1)}:${pos.fee}`,
          {
            address: poolAddress,
            sqrtPriceX96: slot0.sqrtPriceX96,
            tick: Number(slot0.tick ?? 0),
          }
        );
      } catch {
        // ignore pool read errors
      }
    })
  );

  const tokenAddresses = Array.from(
    new Set(
      active
        .flatMap((pos) => [pos.token0, pos.token1])
        .filter(Boolean)
        .map((addr) => String(addr).toLowerCase())
    )
  );

  let priceMap = {};
  try {
    priceMap = await fetchTokenPrices(tokenAddresses);
  } catch {
    priceMap = {};
  }
  if (USDM_ADDRESS) {
    priceMap[String(USDM_ADDRESS).toLowerCase()] = 1;
  }

  let lpUsd = 0;
  let lpInRangeUsd = 0;
  let hasInRange = false;
  let hasRangeData = false;
  let pricedPositions = 0;
  let missingPrice = false;

  const enriched = active.map((pos) => {
    const key = `${normalizeAddress(pos.token0)}:${normalizeAddress(pos.token1)}:${pos.fee}`;
    const pool = poolState.get(key);
    const sqrtPriceAX96 = tickToSqrtPriceX96(pos.tickLower);
    const sqrtPriceBX96 = tickToSqrtPriceX96(pos.tickUpper);
    const amounts = pool
      ? getAmountsForLiquidity(
          pool.sqrtPriceX96,
          sqrtPriceAX96,
          sqrtPriceBX96,
          pos.liquidity
        )
      : null;
    const hasAmounts = Boolean(amounts);

    const dec0 = DECIMALS_BY_ADDRESS[normalizeAddress(pos.token0)] ?? 18;
    const dec1 = DECIMALS_BY_ADDRESS[normalizeAddress(pos.token1)] ?? 18;
    const amount0 = hasAmounts && amounts?.amount0
      ? Number(formatUnits(amounts.amount0, dec0))
      : 0;
    const amount1 = hasAmounts && amounts?.amount1
      ? Number(formatUnits(amounts.amount1, dec1))
      : 0;

    const price0 = priceMap[normalizeAddress(pos.token0)];
    const price1 = priceMap[normalizeAddress(pos.token1)];
    const hasPrices = Number.isFinite(price0) && Number.isFinite(price1);
    const positionUsd =
      hasAmounts && hasPrices ? amount0 * price0 + amount1 * price1 : null;

    const inRange = pool
      ? pool.tick >= pos.tickLower && pool.tick < pos.tickUpper
      : null;

    if (positionUsd !== null && Number.isFinite(positionUsd)) {
      lpUsd += positionUsd;
      pricedPositions += 1;
      if (inRange) {
        lpInRangeUsd += positionUsd;
        hasInRange = true;
      }
    } else if (!hasPrices || !hasAmounts) {
      missingPrice = true;
    }

    if (inRange !== null) hasRangeData = true;

    return {
      ...pos,
      poolAddress: pool?.address || null,
      inRange,
      positionUsd,
    };
  });

  if (!pricedPositions && missingPrice) {
    lpUsd = null;
  }

  const lpInRangePct =
    lpUsd && lpUsd > 0 ? Math.min(1, lpInRangeUsd / lpUsd) : 0;

  return {
    positions: enriched,
    positionIds: enriched.map((pos) => pos.tokenId).filter(Boolean),
    lpUsd,
    lpInRangePct,
    hasInRange,
    hasRangeData,
    pricesAvailable: !missingPrice,
  };
};

const fetchLpAgeSeconds = async (positionIds) => {
  if (!positionIds?.length) return null;
  const createdMap = await fetchV3PositionsCreatedAt(positionIds);
  const timestamps = Object.values(createdMap).filter(Boolean);
  if (!timestamps.length) return null;
  const earliest = Math.min(...timestamps);
  if (!Number.isFinite(earliest) || earliest <= 0) return null;
  const diffMs = Date.now() - earliest;
  return diffMs > 0 ? Math.floor(diffMs / 1000) : 0;
};

export const getUserPointsQueryKey = (address) => [
  "points",
  SEASON_ID,
  "user",
  normalizeAddress(address),
];

export const getLeaderboardQueryKey = (seasonId, page = 0) => [
  "points",
  seasonId || SEASON_ID,
  "leaderboard",
  page,
];

export const useUserPoints = (address) => {
  return useQuery({
    queryKey: getUserPointsQueryKey(address),
    enabled: Boolean(address),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const seasonStart = SEASON_START_MS;
      const seasonEnd = SEASON_END_MS || Date.now();
      const normalized = (address || "").toLowerCase();

      const toNumber = (value) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
      };
      const toBool = (value) => {
        if (value === true || value === "1" || value === 1) return true;
        if (value === false || value === "0" || value === 0) return false;
        return Boolean(value);
      };

      try {
        const params = new URLSearchParams();
        params.set("address", normalized);
        params.set("seasonId", SEASON_ID);
        const res = await fetch(`/api/points/user?${params.toString()}`);
        if (res.ok) {
          const payload = await res.json();
          const user = payload?.user || {};
          const volumeUsd = toNumber(user.volumeUsd) ?? 0;
          const points = toNumber(user.points) ?? volumeUsd;
          const basePoints = toNumber(user.basePoints) ?? volumeUsd;
          const bonusPoints =
            toNumber(user.bonusPoints) ?? Math.max(0, points - basePoints);
          const lpAgeSeconds = toNumber(user.lpAgeSeconds);
          const tierInfo =
            Number.isFinite(lpAgeSeconds) ? getMultiplierTier(lpAgeSeconds) : null;

          return {
            seasonId: SEASON_ID,
            seasonStart,
            seasonEnd,
            seasonOngoing: SEASON_ONGOING,
            points,
            basePoints,
            bonusPoints,
            rank: toNumber(user.rank),
            volumeUsd,
            boostedVolumeUsd: toNumber(user.boostedVolumeUsd) ?? 0,
            boostedVolumeCap: toNumber(user.boostedVolumeCap) ?? 0,
            multiplier: toNumber(user.multiplier) ?? 1,
            baseMultiplier: toNumber(user.baseMultiplier) ?? 1,
            lpUsd: toNumber(user.lpUsd) ?? 0,
            lpInRangePct: toNumber(user.lpInRangePct) ?? 0,
            hasBoostLp: toBool(user.hasBoostLp),
            lpAgeSeconds,
            lpAgeAvailable: Number.isFinite(lpAgeSeconds),
            tier: tierInfo,
            inRangeFactor: toNumber(user.inRangeFactor) ?? 1,
            hasRangeData: toBool(user.hasRangeData),
            hasInRange: toBool(user.hasInRange),
            pricesAvailable: true,
            source: "backend",
          };
        }
      } catch {
        // fall back to client computed
      }

      let volumeV2 = 0;
      let volumeV3 = 0;
      try {
        volumeV2 = await fetchUserSwapVolume({
          address,
          startTime: seasonStart,
          endTime: seasonEnd,
          source: "v2",
        });
      } catch {
        volumeV2 = 0;
      }
      try {
        volumeV3 = await fetchUserSwapVolume({
          address,
          startTime: seasonStart,
          endTime: seasonEnd,
          source: "v3",
        });
      } catch {
        volumeV3 = 0;
      }

      let lpData = null;
      try {
        lpData = await fetchBoostPositions(address);
      } catch {
        lpData = {
          positions: [],
          positionIds: [],
          lpUsd: 0,
          lpInRangePct: 0,
          hasInRange: false,
          hasRangeData: false,
          pricesAvailable: true,
        };
      }

      let lpAgeSeconds = null;
      try {
        lpAgeSeconds = await fetchLpAgeSeconds(lpData.positionIds);
      } catch {
        lpAgeSeconds = null;
      }

      const hasBoostLp = lpData.positions.length > 0;
      const hasAge = Number.isFinite(lpAgeSeconds);
      const tierInfo = hasAge ? getMultiplierTier(lpAgeSeconds) : null;
      const baseMultiplier = hasBoostLp && hasAge ? tierInfo.multiplier : 1;
      const inRangeFactor = hasBoostLp
        ? resolveInRangeFactor({
            hasRangeData: lpData.hasRangeData,
            hasInRange: lpData.hasInRange,
          })
        : 1;

      const pointsBreakdown = computePoints({
        volumeUsd: volumeV2 + volumeV3,
        lpUsd: lpData.lpUsd,
        multiplier: baseMultiplier,
        inRangeFactor,
      });

      return {
        seasonId: SEASON_ID,
        seasonStart,
        seasonEnd,
        seasonOngoing: SEASON_ONGOING,
        points: pointsBreakdown.totalPoints,
        basePoints: pointsBreakdown.basePoints,
        bonusPoints: pointsBreakdown.bonusPoints,
        rank: null,
        volumeUsd: volumeV2 + volumeV3,
        boostedVolumeUsd: pointsBreakdown.boostedVolumeUsd,
        boostedVolumeCap: pointsBreakdown.boostedVolumeCap,
        multiplier: pointsBreakdown.effectiveMultiplier,
        baseMultiplier,
        lpUsd: lpData.lpUsd,
        lpInRangePct: lpData.lpInRangePct,
        hasBoostLp,
        lpAgeSeconds,
        lpAgeAvailable: hasAge,
        tier: tierInfo,
        inRangeFactor,
        hasRangeData: lpData.hasRangeData,
        hasInRange: lpData.hasInRange,
        pricesAvailable: lpData.pricesAvailable,
      };
    },
  });
};

export const useLeaderboard = (seasonId, page = 0, enabled = true) => {
  const query = useQuery({
    queryKey: getLeaderboardQueryKey(seasonId, page),
    enabled: Boolean(enabled),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (seasonId) params.set("seasonId", seasonId);
      if (page) params.set("page", String(page));
      const res = await fetch(`/api/points/leaderboard?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Leaderboard unavailable");
      }
      const data = await res.json();
      return {
        items: Array.isArray(data?.leaderboard) ? data.leaderboard : [],
        updatedAt: data?.updatedAt || null,
      };
    },
    staleTime: 60 * 1000,
    retry: 1,
  });

  const items = query.data?.items || [];
  const available = query.isSuccess && items.length > 0;

  return {
    ...query,
    data: items,
    available,
  };
};
