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
      <div className="mx-auto max-w-[1280px] relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70 shadow-[0_40px_80px_-55px_rgba(2,6,23,0.9)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.06),transparent_62%)]" />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1.05fr),minmax(0,0.95fr)] p-6">
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
              <div className="text-3xl font-semibold text-slate-100">Avon MegaVault</div>
              <div className="mt-2 text-base text-slate-300 leading-relaxed">
                Convert USDM into USDmY - a yield-bearing composable asset.
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/45 p-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                Yield Source
              </div>
              <div className="mt-2 text-sm text-slate-300">
                Yield accrues from onchain capital deployment:
              </div>
              <ul className="mt-2 space-y-1 text-sm text-slate-100">
                <li>Liquidity provision</li>
                <li>Lending markets</li>
                <li>Credit activity</li>
              </ul>
            </div>

            <div className="h-px bg-slate-800" />

            <div className="rounded-2xl border border-slate-800 bg-slate-900/45 p-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                How it works
              </div>
              <ol className="mt-2 space-y-1.5 text-sm text-slate-100">
                <li>1. Deposit USDM</li>
                <li>2. Receive USDmY (1:1 mint)</li>
                <li>3. USDmY accrues yield automatically</li>
              </ol>
              <div className="mt-3 text-xs text-slate-500">
                No lockup | Fully withdrawable | Variable yield
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/45 p-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                Vault Transparency
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-200">
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2">
                  Non custodial
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2">
                  Onchain strategies
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2">
                  Variable yield
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2">
                  No fixed returns
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300" />
          </div>

          <div className="flex items-start justify-center lg:justify-end">
            <div className="w-full max-w-[560px] lg:min-w-[520px] xl:min-w-[560px] lg:[--spacing:0.275rem] lg:[--text-base:1.08rem] lg:[--text-sm:0.95rem] lg:[--text-xs:0.82rem] lg:[--text-4xl:2.45rem] lg:mt-24">
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
