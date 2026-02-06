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
      <div className="relative overflow-hidden rounded-3xl border border-neutral-800 bg-[#0b0b0b] shadow-[0_40px_80px_-55px_rgba(0,0,0,0.9)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(255,255,255,0.03),transparent_65%)]" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,0.92fr),minmax(0,1.08fr)] p-6">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.3em] border border-neutral-700/80 bg-neutral-900/80 text-neutral-200">
                MegaVault
              </span>
              <span className="px-3 py-1 rounded-full text-[10px] uppercase tracking-wide border border-neutral-800 bg-neutral-900/60 text-neutral-300">
                {activeNetwork?.name || "MegaETH"}
              </span>
              <span className="px-3 py-1 rounded-full text-[10px] uppercase tracking-wide border border-neutral-800 bg-neutral-900/60 text-neutral-300">
                Chain {chainId}
              </span>
            </div>

            <div>
              <div className="text-3xl font-semibold text-neutral-100">
                Avon MegaVault
              </div>
              <div className="mt-2 text-sm text-neutral-400 leading-relaxed">
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
                <div key={copy} className="flex items-center gap-2 text-sm text-neutral-200">
                  <span className="h-7 w-7 rounded-full border border-neutral-700 bg-neutral-900 text-neutral-100 flex items-center justify-center text-xs shadow-inner shadow-black/40">
                    ✓
                  </span>
                  <span>{copy}</span>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">
                Status
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-100">
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Widget ready
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1 text-[11px] text-neutral-300">
                  Network: {activeNetwork?.label || "Mainnet"}
                </span>
              </div>
              <div className="mt-2 text-[11px] text-neutral-500">
                Powered by Avon MegaVault on {activeNetwork?.name || "MegaETH"}.
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-neutral-800 bg-[#0f0f0f] p-4 shadow-[0_30px_70px_-45px_rgba(0,0,0,0.85)]">
            <MegaVaultPositionWidget
              chainId={chainId}
              appName="CurrentX"
              onConnectWallet={handleConnectWallet}
              widgetBackground="#0d0d0d"
              borderColor="#292929"
              textPrimary="#ffffff"
              textSecondary="#dedede"
              accent="#dedede"
              accentSecondary="#dedede"
              tagBackground="#dedede"
              tabActiveBackground="#ffffff"
              tabActiveText="#000000"
              tabInactiveBackground="#1a1a1a"
              tabInactiveText="#ffffff"
              tabListBackground="#1c1c1c"
              inputCardBackground="#1a1a1a"
              secondaryCardBackground="#1a1a1a"
              secondaryCardHeading="#dedede"
              secondaryCardSubheading="#dedede"
              actionButtonBackground="#ffffff"
              actionButtonText="#000000"
              secondaryButtonBackground="#000000"
              secondaryButtonText="#ffffff"
              sliderTrackBackground="#4f4f4f"
              sliderThumbBackground="#ffffff"
              sliderTooltipBackground="#ffffff"
              sliderTooltipText="#000000"
              success="#2cc479"
              error="#ff7676"
              pending="#ffffff"
              primaryFontClass=""
              secondaryFontClass="font-supply-mono"
              borderRadius="12px"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
