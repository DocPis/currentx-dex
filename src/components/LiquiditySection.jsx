// src/sections/LiquiditySection.jsx
import React from "react";

// 🔹 Usa gli stessi file che già usi nello swap (cambia estensione/nome se serve)
import ethLogo from "../assets/tokens/eth.png";
import wethLogo from "../assets/tokens/weth.png";
import usdcLogo from "../assets/tokens/usdc.png";
import daiLogo from "../assets/tokens/dai.png";
import wbtcLogo from "../assets/tokens/wbtc.png";

// Mappa symbol -> logo (tutto MAIUSCOLO)
const TOKEN_ICONS = {
  ETH: ethLogo,
  WETH: wethLogo,
  USDC: usdcLogo,
  DAI: daiLogo,
  WBTC: wbtcLogo,
  // CXT lo lasciamo senza logo per ora
};

const POOLS = [
  {
    id: 1,
    pair: "CXT / WETH",
    tokens: ["CXT", "WETH"],
    type: "Volatile 0.3%",
    tags: ["Core", "Listed"],
    volume: "$26.5K",
    fees: "$790.12",
    tvl: "$39.2K",
    apr: "23.4%",
  },
  {
    id: 2,
    pair: "WETH / USDC",
    tokens: ["WETH", "USDC"],
    type: "Stable 0.01%",
    tags: ["Bluechip"],
    volume: "$519.1K",
    fees: "$1.2K",
    tvl: "$30.6K",
    apr: "18.7%",
  },
  {
    id: 3,
    pair: "CXT / USDC",
    tokens: ["CXT", "USDC"],
    type: "Volatile 1%",
    tags: ["Experimental"],
    volume: "$79.2K",
    fees: "$274.8",
    tvl: "$22.6K",
    apr: "32.1%",
  },
];

const FILTERS = ["All", "Core", "Bluechip", "Experimental"];

