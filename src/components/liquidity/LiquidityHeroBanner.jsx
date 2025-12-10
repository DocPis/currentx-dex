export default function LiquidityHeroBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl lg:rounded-3xl border border-white/5 bg-gradient-to-br from-sky-500/20 via-purple-500/10 to-slate-900 shadow-[0_18px_60px_rgba(0,0,0,0.55)]">
      <div className="absolute inset-0">
        <div className="absolute -inset-20 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.35),_transparent_60%),_radial-gradient(circle_at_bottom,_rgba(129,140,248,0.45),_transparent_55%)] opacity-80" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(15,23,42,0.5),transparent_50%),radial-gradient(circle_at_80%_110%,rgba(15,23,42,0.8),transparent_55%)]" />
      </div>

      <div className="relative h-full flex flex-col justify-between p-5 sm:p-6">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-200/70">
            CurrentX Meta Pools
          </p>
          <h3 className="mt-2 text-lg sm:text-xl font-semibold text-slate-50">
            A new horizon for L2 liquidity.
          </h3>
          <p className="mt-2 text-xs sm:text-sm text-slate-200/80 max-w-xs">
            Concentrated & volatile pools, native routing and incentives designed for omnichain CXT markets.
          </p>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="space-y-1 text-xs sm:text-sm">
            <p className="text-slate-200/80">Active pools</p>
            <p className="text-lg font-semibold text-slate-50">128</p>
          </div>
          <div className="space-y-1 text-xs sm:text-sm">
            <p className="text-slate-200/80">Best APR</p>
            <p className="text-lg font-semibold text-emerald-300">1,016%</p>
          </div>
          <div className="flex items-center justify-center rounded-full border border-slate-300/20 bg-slate-950/50 px-3 py-1.5 text-[11px] sm:text-xs text-slate-100/90">
            Auto-compound with one click
          </div>
        </div>
      </div>
    </div>
  );
}
