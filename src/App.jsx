// src/App.jsx
import React, { useEffect, useState } from "react";
import Header from "./shared/ui/Header";
import SwapSection from "./features/swap/SwapSection";
import LiquiditySection from "./features/liquidity/LiquiditySection";
import Dashboard from "./features/dashboard/Dashboard";
import Farms from "./features/farms/Farms";
import PoolsSection from "./features/pools/PoolsSection";
import MegaVaultSection from "./features/megavault/MegaVaultSection";
import { useWallet } from "./shared/hooks/useWallet";
import { useBalances } from "./shared/hooks/useBalances";
import WalletModal from "./features/wallet/WalletModal";
import Footer from "./shared/ui/Footer";
import WhitelistBanner from "./shared/ui/WhitelistBanner";

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [poolSelection, setPoolSelection] = useState(null);
  const { address, chainId, connect, disconnect } = useWallet();
  const { balances, refresh } = useBalances(address, chainId);
  useEffect(() => {
    if (!connectError) return undefined;
    const id = setTimeout(() => setConnectError(""), 4000);
    return () => clearTimeout(id);
  }, [connectError]);


  const handleConnect = () => {
    setShowWalletModal(true);
  };

  const handleDisconnect = async () => {
    disconnect();
    await refresh(null);
  };

  const handleWalletSelect = async (walletId) => {
    try {
      const connectedAddress = await connect(walletId);
      await refresh(connectedAddress);
      setShowWalletModal(false);
      setConnectError("");
    } catch (e) {
      const msg =
        e?.code === 4001 || e?.code === "ACTION_REJECTED"
          ? "Request rejected in wallet. Please approve to continue."
          : e?.message || "Failed to connect wallet";
      setConnectError(msg);
    }
  };

  const handlePoolSelect = (pool) => {
    setPoolSelection(pool || null);
    setTab("liquidity");
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-50 flex flex-col relative">
      <WhitelistBanner />
      {connectError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-slate-900/95 border border-rose-500/40 text-rose-100 px-4 py-3 rounded-2xl shadow-2xl shadow-rose-900/40 flex items-start gap-3 min-w-[260px]">
            <div className="h-2 w-2 mt-1.5 rounded-full bg-rose-400 shadow-[0_0_12px_rgba(248,113,113,0.7)]" />
            <div className="text-sm">
              <div className="font-semibold text-rose-100">Connection rejected</div>
              <div className="text-rose-200/80 text-xs">{connectError}</div>
            </div>
            <button
              type="button"
              onClick={() => setConnectError("")}
              className="ml-auto text-rose-200/70 hover:text-rose-100"
              aria-label="Dismiss"
            >
              X
            </button>
          </div>
        </div>
      )}
      <Header
        address={address}
        chainId={chainId}
        onConnect={handleConnect}
        onSwitchWallet={() => setShowWalletModal(true)}
        onDisconnect={handleDisconnect}
        balances={balances}
      />

      {/* Tabs */}
      <div className="px-4 sm:px-6 pt-6">
        <div className="flex flex-wrap justify-center gap-3 text-xs sm:text-sm">
          {[
            { id: "dashboard", label: "Dashboard" },
            { id: "swap", label: "Swap" },
            { id: "liquidity", label: "Liquidity" },
            { id: "pools", label: "Pools" },
            { id: "farms", label: "Farms" },
            { id: "megavault", label: "MegaVault" },
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
          <SwapSection
            balances={balances}
            address={address}
            chainId={chainId}
            onBalancesRefresh={refresh}
          />
        )}
        {tab === "liquidity" && (
          <LiquiditySection
            address={address}
            chainId={chainId}
            balances={balances}
            showV3={true}
            poolSelection={poolSelection}
            onBalancesRefresh={refresh}
          />
        )}
        {tab === "pools" && <PoolsSection onSelectPool={handlePoolSelect} />}
        {tab === "dashboard" && <Dashboard />}
        {tab === "farms" && (
          <Farms address={address} onConnect={handleConnect} />
        )}
        {tab === "megavault" && <MegaVaultSection />}
      </main>

      <Footer />

      <WalletModal
        open={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        onSelectWallet={handleWalletSelect}
      />
    </div>
  );
}

