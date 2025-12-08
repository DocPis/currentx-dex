// src/components/SwapSection.jsx

import { useEffect, useState } from "react";
import {
  BrowserProvider,
  Contract,
  parseUnits,
  parseEther,
  formatUnits,
} from "ethers";

import {
  SEPOLIA_CHAIN_ID_HEX,
  UNISWAP_V2_ROUTER,
  UNISWAP_V2_FACTORY,
  WETH_ADDRESS,
  USDC_ADDRESS,
  UNISWAP_V2_ROUTER_ABI,
  UNISWAP_V2_FACTORY_ABI,
  UNISWAP_V2_PAIR_ABI,
  ERC20_ABI,
  WETH_DECIMALS,
  USDC_DECIMALS,
} from "../config/uniswapSepolia";

export default function SwapSection({
  address,
  chainId,
  ethBalance,
  usdcBalance,
  tokenRegistry,
  onConnect,
  onRefreshBalances,
}) {
  const [amountIn, setAmountIn] = useState("");
  const [expectedOut, setExpectedOut] = useState(null);
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState(null);

  const [slippage, setSlippage] = useState("0.5");
  const [minReceived, setMinReceived] = useState(null);
  const [priceImpact, setPriceImpact] = useState(null);

  const [sellTokenSymbol, setSellTokenSymbol] = useState("ETH"); // "ETH" | "USDC"
  const [openSelector, setOpenSelector] = useState(null); // 'sell' | 'buy' | null

  const [swapState, setSwapState] = useState({
    status: "idle", // idle | pending | done | error
    txHash: null,
    error: null,
  });

  const isConnected = !!address;
  const isOnSepolia = chainId === SEPOLIA_CHAIN_ID_HEX;
  const canSwap = isConnected && isOnSepolia;

  // fallback token map se il registry non è ancora caricato
  const fallbackTokens = {
    ETH: {
      symbol: "ETH",
      address: WETH_ADDRESS,
      decimals: WETH_DECIMALS,
      isNative: true,
    },
    USDC: {
      symbol: "USDC",
      address: USDC_ADDRESS,
      decimals: USDC_DECIMALS,
      isNative: false,
    },
  };

  const TOKENS = tokenRegistry || fallbackTokens;

  const sellToken = TOKENS[sellTokenSymbol];
  const buyTokenSymbol = sellTokenSymbol === "ETH" ? "USDC" : "ETH";
  const buyToken = TOKENS[buyTokenSymbol];

  const tokenIn = sellToken;
  const tokenOut = buyToken;

  /* ---------- QUOTE + PRICE IMPACT ---------- */

  useEffect(() => {
    let cancelled = false;

    async function fetchQuote() {
      if (!amountIn || parseFloat(amountIn) <= 0) {
        setExpectedOut(null);
        setQuoteError(null);
        setPriceImpact(null);
        return;
      }

      if (typeof window === "undefined" || !window.ethereum) {
        setExpectedOut(null);
        setQuoteError("No provider available.");
        setPriceImpact(null);
        return;
      }

      try {
        setIsFetchingQuote(true);
        setQuoteError(null);

        const provider = new BrowserProvider(window.ethereum);
        const router = new Contract(
          UNISWAP_V2_ROUTER,
          UNISWAP_V2_ROUTER_ABI,
          provider
        );

        const amountInUnits = parseUnits(
          amountIn,
          tokenIn.decimals || 18
        );
        const path = [tokenIn.address, tokenOut.address];

        const amounts = await router.getAmountsOut(amountInUnits, path);

        if (cancelled) return;

        if (!amounts || amounts.length < 2) {
          setExpectedOut(null);
          setQuoteError("Unable to fetch quote.");
          setPriceImpact(null);
          return;
        }

        const out = amounts[1];
        setExpectedOut(out);

        // price impact via WETH/USDC pool reserves
        try {
          const factory = new Contract(
            UNISWAP_V2_FACTORY,
            UNISWAP_V2_FACTORY_ABI,
            provider
          );
          const pairAddress = await factory.getPair(
            WETH_ADDRESS,
            USDC_ADDRESS
          );

          if (
            !pairAddress ||
            pairAddress === "0x0000000000000000000000000000000000000000"
          ) {
            setPriceImpact(null);
            return;
          }

          const pair = new Contract(
            pairAddress,
            UNISWAP_V2_PAIR_ABI,
            provider
          );

          const token0 = (await pair.token0()).toLowerCase();
          const token1 = (await pair.token1()).toLowerCase();
          const [reserve0, reserve1] = await pair.getReserves();

          const tokenInLower = tokenIn.address.toLowerCase();
          const tokenOutLower = tokenOut.address.toLowerCase();

          let reserveInRaw;
          let reserveOutRaw;

          if (token0 === tokenInLower && token1 === tokenOutLower) {
            reserveInRaw = reserve0;
            reserveOutRaw = reserve1;
          } else if (token0 === tokenOutLower && token1 === tokenInLower) {
            reserveInRaw = reserve1;
            reserveOutRaw = reserve0;
          } else {
            setPriceImpact(null);
            return;
          }

          if (!reserveInRaw || !reserveOutRaw) {
            setPriceImpact(null);
            return;
          }

          const reserveInNum =
            Number(reserveInRaw) / Math.pow(10, tokenIn.decimals || 18);
          const reserveOutNum =
            Number(reserveOutRaw) / Math.pow(10, tokenOut.decimals || 18);

          if (reserveInNum <= 0 || reserveOutNum <= 0) {
            setPriceImpact(null);
            return;
          }

          const midPriceNum = reserveOutNum / reserveInNum;

          const execPriceNum =
            Number(out) / Math.pow(10, tokenOut.decimals || 18) /
            (Number(amountInUnits) / Math.pow(10, tokenIn.decimals || 18));

          if (midPriceNum <= 0 || execPriceNum <= 0) {
            setPriceImpact(null);
            return;
          }

          let impact = ((midPriceNum - execPriceNum) / midPriceNum) * 100;
          if (!Number.isFinite(impact)) {
            setPriceImpact(null);
            return;
          }
          if (impact < 0) impact = 0;

          setPriceImpact(impact.toFixed(2));
        } catch (e) {
          console.warn("Price impact calculation error:", e);
          setPriceImpact(null);
        }
      } catch (err) {
        console.error("Quote error:", err);
        if (!cancelled) {
          setExpectedOut(null);
          setQuoteError("Failed to fetch quote. Please try again.");
          setPriceImpact(null);
        }
      } finally {
        if (!cancelled) setIsFetchingQuote(false);
      }
    }

    fetchQuote();

    return () => {
      cancelled = true;
    };
  }, [
    amountIn,
    tokenIn.address,
    tokenOut.address,
    tokenIn.decimals,
    tokenOut.decimals,
  ]);

  /* ---------- MINIMUM RECEIVED ---------- */

  useEffect(() => {
    if (!expectedOut) {
      setMinReceived(null);
      return;
    }
    const s = parseFloat(slippage || "0");
    if (Number.isNaN(s) || s < 0 || s > 50) {
      setMinReceived(null);
      return;
    }

    const slippageBps = Math.round(s * 100);
    const bpsDenominator = 10000n;

    const minOut =
      (expectedOut * BigInt(10000 - slippageBps)) / bpsDenominator;

    setMinReceived(formatUnits(minOut, tokenOut.decimals || 18));
  }, [expectedOut, slippage, tokenOut.decimals]);

  /* ---------- HANDLERS ---------- */

  const handleSlippagePreset = (value) => setSlippage(value);

  const handleSlippageInput = (value) => {
    if (value === "" || /^[0-9]*\.?[0-9]*$/.test(value)) {
      setSlippage(value);
    }
  };

  const handleSwapClick = async () => {
    if (!isConnected || !isOnSepolia) {
      onConnect();
      return;
    }
    const value = parseFloat(amountIn || "0");
    if (!value || value <= 0) {
      alert("Enter a valid amount to swap.");
      return;
    }
    if (!expectedOut) {
      alert("Enter an amount and wait for the quote first.");
      return;
    }

    const s = parseFloat(slippage || "0");
    if (Number.isNaN(s) || s < 0 || s > 50) {
      alert("Please set a slippage between 0% and 50%.");
      return;
    }

    const slippageBps = Math.round(s * 100);
    const bpsDenominator = 10000n;

    const minAmountOut =
      (expectedOut * BigInt(10000 - slippageBps)) / bpsDenominator;

    await handleSwap(amountIn, minAmountOut.toString());
  };

  // quick % buttons (ETH o USDC)
  const handleQuickAmount = (fraction) => {
    let balance = null;
    let decimals = 4;

    if (tokenIn.symbol === "ETH") {
      balance = ethBalance;
      decimals = 4;
    } else if (tokenIn.symbol === "USDC") {
      balance = usdcBalance;
      decimals = 2;
    }

    if (balance != null) {
      const value = balance * fraction;
      setAmountIn(value.toFixed(decimals));
    }
  };

  // core swap logic
  async function handleSwap(amountInStr, minAmountOutStr) {
    if (!window.ethereum) {
      alert("No wallet detected");
      return;
    }
    if (!address || chainId !== SEPOLIA_CHAIN_ID_HEX) {
      alert("Connect wallet on Sepolia first.");
      return;
    }

    try {
      const amountNum = parseFloat(amountInStr);
      if (!amountNum || amountNum <= 0) {
        alert("Invalid amount.");
        return;
      }

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const router = new Contract(
        UNISWAP_V2_ROUTER,
        UNISWAP_V2_ROUTER_ABI,
        signer
      );

      const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // 10 min

      setSwapState({ status: "pending", txHash: null, error: null });

      let tx;

      // ETH -> USDC
      if (tokenIn.symbol === "ETH" && tokenOut.symbol === "USDC") {
        const value = parseEther(amountInStr);
        const path = [WETH_ADDRESS, USDC_ADDRESS];

        tx = await router.swapExactETHForTokens(
          minAmountOutStr || 0,
          path,
          address,
          deadline,
          { value }
        );
      }
      // USDC -> ETH
      else if (tokenIn.symbol === "USDC" && tokenOut.symbol === "ETH") {
        const usdcDecimals = TOKENS.USDC.decimals || 18;
        const amountInUnits = parseUnits(amountInStr, usdcDecimals);
        const path = [USDC_ADDRESS, WETH_ADDRESS];

        const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, signer);
        const allowance = await usdc.allowance(address, UNISWAP_V2_ROUTER);

        if (allowance < amountInUnits) {
          const approveTx = await usdc.approve(
            UNISWAP_V2_ROUTER,
            amountInUnits
          );
          await approveTx.wait();
        }

        tx = await router.swapExactTokensForETH(
          amountInUnits,
          minAmountOutStr || 0,
          path,
          address,
          deadline
        );
      } else {
        throw new Error("Unsupported pair (only ETH/USDC on Sepolia).");
      }

      setSwapState((prev) => ({
        ...prev,
        txHash: tx.hash,
      }));

      await tx.wait();

      setSwapState((prev) => ({
        ...prev,
        status: "done",
      }));

      if (onRefreshBalances) {
        await onRefreshBalances();
      }
    } catch (err) {
      console.error("Swap error:", err);
      let msg = "Swap failed.";
      if (err?.info?.error?.message) {
        msg = err.info.error.message;
      } else if (err?.message) {
        msg = err.message;
      }
      setSwapState({
        status: "error",
        txHash: null,
        error: msg,
      });
    } finally {
      setTimeout(() => {
        setSwapState((prev) =>
          prev.status === "pending" ? { ...prev, status: "idle" } : prev
        );
      }, 3000);
    }
  }

  /* ---------- PRICE IMPACT BADGE ---------- */

  const parsedImpact =
    priceImpact != null ? parseFloat(priceImpact) : null;

  let impactValueClass = "text-slate-100";
  let impactBadgeLabel = null;
  let impactBadgeClass = "";
  let impactTooltip = "";

  if (parsedImpact != null && !Number.isNaN(parsedImpact)) {
    if (parsedImpact < 1) {
      impactValueClass = "text-emerald-300";
      impactBadgeLabel = "Low";
      impactBadgeClass =
        "rounded-full border border-emerald-500/60 bg-emerald-500/10 px-2 py-[1px] text-[10px] text-emerald-200";
      impactTooltip =
        "Low price impact. This trade has minimal effect on the pool price.";
    } else if (parsedImpact < 5) {
      impactValueClass = "text-amber-300";
      impactBadgeLabel = "Medium";
      impactBadgeClass =
        "rounded-full border border-amber-500/60 bg-amber-500/10 px-2 py-[1px] text-[10px] text-amber-200";
      impactTooltip =
        "Medium price impact. This trade will move the pool price noticeably.";
    } else {
      impactValueClass = "text-rose-300";
      impactBadgeLabel = "High";
      impactBadgeClass =
        "rounded-full border border-rose-500/60 bg-rose-500/10 px-2 py-[1px] text-[10px] text-rose-200";
      impactTooltip =
        "High price impact. You may receive significantly less than the mid price.";
    }
  }

  /* ---------- BALANCES LABEL ---------- */

  const getBalanceLabel = (token) => {
    if (token.symbol === "ETH") {
      return ethBalance != null ? `${ethBalance.toFixed(4)} ETH` : "—";
    }
    if (token.symbol === "USDC") {
      return usdcBalance != null ? `${usdcBalance.toFixed(2)} USDC` : "—";
    }
    return "—";
  };

  /* ---------- TOKEN SELECTOR UI ---------- */

  const renderTokenSelector = (side) => {
    const isSell = side === "sell";
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() =>
            setOpenSelector(openSelector === side ? null : side)
          }
          className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1.5 text-[12px] text-slate-100 border border-slate-700"
        >
          <div className="h-5 w-5 rounded-full bg-slate-700" />
          <span>{isSell ? tokenIn.symbol : tokenOut.symbol}</span>
          <span className="text-[10px] text-slate-400">▼</span>
        </button>

        {openSelector === side && (
          <div className="absolute left-0 mt-2 w-32 rounded-xl border border-slate-700 bg-slate-900 shadow-lg z-20">
            {Object.values(TOKENS).map((t) => {
              const selectedSymbol = isSell ? tokenIn.symbol : tokenOut.symbol;
              const isSelected = t.symbol === selectedSymbol;

              return (
                <button
                  key={t.symbol}
                  type="button"
                  disabled={isSelected}
                  onClick={() => {
                    if (isSell) {
                      setSellTokenSymbol(t.symbol);
                    } else {
                      const other = t.symbol === "ETH" ? "USDC" : "ETH";
                      setSellTokenSymbol(other);
                    }
                    setOpenSelector(null);
                    setAmountIn("");
                    setExpectedOut(null);
                    setPriceImpact(null);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-[12px] ${
                    isSelected
                      ? "bg-slate-800 text-slate-100"
                      : "text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  <div className="h-5 w-5 rounded-full bg-slate-700" />
                  <span>{t.symbol}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  /* ---------- UI STILE AERODROME ---------- */

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {/* warnings */}
      {!isConnected && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
          Wallet not connected. Connect your wallet from the top right to start
          swapping on Sepolia.
        </div>
      )}
      {isConnected && !isOnSepolia && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
          You are connected on a different network. Switch to{" "}
          <span className="font-semibold">Sepolia</span> from your wallet or
          click &quot;Switch to Sepolia&quot; in the top bar.
        </div>
      )}

      {/* main swap card */}
      <div className="rounded-3xl border border-slate-800 bg-slate-950/95 px-5 py-6 shadow-2xl shadow-black/70">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-50">Swap</h2>
            <p className="text-[11px] text-slate-500">
              Swap between ETH and USDC on Sepolia.
            </p>
          </div>
          <div className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-[11px] text-slate-300">
            Network: <span className="font-medium">Sepolia</span>
          </div>
        </div>

        {/* SELL box */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
            <span>Sell</span>
            <span>
              Balance:{" "}
              <span className="text-slate-200">
                {getBalanceLabel(tokenIn)}
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            {renderTokenSelector("sell")}
            <div className="flex items-center gap-3 flex-1 justify-end">
              <input
                type="number"
                min="0"
                step={tokenIn.symbol === "ETH" ? "0.0001" : "0.01"}
                value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
                placeholder="0.00"
                className="flex-1 text-right bg-transparent text-2xl font-semibold text-slate-50 outline-none placeholder:text-slate-700"
              />
              <div className="flex flex-col items-end text-[11px] text-slate-400">
                <button
                  type="button"
                  className="mb-1 rounded-full border border-slate-700 px-2 py-[1px] text-[10px] hover:border-slate-500"
                  onClick={() => handleQuickAmount(0.25)}
                >
                  25%
                </button>
                <button
                  type="button"
                  className="mb-1 rounded-full border border-slate-700 px-2 py-[1px] text-[10px] hover:border-slate-500"
                  onClick={() => handleQuickAmount(0.5)}
                >
                  50%
                </button>
                <button
                  type="button"
                  className="rounded-full border border-slate-700 px-2 py-[1px] text-[10px] hover:border-slate-500"
                  onClick={() => handleQuickAmount(0.95)}
                >
                  Max
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* arrow to flip tokens */}
        <div className="my-3 flex justify-center">
          <button
            type="button"
            onClick={() => {
              const other = sellTokenSymbol === "ETH" ? "USDC" : "ETH";
              setSellTokenSymbol(other);
              setAmountIn("");
              setExpectedOut(null);
              setPriceImpact(null);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-300 shadow-lg shadow-black/40 hover:bg-slate-850"
          >
            ↓
          </button>
        </div>

        {/* BUY box */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
            <span>Buy</span>
            <span>
              Balance:{" "}
              <span className="text-slate-200">
                {getBalanceLabel(tokenOut)}
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            {renderTokenSelector("buy")}
            <div className="flex flex-col items-end">
              <span className="text-2xl font-semibold text-slate-50">
                {expectedOut
                  ? formatUnits(expectedOut, tokenOut.decimals || 18)
                  : "0.00"}
              </span>
              <span className="text-[11px] text-slate-500">
                {isFetchingQuote
                  ? "Fetching quote..."
                  : quoteError
                  ? quoteError
                  : expectedOut
                  ? `Estimated ${tokenOut.symbol} you will receive`
                  : "Enter an amount to see preview"}
              </span>
            </div>
          </div>
        </div>

        {/* big swap button */}
        <button
          onClick={handleSwapClick}
          disabled={swapState.status === "pending"}
          className={`mt-5 inline-flex w-full items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold shadow-lg shadow-indigo-600/40 ${
            canSwap
              ? "bg-gradient-to-r from-indigo-500 to-blue-600 text-slate-50"
              : "bg-slate-800 text-slate-400"
          } disabled:opacity-70`}
        >
          {!isConnected
            ? "Connect wallet to start"
            : !isOnSepolia
            ? "Switch to Sepolia"
            : swapState.status === "pending"
            ? "Confirm in wallet..."
            : "Swap"}
        </button>
      </div>

      {/* trade details */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-3 text-[11px] text-slate-400">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-slate-200">Trade details</span>
        </div>

        <div className="mb-2">
          <div className="mb-1 flex items-center justify-between">
            <span>Slippage tolerance</span>
          </div>
          <div className="flex gap-2">
            {["0.1", "0.5", "1"].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => handleSlippagePreset(v)}
                className={`flex-1 rounded-full border px-2 py-1 text-[11px] ${
                  slippage === v
                    ? "border-emerald-400 bg-emerald-500/15 text-emerald-200"
                    : "border-slate-700 bg-slate-900 text-slate-200"
                }`}
              >
                {v}%
              </button>
            ))}
            <div className="flex flex-1 items-center rounded-full border border-slate-700 bg-slate-900 px-2 py-1">
              <input
                type="text"
                value={slippage}
                onChange={(e) => handleSlippageInput(e.target.value)}
                className="w-full bg-transparent text-right text-[11px] text-slate-100 outline-none"
                placeholder="Custom %"
              />
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between">
            <span>Minimum received</span>
            <span className="text-slate-100">
              {minReceived ? `${minReceived} ${tokenOut.symbol}` : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Price impact</span>
            <span className="flex items-center gap-2">
              <span className={impactValueClass}>
                {priceImpact ? `${priceImpact}%` : "—"}
              </span>
              {impactBadgeLabel && (
                <span className={impactBadgeClass} title={impactTooltip}>
                  {impactBadgeLabel}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* tx status */}
      {swapState.txHash && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
          Swap broadcasted. Tx hash:{" "}
          <a
            href={`https://sepolia.etherscan.io/tx/${swapState.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {swapState.txHash.slice(0, 10)}...
            {swapState.txHash.slice(-8)}
          </a>
        </div>
      )}

      {swapState.error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100">
          {swapState.error}
        </div>
      )}
    </div>
  );
}
