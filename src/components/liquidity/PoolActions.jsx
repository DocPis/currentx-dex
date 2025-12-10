// src/components/liquidity/PoolActions.jsx

/**
 * Bottoni di azione a destra:
 * - Deposit (apre modal)
 * - Details (link a Etherscan)
 */
export default function PoolActions({
  hasOnChainPool,
  detailsUrl,
  onDeposit,
}) {
  // abilitiamo il click se esiste una callback onDeposit;
  // usiamo hasOnChainPool solo per il tooltip / stile
  const disabledDeposit = !onDeposit;

  return (
    <div className="w-[18%] flex justify-end gap-2 pr-1 sm:pr-2">
      <button
        className={`rounded-full px-3 py-1.5 text-[10px] sm:text-xs font-semibold ${
          disabledDeposit
            ? "bg-slate-700 text-slate-400 cursor-not-allowed"
            : "bg-sky-500/90 hover:bg-sky-400 text-slate-950"
        }`}
        disabled={disabledDeposit}
        title={
          hasOnChainPool
            ? disabledDeposit
              ? "Connect wallet / reload pools to add liquidity."
              : "Add liquidity to this pool"
            : "No on-chain pool for this pair (factory returned zero address)"
        }
        onClick={() => {
          if (!disabledDeposit && onDeposit) onDeposit();
        }}
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
