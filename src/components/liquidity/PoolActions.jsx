// src/components/liquidity/PoolActions.jsx

export default function PoolActions({ hasOnChainPool, detailsUrl }) {
  return (
    <div className="w-[18%] flex justify-end gap-2 pr-1 sm:pr-2">
      <button
        className="rounded-full bg-sky-500/90 hover:bg-sky-400 text-slate-950 px-3 py-1.5 text-[10px] sm:text-xs font-semibold"
        disabled={!hasOnChainPool}
        title={
          hasOnChainPool
            ? "Add liquidity via router (todo)"
            : "No on-chain pool for this pair"
        }
      >
        Deposit
      </button>

      {detailsUrl ? (
        <a
          href={detailsUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-slate-600/70 px-3 py-1.5 text-[10px] sm:text-xs text-slate-200 hover:border-slate-300/80 hover:bg-slate-900/70 transition-colors"
        >
          Details
        </a>
      ) : (
        <button
          className="rounded-full border border-slate-600/70 px-3 py-1.5 text-[10px] sm:text-xs text-slate-400 cursor-default"
          disabled
        >
          Details
        </button>
      )}
    </div>
  );
}
