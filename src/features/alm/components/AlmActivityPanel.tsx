import React from "react";
import { Copy, RefreshCw } from "lucide-react";
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

const formatDateTime = (timestampSec: number | null) => {
  if (!timestampSec || !Number.isFinite(timestampSec)) return "--";
  return new Date(timestampSec * 1000).toLocaleString();
};

const shortenAddress = (value: string, start = 6, end = 4) => {
  if (!value) return "--";
  if (value.length <= start + end) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
};

const eventTone = (eventType: string) => {
  if (eventType === "Deposited" || eventType === "Rotated") {
    return "border-emerald-400/45 bg-emerald-500/12 text-emerald-100";
  }
  if (eventType === "Withdrawn" || eventType === "RebalanceSkipped") {
    return "border-amber-400/45 bg-amber-500/12 text-amber-100";
  }
  return "border-slate-700/70 bg-slate-900/70 text-slate-200";
};

export default function AlmActivityPanel({ loading, items, copiedValue, onCopy, onRefresh }: AlmActivityPanelProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-slate-100">Activity Log</h2>
        <button
          type="button"
          onClick={() => onRefresh("manual")}
          className="inline-flex items-center gap-1 rounded-full border border-slate-700/70 bg-slate-900/70 px-3 py-1 text-xs text-slate-200 hover:border-slate-500"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="mt-3 space-y-2 md:hidden">
        {loading && items.length === 0 && (
          <>
            <div className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/45" />
            <div className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/45" />
          </>
        )}

        {!loading && items.length === 0 && (
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/45 px-4 py-4 text-sm text-slate-400">
            No activity yet.
          </div>
        )}

        {items.map((item) => (
          <details key={item.id} className="rounded-2xl border border-slate-800/80 bg-slate-900/45 px-3 py-2">
            <summary className="cursor-pointer list-none">
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${eventTone(item.eventType)}`}>
                  {item.eventType}
                </span>
                <span className="text-[11px] text-slate-500">Block {item.blockNumber}</span>
              </div>
              <div className="mt-1 text-xs text-slate-300">{formatDateTime(item.timestamp)}</div>
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
              <div>Details: {item.details || "--"}</div>
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
        ))}
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
            {loading && items.length === 0 && (
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

            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-sm text-slate-400">
                  No activity yet.
                </td>
              </tr>
            )}

            {items.map((item) => (
              <tr key={item.id} className="border-b border-slate-900/70 text-slate-300">
                <td className="px-2 py-2">
                  <div>{formatDateTime(item.timestamp)}</div>
                  <div className="text-[11px] text-slate-500">Block {item.blockNumber}</div>
                </td>
                <td className="px-2 py-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${eventTone(item.eventType)}`}>
                    {item.eventType}
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
                <td className="px-2 py-2 text-[11px] text-slate-400">{item.details || "--"}</td>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
