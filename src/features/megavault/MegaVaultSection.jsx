import React, { useEffect, useMemo } from "react";
import { MegaVaultPositionWidget } from "@avon_xyz/widget";
import { useAccount, useReconnect } from "wagmi";
import { getActiveNetworkConfig } from "../../shared/config/networks";

export default function MegaVaultSection({ address, onConnectWallet }) {
  const activeNetwork = useMemo(() => getActiveNetworkConfig(), []);
  const chainId = useMemo(() => {
    const hex = activeNetwork?.chainIdHex || "0x10e6";
    const parsed = Number.parseInt(hex, 16);
    return Number.isFinite(parsed) ? parsed : 4326;
  }, [activeNetwork]);
  const { isConnected } = useAccount();
  const { reconnect } = useReconnect();

  useEffect(() => {
    if (!address || isConnected) return;
    reconnect();
  }, [address, isConnected, reconnect]);

  const handleConnectWallet = () => {
    if (typeof onConnectWallet === "function") {
      onConnectWallet();
    }
  };

  return (
    <section className="px-4 sm:px-6 py-6">
      <div className="relative overflow-hidden rounded-3xl border border-slate-800/80 bg-[#050816] shadow-xl shadow-black/40">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_55%)]" />
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,0.9fr),minmax(0,1.1fr)] p-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wide border border-sky-500/40 bg-sky-500/10 text-sky-200">
                MegaVault
              </span>
              <span className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wide border border-slate-700 bg-slate-900/70 text-slate-300">
                {activeNetwork?.name || "MegaETH"}
              </span>
              <span className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wide border border-slate-700 bg-slate-900/70 text-slate-300">
                Chain {chainId}
              </span>
            </div>

            <div>
              <div className="text-2xl font-semibold text-slate-100">
                Avon MegaVault on CurrentX
              </div>
              <div className="mt-2 text-sm text-slate-400">
                Deposit and withdraw from the Avon MegaVault without leaving your trading flow.
                Keep your position visible while you manage liquidity across CurrentX.
              </div>
            </div>

            <div className="grid gap-2">
              {[
                "Single widget to manage deposits and withdrawals.",
                "Live position view inside your CurrentX layout.",
                "Wallet connect handled by your existing modal.",
              ].map((copy) => (
                <div key={copy} className="flex items-center gap-2 text-sm text-slate-200">
                  <span className="h-6 w-6 rounded-full border border-sky-500/40 bg-sky-500/10 text-sky-200 flex items-center justify-center text-xs">
                    ✓
                  </span>
                  <span>{copy}</span>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Status
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-100">
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Widget ready
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-[11px] text-slate-300">
                  Network: {activeNetwork?.label || "Mainnet"}
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Powered by Avon MegaVault on {activeNetwork?.name || "MegaETH"}.
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800/80 bg-slate-900/60 p-4 shadow-[0_20px_50px_-30px_rgba(56,189,248,0.65)]">
            <MegaVaultPositionWidget
              chainId={chainId}
              appName="CurrentX"
              onConnectWallet={handleConnectWallet}
              widgetBackground="#0a1122"
              borderColor="#1f2a44"
              textPrimary="#e2e8f0"
              textSecondary="rgba(226, 232, 240, 0.7)"
              accent="#38bdf8"
              accentSecondary="#22d3ee"
              tabActiveBackground="#38bdf8"
              tabActiveText="#03101f"
              inputCardBackground="#0d1933"
              actionButtonBackground="#38bdf8"
              actionButtonText="#03101f"
              secondaryButtonBackground="rgba(255, 255, 255, 0.08)"
              secondaryButtonText="#e2e8f0"
              sliderTrackBackground="#0d1933"
              sliderThumbBackground="#38bdf8"
              sliderTooltipBackground="#38bdf8"
              sliderTooltipText="#03101f"
              primaryFontClass=""
              secondaryFontClass=""
              success="#34d399"
              error="#f87171"
              pending="#facc15"
              shadow="0 24px 70px rgba(4, 15, 35, 0.7)"
              borderRadius="16px"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
