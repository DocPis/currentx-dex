// src/components/Farms.jsx
import React from "react";
import { TOKENS } from "../config/web3";

const farms = [
  {
    id: "weth-usdc",
    name: "WETH / USDC Farm",
    pair: "WETH / USDC",
    apr: 28.4,
    tvlUsd: 421000,
    emissionToken: TOKENS.CRX,
    status: "Active",
  },
  {
    id: "weth-dai",
    name: "WETH / DAI Farm",
    pair: "WETH / DAI",
    apr: 18.7,
    tvlUsd: 192500,
    emissionToken: TOKENS.CRX,
    status: "Active",
  },
];

function formatNumber(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

export default function Farms({ address, onConnect }) {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 py-8 text-slate-100">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Farms</h2>
          <p className="text-sm text-slate-400">
            Deposit your LP tokens and earn our native token (CRX).
          </p>
        </div>
        <button
          type="button"
          onClick={onConnect}
          className="px-4 py-2 rounded-full bg-sky-600 text-sm font-semibold text-white shadow-lg shadow-sky-500/30"
        >
          {address ? "Connected" : "Connect wallet"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {farms.map((farm) => (
          <div
            key={farm.id}
            className="rounded-3xl bg-slate-900/70 border border-slate-800 shadow-xl shadow-black/30 p-5 flex flex-col gap-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">
                  {farm.name}
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-2">
                  {farm.pair}
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    {farm.status}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="h-2 w-2 rounded-full bg-sky-400" />
                {farm.emissionToken?.symbol} emissions
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-slate-900 border border-slate-800 px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  APR
                </div>
                <div className="text-xl font-semibold">
                  {farm.apr.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-2xl bg-slate-900 border border-slate-800 px-3 py-3 text-right">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  TVL
                </div>
                <div className="text-xl font-semibold">{formatNumber(farm.tvlUsd)}</div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-xs text-slate-400">
                Earn {farm.emissionToken?.symbol || "CRX"} on your LP deposits. Coming soon to mainnet.
              </div>
              <button
                type="button"
                disabled
                className="px-4 py-2 rounded-full bg-slate-800 text-slate-300 text-sm font-semibold border border-slate-700 disabled:opacity-70"
              >
                Deposit LP (soon)
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
