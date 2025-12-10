// src/components/SwapTradeDetails.jsx
import React from "react";

export default function SwapTradeDetails({
  isWrap,
  isUnwrap,
  slippage,
  onSlippagePreset,
  onSlippageInput,
  minReceived,
  tokenOutSymbol,
  priceImpact,
}) {
  const parsedImpact =
    priceImpact != null ? parseFloat(priceImpact) : null;

  let impactValueClass = "text-slate-100";
  let impactBadgeLabel = null;
  let impactBadgeClass = "";
  let impactTooltip = "";

  if (!isWrap && !isUnwrap && parsedImpact != null && !Number.isNaN(parsedImpact)) {
    if (parsedImpact < 1) {
      impactValueClass = "text-emerald-300";
      impactBadgeLabel = "Low";
      impactBadgeClass =
        "rounded-full border border-emerald-500/60 bg-emerald-500/10 px-2 py-[1px] text-[10px] text-emerald-200";
      impactTooltip =
        "Low price impact. This trade has minimal effect on the pool price.";
    } else if (parsedImpact < 5) {
      impactValueClass = "text-amber-300";
      impactBadgeLabel = "Medium";
      impactBadgeClass =
        "rounded-full border border-amber-500/60 bg-amber-500/10 px-2 py-[1px] text-[10px] text-amber-200";
      impactTooltip =
        "Medium price impact. This trade will move the pool price noticeably.";
    } else {
      impactValueClass = "text-rose-300";
      impactBadgeLabel = "High";
      impactBadgeClass =
        "rounded-full border border-rose-500/60 bg-rose-500/10 px-2 py-[1px] text-[10px] text-rose-200";
      impactTooltip =
        "High price impact. You may receive significantly less than the mid price.";
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-3 text-[11px] text-slate-400">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-slate-200">Trade details</span>
      </div>

      <div className="mb-2">
        <div className="mb-1 flex items-center justify-between">
          <span>Slippage tolerance</span>
        </div>
        <div className="flex gap-2">
          {["0.1", "0.5", "1"].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onSlippagePreset(v)}
              disabled={isWrap || isUnwrap}
              className={`flex-1 rounded-full border px-2 py-1 text-[11px] ${
                isWrap || isUnwrap
                  ? "border-slate-800 bg-slate-900 text-slate-500 cursor-not-allowed"
                  : slippage === v
                  ? "border-emerald-400 bg-emerald-500/15 text-emerald-200"
                  : "border-slate-700 bg-slate-900 text-slate-200"
              }`}
            >
              {v}%
            </button>
          ))}
          <div className="flex flex-1 items-center rounded-full border border-slate-700 bg-slate-900 px-2 py-1">
            <input
              type="text"
              value={slippage}
              disabled={isWrap || isUnwrap}
              onChange={(e) => onSlippageInput(e.target.value)}
              className="w-full bg-transparent text-right text-[11px] text-slate-100 outline-none disabled:text-slate-500"
              placeholder="Custom %"
            />
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between">
          <span>Minimum received</span>
          <span className="text-slate-100">
            {minReceived ? `${minReceived} ${tokenOutSymbol}` : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Price impact</span>
          <span className="flex items-center gap-2">
            <span className={impactValueClass}>
              {isWrap || isUnwrap
                ? "0.00%"
                : priceImpact
                ? `${priceImpact}%`
                : "—"}
            </span>
            {!isWrap &&
              !isUnwrap &&
              impactBadgeLabel && (
                <span
                  className={impactBadgeClass}
                  title={impactTooltip}
                >
                  {impactBadgeLabel}
                </span>
              )}
          </span>
        </div>
      </div>
    </div>
  );
}
