// src/components/liquidity/PoolActions.jsx

export default function PoolActions({
  hasOnChainPool,
  detailsUrl,
  onDeposit,
  onWithdraw,
  hasPosition, // lo teniamo solo per il tooltip, non per bloccare il click
}) {
  const depositDisabled = !onDeposit || !hasOnChainPool;

  // ✅ Withdraw cliccabile se esiste la pool on-chain e la callback
  const withdrawDisabled = !onWithdraw || !hasOnChainPool;

  return (
    <div className="w-[18%] flex justify-end gap-2 pr-1 sm:pr-2">
      {/* DEPOSIT */}
      <button
        className={`rounded-full px-3 py-1.5 text-[10px] sm:text-xs font-semibold ${
          depositDisabled
            ? "bg-slate-700 text-slate-400 cursor-not-allowed"
            : "bg-sky-500/90 hover:bg-sky-400 text-slate-950"
        }`}
        disabled={depositDisabled}
        title={
          hasOnChainPool
            ? depositDisabled
              ? "Connect wallet / pool data to add liquidity."
              : "Add liquidity to this pool"
            : "No on-chain pool for this pair"
        }
        onClick={() => {
          if (!depositDisabled && onDeposit) onDeposit();
        }}
      >
        Deposit
      </button>

      {/* WITHDRAW */}
      <button
        className={`rounded-full px-3 py-1.5 text-[10px] sm:text-xs font-semibold ${
          withdrawDisabled
            ? "bg-slate-800 text-slate-500 cursor-not-allowed"
            : "bg-rose-500/90 hover:bg-rose-400 text-slate-950"
        }`}
        disabled={withdrawDisabled}
        title={
          hasOnChainPool
            ? hasPosition
              ? "Withdraw your liquidity from this pool"
              : "You might not have LP in this pool, modal will show your real balance."
            : "No on-chain pool for this pair"
        }
        onClick={() => {
          if (!withdrawDisabled && onWithdraw) onWithdraw();
        }}
      >
        Withdraw
      </button>

      {/* DETAILS */}
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