export default function LiquiditySection() {
  const [activeFilter, setActiveFilter] = React.useState("All");
  const [search, setSearch] = React.useState("");

  const filteredPools = POOLS.filter((p) => {
    const matchTag =
      activeFilter === "All" || p.tags.includes(activeFilter);
    const matchSearch =
      !search ||
      p.pair.toLowerCase().includes(search.toLowerCase());
    return matchTag && matchSearch;
  });

  return (
    <section className="w-full px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
      <div className="max-w-6xl mx-auto space-y-6 lg:space-y-8">
        {/* Header + hero banner */}
        <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2fr,1.3fr] items-stretch">
          {/* Left: overview card */}
          <div className="bg-[#050918]/90 border border-white/5 rounded-2xl lg:rounded-3xl p-5 sm:p-6 shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-sky-400/80">
                  Liquidity
                </p>
                <h2 className="mt-1 text-xl sm:text-2xl font-semibold text-slate-50">
                  Provide liquidity. Earn CXT emissions.
                </h2>
              </div>
              <span className="inline-flex items-center rounded-full bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 border border-sky-500/30">
                Live on Sepolia
              </span>
            </div>

            <p className="text-xs sm:text-sm text-slate-400 mb-5">
              Add liquidity to CurrentX pools and earn swap fees plus boosted
              emissions in our native token <span className="text-sky-300">CXT</span>.
            </p>

            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              <StatCard label="Volume (24h)" value="$2.97M" hint="+12.3%" />
              <StatCard label="Fees (24h)" value="$121.5K" hint="+3.9%" />
              <StatCard label="Total Value Locked" value="$434.5M" hint="All pools" />
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button className="inline-flex items-center justify-center rounded-full bg-sky-500 hover:bg-sky-400 transition-colors px-4 py-2 text-xs sm:text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/40">
                + Launch pool
              </button>
              <button className="inline-flex items-center justify-center rounded-full border border-slate-600/70 px-4 py-2 text-xs sm:text-sm font-medium text-slate-200 hover:border-slate-400/80 hover:bg-slate-900/60 transition-colors">
                My positions
              </button>
            </div>
          </div>

          {/* Right: hero banner */}
          <div className="relative overflow-hidden rounded-2xl lg:rounded-3xl border border-white/5 bg-gradient-to-br from-sky-500/20 via-purple-500/10 to-slate-900 shadow-[0_18px_60px_rgba(0,0,0,0.55)]">
            <div className="absolute inset-0">
              <div className="absolute -inset-20 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.35),_transparent_60%),_radial-gradient(circle_at_bottom,_rgba(129,140,248,0.45),_transparent_55%)] opacity-80" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(15,23,42,0.5),transparent_50%),radial-gradient(circle_at_80%_110%,rgba(15,23,42,0.8),transparent_55%)]" />
            </div>
            <div className="relative h-full flex flex-col justify-between p-5 sm:p-6">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-200/70">
                  CurrentX Meta Pools
                </p>
                <h3 className="mt-2 text-lg sm:text-xl font-semibold text-slate-50">
                  A new horizon for L2 liquidity.
                </h3>
                <p className="mt-2 text-xs sm:text-sm text-slate-200/80 max-w-xs">
                  Concentrated & volatile pools, native routing and incentives designed
                  for omnichain CXT markets.
                </p>
              </div>
              <div className="mt-6 flex items-center justify-between gap-3">
                <div className="space-y-1 text-xs sm:text-sm">
                  <p className="text-slate-200/80">Active pools</p>
                  <p className="text-lg font-semibold text-slate-50">128</p>
                </div>
                <div className="space-y-1 text-xs sm:text-sm">
                  <p className="text-slate-200/80">Best APR</p>
                  <p className="text-lg font-semibold text-emerald-300">1,016%</p>
                </div>
                <div className="flex items-center justify-center rounded-full border border-slate-300/20 bg-slate-950/50 px-3 py-1.5 text-[11px] sm:text-xs text-slate-100/90">
                  Auto-compound with one click
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Filters + search */}
        <div className="bg-[#050918]/90 border border-white/5 rounded-2xl lg:rounded-3xl px-4 sm:px-5 py-3 sm:py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`rounded-full px-3 py-1.5 text-xs sm:text-sm border transition-all ${
                  activeFilter === f
                    ? "bg-sky-500 text-slate-950 border-sky-400 shadow-md shadow-sky-500/40"
                    : "bg-slate-950/40 text-slate-300 border-slate-700/60 hover:border-slate-400/80 hover:bg-slate-900/80"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <select className="rounded-xl bg-slate-950/60 border border-slate-700/70 text-xs sm:text-sm text-slate-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-sky-400/70">
              <option>Sort by TVL</option>
              <option>Sort by Volume 24h</option>
              <option>Sort by APR</option>
            </select>
            <div className="relative">
              <input
                type="text"
                placeholder="Symbol or address..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-48 sm:w-60 rounded-xl bg-slate-950/60 border border-slate-700/70 text-xs sm:text-sm text-slate-100 px-3 py-2 pl-8 focus:outline-none focus:ring-1 focus:ring-sky-400/70 placeholder:text-slate-500"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                🔍
              </span>
            </div>
          </div>
        </div>

        {/* Pools table */}
        <div className="bg-[#050918]/90 border border-white/5 rounded-2xl lg:rounded-3xl overflow-hidden shadow-[0_18px_60px_rgba(0,0,0,0.65)]">
          <div className="px-4 sm:px-5 py-3 border-b border-slate-800/80 flex items-center justify-between text-[11px] sm:text-xs text-slate-400">
            <span className="w-[28%] text-left">Pools</span>
            <span className="w-[14%] text-right hidden sm:inline-block">
              Volume (24h)
            </span>
            <span className="w-[14%] text-right hidden sm:inline-block">
              Fees (24h)
            </span>
            <span className="w-[14%] text-right">TVL</span>
            <span className="w-[12%] text-right">APR</span>
            <span className="w-[18%] text-right pr-2 sm:pr-3">Action</span>
          </div>

          {filteredPools.length === 0 && (
            <div className="px-4 sm:px-5 py-6 text-sm text-slate-400">
              Nessuna pool trovata con questi filtri.
            </div>
          )}

          {filteredPools.map((pool, idx) => (
            <PoolRow key={pool.id} pool={pool} isOdd={idx % 2 === 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-950/60 px-3 py-3 sm:px-4 sm:py-3.5 flex flex-col justify-between">
      <span className="text-[10px] sm:text-xs uppercase tracking-[0.16em] text-slate-400/80">
        {label}
      </span>
      <span className="mt-1 text-sm sm:text-base font-semibold text-slate-50">
        {value}
      </span>
      <span className="mt-1 text-[10px] sm:text-[11px] text-emerald-300/90">
        {hint}
      </span>
    </div>
  );
}

function PoolRow({ pool, isOdd }) {
  const tokens = pool.tokens || [];

  return (
    <div
      className={`px-4 sm:px-5 py-3.5 sm:py-4 text-[11px] sm:text-xs flex items-center text-slate-100 ${
        isOdd ? "bg-slate-950/40" : "bg-slate-950/10"
      } border-t border-slate-900/70`}
    >
      <div className="w-[28%] flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {/* Token icons */}
          <div className="flex -space-x-1.5">
            {tokens.slice(0, 2).map((symbol) => {
              const logo = TOKEN_ICONS[symbol.toUpperCase()];

              if (logo) {
                return (
                  <img
                    key={symbol}
                    src={logo}
                    alt={symbol}
                    className="h-6 w-6 rounded-full border border-slate-950 bg-slate-900 object-cover shadow-md"
                  />
                );
              }

              // fallback (es. CXT per ora)
              return (
                <span
                  key={symbol}
                  className="h-6 w-6 rounded-full bg-sky-500/80 border border-slate-950 shadow-md shadow-sky-500/40"
                />
              );
            })}
          </div>

          <div className="flex flex-col">
            <span className="text-xs sm:text-sm font-medium">{pool.pair}</span>
            <span className="text-[10px] text-slate-400">{pool.type}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          {pool.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center rounded-full border border-slate-700/70 bg-slate-950/70 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-slate-300"
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="w-[14%] text-right text-slate-200 hidden sm:block">
        {pool.volume}
      </div>
      <div className="w-[14%] text-right text-slate-200 hidden sm:block">
        {pool.fees}
      </div>
      <div className="w-[14%] text-right text-slate-100">{pool.tvl}</div>
      <div className="w-[12%] text-right text-emerald-300 font-medium">
        {pool.apr}
      </div>

      <div className="w-[18%] flex justify-end gap-2 pr-1 sm:pr-2">
        <button className="rounded-full bg-sky-500/90 hover:bg-sky-400 text-slate-950 px-3 py-1.5 text-[10px] sm:text-xs font-semibold transition-colors">
          Deposit
        </button>
        <button className="rounded-full border border-slate-600/70 px-3 py-1.5 text-[10px] sm:text-xs text-slate-200 hover:border-slate-300/80 hover:bg-slate-900/70 transition-colors">
          Details
        </button>
      </div>
    </div>
  );
}
