import React from "react";

export default function SeasonBanner({ onClick }) {
  const baseClassName =
    "w-full bg-[#0c2f4f] text-slate-50 px-4 py-2 flex items-center justify-center gap-2 sm:gap-3 text-[11px] sm:text-sm font-semibold tracking-[0.18em] uppercase border border-[#0ff5ff] shadow-[0_0_18px_rgba(15,245,255,0.32)]";

  if (typeof onClick === "function") {
    return (
      <div className="block">
        <button
          type="button"
          onClick={onClick}
          className={`${baseClassName} cursor-pointer transition hover:bg-[#114a79] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70`}
          aria-label="Open Points section"
        >
          <span className="font-black">Season1 is up</span>
          <span className="hidden sm:inline text-slate-100/90 tracking-normal normal-case font-medium">
            Every swap earns Points. Top traders win more.
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="block">
      <div className={baseClassName}>
        <span className="font-black">Season1 is up</span>
        <span className="hidden sm:inline text-slate-100/90 tracking-normal normal-case font-medium">
          Every swap earns Points. Top traders win more.
        </span>
      </div>
    </div>
  );
}
