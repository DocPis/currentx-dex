// src/features/dashboard/Dashboard.jsx
import React, { useMemo, useRef, useState } from "react";
import { useDashboardData } from "../../shared/hooks/useDashboardData";
import { TOKENS } from "../../shared/config/tokens";

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

function LineGlowChart({
  data,
  height = 220,
  color = "#4ade80",
  label = "line",
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
  const range = max - min || 1;
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
            <stop offset="0%" stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} stopOpacity="0.08" />
          </linearGradient>
          <pattern id={`${label}-grid`} width="36" height="18" patternUnits="userSpaceOnUse">
            <path d="M 36 0 L 0 0 0 18" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          </pattern>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${label}-grid)`} opacity="0.6" />
        <rect
          width="100%"
          height="100%"
          fill={`url(#${gradientId})`}
          opacity="0.25"
        />
        <polygon
          fill={`url(#${gradientId})`}
          points={`${points.join(" ")} ${width},${height} 0,${height}`}
          opacity="0.9"
        />
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="3"
          points={points.join(" ")}
          filter={`url(#${glowId})`}
        />
        {last && (
          <>
            <circle cx={last.x} cy={last.y} r="4.5" fill={color} opacity="0.9" />
            <circle cx={last.x} cy={last.y} r="9" fill={color} opacity="0.15" />
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
              strokeOpacity="0.35"
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
                {label === "tvl" ? "TVL" : "Value"}: ${formatNumber(activePoint.value || 0)}
              </div>
              {activePoint.isLive && (
                <div className="text-[10px] uppercase tracking-wide text-emerald-300/80">Live</div>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="absolute inset-x-3 bottom-2 flex justify-between text-[11px] text-slate-500">
        {ticks.map((i) => (
          <span key={i}>{data[i]?.label || ""}</span>
        ))}
      </div>
    </div>
  );
}

function BarGlowChart({
  data,
  height = 220,
  color = "#4ade80",
  label = "bars",
}) {
  const containerRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-500">
        No data
      </div>
    );
  }

  const values = data.map((d) => d.value);
  const max = Math.max(...values, 1);
  const minWidth = 520;
  const gap = 6;
  const width = Math.max(minWidth, values.length * 28);
  const barWidth = Math.max(6, (width - gap * (values.length - 1)) / values.length);
  const barPositions = values.map((v, i) => {
    const x = i * (barWidth + gap);
    const h = (v / max) * (height - 10);
    const y = height - h;
    return { x, y, h };
  });
  const activeBar =
    activeIndex !== null && barPositions[activeIndex]
      ? {
          ...data[activeIndex],
          ...barPositions[activeIndex],
        }
      : null;

  const ticks = [0, Math.floor(values.length / 2), values.length - 1].filter(
    (i, idx, arr) => arr.indexOf(i) === idx && i >= 0 && i < values.length
  );

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
          <filter id={`bar-glow-${label}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id={`bar-grad-${label}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.9" />
            <stop offset="100%" stopColor={color} stopOpacity="0.35" />
          </linearGradient>
          <pattern id={`bar-grid-${label}`} width="36" height="18" patternUnits="userSpaceOnUse">
            <path d="M 36 0 L 0 0 0 18" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#bar-grid-${label})`} opacity="0.6" />
        <rect width="100%" height="100%" fill={`url(#bar-grad-${label})`} opacity="0.12" />
        {barPositions.map(({ x, y, h }, i) => (
          <rect
            key={`${label}-${i}`}
            x={x}
            y={y}
            width={barWidth}
            height={h}
            fill={`url(#bar-grad-${label})`}
            opacity="1"
            filter={`url(#bar-glow-${label})`}
          />
        ))}
        {activeBar && (
          <rect
            x={activeBar.x - 1}
            y={0}
            width={barWidth + 2}
            height={height}
            fill={color}
            opacity="0.08"
          />
        )}
      </svg>
      {activeBar && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ left: 0, top: 0 }}
        >
          <div
            className="absolute -translate-x-1/2"
            style={{
              left: `${((activeBar.x + barWidth / 2) / width) * 100}%`,
              top: `${Math.max(0, (activeBar.y / height) * 100 - 8)}%`,
            }}
          >
            <div className="mb-2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900/95 px-2.5 py-1.5 text-[11px] shadow-lg shadow-black/40">
              <div className="font-semibold text-slate-100">{activeBar.fullLabel || activeBar.label}</div>
              <div className="text-slate-300">
                {label === "volume" ? "Volume" : "Value"}: ${formatNumber(activeBar.value || 0)}
              </div>
              {activeBar.isLive && (
                <div className="text-[10px] uppercase tracking-wide text-emerald-300/80">Live</div>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="absolute inset-x-3 bottom-2 flex justify-between text-[11px] text-slate-500">
        {ticks.map((i) => (
          <span key={i}>{data[i]?.label || ""}</span>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading, error } = useDashboardData();
  const stats = data.stats;
  const tvlHistory = data.tvlHistory;
  const volumeHistory = data.volumeHistory;
  const topPairs = data.topPairs;
  const tvlStartDate = data.tvlStartDate;
  const tvlSeries = useMemo(() => {
    const dayMs = 86400000;
    const filtered = tvlHistory
      .filter((d) => d.date >= tvlStartDate)
      .slice()
      .sort((a, b) => a.date - b.date);
    if (!filtered.length) return [];
    const firstNonZero = filtered.find(
      (d) => Number.isFinite(Number(d.tvlUsd)) && Number(d.tvlUsd) > 0
    );
    let lastKnown =
      firstNonZero && Number.isFinite(Number(firstNonZero.tvlUsd))
        ? Number(firstNonZero.tvlUsd)
        : null;
    const byDay = new Map(
      filtered.map((d) => [
        Math.floor(d.date / dayMs) * dayMs,
        Number.isFinite(Number(d.tvlUsd)) ? Number(d.tvlUsd) : null,
      ])
    );
    const startDay = Math.floor(tvlStartDate / dayMs) * dayMs;
    const lastDate = filtered[filtered.length - 1]?.date ?? tvlStartDate;
    const endDay = Math.floor(lastDate / dayMs) * dayMs;
    const filled = [];
    for (let day = startDay; day <= endDay; day += dayMs) {
      const raw = byDay.get(day);
      if (raw !== null && raw > 0) {
        lastKnown = raw;
      }
      const value = lastKnown !== null ? lastKnown : 0;
      filled.push({
        label: formatDateLabel(day),
        fullLabel: new Date(day).toLocaleString(),
        value,
        rawDate: day,
      });
    }
    return filled;
  }, [tvlHistory, tvlStartDate]);

  const volumeSeries = useMemo(
    () =>
      volumeHistory
        .slice()
        .reverse()
        .map((d) => ({
          label: formatDateLabel(d.date),
          fullLabel: new Date(d.date).toLocaleString(),
          value: d.volumeUsd,
          rawDate: d.date,
        })),
    [volumeHistory]
  );

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
  const dailyFees = dailyVolumeUsd !== null ? dailyVolumeUsd * 0.003 : null;
  const liveTvl = stats?.totalLiquidityUsd;
  const latestTvlDate = tvlHistory?.[0]?.date ?? null;
  const latestVolumeDate = volumeHistory?.[0]?.date ?? null;

  const tvlSeriesWithToday = useMemo(() => {
    if (!tvlSeries.length) return [];
    const livePoint =
      liveTvl !== undefined && Number.isFinite(latestTvlDate)
        ? {
            label: "Today",
            fullLabel: new Date(latestTvlDate).toLocaleString(),
            value: liveTvl,
            rawDate: latestTvlDate,
            isLive: true,
          }
        : null;
    return livePoint ? [...tvlSeries, livePoint] : tvlSeries;
  }, [tvlSeries, liveTvl, latestTvlDate]);

  const volumeSeriesWithToday = useMemo(() => {
    if (!volumeSeries.length) return [];
    const todayPoint =
      todayVolume !== null && Number.isFinite(latestVolumeDate)
        ? {
            label: "Today",
            fullLabel: new Date(latestVolumeDate).toLocaleString(),
            value: todayVolume,
            rawDate: latestVolumeDate,
            isLive: true,
          }
        : null;
    return todayPoint ? [...volumeSeries, todayPoint] : volumeSeries;
  }, [volumeSeries, todayVolume, latestVolumeDate]);

  const calcChange = (series, options = {}) => {
    if (!series?.length || series.length < 2) return null;
    let startIdx = 0;
    if (options.preferNonZeroStart) {
      const idx = series.findIndex((point) => {
        const value = Number(point?.value ?? 0);
        return Number.isFinite(value) && value > 0;
      });
      if (idx >= 0 && idx < series.length - 1) {
        startIdx = idx;
      }
    }
    const first = Number(series[startIdx]?.value ?? 0);
    const last = Number(series[series.length - 1]?.value ?? 0);
    const diff = last - first;
    const pct = first ? (diff / first) * 100 : null;
    return { diff, pct };
  };

  const tvlChange = calcChange(tvlSeriesWithToday);
  const volumeChange = calcChange(volumeSeriesWithToday, { preferNonZeroStart: true });

  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 py-8 text-slate-100">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Dashboard</h2>
        </div>
            {error && (
              <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
                {error?.message || "Failed to load dashboard"}
              </div>
            )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total TVL" value={stats?.totalLiquidityUsd} />
        <StatCard label="Total Volume" value={stats?.totalVolumeUsd} />
        <StatCard
          label="24h Volume"
          value={dailyVolumeUsd}
        />
        <StatCard
          label="24h Fees (0.3%)"
          value={dailyFees}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-3xl bg-slate-900/70 border border-slate-800 shadow-xl shadow-black/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm text-slate-400">Protocol TVL</div>
              <div className="text-xl font-semibold">
                ${formatNumber(tvlHistory[0]?.tvlUsd || stats?.totalLiquidityUsd || 0)}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-2 w-2 rounded-full bg-sky-400" />
              {tvlChange && (
                <span
                  className={`px-2 py-1 rounded-full border text-[11px] ${
                    tvlChange.diff >= 0
                      ? "border-emerald-400/40 text-emerald-200 bg-emerald-400/10"
                      : "border-rose-400/40 text-rose-200 bg-rose-400/10"
                  }`}
                >
                  {tvlChange.diff >= 0 ? "+" : ""}
                  {formatNumber(Math.abs(tvlChange.diff))} ({tvlChange.pct ? tvlChange.pct.toFixed(1) : "0"}%)
                </span>
              )}
            </div>
          </div>
          <div className="h-56">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Loading...
              </div>
            ) : (
              <LineGlowChart
                data={tvlSeriesWithToday}
                color="#38bdf8"
                label="tvl"
              />
            )}
          </div>
        </div>

        <div className="rounded-3xl bg-slate-900/70 border border-slate-800 shadow-xl shadow-black/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm text-slate-400">Protocol volume (24h)</div>
              <div className="text-xl font-semibold">
                ${formatNumber(volumeHistory[0]?.volumeUsd || stats?.totalVolumeUsd || 0)}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Last {volumeHistory.length} days
              {volumeChange && (
                <span
                  className={`px-2 py-1 rounded-full border text-[11px] ${
                    volumeChange.diff >= 0
                      ? "border-emerald-400/40 text-emerald-200 bg-emerald-400/10"
                      : "border-rose-400/40 text-rose-200 bg-rose-400/10"
                  }`}
                >
                  {volumeChange.diff >= 0 ? "+" : ""}
                  {formatNumber(Math.abs(volumeChange.diff))} ({volumeChange.pct ? volumeChange.pct.toFixed(1) : "0"}%)
                </span>
              )}
            </div>
          </div>
          <div className="h-56">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Loading...
              </div>
            ) : (
              <BarGlowChart
                data={volumeSeriesWithToday}
                color="#38bdf8"
                label="volume"
              />
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-3xl bg-slate-900/70 border border-slate-800 shadow-xl shadow-black/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-lg font-semibold text-slate-50">Top pools by TVL</div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-400 uppercase tracking-wide">
            <span className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.7)]" />
            Top 4
          </div>
        </div>
        <div className="space-y-4">
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
            topPairs.map((pair) => {
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
                <div key={pair.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {[meta0, meta1].map((t, idx) => (
                          <div
                            key={idx}
                            className="h-7 w-7 rounded-full border border-slate-800 bg-slate-900 flex items-center justify-center overflow-hidden text-[9px] font-semibold text-slate-200"
                          >
                            {t?.logo ? (
                              <img
                                src={t.logo}
                                alt={`${t.symbol} logo`}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <span>{(idx === 0 ? symbol0 : symbol1).slice(0, 3)}</span>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-white">
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
                    <div className="text-sm font-semibold text-sky-200">
                      {Math.round(pair.share || 0)}%
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="text-slate-200">
                      TVL: ${formatNumber(pair.tvlUsd || 0)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-3 w-full rounded-full bg-slate-800/80 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${width}%`,
                        background:
                          "linear-gradient(90deg, #0e7490 0%, #0ea5e9 45%, #38bdf8 100%)",
                        boxShadow: "0 0 18px rgba(14, 165, 233, 0.32)",
                      }}
                    />
                  </div>
                </div>
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
