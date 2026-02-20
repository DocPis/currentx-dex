import React, { useMemo } from "react";
import { Copy, ExternalLink, Lock } from "lucide-react";
import LpLockedBadge from "../LpLockedBadge";
import StatusBadge from "./StatusBadge";
import StatItem from "./StatItem";
import TokenActions from "./TokenActions";

const hideRow = (value) => {
  const text = String(value || "").trim();
  return !text || text === "--";
};

export default function TokenCard({
  name,
  symbol,
  logo,
  tokenAddress,
  shortAddress,
  explorerHref,
  explorerLabel,
  copiedAddress,
  onCopyAddress,
  vaultStatusValue,
  lpLocked,
  walletBalanceLabel,
  walletBalanceTitle,
  walletSupplyPctLabel,
  totalSupplyLabel,
  totalSupplyTitle,
  positionLabel,
  positionTitle,
  priceLabel,
  priceTitle,
  mcapLabel,
  mcapTitle,
  liquidityLabel,
  liquidityTitle,
  volume24hLabel,
  volume24hTitle,
  vaultAmountLabel,
  vaultAmountTitle,
  vaultEndLabel,
  vaultRemainingLabel,
  vaultAdminLabel,
  detailsOpen,
  onToggleDetails,
  marketDataLabel,
}) {
  const vaultLocked = vaultStatusValue === "active";
  const vaultStatusLabel = vaultLocked ? "Vault: locked" : "Vault: none";

  const vaultRows = useMemo(
    () =>
      [
        { key: "amount", label: "Locked amount", value: vaultAmountLabel, title: vaultAmountTitle || vaultAmountLabel },
        { key: "unlock", label: "Unlock date", value: vaultEndLabel },
        { key: "remaining", label: "Remaining", value: vaultRemainingLabel },
        { key: "admin", label: "Admin", value: vaultAdminLabel },
      ].filter((row) => !hideRow(row.value)),
    [vaultAdminLabel, vaultAmountLabel, vaultAmountTitle, vaultEndLabel, vaultRemainingLabel]
  );

  const lpRows = useMemo(
    () =>
      [
        { key: "market", label: "Market data", value: marketDataLabel },
      ].filter((row) => !hideRow(row.value)),
    [marketDataLabel]
  );
  const hasDetails = vaultRows.length > 0 || lpRows.length > 0;

  return (
    <article className="overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/45 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-full border border-slate-700/70 bg-slate-900/70">
              {logo ? (
                <img src={logo} alt={`${symbol || "TOKEN"} logo`} className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs font-semibold text-slate-200">
                  {String(symbol || "T")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-sm font-semibold text-slate-100" title={name || "Token"}>
                  {name || "Token"}
                </div>
                <div className="max-w-[7rem] truncate text-xs text-slate-300/80" title={symbol || "TOKEN"}>
                  {symbol || "TOKEN"}
                </div>
              </div>

              <div className="mt-1 flex min-w-0 items-center gap-1">
                <span className="truncate font-mono text-xs text-slate-300/90" title={tokenAddress || ""}>
                  {shortAddress || "--"}
                </span>
                {onCopyAddress ? (
                  <button
                    type="button"
                    onClick={onCopyAddress}
                    title={copiedAddress ? "Copied" : "Copy address"}
                    className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-md text-slate-300/80 transition hover:bg-slate-800/70 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
                    aria-label={copiedAddress ? "Address copied" : "Copy token address"}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
                {explorerHref ? (
                  <a
                    href={explorerHref}
                    target="_blank"
                    rel="noreferrer"
                    title={`View on ${explorerLabel || "explorer"}`}
                    className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-md text-slate-300/80 transition hover:bg-slate-800/70 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
                    aria-label={`View ${symbol || "token"} on ${explorerLabel || "explorer"}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-none items-center gap-1">
          <StatusBadge
            label={vaultStatusLabel}
            tone={vaultLocked ? "good" : "neutral"}
            icon={vaultLocked ? <Lock className="h-3.5 w-3.5" aria-hidden /> : null}
            title={`Vault status: ${vaultStatusLabel || "No lock"}`}
          />
          {lpLocked ? <LpLockedBadge /> : <StatusBadge label="LP: —" tone="neutral" title="LP not locked" />}
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-700/55 bg-slate-900/30 p-2">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400/90">Holdings</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <StatItem label="Your balance" value={walletBalanceLabel} valueTitle={walletBalanceTitle} />
            <StatItem label="% supply (you)" value={walletSupplyPctLabel} />
            <StatItem label="Total supply" value={totalSupplyLabel} valueTitle={totalSupplyTitle} />
            <StatItem label="Position ID" value={positionLabel} valueTitle={positionTitle} />
          </div>
        </div>

        <div className="rounded-lg border border-slate-700/55 bg-slate-900/30 p-2">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400/90">Market</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <StatItem label="Price" value={priceLabel} valueTitle={priceTitle} />
            <StatItem label="MCap" value={mcapLabel} valueTitle={mcapTitle} />
            <StatItem label="Liquidity" value={liquidityLabel} valueTitle={liquidityTitle} />
            <StatItem label="Volume 24h" value={volume24hLabel} valueTitle={volume24hTitle} />
          </div>
        </div>
      </div>

      {hasDetails ? <TokenActions detailsOpen={detailsOpen} onToggleDetails={onToggleDetails} /> : null}

      {detailsOpen && hasDetails ? (
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          {vaultRows.length ? (
            <div className="rounded-lg border border-slate-700/55 bg-slate-900/30 p-2 text-xs">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400/90">Creator vault</div>
              <div className="space-y-1.5">
                {vaultRows.map((row) => (
                  <div key={row.key} className="flex items-start justify-between gap-2">
                    <span className="text-slate-400/80">{row.label}</span>
                    <span
                      className="max-w-[70%] truncate text-right text-slate-100"
                      title={String(row.title || row.value || "")}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {lpRows.length ? (
            <div className="rounded-lg border border-slate-700/55 bg-slate-900/30 p-2 text-xs">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400/90">LP locker</div>
              <div className="space-y-1.5">
                {lpRows.map((row) => (
                  <div key={row.key} className="flex items-start justify-between gap-2">
                    <span className="text-slate-400/80">{row.label}</span>
                    <span className="max-w-[70%] truncate text-right text-slate-100" title={String(row.value || "")}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
