// src/components/SwapSection.jsx
import React, { useEffect, useState } from "react";
import { parseUnits, formatUnits } from "ethers";
import { TOKENS, getProvider, getV2Quote } from "../config/web3";

const TOKEN_OPTIONS = ["ETH", "WETH", "USDC", "DAI", "WBTC"];

function TokenSelector({ side, selected, onSelect, balances }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-2 rounded-xl bg-slate-800 text-xs text-slate-100 border border-slate-700 flex items-center gap-2 shadow-inner shadow-black/30 min-w-[120px] hover:border-sky-500/60 transition"
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
  const [quoteError, setQuoteError] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);

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

  useEffect(() => {
    let cancelled = false;

    const fetchQuote = async () => {
      setQuoteError("");
      setQuoteOut(null);

      if (!amountIn || Number.isNaN(Number(amountIn))) return;
      if (!isEthUsdcPath) {
        setQuoteError("Quote disponibile solo per ETH/USDC (Uniswap V2 Sepolia)");
        return;
      }

      try {
        setQuoteLoading(true);
        const provider = await getProvider();

        const sellKey = sellToken === "ETH" ? "WETH" : sellToken;
        const buyKey = buyToken === "ETH" ? "WETH" : buyToken;
        const sellAddress = TOKENS[sellKey].address;
        const buyAddress = TOKENS[buyKey].address;

        const amountWei = parseUnits(
          amountIn,
          TOKENS[sellKey].decimals
        );

        const out = await getV2Quote(provider, amountWei, [
          sellAddress,
          buyAddress,
        ]);

        if (cancelled) return;

        const formatted = formatUnits(out, TOKENS[buyKey].decimals);
        setQuoteOut(formatted);
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

  return (
    <div className="w-full flex flex-col items-center mt-10">
      <div className="w-full max-w-xl rounded-3xl bg-slate-900/80 border border-slate-800 p-6 shadow-xl">
        {/* SELL */}
        <div className="mb-4 rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="flex items-center justify-between mb-2 text-xs text-slate-400">
            <span>Sell</span>
            <span className="font-medium text-slate-300">
              Balance: {(balances[sellToken] || 0).toFixed(4)}{" "}
              {sellToken}
            </span>
          </div>

          <div className="flex items-center gap-3">
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
              className="flex-1 text-right bg-transparent text-2xl font-semibold text-slate-50 outline-none placeholder:text-slate-700"
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

          <div className="flex items-center gap-3">
            <TokenSelector
              side="buy"
              selected={buyToken}
              onSelect={selectBuy}
              balances={balances}
            />

            <div className="flex-1 text-right">
              <div className="text-2xl font-semibold text-slate-50">
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

        <button className="w-full py-3 mt-1 rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 text-sm font-semibold text-white shadow-lg shadow-sky-500/30">
          Swap
        </button>
      </div>

      <div className="mt-4 w-full max-w-xl rounded-2xl bg-slate-900/60 border border-slate-800 px-4 py-3 text-xs text-slate-300">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Price impact</span>
          <span>--</span>
        </div>
      </div>
    </div>
  );
}
