import React from "react";

interface UnverifiedTokenModalProps {
  open: boolean;
  tokenSymbol: string;
  onCancel: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

const UnverifiedTokenModal = ({
  open,
  tokenSymbol,
  onCancel,
  onConfirm,
  loading = false,
}: UnverifiedTokenModalProps) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-amber-500/45 bg-slate-950/95 p-5 shadow-2xl">
        <div className="text-sm font-semibold text-amber-100">Unverified token warning</div>
        <p className="mt-2 text-xs text-amber-200/85">
          <span className="font-semibold">{tokenSymbol}</span> is not verified. This token is user-generated and may carry
          higher risk. Confirm that you understand before submitting the buy order.
        </p>
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200/90">
          Risk disclaimer: User-generated tokens. DYOR.
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-xl border border-slate-700/80 bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="rounded-xl border border-amber-400/60 bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:brightness-110 disabled:opacity-60"
          >
            {loading ? "Submitting..." : `I Understand, Buy ${tokenSymbol}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(UnverifiedTokenModal);
