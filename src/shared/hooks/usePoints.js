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
  getBoostPairMultiplier,
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
      lpUsdCrxEth: 0,
      lpUsdCrxUsdm: 0,
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
  const count = Math.max(0, Math.trunc(Number(balanceRaw || 0)));
  if (!count) {
    return {
      positions: [],
      positionIds: [],
      lpUsd: 0,
      lpUsdCrxEth: 0,
      lpUsdCrxUsdm: 0,
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

  const active = positions.filter((pos) => (pos?.liquidity ?? 0n) > 0n);

  if (!active.length) {
    return {
      positions: [],
      positionIds: [],
      lpUsd: 0,
      lpUsdCrxEth: 0,
      lpUsdCrxUsdm: 0,
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
  let lpUsdCrxEth = 0;
  let lpUsdCrxUsdm = 0;
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

    if (positionUsd !== null && Number.isFinite(positionUsd)) {
      lpUsd += positionUsd;
      const pairMultiplier = getBoostPairMultiplier(pos.token0, pos.token1);
      if (pairMultiplier >= 3) lpUsdCrxUsdm += positionUsd;
      else if (pairMultiplier >= 2) lpUsdCrxEth += positionUsd;
      pricedPositions += 1;
    } else if (!hasPrices || !hasAmounts) {
      missingPrice = true;
    }

    return {
      ...pos,
      poolAddress: pool?.address || null,
      positionUsd,
    };
  });

  if (!pricedPositions && missingPrice) {
    lpUsd = null;
  }

  return {
    positions: enriched,
    positionIds: enriched.map((pos) => pos.tokenId).filter(Boolean),
    lpUsd,
    lpUsdCrxEth: lpUsdCrxEth || 0,
    lpUsdCrxUsdm: lpUsdCrxUsdm || 0,
    lpInRangePct: 0,
    hasInRange: false,
    hasRangeData: false,
    pricesAvailable: !missingPrice,
  };
};

export const getUserPointsQueryKey = (address) => [
  "points",
  SEASON_ID || "unconfigured",
  "user",
  normalizeAddress(address),
];

export const getLeaderboardQueryKey = (seasonId, page = 0) => [
  "points",
  seasonId || SEASON_ID || "unconfigured",
  "leaderboard",
  page,
];

export const getWhitelistRewardsQueryKey = (address) => [
  "whitelist-rewards",
  SEASON_ID || "unconfigured",
  normalizeAddress(address),
];

export const useUserPoints = (address) => {
  return useQuery({
    queryKey: getUserPointsQueryKey(address),
    enabled: Boolean(address),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const nowMs = Date.now();
      const hasFrontendSeasonConfig =
        Boolean(SEASON_ID) && Number.isFinite(SEASON_START_MS);
      const frontendSeasonStart = Number.isFinite(SEASON_START_MS)
        ? SEASON_START_MS
        : null;
      const frontendSeasonEnd = Number.isFinite(SEASON_END_MS) ? SEASON_END_MS : null;
      const frontendSeasonHasStarted = Number.isFinite(frontendSeasonStart)
        ? nowMs >= frontendSeasonStart
        : true;
      const normalized = (address || "").toLowerCase();

      const toNumber = (value, fallback = null) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
      };
      const toOptionalNumber = (value, fallback = null) => {
        if (value === null || value === undefined || value === "") return fallback;
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
      };
      const toBool = (value) => {
        if (value === true || value === "1" || value === 1) return true;
        if (value === false || value === "0" || value === 0) return false;
        return Boolean(value);
      };

      try {
        const fetchBackendPayload = async (seasonId) => {
          const params = new URLSearchParams();
          params.set("address", normalized);
          if (seasonId) params.set("seasonId", seasonId);
          const res = await fetch(`/api/points/user?${params.toString()}`, {
            cache: "no-store",
          });
          if (!res.ok) return null;
          return res.json();
        };

        let payload = await fetchBackendPayload(SEASON_ID);
        if (payload?.exists === false && SEASON_ID) {
          // Season mismatch safety: retry without forcing seasonId.
          const fallbackPayload = await fetchBackendPayload("");
          if (fallbackPayload?.exists) {
            payload = fallbackPayload;
          }
        }

        if (payload) {
          const seasonStartResolved = toOptionalNumber(
            payload?.seasonStart,
            frontendSeasonStart
          );
          const seasonEndResolved = toOptionalNumber(payload?.seasonEnd, frontendSeasonEnd);
          const seasonHasStartedResolved = Number.isFinite(seasonStartResolved)
            ? nowMs >= seasonStartResolved
            : frontendSeasonHasStarted;
          const seasonOngoingResolved =
            typeof payload?.seasonOngoing === "boolean"
              ? payload.seasonOngoing
              : Number.isFinite(seasonStartResolved)
              ? !Number.isFinite(seasonEndResolved) || nowMs < seasonEndResolved
              : false;
          const user = payload?.user || {};
          const seasonReward = user?.seasonReward || {};
          const volumeUsd = toNumber(user.volumeUsd) ?? 0;
          const points = toNumber(user.points) ?? volumeUsd;
          const basePoints = toNumber(user.basePoints) ?? volumeUsd;
          const bonusPoints =
            toNumber(user.bonusPoints) ?? Math.max(0, points - basePoints);
          const lpUsdCrxEth = toNumber(user.lpUsdCrxEth) ?? 0;
          const lpUsdCrxUsdm = toNumber(user.lpUsdCrxUsdm) ?? 0;
          const lpPoints = toNumber(user.lpPoints) ?? 0;
          const multiplierRaw = toNumber(user.multiplier) ?? 1;
          const multiplier = seasonHasStartedResolved ? multiplierRaw : 1;
          const hasBoostLp = toBool(user.hasBoostLp);

          return {
            seasonId: payload?.seasonId || SEASON_ID || "",
            seasonStart: seasonStartResolved,
            seasonEnd: seasonEndResolved,
            seasonOngoing: seasonOngoingResolved,
            points,
            basePoints,
            bonusPoints,
            rank: toNumber(user.rank),
            volumeUsd,
            boostedVolumeUsd: 0,
            boostedVolumeCap: 0,
            multiplier,
            baseMultiplier: multiplier,
            lpUsd: toNumber(user.lpUsd) ?? 0,
            lpUsdCrxEth,
            lpUsdCrxUsdm,
            lpPoints,
            lpInRangePct: 0,
            hasBoostLp,
            lpAgeSeconds: null,
            lpAgeAvailable: false,
            tier: null,
            inRangeFactor: 1,
            hasRangeData: false,
            hasInRange: hasBoostLp,
            pricesAvailable: true,
            seasonReward: {
              totalPointsSeason: toNumber(seasonReward.totalPointsSeason),
              seasonAllocationCrx: toNumber(seasonReward.seasonAllocationCrx),
              sharePct: toNumber(seasonReward.sharePct),
              rewardCrx: toNumber(seasonReward.rewardCrx),
              rewardSnapshotCrx: toNumber(seasonReward.rewardSnapshotCrx),
              claimCount: toNumber(seasonReward.claimCount, 0),
              lastClaimAt: toNumber(seasonReward.lastClaimAt, null),
              claimOpen: toBool(seasonReward.claimOpen),
              claimOpensAt: toNumber(seasonReward.claimOpensAt, null),
              claimableNowCrx: toNumber(seasonReward.claimableNowCrx, 0),
              immediatePct: toNumber(seasonReward.immediatePct, 1),
              streamDays: toNumber(seasonReward.streamDays, 0),
              streamStartAt: toNumber(seasonReward.streamStartAt, null),
              streamEndsAt: toNumber(seasonReward.streamEndsAt, null),
              streamProgress: toNumber(seasonReward.streamProgress, 0),
              immediateTotalCrx: toNumber(seasonReward.immediateTotalCrx, 0),
              streamedTotalCrx: toNumber(seasonReward.streamedTotalCrx, 0),
              immediateRemainingCrx: toNumber(
                seasonReward.immediateRemainingCrx,
                0
              ),
              streamedRemainingCrx: toNumber(
                seasonReward.streamedRemainingCrx,
                0
              ),
              totalClaimedCrx: toNumber(seasonReward.totalClaimedCrx, 0),
            },
            source: "backend",
          };
        }
      } catch {
        // fall back to client computed
      }

      if (!hasFrontendSeasonConfig) {
        return {
          seasonId: SEASON_ID || "",
          seasonStart: frontendSeasonStart,
          seasonEnd: frontendSeasonEnd,
          seasonOngoing: false,
          points: 0,
          basePoints: 0,
          bonusPoints: 0,
          rank: null,
          volumeUsd: 0,
          boostedVolumeUsd: 0,
          boostedVolumeCap: 0,
          multiplier: 1,
          baseMultiplier: 1,
          lpUsd: 0,
          lpUsdCrxEth: 0,
          lpUsdCrxUsdm: 0,
          lpPoints: 0,
          lpInRangePct: 0,
          hasBoostLp: false,
          lpAgeSeconds: null,
          lpAgeAvailable: false,
          tier: null,
          inRangeFactor: 1,
          hasRangeData: false,
          hasInRange: false,
          pricesAvailable: true,
          seasonReward: null,
          source: "unconfigured",
        };
      }

      let volumeV2 = 0;
      let volumeV3 = 0;
      try {
        volumeV2 = await fetchUserSwapVolume({
          address,
          startTime: SEASON_START_MS,
          endTime: Number.isFinite(SEASON_END_MS) ? SEASON_END_MS : nowMs,
          source: "v2",
        });
      } catch {
        volumeV2 = 0;
      }
      try {
        volumeV3 = await fetchUserSwapVolume({
          address,
          startTime: SEASON_START_MS,
          endTime: Number.isFinite(SEASON_END_MS) ? SEASON_END_MS : nowMs,
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
          lpUsdCrxEth: 0,
          lpUsdCrxUsdm: 0,
          lpInRangePct: 0,
          hasInRange: false,
          hasRangeData: false,
          pricesAvailable: true,
        };
      }

      const hasBoostLp =
        Number(lpData.lpUsdCrxEth || 0) > 0 ||
        Number(lpData.lpUsdCrxUsdm || 0) > 0;

      const pointsBreakdown = computePoints({
        volumeUsd: volumeV2 + volumeV3,
        lpUsdTotal: lpData.lpUsd,
        lpUsdCrxEth: lpData.lpUsdCrxEth,
        lpUsdCrxUsdm: lpData.lpUsdCrxUsdm,
        boostEnabled: frontendSeasonHasStarted,
      });

      return {
        seasonId: SEASON_ID,
        seasonStart: frontendSeasonStart,
        seasonEnd: frontendSeasonEnd,
        seasonOngoing: frontendSeasonStart ? SEASON_ONGOING : false,
        points: pointsBreakdown.totalPoints,
        basePoints: pointsBreakdown.basePoints,
        bonusPoints: pointsBreakdown.bonusPoints,
        rank: null,
        volumeUsd: volumeV2 + volumeV3,
        boostedVolumeUsd: pointsBreakdown.boostedVolumeUsd,
        boostedVolumeCap: pointsBreakdown.boostedVolumeCap,
        multiplier: pointsBreakdown.effectiveMultiplier,
        baseMultiplier: pointsBreakdown.effectiveMultiplier,
        lpUsd: pointsBreakdown.lpUsd,
        lpUsdCrxEth: pointsBreakdown.lpUsdCrxEth,
        lpUsdCrxUsdm: pointsBreakdown.lpUsdCrxUsdm,
        lpPoints: pointsBreakdown.lpPoints,
        lpInRangePct: 0,
        hasBoostLp,
        lpAgeSeconds: null,
        lpAgeAvailable: false,
        tier: null,
        inRangeFactor: 1,
        hasRangeData: false,
        hasInRange: hasBoostLp,
        pricesAvailable: lpData.pricesAvailable,
        seasonReward: null,
      };
    },
  });
};

