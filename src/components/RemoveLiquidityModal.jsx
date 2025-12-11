// src/components/RemoveLiquidityModal.jsx

import React from "react";

export default function RemoveLiquidityModal({ isOpen, onClose, pool }) {
  if (!isOpen || !pool) return null;

  const {
    token0Symbol,
    token1Symbol,
    userLp,
    totalSupply,
    reserve0,
    reserve1,
  } = pool;

  // quota utente (% della pool)
  const sharePct =
    totalSupply > 0 ? ((userLp / totalSupply) * 100).toFixed(4) : "0.0000";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-slate-950/95 p-6 shadow-2xl shadow-black/60">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-50">
            Remove liquidity
          </h2>
          <button
            onClick={onClose}
            className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 space-y-2 text-xs text-slate-400">
          <p className="text-slate-300">
            {token0Symbol} / {token1Symbol}
          </p>
          <p>
            Your LP:{" "}
            <span className="text-teal-300">{userLp.toFixed(12)} LP</span>
          </p>
          <p>
            Your share of pool:{" "}
            <span className="text-slate-200">{sharePct}%</span>
          </p>
          <p className="pt-2">
            Pool reserves:
            <br />
            <span className="text-slate-200">
              {reserve0} {token0Symbol}
            </span>{" "}
            ·{" "}
            <span className="text-slate-200">
              {reserve1} {token1Symbol}
            </span>
          </p>
        </div>

        <div className="mb-4 rounded-xl bg-slate-900/70 px-3 py-3 text-xs text-slate-400">
          <p className="mb-1 font-semibold text-slate-200">Heads up</p>
          <p>
            Questo modal al momento è solo UI: non esegue ancora la transazione
            <span className="text-slate-200 font-mono"> removeLiquidity </span>{" "}
            sul router. Possiamo agganciare la tx in un secondo step.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            disabled
            className="cursor-not-allowed rounded-full bg-rose-500/60 px-4 py-2 text-xs font-semibold text-slate-50"
          >
            Remove (soon)
          </button>
        </div>
      </div>
    </div>
  );
}
