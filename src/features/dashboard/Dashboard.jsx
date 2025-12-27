// src/features/dashboard/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  fetchDashboardStats,
  fetchProtocolHistory,
  fetchRecentTransactions,
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

const TYPE_BADGE = {
  Swap: "bg-sky-500/15 text-sky-100 border border-sky-500/30",
  Mint: "bg-emerald-500/15 text-emerald-100 border border-emerald-500/30",
  Burn: "bg-rose-500/15 text-rose-100 border border-rose-500/30",
};

const shortenHash = (hash = "") =>
  hash ? `${hash.slice(0, 6)}...${hash.slice(-4)}` : "--";

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

  const gradientId = `line-grad-${label}`;
  const glowId = `line-glow-${label}`;
  const ticks = [0, Math.floor(values.length / 2), values.length - 1].filter(
    (i, idx, arr) => arr.indexOf(i) === idx && i >= 0 && i < values.length
  );
  const last = pointPairs[pointPairs.length - 1];

  return (
    <div className="relative h-full">
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
      </svg>
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
  const barWidth = Math.max(6, Math.floor(minWidth / (values.length * 1.5)));
  const width = Math.max(minWidth, (barWidth + 3) * values.length);

  const ticks = [0, Math.floor(values.length / 2), values.length - 1].filter(
    (i, idx, arr) => arr.indexOf(i) === idx && i >= 0 && i < values.length
  );

  return (
    <div className="relative h-full">
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
        {values.map((v, i) => {
          const x = i * (barWidth + 2);
          const h = (v / max) * (height - 10);
          const y = height - h;
          return (
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
          );
        })}
      </svg>
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
  const [recentTxs, setRecentTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setError("");
        setLoading(true);

        const [s, h, txs] = await Promise.all([
          fetchDashboardStats(),
          fetchProtocolHistory(7),
          fetchRecentTransactions(15),
        ]);

        if (cancelled) return;
        setStats(s);
        setHistory(h);
        setRecentTxs(txs || []);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const tvlSeries = useMemo(
    () =>
      history
        .slice()
        .reverse()
        .map((d) => ({ label: formatDateLabel(d.date), value: d.tvlUsd })),
    [history]
  );

  const volumeSeries = useMemo(
    () =>
      history
        .slice()
        .reverse()
        .map((d) => ({ label: formatDateLabel(d.date), value: d.volumeUsd })),
    [history]
  );

  const latestDay = history?.[0];
  const todayVolume =
    stats?.totalVolumeUsd !== undefined &&
    latestDay?.cumulativeVolumeUsd !== undefined
      ? Math.max(0, stats.totalVolumeUsd - latestDay.cumulativeVolumeUsd)
      : null;
  const dayVolume = latestDay?.volumeUsd ?? null;
  const dailyVolumeUsd = todayVolume !== null ? todayVolume : dayVolume;
  const dailyFees = dailyVolumeUsd !== null ? dailyVolumeUsd * 0.003 : null;
  const liveTvl = stats?.totalLiquidityUsd;

  const tvlSeriesWithToday = useMemo(() => {
    if (!tvlSeries.length) return [];
    const livePoint =
      liveTvl !== undefined
        ? { label: "Today", value: liveTvl }
        : null;
    return livePoint ? [...tvlSeries, livePoint] : tvlSeries;
  }, [tvlSeries, liveTvl]);

  const volumeSeriesWithToday = useMemo(() => {
    if (!volumeSeries.length) return [];
    const todayPoint =
      todayVolume !== null
        ? { label: "Today", value: todayVolume }
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
            <div className="text-lg font-semibold text-slate-50">Latest transactions</div>
          </div>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="py-6 text-center text-sm text-slate-500">Loading...</div>
          ) : (
            <table className="min-w-full text-sm text-left">
              <thead className="text-slate-400 text-xs uppercase">
                <tr>
                  <th className="py-2 pr-4 whitespace-nowrap">Time</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Pair</th>
                  <th className="py-2 pr-4 text-right">Value (USD)</th>
                  <th className="py-2 pr-4 text-right">Account</th>
                  <th className="py-2 pl-4 text-right">Tx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-100">
                {recentTxs.map((tx) => (
                  <tr key={`${tx.txHash || tx.timestamp}-${tx.type}`}>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {tx.timestamp ? new Date(tx.timestamp).toLocaleString() : "--"}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${TYPE_BADGE[tx.type] || "bg-slate-800 text-slate-200 border border-slate-700"}`}
                      >
                        {tx.type || "--"}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{tx.pair || "--"}</td>
                    <td className="py-2 pr-4 text-right">
                      {tx.amountUsd === null || tx.amountUsd === undefined
                        ? "N/A"
                        : `$${formatNumber(tx.amountUsd)}`}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {tx.account ? shortenHash(tx.account) : "--"}
                    </td>
                    <td className="py-2 pl-4 text-right">
                      {tx.txHash ? (
                        <a
                          href={`https://sepolia.etherscan.io/tx/${tx.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-400 hover:text-sky-300 underline"
                        >
                          {shortenHash(tx.txHash)}
                        </a>
                      ) : (
                        "--"
                      )}
                    </td>
                  </tr>
                ))}
                {!recentTxs.length && !loading && (
                  <tr>
                    <td colSpan={6} className="py-3 text-center text-slate-500">
                      No transactions found in the subgraph.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
