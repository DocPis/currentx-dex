// src/features/wallet/WalletModal.jsx
import React, { useMemo } from "react";

import metamaskIcon from "../../assets/wallets/metamask.png";
import rabbyIcon from "../../assets/wallets/rabby.png";
import trustIcon from "../../assets/wallets/trustwallet.png";
import { getInjectedProviderByType } from "../../shared/config/web3";

const isMobileBrowser = () =>
  typeof navigator !== "undefined" &&
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );

const wallets = [
  {
    id: "trustwallet",
    name: "Trust Wallet",
    description: "Mobile & browser extension",
    logo: trustIcon,
  },
  { id: "metamask", name: "MetaMask", logo: metamaskIcon },
  { id: "rabby", name: "Rabby Wallet", logo: rabbyIcon },
];

export default function WalletModal({
  open,
  onClose,
  onSelectWallet,
}) {
  const isMobile = useMemo(() => isMobileBrowser(), []);
  const trustDeepLink = useMemo(() => {
    if (!open || typeof window === "undefined") return "";
    try {
      const currentUrl = window.location?.href || "";
      if (!currentUrl) return "";
      return `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(
        currentUrl
      )}`;
    } catch {
      return "";
    }
  }, [open]);

  const detected = useMemo(() => {
    if (!open) return {};
    const map = {};
    ["metamask", "rabby", "trustwallet"].forEach((id) => {
      try {
        map[id] = Boolean(getInjectedProviderByType(id));
      } catch {
        map[id] = false;
      }
    });
    return map;
  }, [open]);

  if (!open) return null;

  const openTrustDeepLink = () => {
    if (!trustDeepLink || typeof window === "undefined") return;
    window.location.assign(trustDeepLink);
  };

  const handleSelect = (id) => {
    if (
      id === "trustwallet" &&
      isMobile &&
      !detected.trustwallet &&
      trustDeepLink
    ) {
      openTrustDeepLink();
      return;
    }
    onSelectWallet(id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md mx-4 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">
              Connect a wallet
            </span>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center hover:bg-slate-700"
            aria-label="Close"
          >
            X
          </button>
        </div>

        <div className="p-3 space-y-3 max-h-[75vh] overflow-y-auto">
          {wallets.map((wallet) => (
            <button
              key={wallet.id}
              onClick={() => handleSelect(wallet.id)}
              className={`w-full text-left rounded-2xl border border-slate-800 px-4 py-3 transition hover:border-sky-500/50 hover:shadow-[0_10px_30px_-18px_rgba(56,189,248,0.6)] ${
                wallet.cta
                  ? `bg-gradient-to-r ${wallet.accent} text-white`
                  : "bg-slate-900/60 text-slate-100"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {wallet.logo ? (
                    <img
                      src={wallet.logo}
                      alt={`${wallet.name} logo`}
                      className="h-10 w-10 rounded-xl border border-slate-800 bg-slate-900 object-contain"
                    />
                  ) : (
                    <div
                      className={`h-10 w-10 rounded-xl flex items-center justify-center text-sm font-semibold ${
                        wallet.cta
                          ? "bg-white/15 text-white"
                          : "bg-slate-800 text-slate-100"
                      }`}
                    >
                      {wallet.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="flex flex-col">
                    <span className="font-semibold">{wallet.name}</span>
                    {wallet.description && (
                      <span className="text-xs text-slate-300">
                        {wallet.description}
                      </span>
                    )}
                  </div>
                </div>
                {detected[wallet.id] && (
                  <span className="text-[11px] px-2 py-1 rounded-full bg-slate-800 text-slate-200 border border-slate-700">
                    Detected
                  </span>
                )}
              </div>
            </button>
          ))}
          {isMobile && !detected.trustwallet && trustDeepLink && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-xs text-slate-200 space-y-2">
              <div className="text-sm font-semibold text-slate-50">
                Trust Wallet on mobile
              </div>
              <p className="text-slate-300">
                On iOS, open this page inside the Trust Wallet browser to connect. Tap below to reopen directly in the app.
              </p>
              <button
                type="button"
                onClick={() => {
                  openTrustDeepLink();
                }}
                className="w-full rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold px-3 py-2 transition"
              >
                Open in Trust Wallet
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
