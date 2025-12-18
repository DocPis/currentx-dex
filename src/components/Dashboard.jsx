// src/components/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  fetchDashboardStats,
  fetchProtocolHistory,
} from "../config/subgraph";

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
  const width = 520;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });

  const gradientId = `line-grad-${label}`;
  const glowId = `line-glow-${label}`;
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
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
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
  const barWidth = Math.max(4, Math.floor(minWidth / (values.length * 1.6)));
  const width = Math.max(minWidth, (barWidth + 2) * values.length);

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
        </defs>
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
              fill={color}
              opacity="0.9"
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setError("");
        setLoading(true);

        const [s, h] = await Promise.all([
          fetchDashboardStats(),
          fetchProtocolHistory(7),
        ]);

        if (cancelled) return;
        setStats(s);
        setHistory(h);
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
          label="Pairs"
          value={stats?.pairCount}
          prefix=""
        />
        <StatCard
          label="Tx count"
          value={stats?.txCount}
          prefix=""
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
            </div>
          </div>
          <div className="h-56">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Loading...
              </div>
            ) : (
              <LineGlowChart
                data={tvlSeries}
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
        </div>
          </div>
          <div className="h-56">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Loading...
              </div>
            ) : (
              <BarGlowChart
                data={volumeSeries}
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
            <div className="text-sm text-slate-400">Protocol metrics (last {history.length} days)</div>
            <div className="text-lg font-semibold text-slate-50">Sepolia Uniswap V2</div>
          </div>
            <div className="text-xs text-slate-500">
              Subgraph endpoint: {import.meta.env.VITE_UNIV2_SUBGRAPH ? "configured" : "missing VITE_UNIV2_SUBGRAPH"}
            </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left">
            <thead className="text-slate-400 text-xs uppercase">
              <tr>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4 text-right">TVL</th>
                <th className="py-2 pr-4 text-right">Volume 24h</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-100">
              {history.map((d) => (
                <tr key={d.date}>
                  <td className="py-2 pr-4">
                    {new Date(d.date).toLocaleDateString()}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    ${formatNumber(d.tvlUsd)}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    ${formatNumber(d.volumeUsd)}
                  </td>
                </tr>
              ))}
              {!history.length && !loading && (
                <tr>
                  <td colSpan={3} className="py-3 text-center text-slate-500">
                    No data available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
