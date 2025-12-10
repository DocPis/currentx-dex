// src/components/swap/SwapConfirmModal.jsx

import { formatUnits } from "ethers";

export default function SwapConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  confirming,
  sellToken,
  buyToken,
  amountIn,
  expectedOut,
  tokenOutDecimals,
  priceImpact,
}) {
  if (!isOpen) return null;

  const formattedOut = expectedOut
    ? formatUnits(expectedOut, tokenOutDecimals ?? 18)
    : "0.00";

  const impactText = priceImpact != null ? `${priceImpact}%` : "—";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950/95 p-5 shadow-2xl shadow-black/70">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-50">Confirm swap</h2>
            <p className="text-[11px] text-slate-400">
              Review trade details before confirming in your wallet.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        {/* Summary */}
        <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-[12px] text-slate-200">
          <div className="mb-2 flex justify-between">
            <span className="text-slate-400">You pay</span>
            <span className="font-semibold">
              {amountIn || "0.00"} {sellToken}
            </span>
          </div>
          <div className="mb-2 flex justify-between">
            <span className="text-slate-400">You receive (est.)</span>
            <span className="font-semibold">
              {formattedOut} {buyToken}
            </span>
          </div>
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Network</span>
            <span className="text-slate-200">Sepolia</span>
          </div>
        </div>

        {/* Details */}
        <div className="mb-4 space-y-1 text-[11px] text-slate-400">
          <div className="flex justify-between">
            <span>Price impact</span>
            <span className="text-slate-100">{impactText}</span>
          </div>
          <div className="flex justify-between">
            <span>Slippage tolerance</span>
            <span className="text-slate-100">1.00% (default)</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={confirming}
            className="flex-1 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className="flex-1 rounded-full bg-gradient-to-r from-indigo-500 to-blue-600 px-4 py-2 text-sm font-semibold text-slate-50 shadow-lg shadow-indigo-600/40 disabled:opacity-60"
          >
            {confirming ? "Confirming..." : "Confirm swap"}
          </button>
        </div>
      </div>
    </div>
  );
}
