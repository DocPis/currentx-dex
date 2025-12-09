// src/App.jsx
import { useEffect, useState } from "react";
import {
  BrowserProvider,
  formatEther,
  Contract,
  formatUnits,
} from "ethers";

import Header from "./components/Header";

import {
  SEPOLIA_CHAIN_ID_HEX,
  USDC_ADDRESS,
  ERC20_ABI,
  loadTokenRegistry,
} from "./config/uniswapSepolia";

import SwapSection from "./components/SwapSection";
import DashboardSection from "./components/DashboardSection";
import LiquiditySection from "./components/LiquiditySection";

/* ---------- TABS ---------- */

function Tabs({ active, onChange }) {
  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "swap", label: "Swap" },
    { id: "liquidity", label: "Liquidity" },
  ];

  return (
    <div className="pt-4">
      <div className="inline-flex rounded-full border border-slate-700 bg-slate-900/80 p-1 text-xs text-slate-400">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`rounded-full px-3 py-1 transition ${
              active === tab.id
                ? "bg-slate-800 text-slate-100 shadow-sm shadow-black/40"
                : "hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- APP ROOT ---------- */

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [ethBalance, setEthBalance] = useState(null);
  const [usdcBalance, setUsdcBalance] = useState(null);
  const [tokenRegistry, setTokenRegistry] = useState(null);
  const [connecting, setConnecting] = useState(false);

  async function refreshBalances(
    currentAddress,
    currentRegistry,
    existingProvider
  ) {
    if (!window.ethereum || !currentAddress) return;

    const provider = existingProvider || new BrowserProvider(window.ethereum);

    // assicuriamoci di avere il registry
    let registryToUse = currentRegistry || tokenRegistry;
    if (!registryToUse) {
      registryToUse = await loadTokenRegistry(provider);
      setTokenRegistry(registryToUse);
    }

    try {
      // ETH
      const balance = await provider.getBalance(currentAddress);
      setEthBalance(parseFloat(formatEther(balance)));

      // USDC (se presente nel registry)
      const usdcToken = registryToUse.USDC;
      if (usdcToken && usdcToken.address) {
        const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
        const usdcRaw = await usdc.balanceOf(currentAddress);
        const usdcNum = parseFloat(
          formatUnits(usdcRaw, usdcToken.decimals || 18)
        );
        setUsdcBalance(usdcNum);
      } else {
        setUsdcBalance(null);
      }
    } catch (e) {
      console.error("Error refreshing balances:", e);
    }
  }

  async function handleConnect() {
    if (!window.ethereum) {
      alert("No wallet detected (MetaMask, Rabby, etc.)");
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

      const currentChainId = await window.ethereum.request({
        method: "eth_chainId",
      });
      setChainId(currentChainId);

      if (currentChainId !== SEPOLIA_CHAIN_ID_HEX) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
          });
          setChainId(SEPOLIA_CHAIN_ID_HEX);
        } catch (switchErr) {
          console.warn("Cannot switch network:", switchErr);
        }
      }

      // carica token registry una volta sola qui
      const registry = await loadTokenRegistry(provider);
      setTokenRegistry(registry);

      await refreshBalances(addr, registry, provider);
    } catch (err) {
      console.error(err);
    } finally {
      setConnecting(false);
    }
  }

  // Account / chain listeners
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = async (accounts) => {
      if (accounts.length === 0) {
        setAddress(null);
        setEthBalance(null);
        setUsdcBalance(null);
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

  let content;
  if (tab === "dashboard") content = <DashboardSection />;
  if (tab === "swap")
    content = (
      <SwapSection
        address={address}
        chainId={chainId}
        ethBalance={ethBalance}
        usdcBalance={usdcBalance}
        tokenRegistry={tokenRegistry}
        onConnect={handleConnect}
        onRefreshBalances={() => refreshBalances(address)}
      />
    );
  if (tab === "liquidity") content = <LiquiditySection />;

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
