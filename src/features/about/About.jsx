import React from "react";
import { GeckoTerminalAttributionLink } from "../../shared/ui/GeckoTerminalAttribution";

export default function About() {
  return (
    <section className="px-4 sm:px-6 py-10">
      <div className="mx-auto w-full max-w-4xl">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 sm:p-8">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            About
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-slate-100">
            CurrentX
          </h1>
          <p className="mt-3 text-sm text-slate-400">
            CurrentX is a decentralized exchange on MegaETH with V2 and V3
            liquidity pools, concentrated liquidity, and on-chain routing.
          </p>
          <div className="mt-6">
            <GeckoTerminalAttributionLink
              text="Data attribution: GeckoTerminal"
              className="text-[13px] text-slate-300/80"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
