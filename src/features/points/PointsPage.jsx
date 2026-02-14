// src/features/points/PointsPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  SEASON_ID,
  SEASON_LABEL,
  SEASON_START_MS,
  SEASON_END_MS,
  SEASON_ONGOING,
  SHOW_LEADERBOARD,
} from "../../shared/config/points";
import {
  useLeaderboard,
  useUserPoints,
  useWhitelistRewards,
} from "../../shared/hooks/usePoints";
import { getProvider } from "../../shared/config/web3";
import { buildPointsClaimMessage } from "../../shared/lib/pointsRewards";
import { buildWhitelistClaimMessage } from "../../shared/lib/whitelistRewards";

const shortenAddress = (addr) =>
  !addr ? "" : `${addr.slice(0, 6)}...${addr.slice(-4)}`;

const trimTrailingZeros = (value) => {
  if (typeof value !== "string" || !value.includes(".")) return value;
  return value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
};

const formatCompactNumber = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  const abs = Math.abs(num);
  const units = [
    { value: 1e12, suffix: "T" },
    { value: 1e9, suffix: "B" },
    { value: 1e6, suffix: "M" },
    { value: 1e3, suffix: "K" },
  ];
  for (const unit of units) {
    if (abs >= unit.value) {
      const scaled = num / unit.value;
      const decimals = scaled >= 100 ? 2 : scaled >= 10 ? 3 : 4;
      return `${trimTrailingZeros(scaled.toFixed(decimals))}${unit.suffix}`;
    }
  }
  if (abs >= 1) return trimTrailingZeros(num.toFixed(4));
  if (abs >= 0.01) return trimTrailingZeros(num.toFixed(6));
  return trimTrailingZeros(num.toFixed(8));
};

const formatUsd = (value) =>
  value === null || value === undefined ? "--" : `$${formatCompactNumber(value)}`;

const formatCrx = (value) =>
  value === null || value === undefined ? "--" : `${formatCompactNumber(value)} CRX`;

const formatMultiplier = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return `${num.toFixed(2)}x`;
};

const formatDateTime = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "--";
  return new Date(num).toLocaleString();
};

const formatDate = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "--";
  return new Date(num).toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};
const formatSignedCompact = (value, suffix = "") => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  const sign = num > 0 ? "+" : num < 0 ? "-" : "";
  const body = formatCompactNumber(Math.abs(num));
  return `${sign}${body}${suffix}`;
};
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const formatCountdown = (msRemaining) => {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};
const hashString = (value = "") => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};
const normalizeSeasonKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
const isSeasonOne = (seasonId, seasonLabel) => {
  const keys = new Set([normalizeSeasonKey(seasonId), normalizeSeasonKey(seasonLabel)]);
  return keys.has("season1") || keys.has("s1") || keys.has("1");
};
const buildRowSparkline = (seedInput, pointsChange = 0, rankChange = 0) => {
  const seed = hashString(seedInput);
  const trend = clamp((Number(pointsChange) || 0) / 400, -0.24, 0.24);
  const rankLift = clamp((Number(rankChange) || 0) / 50, -0.12, 0.12);
  const base = 0.5 + trend * 0.5 + rankLift * 0.35;
  const values = [];
  for (let i = 0; i < 12; i += 1) {
    const wave = Math.sin(((seed % 17) + i) * 0.82) * 0.08;
    const jitter = (((seed >> (i % 9)) & 3) - 1.5) / 26;
    const slope = (i / 11 - 0.5) * (trend + rankLift);
    values.push(clamp(base + wave + jitter + slope, 0.1, 0.92));
  }
  return values
    .map((value, idx) => `${idx * 4},${Math.round((1 - value) * 14) + 1}`)
    .join(" ");
};

