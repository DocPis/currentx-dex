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
  const [copied, setCopied] = useState(false);
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
  const handleCopyAddress = async () => {
    if (!address || !navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <header className="relative z-20 h-[60px] w-full border-b border-slate-800/85 bg-[#070b16] px-4 sm:px-6">
      <div className="flex h-full w-full items-center justify-between gap-4">
        <div className="flex items-center gap-1">
          <img
            src={currentxLogo}
            alt="CurrentX logo"
            className="h-[30px] w-[30px] object-contain"
          />
          <div className="flex items-center">
            <span className="font-display text-[15px] font-medium tracking-tight text-slate-300/80">
              CurrentX
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end">
          <div className="relative z-30" ref={menuRef}>
            <button
              onClick={() => {
                if (!address) {
                  onConnect();
                } else {
                  setMenuOpen((v) => !v);
                }
              }}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs leading-none transition-colors ${
                address
                  ? "border-slate-700/40 bg-slate-950/20 text-slate-200/85 hover:border-slate-600/50 hover:text-slate-100"
                  : "border-slate-700/40 bg-slate-950/20 text-slate-300/75 hover:border-slate-600/50 hover:text-slate-200"
              }`}
            >
              {address ? (
                <>
                  <span
                    className={`h-[5px] w-[5px] rounded-full ${
                      isWrongNetwork
                        ? "bg-amber-400/75"
                        : "bg-emerald-400/75"
                    }`}
                  />
                  <span className="font-mono text-[13px] font-medium tracking-[0.01em]">{shortAddress}</span>
                  <svg
                    className="h-2 w-2 text-slate-400/80"
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
              <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-lg bg-[#090f1d] shadow-[0_24px_60px_rgba(0,0,0,0.46)]">
                <div className="px-5 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-[16px] font-medium tracking-[0.012em] text-slate-100">
                        {shortAddress}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[12px] font-medium tracking-[0.01em] text-slate-300/70">
                        <span
                          className={`h-[4px] w-[4px] rounded-full ${
                            isWrongNetwork ? "bg-amber-400/75" : "bg-emerald-400/75"
                          }`}
                        />
                        <span>Connected</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyAddress}
                      className="inline-flex h-5 w-5 items-center justify-center text-slate-300/60 transition-colors hover:text-slate-100/90"
                      aria-label="Copy wallet address"
                      title={copied ? "Copied" : "Copy address"}
                    >
                      <svg
                        className="h-3 w-3"
                        viewBox="0 0 20 20"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M7 6.5A1.5 1.5 0 0 1 8.5 5h6A1.5 1.5 0 0 1 16 6.5v7A1.5 1.5 0 0 1 14.5 15h-6A1.5 1.5 0 0 1 7 13.5v-7Z"
                          stroke="currentColor"
                          strokeWidth="1.25"
                        />
                        <path
                          d="M4 11.5v-7A1.5 1.5 0 0 1 5.5 3h6"
                          stroke="currentColor"
                          strokeWidth="1.25"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="mx-5 my-3.5 h-px bg-white/[0.09]" />
                <div className="space-y-2.5 px-5 pb-4">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onSwitchWallet?.();
                    }}
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-normal text-slate-300/95 transition-colors hover:bg-slate-800/38 hover:text-slate-100 active:bg-slate-700/45"
                  >
                    <svg
                      className="h-[14px] w-[14px] text-slate-300/60"
                      viewBox="0 0 20 20"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M3.5 6.5A1.5 1.5 0 0 1 5 5h10a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 15 15H5a1.5 1.5 0 0 1-1.5-1.5v-7Z"
                        stroke="currentColor"
                        strokeWidth="1.25"
                      />
                      <path
                        d="M12 10h2"
                        stroke="currentColor"
                        strokeWidth="1.25"
                        strokeLinecap="round"
                      />
                    </svg>
                    Switch wallet
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onDisconnect?.();
                    }}
                    className="flex h-9 w-full items-center rounded-lg px-3 text-left text-sm font-normal text-slate-300/90 transition-colors hover:bg-rose-400/[0.04] hover:text-rose-300/80 active:bg-rose-400/[0.06]"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
