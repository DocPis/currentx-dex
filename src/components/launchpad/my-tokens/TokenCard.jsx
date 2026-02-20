import React, { useMemo, useState } from "react";
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
  vaultStatusLabel,
  vaultStatusTone,
  lpLocked,
  walletBalanceLabel,
  walletSupplyPctLabel,
  totalSupplyLabel,
  priceLabel,
  mcapLabel,
  liquidityLabel,
  volume24hLabel,
  vaultAmountLabel,
  vaultEndLabel,
  vaultRemainingLabel,
  vaultAdminLabel,
  positionId,
  marketDataLabel,
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const vaultRows = useMemo(
    () =>
      [
        { key: "amount", label: "Locked amount", value: vaultAmountLabel },
        { key: "unlock", label: "Unlock date", value: vaultEndLabel },
        { key: "remaining", label: "Remaining", value: vaultRemainingLabel },
        { key: "admin", label: "Admin", value: vaultAdminLabel },
      ].filter((row) => !hideRow(row.value)),
    [vaultAdminLabel, vaultAmountLabel, vaultEndLabel, vaultRemainingLabel]
  );

  const lpRows = useMemo(
    () =>
      [
        { key: "position", label: "Position ID", value: positionId },
        { key: "market", label: "Market data", value: marketDataLabel },
      ].filter((row) => !hideRow(row.value)),
    [marketDataLabel, positionId]
  );

  return (
    <article className="rounded-xl border border-slate-700/60 bg-slate-900/45 p-3">
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
            label={`Vault ${vaultStatusLabel || "No lock"}`}
            tone={vaultStatusTone || "neutral"}
            icon={<Lock className="h-3.5 w-3.5" aria-hidden />}
            title={`Vault status: ${vaultStatusLabel || "No lock"}`}
          />
          {lpLocked ? (
            <LpLockedBadge />
          ) : (
            <StatusBadge label="LP open" tone="neutral" title="LP not locked" />
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-700/55 bg-slate-900/30 p-2">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400/90">Holdings</div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <StatItem label="Your balance" value={walletBalanceLabel} />
            <StatItem label="% supply (you)" value={walletSupplyPctLabel} />
            <StatItem label="Total supply" value={totalSupplyLabel} />
          </div>
        </div>

        <div className="rounded-lg border border-slate-700/55 bg-slate-900/30 p-2">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400/90">Market</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <StatItem label="Price" value={priceLabel} />
            <StatItem label="MCap" value={mcapLabel} />
            <StatItem label="Liquidity" value={liquidityLabel} />
            <StatItem label="Volume 24h" value={volume24hLabel} />
          </div>
        </div>
      </div>

      <TokenActions detailsOpen={detailsOpen} onToggleDetails={() => setDetailsOpen((prev) => !prev)} />

      {detailsOpen ? (
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-700/55 bg-slate-900/30 p-2 text-xs">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400/90">Creator vault</div>
            {vaultRows.length ? (
              <div className="space-y-1.5">
                {vaultRows.map((row) => (
                  <div key={row.key} className="flex items-start justify-between gap-2">
                    <span className="text-slate-400/80">{row.label}</span>
                    <span className="max-w-[70%] truncate text-right text-slate-100" title={String(row.value || "")}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-400/80">No vault details available.</div>
            )}
          </div>

          <div className="rounded-lg border border-slate-700/55 bg-slate-900/30 p-2 text-xs">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400/90">LP locker</div>
            {lpRows.length ? (
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
            ) : (
              <div className="text-slate-400/80">No LP details available.</div>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

