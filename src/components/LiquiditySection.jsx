// src/components/LiquiditySection.jsx
import React, { useEffect, useMemo, useState } from "react";
import { formatUnits } from "ethers";
import {
  TOKENS,
  getProvider,
  getV2PairReserves,
  WETH_ADDRESS,
  USDC_ADDRESS,
} from "../config/web3";
import { fetchV2PairData } from "../config/subgraph";

const mockPools = [
  {
    id: "weth-usdc",
    token0Symbol: "WETH",
    token1Symbol: "USDC",
    volume24hUsd: 1204500,
    fees24hUsd: 3600,
    tvlUsd: 18250000,
    feeApr: 5.72,
    emissionApr: 18.4,
    poolType: "volatile",
  },
  {
    id: "wbtc-usdc",
    token0Symbol: "WBTC",
    token1Symbol: "USDC",
    volume24hUsd: 987000,
    fees24hUsd: 2950,
    tvlUsd: 20500000,
    feeApr: 4.98,
    emissionApr: 16.1,
    poolType: "volatile",
  },
  {
    id: "dai-usdc",
    token0Symbol: "DAI",
    token1Symbol: "USDC",
    volume24hUsd: 453200,
    fees24hUsd: 690,
    tvlUsd: 12480000,
    feeApr: 3.12,
    emissionApr: 12.6,
    poolType: "stable",
  },
  {
    id: "eth-usdc",
    token0Symbol: "ETH",
    token1Symbol: "USDC",
    volume24hUsd: 765000,
    fees24hUsd: 2200,
    tvlUsd: 15800000,
    feeApr: 4.35,
    emissionApr: 14.2,
    poolType: "volatile",
  },
];

const formatNumber = (v) => {
  if (v >= 1_000_000_000) return `~$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `~$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `~$${(v / 1_000).toFixed(2)}K`;
  return `~$${v.toFixed(2)}`;
};

export default function LiquiditySection() {
  const [ethUsdcTvl, setEthUsdcTvl] = useState(null);
  const [tvlError, setTvlError] = useState("");
  const [ethUsdcLive, setEthUsdcLive] = useState(null);
  const [subgraphError, setSubgraphError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const loadTvl = async () => {
      try {
        setTvlError("");
        setSubgraphError("");

        // Subgraph (primary)
        try {
          const live = await fetchV2PairData(WETH_ADDRESS, USDC_ADDRESS);
          if (!cancelled) setEthUsdcLive(live);
        } catch (sgErr) {
          if (!cancelled)
            setSubgraphError(sgErr.message || "Subgraph fetch failed");
        }

        // On-chain fallback TVL if wallet/provider is available
        try {
          const provider = await getProvider();
          const { reserve0, reserve1, token0 } = await getV2PairReserves(
            provider,
            TOKENS.WETH.address,
            TOKENS.USDC.address
          );

          const wethIs0 =
            token0.toLowerCase() === TOKENS.WETH.address.toLowerCase();
          const reserveWeth = wethIs0 ? reserve0 : reserve1;
          const reserveUsdc = wethIs0 ? reserve1 : reserve0;

          const wethFloat = Number(
            formatUnits(reserveWeth, TOKENS.WETH.decimals)
          );
          const usdcFloat = Number(
            formatUnits(reserveUsdc, TOKENS.USDC.decimals)
          );

          // Assume USDC ~ $1; pool is balanced so TVL ≈ 2 * USDC side in USD
          const tvlUsd = usdcFloat * 2;
          if (!cancelled) setEthUsdcTvl(tvlUsd);
        } catch (chainErr) {
          if (!cancelled)
            setTvlError(chainErr.message || "Failed to load TVL");
        }
      } catch (e) {
        if (!cancelled) setTvlError(e.message || "Failed to load TVL");
      }
    };

    loadTvl();
    return () => {
      cancelled = true;
    };
  }, []);

  const pools = useMemo(() => {
    return mockPools.map((p) => {
      if (p.id === "eth-usdc") {
        const overrides = {};
        if (ethUsdcLive) {
          overrides.tvlUsd =
            ethUsdcLive.tvlUsd || ethUsdcTvl || p.tvlUsd;
          overrides.volume24hUsd =
            ethUsdcLive.volume24hUsd ?? p.volume24hUsd;
          overrides.fees24hUsd =
            ethUsdcLive.fees24hUsd ?? p.fees24hUsd;
        } else if (ethUsdcTvl) {
          overrides.tvlUsd = ethUsdcTvl;
        }
        return { ...p, ...overrides };
      }
      return p;
    });
  }, [ethUsdcLive, ethUsdcTvl]);

  const totalVolume = pools.reduce((a, p) => a + p.volume24hUsd, 0);
  const totalFees = pools.reduce((a, p) => a + p.fees24hUsd, 0);
  const totalTvl = pools.reduce((a, p) => a + p.tvlUsd, 0);

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
          {pools.map((p) => {
            const token0 = TOKENS[p.token0Symbol];
            const token1 = TOKENS[p.token1Symbol];

            return (
              <div
                key={p.id}
                className="grid grid-cols-12 items-center px-2 sm:px-4 py-3 rounded-xl hover:bg-slate-900/80 transition"
              >
                <div className="col-span-4 flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {[token0, token1].map((t, idx) => (
                      <img
                        key={idx}
                        src={t?.logo}
                        alt={`${t?.symbol || "token"} logo`}
                        className="h-8 w-8 rounded-full border border-slate-800 bg-slate-900 object-contain"
                      />
                    ))}
                  </div>
                  <div className="flex flex-col">
                    <div className="text-sm font-medium">
                      {p.token0Symbol} / {p.token1Symbol}
                    </div>
                    <div className="text-[11px] text-slate-500 capitalize">
                      {p.poolType || "volatile"} pool
                    </div>
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
            );
          })}
        </div>
      </div>
    </div>
  );
}
