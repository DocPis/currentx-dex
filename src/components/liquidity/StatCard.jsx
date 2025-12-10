// src/components/liquidity/StatCard.jsx

export default function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-950/60 px-3 py-3 sm:px-4 sm:py-3.5 flex flex-col justify-between">
      <span className="text-[10px] sm:text-xs uppercase tracking-[0.16em] text-slate-400/80">
        {label}
      </span>
      <span className="mt-1 text-sm sm:text-base font-semibold text-slate-50">
        {value}
      </span>
      <span className="mt-1 text-[10px] sm:text-[11px] text-emerald-300/90">
        {hint}
      </span>
    </div>
  );
}
