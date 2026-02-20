import React from "react";

export default function StatItem({ label, value, valueTitle = "" }) {
  const displayValue = String(value || "--");
  const title = String(valueTitle || displayValue).trim();
  return (
    <div className="flex h-full min-h-[62px] min-w-0 flex-col justify-between rounded-lg border border-slate-700/55 bg-slate-900/35 px-2 py-2">
      <div className="truncate text-[10px] uppercase tracking-wide text-slate-400/85">{label}</div>
      <div className="mt-1 truncate text-right text-sm font-semibold text-slate-100" title={title}>
        {displayValue}
      </div>
    </div>
  );
}
