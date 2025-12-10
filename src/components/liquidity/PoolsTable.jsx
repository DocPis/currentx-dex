// src/components/liquidity/PoolsTable.jsx
import PoolRow from "./PoolRow";

export default function PoolsTable({ pools, loading }) {
  return (
    <div className="bg-[#050918]/90 border border-white/5 rounded-2xl overflow-hidden shadow-[0_18px_60px_rgba(0,0,0,0.65)]">
      <div className="px-4 sm:px-5 py-3 border-b border-slate-800/80 flex items-center justify-between text-[11px] sm:text-xs text-slate-400">
        <span className="w-[28%]">Pools</span>
        <span className="w-[14%] text-right hidden sm:block">Volume (24h)</span>
        <span className="w-[14%] text-right hidden sm:block">Fees (24h)</span>
        <span className="w-[14%] text-right">TVL (testnet)</span>
        <span className="w-[12%] text-right">APR</span>
        <span className="w-[18%] text-right pr-2">Action</span>
      </div>

      {loading && (
        <div className="px-4 sm:px-5 py-6 text-sm text-slate-400">
          Loading on-chain liquidity & 24h fees from Uniswap V2 on Sepolia...
        </div>
      )}

      {!loading && pools.length === 0 && (
        <div className="px-4 sm:px-5 py-6 text-sm text-slate-400">
          No pools match selected filters.
        </div>
      )}

      {!loading &&
        pools.map((p, i) => <PoolRow key={p.id} pool={p} isOdd={i % 2 === 1} />)}
    </div>
  );
}
