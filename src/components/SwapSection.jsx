// src/components/SwapSection.jsx
import React, { useEffect, useState } from "react";
import { parseUnits, formatUnits, Contract } from "ethers";
import {
  TOKENS,
  getProvider,
  getV2QuoteWithMeta,
  WETH_ADDRESS,
  ERC20_ABI,
  WETH_ABI,
  UNIV2_PAIR_ABI,
} from "../config/web3";

const TOKEN_OPTIONS = ["ETH", "WETH", "USDC", "DAI", "WBTC"];

function TokenSelector({ side, selected, onSelect, balances }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative w-full sm:w-auto">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-2 rounded-xl bg-slate-800 text-xs text-slate-100 border border-slate-700 flex items-center gap-2 shadow-inner shadow-black/30 min-w-0 w-full sm:w-auto sm:min-w-[120px] hover:border-sky-500/60 transition"
      >
        <img
          src={TOKENS[selected].logo}
          alt={`${selected} logo`}
          className="h-5 w-5 rounded-full object-contain"
        />
        <span className="text-sm font-semibold">{selected}</span>
        <svg
          className="ml-auto h-3.5 w-3.5 text-slate-400"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M6 8l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-52 bg-slate-900 border border-slate-800 rounded-xl shadow-xl shadow-black/50 overflow-hidden">
          {TOKEN_OPTIONS.map((symbol) => (
            <button
              key={`${side}-${symbol}`}
              onClick={() => {
                onSelect(symbol);
                setOpen(false);
              }}
              className={`w-full px-3 py-2 flex items-center gap-2 text-sm transition ${
                symbol === selected
                  ? "bg-slate-800 text-white"
                  : "text-slate-200 hover:bg-slate-800/80"
              }`}
            >
              <img
                src={TOKENS[symbol].logo}
                alt={`${symbol} logo`}
                className="h-5 w-5 rounded-full object-contain"
              />
              <div className="flex flex-col items-start">
                <span className="font-medium">{symbol}</span>
              </div>
              <span className="ml-auto text-[11px] text-slate-400">
                {(balances[symbol] || 0).toFixed(3)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SwapSection({ balances }) {
  const [sellToken, setSellToken] = useState("ETH");
  const [buyToken, setBuyToken] = useState("USDC");
  const [amountIn, setAmountIn] = useState("");
  const [quoteOut, setQuoteOut] = useState(null);
  const [quoteOutRaw, setQuoteOutRaw] = useState(null);
  const [priceImpact, setPriceImpact] = useState(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [slippage, setSlippage] = useState("0.5");
  const [swapStatus, setSwapStatus] = useState(null);
  const [swapLoading, setSwapLoading] = useState(false);

  const selectSell = (symbol) => {
    if (symbol === buyToken) setBuyToken(sellToken);
    setSellToken(symbol);
  };

  const selectBuy = (symbol) => {
    if (symbol === sellToken) setSellToken(buyToken);
    setBuyToken(symbol);
  };

  const handleFlip = () => {
    setSellToken(buyToken);
    setBuyToken(sellToken);
  };

  const isEthUsdcPath =
    (["ETH", "WETH"].includes(sellToken) && buyToken === "USDC") ||
    (sellToken === "USDC" && ["ETH", "WETH"].includes(buyToken));

  const sellKey = sellToken === "ETH" ? "WETH" : sellToken;
  const buyKey = buyToken === "ETH" ? "WETH" : buyToken;

  useEffect(() => {
    let cancelled = false;

    const fetchQuote = async () => {
      setQuoteError("");
      setQuoteOut(null);
      setQuoteOutRaw(null);
      setPriceImpact(null);

      if (!amountIn || Number.isNaN(Number(amountIn))) return;
      if (!isEthUsdcPath) {
        setQuoteError("Quote available only for ETH/USDC (Uniswap V2 Sepolia)");
        return;
      }

      try {
        setQuoteLoading(true);
        const provider = await getProvider();

        const sellAddress = TOKENS[sellKey].address;
        const buyAddress = TOKENS[buyKey].address;

        const amountWei = parseUnits(
          amountIn,
          TOKENS[sellKey].decimals
        );

        const meta = await getV2QuoteWithMeta(
          provider,
          amountWei,
          sellAddress,
          buyAddress
        );

        if (cancelled) return;

        const formatted = formatUnits(meta.amountOut, TOKENS[buyKey].decimals);
        setQuoteOut(formatted);
        setQuoteOutRaw(meta.amountOut);
        setPriceImpact(meta.priceImpactPct);
      } catch (e) {
        if (cancelled) return;
        setQuoteError(e.message || "Failed to fetch quote");
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    };

    fetchQuote();

    return () => {
      cancelled = true;
    };
  }, [amountIn, sellToken, buyToken, isEthUsdcPath]);

  const slippageBps = (() => {
    const val = Number(slippage);
    if (Number.isNaN(val) || val < 0) return 50; // default 0.5%
    return Math.min(5000, Math.round(val * 100)); // cap 50%
  })();

  const minReceivedRaw = quoteOutRaw
    ? (quoteOutRaw * BigInt(10000 - slippageBps)) / 10000n
    : null;

  const handleSwap = async () => {
    try {
      setSwapStatus(null);
      if (swapLoading) return;
      if (!amountIn || Number.isNaN(Number(amountIn))) {
        throw new Error("Enter a valid amount");
      }
      if (!isEthUsdcPath) {
        throw new Error("Swap supported only for ETH/USDC on Sepolia (demo)");
      }
      if (!quoteOutRaw) {
        throw new Error("Fetching quote, please retry");
      }

      setSwapLoading(true);
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const user = await signer.getAddress();

      const sellAddress =
        sellKey === "WETH" ? WETH_ADDRESS : TOKENS[sellKey].address;
      const buyAddress = TOKENS[buyKey].address;

      const amountWei = parseUnits(amountIn, TOKENS[sellKey].decimals);
      const { amountOut, tokenInIs0, pairAddress } = await getV2QuoteWithMeta(
        provider,
        amountWei,
        sellAddress,
        buyAddress
      );

      const minOut = (amountOut * BigInt(10000 - slippageBps)) / 10000n;

      // Step 1: transfer tokenIn to pair (wrap ETH -> WETH if needed)
      if (sellKey === "WETH" && sellToken === "ETH") {
        const weth = new Contract(WETH_ADDRESS, WETH_ABI, signer);
        await (await weth.deposit({ value: amountWei })).wait();
        await (await weth.transfer(pairAddress, amountWei)).wait();
      } else {
        const token = new Contract(sellAddress, ERC20_ABI, signer);
        await (await token.transfer(pairAddress, amountWei)).wait();
      }

      // Step 2: perform swap on pair (explicit function lookup to avoid undefined)
      const amount0Out = tokenInIs0 ? 0n : minOut;
      const amount1Out = tokenInIs0 ? minOut : 0n;
      const pair = new Contract(pairAddress, UNIV2_PAIR_ABI, signer);
      const swapFn = pair.getFunction("swap");
      const tx = await swapFn(amount0Out, amount1Out, user, "0x");
      const receipt = await tx.wait();

      setSwapStatus({
        message: `Swap executed. Min received: ${formatUnits(
          minOut,
          TOKENS[buyKey].decimals
        )} ${buyToken}`,
        hash: receipt.hash,
      });
    } catch (e) {
      setSwapStatus({ message: e.message || "Swap fallito" });
    } finally {
      setSwapLoading(false);
    }
  };

  return (
    <div className="w-full flex flex-col items-center mt-10 px-4 sm:px-0">
      <div className="w-full max-w-xl rounded-3xl bg-slate-900/80 border border-slate-800 p-4 sm:p-6 shadow-xl">
        {/* SELL */}
        <div className="mb-4 rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="flex items-center justify-between mb-2 text-xs text-slate-400">
            <span>Sell</span>
            <span className="font-medium text-slate-300">
              Balance: {(balances[sellToken] || 0).toFixed(4)}{" "}
              {sellToken}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <TokenSelector
              side="sell"
              selected={sellToken}
              onSelect={selectSell}
              balances={balances}
            />

            <input
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              placeholder="0.00"
              className="flex-1 text-right bg-transparent text-2xl font-semibold text-slate-50 outline-none placeholder:text-slate-700 w-full"
            />
          </div>
        </div>

        {/* FLIP BUTTON */}
        <div className="flex justify-center my-2">
          <button
            onClick={handleFlip}
            className="h-10 w-10 rounded-full border border-slate-700 bg-slate-900 flex items-center justify-center text-slate-200 text-lg shadow-md shadow-black/30 hover:border-sky-500/60 transition"
            aria-label="Invert tokens"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
            >
              <path
                d="M12 4l3 3h-2v7h-2V7H9l3-3ZM12 20l-3-3h2v-7h2v7h2l-3 3Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>

        {/* BUY */}
        <div className="mb-4 rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="flex items-center justify-between mb-2 text-xs text-slate-400">
            <span>Buy</span>
            <span className="font-medium text-slate-300">
              Balance: {(balances[buyToken] || 0).toFixed(2)} {buyToken}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <TokenSelector
              side="buy"
              selected={buyToken}
              onSelect={selectBuy}
              balances={balances}
            />

            <div className="flex-1 text-right w-full">
              <div className="text-2xl sm:text-3xl font-semibold text-slate-50">
                {quoteOut !== null
                  ? Number(quoteOut).toFixed(6)
                  : "0.00"}
              </div>
              <div className="text-[11px] text-slate-500">
                {quoteLoading
                  ? "Loading quote..."
                  : quoteError ||
                    (amountIn
                      ? "Live quote via Uniswap V2 (Sepolia)"
                      : "Enter an amount to fetch a quote")}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <div className="flex-1 rounded-2xl bg-slate-900 border border-slate-800 p-3 text-xs text-slate-300">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400">Slippage (%)</span>
              <div className="flex items-center gap-2">
                {[0.1, 0.5, 1].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setSlippage(String(p))}
                    className={`px-2 py-1 rounded-lg text-[11px] border ${
                      Number(slippage) === p
                        ? "bg-sky-500/20 border-sky-500/50 text-sky-100"
                        : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {p}%
                  </button>
                ))}
                <input
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  className="w-20 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-right text-slate-100 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-500">Min received</span>
              <span className="text-slate-100">
                {minReceivedRaw
                  ? `${Number(
                      formatUnits(minReceivedRaw, TOKENS[buyKey].decimals)
                    ).toFixed(6)} ${buyToken}`
                  : "--"}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] mt-1">
              <span className="text-slate-500">Price impact</span>
              <span className="text-slate-100">
                {priceImpact !== null
                  ? `${priceImpact.toFixed(2)}%`
                  : "--"}
              </span>
            </div>
          </div>

          <button
            onClick={handleSwap}
            disabled={swapLoading || quoteLoading}
            className="w-full sm:w-44 py-3 rounded-2xl bg-gradient-to-r from-sky-500 via-indigo-500 to-purple-600 text-sm font-semibold text-white shadow-[0_10px_40px_-15px_rgba(56,189,248,0.75)] hover:scale-[1.01] active:scale-[0.99] transition disabled:opacity-60 disabled:scale-100"
          >
            <span className="inline-flex items-center gap-2 justify-center">
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
              {swapLoading ? "Swapping..." : "Swap now"}
            </span>
          </button>
        </div>

        {swapStatus && (
          <div className="mt-2 text-xs text-slate-200 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2">
            <div>{swapStatus.message}</div>
            {swapStatus.hash && (
              <a
                href={`https://sepolia.etherscan.io/tx/${swapStatus.hash}`}
                target="_blank"
                rel="noreferrer"
                className="text-sky-400 hover:text-sky-300 underline mt-1 inline-block"
              >
                Apri tx su SepoliaScan
              </a>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 w-full max-w-xl rounded-2xl bg-slate-900/60 border border-slate-800 px-4 py-3 text-xs text-slate-300">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-slate-400">Price impact</span>
          <span>
            {priceImpact !== null ? `${priceImpact.toFixed(2)}%` : "--"}
          </span>
        </div>
      </div>
    </div>
  );
}
