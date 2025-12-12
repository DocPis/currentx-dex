// src/App.jsx
import React, { useState } from "react";
import Header from "./components/Header";
import SwapSection from "./components/SwapSection";
import LiquiditySection from "./components/LiquiditySection";
import Dashboard from "./components/Dashboard";
import { useWallet } from "./hooks/useWallet";
import { useBalances } from "./hooks/useBalances";

export default function App() {
  const [tab, setTab] = useState("swap");
  const { address, isOnSepolia, connect } = useWallet();
  const { balances, refresh } = useBalances(address);

  const handleConnect = async () => {
    try {
      const connectedAddress = await connect();
      await refresh(connectedAddress);
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
      <div className="px-4 sm:px-6 pt-6">
        <div className="flex flex-wrap justify-center gap-3 text-xs sm:text-sm">
          {[
            { id: "dashboard", label: "Dashboard" },
            { id: "swap", label: "Swap" },
            { id: "liquidity", label: "Liquidity" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`px-4 py-2 rounded-xl border transition shadow-sm ${
                tab === item.id
                  ? "border-sky-500/60 bg-slate-900 text-white shadow-sky-500/20"
                  : "border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-100 hover:border-slate-600"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1">
        {tab === "swap" && (
          <SwapSection balances={balances} />
        )}
        {tab === "liquidity" && <LiquiditySection />}
        {tab === "dashboard" && <Dashboard />}
      </main>
    </div>
  );
}
