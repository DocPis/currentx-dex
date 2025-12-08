import { useEffect, useState } from "react";
import { BrowserProvider, formatEther, parseEther, Contract } from "ethers";

/* ---------- COSTANTI RETE + UNISWAP V2 (SEPOLIA) ---------- */

const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111

// Uniswap V2 ufficiale su Ethereum Sepolia (Factory/Router02 dai docs Uniswap)
const UNISWAP_V2_ROUTER = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";

// Wrapped native token & USDC su Ethereum Sepolia
const WETH_ADDRESS = "0xfff9976782d46cc05630d1f6ebab18b2324d6b14";
const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

// ABI minimale del router V2: usiamo SOLO swapExactETHForTokens (senza getAmountsOut per ora)
const UNISWAP_V2_ROUTER_ABI = [
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)"
];

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
              isOnSepolia ? "bg-emerald-400" : chainId ? "bg-amber-400" : "bg-slate-500"
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

/* ---------- COMPONENTI PICCOLI ---------- */

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

/* ---------- DASHBOARD (come prima, evoluta) ---------- */

function DashboardSection() {
  const [range, setRange] = useState("24h");
  const ranges = ["24h", "7d", "30d", "1y"];

  return (
    <div className="space-y-4">
      {/* Row 1: metrics */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl shadow-black/60">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-50">
              Protocol Overview
            </h2>
            <p className="text-[11px] text-slate-400">
              TVL, volume and fees aggregated across all pools on CurrentX.
            </p>
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-slate-900/80 px-2 py-1 text-[10px] text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>Live (placeholder)</span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <StatCard
            label="Total Value Locked"
            value="$128,452,930"
            delta="+3.2% 24h"
            caption="Across all pools"
          />
          <StatCard
            label="Volume (24h)"
            value="$18,937,201"
            delta="+11.4% 24h"
            caption="Swaps executed"
          />
          <StatCard
            label="Fees (24h)"
            value="$231,987"
            delta="+9.1% 24h"
            caption="Paid to LPs"
          />
          <StatCard
            label="Active wallets"
            value="12,304"
            delta="+4.7% 24h"
            caption="Unique traders"
          />
        </div>
      </div>

      {/* Row 2: chart + positions */}
      <div className="grid gap-4 md:grid-cols-[7fr_5fr]">
        {/* Chart card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl shadow-black/60">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-50">
                TVL & Volume
              </div>
              <div className="text-[11px] text-slate-400">
                Simulated chart — we&apos;ll plug real analytics here later.
              </div>
            </div>

            <div className="flex gap-1 rounded-full bg-slate-900/80 p-1 text-[10px] text-slate-400">
              {ranges.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`rounded-full px-2 py-0.5 ${
                    range === r
                      ? "bg-slate-800 text-slate-100"
                      : "hover:text-slate-200"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Fake chart */}
          <div className="relative mt-2 h-40 rounded-xl border border-slate-800 bg-gradient-to-b from-slate-900 via-slate-950 to-black">
            <div className="absolute inset-0">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="absolute inset-x-0 border-t border-slate-800/50"
                  style={{ top: `${i * 25}%` }}
                />
              ))}
            </div>
            <div className="absolute inset-2 flex items-end gap-1">
              {[20, 40, 30, 50, 45, 70, 55, 60, 52, 65, 58, 72].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-cyan-400/25"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
            <svg className="absolute inset-2 h-[calc(100%-16px)] w-[calc(100%-16px)]">
              <polyline
                fill="none"
                stroke="url(#tvlGradient)"
                strokeWidth="2"
                points="0,80 30,70 60,72 90,60 120,62 150,55 180,50 210,52 240,47 270,44 300,46 330,40"
              />
              <defs>
                <linearGradient id="tvlGradient" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor="#22c55e" />
                  <stop offset="100%" stopColor="#22d3ee" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>

        {/* Your positions */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-50">
                Your positions
              </div>
              <div className="text-[11px] text-slate-400">
                Once you provide liquidity, your LP tokens will show up here.
              </div>
            </div>
            <button className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-[11px] text-slate-100">
              Manage in Liquidity
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-900/60 px-3 py-3 text-xs text-slate-400">
            You don&apos;t have any active positions yet.
            <br />
            <span className="text-slate-300">
              Add liquidity in the Liquidity tab to start earning fees.
            </span>
          </div>
        </div>
      </div>

      {/* Row 3: top pools */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl shadow-black/60">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-50">Top pools</div>
            <div className="text-[11px] text-slate-400">
              Pools ranked by TVL and 24h volume on CurrentX.
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-y-[2px] text-left text-xs">
            <thead>
              <tr className="text-[11px] text-slate-400">
                <th className="pb-1 pr-3 font-normal">Pool</th>
                <th className="pb-1 pr-3 font-normal">TVL</th>
                <th className="pb-1 pr-3 font-normal">Volume 24h</th>
                <th className="pb-1 pr-3 font-normal">Fees 24h</th>
                <th className="pb-1 font-normal">APR</th>
              </tr>
            </thead>
            <tbody>
              <TopPoolRow
                pair="ETH / USDC"
                tvl="$45.2M"
                volume="$6.9M"
                fees="$42.1K"
                apr="18.3%"
              />
              <TopPoolRow
                pair="USDC / USDT"
                tvl="$32.1M"
                volume="$3.4M"
                fees="$18.7K"
                apr="7.9%"
              />
              <TopPoolRow
                pair="ETH / wBTC"
                tvl="$18.6M"
                volume="$2.1M"
                fees="$12.3K"
                apr="12.4%"
              />
              <TopPoolRow
                pair="cbETH / ETH"
                tvl="$12.4M"
                volume="$1.3M"
                fees="$7.6K"
                apr="10.1%"
              />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------- SWAP COLLEGATO A UNISWAP V2 SEP0LIA ---------- */

function SwapSection({
  address,
  chainId,
  ethBalance,
  onConnect,
  onSwap,
  swapState,
}) {
  const [amountIn, setAmountIn] = useState("");
  const isConnected = !!address;
  const isOnSepolia = chainId === SEPOLIA_CHAIN_ID_HEX;
  const canSwap = isConnected && isOnSepolia;

  const handleClick = () => {
    if (!isConnected || !isOnSepolia) {
      onConnect();
      return;
    }
    const value = parseFloat(amountIn || "0");
    if (!value || value <= 0) {
      alert("Enter a valid ETH amount to swap.");
      return;
    }
    onSwap(amountIn);
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl shadow-black/60">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-50">Swap</h2>
          <p className="mt-1 text-[11px] text-slate-400">
            ETH → USDC on{" "}
            <span className="font-semibold">Uniswap V2 (Sepolia)</span>. This is
            a real on-chain swap on testnet.
          </p>
        </div>
        {ethBalance != null && (
          <div className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-[11px] text-slate-300">
            Balance: {ethBalance.toFixed(4)} ETH
          </div>
        )}
      </div>

      {!isConnected && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
          Wallet not connected. Connect your wallet from the top right to start
          swapping on Sepolia.
        </div>
      )}

      {isConnected && !isOnSepolia && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
          You are connected on a different network. Switch to{" "}
          <span className="font-semibold">Sepolia</span> from your wallet or
          click &quot;Switch to Sepolia&quot; in the top bar.
        </div>
      )}

      <div className="mt-4 space-y-2 text-sm">
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2.5">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>From</span>
            <button className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-100">
              ETH <span>▼</span>
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <input
              type="number"
              min="0"
              step="0.0001"
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              placeholder="0.00"
              className="w-1/2 bg-transparent text-lg font-medium text-slate-50 outline-none placeholder:text-slate-600"
            />
            <div className="flex flex-col items-end text-[11px] text-slate-400">
              <button
                type="button"
                className="mb-1 rounded-full border border-slate-700 px-2 py-[1px] text-[10px] hover:border-slate-500"
                onClick={() => {
                  if (ethBalance != null) {
                    setAmountIn((ethBalance * 0.25).toFixed(4));
                  }
                }}
              >
                25%
              </button>
              <button
                type="button"
                className="mb-1 rounded-full border border-slate-700 px-2 py-[1px] text-[10px] hover:border-slate-500"
                onClick={() => {
                  if (ethBalance != null) {
                    setAmountIn((ethBalance * 0.5).toFixed(4));
                  }
                }}
              >
                50%
              </button>
              <button
                type="button"
                className="rounded-full border border-slate-700 px-2 py-[1px] text-[10px] hover:border-slate-500"
                onClick={() => {
                  if (ethBalance != null) {
                    setAmountIn((ethBalance * 0.95).toFixed(4));
                  }
                }}
              >
                Max
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2.5">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>To (estimated)</span>
            <button className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-100">
              USDC (Sepolia) <span>▼</span>
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-lg font-medium text-slate-50">0.00</span>
            <span className="text-[11px] text-slate-400">
              We&apos;ll add quoting next step
            </span>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-dashed border-slate-700 bg-slate-900/60 px-3 py-2.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-slate-400">Slippage protection</span>
            <span className="text-slate-100">
              For now: <span className="italic">amountOutMin = 0</span> (testnet)
            </span>
          </div>
          <div className="mt-1 text-slate-400">
            This is Sepolia testnet. We skip slippage checks for now and let
            Uniswap decide the output. Mainnet version will enforce min amount.
          </div>
        </div>

        <button
          onClick={handleClick}
          disabled={swapState.status === "pending"}
          className={`mt-3 inline-flex w-full items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold shadow-lg shadow-emerald-500/40 ${
            canSwap
              ? "bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950"
              : "bg-slate-800 text-slate-400"
          } ${
            !canSwap && !isConnected
              ? "cursor-pointer"
              : !canSwap
              ? "cursor-pointer"
              : ""
          } disabled:opacity-70`}
        >
          {!isConnected
            ? "Connect wallet to start"
            : !isOnSepolia
            ? "Switch to Sepolia"
            : swapState.status === "pending"
            ? "Confirm in MetaMask..."
            : "Swap on Uniswap V2 (Sepolia)"}
        </button>

        {swapState.txHash && (
          <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
            Swap broadcasted. Tx hash:{" "}
            <a
              href={`https://sepolia.etherscan.io/tx/${swapState.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {swapState.txHash.slice(0, 10)}...
              {swapState.txHash.slice(-8)}
            </a>
          </div>
        )}

        {swapState.error && (
          <div className="mt-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100">
            {swapState.error}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- LIQUIDITY (placeholder) ---------- */

function LiquiditySection() {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl shadow-black/60">
      <h2 className="text-sm font-semibold text-slate-50">Liquidity</h2>
      <p className="mt-1 text-xs text-slate-400">
        Provide liquidity to earn swap fees and incentives.
      </p>

      <div className="mt-4 space-y-2 text-sm">
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <button className="inline-flex flex-1 items-center justify-between rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] text-slate-100">
              <span>Token A</span>
              <span>▼</span>
            </button>
            <button className="inline-flex flex-1 items-center justify-between rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] text-slate-100">
              <span>Token B</span>
              <span>▼</span>
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
            <span>Select a pool</span>
            <span>TVL: —</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2.5">
          <div className="text-[11px] text-slate-400">Deposit amount</div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-lg font-medium text-slate-50">0.00</span>
            <span className="text-[11px] text-slate-400">
              Balance: 0.0000 / 0.0000
            </span>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-dashed border-slate-700 bg-slate-900/60 px-3 py-2.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-slate-400">Share of pool</span>
            <span className="text-slate-100">–</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-slate-400">Estimated APR</span>
            <span className="text-emerald-300">18.3%</span>
          </div>
        </div>

        <button className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/40">
          Connect wallet to add liquidity
        </button>
      </div>
    </div>
  );
}

/* ---------- APP ROOT CON LOGICA WALLET + SWAP ---------- */

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [ethBalance, setEthBalance] = useState(null);
  const [connecting, setConnecting] = useState(false);

  const [swapState, setSwapState] = useState({
    status: "idle", // idle | pending | done | error
    txHash: null,
    error: null,
  });

  async function refreshBalance(provider, addr) {
    try {
      const balance = await provider.getBalance(addr);
      setEthBalance(parseFloat(formatEther(balance)));
    } catch (e) {
      console.error("Error refreshing balance:", e);
    }
  }

  // Connessione + tentativo switch a Sepolia
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

      await refreshBalance(provider, addr);
    } catch (err) {
      console.error(err);
    } finally {
      setConnecting(false);
    }
  }

  // Handler per swap reale su Uniswap V2
  async function handleSwap(amountEthStr) {
    if (!window.ethereum) {
      alert("No wallet detected");
      return;
    }
    if (!address || chainId !== SEPOLIA_CHAIN_ID_HEX) {
      alert("Connect wallet on Sepolia first.");
      return;
    }

    try {
      const amountEthNum = parseFloat(amountEthStr);
      if (!amountEthNum || amountEthNum <= 0) {
        alert("Invalid amount.");
        return;
      }

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const router = new Contract(
        UNISWAP_V2_ROUTER,
        UNISWAP_V2_ROUTER_ABI,
        signer
      );

      const value = parseEther(amountEthStr);

      const path = [WETH_ADDRESS, USDC_ADDRESS];
      const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // 10 minuti

      setSwapState({ status: "pending", txHash: null, error: null });

      // PER ORA: amountOutMin = 0 (nessuna protezione slippage – solo testnet)
      const tx = await router.swapExactETHForTokens(
        0,
        path,
        address,
        deadline,
        { value }
      );

      setSwapState((prev) => ({
        ...prev,
        txHash: tx.hash,
      }));

      await tx.wait();

      setSwapState((prev) => ({
        ...prev,
        status: "done",
      }));

      // refresh balance dopo swap
      await refreshBalance(provider, address);
    } catch (err) {
      console.error("Swap error:", err);
      let msg = "Swap failed.";
      if (err?.info?.error?.message) {
        msg = err.info.error.message;
      } else if (err?.message) {
        msg = err.message;
      }
      setSwapState({
        status: "error",
        txHash: null,
        error: msg,
      });
    } finally {
      // se era pending e non è passato in done/error sopra, lo azzera
      setTimeout(() => {
        setSwapState((prev) =>
          prev.status === "pending" ? { ...prev, status: "idle" } : prev
        );
      }, 3000);
    }
  }

  // Listener per change account / chain
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        setAddress(null);
        setEthBalance(null);
      } else {
        setAddress(accounts[0]);
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
        onSwap={handleSwap}
        swapState={swapState}
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
