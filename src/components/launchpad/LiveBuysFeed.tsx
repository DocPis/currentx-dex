import React from "react";
import { EXPLORER_BASE_URL } from "../../shared/config/web3";
import type { LaunchpadTrade } from "../../services/launchpad/types";
import { formatTokenAmount, formatUsd, shortAddress, toTimeAgo } from "../../services/launchpad/utils";

interface LiveBuysFeedProps {
  items: LaunchpadTrade[];
  isLoading?: boolean;
  mode?: "idle" | "ws" | "polling";
  onSelectToken?: (tokenAddress: string) => void;
  title?: string;
}

const heatClass = (amountUSD: number) => {
  if (amountUSD >= 5000) return "bg-rose-400";
  if (amountUSD >= 1500) return "bg-amber-400";
  return "bg-emerald-400";
};

const tradeKey = (item: LaunchpadTrade, index: number) => {
  const eventId = String(item?.eventId || "").trim().toLowerCase();
  if (eventId) return eventId;
  return [
    String(item?.txHash || "").trim().toLowerCase(),
    String(item?.tokenAddress || "").trim().toLowerCase(),
    String(item?.timestamp || "").trim(),
    String(item?.side || "").trim(),
    String(Number(item?.amountUSD || 0)),
    String(item?.amountOut || "").trim(),
    String(Math.floor(Number(item?.blockNumber || 0))),
    String(index),
  ].join(":");
};

const LiveBuysFeed = ({
  items,
  isLoading = false,
  mode = "idle",
  onSelectToken,
  title = "Live buys",
}: LiveBuysFeedProps) => {
  return (
    <aside className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4 shadow-[0_14px_34px_rgba(2,6,23,0.45)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-slate-100">{title}</h3>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            mode === "ws"
              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
              : mode === "polling"
              ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
              : "border-slate-700/70 bg-slate-900/70 text-slate-400"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${mode === "idle" ? "bg-slate-500" : "bg-emerald-400 animate-pulse"}`} />
          {mode === "ws" ? "Live" : mode === "polling" ? "Polling" : "Offline"}
        </span>
      </div>

      {isLoading && !items.length ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={`live-buys-skeleton-${index}`} className="h-12 rounded-xl bg-slate-900/70 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {items.map((item, index) => (
            <div
              key={tradeKey(item, index)}
              className="rounded-xl border border-slate-800/70 bg-slate-900/55 px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onSelectToken?.(item.tokenAddress)}
                  className="text-left text-slate-200 transition hover:text-sky-300"
                >
                  {item.tokenSymbol
                    ? `$${item.tokenSymbol}`
                    : item.tokenName || shortAddress(item.tokenAddress)}
                </button>
                <span className="text-[10px] text-slate-500">{toTimeAgo(item.timestamp)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-slate-300">{shortAddress(item.buyer)}</span>
                <span className="font-semibold text-emerald-300">{formatUsd(item.amountUSD)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-slate-500">{formatTokenAmount(item.amountOut)} out</span>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${heatClass(item.amountUSD)}`} />
                  <a
                    href={`${EXPLORER_BASE_URL}/tx/${item.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-semibold text-sky-300 hover:text-sky-200"
                  >
                    Tx
                  </a>
                </div>
              </div>
            </div>
          ))}
          {!items.length && (
            <div className="rounded-xl border border-slate-800/70 bg-slate-900/55 px-3 py-6 text-center text-xs text-slate-400">
              No buy activity yet.
            </div>
          )}
        </div>
      )}
    </aside>
  );
};

export default React.memo(LiveBuysFeed);
