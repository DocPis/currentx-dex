// src/components/Header.jsx
import React from "react";

export default function Header({
  address,
  isOnSepolia,
  onConnect,
  balances,
}) {
  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";

  return (
    <header className="w-full flex items-center justify-between py-4 px-6 border-b border-slate-800 bg-[#020617]">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-sky-500 flex items-center justify-center font-bold text-sm">
          X
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-slate-50">
            CurrentX
          </span>
          <span className="text-xs text-slate-400">
            The new current of decentralized trading.
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-3 text-xs text-slate-300">
          <span>ETH: {balances.ETH.toFixed(4)}</span>
          <span>WETH: {balances.WETH.toFixed(4)}</span>
          <span>USDC: {balances.USDC.toFixed(2)}</span>
        </div>

        <div
          className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
            isOnSepolia
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/50 bg-amber-500/10 text-amber-300"
          }`}
        >
          {isOnSepolia ? "Sepolia Testnet" : "Wrong network"}
        </div>

        {address ? (
          <div className="px-3 py-1.5 rounded-full bg-slate-800 text-xs text-slate-100 border border-slate-700">
            {shortAddress}
          </div>
        ) : (
          <button
            onClick={onConnect}
            className="px-4 py-1.5 rounded-full bg-sky-500 hover:bg-sky-400 text-xs font-semibold text-white shadow-md"
          >
            Connect wallet
          </button>
        )}
      </div>
    </header>
  );
}
