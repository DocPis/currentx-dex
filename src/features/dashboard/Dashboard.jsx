// src/features/dashboard/Dashboard.jsx
import React, { useMemo, useRef, useState } from "react";
import { useDashboardData } from "../../shared/hooks/useDashboardData";
import { DEFAULT_TOKEN_LOGO, TOKENS } from "../../shared/config/tokens";

function formatNumber(num) {
  if (num === null || num === undefined) return "--";
  if (!Number.isFinite(num)) return "--";
  const abs = Math.abs(num);
  if (abs >= 1e14) return ">999T";
  if (abs >= 1e12) return `${(num / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
}

const formatFeePercent = (feeTier) => {
  const num = Number(feeTier);
  if (!Number.isFinite(num) || num <= 0) return "";
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

function StatCard({ label, value, prefix = "$" }) {
  return (
    <div className="rounded-2xl bg-slate-900/70 border border-slate-800 px-4 py-3 shadow-inner shadow-black/30">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
        {label}
      </div>
      <div className="text-xl font-semibold text-slate-50">
        {value === null || value === undefined ? "--" : `${prefix}${formatNumber(value)}`}
      </div>
    </div>
  );
}

const formatDateLabel = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const formatDateTooltip = (ts) => {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
    });
  } catch {
    return "";
  }
};

function LineGlowChart({
  data,
  height = 220,
  color = "#4ade80",
  label = "line",
  topPaddingRatio = 0,
  centerMax = false,
}) {
  const containerRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(null);

  if (!data || data.length < 2) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-500">
        No data
      </div>
    );
  }

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const baseRange = max - min || 1;
  const maxWithPadding = centerMax
    ? min + baseRange * 2
    : max + Math.abs(max) * topPaddingRatio;
  const range = maxWithPadding - min || 1;
  const width = Math.max(520, values.length * 44);

  const pointPairs = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * width;
    const y = height - ((v - min) / range) * height;
    return { x, y };
  });
  const points = pointPairs.map(({ x, y }) => `${x},${y}`);
  const activePoint =
    activeIndex !== null && pointPairs[activeIndex]
      ? {
          ...data[activeIndex],
          ...pointPairs[activeIndex],
        }
      : null;

  const gradientId = `line-grad-${label}`;
  const glowId = `line-glow-${label}`;
  const ticks = [0, Math.floor(values.length / 2), values.length - 1].filter(
    (i, idx, arr) => arr.indexOf(i) === idx && i >= 0 && i < values.length
  );
  const last = pointPairs[pointPairs.length - 1];

  const handleMove = (clientX) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relativeX = clientX - rect.left;
    const ratio = Math.min(Math.max(relativeX / rect.width, 0), 1);
    const idx = Math.round(ratio * (values.length - 1));
    setActiveIndex(idx);
  };

  const clearActive = () => setActiveIndex(null);

  return (
    <div
      ref={containerRef}
      className="relative h-full"
      onMouseMove={(e) => handleMove(e.clientX)}
      onMouseLeave={clearActive}
      onTouchMove={(e) => {
        if (e.touches?.[0]) handleMove(e.touches[0].clientX);
      }}
      onTouchEnd={clearActive}
      onTouchCancel={clearActive}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.27" />
            <stop offset="100%" stopColor={color} stopOpacity="0.045" />
          </linearGradient>
          <pattern id={`${label}-grid`} width="36" height="18" patternUnits="userSpaceOnUse">
            <path
              d="M 36 0 L 0 0 0 18"
              fill="none"
              stroke="rgba(148,163,184,0.14)"
              strokeWidth="1"
            />
          </pattern>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${label}-grid)`} opacity="0.24" />
        <line
          x1="0"
          x2={width}
          y1={height - 1}
          y2={height - 1}
          stroke="rgba(148,163,184,0.18)"
          strokeWidth="1"
        />
        <rect
          width="100%"
          height="100%"
          fill={`url(#${gradientId})`}
          opacity="0.16"
        />
        <polygon
          fill={`url(#${gradientId})`}
          points={`${points.join(" ")} ${width},${height} 0,${height}`}
          opacity="0.65"
        />
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeOpacity="0.78"
          points={points.join(" ")}
          filter={`url(#${glowId})`}
        />
        {last && (
          <>
            <circle cx={last.x} cy={last.y} r="4.5" fill={color} opacity="0.75" />
            <circle cx={last.x} cy={last.y} r="9" fill={color} opacity="0.1" />
          </>
        )}
        {activePoint && (
          <>
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={0}
              y2={height}
              stroke={color}
              strokeOpacity="0.28"
              strokeDasharray="4 3"
            />
            <circle cx={activePoint.x} cy={activePoint.y} r="5" fill="#0f172a" stroke={color} strokeWidth="2" />
          </>
        )}
      </svg>
      {activePoint && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ left: 0, top: 0 }}
        >
          <div
            className="absolute -translate-x-1/2"
            style={{
              left: `${(activePoint.x / width) * 100}%`,
              top: Math.max(0, (activePoint.y / height) * 100 - 8) + "%",
            }}
          >
            <div className="mb-2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900/95 px-2.5 py-1.5 text-[11px] shadow-lg shadow-black/40">
              <div className="font-semibold text-slate-100">{activePoint.fullLabel || activePoint.label}</div>
              <div className="text-slate-300">
                {label === "tvl"
                  ? "TVL"
                  : label === "volume"
                  ? "Volume"
                  : label === "fees"
                  ? "Fees"
                  : "Value"}: ${formatNumber(activePoint.value || 0)}
              </div>
              {activePoint.isLive && (
                <div className="text-[10px] uppercase tracking-wide text-emerald-300/80">Live</div>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="absolute inset-x-3 bottom-2 flex justify-between text-[11px] text-slate-600">
        {ticks.map((i) => (
          <span key={i}>{data[i]?.label || ""}</span>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard({ onSelectPool }) {
  const { data, isLoading, error } = useDashboardData();
  const stats = data.stats;
  const tvlHistory = data.tvlHistory;
  const volumeHistory = data.volumeHistory;
  const topPairs = data.topPairs;
  const tvlStartDate = data.tvlStartDate;
  const volumeStartDate = data.volumeStartDate;
  const tvlHistoryFiltered = useMemo(() => {
    if (!tvlStartDate) return tvlHistory;
    return tvlHistory.filter((d) => d.date >= tvlStartDate);
  }, [tvlHistory, tvlStartDate]);

  const tvlSeries = useMemo(() => {
    return tvlHistoryFiltered
      .slice()
      .reverse()
      .map((d) => ({
        label: formatDateLabel(d.date),
        fullLabel: formatDateTooltip(d.date),
        value: Number.isFinite(Number(d.tvlUsd)) ? Number(d.tvlUsd) : 0,
        rawDate: d.date,
      }));
  }, [tvlHistoryFiltered]);

  const volumeHistoryFiltered = useMemo(() => {
    if (!volumeStartDate) return volumeHistory;
    return volumeHistory.filter((d) => d.date >= volumeStartDate);
  }, [volumeHistory, volumeStartDate]);

  const volumeSeries = useMemo(
    () =>
      volumeHistoryFiltered
        .slice()
        .reverse()
        .map((d) => ({
          label: formatDateLabel(d.date),
          fullLabel: formatDateTooltip(d.date),
          value: d.volumeUsd,
          rawDate: d.date,
        })),
    [volumeHistoryFiltered]
  );

  const feesSeries = useMemo(
    () =>
      volumeHistoryFiltered
        .slice()
        .reverse()
        .map((d) => {
          const feeValue = Number(d.feesUsd);
          return {
            label: formatDateLabel(d.date),
            fullLabel: formatDateTooltip(d.date),
            value: Number.isFinite(feeValue) ? feeValue : 0,
            rawDate: d.date,
          };
        }),
    [volumeHistoryFiltered]
  );

  const handleTopPoolSelect = (pair) => {
    if (typeof onSelectPool !== "function" || !pair) return;
    onSelectPool({
      id: pair.id,
      type: pair.type,
      feeTier: pair.feeTier,
      token0Id: pair.token0Id,
      token1Id: pair.token1Id,
      token0Symbol: pair.token0Symbol,
      token1Symbol: pair.token1Symbol,
    });
  };

  const latestDay = volumeHistory?.[0];
  const dayVolume = latestDay?.volumeUsd ?? null;

  const hasCumulativeVolume =
    typeof latestDay?.cumulativeVolumeUsd === "number" &&
    latestDay.cumulativeVolumeUsd > 0 &&
    typeof stats?.totalVolumeUsd === "number";

  const todayVolume = hasCumulativeVolume
    ? Math.max(0, stats.totalVolumeUsd - latestDay.cumulativeVolumeUsd)
    : null;

  const dailyVolumeUsd = dayVolume ?? todayVolume;
  const dailyFeesRaw = latestDay?.feesUsd;
  const dailyFees =
    Number.isFinite(dailyFeesRaw) ? dailyFeesRaw : latestDay ? 0 : null;
  const latestVolumeDate = volumeHistory?.[0]?.date ?? null;

  const volumeSeriesWithToday = useMemo(() => {
    if (!volumeSeries.length) return [];
    const todayPoint =
      todayVolume !== null && Number.isFinite(latestVolumeDate)
        ? {
            label: "Today",
            fullLabel: formatDateTooltip(latestVolumeDate),
            value: todayVolume,
            rawDate: latestVolumeDate,
            isLive: true,
          }
        : null;
    return todayPoint ? [...volumeSeries, todayPoint] : volumeSeries;
  }, [volumeSeries, todayVolume, latestVolumeDate]);


  return (
    <div className="w-full px-4 pb-10 pt-2 sm:px-6 lg:px-10 text-slate-100">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">Dashboard</h2>
        </div>
            {error && (
              <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
                {error?.message || "Failed to load dashboard"}
              </div>
            )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 gap-6">
        <div className="md:col-span-6 lg:col-span-6 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl shadow-black/30 p-6 sm:p-7">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Protocol TVL</div>
              <div className="mt-2 text-[36px] leading-none font-black tracking-[-0.04em] text-white">
                ${formatNumber(stats?.totalLiquidityUsd ?? tvlHistory[0]?.tvlUsd ?? 0)}
              </div>
            </div>
          </div>
          <div className="h-48">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Loading...
              </div>
            ) : (
              <LineGlowChart
                data={tvlSeries}
                color="#557f90"
                label="tvl"
                centerMax
              />
            )}
          </div>
        </div>

        <div className="md:col-span-3 lg:col-span-3 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl shadow-black/30 p-6 sm:p-7">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Protocol volume (24h)</div>
              <div className="mt-2 text-[30px] leading-none font-bold tracking-tight text-slate-100/90">
                ${formatNumber(dailyVolumeUsd)}
              </div>
            </div>
          </div>
          <div className="h-48">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Loading...
              </div>
            ) : (
              <LineGlowChart
                data={volumeSeriesWithToday}
                color="#618878"
                label="volume"
                centerMax
              />
            )}
          </div>
        </div>

        <div className="md:col-span-3 lg:col-span-3 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl shadow-black/30 p-6 sm:p-7">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Protocol fees (24h)</div>
              <div className="mt-2 text-[30px] leading-none font-bold tracking-tight text-slate-100/90">
                ${formatNumber(dailyFees)}
              </div>
            </div>
          </div>
          <div className="h-48">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Loading...
              </div>
            ) : (
              <LineGlowChart
                data={feesSeries}
                color="#9a875e"
                label="fees"
                centerMax
              />
            )}
          </div>
        </div>
      </div>

      <div className="mt-[2.625rem] rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl shadow-black/30 p-6 sm:p-7">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-lg font-semibold text-slate-50">Top pools</div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">by TVL</div>
          </div>
          <div className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-slate-700/70 bg-slate-900/70 px-2.5 py-1 text-[10px] text-slate-300 uppercase tracking-wide">
            <span className="h-1 w-1 rounded-full bg-sky-300/60" />
            Top 4
          </div>
        </div>
        <div className="space-y-5">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="h-4 w-32 rounded bg-slate-800 animate-pulse" />
                  <div className="h-4 w-10 rounded bg-slate-800 animate-pulse" />
                </div>
                <div className="h-3 w-full rounded-full bg-slate-800 animate-pulse" />
              </div>
            ))
          ) : topPairs.length ? (
            topPairs.map((pair, index) => {
              const isTopPool = index === 0;
              const width =
                pair.share > 0
                  ? Math.min(100, Math.max(pair.share || 0, 6))
                  : 0;
              const meta0 = resolveTokenMeta(pair.token0Id, pair.token0Symbol);
              const meta1 = resolveTokenMeta(pair.token1Id, pair.token1Symbol);
              const symbol0 =
                meta0?.displaySymbol || meta0?.symbol || pair.token0Symbol || "Token0";
              const symbol1 =
                meta1?.displaySymbol || meta1?.symbol || pair.token1Symbol || "Token1";
              const feeLabel =
                pair.type === "V3" && pair.feeTier ? formatFeePercent(pair.feeTier) : "";
              return (
                <button
                  key={pair.id}
                  type="button"
                  onClick={() => handleTopPoolSelect(pair)}
                  className={`group space-y-2 rounded-2xl ${
                    isTopPool
                      ? "border border-slate-700/80 bg-slate-900/62 px-3 py-3.5"
                      : "border border-slate-800/60 bg-slate-900/28 px-2.5 py-2.5 hover:border-slate-700/80 hover:bg-slate-900/45 transition-colors"
                  } ${
                    typeof onSelectPool === "function"
                      ? "w-full text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60"
                      : "w-full text-left"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {[meta0, meta1].map((t, idx) => (
                          <div
                            key={idx}
                            className="h-7 w-7 rounded-full border border-slate-800 bg-slate-900 flex items-center justify-center overflow-hidden text-[9px] font-semibold text-slate-200"
                          >
                            <img
                              src={t?.logo || DEFAULT_TOKEN_LOGO}
                              alt={`${idx === 0 ? symbol0 : symbol1} logo`}
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
                      <div className="flex flex-wrap items-center gap-2">
                        <div className={`${isTopPool ? "text-base" : "text-sm"} font-semibold text-white`}>
                          {symbol0} / {symbol1}
                        </div>
                        {feeLabel ? (
                          <span className="px-2 py-0.5 rounded-full border border-slate-700/60 bg-slate-900/60 text-[10px] text-slate-200">
                            {feeLabel}
                          </span>
                        ) : null}
                        <span className="text-[10px] uppercase tracking-wide text-slate-500">
                          {pair.type || "Pool"}
                        </span>
                      </div>
                    </div>
                    <div className={`${isTopPool ? "text-lg font-bold" : "text-base font-semibold"} text-white`}>
                      {Math.round(pair.share || 0)}%
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span
                      className={`${
                        isTopPool ? "text-sm font-semibold text-slate-100" : "text-sm font-medium text-slate-200"
                      }`}
                    >
                      TVL: ${formatNumber(pair.tvlUsd || 0)}
                    </span>
                  </div>
                  <div
                    className={`mt-1.5 w-full rounded-full bg-slate-900/90 border border-slate-800 overflow-hidden ${
                      isTopPool ? "h-2" : "h-1.5"
                    }`}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${width}%`,
                        background: isTopPool
                          ? "linear-gradient(90deg, #3f5d6f 0%, #4f7287 50%, #668ea8 100%)"
                          : "linear-gradient(90deg, #3c5869 0%, #4b6c80 50%, #6188a1 100%)",
                      }}
                    />
                  </div>
                </button>
              );
            })
          ) : (
            <div className="py-4 text-center text-sm text-slate-500">
              No pool TVL data found in the subgraph for the latest day.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
