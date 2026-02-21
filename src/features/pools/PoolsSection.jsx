// src/features/pools/PoolsSection.jsx
import React, { useMemo, useState } from "react";
import { DEFAULT_TOKEN_LOGO, TOKENS } from "../../shared/config/tokens";
import { usePoolsData } from "../../shared/hooks/usePoolsData";

const SORT_KEYS = {
  LIQUIDITY: "liquidity",
  VOLUME: "volume",
  FEES: "fees",
  APR: "apr",
};
const LOW_TVL_THRESHOLD = 50;
const PROTOCOL_INTEL_FILTERS = [
  { id: "all", label: "All Pools" },
  { id: "highest-apr", label: "Highest APR" },
  { id: "highest-efficiency", label: "Highest Turnover" },
  { id: "largest-tvl-change", label: "Largest TVL Delta" },
  { id: "stable-yield", label: "Stable Yield" },
];

const trimTrailingZeros = (value) => {
  if (typeof value !== "string" || !value.includes(".")) return value;
  return value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
};

const formatNumber = (num) => {
  if (num === null || num === undefined) return "--";
  if (!Number.isFinite(num)) return "--";
  const abs = Math.abs(num);
  const units = [
    { value: 1e21, suffix: "Sx" },
    { value: 1e18, suffix: "Qi" },
    { value: 1e15, suffix: "Q" },
    { value: 1e12, suffix: "T" },
    { value: 1e9, suffix: "B" },
    { value: 1e6, suffix: "M" },
    { value: 1e3, suffix: "K" },
  ];
  for (const unit of units) {
    if (abs >= unit.value) {
      const scaled = num / unit.value;
      const decimals = scaled >= 100 ? 2 : scaled >= 10 ? 3 : 4;
      return `${trimTrailingZeros(scaled.toFixed(decimals))}${unit.suffix}`;
    }
  }
  if (abs >= 1) return trimTrailingZeros(num.toFixed(4));
  if (abs >= 0.01) return trimTrailingZeros(num.toFixed(6));
  if (abs >= 0.0001) return trimTrailingZeros(num.toFixed(8));
  if (abs === 0) return "0";
  return "<0.0001";
};

const formatUsd = (num) =>
  num === null || num === undefined ? "--" : `$${formatNumber(num)}`;
const formatSignedUsd = (num) => {
  if (!Number.isFinite(num)) return "--";
  const sign = num > 0 ? "+" : num < 0 ? "-" : "";
  return `${sign}${formatUsd(Math.abs(num))}`;
};
const formatPercent = (num, digits = 2) => {
  if (!Number.isFinite(num)) return "--";
  return `${trimTrailingZeros(num.toFixed(digits))}%`;
};
const formatSignedPercent = (num, digits = 2) => {
  if (!Number.isFinite(num)) return "--";
  const sign = num > 0 ? "+" : num < 0 ? "-" : "";
  return `${sign}${formatPercent(Math.abs(num), digits)}`;
};
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatFeePercent = (feeTier, fallback = "0.30%") => {
  const num = Number(feeTier);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return `${(num / 10000).toFixed(2)}%`;
};

const buildTokenMaps = () => {
  const byAddress = {};
  const bySymbol = {};
  Object.values(TOKENS).forEach((token) => {
    if (!token) return;
    if (token.address) {
      byAddress[token.address.toLowerCase()] = token;
    }
    if (token.symbol) {
      bySymbol[token.symbol] = token;
    }
  });
  return { byAddress, bySymbol };
};

const TOKEN_MAPS = buildTokenMaps();
const normalizeAddress = (value) => String(value || "").trim().toLowerCase();
const WHITELISTED_TOKEN_IDS = new Set(
  Object.values(TOKENS || {})
    .map((token) => normalizeAddress(token?.address))
    .filter((address) => /^0x[a-f0-9]{40}$/u.test(address))
);
const isWhitelistedPoolForTvl = (pool) =>
  WHITELISTED_TOKEN_IDS.has(normalizeAddress(pool?.token0Id)) &&
  WHITELISTED_TOKEN_IDS.has(normalizeAddress(pool?.token1Id));

const toFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const pickPoolLiquidityUsd = (poolTvlUsd, rollingTvlUsd) => {
  const base = toFiniteNumber(poolTvlUsd);
  const rolling = toFiniteNumber(rollingTvlUsd);

  // Prefer live pool TVL; use rolling TVL only as fallback when base TVL is missing.
  if (base !== null && base > 0) return base;
  if (rolling !== null && rolling > 0) return rolling;
  if (base !== null && base === 0) return 0;
  if (rolling !== null && rolling === 0) return 0;
  return null;
};

