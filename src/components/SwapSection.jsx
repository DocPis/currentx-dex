// src/components/SwapSection.jsx
import React, { useState } from "react";
import { TOKENS } from "../config/web3";

const TOKEN_OPTIONS = ["ETH", "WETH", "USDC", "DAI", "WBTC"];

function TokenSelector({ side, selected, onSelect, balances }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-2 rounded-xl bg-slate-800 text-xs text-slate-100 border border-slate-700 flex items-center gap-2 shadow-inner shadow-black/30 min-w-[110px]"
      >
        <img
          src={TOKENS[selected].logo}
          alt={`${selected} logo`}
          className="h-5 w-5 rounded-full object-contain"
        />
        <span className="text-sm font-semibold">{selected}</span>
        <span className="ml-auto text-slate-400 text-[11px]">▼</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-48 bg-slate-900 border border-slate-800 rounded-xl shadow-xl shadow-black/50 overflow-hidden">
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
              <span className="font-medium">{symbol}</span>
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

  const selectSell = (symbol) => {
    if (symbol === buyToken) setBuyToken(sellToken);
    setSellToken(symbol);
  };

  const selectBuy = (symbol) => {
    if (symbol === sellToken) setSellToken(buyToken);
    setBuyToken(symbol);
  };

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
          <div className="h-8 w-8 rounded-full border border-slate-700 bg-slate-900 flex items-center justify-center text-slate-300 text-lg">
            ↓
          </div>
        </div>

        {/* BUY */}
        <div className="mb-4 rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="flex items-center justify-between mb-2 text-xs text-slate-400">
            <span>Buy</span>
            <span className="font-medium text-slate-300">
              Balance: {(balances[buyToken] || 0).toFixed(2)}{" "}
              {buyToken}
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
                0.00
              </div>
              <div className="text-[11px] text-slate-500">
                No quote available (ancora mock)
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
          <span>—</span>
        </div>
      </div>
    </div>
  );
}
