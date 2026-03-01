import React, { useEffect, useState } from "react";
import { CircleHelp, Copy } from "lucide-react";
import { formatUnits } from "ethers";
import { EXPLORER_BASE_URL } from "../../../shared/config/addresses";

interface StrategyConfig {
  minRebalanceInterval: number;
  recenterBps: number;
  minCompoundValueToken1: bigint;
}

interface AlmPositionRow {
  positionId: string;
  owner: string;
  strategyId: number;
  pool: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  fee: number;
  tickSpacing: number;
  currentTokenId: string;
  currentTick: number | null;
  centerTick: number | null;
  lastRebalanceAt: number;
  active: boolean;
  dust0: bigint;
  dust1: bigint;
  dustValueToken1: bigint;
}

interface AlmPositionsPanelProps {
  address?: string | null;
  onConnect?: () => void;
  loading: boolean;
  positions: AlmPositionRow[];
  strategyById: Map<number, StrategyConfig>;
  onWithdraw: (positionId: string) => void;
  onCompoundWeighted: (positionId: string) => void;
  withdrawingPositionId: string;
  compoundingPositionId: string;
  isKeeperWallet: boolean;
  copiedValue: string;
  onCopy: (value: string) => void;
}

const shortenAddress = (value: string, start = 6, end = 4) => {
  if (!value) return "--";
  if (value.length <= start + end) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
};

const formatDateTime = (timestampSec: number | null) => {
  if (!timestampSec || !Number.isFinite(timestampSec)) return "--";
  return new Date(timestampSec * 1000).toLocaleString();
};

const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const formatFeeTier = (feeTier: number) => `${(feeTier / 10_000).toFixed(2)}%`;

const formatTokenAmount = (amount: bigint, decimals: number, maxFrac = 6) => {
  try {
    const value = formatUnits(amount, decimals);
    const num = Number(value);
    if (!Number.isFinite(num)) return value;
    if (num === 0) return "0";
    if (num >= 1) return num.toFixed(Math.min(maxFrac, 6)).replace(/\.?0+$/u, "");
    return num.toFixed(Math.min(maxFrac + 2, 8)).replace(/\.?0+$/u, "");
  } catch {
    return amount.toString();
  }
};

const formatDust = (amount: bigint, decimals: number) => {
  const value = formatTokenAmount(amount, decimals, 6);
  return value;
};

