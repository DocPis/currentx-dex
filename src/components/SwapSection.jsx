// src/components/SwapSection.jsx (mocked swap UI)
import React, { useMemo, useState } from "react";
import { TOKENS } from "../config/web3";

const TOKEN_OPTIONS = ["ETH", "WETH", "USDC"];

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
  const [slippage, setSlippage] = useState("0.5");
  const [swapStatus, setSwapStatus] = useState(null);

  const rate = useMemo(() => {
    // Simple mocked price table; tweak as needed
    const basePrices = {
      ETH: 2000,
      WETH: 2000,
      USDC: 1,
    };
    const sell = basePrices[sellToken];
    const buy = basePrices[buyToken];
    if (!sell || !buy) return null;
    return sell / buy;
  }, [sellToken, buyToken]);

  const quoteOut = useMemo(() => {
    if (!amountIn || Number.isNaN(Number(amountIn)) || !rate) return null;
    return Number(amountIn) * rate;
  }, [amountIn, rate]);

  const handleSwap = () => {
    if (!quoteOut) {
      setSwapStatus({ variant: "error", message: "Enter a valid amount" });
      return;
    }
    setSwapStatus({
      variant: "success",
      message: `Mock swap executed: ${amountIn} ${sellToken} -> ${quoteOut.toFixed(
        4
      )} ${buyToken}`,
    });
  };

  const flipTokens = () => {
    setSellToken(buyToken);
    setBuyToken(sellToken);
  };

  return (
    <div className="w-full flex flex-col items-center mt-10 px-4 sm:px-0">
      <div className="w-full max-w-xl rounded-3xl bg-slate-900/80 border border-slate-800 p-4 sm:p-6 shadow-xl">
        {/* SELL */}
        <div className="mb-4 rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="flex items-center justify-between mb-2 text-xs text-slate-400">
            <span>Sell</span>
            <span className="font-medium text-slate-300">
              Balance: {(balances[sellToken] || 0).toFixed(4)} {sellToken}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <TokenSelector
              side="sell"
              selected={sellToken}
              onSelect={(sym) => {
                if (sym === buyToken) setBuyToken(sellToken);
                setSellToken(sym);
              }}
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
            onClick={flipTokens}
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
              onSelect={(sym) => {
                if (sym === sellToken) setSellToken(buyToken);
                setBuyToken(sym);
              }}
              balances={balances}
            />
            <div className="flex-1 text-right w-full">
              <div className="text-2xl sm:text-3xl font-semibold text-slate-50">
                {quoteOut !== null ? quoteOut.toFixed(6) : "0.00"}
              </div>
              <div className="text-[11px] text-slate-500">
                Mock quote (no on-chain call)
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
              <span className="text-slate-500">Min received (mock)</span>
              <span className="text-slate-100">
                {quoteOut !== null
                  ? `${(quoteOut * (1 - Number(slippage || 0) / 100)).toFixed(6)} ${buyToken}`
                  : "--"}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] mt-1">
              <span className="text-slate-500">Price impact (mock)</span>
              <span className="text-slate-100">--</span>
            </div>
          </div>

          <button
            onClick={handleSwap}
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
              Swap now
            </span>
          </button>
        </div>

        {swapStatus && (
          <div
            className={`mt-2 text-xs rounded-xl px-3 py-2 border backdrop-blur-sm ${
              swapStatus.variant === "success"
                ? "bg-slate-900/80 border-slate-700 text-slate-100"
                : "bg-rose-500/10 border-rose-500/40 text-rose-100"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  swapStatus.variant === "success"
                    ? "bg-emerald-400"
                    : "bg-rose-400"
                }`}
              />
              <span>{swapStatus.message}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