export const useLeaderboard = (seasonId, page = 0, enabled = true) => {
  const query = useQuery({
    queryKey: getLeaderboardQueryKey(seasonId, page),
    enabled: Boolean(enabled),
    queryFn: async () => {
      const activeSeasonId = seasonId || SEASON_ID;
      const toNumber = (value, fallback = null) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
      };
      const fetchLeaderboardPayload = async (seasonOverride) => {
        const params = new URLSearchParams();
        if (seasonOverride) params.set("seasonId", seasonOverride);
        if (page) params.set("page", String(page));
        const suffix = params.toString();
        const res = await fetch(`/api/points/leaderboard${suffix ? `?${suffix}` : ""}`, {
          cache: "no-store",
        });
        const raw = await res.text().catch(() => "");
        let payload = {};
        try {
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          payload = {};
        }
        if (!res.ok) {
          const detailRaw = String(payload?.error || raw || "").trim();
          const detail = detailRaw.replace(/\s+/g, " ").slice(0, 220);
          throw new Error(
            detail
              ? `Leaderboard API ${res.status}: ${detail}`
              : `Leaderboard API ${res.status}`
          );
        }
        return {
          seasonId: payload?.seasonId || seasonOverride || "",
          seasonStart: toNumber(payload?.seasonStart, null),
          seasonEnd: toNumber(payload?.seasonEnd, null),
          seasonOngoing:
            typeof payload?.seasonOngoing === "boolean"
              ? payload.seasonOngoing
              : null,
          items: Array.isArray(payload?.leaderboard) ? payload.leaderboard : [],
          updatedAt: payload?.updatedAt || null,
          summary: payload?.summary || null,
        };
      };

      let payload = null;
      let primaryError = null;
      try {
        payload = await fetchLeaderboardPayload(activeSeasonId);
      } catch (err) {
        primaryError = err;
      }

      if (!payload && activeSeasonId) {
        payload = await fetchLeaderboardPayload("");
      }
      if (!payload) {
        throw primaryError || new Error("Leaderboard unavailable");
      }

      const hasLikelySeasonMismatch =
        Boolean(activeSeasonId) &&
        !payload.items.length &&
        !payload.updatedAt &&
        Number(payload?.summary?.walletCount || 0) <= 0;
      if (hasLikelySeasonMismatch) {
        const fallbackPayload = await fetchLeaderboardPayload("");
        if (fallbackPayload.items.length > 0) {
          payload = fallbackPayload;
        }
      }

      return payload;
    },
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const items = query.data?.items || [];
  const available = query.isSuccess && items.length > 0;

  return {
    ...query,
    data: items,
    seasonId: query.data?.seasonId || seasonId || SEASON_ID || "",
    summary: query.data?.summary || null,
    updatedAt: query.data?.updatedAt || null,
    seasonStart: query.data?.seasonStart ?? null,
    seasonEnd: query.data?.seasonEnd ?? null,
    seasonOngoing:
      typeof query.data?.seasonOngoing === "boolean"
        ? query.data.seasonOngoing
        : null,
    available,
  };
};

export const useWhitelistRewards = (address) => {
  return useQuery({
    queryKey: getWhitelistRewardsQueryKey(address),
    enabled: Boolean(address),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: true,
    retry: 1,
    queryFn: async () => {
      const normalized = normalizeAddress(address);
      const toNumber = (value, fallback = 0) => {
        if (value === null || value === undefined || value === "") return fallback;
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
      };
      const toBool = (value) =>
        value === true ||
        value === 1 ||
        value === "1" ||
        value === "true" ||
        value === "TRUE";

      const params = new URLSearchParams();
      params.set("address", normalized);
      if (SEASON_ID) params.set("seasonId", SEASON_ID);
      const res = await fetch(`/api/whitelist-rewards/user?${params.toString()}`);
      if (res.status === 404) {
        return {
          available: false,
          whitelisted: false,
          pending: false,
        };
      }
      if (!res.ok) {
        throw new Error("Whitelist rewards unavailable");
      }
      const payload = await res.json();
      const user = payload?.user || {};
      return {
        available: true,
        whitelisted: toBool(user.whitelisted),
        pending: toBool(user.pending),
        claimOpen: toBool(user.claimOpen),
        activationQualified: toBool(user.activationQualified),
        hasSwap: toBool(user.hasSwap),
        metVolumeThreshold: toBool(user.metVolumeThreshold),
        metMicroLp: toBool(user.metMicroLp),
        address: normalizeAddress(user.address || normalized),
        whitelistedAt: toNumber(user.whitelistedAt, null),
        activationWindowDays: toNumber(user.activationWindowDays, 0),
        windowEndsAt: toNumber(user.windowEndsAt, null),
        withinWindow: toBool(user.withinWindow),
        activatedAt: toNumber(user.activatedAt, null),
        volumeUsd: toNumber(user.volumeUsd, 0),
        lpUsd: toNumber(user.lpUsd, 0),
        volumeThresholdUsd: toNumber(user.volumeThresholdUsd, 0),
        microLpUsd: toNumber(user.microLpUsd, 0),
        baseRewardCrx: toNumber(user.baseRewardCrx, 0),
        activationBonusCrx: toNumber(user.activationBonusCrx, 0),
        totalRewardCrx: toNumber(user.totalRewardCrx, 0),
        immediateClaimableCrx: toNumber(user.immediateClaimableCrx, 0),
        streamedCrx: toNumber(user.streamedCrx, 0),
        immediatePct: toNumber(user.immediatePct, 0.3),
        streamDays: toNumber(user.streamDays, 0),
        streamStartAt: toNumber(user.streamStartAt, null),
        streamEndsAt: toNumber(user.streamEndsAt, null),
        streamProgress: toNumber(user.streamProgress, 0),
        immediateClaimedCrx: toNumber(user.immediateClaimedCrx, 0),
        streamedClaimedCrx: toNumber(user.streamedClaimedCrx, 0),
        totalClaimedCrx: toNumber(user.totalClaimedCrx, 0),
        immediateRemainingCrx: toNumber(user.immediateRemainingCrx, 0),
        streamedRemainingCrx: toNumber(user.streamedRemainingCrx, 0),
        vestedStreamedCrx: toNumber(user.vestedStreamedCrx, 0),
        claimableNowCrx: toNumber(user.claimableNowCrx, 0),
        claimOpensAt: toNumber(user.claimOpensAt, null),
        lastClaimAt: toNumber(user.lastClaimAt, null),
        claimCount: toNumber(user.claimCount, 0),
        budgetBaseScale: toNumber(user.budgetBaseScale, 1),
        budgetBonusScale: toNumber(user.budgetBonusScale, 1),
        updatedAt: toNumber(user.updatedAt, null),
      };
    },
  });
};
