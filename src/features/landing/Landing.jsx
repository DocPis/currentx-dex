// src/features/landing/Landing.jsx
import React from "react";
import currentxLogo from "../../assets/currentx.png";

export default function Landing({ onEnter }) {
  return (
    <div className="min-h-screen bg-[#05060d] text-slate-50 flex flex-col">
      <div className="relative overflow-hidden flex-1">
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.08),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(139,92,246,0.08),transparent_35%),radial-gradient(circle_at_50%_70%,rgba(16,185,129,0.07),transparent_30%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:160px_160px] opacity-40" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-6 pt-10 pb-20 flex flex-col gap-10">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center justify-center shadow-[0_10px_40px_-20px_rgba(56,189,248,0.5)]">
                <img src={currentxLogo} alt="CurrentX logo" className="h-10 w-10 object-contain" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-sm uppercase tracking-[0.2em] text-slate-400">MegaETH</span>
                <span className="text-xl font-black tracking-tight">CurrentX</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="https://docs.currentx.app/"
                className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-700 text-xs font-semibold text-slate-200 hover:border-sky-500/70 transition"
              >
                Docs
              </a>
              <button
                type="button"
                onClick={onEnter}
                className="px-5 py-2 rounded-full bg-sky-500 text-sm font-bold text-white shadow-[0_10px_40px_-12px_rgba(56,189,248,0.7)] hover:bg-sky-400 transition"
              >
                Launch app
              </button>
            </div>
          </header>

          <main className="grid lg:grid-cols-2 gap-10 items-center">
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="text-[11px] uppercase tracking-[0.3em] text-sky-300">MegaETH ready</div>
                <h1 className="text-5xl sm:text-6xl font-black leading-[1.05] tracking-tight">
                  Zero latency liquidity. <br /> Sub-millisecond swaps.
                </h1>
                <p className="text-base sm:text-lg text-slate-300 max-w-xl">
                  CurrentX is the AMM tuned for MegaETH: deterministic routing, instant confirmations, and a
                  launchpad for liquidity providers. Seed a pool or join live markets with real-time data.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onEnter}
                  className="px-6 py-3 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 text-sm font-bold text-white shadow-[0_12px_50px_-18px_rgba(56,189,248,0.8)]"
                >
                  Enter app
                </button>
                <a
                  href="https://docs.currentx.app/"
                  className="px-6 py-3 rounded-2xl border border-slate-700 text-sm font-semibold text-slate-100 hover:border-sky-500/70 transition"
                >
                  Read docs
                </a>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-16 bg-gradient-to-br from-sky-500/10 via-transparent to-emerald-500/10 blur-3xl" aria-hidden />
              <div className="relative rounded-[32px] border border-slate-800 bg-slate-900/70 shadow-2xl shadow-black/50 overflow-hidden p-10 flex flex-col gap-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-2xl bg-slate-800 flex items-center justify-center border border-slate-700">
                      <img src={currentxLogo} alt="CurrentX" className="h-10 w-10 object-contain" />
                    </div>
                    <div className="flex flex-col leading-tight">
                      <span className="text-sm font-semibold">Built for MegaETH</span>
                      <span className="text-xs text-slate-400">Ultra-fast AMM infrastructure</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 shadow-[0_8px_30px_-18px_rgba(56,189,248,0.6)]">
                      <img src="/megaeth.png" alt="MegaETH logo" className="h-6 w-6 object-contain" />
                      <span className="text-[11px] font-semibold text-slate-100">MegaETH</span>
                    </div>
                    <span className="px-3 py-1 text-[11px] rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
                      Live
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 flex flex-col gap-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Why CurrentX</div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {[
                      { title: "Deterministic routing", desc: "No surprises. Predictable execution on MegaETH." },
                      { title: "LP-first", desc: "Seed new pairs instantly and own the upside from day one." },
                      { title: "Observability", desc: "Live metrics, health, and speed signals baked in." },
                      { title: "Security", desc: "Battle-tested AMM primitives with lean contracts." },
                    ].map((card) => (
                      <div key={card.title} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                        <div className="text-sm font-semibold text-slate-100">{card.title}</div>
                        <div className="text-[12px] text-slate-400">{card.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  {[
                    { label: "Latency", value: "< 1 ms" },
                    { label: "Settlement", value: "Instant" },
                    { label: "Network", value: "MegaETH" },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 shadow-[0_8px_30px_-18px_rgba(15,118,110,0.5)]"
                    >
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">{stat.label}</div>
                      <div className="text-xl font-bold text-slate-50">{stat.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </main>

          <section className="mt-6 grid lg:grid-cols-3 gap-4">
            {[
              {
                title: "Built for speed",
                desc: "Deterministic paths, fast execution, and predictable outcomes on MegaETH.",
              },
              {
                title: "LP launchpad",
                desc: "Seed brand new pairs, capture early fees, and grow liquidity with live monitoring.",
              },
              {
                title: "Security first",
                desc: "Lean contracts, transparent metrics, and continuous observability baked into the stack.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-3xl border border-slate-800 bg-slate-900/60 px-6 py-5 shadow-[0_12px_40px_-18px_rgba(15,23,42,0.8)]"
              >
                <div className="text-sm font-semibold text-slate-50">{item.title}</div>
                <div className="text-sm text-slate-400 mt-2">{item.desc}</div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
