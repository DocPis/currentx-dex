// src/components/LiquiditySection.jsx

export default function LiquiditySection() {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl shadow-black/60">
      <h2 className="text-sm font-semibold text-slate-50">Liquidity</h2>
      <p className="mt-1 text-xs text-slate-400">
        Provide liquidity to earn swap fees and incentives.
      </p>

      <div className="mt-4 space-y-2 text-sm">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <button className="inline-flex flex-1 items-center justify-between rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] text-slate-100">
              <span>Token A</span>
              <span>▼</span>
            </button>
            <button className="inline-flex flex-1 items-center justify-between rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] text-slate-100">
              <span>Token B</span>
              <span>▼</span>
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
            <span>Select a pool</span>
            <span>TVL: —</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2.5">
          <div className="text-[11px] text-slate-400">Deposit amount</div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-lg font-medium text-slate-50">0.00</span>
            <span className="text-[11px] text-slate-400">
              Balance: 0.0000 / 0.0000
            </span>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-3 py-2.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-slate-400">Share of pool</span>
            <span className="text-slate-100">–</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-slate-400">Estimated APR</span>
            <span className="text-emerald-300">18.3%</span>
          </div>
        </div>

        <button className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/40">
          Connect wallet to add liquidity
        </button>
      </div>
    </div>
  );
}
