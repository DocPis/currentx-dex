import React from "react";

const DEFAULT_WHITELIST_URL = "https://currentx.app/whitelist";

export default function WhitelistBanner({ href = DEFAULT_WHITELIST_URL }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0ff5ff] focus-visible:ring-offset-slate-900"
    >
      <div className="w-full bg-[#0c2f4f] text-slate-50 px-4 py-2 flex items-center justify-center gap-2 sm:gap-3 text-[11px] sm:text-sm font-semibold tracking-[0.18em] uppercase shadow-[0_1px_0_rgba(0,0,0,0.25)] hover:brightness-[1.08] transition">
        <span className="font-black">Join the whitelist</span>
        <span className="hidden sm:inline text-slate-100/90 tracking-normal normal-case font-medium">
          → Register early to secure your spot in CurrentX genesis
        </span>
      </div>
    </a>
  );
}
