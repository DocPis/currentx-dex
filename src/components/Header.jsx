// src/components/Header.jsx
import React, { useEffect, useRef, useState } from "react";
import currentxLogo from "../assets/currentx.png";

export default function Header({
  address,
  isOnSepolia,
  onConnect,
  onSwitchWallet,
  onDisconnect,
  balances,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";
  const isWrongNetwork = Boolean(address && !isOnSepolia);

  return (
    <header className="w-full flex flex-wrap items-center justify-between gap-4 py-4 px-4 sm:px-6 border-b border-slate-800 bg-[#020617] relative z-20">
      <div className="flex items-center gap-1 w-full md:w-auto">
        <img
          src={currentxLogo}
          alt="CurrentX logo"
          className="h-20 w-20 object-contain"
        />
        <div className="flex flex-col">
          <span className="font-inter font-semibold italic tracking-[-0.02em] text-slate-50">
            CurrentX
          </span>
          <span className="text-xs text-slate-400">
            The new current of decentralized trading.
          </span>
        </div>
      </div>

      <div className="flex flex-wrap md:flex-nowrap items-center gap-3 justify-end w-full md:w-auto">
        {address && (
          <div
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              isWrongNetwork
                ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                : "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {isWrongNetwork ? "Wrong network" : "Sepolia Testnet"}
          </div>
        )}

        <div className="relative z-30" ref={menuRef}>
          <button
            onClick={() => {
              if (!address) {
                onConnect();
              } else {
                setMenuOpen((v) => !v);
              }
            }}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold w-full sm:w-auto shadow-md flex items-center gap-2 ${
              address
                ? "bg-slate-800 text-slate-100 border border-slate-700 hover:border-slate-500"
                : "bg-sky-500 hover:bg-sky-400 text-white"
            }`}
          >
            {address ? (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
                <span>{shortAddress}</span>
                <svg
                  className="h-3 w-3 text-slate-400"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M6 8l4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </>
            ) : (
              "Connect wallet"
            )}
          </button>

          {address && menuOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-slate-800 bg-slate-900/95 shadow-2xl shadow-black/40 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  Wallet
                </div>
                <div className="text-sm font-semibold text-slate-100">
                  {shortAddress}
                </div>
              </div>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onSwitchWallet?.();
                }}
                className="w-full px-4 py-3 text-left text-sm text-slate-100 hover:bg-slate-800/80 flex items-center gap-2 transition"
              >
                <span className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.8)]" />
                Switch wallet
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDisconnect?.();
                }}
                className="w-full px-4 py-3 text-left text-sm text-rose-200 hover:bg-rose-500/10 flex items-center gap-2 transition border-t border-slate-800/70"
              >
                <span className="h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_12px_rgba(248,113,113,0.8)]" />
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
