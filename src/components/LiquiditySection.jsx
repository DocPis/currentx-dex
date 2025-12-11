import React from "react";

// Helper per formattare i numeri stile DEX
const formatNumber = (value) => {
  if (value == null || isNaN(value)) return "-";
  if (value >= 1_000_000_000) return `~$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `~$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `~$${(value / 1_000).toFixed(2)}K`;
  return `~$${value.toFixed(2)}`;
};

const formatPercent = (value) => {
  if (value == null || isNaN(value)) return "N/A";
  return `${value.toFixed(2)}%`;
};

/**
 * props:
 * - pools: [{
 *    id,
 *    token0Symbol,
 *    token1Symbol,
 *    token0LogoURI,
 *    token1LogoURI,
 *    volume24hUsd,
 *    fees24hUsd,
 *    tvlUsd,
 *    feeApr,
 *    emissionApr,
 *    typeLabel,
 *    volatilityLabel,
 *  }]
 * - onSelectPool(pool)
 * - onLaunchPool()
 */
const LiquiditySection = ({ pools = [], onSelectPool, onLaunchPool }) => {
  const totalVolume = pools.reduce(
    (acc, p) => acc + (p.volume24hUsd || 0),
    0
  );
  const totalFees = pools.reduce(
    (acc, p) => acc + (p.fees24hUsd || 0),
    0
  );
  const totalTvl = pools.reduce(
    (acc, p) => acc + (p.tvlUsd || 0),
    0
  );

  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 pb-12 text-slate-100">
      {/* Top header cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Stats card */}
        <div className="col-span-1 lg:col-span-2 bg-[#050816] border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xl shadow-black/40">
          <p className="text-sm text-slate-400 mb-4">
            Provide liquidity to enable low-slippage swaps and earn emissions.
          </p>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                Volume
              </div>
              <div className="text-lg sm:text-xl font-semibold">
                {formatNumber(totalVolume)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                Fees
              </div>
              <div className="text-lg sm:text-xl font-semibold">
                {formatNumber(totalFees)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                TVL
              </div>
              <div className="text-lg sm:text-xl font-semibold">
                {formatNumber(totalTvl)}
              </div>
            </div>
          </div>
        </div>

        {/* Gradient banner */}
        <div className="col-span-1 bg-gradient-to-br from-[#1b1f4d] via-[#4338ca] to-[#f97316] rounded-2xl p-5 sm:p-6 relative overflow-hidden shadow-xl shadow-black/40">
          <div className="absolute inset-0 bg-black/20 pointer-events-none" />
          <div className="relative z-10 h-full flex flex-col justify-between">
            <div className="text-xs font-medium tracking-[0.2em] text-slate-200/80 mb-3">
              BUILT FOR CURRENTX
            </div>
            <div className="text-2xl sm:text-3xl font-bold leading-tight mb-4">
              <span className="block">BUILT</span>
              <span className="block text-slate-100/80 text-base mt-1">
                to power liquidity
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-200/80">
                Launch liquidity on CurrentX
              </span>
              <button
                onClick={onLaunchPool}
                className="text-xs font-semibold px-3 py-1.5 rounded-full bg-black/30 backdrop-blur border border-white/20 hover:bg-black/40 transition"
              >
                Launch now
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs + filters */}
      <div className="bg-[#050816] border border-slate-800/80 rounded-2xl shadow-xl shadow-black/40">
        {/* Tabs */}
        <div className="flex items-center px-4 sm:px-6 pt-4">
          <div className="inline-flex bg-slate-900/80 rounded-full p-1 text-xs sm:text-sm">
            <button className="px-3 sm:px-4 py-1.5 rounded-full bg-slate-800 text-slate-100 font-medium">
              Pools
            </button>
            <button className="px-3 sm:px-4 py-1.5 rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition">
              Tokens
            </button>
          </div>
        </div>

        {/* Filters + search */}
        <div className="px-4 sm:px-6 pb-3 pt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Left filters */}
          <div className="flex flex-wrap gap-2 text-[11px] sm:text-xs text-slate-300">
            <FilterPill label="Token" value="Listed & Emerging" />
            <FilterPill label="Type" value="Any" />
            <FilterPill label="Volatility" value="Any" />
            <FilterPill label="Autopilot" value="Inactive" />
            <FilterPill label="Advanced" value="Inactive" />
            <FilterPill label="Sort" value="TVL" />
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2 w-full lg:w-auto">
            <button
              onClick={onLaunchPool}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-sky-500 hover:bg-sky-400 text-xs sm:text-sm font-semibold shadow-md shadow-sky-500/25 w-max"
            >
              <span>Launch pool</span>
            </button>
            <div className="flex-1 lg:flex-none">
              <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-800 rounded-full px-3 py-1.5 text-xs sm:text-sm text-slate-300">
                <SearchIcon />
                <input
                  type="text"
                  placeholder="Symbol or address..."
                  className="bg-transparent outline-none flex-1 text-xs sm:text-sm placeholder:text-slate-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Header row */}
        <div className="px-4 sm:px-6 pb-2 text-[11px] sm:text-xs text-slate-500 border-t border-slate-800/70">
          <div className="grid grid-cols-12 py-2">
            <div className="col-span-4">Pools</div>
            <div className="col-span-2 text-right">Volume</div>
            <div className="col-span-2 text-right">Fees</div>
            <div className="col-span-2 text-right">TVL</div>
            <div className="col-span-1 text-right">Fee APR</div>
            <div className="col-span-1 text-right">Emission APR</div>
          </div>
        </div>

        {/* Pool rows */}
        <div className="px-2 sm:px-4 pb-3 max-h-[520px] overflow-y-auto custom-scroll">
          {pools.length === 0 ? (
            <div className="px-4 sm:px-6 py-8 text-center text-sm text-slate-500">
              No pools found. Connect your factory / subgraph to load real
              liquidity pools.
            </div>
          ) : (
            pools.map((pool) => (
              <button
                key={pool.id}
                onClick={() => onSelectPool && onSelectPool(pool)}
                className="w-full text-left"
              >
                <div className="grid grid-cols-12 items-center px-2 sm:px-4 py-3 rounded-xl hover:bg-slate-900/80 transition border border-transparent hover:border-slate-700/70">
                  {/* Token info */}
                  <div className="col-span-4 flex items-center gap-3">
                    <div className="flex -space-x-2">
                      <TokenLogo src={pool.token0LogoURI} symbol={pool.token0Symbol} />
                      <TokenLogo src={pool.token1LogoURI} symbol={pool.token1Symbol} />
                    </div>
                    <div className="flex flex-col">
                      <div className="text-sm font-medium">
                        {pool.token0Symbol} / {pool.token1Symbol}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {pool.typeLabel || "Volatile"}{" "}
                        {pool.volatilityLabel && (
                          <span className="ml-1 text-sky-400">
                            {pool.volatilityLabel}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Volume */}
                  <div className="col-span-2 text-right text-xs sm:text-sm">
                    <div>{formatNumber(pool.volume24hUsd || 0)}</div>
                  </div>

                  {/* Fees */}
                  <div className="col-span-2 text-right text-xs sm:text-sm">
                    <div>{formatNumber(pool.fees24hUsd || 0)}</div>
                  </div>

                  {/* TVL */}
                  <div className="col-span-2 text-right text-xs sm:text-sm">
                    <div>{formatNumber(pool.tvlUsd || 0)}</div>
                  </div>

                  {/* Fee APR */}
                  <div className="col-span-1 text-right text-xs sm:text-sm">
                    {formatPercent(pool.feeApr)}
                  </div>

                  {/* Emission APR + new deposit */}
                  <div className="col-span-1 text-right text-xs sm:text-sm flex flex-col items-end">
                    <span>{formatPercent(pool.emissionApr)}</span>
                    <span className="text-[11px] text-sky-400 mt-0.5 hover:text-sky-300">
                      + New deposit
                    </span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const FilterPill = ({ label, value }) => (
  <button className="flex items-center gap-1 px-3 py-1 rounded-full bg-slate-900/90 border border-slate-800 text-[11px] sm:text-xs hover:border-slate-600/80 transition">
    <span className="text-slate-500">{label}</span>
    <span className="font-medium">{value}</span>
    <ChevronDownIcon />
  </button>
);

const TokenLogo = ({ src, symbol }) => (
  <div className="h-7 w-7 rounded-full border border-slate-800 bg-slate-900 flex items-center justify-center overflow-hidden">
    {src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={symbol} className="h-full w-full object-cover" />
    ) : (
      <span className="text-[10px] font-semibold text-slate-300">
        {symbol?.slice(0, 3) || "?"}
      </span>
    )}
  </div>
);

const ChevronDownIcon = () => (
  <svg
    className="w-3 h-3 text-slate-400"
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M5 7.5L10 12.5L15 7.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SearchIcon = () => (
  <svg
    className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-500"
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M9.167 3.333A5.833 5.833 0 1 0 9.167 15a5.833 5.833 0 0 0 0-11.667Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="m15 15-1.75-1.75"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default LiquiditySection;
