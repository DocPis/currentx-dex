import StatCard from "./StatCard";

export default function LiquidityHeaderCard() {
  return (
    <div className="bg-[#050918]/90 border border-white/5 rounded-2xl lg:rounded-3xl p-5 sm:p-6 shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-sky-400/80">
            Liquidity
          </p>
          <h2 className="mt-1 text-xl sm:text-2xl font-semibold text-slate-50">
            Provide liquidity. Earn CXT emissions.
          </h2>
        </div>
        <span className="inline-flex items-center rounded-full bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 border border-sky-500/30">
          Live on Sepolia
        </span>
      </div>

      <p className="text-xs sm:text-sm text-slate-400 mb-5">
        Add liquidity to CurrentX pools and earn swap fees plus boosted emissions in{" "}
        <span className="text-sky-300">CXT</span>.
      </p>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard label="Volume (24h)" value="$2.97M" hint="+12.3%" />
        <StatCard label="Fees (24h)" value="$121.5K" hint="+3.9%" />
        <StatCard label="Total Value Locked" value="$434.5M" hint="All pools" />
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button className="inline-flex items-center justify-center rounded-full bg-sky-500 hover:bg-sky-400 transition-colors px-4 py-2 text-xs sm:text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/40">
          + Launch pool
        </button>
        <button className="inline-flex items-center justify-center rounded-full border border-slate-600/70 px-4 py-2 text-xs sm:text-sm font-medium text-slate-200 hover:border-slate-400/80 hover:bg-slate-900/60 transition-colors">
          My positions
        </button>
      </div>
    </div>
  );
}
