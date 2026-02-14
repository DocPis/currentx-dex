import React from "react";
import { LAUNCHPAD_SORT_OPTIONS } from "../../services/launchpad/utils";
import type { LaunchpadSort } from "../../services/launchpad/types";

interface SortSelectProps {
  value: LaunchpadSort;
  onChange: (next: LaunchpadSort) => void;
}

const SortSelect = ({ value, onChange }: SortSelectProps) => {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-slate-300">
      <span className="text-slate-400">Sort</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as LaunchpadSort)}
        className="rounded-xl border border-slate-700/70 bg-slate-950/70 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-sky-400/70"
      >
        {LAUNCHPAD_SORT_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
};

export default React.memo(SortSelect);
