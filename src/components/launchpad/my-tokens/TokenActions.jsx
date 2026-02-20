import React from "react";
import { ChevronDown } from "lucide-react";

export default function TokenActions({ detailsOpen, onToggleDetails }) {
  return (
    <div className="mt-2 flex items-center justify-end">
      <button
        type="button"
        onClick={onToggleDetails}
        className="inline-flex items-center gap-1 rounded-md border border-slate-600/65 bg-slate-900/65 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/35"
        aria-expanded={detailsOpen}
        title={detailsOpen ? "Collapse details" : "Expand details"}
      >
        <span>Details</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${detailsOpen ? "rotate-180" : ""}`} aria-hidden />
      </button>
    </div>
  );
}
