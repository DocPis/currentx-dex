import React from "react";
import { ChevronDown } from "lucide-react";

export default function TokenActions({ detailsOpen, onToggleDetails }) {
  return (
    <div className="mt-2 flex items-center justify-end">
      <button
        type="button"
        onClick={onToggleDetails}
        className="inline-flex items-center gap-1 rounded-md border border-slate-600/70 bg-slate-900/70 px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-slate-500 hover:text-slate-100"
        aria-expanded={detailsOpen}
      >
        <span>{detailsOpen ? "Hide details" : "Details"}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${detailsOpen ? "rotate-180" : ""}`} aria-hidden />
      </button>
    </div>
  );
}

