import React from "react";

export default function StatItem({ label, value, valueTitle = "" }) {
  const displayValue = String(value || "--");
  const title = String(valueTitle || displayValue).trim();
  return (
    <div className="min-w-0 rounded-lg border border-slate-700/55 bg-slate-900/35 px-2 py-2">
      <div className="truncate text-[10px] uppercase tracking-wide text-slate-400/85">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-100" title={title}>
        {displayValue}
      </div>
    </div>
  );
}

