import React, { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Circle, Copy, RefreshCw } from "lucide-react";
import { EXPLORER_BASE_URL } from "../../../shared/config/addresses";

interface ActivityItem {
  id: string;
  blockNumber: number;
  timestamp: number | null;
  txHash: string;
  eventType: string;
  positionId: string;
  details: string;
}

interface AlmActivityPanelProps {
  loading: boolean;
  items: ActivityItem[];
  copiedValue: string;
  onCopy: (value: string) => void;
  onRefresh: (mode?: "initial" | "manual" | "poll") => void;
}

type EventFilter = "all" | "Deposited" | "Withdrawn" | "Rotated" | "DustUpdated" | "RebalanceSkipped" | "SwapToTarget";

const formatDateTime = (timestampSec: number | null) => {
  if (!timestampSec || !Number.isFinite(timestampSec)) return "--";
  return new Date(timestampSec * 1000).toLocaleString();
};

const formatRelativeTime = (timestampSec: number | null) => {
  if (!timestampSec || !Number.isFinite(timestampSec)) return "--";
  const now = Math.floor(Date.now() / 1000);
  const delta = now - timestampSec;
  if (delta <= 0) return "just now";
  if (delta < 60) return `${delta}s ago`;
  const minutes = Math.floor(delta / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const shortenAddress = (value: string, start = 6, end = 4) => {
  if (!value) return "--";
  if (value.length <= start + end) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
};

const EVENT_META: Record<
  string,
  {
    label: string;
    description: string;
    className: string;
    Icon: typeof Circle;
  }
> = {
  Deposited: {
    label: "Deposited",
    description: "NFT deposited into ALM and strategy attached.",
    className: "border-emerald-400/45 bg-emerald-500/12 text-emerald-100",
    Icon: Circle,
  },
  Withdrawn: {
    label: "Withdrawn",
    description: "Position withdrawn from ALM back to wallet.",
    className: "border-amber-400/45 bg-amber-500/12 text-amber-100",
    Icon: ArrowLeftRight,
  },
  Rotated: {
    label: "Rotated",
    description: "Liquidity range rotated during rebalance execution.",
    className: "border-cyan-400/45 bg-cyan-500/12 text-cyan-100",
    Icon: RefreshCw,
  },
  DustUpdated: {
    label: "Dust Updated",
    description: "Dust balances changed after operation settlement.",
    className: "border-sky-400/45 bg-sky-500/12 text-sky-100",
    Icon: Circle,
  },
  RebalanceSkipped: {
    label: "Rebalance Skipped",
    description: "Keeper skipped rebalance because safety checks were not met.",
    className: "border-rose-400/45 bg-rose-500/12 text-rose-100",
    Icon: AlertTriangle,
  },
  SwapToTarget: {
    label: "Swap to Target",
    description: "Swap executed to restore target ratio after deviation beyond deadband.",
    className: "border-violet-400/45 bg-violet-500/12 text-violet-100",
    Icon: ArrowLeftRight,
  },
};

const resolveEventMeta = (eventType: string) =>
  EVENT_META[eventType] || {
    label: eventType,
    description: "Event details are available in the transaction.",
    className: "border-slate-700/70 bg-slate-900/70 text-slate-200",
    Icon: Circle,
  };

export default function AlmActivityPanel({ loading, items, copiedValue, onCopy, onRefresh }: AlmActivityPanelProps) {
  const [filter, setFilter] = useState<EventFilter>("all");

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((item) => item.eventType === filter);
  }, [filter, items]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-slate-100">Activity Log</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as EventFilter)}
            className="rounded-lg border border-slate-700/70 bg-slate-900/70 px-2 py-1 text-xs text-slate-200"
          >
            <option value="all">All events</option>
            <option value="Deposited">Deposited</option>
            <option value="Withdrawn">Withdrawn</option>
            <option value="Rotated">Rotated</option>
            <option value="DustUpdated">Dust Updated</option>
            <option value="RebalanceSkipped">Rebalance Skipped</option>
            <option value="SwapToTarget">Swap to Target</option>
          </select>
          <button
            type="button"
            onClick={() => onRefresh("manual")}
            className="inline-flex items-center gap-1 rounded-full border border-slate-700/70 bg-slate-900/70 px-3 py-1 text-xs text-slate-200 hover:border-slate-500"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-2 md:hidden">
        {loading && filteredItems.length === 0 && (
          <>
            <div className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/45" />
            <div className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/45" />
          </>
        )}

        {!loading && filteredItems.length === 0 && (
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/45 px-4 py-4 text-sm text-slate-400">
            No activity for the selected filter.
          </div>
        )}

        {filteredItems.map((item) => {
          const meta = resolveEventMeta(item.eventType);
          const Icon = meta.Icon;
          return (
            <details key={item.id} className="rounded-2xl border border-slate-800/80 bg-slate-900/45 px-3 py-2">
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${meta.className}`}
                    title={meta.description}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-slate-500">Block {item.blockNumber}</span>
                </div>
                <div className="mt-1 text-xs text-slate-300" title={formatDateTime(item.timestamp)}>
                  {formatRelativeTime(item.timestamp)}
                </div>
              </summary>
              <div className="mt-2 space-y-2 text-xs text-slate-300">
                <div>
                  Position:{" "}
                  <button
                    type="button"
                    onClick={() => onCopy(item.positionId)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700/70 bg-slate-900/70 px-2 py-0.5 text-[11px] hover:border-slate-500"
                  >
                    <Copy className="h-3 w-3" />
                    {copiedValue === item.positionId ? "Copied" : `#${item.positionId}`}
                  </button>
                </div>
                <div title={meta.description}>Details: {item.details || "--"}</div>
                <div className="flex items-center gap-1">
                  <a
                    href={`${EXPLORER_BASE_URL}/tx/${item.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] text-sky-200 underline decoration-dotted underline-offset-2"
                  >
                    {shortenAddress(item.txHash, 10, 8)}
                  </a>
                  <button
                    type="button"
                    onClick={() => onCopy(item.txHash)}
                    className="inline-flex items-center rounded-md border border-slate-700/70 bg-slate-900/70 p-1 text-slate-300 hover:border-slate-500"
                    aria-label="Copy tx hash"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </details>
          );
        })}
      </div>

      <div className="mt-3 hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-500">
              <th className="px-2 py-2 font-medium uppercase tracking-wide">Time</th>
              <th className="px-2 py-2 font-medium uppercase tracking-wide">Event</th>
              <th className="px-2 py-2 font-medium uppercase tracking-wide">Position</th>
              <th className="px-2 py-2 font-medium uppercase tracking-wide">Details</th>
              <th className="px-2 py-2 font-medium uppercase tracking-wide">Tx</th>
            </tr>
          </thead>
          <tbody>
            {loading && filteredItems.length === 0 && (
              <>
                <tr className="border-b border-slate-900">
                  <td className="px-2 py-3"><div className="h-4 w-28 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-24 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-20 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-32 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-24 animate-pulse rounded bg-slate-800/90" /></td>
                </tr>
                <tr>
                  <td className="px-2 py-3"><div className="h-4 w-28 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-24 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-20 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-32 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-24 animate-pulse rounded bg-slate-800/90" /></td>
                </tr>
              </>
            )}

            {!loading && filteredItems.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-sm text-slate-400">
                  No activity for the selected filter.
                </td>
              </tr>
            )}

            {filteredItems.map((item) => {
              const meta = resolveEventMeta(item.eventType);
              const Icon = meta.Icon;
              return (
                <tr key={item.id} className="border-b border-slate-900/70 text-slate-300">
                  <td className="px-2 py-2" title={formatDateTime(item.timestamp)}>
                    <div>{formatRelativeTime(item.timestamp)}</div>
                    <div className="text-[11px] text-slate-500">Block {item.blockNumber}</div>
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${meta.className}`}
                      title={meta.description}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onCopy(item.positionId)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700/70 bg-slate-900/70 px-2 py-0.5 text-[11px] hover:border-slate-500"
                    >
                      <Copy className="h-3 w-3" />
                      {copiedValue === item.positionId ? "Copied" : `#${item.positionId}`}
                    </button>
                  </td>
                  <td className="px-2 py-2 text-[11px] text-slate-400" title={meta.description}>{item.details || "--"}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1">
                      <a
                        href={`${EXPLORER_BASE_URL}/tx/${item.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] text-sky-200 underline decoration-dotted underline-offset-2"
                      >
                        {shortenAddress(item.txHash, 10, 8)}
                      </a>
                      <button
                        type="button"
                        onClick={() => onCopy(item.txHash)}
                        className="inline-flex items-center rounded-md border border-slate-700/70 bg-slate-900/70 p-1 text-slate-300 hover:border-slate-500"
                        aria-label="Copy tx hash"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
