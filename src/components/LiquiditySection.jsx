import React, { useEffect, useState } from "react";
import { ethers } from "ethers";

// ABI
import IUniswapV2FactoryABI from "../abi/IUniswapV2Factory.json";
import IUniswapV2PairABI from "../abi/IUniswapV2Pair.json";
import IUniswapV2RouterABI from "../abi/IUniswapV2Router02.json";

// SOLO router: la factory la leggiamo da router.factory()
import { UNISWAP_V2_ROUTER_ADDRESS } from "../utils/contracts";
import { TOKEN_REGISTRY } from "../utils/tokenRegistry";

const formatUnits =
  ethers.utils && ethers.utils.formatUnits
    ? ethers.utils.formatUnits
    : ethers.formatUnits;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const PAIRS_TO_TRACK = [
  ["WETH", "USDC"],
  ["WETH", "WBTC"],
  ["WETH", "DAI"],
];

function getTokenBySymbol(symbol) {
  return TOKEN_REGISTRY.find((t) => t.symbol === symbol);
}

const LiquiditySection = ({ provider, account }) => {
  const [pools, setPools] = useState([]);
  const [loadingPools, setLoadingPools] = useState(false);

  const [isRemoveOpen, setIsRemoveOpen] = useState(false);
  const [removeState, setRemoveState] = useState({
    pairAddress: null,
    token0: null,
    token1: null,
    lpBalance: null,
    totalSupply: null,
    reserve0: null,
    reserve1: null,
  });
  const [removePercent, setRemovePercent] = useState(100);
  const [removeEstimates, setRemoveEstimates] = useState({
    amount0: "0",
    amount1: "0",
  });
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // ------------------------ LOAD POOLS ------------------------
  useEffect(() => {
    if (!provider) return;
    fetchPools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, account]);

  const fetchPools = async () => {
    try {
      setLoadingPools(true);

      // 1) partiamo dal router
      const router = new ethers.Contract(
        UNISWAP_V2_ROUTER_ADDRESS,
        IUniswapV2RouterABI.abi,
        provider
      );

      const factoryAddress = await router.factory();
      console.log("🏭 Factory address from router:", factoryAddress);

      if (!factoryAddress || factoryAddress === ZERO_ADDRESS) {
        console.warn("Factory address is zero/undefined, no pools");
        setPools([]);
        return;
      }

      // 2) factory reale presa dal router
      const factory = new ethers.Contract(
        factoryAddress,
        IUniswapV2FactoryABI.abi,
        provider
      );

      const loadedPools = [];

      for (const [sym0, sym1] of PAIRS_TO_TRACK) {
        const t0 = getTokenBySymbol(sym0);
        const t1 = getTokenBySymbol(sym1);
        if (!t0 || !t1) continue;

        const pairAddress = await factory.getPair(t0.address, t1.address);

        console.log(
          "▶️ Checking pair",
          `${sym0}/${sym1}`,
          "\n  token0:", t0.address,
          "\n  token1:", t1.address,
          "\n  pair  :", pairAddress
        );

        if (!pairAddress || pairAddress === ZERO_ADDRESS) continue;

        const pairContract = new ethers.Contract(
          pairAddress,
          IUniswapV2PairABI.abi,
          provider
        );

        const [reserves, totalSupply, lpBalance] = await Promise.all([
          pairContract.getReserves(),
          pairContract.totalSupply(),
          account ? pairContract.balanceOf(account) : Promise.resolve(0),
        ]);

        const reserve0 = reserves._reserve0;
        const reserve1 = reserves._reserve1;

        loadedPools.push({
          id: `${sym0}-${sym1}`,
          address: pairAddress,
          token0: t0,
          token1: t1,
          reserve0,
          reserve1,
          totalSupply,
          userLpBalance: lpBalance,
        });
      }

      setPools(loadedPools);
    } catch (err) {
      console.error("fetchPools error:", err);
      setPools([]);
    } finally {
      setLoadingPools(false);
    }
  };

  // ------------------------ OPEN REMOVE MODAL ------------------------
  const openRemoveModal = async (pool) => {
    try {
      if (!provider || !account) return;

      const signer = await provider.getSigner();
      const pairContract = new ethers.Contract(
        pool.address,
        IUniswapV2PairABI.abi,
        signer
      );

      const [lpBalance, reserves, totalSupply] = await Promise.all([
        pairContract.balanceOf(account),
        pairContract.getReserves(),
        pairContract.totalSupply(),
      ]);

      const reserve0 = reserves._reserve0;
      const reserve1 = reserves._reserve1;

      setRemoveState({
        pairAddress: pool.address,
        token0: pool.token0,
        token1: pool.token1,
        lpBalance,
        totalSupply,
        reserve0,
        reserve1,
      });

      setRemovePercent(100);

      if (!lpBalance || lpBalance === 0 || lpBalance.isZero()) {
        setRemoveEstimates({ amount0: "0", amount1: "0" });
      } else {
        const lpToBurn = lpBalance;
        const amount0 = lpToBurn.mul(reserve0).div(totalSupply);
        const amount1 = lpToBurn.mul(reserve1).div(totalSupply);

        setRemoveEstimates({
          amount0: formatUnits(amount0, pool.token0.decimals),
          amount1: formatUnits(amount1, pool.token1.decimals),
        });
      }

      setIsRemoveOpen(true);
    } catch (err) {
      console.error("openRemoveModal error:", err);
    }
  };

  // ------------------------ RECALC ESTIMATES ------------------------
  const recalcEstimates = (percent) => {
    const { lpBalance, totalSupply, reserve0, reserve1, token0, token1 } =
      removeState;

    if (
      !lpBalance ||
      !totalSupply ||
      !reserve0 ||
      !reserve1 ||
      lpBalance.isZero()
    ) {
      setRemoveEstimates({ amount0: "0", amount1: "0" });
      return;
    }

    const lpToBurn = lpBalance.mul(percent).div(100);
    const amount0 = lpToBurn.mul(reserve0).div(totalSupply);
    const amount1 = lpToBurn.mul(reserve1).div(totalSupply);

    setRemoveEstimates({
      amount0: formatUnits(amount0, token0.decimals),
      amount1: formatUnits(amount1, token1.decimals),
    });
  };

  // ------------------------ WITHDRAW ------------------------
  const handleWithdrawLiquidity = async () => {
    if (!provider || !account) return;

    const {
      pairAddress,
      token0,
      token1,
      lpBalance,
      totalSupply,
      reserve0,
      reserve1,
    } = removeState;

    if (!pairAddress || !lpBalance || lpBalance.isZero()) return;

    try {
      setIsWithdrawing(true);

      const signer = await provider.getSigner();
      const router = new ethers.Contract(
        UNISWAP_V2_ROUTER_ADDRESS,
        IUniswapV2RouterABI.abi,
        signer
      );

      const lpToBurn = lpBalance.mul(removePercent).div(100);
      if (lpToBurn.isZero()) {
        console.warn("LP to burn is zero, abort");
        return;
      }

      let minAmount0 = 0;
      let minAmount1 = 0;

      if (totalSupply && reserve0 && reserve1) {
        const amount0 = lpToBurn.mul(reserve0).div(totalSupply);
        const amount1 = lpToBurn.mul(reserve1).div(totalSupply);

        minAmount0 = amount0.mul(99).div(100);
        minAmount1 = amount1.mul(99).div(100);
      }

      const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

      const tx = await router.removeLiquidity(
        token0.address,
        token1.address,
        lpToBurn,
        minAmount0,
        minAmount1,
        account,
        deadline
      );

      await tx.wait();

      setIsRemoveOpen(false);
      setRemoveState({
        pairAddress: null,
        token0: null,
        token1: null,
        lpBalance: null,
        totalSupply: null,
        reserve0: null,
        reserve1: null,
      });
      setRemoveEstimates({ amount0: "0", amount1: "0" });

      await fetchPools();
    } catch (err) {
      console.error("handleWithdrawLiquidity error:", err);
    } finally {
      setIsWithdrawing(false);
    }
  };

  // ------------------------ RENDER ------------------------
  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">
            Provide liquidity. Earn CXT emissions.
          </h2>
          <p className="text-sm text-slate-400">
            Earn swap fees and CXT by providing liquidity to core pools.
          </p>
        </div>
      </div>

      {loadingPools ? (
        <div className="py-10 text-center text-slate-400">
          Loading pools...
        </div>
      ) : pools.length === 0 ? (
        <div className="py-10 text-center text-slate-500">
          No pools found on this network.
        </div>
      ) : (
        <div className="space-y-3">
          {pools.map((pool) => {
            const {
              id,
              token0,
              token1,
              reserve0,
              reserve1,
              totalSupply,
              userLpBalance,
            } = pool;

            const lpBalanceReadable =
              userLpBalance && !userLpBalance.isZero()
                ? formatUnits(userLpBalance, 18)
                : "0";

            return (
              <div
                key={id}
                className="flex items-center justify-between rounded-2xl bg-slate-900/80 px-4 py-3 shadow-sm shadow-black/40"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      {token0.symbol} / {token1.symbol}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Reserves:{" "}
                    {formatUnits(reserve0, token0.decimals)} {token0.symbol} ·{" "}
                    {formatUnits(reserve1, token1.decimals)} {token1.symbol}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Total supply:{" "}
                    {formatUnits(totalSupply || 0, 18)} LP — Your LP:{" "}
                    {lpBalanceReadable}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-40"
                    onClick={() => openRemoveModal(pool)}
                    disabled={!account}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isRemoveOpen && removeState.token0 && removeState.token1 && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 p-6 shadow-xl relative">
            <div className="flex items-center justify-between mb-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-pink-400 uppercase tracking-[0.16em]">
                  Remove liquidity
                </p>
                <h2 className="text-lg font-semibold text-white">
                  {removeState.token0.symbol} / {removeState.token1.symbol}
                </h2>
              </div>
              <button
                className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                onClick={() => setIsRemoveOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="mb-4 rounded-xl bg-slate-800/80 px-3 py-2 text-xs text-slate-300">
              {!removeState.lpBalance ||
              removeState.lpBalance.isZero() ? (
                <span>You don&apos;t have LP tokens in this pool yet.</span>
              ) : (
                <span>
                  Your LP:&nbsp;
                  <span className="font-mono">
                    {formatUnits(removeState.lpBalance, 18)}
                  </span>
                </span>
              )}
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-300">
                  Amount to withdraw
                </span>
                <span className="text-xs font-semibold text-white">
                  {removePercent}%
                </span>
              </div>

              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={removePercent}
                onChange={(e) => {
                  const pct = Number(e.target.value);
                  setRemovePercent(pct);
                  recalcEstimates(pct);
                }}
                className="w-full accent-pink-500"
              />

              <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                {[25, 50, 75, 100].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setRemovePercent(v);
                      recalcEstimates(v);
                    }}
                    className={`flex-1 rounded-full border px-2 py-1 ${
                      removePercent === v
                        ? "border-pink-500 bg-pink-500/10 text-pink-300"
                        : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {v}%
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4 space-y-1 rounded-xl bg-slate-800/80 px-3 py-3 text-xs text-slate-300">
              <div className="flex justify-between">
                <span>Estimated out ({removeState.token0.symbol})</span>
                <span className="font-mono text-white">
                  {removeEstimates.amount0}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Estimated out ({removeState.token1.symbol})</span>
                <span className="font-mono text-white">
                  {removeEstimates.amount1}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-slate-400">
                You will receive at least 99% of the estimated amounts (1%
                slippage tolerance on withdrawal).
              </p>
            </div>

            <div className="mt-4 flex justify-end gap-3">
              <button
                className="rounded-full bg-slate-800 px-4 py-2 text-xs text-slate-200 hover:bg-slate-700"
                onClick={() => setIsRemoveOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-full bg-pink-500 px-4 py-2 text-xs font-semibold text-white hover:bg-pink-400 disabled:opacity-40"
                disabled={
                  !removeState.lpBalance ||
                  removeState.lpBalance.isZero() ||
                  isWithdrawing
                }
                onClick={handleWithdrawLiquidity}
              >
                {isWithdrawing ? "Withdrawing..." : "Withdraw liquidity"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiquiditySection;

