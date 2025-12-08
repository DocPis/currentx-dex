import { useEffect, useState } from "react";
import { BrowserProvider, formatEther } from "ethers";

import SwapSection from "./components/SwapSection";
import { SEPOLIA_CHAIN_ID_HEX } from "./config/uniswapSepolia";

/* ---------- HEADER + TABS ---------- */

function Header({ address, chainId, onConnect, connecting }) {
  const shortAddr = address
    ? address.slice(0, 6) + "..." + address.slice(-4)
    : null;

  const isOnSepolia = chainId === SEPOLIA_CHAIN_ID_HEX;

  return (
    <header className="flex items-center justify-between gap-4 pb-4 border-b border-slate-800/60">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-400 via-cyan-400 to-indigo-500 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/40">
          CX
        </div>
        <div>
          <div className="text-xl font-semibold text-slate-50">CurrentX</div>
          <div className="text-[11px] text-slate-400">
            The new current of decentralized trading.
          </div>
        </div>
      </div>

      {/* Right side */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-[11px] text-slate-300">
          <span
            className={`h-2 w-2 rounded-full ${
              isOnSepolia
                ? "bg-emerald-400"
                : chainId
                ? "bg-amber-400"
                : "bg-slate-500"
            } shadow-[0_0_0_4px_rgba(34,197,94,0.35)]`}
          />
          <span>
            {chainId
              ? isOnSepolia
                ? "Sepolia Testnet"
                : "Wrong network"
              : "Not connected"}
          </span>
        </div>

        {address && (
          <div className="hidden items-center rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-[11px] text-slate-300 sm:inline-flex">
            {shortAddr}
          </div>
        )}

        <button
          onClick={onConnect}
          disabled={connecting}
          className="inline-flex items-center rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 shadow-lg shadow-emerald-500/40 disabled:opacity-60"
        >
          {connecting
            ? "Connecting..."
            : address
            ? isOnSepolia
              ? "Connected"
              : "Switch to Sepolia"
            : "Connect Wallet"}
        </button>
      </div>
    </header>
  );
}

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

/* ---------- SMALL COMPONENTS (come prima) ---------- */

function StatCard({ label, value, delta, caption }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-slate-400">{label}</div>
        {delta && (
          <div
            className={`text-[11px] ${
              delta.startsWith("-") ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {delta}
          </div>
        )}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-50">{value}</div>
      {caption && (
        <div className="mt-1 text-[11px] text-slate-500">{caption}</div>
      )}
    </div>
  );
}

function TopPoolRow({ pair, tvl, volume, apr, fees }) {
  return (
    <tr className="border-b border-slate-900/70 text-xs">
      <td className="py-2 pr-3 text-slate-100">{pair}</td>
      <td className="py-2 pr-3 text-slate-300">{tvl}</td>
      <td className="py-2 pr-3 text-slate-300">{volume}</td>
      <td className="py-2 pr-3 text-slate-300">{fees}</td>
      <td className="py-2">
        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-[2px] text-[10px] font-medium text-emerald-300">
          {apr}
        </span>
      </td>
    </tr>
  );
}

/* ---------- DASHBOARD (come prima, omesso per brevità ma identico) ---------- */

function DashboardSection() {
  const [range, setRange] = useState("24h");
  const ranges = ["24h", "7d", "30d", "1y"];

  return (
    <div className="space-y-4">
      {/* ... QUI puoi incollare esattamente la tua DashboardSection precedente ... */}
      {/* per brevità non la ripeto, è identica a quella che avevi prima */}
    </div>
  );
}

/* ---------- LIQUIDITY (placeholder, come prima) ---------- */

function LiquiditySection() {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl shadow-black/60">
      <h2 className="text-sm font-semibold text-slate-50">Liquidity</h2>
      <p className="mt-1 text-xs text-slate-400">
        Provide liquidity to earn swap fees and incentives.
      </p>
      {/* ... resto del placeholder come avevi prima ... */}
    </div>
  );
}

/* ---------- APP ROOT ---------- */

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [ethBalance, setEthBalance] = useState(null);
  const [connecting, setConnecting] = useState(false);

  async function refreshBalance(currentAddress) {
    if (!window.ethereum || !currentAddress) return;
    try {
      const provider = new BrowserProvider(window.ethereum);
      const balance = await provider.getBalance(currentAddress);
      setEthBalance(parseFloat(formatEther(balance)));
    } catch (e) {
      console.error("Error refreshing balance:", e);
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

      await refreshBalance(addr);
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
      } else {
        const addr = accounts[0];
        setAddress(addr);
        await refreshBalance(addr);
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
        onConnect={handleConnect}
        onRefreshBalance={() => refreshBalance(address)}
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
