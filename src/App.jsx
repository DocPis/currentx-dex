// src/App.jsx

import { useEffect, useState } from "react";
import {
  BrowserProvider,
  formatEther
} from "ethers";

import Header from "./components/Header";
import Tabs from "./components/Tabs";
import SwapSection from "./components/SwapSection";
import DashboardSection from "./components/DashboardSection";
import LiquiditySection from "./components/LiquiditySection";

import {
  SEPOLIA_CHAIN_ID_HEX,
  loadTokenRegistry,
} from "./config/uniswapSepolia";

import { getAllBalances } from "./utils/getBalances";

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);

  const [balances, setBalances] = useState({});
  const [tokenRegistry, setTokenRegistry] = useState(null);

  const [connecting, setConnecting] = useState(false);

  /* ----------------------------------------------------
     UNIVERSAL BALANCE LOADER
  ---------------------------------------------------- */

  async function refreshBalances(currentAddress) {
    if (!currentAddress) return;

    try {
      const all = await getAllBalances(currentAddress);
      setBalances(all);
    } catch (e) {
      console.error("Balance refresh error:", e);
    }
  }

  /* ----------------------------------------------------
     CONNECT WALLET + LOAD REGISTRY
  ---------------------------------------------------- */

  async function handleConnect() {
    if (!window.ethereum) {
      alert("No wallet detected.");
      return;
    }

    try {
      setConnecting(true);

      const provider = new BrowserProvider(window.ethereum);

      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      const addr = accounts[0];
      setAddress(addr);

      let currentChainId = await window.ethereum.request({
        method: "eth_chainId",
      });

      setChainId(currentChainId);

      // Forziamo Sepolia
      if (currentChainId !== SEPOLIA_CHAIN_ID_HEX) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
          });
          currentChainId = SEPOLIA_CHAIN_ID_HEX;
          setChainId(SEPOLIA_CHAIN_ID_HEX);
        } catch (err) {
          console.warn("Cannot switch:", err);
        }
      }

      // Load token registry once
      const registry = await loadTokenRegistry(provider);
      setTokenRegistry(registry);

      // Load balances
      await refreshBalances(addr);
    } catch (e) {
      console.error(e);
    } finally {
      setConnecting(false);
    }
  }

  /* ----------------------------------------------------
     ACCOUNT + CHAIN LISTENERS
  ---------------------------------------------------- */

  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = async (accounts) => {
      if (accounts.length === 0) {
        setAddress(null);
        setBalances({});
      } else {
        const addr = accounts[0];
        setAddress(addr);
        await refreshBalances(addr);
      }
    };

    const handleChainChanged = (cid) => {
      setChainId(cid);
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      if (!window.ethereum) return;
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, []);

  /* ----------------------------------------------------
     WHICH UI TO SHOW
  ---------------------------------------------------- */

  let content;
  if (tab === "dashboard") content = <DashboardSection />;
  if (tab === "swap")
    content = (
      <SwapSection
        address={address}
        chainId={chainId}
        balances={balances}
        tokenRegistry={tokenRegistry}
        onConnect={handleConnect}
        onRefreshBalances={() => refreshBalances(address)}
      />
    );
  if (tab === "liquidity") content = <LiquiditySection />;

  /* ----------------------------------------------------
     RENDER
  ---------------------------------------------------- */

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-black text-slate-50">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
        
        <Header
          address={address}
          chainId={chainId}
          onConnect={handleConnect}
          connecting={connecting}
        />

        <Tabs active={tab} onChange={setTab} />

        <main className="pt-2">{content}</main>
      </div>
    </div>
  );
}
