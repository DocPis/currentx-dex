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
      <div className="relative overflow-hidden rounded-3xl border border-slate-800/70 bg-[#070b1b] shadow-[0_40px_80px_-50px_rgba(56,189,248,0.45)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.22),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(14,165,233,0.12),transparent_60%)]" />
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-sky-500/15 blur-3xl" />
        <div className="absolute -left-28 bottom-0 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,0.92fr),minmax(0,1.08fr)] p-6">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.3em] border border-sky-500/50 bg-sky-500/10 text-sky-200">
                MegaVault
              </span>
              <span className="px-3 py-1 rounded-full text-[10px] uppercase tracking-wide border border-slate-700 bg-slate-900/80 text-slate-300">
                {activeNetwork?.name || "MegaETH"}
              </span>
              <span className="px-3 py-1 rounded-full text-[10px] uppercase tracking-wide border border-slate-700 bg-slate-900/80 text-slate-300">
                Chain {chainId}
              </span>
            </div>

            <div>
              <div className="text-3xl font-semibold text-slate-100">
                Avon MegaVault
              </div>
              <div className="mt-2 text-sm text-slate-400 leading-relaxed">
                Deposit and withdraw without leaving CurrentX. Your vault position stays visible
                while you keep trading, and the wallet connection stays unified with the rest of the app.
              </div>
            </div>

            <div className="grid gap-2">
              {[
                "Single panel for deposits + withdrawals.",
                "Live position view, aligned with CurrentX UI.",
                "Wallet connect handled by your existing modal.",
              ].map((copy) => (
                <div key={copy} className="flex items-center gap-2 text-sm text-slate-200">
                  <span className="h-7 w-7 rounded-full border border-sky-500/40 bg-sky-500/10 text-sky-200 flex items-center justify-center text-xs shadow-inner shadow-black/40">
                    ✓
                  </span>
                  <span>{copy}</span>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Status
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-100">
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Widget ready
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-[11px] text-slate-300">
                  Network: {activeNetwork?.label || "Mainnet"}
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Powered by Avon MegaVault on {activeNetwork?.name || "MegaETH"}.
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800/70 bg-[#0b1226]/80 p-4 shadow-[0_22px_60px_-35px_rgba(56,189,248,0.6)]">
            <MegaVaultPositionWidget
              chainId={chainId}
              appName="CurrentX"
              onConnectWallet={handleConnectWallet}
              widgetBackground="#0b1226"
              borderColor="#1c2a48"
              textPrimary="#e8f1ff"
              textSecondary="rgba(232, 241, 255, 0.72)"
              accent="#38bdf8"
              accentSecondary="#22d3ee"
              tagBackground="rgba(56, 189, 248, 0.2)"
              tabActiveBackground="#38bdf8"
              tabActiveText="#04101f"
              tabInactiveBackground="#0f1a34"
              tabInactiveText="#b9c7e6"
              tabListBackground="#0b152e"
              inputCardBackground="#0f1b36"
              secondaryCardBackground="#0f1b36"
              secondaryCardHeading="#d2def5"
              secondaryCardSubheading="#9fb1d8"
              actionButtonBackground="#38bdf8"
              actionButtonText="#04101f"
              secondaryButtonBackground="rgba(15, 23, 42, 0.85)"
              secondaryButtonText="#e8f1ff"
              sliderTrackBackground="#152446"
              sliderThumbBackground="#38bdf8"
              sliderTooltipBackground="#38bdf8"
              sliderTooltipText="#04101f"
              success="#34d399"
              error="#f87171"
              pending="#fbbf24"
              primaryFontClass=""
              secondaryFontClass="font-supply-mono"
              shadow="0 24px 60px rgba(3, 12, 30, 0.7)"
              borderRadius="16px"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
