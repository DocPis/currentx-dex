// src/features/pools/PoolsSection.jsx
import React, { useMemo, useState } from "react";
import { DEFAULT_TOKEN_LOGO, TOKENS } from "../../shared/config/tokens";
import megaLogo from "../../tokens/megaeth.png";
import { usePoolsData } from "../../shared/hooks/usePoolsData";

const SORT_KEYS = {
  LIQUIDITY: "liquidity",
  VOLUME: "volume",
  FEES: "fees",
  APR: "apr",
};
const LOW_TVL_THRESHOLD = 50;

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

const STABLE_SYMBOLS = new Set([
  "USDM",
  "USDT0",
  "CUSD",
  "USDC",
  "USDT",
  "DAI",
  "USDE",
  "SUSDE",
  "STCUSD",
]);

const isStableSymbol = (symbol) => {
  const normalized = (symbol || "").toString().toUpperCase();
  return Boolean(normalized && STABLE_SYMBOLS.has(normalized));
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
    deferV2UntilV3Ready: true,
    v2StartDelayMs: 1200,
  });
  const [sortKey, setSortKey] = useState(SORT_KEYS.LIQUIDITY);
  const [sortDir, setSortDir] = useState("desc");
  const [typeFilter, setTypeFilter] = useState("all"); // all | v3 | v2
  const [hideLowTvl, setHideLowTvl] = useState(true);

  const searchLower = searchTerm.trim().toLowerCase();

  const combinedPools = useMemo(() => {
    const list = [];
    v3Pools.forEach((pool) => {
      const roll = v3RollingData[pool.id?.toLowerCase?.() || ""] || {};
      const liquidityUsd =
        roll.tvlUsd !== undefined && roll.tvlUsd !== null
          ? roll.tvlUsd
          : pool.tvlUsd ?? null;
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
        apr,
      });
    });
    v2Pools.forEach((pool) => {
      const roll = v2RollingData[pool.id?.toLowerCase?.() || ""] || {};
      let liquidityUsd =
        roll.tvlUsd !== undefined && roll.tvlUsd !== null
          ? roll.tvlUsd
          : pool.tvlUsd ?? null;
      if (!liquidityUsd || liquidityUsd <= 0) {
        const stable0 = isStableSymbol(pool.token0Symbol);
        const stable1 = isStableSymbol(pool.token1Symbol);
        if (stable0 && Number.isFinite(pool.reserve0) && pool.reserve0 > 0) {
          liquidityUsd = pool.reserve0 * 2;
        } else if (stable1 && Number.isFinite(pool.reserve1) && pool.reserve1 > 0) {
          liquidityUsd = pool.reserve1 * 2;
        }
      }
      const volume24hUsd =
        roll.volumeUsd !== undefined && roll.volumeUsd !== null
          ? roll.volumeUsd
          : null;
      const feeRate = 0.003;
      const fees24hUsd =
        volume24hUsd !== null ? volume24hUsd * feeRate : null;
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
      };
    }
    let tvl = 0;
    let volume24h = 0;
    let fees24h = 0;
    let hasTvl = false;
    let hasVolume = false;
    let hasFees = false;

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
    });

    return {
      tvl: hasTvl ? tvl : null,
      volume24h: hasVolume ? volume24h : null,
      fees24h: hasFees ? fees24h : null,
    };
  }, [combinedPools]);

  const protocolTvl = protocolAggregates.tvl;
  const protocolVolumeUtc = protocolAggregates.volume24h;
  const protocolFeesUtc = protocolAggregates.fees24h;

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
    const sorted = [...filteredByType].sort((a, b) => {
      const aVal = getValue(a);
      const bVal = getValue(b);
      if (aVal === bVal) return 0;
      return aVal > bVal ? -1 : 1;
    });
    return sortDir === "desc" ? sorted : sorted.reverse();
  }, [filteredByType, sortKey, sortDir]);

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
    sortKey === key ? (sortDir === "desc" ? "↓" : "↑") : "";

  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 py-8 text-slate-100">
      <div className="mb-6 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-900/60 border border-slate-800/80 shadow-2xl shadow-black/40 overflow-hidden">
        <div className="flex flex-col items-center justify-center gap-6 p-8 text-center">
          <div className="flex flex-col items-center gap-3 max-w-3xl">
            <p className="text-base sm:text-lg text-slate-200">
              Track all pools across V2 and V3 with live liquidity and fee stats.
            </p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <span className="text-xs px-2 py-1 rounded-full bg-slate-800/70 border border-slate-700 text-slate-200 inline-flex items-center">
                Live data
              </span>
              <img src={megaLogo} alt="MegaETH" className="h-7 w-7 rounded-full" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-4xl text-center">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                Protocol Volume Daily
              </div>
              <div className="text-xl font-semibold">
                {formatUsd(protocolVolumeUtc)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                Protocol Fees Daily
              </div>
              <div className="text-xl font-semibold">
                {formatUsd(protocolFeesUtc)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                Protocol TVL
              </div>
              <div className="text-xl font-semibold">
                {formatUsd(protocolTvl)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Pools</h2>
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3 text-sm text-slate-400">
            <span>All available pools across V3 and V2.</span>
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
        <div className="flex items-center gap-3 w-full lg:w-auto">
          <div className="flex items-center gap-2 bg-slate-900/70 border border-slate-800 rounded-full px-3 py-2 text-xs text-slate-300 w-full lg:w-80">
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
              { id: "all", label: "All" },
              { id: "v3", label: "V3" },
              { id: "v2", label: "V2" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTypeFilter(item.id)}
                className={`px-3 py-2 rounded-full text-xs border transition ${
                  typeFilter === item.id
                    ? "border-sky-500/60 bg-slate-900 text-white"
                    : "border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-100 hover:border-slate-600"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-3xl bg-slate-900/70 border border-slate-800 shadow-xl shadow-black/30 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="text-lg font-semibold text-slate-50">
            Pools ({sortedPools.length})
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
              return (
                <button
                  key={`${pool.type}-${pool.id}`}
                  type="button"
                  onClick={() => handlePoolSelect(pool)}
                  className="w-full text-left rounded-2xl border border-slate-800/70 bg-slate-950/40 px-3 sm:px-4 py-3 hover:border-sky-500/40 hover:bg-slate-900/60 transition"
                  aria-label={`Open ${pool.token0Symbol || "Token0"} / ${pool.token1Symbol || "Token1"} pool`}
                >
                  <div className="flex flex-col md:grid md:grid-cols-12 md:items-center gap-3">
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
                          <div className="text-[11px] text-slate-500 flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full border border-slate-700/60 bg-slate-900/60 text-slate-200">
                              {pool.type} {pool.feeLabel ? pool.feeLabel : ""}
                            </span>
                          </div>
                        </div>
                      </div>

                    <div className="md:col-span-2 text-right text-sm text-slate-100">
                      {formatUsd(pool.liquidityUsd)}
                    </div>
                    <div className="md:col-span-2 text-right text-sm text-slate-100">
                      {pool.volume24hUsd !== null ? formatUsd(pool.volume24hUsd) : "--"}
                    </div>
                    <div className="md:col-span-2 text-right text-sm text-slate-100">
                      {pool.fees24hUsd !== null ? formatUsd(pool.fees24hUsd) : "--"}
                    </div>
                    <div className="md:col-span-2 text-right text-sm text-slate-100">
                      {pool.apr !== null ? `${pool.apr.toFixed(2)}%` : "--"}
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
