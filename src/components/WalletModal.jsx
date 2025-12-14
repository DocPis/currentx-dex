// src/components/WalletModal.jsx
import React from "react";

const wallets = [
  {
    id: "trustwallet",
    name: "Trust Wallet",
    description: "Mobile & browser extension",
    accent: "from-sky-500 to-indigo-500",
    cta: true,
  },
  { id: "metamask", name: "MetaMask", badge: "Detected" },
  { id: "rabbit", name: "Rabby Wallet", badge: "Detected" },
];

export default function WalletModal({
  open,
  onClose,
  onSelectWallet,
}) {
  if (!open) return null;

  const handleSelect = (id) => {
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
            ✕
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
                  <div
                    className={`h-10 w-10 rounded-xl flex items-center justify-center text-sm font-semibold ${
                      wallet.cta
                        ? "bg-white/15 text-white"
                        : "bg-slate-800 text-slate-100"
                    }`}
                  >
                    {wallet.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-semibold">{wallet.name}</span>
                    {wallet.description && (
                      <span className="text-xs text-slate-300">
                        {wallet.description}
                      </span>
                    )}
                  </div>
                </div>
                {wallet.badge && (
                  <span className="text-[11px] px-2 py-1 rounded-full bg-slate-800 text-slate-200 border border-slate-700">
                    {wallet.badge}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
