// src/App.jsx
import React, { useState } from "react";
import Header from "./components/Header";
import SwapSection from "./components/SwapSection";
import LiquiditySection from "./components/LiquiditySection";
import { useWallet } from "./hooks/useWallet";
import { useBalances } from "./hooks/useBalances";

export default function App() {
  const [tab, setTab] = useState("swap");
  const { address, isOnSepolia, connect } = useWallet();
  const { balances, refresh } = useBalances(address);

  const handleConnect = async () => {
    try {
      await connect();
      await refresh();
    } catch (e) {
      alert(e.message || "Failed to connect wallet");
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-50 flex flex-col">
      <Header
        address={address}
        isOnSepolia={isOnSepolia}
        onConnect={handleConnect}
        balances={balances}
      />

      {/* Tabs */}
      <div className="px-6 pt-6">
        <div className="inline-flex bg-slate-900/80 rounded-full p-1 text-xs sm:text-sm border border-slate-800">
          <button
            onClick={() => setTab("dashboard")}
            className={`px-4 py-1.5 rounded-full ${
              tab === "dashboard"
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:text-slate-100"
            }`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setTab("swap")}
            className={`px-4 py-1.5 rounded-full ${
              tab === "swap"
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:text-slate-100"
            }`}
          >
            Swap
          </button>
          <button
            onClick={() => setTab("liquidity")}
            className={`px-4 py-1.5 rounded-full ${
              tab === "liquidity"
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:text-slate-100"
            }`}
          >
            Liquidity
          </button>
        </div>
      </div>

      <main className="flex-1">
        {tab === "swap" && (
          <SwapSection balances={balances} />
        )}
        {tab === "liquidity" && <LiquiditySection />}
        {tab === "dashboard" && (
          <div className="mt-10 text-center text-slate-400">
            Dashboard coming soon.
          </div>
        )}
      </main>
    </div>
  );
}
