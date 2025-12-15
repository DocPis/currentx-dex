// src/components/Farms.jsx
import React, { useEffect, useState } from "react";
import { fetchMasterChefFarms, TOKENS } from "../config/web3";

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
      </div>

      <FarmsList address={address} onConnect={onConnect} />
    </div>
  );
}

function FarmsList({ address, onConnect }) {
  const [farms, setFarms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await fetchMasterChefFarms();
        if (cancelled) return;
        setFarms(data.pools || []);
      } catch (e) {
        if (!cancelled) setError(e?.message || "Unable to load farms");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-3xl bg-slate-900/70 border border-slate-800 p-5 animate-pulse space-y-3">
            <div className="h-5 bg-slate-800/80 rounded w-1/3" />
            <div className="h-4 bg-slate-800/70 rounded w-1/2" />
            <div className="h-20 bg-slate-800/60 rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
        {error}
      </div>
    );
  }

  if (!farms.length) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
        No farms available on-chain.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {farms.map((farm) => (
        <div
          key={`${farm.lpToken}-${farm.pid}`}
          className="rounded-3xl bg-slate-900/70 border border-slate-800 shadow-xl shadow-black/30 p-5 flex flex-col gap-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-100">
                {farm.pairLabel || "LP Farm"} (PID {farm.pid})
              </div>
              <div className="text-xs text-slate-500 flex items-center gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {(farm.tokens || []).map((token) => (
                      <img
                        key={token.address || token.symbol}
                        src={token.logo || TOKENS.CRX.logo}
                        alt={token.symbol}
                        className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900"
                      />
                    ))}
                  </div>
                  <span>{farm.pairLabel || farm.lpToken}</span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                  Active
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-2 w-2 rounded-full bg-sky-400" />
              {farm.rewardToken?.symbol} emissions
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-slate-900 border border-slate-800 px-3 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                APR
              </div>
              <div className="text-xl font-semibold">
                {farm.apr !== null && farm.apr !== undefined
                  ? `${farm.apr.toFixed(2)}%`
                  : "N/A"}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-900 border border-slate-800 px-3 py-3 text-right">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                TVL
              </div>
              <div className="text-xl font-semibold">
                {farm.tvlUsd !== null && farm.tvlUsd !== undefined
                  ? formatNumber(farm.tvlUsd)
                  : "N/A"}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-xs text-slate-400">
              Earn {farm.rewardToken?.symbol || "CRX"} with MasterChef rewards.
            </div>
            <button
              type="button"
              disabled={!address}
              onClick={() => {
                if (!address && onConnect) onConnect();
              }}
              className="px-4 py-2 rounded-full bg-slate-800 text-slate-300 text-sm font-semibold border border-slate-700 disabled:opacity-70"
            >
              {address ? "Deposit LP (soon)" : "Connect to deposit"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
