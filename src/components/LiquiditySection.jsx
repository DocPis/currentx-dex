// src/components/LiquiditySection.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Contract, formatUnits, parseUnits } from "ethers";
import {
  TOKENS,
  getProvider,
  getV2PairReserves,
  WETH_ADDRESS,
  USDC_ADDRESS,
  ERC20_ABI,
  UNIV2_PAIR_ABI,
  WETH_ABI,
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
  const [depositEth, setDepositEth] = useState("");
  const [depositUsdc, setDepositUsdc] = useState("");
  const [withdrawLp, setWithdrawLp] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadTvl = async () => {
      try {
        setTvlError("");
        setSubgraphError("");

        // Subgraph (primary)
        const subgraphUrl = import.meta.env.VITE_UNIV2_SUBGRAPH;
        if (subgraphUrl) {
          try {
            const live = await fetchV2PairData(WETH_ADDRESS, USDC_ADDRESS);
            if (!cancelled) {
              setEthUsdcLive(live);
              if (live?.note) setSubgraphError(live.note);
            }
          } catch (sgErr) {
            if (!cancelled)
              setSubgraphError(sgErr.message || "Subgraph fetch failed");
          }
        } else if (!cancelled) {
          setSubgraphError(
            "Set VITE_UNIV2_SUBGRAPH to enable live subgraph data"
          );
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

  const handleDeposit = async () => {
    try {
      setActionStatus("");
      setActionLoading(true);

      const ethAmount = depositEth ? Number(depositEth) : 0;
      const usdcAmount = depositUsdc ? Number(depositUsdc) : 0;
      if (ethAmount <= 0 || usdcAmount <= 0) {
        throw new Error("Enter amounts for ETH and USDC");
      }

      const provider = await getProvider();
      const signer = await provider.getSigner();
      const user = await signer.getAddress();

      // Pair address
      const { pairAddress } = await getV2PairReserves(
        provider,
        WETH_ADDRESS,
        USDC_ADDRESS
      );
      const pair = new Contract(pairAddress, UNIV2_PAIR_ABI, signer);

      // Wrap ETH -> WETH
      const wethContract = new Contract(WETH_ADDRESS, WETH_ABI, signer);
      const wethValue = parseUnits(ethAmount.toString(), TOKENS.WETH.decimals);
      await (await wethContract.deposit({ value: wethValue })).wait();

      // Transfer WETH + USDC to pair
      const usdcContract = new Contract(
        USDC_ADDRESS,
        ERC20_ABI,
        signer
      );
      const usdcValue = parseUnits(
        usdcAmount.toString(),
        TOKENS.USDC.decimals
      );

      await (await wethContract.transfer(pairAddress, wethValue)).wait();
      await (await usdcContract.transfer(pairAddress, usdcValue)).wait();

      // Mint LP to user
      const tx = await pair.mint(user);
      const receipt = await tx.wait();
      setActionStatus(
        `Deposited and minted LP (tx ${receipt.hash.slice(0, 10)}...)`
      );
    } catch (e) {
      setActionStatus(e.message || "Deposit failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleWithdraw = async () => {
    try {
      setActionStatus("");
      setActionLoading(true);
      const lpAmount = withdrawLp ? Number(withdrawLp) : 0;
      if (lpAmount <= 0) throw new Error("Enter LP amount to withdraw");

      const provider = await getProvider();
      const signer = await provider.getSigner();
      const user = await signer.getAddress();

      const { pairAddress } = await getV2PairReserves(
        provider,
        WETH_ADDRESS,
        USDC_ADDRESS
      );

      const pair = new Contract(pairAddress, UNIV2_PAIR_ABI, signer);

      // Pair as ERC20 to get decimals and transfer LP to pair before burn
      const pairErc20 = new Contract(pairAddress, ERC20_ABI, signer);
      const lpDecimals = await pairErc20.decimals();
      const lpValue = parseUnits(lpAmount.toString(), lpDecimals);

      await (await pairErc20.transfer(pairAddress, lpValue)).wait();
      const tx = await pair.burn(user);
      const receipt = await tx.wait();
      setActionStatus(
        `Withdrew liquidity (tx ${receipt.hash.slice(0, 10)}...)`
      );
    } catch (e) {
      setActionStatus(e.message || "Withdraw failed");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 pb-12 text-slate-100 mt-8">
      {/* hero / stats */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        <div className="xl:col-span-2 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-900/60 border border-slate-800/80 shadow-2xl shadow-black/40 overflow-hidden">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 p-6">
            <div className="flex items-start gap-3">
              <div className="h-11 w-11 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-300">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                >
                  <path
                    d="M5 6h14M5 12h14M5 18h14"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm text-slate-300/90">
                  Provide liquidity to enable low-slippage swaps and earn
                  emissions.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs px-2 py-1 rounded-full bg-slate-800/70 border border-slate-700 text-slate-200">
                    Live data
                  </span>
                  <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                    Sepolia V2
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 min-w-[280px] text-right">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                  Volume 24h
                </div>
                <div className="text-xl font-semibold">
                  {formatNumber(totalVolume)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                  Fees 24h
                </div>
                <div className="text-xl font-semibold">
                  {formatNumber(totalFees)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                  TVL
                </div>
                <div className="text-xl font-semibold">
                  {formatNumber(totalTvl)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl bg-gradient-to-br from-indigo-700 via-sky-600 to-cyan-400 border border-white/10 shadow-2xl shadow-indigo-900/40 p-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.12),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(255,255,255,0.18),transparent_40%)]" />
          <div className="relative h-full flex flex-col justify-between">
            <div className="text-xs font-semibold tracking-[0.2em] text-white/80 mb-3">
              CURRENTX LIQUIDITY
            </div>
            <div className="text-3xl font-bold leading-tight mb-2 drop-shadow">
              Autopilot Mode
            </div>
            <p className="text-sm text-white/80 mb-4 max-w-sm">
              Deploy liquidity with a balanced ETH/USDC mix and track live TVL
              from the subgraph.
            </p>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/15 text-sm font-semibold text-white border border-white/30 w-fit shadow-lg shadow-black/30">
              Start providing
              <svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
              >
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* controls */}
      <div className="bg-[#050816] border border-slate-800/80 rounded-3xl shadow-xl shadow-black/40 mb-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 px-4 sm:px-6 py-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-slate-200">
              Pools
            </span>
            <span className="px-3 py-1.5 rounded-full bg-slate-900/70 border border-slate-800 text-slate-500">
              Tokens
            </span>
            <span className="hidden sm:inline text-slate-500 text-xs">
              Sorted by TVL | Live (subgraph + on-chain fallback)
            </span>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
            <div className="flex items-center gap-2 bg-slate-900/70 border border-slate-800 rounded-full px-3 py-2 text-xs text-slate-300 w-full lg:w-72">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 text-slate-500"
              >
                <circle
                  cx="11"
                  cy="11"
                  r="6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M15.5 15.5 20 20"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <input
                placeholder="Search pools..."
                className="bg-transparent outline-none flex-1 text-slate-200 placeholder:text-slate-600 text-sm"
              />
            </div>
            <button className="hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-full bg-sky-600 text-sm font-semibold text-white shadow-lg shadow-sky-500/30">
              Launch pool
            </button>
          </div>
        </div>
        <div className="hidden md:block px-4 sm:px-6 pb-2 text-[11px] sm:text-xs text-slate-500 border-t border-slate-800/70">
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
                className="flex flex-col gap-3 md:grid md:grid-cols-12 md:items-center px-2 sm:px-4 py-3 rounded-2xl hover:bg-slate-900/80 border border-transparent hover:border-slate-800 transition"
              >
                <div className="md:col-span-4 flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {[token0, token1].map((t, idx) => (
                      <img
                        key={idx}
                        src={t?.logo}
                        alt={`${t?.symbol || "token"} logo`}
                        className="h-9 w-9 rounded-full border border-slate-800 bg-slate-900 object-contain"
                      />
                    ))}
                  </div>
                  <div className="flex flex-col">
                    <div className="text-sm font-semibold">
                      {p.token0Symbol} / {p.token1Symbol}
                    </div>
                    <div className="text-[11px] text-slate-500 capitalize">
                      {p.poolType || "volatile"} pool
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 w-full text-xs text-slate-400 md:hidden">
                  <div className="flex justify-between w-full">
                    <span>Volume</span>
                    <span className="text-slate-100">
                      {formatNumber(p.volume24hUsd)}
                    </span>
                  </div>
                  <div className="flex justify-between w-full">
                    <span>Fees</span>
                    <span className="text-slate-100">
                      {formatNumber(p.fees24hUsd)}
                    </span>
                  </div>
                  <div className="flex justify-between w-full">
                    <span>TVL</span>
                    <span className="text-slate-100">
                      {formatNumber(p.tvlUsd)}
                    </span>
                  </div>
                  <div className="flex justify-between w-full">
                    <span>Fee APR</span>
                    <span className="text-slate-100">
                      {p.feeApr ? `${p.feeApr.toFixed(2)}%` : "N/A"}
                    </span>
                  </div>
                  <div className="flex justify-between w-full">
                    <span>Emission APR</span>
                    <span className="text-slate-100">
                      {p.emissionApr.toFixed(2)}%
                    </span>
                  </div>
                </div>

                <div className="hidden md:block md:col-span-2 text-right text-xs sm:text-sm">
                  {formatNumber(p.volume24hUsd)}
                </div>
                <div className="hidden md:block md:col-span-2 text-right text-xs sm:text-sm">
                  {formatNumber(p.fees24hUsd)}
                </div>
                <div className="hidden md:block md:col-span-2 text-right text-xs sm:text-sm">
                  {formatNumber(p.tvlUsd)}
                </div>
                <div className="hidden md:block md:col-span-1 text-right text-xs sm:text-sm">
                  {p.feeApr ? `${p.feeApr.toFixed(2)}%` : "N/A"}
                </div>
                <div className="hidden md:block md:col-span-1 text-right text-xs sm:text-sm">
                  {p.emissionApr.toFixed(2)}%
                </div>
              </div>
            );
          })}
        </div>

        {/* ETH/USDC actions */}
        <div className="px-4 pb-4 border-t border-slate-800/70 pt-4 bg-slate-900/40 rounded-b-3xl">
          <div className="flex flex-col lg:flex-row lg:items-center gap-4">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                value={depositEth}
                onChange={(e) => setDepositEth(e.target.value)}
                placeholder="ETH amount"
                className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100"
              />
              <input
                value={depositUsdc}
                onChange={(e) => setDepositUsdc(e.target.value)}
                placeholder="USDC amount"
                className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100"
              />
              <button
                disabled={actionLoading}
                onClick={handleDeposit}
                className="px-4 py-2.5 rounded-xl bg-sky-600 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 disabled:opacity-60 w-full md:w-auto"
              >
                {actionLoading ? "Processing..." : "Deposit ETH/USDC"}
              </button>
            </div>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                value={withdrawLp}
                onChange={(e) => setWithdrawLp(e.target.value)}
                placeholder="LP tokens"
                className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100"
              />
              <button
                disabled={actionLoading}
                onClick={handleWithdraw}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 disabled:opacity-60 w-full md:w-auto"
              >
                {actionLoading ? "Processing..." : "Withdraw ETH/USDC"}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 mt-3 text-xs">
            {actionStatus && (
              <div className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200">
                {actionStatus}
              </div>
            )}
            {subgraphError && (
              <div className="px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-700 text-slate-200">
                Subgraph: {subgraphError}
              </div>
            )}
            {tvlError && (
              <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200">
                On-chain TVL: {tvlError}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