const Pill = ({ children, tone = "slate" }) => {
  const toneMap = {
    slate: "border-slate-700/80 text-slate-300",
    sky: "border-sky-500/40 text-sky-200",
    emerald: "border-emerald-500/40 text-emerald-200",
    amber: "border-amber-500/40 text-amber-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.3em] ${
        toneMap[tone] || toneMap.slate
      }`}
    >
      {children}
    </span>
  );
};

const StatCard = ({ title, children, accent, className = "" }) => (
  <div
    className={`relative overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.9)] ${className}`}
  >
    <div className="absolute inset-0 bg-gradient-to-br from-slate-900/70 via-slate-900/20 to-slate-950/80" />
    <div className="relative">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[11px] uppercase tracking-[0.35em] text-slate-400">
          {title}
        </div>
        {accent ? (
          <span className="text-[11px] px-2 py-1 rounded-full border border-slate-700/70 text-slate-300">
            {accent}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  </div>
);

const InfoRow = ({ label, value, hint }) => (
  <div className="flex items-center justify-between text-sm">
    <span className="text-slate-400" title={hint || undefined}>
      {label}
    </span>
    <span className="text-slate-100 font-semibold">{value}</span>
  </div>
);

const MetricTile = ({ label, value, sublabel }) => (
  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 px-4 py-3">
    <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
      {label}
    </div>
    <div className="mt-2 text-lg font-semibold text-slate-100">{value}</div>
    {sublabel ? (
      <div className="text-[11px] text-slate-400 mt-1">{sublabel}</div>
    ) : null}
  </div>
);

const AccordionItem = ({ title, children }) => (
  <details className="group rounded-2xl border border-slate-800/80 bg-slate-900/60 px-5 py-4">
    <summary className="cursor-pointer list-none flex items-center justify-between text-sm font-semibold text-slate-100">
      <span>{title}</span>
      <span className="text-slate-400 group-open:rotate-180 transition">v</span>
    </summary>
    <div className="mt-3 text-sm text-slate-300 leading-relaxed">
      {children}
    </div>
  </details>
);

export default function PointsPage({ address, onConnect, onNavigate }) {
  const [copied, setCopied] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [whitelistClaimState, setWhitelistClaimState] = useState({
    loading: false,
    error: "",
    success: "",
  });
  const [leaderboardClaimState, setLeaderboardClaimState] = useState({
    loading: false,
    error: "",
    success: "",
  });
  const leaderboardQuery = useLeaderboard(SEASON_ID, 0, SHOW_LEADERBOARD);
  const {
    data: userStats,
    isLoading,
    error,
    refetch: refetchUserStats,
  } = useUserPoints(address);
  const whitelistQuery = useWhitelistRewards(address);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const seasonTitle = String(SEASON_LABEL || SEASON_ID || "SEASON").toUpperCase();
  const seasonOne = isSeasonOne(SEASON_ID, SEASON_LABEL);
  const seasonStartValue =
    userStats?.seasonStart ?? leaderboardQuery?.seasonStart ?? SEASON_START_MS;
  const seasonEndValue =
    userStats?.seasonEnd ?? leaderboardQuery?.seasonEnd ?? SEASON_END_MS;
  const seasonIsOngoing =
    typeof userStats?.seasonOngoing === "boolean"
      ? userStats.seasonOngoing
      : typeof leaderboardQuery?.seasonOngoing === "boolean"
      ? leaderboardQuery.seasonOngoing
      : SEASON_ONGOING;
  const hasExplicitSeasonEnd =
    Number.isFinite(Number(seasonEndValue)) && Number(seasonEndValue) > 0;
  const seasonStartLabel = seasonOne ? "Feb 12, 2026" : formatDate(seasonStartValue);
  const seasonEndLabel = hasExplicitSeasonEnd
    ? formatDate(seasonEndValue)
    : seasonIsOngoing
    ? "ONGOING"
    : "TBD";
  const seasonHeadline = `${seasonTitle} - ${seasonStartLabel} -> ${seasonEndLabel}`;
  const seasonFinalizationLine =
    "Points and whitelist rewards are finalized after the configured finalization window.";
  const leaderboardSummary = leaderboardQuery.summary || null;
  const leaderboardUpdatedAt = leaderboardQuery.updatedAt;
  const summarySeasonRewardCrx = Number(leaderboardSummary?.seasonRewardCrx || 0);
  const summaryTop100PoolCrx = Number(leaderboardSummary?.top100PoolCrx || 0);
  const summaryVisibleRewardsCrx = Number(leaderboardSummary?.visibleRewardsCrx || 0);
  const summaryTotalPoints = Number(leaderboardSummary?.totalPoints || 0);
  const summaryWalletCount = Number(leaderboardSummary?.walletCount || 0);
  const leaderboardErrorText = (() => {
    const raw = String(leaderboardQuery.error?.message || "").trim();
    if (!raw) return "Unable to load leaderboard.";
    const lower = raw.toLowerCase();
    if (
      lower.includes("proxy error") ||
      lower.includes("econnrefused") ||
      lower.includes("127.0.0.1:3000")
    ) {
      return "Leaderboard API non raggiungibile in locale (proxy verso 127.0.0.1:3000). Avvia il backend API o imposta VITE_API_PROXY_TARGET.";
    }
    return raw;
  })();
  const leaderboardRows = useMemo(
    () => leaderboardQuery.data || [],
    [leaderboardQuery.data]
  );
  const leaderboardStats = useMemo(() => {
    const lpValues = [];
    const pointDeltas = [];
    leaderboardRows.forEach((row) => {
      const lpUsd = Number(row?.lpUsd);
      if (Number.isFinite(lpUsd) && lpUsd > 0) lpValues.push(lpUsd);
      const delta = Number(row?.pointsChange24h);
      if (Number.isFinite(delta)) pointDeltas.push(Math.abs(delta));
    });
    lpValues.sort((a, b) => a - b);
    pointDeltas.sort((a, b) => a - b);
    const lp75 = lpValues.length
      ? lpValues[Math.min(lpValues.length - 1, Math.floor(lpValues.length * 0.75))]
      : 0;
    const hot75 = pointDeltas.length
      ? pointDeltas[Math.min(pointDeltas.length - 1, Math.floor(pointDeltas.length * 0.75))]
      : 0;
    return {
      whaleLpThreshold: lp75,
      hotDeltaThreshold: hot75,
    };
  }, [leaderboardRows]);
  const top100CutoffPoints = leaderboardRows.length
    ? Number(leaderboardRows[Math.min(99, leaderboardRows.length - 1)]?.points || 0)
    : null;
  const userPoints = Number(userStats?.points || 0);
  const pointsToTop100 = Number.isFinite(top100CutoffPoints)
    ? Math.max(0, top100CutoffPoints - userPoints)
    : null;
  const progressToTop100Pct = Number.isFinite(top100CutoffPoints) && top100CutoffPoints > 0
    ? clamp((userPoints / top100CutoffPoints) * 100, 0, 100)
    : 0;
  const userRank = Number(userStats?.rank);
  const aboveWalletGapPoints = (() => {
    if (Number.isFinite(userRank) && userRank > 1 && userRank <= 100) {
      const above = leaderboardRows.find((row) => Number(row?.rank) === userRank - 1);
      const abovePoints = Number(above?.points);
      return Number.isFinite(abovePoints) ? Math.max(0, abovePoints - userPoints) : null;
    }
    if (Number.isFinite(pointsToTop100)) return pointsToTop100;
    return null;
  })();
  const estimatedRewardIfEndedNowCrx = (() => {
    const rewardSnapshot = Number(userStats?.seasonReward?.rewardSnapshotCrx);
    if (Number.isFinite(rewardSnapshot) && rewardSnapshot > 0) return rewardSnapshot;
    if (
      Number.isFinite(userPoints) &&
      userPoints > 0 &&
      Number.isFinite(summarySeasonRewardCrx) &&
      summarySeasonRewardCrx > 0 &&
      Number.isFinite(summaryTotalPoints) &&
      summaryTotalPoints > 0
    ) {
      return (userPoints / summaryTotalPoints) * summarySeasonRewardCrx;
    }
    return 0;
  })();
  const seasonCountdown = (() => {
    const end = Number(seasonEndValue);
    if (!Number.isFinite(end) || end <= 0) return null;
    if (end <= nowMs) return "00:00:00";
    return formatCountdown(end - nowMs);
  })();

  const hasBoostLp = Boolean(userStats?.hasBoostLp);
  const effectiveMultiplier = Number(userStats?.multiplier || 1);
  const lpUsdCrxEth = Number(userStats?.lpUsdCrxEth || 0);
  const lpUsdCrxUsdm = Number(userStats?.lpUsdCrxUsdm || 0);
  const lpPoints = Number(userStats?.lpPoints || 0);
  const poolBoostStatus = lpUsdCrxUsdm > 0 && lpUsdCrxEth > 0
    ? "CRX/USDM 3x + CRX/ETH 2x"
    : lpUsdCrxUsdm > 0
      ? "CRX/USDM 3x"
      : lpUsdCrxEth > 0
        ? "CRX/ETH 2x"
        : "No LP boost";

  const pointsValue = isLoading ? "--" : formatCompactNumber(userStats?.points || 0);
  const lpUsdValue =
    userStats?.lpUsd === null && hasBoostLp
      ? "LP detected"
      : formatUsd(userStats?.lpUsd || 0);
  const lpUsdCrxEthValue = formatUsd(lpUsdCrxEth);
  const lpUsdCrxUsdmValue = formatUsd(lpUsdCrxUsdm);
  const volumeValue = formatUsd(userStats?.volumeUsd || 0);
  const lpPointsValue = formatCompactNumber(lpPoints);
  const whitelist = whitelistQuery.data || null;
  const seasonReward = userStats?.seasonReward || null;
  const immediatePct = Number(whitelist?.immediatePct ?? 0.3);
  const streamedPct = Math.max(0, 1 - immediatePct);

  const formatClaimButtonLabel = () => {
    if (!whitelist?.whitelisted) return "Claim";
    if (whitelistClaimState.loading) return "Claiming...";
    if (!whitelist.claimOpen) return "Claim locked";
    if ((whitelist.claimableNowCrx || 0) <= 0) return "Nothing claimable";
    return "Claim now";
  };

  const formatLeaderboardClaimButtonLabel = () => {
    if (!seasonReward) return "Claim";
    if (leaderboardClaimState.loading) return "Claiming...";
    if (!seasonReward.claimOpen) return "Claim locked";
    if ((seasonReward.claimableNowCrx || 0) <= 0) return "Nothing claimable";
    return "Claim now";
  };
  const handleBoostMultiplier = () => {
    if (typeof onNavigate === "function") {
      onNavigate("liquidity");
      return;
    }
    if (typeof window !== "undefined") {
      window.location.assign("/liquidity");
    }
  };

  const handleWhitelistClaim = async () => {
    if (!address || !whitelist?.whitelisted || whitelistClaimState.loading) return;
    if (!whitelist.claimOpen) {
      setWhitelistClaimState({
        loading: false,
        error: `Claim opens at ${formatDateTime(whitelist.claimOpensAt)}.`,
        success: "",
      });
      return;
    }
    if ((whitelist.claimableNowCrx || 0) <= 0) {
      setWhitelistClaimState({
        loading: false,
        error: "No claimable amount available right now.",
        success: "",
      });
      return;
    }

    try {
      setWhitelistClaimState({ loading: true, error: "", success: "" });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const issuedAt = Date.now();
      const message = buildWhitelistClaimMessage({
        address,
        seasonId: SEASON_ID,
        issuedAt,
      });
      const signature = await signer.signMessage(message);
      const res = await fetch("/api/whitelist-rewards/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          seasonId: SEASON_ID,
          issuedAt,
          signature,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || "Claim failed");
      }
      const amount = Number(payload?.claim?.amountCrx || 0);
      setWhitelistClaimState({
        loading: false,
        error: "",
        success: `Claimed ${formatCompactNumber(amount)} CRX.`,
      });
      await whitelistQuery.refetch();
    } catch (err) {
      setWhitelistClaimState({
        loading: false,
        error: err?.message || "Claim failed.",
        success: "",
      });
    }
  };

  const handleLeaderboardClaim = async () => {
    if (!address || !seasonReward || leaderboardClaimState.loading) return;
    if (!seasonReward.claimOpen) {
      setLeaderboardClaimState({
        loading: false,
        error: `Claim opens at ${formatDateTime(seasonReward.claimOpensAt)}.`,
        success: "",
      });
      return;
    }
    if ((seasonReward.claimableNowCrx || 0) <= 0) {
      setLeaderboardClaimState({
        loading: false,
        error: "No claimable amount available right now.",
        success: "",
      });
      return;
    }

    try {
      setLeaderboardClaimState({ loading: true, error: "", success: "" });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const issuedAt = Date.now();
      const message = buildPointsClaimMessage({
        address,
        seasonId: SEASON_ID,
        issuedAt,
      });
      const signature = await signer.signMessage(message);
      const res = await fetch("/api/points/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          seasonId: SEASON_ID,
          issuedAt,
          signature,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || "Claim failed");
      }
      const amount = Number(payload?.claim?.amountCrx || 0);
      setLeaderboardClaimState({
        loading: false,
        error: "",
        success: `Claimed ${formatCompactNumber(amount)} CRX.`,
      });
      await Promise.all([refetchUserStats(), leaderboardQuery.refetch()]);
    } catch (err) {
      setLeaderboardClaimState({
        loading: false,
        error: err?.message || "Claim failed.",
        success: "",
      });
    }
  };

  const handleCopy = (addr) => {
    if (!addr) return;
    const done = () => {
      setCopied(addr);
      setTimeout(() => setCopied(""), 900);
    };
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(addr).then(done).catch(done);
    } else {
      done();
    }
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 pb-12 text-slate-100 mt-8">
      <div className="relative overflow-hidden rounded-[32px] border border-slate-800/80 bg-slate-950/60 p-6 mb-8 shadow-2xl">
        <div className="absolute -top-24 -right-10 h-56 w-56 rounded-full bg-sky-500/15 blur-3xl" />
        <div className="absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative flex flex-col lg:flex-row gap-6">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <Pill tone="sky">Season</Pill>
              {seasonCountdown ? (
                <Pill tone="amber">{`Countdown ${seasonCountdown}`}</Pill>
              ) : null}
            </div>
            <div className="mt-3 text-3xl sm:text-4xl font-semibold">
              {seasonHeadline}
            </div>
            <div className="text-sm text-slate-400 mt-2">
              {seasonFinalizationLine}
            </div>

            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricTile
                label="Points"
                value={pointsValue}
                sublabel={
                  userStats?.rank ? `Rank #${userStats.rank}` : "Season total"
                }
              />
              <MetricTile
                label="Multiplier"
                value={formatMultiplier(effectiveMultiplier)}
                sublabel={hasBoostLp ? poolBoostStatus : "Connect LP to unlock"}
              />
              <MetricTile
                label="Active LP"
                value={lpUsdValue}
                sublabel={
                  hasBoostLp
                    ? lpUsdCrxUsdm > 0
                      ? "CRX/USDM 3x active"
                      : "CRX/ETH 2x active"
                    : "No active boost pools"
                }
              />
              <MetricTile
                label="Volume"
                value={volumeValue}
                sublabel={`LP points ${lpPointsValue}`}
              />
            </div>
          </div>

          <div className="lg:w-[320px] flex flex-col gap-3">
            <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 text-xs text-slate-300">
              <div className="uppercase tracking-[0.3em] text-[10px] text-slate-500">
                Quick rules
              </div>
              <div className="mt-2 space-y-1">
                <div>1 USD traded = 1 point (all pairs).</div>
                <div>Add Liquidity: CRX/ETH = 2x, CRX/USDM = 3x.</div>
                <div>
                  Leaderboard rewards: 50% to Top 100 by rank tiers, 50% to other eligible wallets pro-rata on points.
                </div>
                <div>Top 100 rewards require finalization complete + no wash flags + min activity.</div>
                <div>Whitelist rewards: 30% immediate + 70% streamed on activation.</div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-800/70">
                <div className="uppercase tracking-[0.3em] text-[10px] text-slate-500">
                  Missions
                </div>
                <div className="mt-2 space-y-1 text-slate-300">
                  <div>Swap $1k volume {"->"} +5% boost.</div>
                  <div>Provide liquidity 3 days in a row {"->"} +10% LP multiplier.</div>
                  <div>Trade on 2 pools {"->"} cross-pool bonus.</div>
                </div>
              </div>
            </div>
            {!address ? (
              <button
                type="button"
                onClick={onConnect}
                className="px-5 py-2 rounded-full bg-sky-500/90 text-slate-900 font-semibold text-sm shadow-lg shadow-sky-500/30"
              >
                Connect wallet
              </button>
            ) : (
              <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4">
                <div className="text-xs text-slate-400">Wallet status</div>
                <div className="text-sm font-semibold text-slate-100 mt-1">
                  {hasBoostLp ? "LP detected" : "No boost LP"}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {hasBoostLp ? poolBoostStatus : "Live tracking"}
                </div>
                <button
                  type="button"
                  onClick={handleBoostMultiplier}
                  className="mt-3 px-3 py-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 text-sky-100 text-[11px] font-semibold hover:bg-sky-500/25 transition"
                >
                  Boost my multiplier
                </button>
              </div>
            )}
            {address ? (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/8 p-4">
                <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-300/80">
                  If Season Ended Now
                </div>
                <div className="mt-2 text-sm text-slate-100">
                  Your estimated reward:{" "}
                  <span className="font-semibold">
                    {formatCrx(estimatedRewardIfEndedNowCrx)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-300">
                  Top 100 cutoff:{" "}
                  {Number.isFinite(top100CutoffPoints)
                    ? `${formatCompactNumber(top100CutoffPoints)} pts`
                    : "--"}
                </div>
                <div className="mt-1 text-xs text-slate-300">
                  You need{" "}
                  {Number.isFinite(pointsToTop100)
                    ? `+${formatCompactNumber(pointsToTop100)} pts`
                    : "--"}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-900/30 px-4 py-3 text-sm text-rose-100 mb-8">
          {error.message || "Unable to load points."}
        </div>
      ) : null}

      {address ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-10">
          <StatCard title="Your Points" accent={isLoading ? "Loading" : "Season total"}>
            <div className="text-4xl font-semibold">
              {isLoading ? "--" : formatCompactNumber(userStats?.points || 0)}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Rank: {userStats?.rank ? `#${userStats.rank}` : "--"}
            </div>
            <div className="mt-5 grid grid-cols-1 gap-2">
              <InfoRow label="Base points" value={formatCompactNumber(userStats?.basePoints || 0)} />
              <InfoRow label="Bonus points" value={formatCompactNumber(userStats?.bonusPoints || 0)} />
              <InfoRow label="Total" value={formatCompactNumber(userStats?.points || 0)} />
            </div>
            <div className="mt-5 rounded-2xl border border-slate-800/80 bg-slate-950/45 p-4">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                  Rank {Number.isFinite(userRank) ? `#${userRank}` : "#--"}
                </div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                  Progress to Top 100
                </div>
              </div>
              <div className="mt-2 h-2.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-400 to-emerald-300 transition-all"
                  style={{ width: `${progressToTop100Pct.toFixed(1)}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-slate-300">
                {progressToTop100Pct.toFixed(0)}% complete
              </div>
              <div className="mt-1 text-xs text-slate-300">
                {Number.isFinite(pointsToTop100) && pointsToTop100 > 0
                  ? `+${formatCompactNumber(pointsToTop100)} pts to enter Top 100`
                  : "Inside Top 100 target zone"}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {Number.isFinite(aboveWalletGapPoints) && aboveWalletGapPoints > 0
                  ? `Gap to wallet above: +${formatCompactNumber(aboveWalletGapPoints)} pts`
                  : "No gap to wallet above right now"}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Live estimated reward: {formatCrx(estimatedRewardIfEndedNowCrx)}
              </div>
            </div>
          </StatCard>

          <StatCard title="Wallet Multiplier" accent={hasBoostLp ? "LP boost" : "No LP"}>
            <div className="text-2xl font-semibold">
              {formatMultiplier(effectiveMultiplier)}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {hasBoostLp
                ? `${poolBoostStatus} active.`
                : "Add CRX/ETH or CRX/USDM liquidity to unlock 2x/3x."}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2">
              <InfoRow label="Swap multiplier" value="1.00x" />
              <InfoRow label="CRX/ETH LP multiplier" value="2.00x" />
              <InfoRow label="CRX/USDM LP multiplier" value="3.00x" />
            </div>
          </StatCard>

          <StatCard
            title="Active LP Pools"
            accent={hasBoostLp ? "V3 LP" : "No LP"}
          >
            <div className="grid grid-cols-1 gap-2">
              <InfoRow
                label="Active LP (USD)"
                value={lpUsdValue}
                hint="Total USD value of active CRX/ETH + CRX/USDM V3 positions."
              />
              <InfoRow
                label="CRX/ETH LP (USD)"
                value={lpUsdCrxEthValue}
                hint="This pool contributes with 2x points multiplier."
              />
              <InfoRow
                label="CRX/USDM LP (USD)"
                value={lpUsdCrxUsdmValue}
                hint="This pool contributes with 3x points multiplier."
              />
            </div>
          </StatCard>

          <StatCard title="Season Volume" accent="USD">
            <div className="grid grid-cols-1 gap-2">
              <InfoRow label="Swap Volume (USD)" value={volumeValue} />
              <InfoRow
                label="Liquidity points"
                value={lpPointsValue}
                hint="CRX/ETH adds 2x points, CRX/USDM adds 3x points."
              />
            </div>
          </StatCard>

          <StatCard title="Whitelist Rewards" accent="Activation">
            {whitelistQuery.isLoading ? (
              <div className="text-sm text-slate-400">Loading whitelist rewards...</div>
            ) : whitelistQuery.error ? (
              <div className="text-sm text-rose-300">
                {whitelistQuery.error?.message || "Unable to load whitelist rewards."}
              </div>
            ) : !whitelist?.whitelisted ? (
              <div className="text-sm text-slate-400">
                This wallet is not in the whitelist rewards cohort.
              </div>
            ) : (
              <>
                <div className="text-2xl font-semibold">
                  {formatCrx(whitelist.totalRewardCrx || 0)}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {whitelist.pending
                    ? "Snapshot pending: values will be finalized on next recalc."
                    : whitelist.activationQualified
                    ? `Activation complete (${formatDateTime(whitelist.activatedAt)})`
                    : `Activation window ends ${formatDateTime(whitelist.windowEndsAt)}`}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {whitelist.claimOpen
                    ? "Claim is open."
                    : `Claim opens ${formatDateTime(whitelist.claimOpensAt)}.`}
                </div>
                <div className="mt-4 grid grid-cols-1 gap-2">
                  <InfoRow label="Base reward" value={formatCrx(whitelist.baseRewardCrx || 0)} />
                  <InfoRow
                    label="Activation bonus"
                    value={formatCrx(whitelist.activationBonusCrx || 0)}
                  />
                  <InfoRow
                    label={`Immediate (${Math.round(immediatePct * 100)}%)`}
                    value={formatCrx(whitelist.immediateClaimableCrx || 0)}
                  />
                  <InfoRow
                    label={`Streamed (${Math.round(streamedPct * 100)}% / ${whitelist.streamDays || 0}d)`}
                    value={formatCrx(whitelist.streamedCrx || 0)}
                  />
                  <InfoRow
                    label="Claimable now"
                    value={formatCrx(whitelist.claimableNowCrx || 0)}
                  />
                  <InfoRow
                    label="Already claimed"
                    value={formatCrx(whitelist.totalClaimedCrx || 0)}
                  />
                  <InfoRow
                    label="Swap completed"
                    value={whitelist.hasSwap ? "Done" : "Pending"}
                  />
                  <InfoRow
                    label={`Volume >= $${formatCompactNumber(whitelist.volumeThresholdUsd || 0)}`}
                    value={whitelist.metVolumeThreshold ? "Done" : "Pending"}
                  />
                  <InfoRow
                    label={`LP >= $${formatCompactNumber(whitelist.microLpUsd || 0)}`}
                    value={whitelist.metMicroLp ? "Done" : "Pending"}
                  />
                </div>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={handleWhitelistClaim}
                    disabled={
                      whitelistClaimState.loading ||
                      !whitelist.claimOpen ||
                      (whitelist.claimableNowCrx || 0) <= 0
                    }
                    className="px-4 py-2 rounded-xl border border-cyan-400/40 bg-cyan-500/20 text-cyan-100 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-cyan-500/30 transition"
                  >
                    {formatClaimButtonLabel()}
                  </button>
                  {whitelistClaimState.success ? (
                    <div className="text-xs text-emerald-300 mt-2">
                      {whitelistClaimState.success}
                    </div>
                  ) : null}
                  {whitelistClaimState.error ? (
                    <div className="text-xs text-rose-300 mt-2">
                      {whitelistClaimState.error}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </StatCard>

          <StatCard title="Leaderboard Rewards" accent="Season payout">
            {!seasonReward ? (
              <div className="text-sm text-slate-400">
                Reward data appears after points ingestion for this wallet.
              </div>
            ) : (
              <>
                <div className="text-2xl font-semibold">
                  {formatCrx(seasonReward.rewardSnapshotCrx || seasonReward.rewardCrx || 0)}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {seasonReward.claimOpen
                    ? "Claim is open."
                    : `Claim opens ${formatDateTime(seasonReward.claimOpensAt)}.`}
                </div>
                <div className="mt-4 grid grid-cols-1 gap-2">
                  <InfoRow
                    label="Season allocation"
                    value={formatCrx(seasonReward.seasonAllocationCrx || 0)}
                  />
                  <InfoRow
                    label="Season total points"
                    value={formatCompactNumber(seasonReward.totalPointsSeason || 0)}
                  />
                  <InfoRow
                    label="Your share"
                    value={`${formatCompactNumber(seasonReward.sharePct || 0)}%`}
                  />
                  <InfoRow
                    label="Claimable now"
                    value={formatCrx(seasonReward.claimableNowCrx || 0)}
                  />
                  <InfoRow
                    label="Already claimed"
                    value={formatCrx(seasonReward.totalClaimedCrx || 0)}
                  />
                </div>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={handleLeaderboardClaim}
                    disabled={
                      leaderboardClaimState.loading ||
                      !seasonReward.claimOpen ||
                      (seasonReward.claimableNowCrx || 0) <= 0
                    }
                    className="px-4 py-2 rounded-xl border border-emerald-400/40 bg-emerald-500/20 text-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-500/30 transition"
                  >
                    {formatLeaderboardClaimButtonLabel()}
                  </button>
                  {leaderboardClaimState.success ? (
                    <div className="text-xs text-emerald-300 mt-2">
                      {leaderboardClaimState.success}
                    </div>
                  ) : null}
                  {leaderboardClaimState.error ? (
                    <div className="text-xs text-rose-300 mt-2">
                      {leaderboardClaimState.error}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </StatCard>
        </div>
      ) : null}

      {SHOW_LEADERBOARD ? (
        <div className="rounded-3xl border border-slate-800/80 bg-slate-900/70 p-6 mb-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-lg font-semibold">Leaderboard</div>
              <div className="text-xs text-slate-400 mt-1">
                {summarySeasonRewardCrx > 0
                  ? summaryTop100PoolCrx > 0
                    ? `Top100 shown ${formatCrx(summaryVisibleRewardsCrx)} / pool ${formatCrx(summaryTop100PoolCrx)} | Season pool ${formatCrx(summarySeasonRewardCrx)} | Total points ${formatCompactNumber(summaryTotalPoints)} | Wallets ${formatCompactNumber(summaryWalletCount)}`
                    : `Season pool ${formatCrx(summarySeasonRewardCrx)} | Total points ${formatCompactNumber(summaryTotalPoints)} | Wallets ${formatCompactNumber(summaryWalletCount)}`
                  : "Top 100 wallets by season points."}
                {leaderboardUpdatedAt
                  ? ` | Updated ${formatDateTime(leaderboardUpdatedAt)}`
                  : ""}
              </div>
            </div>
            <Pill tone="amber">Top 100</Pill>
          </div>
          {leaderboardQuery.isLoading ? (
            <div className="text-sm text-slate-400">Loading leaderboard...</div>
          ) : leaderboardQuery.error ? (
            <div className="text-sm text-rose-300">
              {leaderboardErrorText}
            </div>
          ) : !leaderboardQuery.available ? (
            <div className="text-sm text-slate-400">
              No leaderboard rows available yet for this season.
            </div>
          ) : (
            <div className="max-h-[520px] overflow-y-auto overflow-x-auto pr-1 points-scrollbar">
              <table className="w-full text-sm">
                <thead className="text-slate-400 text-[11px] uppercase tracking-wider sticky top-0 bg-slate-900/90 backdrop-blur z-10">
                  <tr>
                    <th className="text-left py-2">Rank</th>
                    <th className="text-left py-2">Wallet</th>
                    <th className="text-right py-2">Points</th>
                    <th className="text-right py-2">Reward est.</th>
                    <th className="text-right py-2">Multiplier</th>
                    <th className="text-right py-2">Active LP USD</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardQuery.data.map((row, idx) => {
                    const isUser =
                      address && row.address?.toLowerCase() === address.toLowerCase();
                    const rankValue = Number(row.rank);
                    const displayRank = Number.isFinite(rankValue) ? rankValue : idx + 1;
                    const rankChange24h = Number(row?.rankChange24h || 0);
                    const pointsChange24h = Number(row?.pointsChange24h || 0);
                    const lpUsd = Number(row?.lpUsd || 0);
                    const isHotWallet =
                      Math.abs(pointsChange24h) >= Math.max(1, leaderboardStats.hotDeltaThreshold);
                    const isWhale =
                      lpUsd > 0 && lpUsd >= Math.max(500, leaderboardStats.whaleLpThreshold);
                    const isHighEfficiency = Number(row?.multiplier || 1) >= 2;
                    const badges = [
                      isHotWallet ? "HOT" : null,
                      isWhale ? "WHALE LP" : null,
                      isHighEfficiency ? "HIGH EFF" : null,
                    ].filter(Boolean);
                    const sparkline = buildRowSparkline(
                      `${row.address || idx}:${row.points || 0}:${displayRank}`,
                      pointsChange24h,
                      rankChange24h
                    );
                    const rankArrow =
                      rankChange24h > 0 ? "\u2191" : rankChange24h < 0 ? "\u2193" : "\u2192";
                    const rankTone =
                      rankChange24h > 0
                        ? "text-emerald-300"
                        : rankChange24h < 0
                        ? "text-rose-300"
                        : "text-slate-500";
                    return (
                      <tr
                        key={row.address || idx}
                        className={
                          isUser
                            ? "bg-slate-800/70 text-slate-50"
                            : "border-t border-slate-800/70 hover:bg-slate-900/40"
                        }
                      >
                        <td className="py-1.5">
                          <div className="flex items-center gap-2">
                            <span>#{displayRank}</span>
                            <span className={`text-[11px] ${rankTone}`}>
                              {rankArrow}
                              {rankChange24h !== 0 ? Math.abs(rankChange24h) : ""}
                            </span>
                          </div>
                        </td>
                        <td className="py-1.5">
                          <div className="flex items-center gap-2">
                            <span>{shortenAddress(row.address)}</span>
                            <button
                              type="button"
                              onClick={() => handleCopy(row.address)}
                              className="text-xs text-slate-400 hover:text-slate-200"
                            >
                              {copied === row.address ? "Copied" : "Copy"}
                            </button>
                          </div>
                          {badges.length ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {badges.map((badge) => (
                                <span
                                  key={badge}
                                  className="px-1.5 py-0.5 rounded-full border border-slate-700/70 bg-slate-800/60 text-[10px] text-slate-300"
                                >
                                  {badge}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td className="py-1.5 text-right">
                          <div className="inline-flex items-center justify-end gap-2">
                            <span className="font-semibold">
                              {formatCompactNumber(row.points || 0)}
                            </span>
                            <svg viewBox="0 0 44 16" className="h-[14px] w-[44px]">
                              <polyline
                                points={sparkline}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.4"
                                className="text-sky-300/90"
                              />
                            </svg>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {formatSignedCompact(pointsChange24h)}
                          </div>
                        </td>
                        <td className="py-1.5 text-right">
                          {formatCompactNumber(row.rewardCrx || 0)}
                          <div className="text-[11px] text-slate-500">
                            {formatSignedCompact(row.rewardSharePct || 0, "%")}
                          </div>
                        </td>
                        <td className="py-1.5 text-right">
                          {formatMultiplier(row.multiplier || 1)}
                        </td>
                        <td className="py-1.5 text-right">{formatUsd(row.lpUsd || 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      <div className="mb-10">
        <div className="text-lg font-semibold mb-4">How it works</div>
        <div className="grid grid-cols-1 gap-3">
          <AccordionItem title="Base rules">
            <>
              <div>1 USD traded = 1 point across all pairs. Season points reset each season.</div>
              <div>
                Final points are computed after the configured finalization window.
              </div>
            </>
          </AccordionItem>
          <AccordionItem title="Points model">
            <>
              <div>
                Swap actions score at 1x. Add-liquidity actions are pool-weighted:
                CRX/ETH = 2x, CRX/USDM = 3x.
              </div>
              <div>
                Formula applied in app: `Total Points = SwapVolumeUSD + LPPointsWeighted`.
              </div>
            </>
          </AccordionItem>
          <AccordionItem title="Claim">
            <div>
              Rewards are claimable at the end of each season, once finalization is complete.
            </div>
          </AccordionItem>
          <AccordionItem title="Whitelist rewards activation">
            <>
              <div>
                Whitelist rewards are funded from existing allocations (not additional supply).
                Budget cap: 10,000 CRX.
              </div>
              <div>
                Base reward is granted per whitelisted wallet. Activation bonus unlocks when the
                wallet completes at least one swap and also meets either the volume threshold or
                the micro LP threshold within the activation window.
              </div>
              <div>
                Payout schedule: 30% immediate and 70% streamed over the configured vesting
                duration.
              </div>
              <div>Claim unlocks only after the season finalization window is completed.</div>
            </>
          </AccordionItem>
        </div>
      </div>
    </div>
  );
}
