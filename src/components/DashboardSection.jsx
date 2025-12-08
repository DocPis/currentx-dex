// src/components/DashboardSection.jsx
import { useState } from "react";

function StatCard({ label, value, delta, caption }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-slate-400">{label}</div>
        {delta && (
          <div
            className={`text-[11px] ${
              delta.startsWith("-") ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {delta}
          </div>
        )}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-50">{value}</div>
      {caption && (
        <div className="mt-1 text-[11px] text-slate-500">{caption}</div>
      )}
    </div>
  );
}

function TopPoolRow({ pair, tvl, volume, apr, fees }) {
  return (
    <tr className="border-b border-slate-900/70 text-xs">
      <td className="py-2 pr-3 text-slate-100">{pair}</td>
      <td className="py-2 pr-3 text-slate-300">{tvl}</td>
      <td className="py-2 pr-3 text-slate-300">{volume}</td>
      <td className="py-2 pr-3 text-slate-300">{fees}</td>
      <td className="py-2">
        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-[2px] text-[10px] font-medium text-emerald-300">
          {apr}
        </span>
      </td>
    </tr>
  );
}

export default function DashboardSection() {
  const [range, setRange] = useState("24h");
  const ranges = ["24h", "7d", "30d", "1y"];

  return (
    <div className="space-y-4">
      {/* Row 1: metrics */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl shadow-black/60">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-50">
              Protocol Overview
            </h2>
            <p className="text-[11px] text-slate-400">
              TVL, volume and fees aggregated across all pools on CurrentX.
            </p>
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-slate-900/80 px-2 py-1 text-[10px] text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>Live (placeholder)</span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <StatCard
            label="Total Value Locked"
            value="$128,452,930"
            delta="+3.2% 24h"
            caption="Across all pools"
          />
          <StatCard
            label="Volume (24h)"
            value="$18,937,201"
            delta="+11.4% 24h"
            caption="Swaps executed"
          />
          <StatCard
            label="Fees (24h)"
            value="$231,987"
            delta="+9.1% 24h"
            caption="Paid to LPs"
          />
          <StatCard
            label="Active wallets"
            value="12,304"
            delta="+4.7% 24h"
            caption="Unique traders"
          />
        </div>
      </div>

      {/* Row 2: chart + positions */}
      <div className="grid gap-4 md:grid-cols-[7fr_5fr]">
        {/* Chart card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl shadow-black/60">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-50">
                TVL & Volume
              </div>
              <div className="text-[11px] text-slate-400">
                Simulated chart — we&apos;ll plug real analytics here later.
              </div>
            </div>

            <div className="flex gap-1 rounded-full bg-slate-900/80 p-1 text-[10px] text-slate-400">
              {ranges.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`rounded-full px-2 py-0.5 ${
                    range === r
                      ? "bg-slate-800 text-slate-100"
                      : "hover:text-slate-200"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Fake chart */}
          <div className="relative mt-2 h-40 rounded-xl border border-slate-800 bg-gradient-to-b from-slate-900 via-slate-950 to-black">
            <div className="absolute inset-0">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="absolute inset-x-0 border-t border-slate-800/50"
                  style={{ top: `${i * 25}%` }}
                />
              ))}
            </div>
            <div className="absolute inset-2 flex items-end gap-1">
              {[20, 40, 30, 50, 45, 70, 55, 60, 52, 65, 58, 72].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-cyan-400/25"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
            <svg className="absolute inset-2 h-[calc(100%-16px)] w-[calc(100%-16px)]">
              <polyline
                fill="none"
                stroke="url(#tvlGradient)"
                strokeWidth="2"
                points="0,80 30,70 60,72 90,60 120,62 150,55 180,50 210,52 240,47 270,44 300,46 330,40"
              />
              <defs>
                <linearGradient id="tvlGradient" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor="#22c55e" />
                  <stop offset="100%" stopColor="#22d3ee" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>

        {/* Your positions */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-50">
                Your positions
              </div>
              <div className="text-[11px] text-slate-400">
                Once you provide liquidity, your LP tokens will show up here.
              </div>
            </div>
            <button className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-[11px] text-slate-100">
              Manage in Liquidity
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-900/60 px-3 py-3 text-xs text-slate-400">
            You don&apos;t have any active positions yet.
            <br />
            <span className="text-slate-300">
              Add liquidity in the Liquidity tab to start earning fees.
            </span>
          </div>
        </div>
      </div>

      {/* Row 3: top pools */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl shadow-black/60">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-50">Top pools</div>
            <div className="text-[11px] text-slate-400">
              Pools ranked by TVL and 24h volume on CurrentX.
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-y-[2px] text-left text-xs">
            <thead>
              <tr className="text-[11px] text-slate-400">
                <th className="pb-1 pr-3 font-normal">Pool</th>
                <th className="pb-1 pr-3 font-normal">TVL</th>
                <th className="pb-1 pr-3 font-normal">Volume 24h</th>
                <th className="pb-1 pr-3 font-normal">Fees 24h</th>
                <th className="pb-1 font-normal">APR</th>
              </tr>
            </thead>
            <tbody>
              <TopPoolRow
                pair="ETH / USDC"
                tvl="$45.2M"
                volume="$6.9M"
                fees="$42.1K"
                apr="18.3%"
              />
              <TopPoolRow
                pair="USDC / USDT"
                tvl="$32.1M"
                volume="$3.4M"
                fees="$18.7K"
                apr="7.9%"
              />
              <TopPoolRow
                pair="ETH / wBTC"
                tvl="$18.6M"
                volume="$2.1M"
                fees="$12.3K"
                apr="12.4%"
              />
              <TopPoolRow
                pair="cbETH / ETH"
                tvl="$12.4M"
                volume="$1.3M"
                fees="$7.6K"
                apr="10.1%"
              />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
