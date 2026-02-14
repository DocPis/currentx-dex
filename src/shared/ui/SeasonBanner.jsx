import React from "react";

export default function SeasonBanner({ onClick }) {
  const baseClassName =
    "w-full bg-[#12344f] text-slate-100 px-4 py-1.5 flex items-center justify-center gap-2 sm:gap-3 text-[10px] sm:text-[13px] font-medium tracking-[0.14em] uppercase border border-cyan-300/45";

  if (typeof onClick === "function") {
    return (
      <div className="block">
        <button
          type="button"
          onClick={onClick}
          className={`${baseClassName} cursor-pointer transition duration-200 hover:bg-[#174360] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60`}
          aria-label="Open Points section"
        >
          <span className="font-semibold">Season1 is up</span>
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
        <span className="font-semibold">Season1 is up</span>
        <span className="hidden sm:inline text-slate-100/90 tracking-normal normal-case font-medium">
          Every swap earns Points. Top traders win more.
        </span>
      </div>
    </div>
  );
}