const resolveTokenMeta = (tokenId, symbol) => {
  if (tokenId) {
    const match = TOKEN_MAPS.byAddress[tokenId.toLowerCase()];
    if (match) return match;
  }
  if (symbol && TOKEN_MAPS.bySymbol[symbol]) {
    return TOKEN_MAPS.bySymbol[symbol];
  }
  return null;
};

const poolMatchesSearch = (pool, term) => {
  if (!term) return true;
  const hay = [
    pool.token0Symbol,
    pool.token1Symbol,
    pool.token0Id,
    pool.token1Id,
    pool.id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(term);
};

export default function PoolsSection({ onSelectPool }) {
  const [searchTerm, setSearchTerm] = useState("");
  const {
    v2Pools,
    v3Pools,
    v2RollingData,
    v3RollingData,
    v2Error,
    v3Error,
    v2IsLoading,
    v3IsLoading,
    v2IsFetchingNextPage,
    v3IsFetchingNextPage,
    v2HasNextPage,
    v3HasNextPage,
    fetchNextV2,
    fetchNextV3,
  } = usePoolsData({
    deferV2UntilV3Ready: false,
    v2StartDelayMs: 0,
  });
  const [sortKey, setSortKey] = useState(SORT_KEYS.LIQUIDITY);
  const [sortDir, setSortDir] = useState("desc");
  const [typeFilter, setTypeFilter] = useState("all"); // all | v3 | v2
  const [hideLowTvl, setHideLowTvl] = useState(true);
  const [intelFilter, setIntelFilter] = useState("all");

  const searchLower = searchTerm.trim().toLowerCase();

  const combinedPools = useMemo(() => {
    const list = [];
    v3Pools.forEach((pool) => {
      const roll = v3RollingData[pool.id?.toLowerCase?.() || ""] || {};
      const rawLiquidityUsd = pickPoolLiquidityUsd(pool.tvlUsd, roll.tvlUsd);
      const liquidityUsd = isWhitelistedPoolForTvl(pool) ? rawLiquidityUsd : null;
      const volume24hUsd =
        roll.volumeUsd !== undefined && roll.volumeUsd !== null
          ? roll.volumeUsd
          : null;
      const feeTierNum = Number(pool.feeTier);
      const feeRate =
        Number.isFinite(feeTierNum) && feeTierNum > 0
          ? feeTierNum / 1_000_000
          : null;
      const fees24hUsd =
        roll.feesUsd !== undefined && roll.feesUsd !== null
          ? roll.feesUsd
          : volume24hUsd !== null && feeRate !== null
          ? volume24hUsd * feeRate
          : null;
      const tvlChange24hUsd =
        roll.tvlChange24hUsd !== undefined && roll.tvlChange24hUsd !== null
          ? roll.tvlChange24hUsd
          : null;
      const apr =
        liquidityUsd && liquidityUsd > 0 && fees24hUsd !== null
          ? (fees24hUsd * 365 * 100) / liquidityUsd
          : null;
      list.push({
        ...pool,
        type: "V3",
        feeLabel: formatFeePercent(pool.feeTier, ""),
        liquidityUsd,
        volume24hUsd,
        fees24hUsd,
        tvlChange24hUsd,
        apr,
      });
    });
    v2Pools.forEach((pool) => {
      const roll = v2RollingData[pool.id?.toLowerCase?.() || ""] || {};
      const rawLiquidityUsd = pickPoolLiquidityUsd(pool.tvlUsd, roll.tvlUsd);
      const liquidityUsd = isWhitelistedPoolForTvl(pool) ? rawLiquidityUsd : null;
      const volume24hUsd =
        roll.volumeUsd !== undefined && roll.volumeUsd !== null
          ? roll.volumeUsd
          : null;
      const feeRate = 0.003;
      const fees24hUsd =
        volume24hUsd !== null ? volume24hUsd * feeRate : null;
      const tvlChange24hUsd =
        roll.tvlChange24hUsd !== undefined && roll.tvlChange24hUsd !== null
          ? roll.tvlChange24hUsd
          : null;
      const apr =
        liquidityUsd && liquidityUsd > 0 && fees24hUsd !== null
          ? (fees24hUsd * 365 * 100) / liquidityUsd
          : null;
      list.push({
        ...pool,
        type: "V2",
        feeLabel: "0.30%",
        liquidityUsd,
        volume24hUsd,
        fees24hUsd,
        tvlChange24hUsd,
        apr,
      });
    });
    return list;
  }, [v2Pools, v3Pools, v2RollingData, v3RollingData]);

  const protocolAggregates = useMemo(() => {
    if (!combinedPools.length) {
      return {
        tvl: null,
        volume24h: null,
        fees24h: null,
        tvlChange24h: null,
      };
    }
    let tvl = 0;
    let volume24h = 0;
    let fees24h = 0;
    let tvlChange24h = 0;
    let hasTvl = false;
    let hasVolume = false;
    let hasFees = false;
    let hasTvlChange = false;

    combinedPools.forEach((pool) => {
      if (Number.isFinite(pool?.liquidityUsd) && pool.liquidityUsd >= 0) {
        tvl += pool.liquidityUsd;
        hasTvl = true;
      }
      if (Number.isFinite(pool?.volume24hUsd) && pool.volume24hUsd >= 0) {
        volume24h += pool.volume24hUsd;
        hasVolume = true;
      }
      if (Number.isFinite(pool?.fees24hUsd) && pool.fees24hUsd >= 0) {
        fees24h += pool.fees24hUsd;
        hasFees = true;
      }
      if (Number.isFinite(pool?.tvlChange24hUsd)) {
        tvlChange24h += pool.tvlChange24hUsd;
        hasTvlChange = true;
      }
    });

    return {
      tvl: hasTvl ? tvl : null,
      volume24h: hasVolume ? volume24h : null,
      fees24h: hasFees ? fees24h : null,
      tvlChange24h: hasTvlChange ? tvlChange24h : null,
    };
  }, [combinedPools]);

  const protocolTvl = protocolAggregates.tvl;
  const protocolVolumeUtc = protocolAggregates.volume24h;
  const protocolFeesUtc = protocolAggregates.fees24h;
  const protocolTvlChange24h = protocolAggregates.tvlChange24h;
  const activePoolsCount = useMemo(
    () =>
      combinedPools.filter(
        (pool) =>
          (Number.isFinite(pool?.liquidityUsd) && pool.liquidityUsd > 0) ||
          (Number.isFinite(pool?.volume24hUsd) && pool.volume24hUsd > 0)
      ).length,
    [combinedPools]
  );
  const bestAprPool = useMemo(() => {
    let best = null;
    combinedPools.forEach((pool) => {
      if (!Number.isFinite(pool?.apr) || pool.apr <= 0) return;
      if (!best || pool.apr > best.apr) best = pool;
    });
    return best;
  }, [combinedPools]);
  const bestAprMeta = useMemo(() => {
    if (!bestAprPool || !Number.isFinite(bestAprPool.apr)) {
      return { value: "--", pair: "--" };
    }
    return {
      value: `${bestAprPool.apr.toFixed(2)}%`,
      pair: `${bestAprPool.token0Symbol || "Token0"} / ${bestAprPool.token1Symbol || "Token1"}`,
    };
  }, [bestAprPool]);

  const filteredPools = useMemo(() => {
    let list = combinedPools;
    if (searchLower) {
      list = list.filter((pool) => poolMatchesSearch(pool, searchLower));
    }
    if (hideLowTvl) {
      list = list.filter((pool) => {
        if (!Number.isFinite(pool.liquidityUsd)) return true;
        return pool.liquidityUsd >= LOW_TVL_THRESHOLD;
      });
    }
    return list;
  }, [combinedPools, searchLower, hideLowTvl]);

  const filteredByType = useMemo(() => {
    if (typeFilter === "all") return filteredPools;
    const target = typeFilter === "v3" ? "V3" : "V2";
    return filteredPools.filter((pool) => pool.type === target);
  }, [filteredPools, typeFilter]);
  const typeCounts = useMemo(() => {
    const counts = { all: filteredPools.length, v3: 0, v2: 0 };
    filteredPools.forEach((pool) => {
      if (pool.type === "V3") counts.v3 += 1;
      if (pool.type === "V2") counts.v2 += 1;
    });
    return counts;
  }, [filteredPools]);
  const poolAnalytics = useMemo(() => {
    const liquidityValues = [];
    const volumeValues = [];
    let totalLiquidity = 0;

    filteredByType.forEach((pool) => {
      const liquidity = Number(pool?.liquidityUsd);
      const volume = Number(pool?.volume24hUsd);
      if (Number.isFinite(liquidity) && liquidity > 0) {
        liquidityValues.push(liquidity);
        totalLiquidity += liquidity;
        if (Number.isFinite(volume) && volume >= 0) {
          volumeValues.push(volume);
        }
      }
    });

    return {
      totalLiquidity: totalLiquidity || null,
      maxLiquidity: liquidityValues.length ? Math.max(...liquidityValues) : null,
      maxVolume: volumeValues.length ? Math.max(...volumeValues) : null,
    };
  }, [filteredByType]);
  const poolInsightsByKey = useMemo(() => {
    const map = {};
    const maxLiquidity = poolAnalytics.maxLiquidity || 0;
    const totalLiquidity = poolAnalytics.totalLiquidity || 0;

    filteredByType.forEach((pool) => {
      const poolKey = `${pool.type}-${pool.id}`;
      const liquidity = Number(pool?.liquidityUsd);
      const volume = Number(pool?.volume24hUsd);
      const fees = Number(pool?.fees24hUsd);
      const tvlChange24hUsd = Number(pool?.tvlChange24hUsd);
      const feeLiquidityRatio =
        Number.isFinite(liquidity) &&
        liquidity > 0 &&
        Number.isFinite(fees) &&
        fees >= 0
          ? fees / liquidity
          : null;
      const volumeLiquidityRatio =
        Number.isFinite(liquidity) &&
        liquidity > 0 &&
        Number.isFinite(volume) &&
        volume >= 0
          ? volume / liquidity
          : null;
      const turnover24hPct =
        Number.isFinite(volumeLiquidityRatio) ? volumeLiquidityRatio * 100 : null;
      const tvlChangePct =
        Number.isFinite(liquidity) &&
        liquidity > 0 &&
        Number.isFinite(tvlChange24hUsd)
          ? (tvlChange24hUsd / liquidity) * 100
          : null;
      const depthRatio =
        Number.isFinite(liquidity) && maxLiquidity > 0
          ? clamp(liquidity / maxLiquidity, 0, 1)
          : 0;
      const concentrationRatio =
        Number.isFinite(liquidity) && totalLiquidity > 0
          ? clamp(liquidity / totalLiquidity, 0, 1)
          : 0;

      map[poolKey] = {
        feeLiquidityRatioPct:
          Number.isFinite(feeLiquidityRatio) ? feeLiquidityRatio * 100 : null,
        turnover24hPct,
        tvlChange24hUsd: Number.isFinite(tvlChange24hUsd) ? tvlChange24hUsd : null,
        tvlChangePct,
        depthRatio,
        concentrationRatio,
      };
    });
    return map;
  }, [filteredByType, poolAnalytics]);
  const protocolIntel = useMemo(() => {
    const tvl = Number(protocolTvl);
    const volume24h = Number(protocolVolumeUtc);
    const fees24h = Number(protocolFeesUtc);
    const tvlChange24h = Number(protocolTvlChange24h);
    const turnover24hPct =
      Number.isFinite(tvl) && tvl > 0 && Number.isFinite(volume24h) && volume24h >= 0
        ? (volume24h / tvl) * 100
        : null;
    const feeYield24hPct =
      Number.isFinite(tvl) && tvl > 0 && Number.isFinite(fees24h) && fees24h >= 0
        ? (fees24h / tvl) * 100
        : null;
    const netLiquidityFlow24h =
      Number.isFinite(tvlChange24h)
        ? tvlChange24h
        : null;
    const tvlChange24hPct =
      Number.isFinite(tvl) && tvl > 0 && Number.isFinite(tvlChange24h)
        ? (tvlChange24h / tvl) * 100
        : null;

    return {
      turnover24hPct,
      feeYield24hPct,
      netLiquidityFlow24h,
      tvlChange24hPct,
    };
  }, [protocolTvl, protocolVolumeUtc, protocolFeesUtc, protocolTvlChange24h]);
  const intelligenceFilteredPools = useMemo(() => {
    if (intelFilter === "all") return filteredByType;
    const ranked = filteredByType.map((pool) => {
      const key = `${pool.type}-${pool.id}`;
      return {
        pool,
        insight: poolInsightsByKey[key] || {},
      };
    });
    if (!ranked.length) return [];

    switch (intelFilter) {
      case "highest-apr":
        return ranked
          .sort((a, b) => (Number(b.pool?.apr) || -1) - (Number(a.pool?.apr) || -1))
          .slice(0, 20)
          .map((entry) => entry.pool);
      case "highest-efficiency":
        return ranked
          .sort(
            (a, b) =>
              (Number(b.insight?.turnover24hPct) || -1) -
              (Number(a.insight?.turnover24hPct) || -1)
          )
          .slice(0, 20)
          .map((entry) => entry.pool);
      case "largest-tvl-change":
        return ranked
          .sort(
            (a, b) =>
              Math.abs(Number(b.insight?.tvlChange24hUsd) || 0) -
              Math.abs(Number(a.insight?.tvlChange24hUsd) || 0)
          )
          .slice(0, 20)
          .map((entry) => entry.pool);
      case "stable-yield": {
        const stable = ranked
          .filter((entry) => {
            const feeRatio = Number(entry.insight?.feeLiquidityRatioPct);
            const tvlChangePct = Number(entry.insight?.tvlChangePct);
            if (!Number.isFinite(feeRatio) || feeRatio <= 0) return false;
            if (!Number.isFinite(tvlChangePct)) return false;
            return Math.abs(tvlChangePct) <= 25;
          })
          .sort(
            (a, b) =>
              (Number(b.insight?.feeLiquidityRatioPct) || -1) -
              (Number(a.insight?.feeLiquidityRatioPct) || -1)
          )
          .map((entry) => entry.pool);
        if (stable.length) return stable;
        return ranked
          .sort(
            (a, b) =>
              Math.abs(Number(a.insight?.tvlChangePct) || Number.POSITIVE_INFINITY) -
              Math.abs(Number(b.insight?.tvlChangePct) || Number.POSITIVE_INFINITY)
          )
          .slice(0, 20)
          .map((entry) => entry.pool);
      }
      default:
        return filteredByType;
    }
  }, [filteredByType, intelFilter, poolInsightsByKey]);
  const displayPools = intelligenceFilteredPools;
  const highlightKeys = useMemo(() => {
    const output = {
      apr: null,
      liquidity: null,
      volume: null,
    };
    const topBy = (field) => {
      let winner = null;
      displayPools.forEach((pool) => {
        const value = Number(pool?.[field]);
        if (!Number.isFinite(value) || value <= 0) return;
        if (!winner || value > winner.value) {
          winner = {
            key: `${pool.type}-${pool.id}`,
            value,
          };
        }
      });
      return winner?.key || null;
    };
    output.apr = topBy("apr");
    output.liquidity = topBy("liquidityUsd");
    output.volume = topBy("volume24hUsd");
    return output;
  }, [displayPools]);
  const volumeStats = useMemo(() => {
    const values = displayPools
      .map((pool) => Number(pool?.volume24hUsd))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
    if (!values.length) return { median: null, max: null };
    const mid = Math.floor(values.length / 2);
    const median =
      values.length % 2 === 0
        ? (values[mid - 1] + values[mid]) / 2
        : values[mid];
    const max = values[values.length - 1];
    return { median, max };
  }, [displayPools]);
  const getActivitySignal = (insight) => {
    const tvlChangeUsd = Number(insight?.tvlChange24hUsd);
    const tvlChangePct = Number(insight?.tvlChangePct);
    const feeRatio = Number(insight?.feeLiquidityRatioPct);
    if (!Number.isFinite(tvlChangeUsd)) {
      return {
        icon: "\u2022",
        label: "No TVL delta",
        className: "border-slate-800 text-slate-500 bg-slate-900/40",
        detail: "24h TVL delta unavailable.",
      };
    }
    const tvlDetail = Number.isFinite(tvlChangePct)
      ? `24h TVL ${formatSignedUsd(tvlChangeUsd)} (${formatSignedPercent(tvlChangePct)}).`
      : `24h TVL ${formatSignedUsd(tvlChangeUsd)}.`;
    const feeDetail = Number.isFinite(feeRatio)
      ? ` Fee/Liquidity ${feeRatio.toFixed(2)}%.`
      : "";
    if (Number.isFinite(tvlChangePct) && tvlChangePct >= 5) {
      return {
        icon: "\u2191",
        label: "TVL Inflow",
        className: "border-emerald-500/40 text-emerald-200 bg-emerald-500/10",
        detail: `${tvlDetail}${feeDetail}`,
      };
    }
    if (!Number.isFinite(tvlChangePct) || tvlChangePct >= -5) {
      return {
        icon: "\u2192",
        label: "TVL Stable",
        className: "border-sky-500/40 text-sky-200 bg-sky-500/10",
        detail: `${tvlDetail}${feeDetail}`,
      };
    }
    return {
      icon: "\u2193",
      label: "TVL Outflow",
      className: "border-slate-700 text-slate-300 bg-slate-900/50",
      detail: `${tvlDetail}${feeDetail}`,
    };
  };

  const sortedPools = useMemo(() => {
    const getValue = (pool) => {
      switch (sortKey) {
        case SORT_KEYS.VOLUME:
          return pool.volume24hUsd ?? 0;
        case SORT_KEYS.FEES:
          return pool.fees24hUsd ?? 0;
        case SORT_KEYS.APR:
          return pool.apr ?? 0;
        case SORT_KEYS.LIQUIDITY:
        default:
          return pool.liquidityUsd ?? 0;
      }
    };
    const sorted = [...displayPools].sort((a, b) => {
      const aVal = getValue(a);
      const bVal = getValue(b);
      if (aVal === bVal) return 0;
      return aVal > bVal ? -1 : 1;
    });
    return sortDir === "desc" ? sorted : sorted.reverse();
  }, [displayPools, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const handlePoolSelect = (pool) => {
    if (typeof onSelectPool !== "function") return;
    if (!pool) return;
    onSelectPool({
      type: pool.type,
      token0Symbol: pool.token0Symbol,
      token1Symbol: pool.token1Symbol,
      feeTier: pool.feeTier ?? null,
      id: pool.id ?? null,
      token0Id: pool.token0Id ?? null,
      token1Id: pool.token1Id ?? null,
    });
  };

  const sortIndicator = (key) =>
    sortKey === key ? (sortDir === "desc" ? "\u2193" : "\u2191") : "";

  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 py-8 text-slate-100">
      <div className="mb-6 rounded-2xl border border-slate-800/90 bg-slate-950/85 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-800/80">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              Protocol Overview
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Live capital snapshot across V2 and V3.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            Live
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 px-5 sm:px-6 py-5">
          <div className="col-span-2 lg:col-span-1">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
              TVL
            </div>
            <div className="text-3xl font-semibold text-white">{formatUsd(protocolTvl)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
              24h Volume
            </div>
            <div className="text-xl font-semibold">{formatUsd(protocolVolumeUtc)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
              24h Fees
            </div>
            <div className="text-xl font-semibold">{formatUsd(protocolFeesUtc)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
              Active Pools
            </div>
            <div className="text-xl font-semibold">{activePoolsCount.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
              Best APR
            </div>
            <div className="text-xl font-semibold">{bestAprMeta.value}</div>
            <div className="mt-1 text-[11px] text-slate-500">{bestAprMeta.pair}</div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 px-5 sm:px-6 py-4 border-t border-slate-800/70 bg-slate-950/70">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
              TVL Change
            </div>
            <div className="text-base font-semibold text-slate-100">
              {formatSignedUsd(protocolIntel.netLiquidityFlow24h)}{" "}
              {Number.isFinite(protocolIntel.tvlChange24hPct)
                ? `(${formatSignedPercent(protocolIntel.tvlChange24hPct)})`
                : "(24h)"}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
              Turnover
            </div>
            <div className="text-base font-semibold text-slate-100">
              {formatPercent(protocolIntel.turnover24hPct)}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Fee/TVL {formatPercent(protocolIntel.feeYield24hPct)}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Pools</h2>
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3 text-sm text-slate-400">
            <span>Ranked by liquidity, volume, and fee activity.</span>
            <button
              type="button"
              onClick={() => setHideLowTvl((prev) => !prev)}
              className={`mt-2 sm:mt-0 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                hideLowTvl
                  ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
                  : "border-slate-700/70 bg-slate-900/60 text-slate-300 hover:border-slate-500"
              }`}
            >
              {hideLowTvl ? "Show Low TVL" : "Hide Low TVL"}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3 w-full lg:w-auto lg:min-w-[680px]">
          <div className="flex flex-col xl:flex-row xl:items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-900/70 border border-slate-800 rounded-full px-3 py-2 text-xs text-slate-300 w-full xl:w-80">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 text-slate-500"
              >
                <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M15.5 15.5 20 20"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <input
                name="pool-search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by symbol or address..."
                className="bg-transparent outline-none flex-1 text-slate-200 placeholder:text-slate-600 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              {[
                { id: "all", label: "All", count: typeCounts.all },
                { id: "v3", label: "V3", count: typeCounts.v3 },
                { id: "v2", label: "V2", count: typeCounts.v2 },
              ].map((item) => {
                const active = typeFilter === item.id;
                const style = active
                  ? item.id === "v3"
                    ? "border-sky-400/70 bg-sky-500/15 text-sky-100"
                    : "border-slate-500/70 bg-slate-900 text-white"
                  : item.id === "v3"
                  ? "border-sky-900/80 bg-slate-900/70 text-sky-300 hover:border-sky-600/60 hover:text-sky-100"
                  : "border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-100 hover:border-slate-600";
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTypeFilter(item.id)}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs border transition ${style}`}
                  >
                    <span>{item.label}</span>
                    <span
                      className={`min-w-5 h-5 px-1 rounded-full text-[10px] leading-5 text-center ${
                        active
                          ? "bg-slate-950/80 text-slate-100"
                          : "bg-slate-950/70 text-slate-400"
                      }`}
                    >
                      {item.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PROTOCOL_INTEL_FILTERS.map((filter) => {
              const active = intelFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setIntelFilter(filter.id)}
                  className={`px-3 py-1.5 rounded-full text-[11px] border transition ${
                    active
                      ? "border-sky-500/60 bg-sky-500/12 text-sky-100"
                      : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-100 hover:border-slate-600"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-3xl bg-slate-900/70 border border-slate-800 shadow-xl shadow-black/30 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <div className="text-lg font-semibold text-slate-50">
              Pools ({sortedPools.length})
            </div>
            <div className="text-[11px] text-slate-500">
              Showing {sortedPools.length} of {activePoolsCount} active pools
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
          {v2Error || v3Error ? "Partial data loaded" : "Live data"}
          </div>
        </div>

        <div className="hidden md:grid grid-cols-12 px-5 py-2 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
          <div className="col-span-4">Pool</div>
          <button
            type="button"
            onClick={() => handleSort(SORT_KEYS.LIQUIDITY)}
            className="col-span-2 text-right hover:text-slate-200"
          >
            Liquidity {sortIndicator(SORT_KEYS.LIQUIDITY)}
          </button>
          <button
            type="button"
            onClick={() => handleSort(SORT_KEYS.VOLUME)}
            className="col-span-2 text-right hover:text-slate-200"
          >
            Volume 24h {sortIndicator(SORT_KEYS.VOLUME)}
          </button>
          <button
            type="button"
            onClick={() => handleSort(SORT_KEYS.FEES)}
            className="col-span-2 text-right hover:text-slate-200"
          >
            Fees 24h {sortIndicator(SORT_KEYS.FEES)}
          </button>
          <button
            type="button"
            onClick={() => handleSort(SORT_KEYS.APR)}
            className="col-span-2 text-right hover:text-slate-200"
          >
            APR {sortIndicator(SORT_KEYS.APR)}
          </button>
        </div>

        {(v2Error || v3Error) && (
          <div className="px-5 py-3 text-xs text-amber-200">
            {v2Error?.message || v3Error?.message || "Failed to load pools."}
          </div>
        )}

        <div className="px-3 sm:px-5 py-3 space-y-2">
          {(v2IsLoading || v3IsLoading) && !sortedPools.length ? (
            <div className="py-6 text-center text-sm text-slate-400">
              Loading pools...
            </div>
          ) : sortedPools.length ? (
            sortedPools.map((pool) => {
              const meta0 = resolveTokenMeta(pool.token0Id, pool.token0Symbol);
              const meta1 = resolveTokenMeta(pool.token1Id, pool.token1Symbol);
              const poolKey = `${pool.type}-${pool.id}`;
              const badges = [];
              if (poolKey === highlightKeys.apr) {
                badges.push({
                  label: "Highest APR",
                  className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
                });
              }
              if (poolKey === highlightKeys.liquidity) {
                badges.push({
                  label: "Highest Liquidity",
                  className: "border-sky-500/40 bg-sky-500/10 text-sky-200",
                });
              }
              if (poolKey === highlightKeys.volume) {
                badges.push({
                  label: "Most Traded",
                  className: "border-amber-500/40 bg-amber-500/10 text-amber-200",
                });
              }
              const insight = poolInsightsByKey[poolKey] || {};
              const activity = getActivitySignal(insight);
              const volumeValue = Number(pool?.volume24hUsd);
              const volumeRatio =
                Number.isFinite(volumeValue) &&
                volumeValue > 0 &&
                Number.isFinite(volumeStats.max) &&
                volumeStats.max > 0
                  ? Math.min(1, volumeValue / volumeStats.max)
                  : 0;
              const trendBarClass =
                volumeRatio >= 0.65
                  ? "bg-emerald-300"
                  : volumeRatio >= 0.35
                  ? "bg-sky-300"
                  : "bg-slate-500";
              const depthRatio = Number(insight?.depthRatio);
              const liquiditySharePct =
                Number.isFinite(insight?.concentrationRatio)
                  ? insight.concentrationRatio * 100
                  : null;
              const contextBadges = [
                {
                  key: "activity",
                  label: `${activity.icon} ${activity.label}`,
                  className: activity.className,
                  title: activity.detail,
                },
                ...badges.map((badge) => ({
                  key: badge.label,
                  label: badge.label,
                  className: badge.className,
                  title: undefined,
                })),
              ];
              const visibleContextBadges = contextBadges.slice(0, 2);
              const hiddenContextLabels = contextBadges
                .slice(2)
                .map((badge) => badge.label)
                .join(", ");
              const hiddenContextCount = Math.max(0, contextBadges.length - 2);
              return (
                <button
                  key={poolKey}
                  type="button"
                  onClick={() => handlePoolSelect(pool)}
                  className="group relative isolate overflow-hidden w-full text-left rounded-2xl border border-slate-800/70 bg-slate-950/40 px-3 sm:px-4 py-3 hover:border-sky-500/70 hover:bg-slate-900/70 hover:shadow-[0_0_0_1px_rgba(56,189,248,0.18),0_12px_30px_-20px_rgba(56,189,248,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition"
                  aria-label={`Open ${pool.token0Symbol || "Token0"} / ${pool.token1Symbol || "Token1"} pool`}
                >
                  <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-sky-500/0 via-sky-500/8 to-emerald-400/0" />
                  <div className="relative flex flex-col md:grid md:grid-cols-12 md:items-center gap-3">
                    <div className="md:col-span-4 flex items-center gap-3">
                      <div className="flex -space-x-2">
                        {[meta0, meta1].map((t, idx) => (
                          <div
                            key={idx}
                            className="h-8 w-8 rounded-full border border-slate-800 bg-slate-900 flex items-center justify-center overflow-hidden text-[10px] font-semibold text-slate-200"
                          >
                            <img
                              src={t?.logo || DEFAULT_TOKEN_LOGO}
                              alt={`${idx === 0 ? pool.token0Symbol : pool.token1Symbol || "token"} logo`}
                              className="h-full w-full object-contain"
                              onError={(e) => {
                                const target = e.currentTarget;
                                if (target.getAttribute("data-fallback") === "1") return;
                                target.setAttribute("data-fallback", "1");
                                target.src = DEFAULT_TOKEN_LOGO;
                              }}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-col">
                        <div className="text-sm font-semibold text-slate-100">
                          {pool.token0Symbol || "Token0"} / {pool.token1Symbol || "Token1"}
                        </div>
                        <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full border border-slate-700/60 bg-slate-900/60 text-slate-200">
                            {pool.type} {pool.feeLabel ? pool.feeLabel : ""}
                          </span>
                          {visibleContextBadges.map((badge) => (
                            <span
                              key={badge.key}
                              className={`px-2 py-0.5 rounded-full border ${badge.className}`}
                              title={badge.title}
                            >
                              {badge.label}
                            </span>
                          ))}
                          {hiddenContextCount > 0 && (
                            <span
                              className="px-2 py-0.5 rounded-full border border-slate-700/60 bg-slate-900/70 text-slate-300"
                              title={hiddenContextLabels}
                            >
                              +{hiddenContextCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="md:col-span-2 text-right text-sm text-slate-100">
                      <div>{formatUsd(pool.liquidityUsd)}</div>
                      <div className="mt-1 inline-flex w-full items-center justify-end gap-1 text-[10px] text-slate-500">
                        <span className="uppercase tracking-wide">Depth</span>
                        <span className="inline-flex h-1.5 w-14 rounded-full bg-slate-800 overflow-hidden">
                          <span
                            className="bg-sky-300/90"
                            style={{
                              width:
                                Number.isFinite(depthRatio) && depthRatio > 0
                                  ? `${Math.max(10, Math.round(depthRatio * 100))}%`
                                  : "0%",
                            }}
                          />
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500">
                        Share{" "}
                        {Number.isFinite(liquiditySharePct)
                          ? formatPercent(liquiditySharePct, 1)
                          : "--"}
                      </div>
                    </div>
                    <div className="md:col-span-2 text-right text-sm text-slate-100">
                      <div className="inline-flex w-full items-center justify-end gap-2">
                        <span>
                          {pool.volume24hUsd !== null ? formatUsd(pool.volume24hUsd) : "--"}
                        </span>
                        <span className="hidden md:inline-flex h-1.5 w-12 rounded-full bg-slate-800 overflow-hidden">
                          <span
                            className={`${trendBarClass} origin-left transition-all duration-500 ease-out group-hover:scale-x-105 group-hover:brightness-110`}
                            style={{
                              width:
                                volumeRatio > 0
                                  ? `${Math.max(16, Math.round(volumeRatio * 100))}%`
                                  : "0%",
                            }}
                          />
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500">
                        Turnover{" "}
                        {Number.isFinite(insight?.turnover24hPct)
                          ? formatPercent(insight.turnover24hPct)
                          : "--"}
                      </div>
                    </div>
                    <div className="md:col-span-2 text-right text-sm text-slate-100">
                      {pool.fees24hUsd !== null ? formatUsd(pool.fees24hUsd) : "--"}
                    </div>
                    <div className="md:col-span-2 text-right text-sm text-slate-100">
                      <div className="inline-flex w-full items-center justify-end gap-2">
                        <span className="text-base font-semibold">
                          {pool.apr !== null ? `${pool.apr.toFixed(2)}%` : "--"}
                        </span>
                        <span className="hidden md:inline-flex text-[11px] font-medium text-slate-500 group-hover:text-sky-300 transition">
                          Open {"\u2192"}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="py-6 text-center text-sm text-slate-400">
              No pools found.
            </div>
          )}
        </div>

        <div className="px-5 pb-5 flex flex-col sm:flex-row gap-3">
          {v3HasNextPage && (
            <button
              type="button"
              onClick={() => fetchNextV3()}
              disabled={v3IsFetchingNextPage}
              className="w-full px-4 py-2 rounded-full bg-slate-900 border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-60"
            >
              {v3IsFetchingNextPage ? "Loading..." : "Load more V3 pools"}
            </button>
          )}
          {v2HasNextPage && (
            <button
              type="button"
              onClick={() => fetchNextV2()}
              disabled={v2IsFetchingNextPage}
              className="w-full px-4 py-2 rounded-full bg-slate-900 border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-60"
            >
              {v2IsFetchingNextPage ? "Loading..." : "Load more V2 pools"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
