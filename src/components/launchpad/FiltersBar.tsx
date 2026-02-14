import React from "react";
import { LAUNCHPAD_FILTER_OPTIONS } from "../../services/launchpad/utils";
import type { LaunchpadFilter } from "../../services/launchpad/types";

interface FiltersBarProps {
  query: string;
  activeFilters: LaunchpadFilter[];
  onQueryChange: (value: string) => void;
  onToggleFilter: (filter: LaunchpadFilter) => void;
  dynamicTags?: string[];
}

const FiltersBar = ({
  query,
  activeFilters,
  onQueryChange,
  onToggleFilter,
  dynamicTags = [],
}: FiltersBarProps) => {
  const tagFilters = dynamicTags
    .map((tag) => String(tag || "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 6);

  return (
    <div className="space-y-3 rounded-2xl border border-slate-800/80 bg-slate-950/45 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search name, symbol, or token address"
          className="w-full rounded-xl border border-slate-700/70 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/70"
        />
        <div className="rounded-xl border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold tracking-wide text-amber-200">
          User-generated tokens. DYOR.
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {LAUNCHPAD_FILTER_OPTIONS.map((filter) => {
          const active = activeFilters.includes(filter.id);
          return (
            <button
              key={filter.id}
              type="button"
              onClick={() => onToggleFilter(filter.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? "border-cyan-400/70 bg-cyan-400/15 text-cyan-100"
                  : "border-slate-700/70 bg-slate-900/70 text-slate-300 hover:border-slate-500"
              }`}
            >
              {filter.label}
            </button>
          );
        })}

        {tagFilters.map((tag) => {
          const active = activeFilters.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onToggleFilter(tag)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition ${
                active
                  ? "border-emerald-400/70 bg-emerald-400/15 text-emerald-100"
                  : "border-slate-700/70 bg-slate-900/70 text-slate-300 hover:border-slate-500"
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default React.memo(FiltersBar);
