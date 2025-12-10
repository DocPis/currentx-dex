// src/components/SwapSection.jsx

import { useState } from "react";
import {
  BrowserProvider,
  Contract,
  parseEther,
  parseUnits,
  formatUnits,
} from "ethers";

import {
  SEPOLIA_CHAIN_ID_HEX,
  UNISWAP_V2_ROUTER,
  UNISWAP_V2_ROUTER_ABI,
  ERC20_ABI,
} from "../config/uniswapSepolia";

import { TOKENS, AVAILABLE_TOKENS } from "../config/tokenRegistry";
import { buildPath } from "../utils/uniswapPaths";
import { wrapEthToWeth, unwrapWethToEth } from "../utils/wrapUnwrap";
import useSwapQuote from "../hooks/useSwapQuote";
import useBalancesFormatter from "../hooks/useBalancesFormatter";
import SwapTradeDetails from "./SwapTradeDetails";
import SwapTokenSelector from "./SwapTokenSelector";

/* ---------- COMPONENTE PRINCIPALE ---------- */

export default function SwapSection({
  address,
  chainId,
  balances,        // { ETH, WETH, USDC, DAI, WBTC, ... }
  tokenRegistry,   // non usato ora ma utile in futuro
  onConnect,
  onRefreshBalances,
}) {
  const [sellToken, setSellToken] = useState("ETH");
  const [buyToken, setBuyToken] = useState("USDC");
  const [amountIn, setAmountIn] = useState("");
  const [slippage, setSlippage] = useState("0.5");

  const [swapState, setSwapState] = useState({
    status: "idle",
    txHash: null,
    error: null,
  });

  const isConnected = !!address;
  const isOnSepolia = chainId === SEPOLIA_CHAIN_ID_HEX;
  const canSwap = isConnected && isOnSepolia;

  const tokenIn = TOKENS[sellToken];
  const tokenOut = TOKENS[buyToken];

  const isWrap = sellToken === "ETH" && buyToken === "WETH";
  const isUnwrap = sellToken === "WETH" && buyToken === "ETH";

  /* ---------- BALANCES (hook) ---------- */

  const { getBalanceFor, getBalanceLabel } = useBalancesFormatter(
    balances,
    TOKENS
  );

  /* ---------- QUOTE + PRICE IMPACT + MIN RECEIVED (hook) ---------- */

  const {
    expectedOut,
    isFetchingQuote,
    quoteError,
    priceImpact,
    minReceived,
  } = useSwapQuote({
    amountIn,
    sellToken,
    buyToken,
    tokenIn,
    tokenOut,
    isWrap,
    isUnwrap,
    slippage,
  });

  /* ---------- HANDLERS ---------- */

  const handleSlippagePreset = (value) => setSlippage(value);

  const handleSlippageInput = (value) => {
    if (value === "" || /^[0-9]*\.?[0-9]*$/.test(value)) {
      setSlippage(value);
    }
  };

  const handleQuickAmount = (fraction) => {
    const bal = getBalanceFor(sellToken);
    if (bal == null) return;

    const decimals = TOKENS[sellToken]?.decimals ?? 4;
    const precision = decimals > 6 ? 6 : decimals;

    const value = bal * fraction;
    setAmountIn(value.toFixed(precision));
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

    if (isWrap) {
      await wrapEthToWeth({
        amountInStr: amountIn,
        address,
        chainId,
        onRefreshBalances,
        setSwapState,
      });
      return;
    }
    if (isUnwrap) {
      await unwrapWethToEth({
        amountInStr: amountIn,
        address,
        chainId,
        getBalanceFor,
        onRefreshBalances,
        setSwapState,
      });
      return;
    }

    if (!expectedOut) {
      if (quoteError) {
        alert(
          "This pair has no available route on Sepolia (no liquidity/pool)."
        );
      } else {
        alert("Enter an amount and wait for the quote first.");
      }
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

  /* ---------- NORMAL SWAP (solo Uniswap) ---------- */

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

      const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

      const tokenInConf = TOKENS[sellToken];
      const tokenOutConf = TOKENS[buyToken];

      const isNativeIn = sellToken === "ETH";
      const isNativeOut = buyToken === "ETH";

      if (isNativeIn && isNativeOut) {
        throw new Error("Cannot swap ETH to ETH.");
      }

      setSwapState({ status: "pending", txHash: null, error: null });

      const path = buildPath(sellToken, buyToken);

      let tx;

      if (isNativeIn) {
        const value = parseEther(amountInStr);
        tx = await router.swapExactETHForTokens(
          minAmountOutStr || 0,
          path,
          address,
          deadline,
          { value }
        );
      } else {
        const amountInUnits = parseUnits(
          amountInStr,
          tokenInConf.decimals || 18
        );

        const tokenContract = new Contract(
          tokenInConf.address,
          ERC20_ABI,
          signer
        );
        const allowance = await tokenContract.allowance(
          address,
          UNISWAP_V2_ROUTER
        );
        if (allowance < amountInUnits) {
          const approveTx = await tokenContract.approve(
            UNISWAP_V2_ROUTER,
            amountInUnits
          );
          await approveTx.wait();
        }

        if (isNativeOut) {
          tx = await router.swapExactTokensForETH(
            amountInUnits,
            minAmountOutStr || 0,
            path,
            address,
            deadline
          );
        } else {
          tx = await router.swapExactTokensForTokens(
            amountInUnits,
            minAmountOutStr || 0,
            path,
            address,
            deadline
          );
        }
      }

      setSwapState((prev) => ({ ...prev, txHash: tx.hash }));
      await tx.wait();
      setSwapState((prev) => ({ ...prev, status: "done" }));

      if (onRefreshBalances) {
        await onRefreshBalances();
      }
    } catch (err) {
      console.error("Swap error:", err);
      let msg = "Swap failed.";
      if (err?.info?.error?.message) msg = err.info.error.message;
      else if (err?.message) msg = err.message;
      setSwapState({ status: "error", txHash: null, error: msg });
    } finally {
      setTimeout(() => {
        setSwapState((prev) =>
          prev.status === "pending" ? { ...prev, status: "idle" } : prev
        );
      }, 3000);
    }
  }

  /* ---------- UI ---------- */

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {/* warning connessione */}
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

      {/* SWAP CARD (AERODROME STYLE) */}
      <div className="rounded-3xl border border-slate-800 bg-slate-950/95 px-5 py-6 shadow-2xl shadow-black/70">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-50">Swap</h2>
            <p className="text-[11px] text-slate-500">
              {isWrap
                ? "Wrap native ETH into WETH 1:1 on Sepolia."
                : isUnwrap
                ? "Unwrap WETH into native ETH 1:1 on Sepolia."
                : "Swap between tokens on Sepolia using Uniswap V2."}
            </p>
          </div>
          <div className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-[11px] text-slate-300">
            Network: <span className="font-medium">Sepolia</span>
          </div>
        </div>

        {isWrap && (
          <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
            This operation wraps ETH into WETH at a 1:1 rate. No slippage or
            price impact.
          </div>
        )}

        {isUnwrap && (
          <div className="mb-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-100">
            This operation unwraps WETH back to ETH at a 1:1 rate.
          </div>
        )}

        {/* SELL */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
            <span>Sell</span>
            <span>
              Balance:{" "}
              <span className="text-slate-200">
                {getBalanceLabel(sellToken)}
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <SwapTokenSelector
              value={sellToken}
              availableTokens={AVAILABLE_TOKENS}
              tokensConfig={TOKENS}
              onChange={(sym) => {
                // logica: se selezioni il token che è sull'altro lato, swappiamo
                if (sym === buyToken) {
                  setBuyToken(sellToken);
                }
                setSellToken(sym);
                setAmountIn(""); // reset della quantità → il hook resetta quote/minReceived
              }}
            />
            <div className="flex items-center gap-3 flex-1 justify-end">
              <input
                type="number"
                min="0"
                step={sellToken === "ETH" ? "0.0001" : "0.01"}
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

        {/* FLIP */}
        <div className="my-3 flex justify-center">
          <button
            type="button"
            onClick={() => {
              const prevSell = sellToken;
              const prevBuy = buyToken;
              setSellToken(prevBuy);
              setBuyToken(prevSell);
              setAmountIn(""); // il hook resetta quote/minReceived
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-300 shadow-lg shadow-black/40 hover:bg-slate-800"
          >
            ↓
          </button>
        </div>

        {/* BUY */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
            <span>Buy</span>
            <span>
              Balance:{" "}
              <span className="text-slate-200">
                {getBalanceLabel(buyToken)}
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <SwapTokenSelector
              value={buyToken}
              availableTokens={AVAILABLE_TOKENS}
              tokensConfig={TOKENS}
              onChange={(sym) => {
                if (sym === sellToken) {
                  setSellToken(buyToken);
                }
                setBuyToken(sym);
                setAmountIn(""); // reset quantità
              }}
            />
            <div className="flex flex-col items-end">
              <span className="text-2xl font-semibold text-slate-50">
                {expectedOut
                  ? formatUnits(
                      expectedOut,
                      isWrap || isUnwrap ? 18 : tokenOut.decimals || 18
                    )
                  : "0.00"}
              </span>
              <span className="text-[11px] text-slate-500">
                {isFetchingQuote
                  ? "Fetching quote..."
                  : quoteError
                  ? quoteError
                  : expectedOut
                  ? isWrap || isUnwrap
                    ? `Amount of ${buyToken} you will receive (1:1)`
                    : `Estimated ${tokenOut.symbol} you will receive`
                  : "Enter an amount to see preview"}
              </span>
            </div>
          </div>
        </div>

        {/* BUTTON */}
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
            ? isWrap || isUnwrap
              ? "Confirm wrap/unwrap..."
              : "Confirm in wallet..."
            : isWrap
            ? "Wrap ETH to WETH"
            : isUnwrap
            ? "Unwrap WETH to ETH"
            : "Swap"}
        </button>
      </div>

      {/* TRADE DETAILS */}
      <SwapTradeDetails
        isWrap={isWrap}
        isUnwrap={isUnwrap}
        slippage={slippage}
        onSlippagePreset={handleSlippagePreset}
        onSlippageInput={handleSlippageInput}
        minReceived={minReceived}
        tokenOutSymbol={tokenOut.symbol}
        priceImpact={priceImpact}
      />

      {/* STATUS */}
      {swapState.txHash && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
          Tx broadcasted. Hash:{" "}
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
