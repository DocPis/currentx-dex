// src/components/SwapSection.jsx
import { useState } from "react";
import { BrowserProvider, Contract, parseUnits, parseEther, formatUnits } from "ethers";

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

/* HELPERS */
import { buildPath } from "../utils/buildPath"; // se esiste; altrimenti lo re-includo

export default function SwapSection({
  address,
  chainId,
  balances,
  onConnect,
  onRefreshBalances,
}) {
  /** --------------------
   *  UI STATE
   -------------------- **/
  const [sellToken, setSellToken] = useState("ETH");
  const [buyToken, setBuyToken] = useState("USDC");
  const [amountIn, setAmountIn] = useState("");

  const isConnected = !!address;
  const isOnSepolia = chainId === SEPOLIA_CHAIN_ID_HEX;
  const tokenIn = TOKENS[sellToken];
  const tokenOut = TOKENS[buyToken];

  /** --------------------
   *  BALANCES + LABEL
   -------------------- **/
  const { getBalanceLabel } = useBalancesFormatter(balances);

  /** --------------------
   *  QUOTE / PRICE IMPACT
   -------------------- **/
  const {
    expectedOut,
    priceImpact,
    isFetchingQuote,
    quoteError,
    reloadQuote,
  } = useSwapQuote({
    sellToken,
    buyToken,
    amountIn,
  });

  /** --------------------
   *  ERC20 ALLOWANCE
   -------------------- **/
  const {
    hasAllowance,
    approving,
    approve,
  } = useTokenAllowance({
    address,
    token: tokenIn,
    amount: amountIn,
  });

  /** --------------------
   *  WRAP / UNWRAP FLAG
   -------------------- **/
  const isWrap = sellToken === "ETH" && buyToken === "WETH";
  const isUnwrap = sellToken === "WETH" && buyToken === "ETH";

  /** --------------------
   *  TOKENS FLIP
   -------------------- **/
  const flipTokens = () => {
    const s = sellToken;
    const b = buyToken;
    setSellToken(b);
    setBuyToken(s);
    setAmountIn("");
  };

  /** --------------------
   *  HANDLE SWAP
   -------------------- **/
  async function handleSwapClick() {
    if (!isConnected) return onConnect();
    if (!isOnSepolia) return alert("Switch to Sepolia in your wallet.");
    if (!amountIn || parseFloat(amountIn) <= 0) return alert("Enter an amount.");

    if (!hasAllowance && tokenIn.symbol !== "ETH") {
      return alert(`Approve ${tokenIn.symbol} first`);
    }

    // WRAP
    if (isWrap) {
      return doWrap(amountIn);
    }

    // UNWRAP
    if (isUnwrap) {
      return doUnwrap(amountIn);
    }

    if (!expectedOut) {
      return alert("No quote available. Check amount or liquidity.");
    }

    await doSwap();
  }

  /** --------------------
   *  WRAP ETH → WETH
   -------------------- **/
  async function doWrap(amountStr) {
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const weth = new Contract(WETH_ADDRESS, WETH_ABI, signer);

    const value = parseEther(amountStr);
    const tx = await weth.deposit({ value });
    await tx.wait();

    await onRefreshBalances();
  }

  /** --------------------
   *  UNWRAP WETH → ETH
   -------------------- **/
  async function doUnwrap(amountStr) {
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const weth = new Contract(WETH_ADDRESS, WETH_ABI, signer);

    const units = parseEther(amountStr);
    const tx = await weth.withdraw(units);
    await tx.wait();

    await onRefreshBalances();
  }

  /** --------------------
   *  NORMAL SWAP
   -------------------- **/
  async function doSwap() {
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const router = new Contract(UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_ABI, signer);

    const amountInUnits = parseUnits(amountIn, tokenIn.decimals || 18);
    const path = buildPath(sellToken, buyToken);

    const minAmountOut = expectedOut - expectedOut / BigInt(100); // 1% slippage default
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
    await onRefreshBalances();
  }

  /** --------------------
   *  RENDER
   -------------------- **/
  return (
    <div className="max-w-xl mx-auto space-y-4">

      {/* NOT CONNECTED */}
      {!isConnected && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
          Wallet not connected. Connect your wallet from the top right.
        </div>
      )}

      {/* NETWORK WARNING */}
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
            <span className="text-slate-200">{getBalanceLabel(sellToken)}</span>
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
              className="flex-1 text-right bg-transparent text-2xl font-semibold text-slate-50 outline-none"
            />
          </div>
        </div>

        {/* FLIP */}
        <div className="my-3 flex justify-center">
          <button
            onClick={flipTokens}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-300 shadow-lg shadow-black/40 hover:bg-slate-800"
          >
            ↓
          </button>
        </div>

        {/* BUY BLOCK */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
            <span>Buy</span>
            <span className="text-slate-200">{getBalanceLabel(buyToken)}</span>
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
                {expectedOut
                  ? formatUnits(expectedOut, tokenOut.decimals)
                  : "0.00"}
              </span>

              <span className="text-[11px] text-slate-500">
                {isFetchingQuote
                  ? "Fetching quote..."
                  : quoteError
                  ? quoteError
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

        {/* SWAP BUTTON */}
        <SwapActionButton
          canSwap={isConnected && isOnSepolia}
          disabled={
            !isConnected ||
            !isOnSepolia ||
            !amountIn ||
            (!hasAllowance && tokenIn.symbol !== "ETH")
          }
          onClick={handleSwapClick}
          label={
            !isConnected
              ? "Connect Wallet"
              : !isOnSepolia
              ? "Switch to Sepolia"
              : !hasAllowance && tokenIn.symbol !== "ETH"
              ? `Approve ${tokenIn.symbol} first`
              : "Swap"
          }
        />
      </div>

      {/* PRICE IMPACT + MIN RECEIVED */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/90 px-4 py-3 text-[11px] text-slate-400">
        <div className="flex justify-between">
          <span>Price impact</span>
          <span>{priceImpact ? `${priceImpact}%` : "—"}</span>
        </div>
      </div>
    </div>
  );
}
