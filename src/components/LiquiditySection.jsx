// src/components/LiquiditySection.jsx
import React from "react";

const mockPools = [
  {
    id: "1",
    token0Symbol: "USDC",
    token1Symbol: "AERO",
    volume24hUsd: 80957,
    fees24hUsd: 242,
    tvlUsd: 38560000,
    feeApr: 0,
    emissionApr: 16.24,
  },
];

const formatNumber = (v) => {
  if (v >= 1_000_000_000) return `~$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `~$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `~$${(v / 1_000).toFixed(2)}K`;
  return `~$${v.toFixed(2)}`;
};

export default function LiquiditySection() {
  const totalVolume = mockPools.reduce(
    (a, p) => a + p.volume24hUsd,
    0
  );
  const totalFees = mockPools.reduce((a, p) => a + p.fees24hUsd, 0);
  const totalTvl = mockPools.reduce((a, p) => a + p.tvlUsd, 0);

  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 pb-12 text-slate-100 mt-8">
      {/* top cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="col-span-1 lg:col-span-2 bg-[#050816] border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xl shadow-black/40">
          <p className="text-sm text-slate-400 mb-4">
            Provide liquidity to enable low-slippage swaps and earn
            emissions.
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

        <div className="col-span-1 bg-gradient-to-br from-[#1b1f4d] via-[#4338ca] to-[#f97316] rounded-2xl p-5 sm:p-6 shadow-xl shadow-black/40">
          <div className="h-full flex flex-col justify-between">
            <div className="text-xs font-medium tracking-[0.2em] text-slate-200/80 mb-3">
              BUILT FOR CURRENTX
            </div>
            <div className="text-2xl sm:text-3xl font-bold leading-tight mb-4">
              <span className="block">BUILT</span>
              <span className="block text-slate-100/80 text-base mt-1">
                to power liquidity
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* pools table */}
      <div className="bg-[#050816] border border-slate-800/80 rounded-2xl shadow-xl shadow-black/40">
        <div className="px-4 sm:px-6 pb-2 text-[11px] sm:text-xs text-slate-500 border-b border-slate-800/70 pt-4">
          <div className="grid grid-cols-12 py-2">
            <div className="col-span-4">Pools</div>
            <div className="col-span-2 text-right">Volume</div>
            <div className="col-span-2 text-right">Fees</div>
            <div className="col-span-2 text-right">TVL</div>
            <div className="col-span-1 text-right">Fee APR</div>
            <div className="col-span-1 text-right">Emission APR</div>
          </div>
        </div>

        <div className="px-2 sm:px-4 pb-3">
          {mockPools.map((p) => (
            <div
              key={p.id}
              className="grid grid-cols-12 items-center px-2 sm:px-4 py-3 rounded-xl hover:bg-slate-900/80 transition"
            >
              <div className="col-span-4 flex flex-col">
                <div className="text-sm font-medium">
                  {p.token0Symbol} / {p.token1Symbol}
                </div>
                <div className="text-[11px] text-slate-500">
                  Basic volatile
                </div>
              </div>
              <div className="col-span-2 text-right text-xs sm:text-sm">
                {formatNumber(p.volume24hUsd)}
              </div>
              <div className="col-span-2 text-right text-xs sm:text-sm">
                {formatNumber(p.fees24hUsd)}
              </div>
              <div className="col-span-2 text-right text-xs sm:text-sm">
                {formatNumber(p.tvlUsd)}
              </div>
              <div className="col-span-1 text-right text-xs sm:text-sm">
                {p.feeApr ? `${p.feeApr.toFixed(2)}%` : "N/A"}
              </div>
              <div className="col-span-1 text-right text-xs sm:text-sm">
                {p.emissionApr.toFixed(2)}%
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
