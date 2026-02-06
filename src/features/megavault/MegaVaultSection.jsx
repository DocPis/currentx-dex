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
      <div className="rounded-3xl border border-slate-800/80 bg-slate-900/60 p-5 shadow-xl shadow-black/40">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-100">MegaVault</div>
            <div className="text-xs text-slate-500">
              Deposit or withdraw from the Avon MegaVault without leaving CurrentX.
            </div>
          </div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            Chain {chainId}
          </div>
        </div>

        <div className="mt-5">
          <MegaVaultPositionWidget
            chainId={chainId}
            appName="CurrentX"
            onConnectWallet={handleConnectWallet}
            widgetBackground="#050a1f"
            borderColor="#1e2645"
            textPrimary="#f4f7ff"
            textSecondary="rgba(244, 247, 255, 0.75)"
            accent="#ffb347"
            accentSecondary="#ffcc33"
            tabActiveBackground="#ffb347"
            tabActiveText="#050a1f"
            inputCardBackground="#0b1733"
            actionButtonBackground="#ffb347"
            actionButtonText="#050a1f"
            secondaryButtonBackground="rgba(255, 255, 255, 0.1)"
            secondaryButtonText="#f4f7ff"
            sliderTrackBackground="#0b1733"
            sliderThumbBackground="#ffb347"
            sliderTooltipBackground="#ffb347"
            sliderTooltipText="#050a1f"
            primaryFontClass=""
            secondaryFontClass="font-supply-mono"
            success="#56f1c2"
            error="#ff6b81"
            pending="#ffe066"
            shadow="0 25px 60px rgba(5, 10, 31, 0.55)"
            borderRadius="12px"
          />
        </div>
      </div>
    </section>
  );
}
