// src/components/SwapSection.jsx

import { useState } from "react";
import {
  BrowserProvider,
  Contract,
  parseUnits,
  parseEther,
  formatUnits,
} from "ethers";

import { TOKENS } from "../config/tokenRegistry";
import {
  SEPOLIA_CHAIN_ID_HEX,
  UNISWAP_V2_ROUTER,
  UNISWAP_V2_ROUTER_ABI,
  ERC20_ABI,
  WETH_ABI,
  WETH_ADDRESS,
} from "../config/uniswapSepolia";

/* HOOKS */
import { useSwapQuote } from "../hooks/useSwapQuote";
import { useBalancesFormatter } from "../hooks/useBalancesFormatter";
import { useTokenAllowance } from "../hooks/useTokenAllowance";

/* COMPONENTS */
import SwapTokenSelector from "./swap/SwapTokenSelector";
import ApproveButton from "./swap/ApproveButton";
import SwapActionButton from "./swap/SwapActionButton";
import SwapConfirmModal from "./swap/SwapConfirmModal";


/* HELPERS */
import { buildPath } from "../utils/buildPath";

export default function SwapSection({
  address,
  chainId,
  balances,
  onConnect,
  onRefreshBalances,
}) {
  /* ---------- STATE ---------- */
  const [sellToken, setSellToken] = useState("ETH");
  const [buyToken, setBuyToken] = useState("USDC");
  const [amountIn, setAmountIn] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // stato per animazione flip del blocco BUY
  const [isFlipping, setIsFlipping] = useState(false);

  const isConnected = !!address;
  const isOnSepolia = chainId === SEPOLIA_CHAIN_ID_HEX;

  const tokenIn = TOKENS[sellToken];
  const tokenOut = TOKENS[buyToken];

  const isWrap = sellToken === "ETH" && buyToken === "WETH";
  const isUnwrap = sellToken === "WETH" && buyToken === "ETH";

  /* ---------- HOOKS ---------- */
  const { getBalanceLabel } = useBalancesFormatter(balances);

  const {
    expectedOut,
    priceImpact,
    isFetchingQuote,
    quoteError,
    reloadQuote,
  } = useSwapQuote({ sellToken, buyToken, amountIn });

  const { hasAllowance, approving, approve } = useTokenAllowance({
    address,
    token: tokenIn,
    amount: amountIn,
  });

  const canSwap = isConnected && isOnSepolia;

  /* ---------- HANDLERS ---------- */

  // Flip con animazione del blocco BUY
  const flipTokens = () => {
    setIsFlipping(true);

    setTimeout(() => {
      const prevSell = sellToken;
      const prevBuy = buyToken;

      setSellToken(prevBuy);
      setBuyToken(prevSell);

      setAmountIn("");
      reloadQuote();

      setTimeout(() => {
        reloadQuote();
        setIsFlipping(false);
      }, 120);
    }, 150);
  };

  async function handleSwapClick() {
    if (!isConnected) {
      onConnect && onConnect();
      return;
    }

    if (!isOnSepolia) {
      alert("Switch to Sepolia in your wallet.");
      return;
    }

    const value = parseFloat(amountIn || "0");
    if (!value || value <= 0) {
      alert("Enter a valid amount.");
      return;
    }

    if (!expectedOut && !isWrap && !isUnwrap) {
      alert("No quote available yet. Wait for the estimation.");
      return;
    }

    if (!hasAllowance && tokenIn.symbol !== "ETH") {
      alert(`Approve ${tokenIn.symbol} first.`);
      return;
    }

    setConfirmOpen(true);
  }

  async function handleConfirmSwap() {
    if (!isConnected || !isOnSepolia) return;

    setConfirming(true);
    try {
      if (isWrap) {
        await doWrap(amountIn);
      } else if (isUnwrap) {
        await doUnwrap(amountIn);
      } else {
        await doSwap();
      }

      setConfirmOpen(false);
    } catch (e) {
      console.error("Swap error:", e);
      alert(e.message || "Swap failed.");
    } finally {
      setConfirming(false);
    }
  }

  /* ---------- WRAP / UNWRAP ---------- */

  async function doWrap(amountStr) {
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const weth = new Contract(WETH_ADDRESS, WETH_ABI, signer);

    const value = parseEther(amountStr);
    const tx = await weth.deposit({ value });
    await tx.wait();

    onRefreshBalances && onRefreshBalances();
  }

  async function doUnwrap(amountStr) {
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const weth = new Contract(WETH_ADDRESS, WETH_ABI, signer);

    const units = parseEther(amountStr);
    const tx = await weth.withdraw(units);
    await tx.wait();

    onRefreshBalances && onRefreshBalances();
  }

  /* ---------- NORMAL SWAP VIA UNISWAP V2 ---------- */

  async function doSwap() {
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const router = new Contract(
      UNISWAP_V2_ROUTER,
      UNISWAP_V2_ROUTER_ABI,
      signer
    );

    const amountInUnits = parseUnits(amountIn, tokenIn.decimals || 18);
    const path = buildPath(sellToken, buyToken);

    if (!expectedOut) throw new Error("Missing quote.");

    // 1% slippage default
    const minAmountOut = expectedOut - expectedOut / BigInt(100);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

    let tx;

    if (tokenIn.symbol === "ETH") {
      tx = await router.swapExactETHForTokens(
        minAmountOut,
        path,
        address,
        deadline,
        { value: amountInUnits }
      );
    } else if (tokenOut.symbol === "ETH") {
      tx = await router.swapExactTokensForETH(
        amountInUnits,
        minAmountOut,
        path,
        address,
        deadline
      );
    } else {
      tx = await router.swapExactTokensForTokens(
        amountInUnits,
        minAmountOut,
        path,
        address,
        deadline
      );
    }

    await tx.wait();
    onRefreshBalances && onRefreshBalances();
  }

  /* ---------- RENDER ---------- */

  const formattedOut = expectedOut
    ? formatUnits(expectedOut, tokenOut.decimals || 18)
    : "0.00";

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {/* WARNINGS */}
      {!isConnected && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
          Wallet not connected. Connect your wallet from the top right.
        </div>
      )}

      {isConnected && !isOnSepolia && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
          Wrong network. Switch to <b>Sepolia</b>.
        </div>
      )}

      {/* SWAP CARD */}
      <div className="rounded-3xl border border-slate-800 bg-slate-950/95 px-5 py-6 shadow-2xl shadow-black/70">
        {/* SELL BLOCK */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
            <span>Sell</span>
            <span className="text-slate-200">
              {getBalanceLabel(sellToken)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <SwapTokenSelector
              current={sellToken}
              onSelect={(t) => {
                setSellToken(t);
                setAmountIn("");
                reloadQuote();
              }}
            />
            <input
              type="number"
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              placeholder="0.00"
              className="flex-1 text-right bg-transparent text-2xl font-semibold text-slate-50 outline-none placeholder:text-slate-700"
            />
          </div>
        </div>

        {/* FLIP BUTTON */}
        <div className="my-3 flex justify-center">
          <button
            type="button"
            onClick={flipTokens}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-300 shadow-lg shadow-black/40 hover:bg-slate-800"
          >
            ↓
          </button>
        </div>

        {/* BUY BLOCK con ANIMAZIONE ROTAZIONE */}
        <div
          className={`
            rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3
            transition-transform duration-300 ease-out
            ${isFlipping ? "rotate-y-180 blur-[3px]" : "rotate-y-0"}
          `}
          style={{
            transformStyle: "preserve-3d",
            backfaceVisibility: "hidden",
          }}
        >
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
            <span>Buy</span>
            <span className="text-slate-200">
              {getBalanceLabel(buyToken)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <SwapTokenSelector
              current={buyToken}
              onSelect={(t) => {
                setBuyToken(t);
                setAmountIn("");
                reloadQuote();
              }}
            />
            <div className="flex flex-col text-right">
              <span className="text-2xl font-semibold text-slate-50">
                {formattedOut}
              </span>
              <span className="text-[11px] text-slate-500">
                {isFetchingQuote
                  ? "Fetching quote..."
                  : quoteError
                  ? "No quote available."
                  : "Estimation"}
              </span>
            </div>
          </div>
        </div>

        {/* APPROVE BUTTON */}
        {tokenIn.symbol !== "ETH" && !hasAllowance && (
          <ApproveButton
            tokenSymbol={tokenIn.symbol}
            loading={approving}
            onApprove={approve}
          />
        )}

        {/* MAIN SWAP BUTTON (apre il modal) */}
        <SwapActionButton
          canSwap={canSwap}
          disabled={
            !canSwap ||
            !amountIn ||
            (!hasAllowance && tokenIn.symbol !== "ETH")
          }
          onClick={handleSwapClick}
          label={
            !isConnected
              ? "Connect wallet"
              : !isOnSepolia
              ? "Switch to Sepolia"
              : !hasAllowance && tokenIn.symbol !== "ETH"
              ? `Approve ${tokenIn.symbol} first`
              : "Swap"
          }
        />
      </div>

      {/* TRADE DETAILS */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/90 px-4 py-3 text-[11px] text-slate-400">
        <div className="flex justify-between">
          <span>Price impact</span>
          <span className="text-slate-100">
            {priceImpact != null ? `${priceImpact}%` : "—"}
          </span>
        </div>
      </div>

      {/* CONFIRM MODAL */}
      <SwapConfirmModal
        isOpen={confirmOpen}
        onClose={() => !confirming && setConfirmOpen(false)}
        onConfirm={handleConfirmSwap}
        confirming={confirming}
        sellToken={sellToken}
        buyToken={buyToken}
        amountIn={amountIn}
        expectedOut={expectedOut}
        tokenOutDecimals={tokenOut.decimals}
        priceImpact={priceImpact}
      />
    </div>
  );
}
