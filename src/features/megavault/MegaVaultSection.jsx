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
          <div className="flex flex-col gap-4">
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
                Deposit and withdraw without leaving CurrentX.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-300">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-200">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Widget ready
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1 text-[11px] text-neutral-300">
                Network: {activeNetwork?.label || "Mainnet"}
              </span>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end">
            <div className="w-full max-w-[460px] lg:min-w-[420px]">
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
                success="#51c288"
                error="#bd2828"
                pending="#ffffff"
                primaryFontClass=""
                secondaryFontClass="font-supply-mono"
                borderRadius="12px"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
