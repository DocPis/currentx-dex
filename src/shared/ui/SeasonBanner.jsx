import React from "react";

export default function SeasonBanner() {
  return (
    <div className="block">
      <div className="w-full bg-[#0c2f4f] text-slate-50 px-4 py-2 flex items-center justify-center gap-2 sm:gap-3 text-[11px] sm:text-sm font-semibold tracking-[0.18em] uppercase border border-[#0ff5ff] shadow-[0_0_18px_rgba(15,245,255,0.32)]">
        <span className="font-black">🏁 Season 1 is coming</span>
        <span className="hidden sm:inline text-slate-100/90 tracking-normal normal-case font-medium">
          Every swap earns Points. Top traders win more.
        </span>
      </div>
    </div>
  );
}
