import React, { useMemo, useState } from "react";
import { EXPLORER_BASE_URL } from "../../shared/config/web3";
import TradeWidget from "../../components/launchpad/TradeWidget";
import LiveBuysFeed from "../../components/launchpad/LiveBuysFeed";
import TokenLogo from "../../components/launchpad/TokenLogo";
import {
  useTokenActivity,
  useTokenCandles,
  useTokenDetail,
} from "../../services/launchpad/hooks";
import type { LaunchpadCandle } from "../../services/launchpad/types";
import { formatPercent, formatUsd, shortAddress, toTimeAgo } from "../../services/launchpad/utils";

const TIMEFRAME_OPTIONS = ["1h", "24h", "7d", "30d", "all"] as const;
const ACTIVITY_TABS = [
  { id: "trades", label: "Trades" },
  { id: "buys", label: "Buys" },
  { id: "sells", label: "Sells" },
] as const;

const buildPricePath = (candles: LaunchpadCandle[], width: number, height: number) => {
  if (!candles.length) return "";
  const closes = candles.map((item) => item.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = Math.max(max - min, 1e-9);
  // When we only have 1 candle (e.g. 2 swaps in the same hour), draw a flat line
  // so the user doesn't think the chart failed to load.
  if (candles.length === 1) {
    const y = height - ((candles[0].close - min) / range) * height;
    return `M0,${y.toFixed(2)} L${width.toFixed(2)},${y.toFixed(2)}`;
  }

  const stepX = width / Math.max(1, candles.length - 1);
  return candles
    .map((item, index) => {
      const x = stepX * index;
      const y = height - ((item.close - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
};

interface TokenDetailProps {
  tokenAddress: string;
  address?: string | null;
  initialTradeSide?: "buy" | "sell";
  onConnect: () => void;
  onBack: () => void;
  onRefreshBalances?: () => Promise<void> | void;
  onOpenToken?: (tokenAddress: string) => void;
}

const TokenDetail = ({
  tokenAddress,
  address,
  initialTradeSide,
  onConnect,
  onBack,
  onRefreshBalances,
  onOpenToken,
}: TokenDetailProps) => {
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAME_OPTIONS)[number]>("24h");
  const [activityTab, setActivityTab] = useState<(typeof ACTIVITY_TABS)[number]["id"]>("trades");
  const [copyState, setCopyState] = useState<"idle" | "done" | "fail">("idle");

  const tokenQuery = useTokenDetail(tokenAddress);
  const token = tokenQuery.data;
  const candlesQuery = useTokenCandles(tokenAddress, timeframe);
  const candles = candlesQuery.data || [];
  const activity = useTokenActivity({
    tokenAddress,
    limit: 40,
    type: activityTab,
    enabled: Boolean(tokenAddress),
  });

  const pricePath = useMemo(() => buildPricePath(candles, 860, 280), [candles]);
  const volumeMax = useMemo(() => {
    if (!candles.length) return 1;
    return Math.max(...candles.map((item) => item.volumeUSD), 1);
  }, [candles]);

  const handleCopyContract = async () => {
    try {
      await navigator.clipboard.writeText(token?.address || tokenAddress);
      setCopyState("done");
      window.setTimeout(() => setCopyState("idle"), 1200);
    } catch {
      setCopyState("fail");
      window.setTimeout(() => setCopyState("idle"), 1200);
    }
  };

  const handleTradeSuccess = async () => {
    await Promise.all([
      tokenQuery.refetch(),
      candlesQuery.refetch(),
      activity.refresh(),
      Promise.resolve(onRefreshBalances?.()),
    ]);
  };

  if (tokenQuery.isLoading && !token) {
    return (
      <section className="px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="h-36 rounded-2xl border border-slate-800/70 bg-slate-900/45 animate-pulse" />
          <div className="h-[360px] rounded-2xl border border-slate-800/70 bg-slate-900/45 animate-pulse" />
        </div>
      </section>
    );
  }

  if (tokenQuery.isError) {
    const err = tokenQuery.error as unknown as { message?: string; status?: number } | null;
    const status = Number.isFinite(Number(err?.status)) ? Number(err?.status) : null;
    const message = String(err?.message || "Failed to load token details.");

    return (
      <section className="px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-3 rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 text-sm text-slate-200">
          <div className="font-display text-base font-semibold">Unable to load token</div>
          <div className="text-xs text-slate-400 break-words">
            {status ? `HTTP ${status}: ` : ""}
            {message}
          </div>
          <div className="text-[11px] text-slate-500 break-words">Token: {tokenAddress}</div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => tokenQuery.refetch()}
              className="rounded-lg border border-slate-700/70 bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-slate-200"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border border-slate-700/70 bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-slate-200"
            >
              Back to launchpad
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!token) {
    return (
      <section className="px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 text-sm text-slate-300">
          Token not found.
          <button
            type="button"
            onClick={onBack}
            className="ml-3 rounded-lg border border-slate-700/70 bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-slate-200"
          >
            Back to launchpad
          </button>
        </div>
      </section>
    );
  }

  const isPositive = Number(token.market.change24h || 0) >= 0;
  const tokenExplorerUrl = `${EXPLORER_BASE_URL}/token/${token.address}`;

  return (
    <section className="px-4 py-6 pb-44 sm:px-6 lg:pb-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500"
        >
          Back to Launchpad
        </button>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <header className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[0_16px_36px_rgba(2,6,23,0.55)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <TokenLogo
                    address={token.address}
                    symbol={token.symbol}
                    logoUrl={token.logoUrl}
                    className="h-14 w-14 rounded-full border border-slate-700/70 bg-slate-900 object-cover"
                  />
                  <div>
                    <h1 className="font-display text-xl font-semibold text-slate-100">{token.name}</h1>
                    <div className="mt-1 text-sm text-slate-400">${token.symbol}</div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm text-slate-400">Price</div>
                  <div className="font-display text-2xl font-semibold text-slate-100">{formatUsd(token.market.priceUSD)}</div>
                  <div className={`text-sm font-semibold ${isPositive ? "text-emerald-300" : "text-rose-300"}`}>
                    {formatPercent(token.market.change24h)} (24h)
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 px-3 py-2">
                  <div className="text-slate-500">Market cap</div>
                  <div className="mt-1 font-semibold text-slate-100">{formatUsd(token.market.mcapUSD)}</div>
                </div>
                <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 px-3 py-2">
                  <div className="text-slate-500">Liquidity</div>
                  <div className="mt-1 font-semibold text-slate-100">{formatUsd(token.market.liquidityUSD)}</div>
                </div>
                <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 px-3 py-2">
                  <div className="text-slate-500">Volume 24h</div>
                  <div className="mt-1 font-semibold text-slate-100">{formatUsd(token.market.volume24hUSD)}</div>
                </div>
                <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 px-3 py-2">
                  <div className="text-slate-500">Contract</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyContract}
                      className="inline-flex items-center gap-2 font-semibold text-sky-200 hover:text-sky-100"
                    >
                      {shortAddress(token.address)}
                      <span className="text-[10px] text-slate-400">
                        {copyState === "done" ? "copied" : copyState === "fail" ? "failed" : "copy"}
                      </span>
                    </button>
                    <a
                      href={tokenExplorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-[10px] font-medium text-slate-400 transition hover:text-sky-200"
                    >
                      blockscout
                    </a>
                  </div>
                </div>
              </div>
            </header>

            <section className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4 shadow-[0_16px_36px_rgba(2,6,23,0.45)]">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-sm font-semibold text-slate-100">Chart</h2>
                <div className="inline-flex rounded-xl border border-slate-700/70 bg-slate-900/70 p-1 text-xs">
                  {TIMEFRAME_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setTimeframe(option)}
                      className={`rounded-lg px-2.5 py-1.5 font-semibold uppercase ${
                        timeframe === option
                          ? "bg-sky-500/25 text-sky-100"
                          : "text-slate-300 hover:text-slate-100"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 p-3">
                {candlesQuery.isLoading && !candles.length ? (
                  <div className="h-[320px] animate-pulse rounded bg-slate-900" />
                ) : candles.length ? (
                  <svg viewBox="0 0 860 320" className="h-[320px] w-full" role="img" aria-label="Price chart">
                    <defs>
                      <linearGradient id="launchpad-chart-line" x1="0" x2="1" y1="0" y2="0">
                        <stop offset="0%" stopColor="#34d399" stopOpacity="0.65" />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity="1" />
                      </linearGradient>
                    </defs>
                    {candles.map((item, index) => {
                      const t = candles.length === 1 ? 0.5 : index / Math.max(1, candles.length - 1);
                      const x = t * 860;
                      const barHeight = Math.max(4, (item.volumeUSD / volumeMax) * 72);
                      return (
                        <rect
                          key={`bar-${item.timestamp}`}
                          x={x - 2}
                          y={316 - barHeight}
                          width="3"
                          height={barHeight}
                          fill="rgba(56,189,248,0.22)"
                        />
                      );
                    })}
                    <path
                      d={pricePath}
                      fill="none"
                      stroke="url(#launchpad-chart-line)"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <div className="h-[320px] rounded bg-slate-900/60 px-3 py-4 text-sm text-slate-400">
                    No chart data available.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-xl border border-slate-700/70 bg-slate-900/70 p-1 text-xs">
                  {ACTIVITY_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActivityTab(tab.id)}
                      className={`rounded-lg px-2.5 py-1.5 font-semibold transition ${
                        activityTab === tab.id
                          ? "bg-cyan-500/20 text-cyan-100"
                          : "text-slate-300 hover:text-slate-100"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                    activity.mode === "ws"
                      ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-200"
                      : activity.mode === "polling"
                      ? "border-amber-400/35 bg-amber-400/10 text-amber-200"
                      : "border-slate-700/70 bg-slate-900/70 text-slate-500"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {activity.mode === "ws" ? "Live" : activity.mode === "polling" ? "Polling" : "Offline"}
                </span>
              </div>

              <div className="space-y-2">
                {activity.items.map((item) => (
                  <div
                    key={item.txHash}
                    className="grid grid-cols-[72px_minmax(0,1fr)_130px] items-center gap-2 rounded-xl border border-slate-800/70 bg-slate-900/55 px-3 py-2 text-xs"
                  >
                    <span
                      className={`rounded-full border px-2 py-1 text-center font-semibold uppercase tracking-wide ${
                        item.side === "BUY"
                          ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-200"
                          : "border-rose-400/35 bg-rose-500/10 text-rose-200"
                      }`}
                    >
                      {item.side}
                    </span>
                    <div>
                      <div className="text-slate-200">
                        {shortAddress(item.buyer)} - {formatUsd(item.amountUSD)}
                      </div>
                      <div className="text-[11px] text-slate-500">{toTimeAgo(item.timestamp)}</div>
                    </div>
                    <a
                      href={`${EXPLORER_BASE_URL}/tx/${item.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-right text-[11px] font-semibold text-sky-300 hover:text-sky-100"
                    >
                      View tx
                    </a>
                  </div>
                ))}
                {!activity.items.length && (
                  <div className="rounded-xl border border-slate-800/70 bg-slate-900/55 px-3 py-6 text-center text-xs text-slate-400">
                    No activity for this filter.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4">
              <h2 className="font-display text-sm font-semibold text-slate-100">About</h2>
              <p className="mt-2 text-sm text-slate-300/90">{token.description || "No description provided."}</p>
              <dl className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 px-3 py-2">
                  <dt className="text-slate-500">Website</dt>
                  <dd className="mt-1 text-slate-200">
                    {token.website ? (
                      <a href={token.website} target="_blank" rel="noreferrer" className="text-sky-300 hover:text-sky-100">
                        {token.website.replace(/^https?:\/\//u, "")}
                      </a>
                    ) : (
                      "--"
                    )}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 px-3 py-2">
                  <dt className="text-slate-500">Creator</dt>
                  <dd className="mt-1 text-slate-200">{shortAddress(token.creator)}</dd>
                </div>
                <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 px-3 py-2">
                  <dt className="text-slate-500">Created</dt>
                  <dd className="mt-1 text-slate-200">{new Date(token.createdAt).toLocaleString()}</dd>
                </div>
                <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 px-3 py-2">
                  <dt className="text-slate-500">Launch params</dt>
                  <dd className="mt-1 text-slate-200">
                    Fee {token.launchParams?.poolFeeBps || 30} bps, Creator {token.launchParams?.creatorAllocationPct || 0}%
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <div className="hidden lg:block">
            <div className="sticky top-24 space-y-3">
              <TradeWidget
                token={token}
                address={address}
                initialSide={initialTradeSide}
                onConnect={onConnect}
                onRefreshBalances={onRefreshBalances}
                onTradeSuccess={handleTradeSuccess}
              />
              <LiveBuysFeed
                items={activity.items.filter((item) => item.side === "BUY").slice(0, 8)}
                isLoading={activity.isLoading}
                mode={activity.mode}
                onSelectToken={onOpenToken}
                title={`Live ${token.symbol} buys`}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800/85 bg-slate-950/95 p-3 backdrop-blur lg:hidden">
        <TradeWidget
          token={token}
          address={address}
          initialSide={initialTradeSide}
          onConnect={onConnect}
          onRefreshBalances={onRefreshBalances}
          onTradeSuccess={handleTradeSuccess}
        />
      </div>
    </section>
  );
};

export default TokenDetail;
