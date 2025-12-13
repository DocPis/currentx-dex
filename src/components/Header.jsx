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
    <header className="w-full flex flex-wrap items-center justify-between gap-4 py-4 px-4 sm:px-6 border-b border-slate-800 bg-[#020617]">
      <div className="flex items-center gap-2 w-full md:w-auto">
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

      <div className="flex flex-wrap md:flex-nowrap items-center gap-3 justify-end w-full md:w-auto">
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
          <div className="px-3 py-1.5 rounded-full bg-slate-800 text-xs text-slate-100 border border-slate-700 w-full sm:w-auto text-center">
            {shortAddress}
          </div>
        ) : (
          <button
            onClick={onConnect}
            className="px-4 py-1.5 rounded-full bg-sky-500 hover:bg-sky-400 text-xs font-semibold text-white shadow-md w-full sm:w-auto"
          >
            Connect wallet
          </button>
        )}
      </div>
    </header>
  );
}
