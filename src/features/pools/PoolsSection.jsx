// src/features/pools/PoolsSection.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  fetchV2PoolsPage,
  fetchV3PoolsPage,
  fetchV2PoolsDayData,
  fetchV3PoolsDayData,
} from "../../shared/config/subgraph";
import { TOKENS } from "../../shared/config/tokens";
import { NETWORK_NAME } from "../../shared/config/web3";

const PAGE_SIZE = 50;
const SORT_KEYS = {
  LIQUIDITY: "liquidity",
  VOLUME: "volume",
  FEES: "fees",
  APR: "apr",
};

const formatNumber = (num) => {
  if (num === null || num === undefined) return "--";
  if (!Number.isFinite(num)) return "--";
  const abs = Math.abs(num);
  if (abs >= 1e12) return `${(num / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
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

export default function PoolsSection() {
  const [searchTerm, setSearchTerm] = useState("");
  const [v2Pools, setV2Pools] = useState([]);
  const [v3Pools, setV3Pools] = useState([]);
  const [v2DayData, setV2DayData] = useState({});
  const [v3DayData, setV3DayData] = useState({});
  const [v2Skip, setV2Skip] = useState(0);
  const [v3Skip, setV3Skip] = useState(0);
  const [v2Loading, setV2Loading] = useState(false);
  const [v3Loading, setV3Loading] = useState(false);
  const [v2HasMore, setV2HasMore] = useState(true);
  const [v3HasMore, setV3HasMore] = useState(true);
  const [v2Error, setV2Error] = useState("");
  const [v3Error, setV3Error] = useState("");
  const [sortKey, setSortKey] = useState(SORT_KEYS.LIQUIDITY);
  const [sortDir, setSortDir] = useState("desc");
  const [typeFilter, setTypeFilter] = useState("all"); // all | cl | v2

  const loadV2 = async (append = false) => {
    if (v2Loading) return;
    setV2Loading(true);
    setV2Error("");
    const offset = append ? v2Skip : 0;
    try {
      const data = await fetchV2PoolsPage({
        limit: PAGE_SIZE,
        skip: offset,
      });
      setV2Pools((prev) => (append ? [...prev, ...data] : data));
      setV2Skip(offset + data.length);
      setV2HasMore(data.length === PAGE_SIZE);
    } catch (err) {
      setV2Error(err?.message || "Failed to load V2 pools");
    } finally {
      setV2Loading(false);
    }
  };

  const loadV3 = async (append = false) => {
    if (v3Loading) return;
    setV3Loading(true);
    setV3Error("");
    const offset = append ? v3Skip : 0;
    try {
      const data = await fetchV3PoolsPage({
        limit: PAGE_SIZE,
        skip: offset,
      });
      setV3Pools((prev) => (append ? [...prev, ...data] : data));
      setV3Skip(offset + data.length);
      setV3HasMore(data.length === PAGE_SIZE);
    } catch (err) {
      setV3Error(err?.message || "Failed to load CL pools");
    } finally {
      setV3Loading(false);
    }
  };

  useEffect(() => {
    loadV3(false);
    loadV2(false);
  }, []);

  const searchLower = searchTerm.trim().toLowerCase();

  useEffect(() => {
    let cancelled = false;
    const loadDayData = async () => {
      try {
        const v2Ids = v2Pools.map((p) => p.id).filter(Boolean);
        const v3Ids = v3Pools.map((p) => p.id).filter(Boolean);
        const [v2Data, v3Data] = await Promise.all([
          fetchV2PoolsDayData(v2Ids),
          fetchV3PoolsDayData(v3Ids),
        ]);
        if (!cancelled) {
          setV2DayData(v2Data || {});
          setV3DayData(v3Data || {});
        }
      } catch {
        if (!cancelled) {
          setV2DayData({});
          setV3DayData({});
        }
      }
    };
    if (v2Pools.length || v3Pools.length) {
      loadDayData();
    } else {
      setV2DayData({});
      setV3DayData({});
    }
    return () => {
      cancelled = true;
    };
  }, [v2Pools, v3Pools]);

  const combinedPools = useMemo(() => {
    const list = [];
    v3Pools.forEach((pool) => {
      const day = v3DayData[pool.id?.toLowerCase?.() || ""] || {};
      const liquidityUsd =
        day.tvlUsd !== undefined && day.tvlUsd !== null
          ? day.tvlUsd
          : pool.tvlUsd ?? null;
      const volume24hUsd =
        day.volumeUsd !== undefined && day.volumeUsd !== null
          ? day.volumeUsd
          : pool.volumeUsd ?? null;
      const feeRate = pool.feeTier ? Number(pool.feeTier) / 1_000_000 : 0.003;
      const fees24hUsd =
        volume24hUsd !== null ? volume24hUsd * feeRate : null;
      const apr =
        liquidityUsd && liquidityUsd > 0 && fees24hUsd !== null
          ? (fees24hUsd * 365 * 100) / liquidityUsd
          : null;
      list.push({
        ...pool,
        type: "CL",
        feeLabel: formatFeePercent(pool.feeTier, "0.30%"),
        liquidityUsd,
        volume24hUsd,
        fees24hUsd,
        apr,
      });
    });
    v2Pools.forEach((pool) => {
      const day = v2DayData[pool.id?.toLowerCase?.() || ""] || {};
      const liquidityUsd =
        day.tvlUsd !== undefined && day.tvlUsd !== null
          ? day.tvlUsd
          : pool.tvlUsd ?? null;
      const volume24hUsd =
        day.volumeUsd !== undefined && day.volumeUsd !== null
          ? day.volumeUsd
          : pool.volumeUsd ?? null;
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
  }, [v2Pools, v3Pools, v2DayData, v3DayData]);

  const totals = useMemo(() => {
    return combinedPools.reduce(
      (acc, pool) => {
        acc.liquidity += Number(pool.liquidityUsd || 0);
        acc.volume += Number(pool.volume24hUsd || 0);
        acc.fees += Number(pool.fees24hUsd || 0);
        return acc;
      },
      { liquidity: 0, volume: 0, fees: 0 }
    );
  }, [combinedPools]);

  const filteredPools = useMemo(() => {
    if (!searchLower) return combinedPools;
    return combinedPools.filter((pool) => poolMatchesSearch(pool, searchLower));
  }, [combinedPools, searchLower]);

  const filteredByType = useMemo(() => {
    if (typeFilter === "all") return filteredPools;
    const target = typeFilter === "cl" ? "CL" : "V2";
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

  const sortIndicator = (key) =>
    sortKey === key ? (sortDir === "desc" ? "↓" : "↑") : "";

  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 py-8 text-slate-100">
      <div className="mb-6 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-900/60 border border-slate-800/80 shadow-2xl shadow-black/40 overflow-hidden">
        <div className="flex flex-col items-center justify-center gap-6 p-8 text-center">
          <div className="flex flex-col items-center gap-3 max-w-3xl">
            <p className="text-base sm:text-lg text-slate-200">
              Track all pools across V2 and CL with live liquidity and fee stats.
            </p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <span className="text-xs px-2 py-1 rounded-full bg-slate-800/70 border border-slate-700 text-slate-200">
                Live data
              </span>
              <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                {NETWORK_NAME}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-4xl text-center">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                Volume 24h
              </div>
              <div className="text-xl font-semibold">
                {formatUsd(totals.volume)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                Fees 24h
              </div>
              <div className="text-xl font-semibold">
                {formatUsd(totals.fees)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                TVL
              </div>
              <div className="text-xl font-semibold">
                {formatUsd(totals.liquidity)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Pools</h2>
          <div className="text-sm text-slate-400">
            All available pools across Concentrated Liquidity (CL) and V2.
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
              { id: "cl", label: "CL" },
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
          <button
            type="button"
            onClick={() => {
              loadV3(false);
              loadV2(false);
            }}
            className="px-4 py-2 rounded-full bg-slate-900 border border-slate-700 text-xs text-slate-200 hover:border-slate-500"
          >
            Refresh
          </button>
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
            {v2Error || v3Error}
          </div>
        )}

        <div className="px-3 sm:px-5 py-3 space-y-2">
          {v2Loading && v3Loading && !sortedPools.length ? (
            <div className="py-6 text-center text-sm text-slate-400">
              Loading pools...
            </div>
          ) : sortedPools.length ? (
            sortedPools.map((pool) => {
              const meta0 = resolveTokenMeta(pool.token0Id, pool.token0Symbol);
              const meta1 = resolveTokenMeta(pool.token1Id, pool.token1Symbol);
              return (
                <div
                  key={`${pool.type}-${pool.id}`}
                  className="w-full rounded-2xl border border-slate-800/70 bg-slate-950/40 px-3 sm:px-4 py-3"
                >
                  <div className="flex flex-col md:grid md:grid-cols-12 md:items-center gap-3">
                    <div className="md:col-span-4 flex items-center gap-3">
                      <div className="flex -space-x-2">
                        {[meta0, meta1].map((t, idx) => (
                          <div
                            key={idx}
                            className="h-8 w-8 rounded-full border border-slate-800 bg-slate-900 flex items-center justify-center overflow-hidden text-[10px] font-semibold text-slate-200"
                          >
                            {t?.logo ? (
                              <img
                                src={t.logo}
                                alt={`${t.symbol} logo`}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <span>
                                {(idx === 0 ? pool.token0Symbol : pool.token1Symbol || "?")
                                  .toString()
                                  .slice(0, 3)}
                              </span>
                            )}
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
                </div>
              );
            })
          ) : (
            <div className="py-6 text-center text-sm text-slate-400">
              No pools found.
            </div>
          )}
        </div>

        <div className="px-5 pb-5 flex flex-col sm:flex-row gap-3">
          {v3HasMore && (
            <button
              type="button"
              onClick={() => loadV3(true)}
              disabled={v3Loading}
              className="w-full px-4 py-2 rounded-full bg-slate-900 border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-60"
            >
              {v3Loading ? "Loading..." : "Load more CL pools"}
            </button>
          )}
          {v2HasMore && (
            <button
              type="button"
              onClick={() => loadV2(true)}
              disabled={v2Loading}
              className="w-full px-4 py-2 rounded-full bg-slate-900 border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-60"
            >
              {v2Loading ? "Loading..." : "Load more V2 pools"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
