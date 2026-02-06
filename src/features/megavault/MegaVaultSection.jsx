import React, { useEffect, useMemo, useRef } from "react";
import { MegaVaultPositionWidget } from "@avon_xyz/widget";
import { useAccount, useConnect, useReconnect } from "wagmi";
import { getActiveNetworkConfig } from "../../shared/config/networks";
import megaLogo from "../../tokens/megaeth.png";

export default function MegaVaultSection({ address, onConnectWallet }) {
  const activeNetwork = useMemo(() => getActiveNetworkConfig(), []);
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const chainId = useMemo(() => {
    const hex = activeNetwork?.chainIdHex || "0x10e6";
    const parsed = Number.parseInt(hex, 16);
    return Number.isFinite(parsed) ? parsed : 4326;
  }, [activeNetwork]);
  const safeReferrer = ZERO_ADDRESS;
  const { isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { reconnect } = useReconnect();
  const wagmiConnectAttempted = useRef(false);

  useEffect(() => {
    if (!address || isConnected) return;
    reconnect();
  }, [address, isConnected, reconnect]);
  useEffect(() => {
    if (!address || isConnected || wagmiConnectAttempted.current) return;
    const connector =
      connectors.find((item) => item?.type === "injected") || connectors[0];
    if (!connector) return;
    wagmiConnectAttempted.current = true;
    connectAsync({ connector }).catch(() => {
      wagmiConnectAttempted.current = false;
    });
  }, [address, isConnected, connectors, connectAsync]);

  const handleConnectWallet = () => {
    if (typeof onConnectWallet === "function") {
      onConnectWallet();
    }
  };

  return (
    <section className="px-4 sm:px-6 py-6">
      <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70 shadow-[0_40px_80px_-55px_rgba(2,6,23,0.9)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(14,165,233,0.08),transparent_65%)]" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,0.92fr),minmax(0,1.08fr)] p-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.3em] border border-sky-500/40 bg-sky-500/10 text-sky-100">
                MegaVault
              </span>
              <span className="flex items-center justify-center rounded-full border border-slate-700 bg-slate-900/70 p-0.5">
                <img src={megaLogo} alt="MegaETH" className="h-[22px] w-[22px]" />
              </span>
            </div>

            <div>
              <div className="text-3xl font-semibold text-slate-100">
                Avon MegaVault
              </div>
              <div className="mt-2 text-sm text-slate-400 leading-relaxed">
                Deposit and withdraw without leaving CurrentX.
              </div>
            </div>

            <div className="grid gap-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  Stablecoin Drain
                </div>
                <div className="mt-1 text-sm text-slate-200">
                  Legacy issuers capture treasury yield offchain. MegaETH keeps value onchain with
                  USDm and USDmY.
                </div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  USDm + USDmY
                </div>
                <div className="mt-1 text-sm text-slate-200">
                  USDm is the native settlement dollar. Deposit into MegaVault to mint USDmY, a
                  yield-bearing and composable asset.
                </div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  Yield Model
                </div>
                <div className="mt-1 text-sm text-slate-200">
                  Yield comes from onchain activity: lending, liquidity, and credit markets.
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                  <span className="px-2 py-1 rounded-full border border-slate-700 bg-slate-950/70">
                    Phase 1: 100% to users + LPs
                  </span>
                  <span className="px-2 py-1 rounded-full border border-slate-700 bg-slate-950/70">
                    Phase 2: fee up to 10%
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-200">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Widget ready
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-[11px] text-slate-300">
                Network: {activeNetwork?.label || "Mainnet"}
              </span>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end">
            <div className="w-full max-w-[460px] lg:min-w-[420px]">
              <MegaVaultPositionWidget
                chainId={chainId}
                referrerAddress={safeReferrer}
                appName="CurrentX"
                onConnectWallet={handleConnectWallet}
                widgetBackground="#0b1220"
                borderColor="#1e293b"
                textPrimary="#f8fafc"
                textSecondary="#cbd5e1"
                accent="#38bdf8"
                accentSecondary="#0ea5e9"
                tagBackground="#0f172a"
                tabActiveBackground="#0ea5e9"
                tabActiveText="#ffffff"
                tabInactiveBackground="#0f172a"
                tabInactiveText="#cbd5e1"
                tabListBackground="#0b1220"
                inputCardBackground="#0f172a"
                secondaryCardBackground="#0f172a"
                secondaryCardHeading="#e2e8f0"
                secondaryCardSubheading="#94a3b8"
                actionButtonBackground="#0284c7"
                actionButtonText="#ffffff"
                secondaryButtonBackground="#1e293b"
                secondaryButtonText="#e2e8f0"
                sliderTrackBackground="#334155"
                sliderThumbBackground="#38bdf8"
                sliderTooltipBackground="#0f172a"
                sliderTooltipText="#f8fafc"
                success="#34d399"
                error="#f87171"
                pending="#38bdf8"
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
