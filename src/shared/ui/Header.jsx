// src/shared/ui/Header.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import currentxLogo from "../../assets/currentx.png";
import { getActiveNetworkConfig } from "../config/networks";

export default function Header({
  address,
  chainId,
  onConnect,
  onSwitchWallet,
  onDisconnect,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const activeNetwork = useMemo(() => getActiveNetworkConfig(), []);

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

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
  const normalizedChainId = (chainId || "").toLowerCase();
  const uiChainId = (activeNetwork?.chainIdHex || "").toLowerCase();
  const isOnUiNetwork = Boolean(
    address &&
      normalizedChainId &&
      uiChainId &&
      normalizedChainId === uiChainId
  );
  const isWrongNetwork = Boolean(address && !isOnUiNetwork);
  return (
    <header className="relative z-20 w-full border-b border-slate-700/45 bg-slate-950/45 px-4 py-4 backdrop-blur-xl sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 w-full md:w-auto">
          <img
            src={currentxLogo}
            alt="CurrentX logo"
            className="h-20 w-20 object-contain drop-shadow-[0_10px_18px_rgba(8,14,28,0.7)]"
          />
          <div className="flex flex-col">
            <span className="font-display text-lg font-semibold italic tracking-tight text-slate-50">
              CurrentX
            </span>
            <span className="max-w-[19rem] text-xs text-slate-300/70">
              The new current of decentralized trading.
            </span>
          </div>
        </div>

        <div className="flex flex-wrap md:flex-nowrap items-center gap-3 justify-end w-full md:w-auto">
          <div className="relative z-30" ref={menuRef}>
            <button
              onClick={() => {
                if (!address) {
                  onConnect();
                } else {
                  setMenuOpen((v) => !v);
                }
              }}
              className={`flex w-full items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold shadow-md sm:w-auto ${
                address
                  ? "border border-slate-600/80 bg-slate-900/80 text-slate-100 hover:border-sky-400/60"
                  : "border border-sky-300/70 bg-gradient-to-r from-sky-500 to-cyan-400 text-white shadow-[0_8px_24px_rgba(56,189,248,0.35)] hover:brightness-110"
              }`}
            >
              {address ? (
                <>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isWrongNetwork
                        ? "bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.8)]"
                        : "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]"
                    }`}
                  />
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
              <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-slate-600/50 bg-slate-950/90 shadow-2xl shadow-black/40 backdrop-blur">
                <div className="border-b border-slate-700/60 px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    Wallet
                  </div>
                  <div className="font-display text-sm font-semibold text-slate-100">
                    {shortAddress}
                  </div>
                  <div
                    className={`mt-1 inline-flex items-center gap-2 px-2 py-1 rounded-lg text-[11px] ${
                      isWrongNetwork
                        ? "bg-amber-500/10 text-amber-200 border border-amber-500/40"
                        : "bg-emerald-500/10 text-emerald-200 border border-emerald-500/40"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        isWrongNetwork ? "bg-amber-400" : "bg-emerald-400"
                      }`}
                    />
                    <span>{activeNetwork?.label || "Network"}</span>
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
                  className="flex w-full items-center gap-2 border-t border-slate-700/60 px-4 py-3 text-left text-sm text-rose-200 transition hover:bg-rose-500/10"
                >
                  <span
                    className="h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_12px_rgba(248,113,113,0.8)]"
                  />
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
