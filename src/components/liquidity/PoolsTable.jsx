import PoolRow from "./PoolRow";

export default function PoolsTable({ pools }) {
  return (
    <div className="bg-[#050918]/90 border border-white/5 rounded-2xl overflow-hidden shadow-[0_18px_60px_rgba(0,0,0,0.65)]">
      <div className="px-4 sm:px-5 py-3 border-b border-slate-800/80 flex items-center justify-between text-[11px] sm:text-xs text-slate-400">
        <span className="w-[28%]">Pools</span>
        <span className="w-[14%] text-right hidden sm:block">Volume</span>
        <span className="w-[14%] text-right hidden sm:block">Fees</span>
        <span className="w-[14%] text-right">TVL</span>
        <span className="w-[12%] text-right">APR</span>
        <span className="w-[18%] text-right pr-2">Action</span>
      </div>

      {pools.length === 0 ? (
        <div className="px-4 sm:px-5 py-6 text-sm text-slate-400">
          No pools match selected filters.
        </div>
      ) : (
        pools.map((p, i) => <PoolRow key={p.id} pool={p} isOdd={i % 2} />)
      )}
    </div>
  );
}
