import { TOKENS, AVAILABLE_TOKENS } from "../../config/tokenRegistry";
import { useState } from "react";

export default function SwapTokenSelector({ current, onSelect }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1.5 text-[12px] text-slate-100 border border-slate-700"
      >
        {TOKENS[current].logo && (
          <img src={TOKENS[current].logo} alt={current} className="h-5 w-5 rounded-full" />
        )}
        <span>{current}</span>
        <span className="text-[10px] text-slate-400">▼</span>
      </button>

      {open && (
        <div className="absolute left-0 mt-1 w-40 rounded-xl border border-slate-700 bg-slate-900 shadow-xl z-20">
          {AVAILABLE_TOKENS.map((s) => (
            <button
              key={s}
              disabled={s === current}
              onClick={() => {
                onSelect(s);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-[12px] ${
                s === current ? "bg-slate-800 text-slate-100" : "text-slate-200 hover:bg-slate-800"
              }`}
            >
              {TOKENS[s].logo && (
                <img src={TOKENS[s].logo} alt={s} className="h-5 w-5 rounded-full" />
              )}
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