export default function AlmPositionsPanel({
  address,
  onConnect,
  loading,
  positions,
  strategyById,
  onWithdraw,
  onCompoundWeighted,
  withdrawingPositionId,
  compoundingPositionId,
  isKeeperWallet,
  copiedValue,
  onCopy,
}: AlmPositionsPanelProps) {
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTs(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const getEstimate = (position: AlmPositionRow, strategy: StrategyConfig | null) => {
    if (!strategy || position.currentTick === null || position.centerTick === null) {
      return {
        label: "Waiting for enough data to estimate rebalance",
        status: "unknown",
      };
    }
    const tickDelta = Math.abs(position.currentTick - position.centerTick);
    const deltaPct = (Math.pow(1.0001, tickDelta) - 1) * 100;
    const triggerPct = strategy.recenterBps / 100;
    const needs = deltaPct >= triggerPct;
    return {
      label: `${needs ? "Rebalance needed" : "In range"} (${deltaPct.toFixed(3)}% vs ${triggerPct.toFixed(
        3
      )}% trigger)`,
      status: needs ? "needs" : "in-range",
    };
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-slate-100">My ALM Positions</h2>
        {!address && (
          <button
            type="button"
            onClick={onConnect}
            className="rounded-full border border-sky-400/50 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-100 hover:border-sky-300"
          >
            Connect Wallet
          </button>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {loading && positions.length === 0 && (
          <>
            <div className="h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/45" />
            <div className="h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/45" />
          </>
        )}

        {!loading && positions.length === 0 && (
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/45 px-4 py-4 text-sm text-slate-400">
            No ALM positions found for this wallet.
          </div>
        )}

        {positions.map((position) => {
          const strategy = strategyById.get(position.strategyId) || null;
          const cooldownSeconds = Math.max(
            0,
            (position.lastRebalanceAt || 0) + (strategy?.minRebalanceInterval || 0) - nowTs
          );
          const estimate = getEstimate(position, strategy);
          const threshold = strategy?.minCompoundValueToken1 ?? 0n;
          const isEligibleForCompound = position.dustValueToken1 >= threshold;
          const thresholdText = `${formatTokenAmount(
            threshold,
            position.token1Decimals
          )} ${position.token1Symbol}`;

          return (
            <div
              key={position.positionId}
              className="rounded-2xl border border-slate-800/80 bg-slate-900/45 px-3 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-display text-sm font-semibold text-slate-100">
                  Position #{position.positionId}
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span
                    className={`rounded-full border px-2 py-0.5 ${
                      position.active
                        ? "border-emerald-400/45 bg-emerald-500/12 text-emerald-100"
                        : "border-slate-500/45 bg-slate-800/70 text-slate-200"
                    }`}
                  >
                    {position.active ? "Active" : "Inactive"}
                  </span>
                  <span className="rounded-full border border-slate-700/70 bg-slate-900/60 px-2 py-0.5 text-slate-200">
                    Strategy #{position.strategyId}
                  </span>
                </div>
              </div>

              <div className="mt-2 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                <div>Pair: {position.token0Symbol} / {position.token1Symbol}</div>
                <div>Fee: {formatFeeTier(position.fee)}</div>
                <div>Current NFT: #{position.currentTokenId}</div>
                <div>Cooldown remaining: {formatDuration(cooldownSeconds)}</div>
              </div>

              <details className="mt-2 rounded-xl border border-slate-800 bg-slate-950/45 px-3 py-2 md:hidden">
                <summary className="cursor-pointer text-xs font-semibold text-slate-200">Show details</summary>
                <div className="mt-2 grid gap-2 text-xs text-slate-400">
                  <div>Owner: {shortenAddress(position.owner, 8, 6)}</div>
                  <div>Pool: {shortenAddress(position.pool, 8, 6)}</div>
                  <div>Last rebalance: {formatDateTime(position.lastRebalanceAt)}</div>
                  <div>
                    Status:{" "}
                    <span
                      className={
                        estimate.status === "needs"
                          ? "text-amber-200"
                          : estimate.status === "in-range"
                          ? "text-emerald-200"
                          : "text-slate-300"
                      }
                    >
                      {estimate.label}
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-1">
                    Dust0 ({position.token0Symbol}): {formatDust(position.dust0, position.token0Decimals)}
                    <span title="Dust0 is leftover token0 held by ALM for this position.">
                      <CircleHelp className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                  </div>
                  <div>Dust1 ({position.token1Symbol}): {formatDust(position.dust1, position.token1Decimals)}</div>
                  <div>Pool tick: {position.currentTick ?? "--"}</div>
                </div>
              </details>

              <div className="mt-2 hidden gap-2 text-xs text-slate-400 md:grid md:grid-cols-2 lg:grid-cols-3">
                <div>Owner: {shortenAddress(position.owner, 8, 6)}</div>
                <div>Tick spacing: {position.tickSpacing || "--"}</div>
                <div>Last rebalance: {formatDateTime(position.lastRebalanceAt)}</div>
                <div>Pool: {shortenAddress(position.pool, 8, 6)}</div>
                <div>
                  Token0: {position.token0Symbol} ({shortenAddress(position.token0, 8, 6)})
                </div>
                <div>
                  Token1: {position.token1Symbol} ({shortenAddress(position.token1, 8, 6)})
                </div>
                <div>
                  Status:{" "}
                  <span
                    className={
                      estimate.status === "needs"
                        ? "text-amber-200"
                        : estimate.status === "in-range"
                        ? "text-emerald-200"
                        : "text-slate-300"
                    }
                  >
                    {estimate.label}
                  </span>
                </div>
                <div className="inline-flex items-center gap-1">
                  Dust0 ({position.token0Symbol}): {formatDust(position.dust0, position.token0Decimals)}
                  <span title="Dust0 is leftover token0 held by ALM for this position.">
                    <CircleHelp className="h-3.5 w-3.5 text-slate-400" />
                  </span>
                </div>
                <div>Dust1 ({position.token1Symbol}): {formatDust(position.dust1, position.token1Decimals)}</div>
                <div>
                  Dust total value: {formatTokenAmount(position.dustValueToken1, position.token1Decimals)}{" "}
                  {position.token1Symbol}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onWithdraw(position.positionId)}
                  disabled={withdrawingPositionId === position.positionId}
                  className="rounded-xl border border-rose-400/45 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {withdrawingPositionId === position.positionId ? "Withdrawing..." : "Withdraw"}
                </button>
                <button
                  type="button"
                  onClick={() => onCompoundWeighted(position.positionId)}
                  disabled={
                    !isKeeperWallet || !isEligibleForCompound || compoundingPositionId === position.positionId
                  }
                  title={
                    !isKeeperWallet
                      ? "Only keeper can execute compoundWeighted."
                      : !isEligibleForCompound
                      ? `Requires at least ${thresholdText} dust value in token1 units.`
                      : ""
                  }
                  className="rounded-xl border border-cyan-400/45 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {compoundingPositionId === position.positionId ? "Compounding..." : "Compound (Keeper)"}
                </button>
                <button
                  type="button"
                  onClick={() => onCopy(position.positionId)}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copiedValue === position.positionId ? "Copied" : "Copy positionId"}
                </button>
                <a
                  href={`${EXPLORER_BASE_URL}/address/${position.pool}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200"
                >
                  View pool
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
