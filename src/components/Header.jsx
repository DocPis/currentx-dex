// src/components/Header.jsx
import currentXLogo from "../assets/currentx-logo.svg";
import { SEPOLIA_CHAIN_ID_HEX } from "../config/uniswapSepolia";

export default function Header({ address, chainId, onConnect, connecting }) {
  const shortAddr = address
    ? address.slice(0, 6) + "..." + address.slice(-4)
    : null;

  const isOnSepolia = chainId === SEPOLIA_CHAIN_ID_HEX;

  return (
    <header className="flex items-center justify-between gap-4 pb-4 border-b border-slate-800/60">
      {/* BRAND */}
      <div className="flex items-center gap-3">
        <img
          src={currentXLogo}
          alt="CurrentX Logo"
          className="h-12 w-12 object-contain"
        />

        <div className="flex flex-col justify-center">
          <div className="text-xl font-semibold text-slate-50">
            CurrentX
          </div>
          <div className="text-[11px] text-slate-400">
            The new current of decentralized trading.
          </div>
        </div>
      </div>

      {/* RIGHT SIDE */}
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
