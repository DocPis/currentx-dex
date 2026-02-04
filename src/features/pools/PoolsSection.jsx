// src/features/pools/PoolsSection.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  fetchV2PoolsPage,
  fetchV3PoolsPage,
} from "../../shared/config/subgraph";
import { TOKENS } from "../../shared/config/tokens";

const PAGE_SIZE = 50;

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

const formatUsd = (num) => `$${formatNumber(num)}`;

const formatFeeTier = (feeTier) => {
  const num = Number(feeTier);
  if (!Number.isFinite(num) || num <= 0) return "--";
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
  const [v2Skip, setV2Skip] = useState(0);
  const [v3Skip, setV3Skip] = useState(0);
  const [v2Loading, setV2Loading] = useState(false);
  const [v3Loading, setV3Loading] = useState(false);
  const [v2HasMore, setV2HasMore] = useState(true);
  const [v3HasMore, setV3HasMore] = useState(true);
  const [v2Error, setV2Error] = useState("");
  const [v3Error, setV3Error] = useState("");

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

  const filteredV3 = useMemo(
    () => v3Pools.filter((pool) => poolMatchesSearch(pool, searchLower)),
    [v3Pools, searchLower]
  );
  const filteredV2 = useMemo(
    () => v2Pools.filter((pool) => poolMatchesSearch(pool, searchLower)),
    [v2Pools, searchLower]
  );

  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 py-8 text-slate-100">
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="rounded-3xl bg-slate-900/70 border border-slate-800 shadow-xl shadow-black/30 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Concentrated Liquidity
              </div>
              <div className="text-lg font-semibold text-slate-50">
                CL Pools ({filteredV3.length})
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] border border-emerald-400/40 bg-emerald-500/10 text-emerald-200">
              V3
            </span>
          </div>

          <div className="hidden md:grid grid-cols-12 px-5 py-2 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
            <div className="col-span-6">Pool</div>
            <div className="col-span-3 text-right">TVL</div>
            <div className="col-span-2 text-right">Volume</div>
            <div className="col-span-1 text-right">Fee</div>
          </div>

          {v3Error && (
            <div className="px-5 py-3 text-xs text-amber-200">{v3Error}</div>
          )}

          <div className="px-3 sm:px-5 py-3 space-y-2">
            {v3Loading && !filteredV3.length ? (
              <div className="py-6 text-center text-sm text-slate-400">Loading CL pools...</div>
            ) : filteredV3.length ? (
              filteredV3.map((pool) => {
                const meta0 = resolveTokenMeta(pool.token0Id, pool.token0Symbol);
                const meta1 = resolveTokenMeta(pool.token1Id, pool.token1Symbol);
                return (
                  <div
                    key={pool.id}
                    className="w-full rounded-2xl border border-slate-800/70 bg-slate-950/40 px-3 sm:px-4 py-3"
                  >
                    <div className="flex flex-col md:grid md:grid-cols-12 md:items-center gap-3">
                      <div className="md:col-span-6 flex items-center gap-3">
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
                              CL
                            </span>
                            <span className="px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-200">
                              {formatFeeTier(pool.feeTier)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="md:col-span-3 text-right text-sm text-slate-100">
                        {formatUsd(pool.tvlUsd)}
                      </div>
                      <div className="md:col-span-2 text-right text-sm text-slate-100">
                        {formatUsd(pool.volumeUsd)}
                      </div>
                      <div className="md:col-span-1 text-right text-xs text-slate-300">
                        {formatFeeTier(pool.feeTier)}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-6 text-center text-sm text-slate-400">
                No CL pools found.
              </div>
            )}
          </div>

          <div className="px-5 pb-5">
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
          </div>
        </div>

        <div className="rounded-3xl bg-slate-900/70 border border-slate-800 shadow-xl shadow-black/30 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Classic AMM
              </div>
              <div className="text-lg font-semibold text-slate-50">
                V2 Pools ({filteredV2.length})
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] border border-sky-400/40 bg-sky-500/10 text-sky-200">
              V2
            </span>
          </div>

          <div className="hidden md:grid grid-cols-12 px-5 py-2 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
            <div className="col-span-7">Pool</div>
            <div className="col-span-3 text-right">TVL</div>
            <div className="col-span-2 text-right">Volume</div>
          </div>

          {v2Error && (
            <div className="px-5 py-3 text-xs text-amber-200">{v2Error}</div>
          )}

          <div className="px-3 sm:px-5 py-3 space-y-2">
            {v2Loading && !filteredV2.length ? (
              <div className="py-6 text-center text-sm text-slate-400">Loading V2 pools...</div>
            ) : filteredV2.length ? (
              filteredV2.map((pool) => {
                const meta0 = resolveTokenMeta(pool.token0Id, pool.token0Symbol);
                const meta1 = resolveTokenMeta(pool.token1Id, pool.token1Symbol);
                return (
                  <div
                    key={pool.id}
                    className="w-full rounded-2xl border border-slate-800/70 bg-slate-950/40 px-3 sm:px-4 py-3"
                  >
                    <div className="flex flex-col md:grid md:grid-cols-12 md:items-center gap-3">
                      <div className="md:col-span-7 flex items-center gap-3">
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
                              V2
                            </span>
                            <span className="px-2 py-0.5 rounded-full border border-slate-700/60 bg-slate-900/60 text-slate-200">
                              0.30%
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="md:col-span-3 text-right text-sm text-slate-100">
                        {formatUsd(pool.tvlUsd)}
                      </div>
                      <div className="md:col-span-2 text-right text-sm text-slate-100">
                        {formatUsd(pool.volumeUsd)}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-6 text-center text-sm text-slate-400">
                No V2 pools found.
              </div>
            )}
          </div>

          <div className="px-5 pb-5">
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
    </div>
  );
}
