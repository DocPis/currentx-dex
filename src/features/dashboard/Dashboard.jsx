// src/features/dashboard/Dashboard.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchDashboardStats,
  fetchProtocolHistory,
  fetchTopPairsBreakdown,
} from "../../shared/config/subgraph";

function formatNumber(num) {
  if (num === null || num === undefined) return "--";
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

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
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [topPairs, setTopPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let loadingInFlight = false;

    const load = async (isBackground = false) => {
      if (loadingInFlight) return;
      loadingInFlight = true;
      try {
        setError("");
        if (!isBackground) setLoading(true);

        const [s, h, pairs] = await Promise.all([
          fetchDashboardStats(),
          fetchProtocolHistory(7),
          fetchTopPairsBreakdown(4),
        ]);

        if (cancelled) return;
        setStats(s);
        setHistory(h);
        setTopPairs(pairs || []);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load dashboard");
      } finally {
        if (!cancelled && !isBackground) setLoading(false);
        loadingInFlight = false;
      }
    };

    load(false);
    const interval = setInterval(() => load(true), 5 * 60 * 1000); // refresh every 5m

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const tvlSeries = useMemo(
    () =>
      history
        .slice()
        .reverse()
        .map((d) => ({
          label: formatDateLabel(d.date),
          fullLabel: new Date(d.date).toLocaleString(),
          value: d.tvlUsd,
          rawDate: d.date,
        })),
    [history]
  );

  const volumeSeries = useMemo(
    () =>
      history
        .slice()
        .reverse()
        .map((d) => ({
          label: formatDateLabel(d.date),
          fullLabel: new Date(d.date).toLocaleString(),
          value: d.volumeUsd,
          rawDate: d.date,
        })),
    [history]
  );

  const latestDay = history?.[0];
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

  const tvlSeriesWithToday = useMemo(() => {
    if (!tvlSeries.length) return [];
    const livePoint =
      liveTvl !== undefined
        ? {
            label: "Today",
            fullLabel: new Date().toLocaleString(),
            value: liveTvl,
            rawDate: Date.now(),
            isLive: true,
          }
        : null;
    return livePoint ? [...tvlSeries, livePoint] : tvlSeries;
  }, [tvlSeries, liveTvl]);

  const volumeSeriesWithToday = useMemo(() => {
    if (!volumeSeries.length) return [];
    const todayPoint =
      todayVolume !== null
        ? {
            label: "Today",
            fullLabel: new Date().toLocaleString(),
            value: todayVolume,
            rawDate: Date.now(),
            isLive: true,
          }
        : null;
    return todayPoint ? [...volumeSeries, todayPoint] : volumeSeries;
  }, [volumeSeries, todayVolume]);

  const calcChange = (series) => {
    if (!series?.length || series.length < 2) return null;
    const first = series[0]?.value ?? 0;
    const last = series[series.length - 1]?.value ?? 0;
    const diff = last - first;
    const pct = first ? (diff / first) * 100 : null;
    return { diff, pct };
  };

  const tvlChange = calcChange(tvlSeriesWithToday);
  const volumeChange = calcChange(volumeSeriesWithToday);

  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 py-8 text-slate-100">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Dashboard</h2>
          <p className="text-sm text-slate-400">
            Live protocol TVL and volume from the Sepolia subgraph (last 7 days).
          </p>
        </div>
        {error && (
          <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
            {error}
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
                ${formatNumber(history[0]?.tvlUsd || stats?.totalLiquidityUsd || 0)}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-2 w-2 rounded-full bg-sky-400" />
              Last {history.length} days
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
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Loading...
              </div>
            ) : (
              <LineGlowChart
                data={tvlSeriesWithToday}
                color="#4ade80"
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
                ${formatNumber(history[0]?.volumeUsd || stats?.totalVolumeUsd || 0)}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Last {history.length} days
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
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Loading...
              </div>
            ) : (
              <BarGlowChart
                data={volumeSeriesWithToday}
                color="#4ade80"
                label="volume"
              />
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-3xl bg-slate-900/70 border border-slate-800 shadow-xl shadow-black/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-lg font-semibold text-slate-50">Top pairs breakdown</div>
            <div className="text-xs text-slate-400">
              Volume dominance across the latest indexed day (24h).
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-400 uppercase tracking-wide">
            <span className="h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.8)]" />
            24h volume
          </div>
        </div>
        <div className="space-y-4">
          {loading ? (
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
              return (
                <div key={pair.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-baseline gap-2">
                      <div className="text-sm font-semibold text-white">
                        {pair.label}
                      </div>
                      <div className="text-[11px] uppercase text-slate-500 tracking-wide">
                        24h volume
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-rose-300">
                      {Math.round(pair.share || 0)}%
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Volume (USD)</span>
                    <span className="text-slate-200">
                      ${formatNumber(pair.volumeUsd || 0)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-3 w-full rounded-full bg-slate-800/80 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${width}%`,
                        background:
                          "linear-gradient(90deg, #fb7185 0%, #ec4899 45%, #c084fc 100%)",
                        boxShadow: "0 0 18px rgba(236, 72, 153, 0.35)",
                      }}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-4 text-center text-sm text-slate-500">
              No pair data found in the subgraph for the latest day.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
