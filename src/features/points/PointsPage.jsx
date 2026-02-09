// src/features/points/PointsPage.jsx
import React, { useState } from "react";
import {
  SEASON_LABEL,
  SEASON_ID,
  SEASON_START_MS,
  SEASON_END_MS,
  BOOST_CAP_MULTIPLIER,
  OUT_OF_RANGE_FACTOR,
  MULTIPLIER_TIERS,
} from "../../shared/config/points";
import { useLeaderboard, useUserPoints } from "../../shared/hooks/usePoints";

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

const formatMultiplier = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return `${num.toFixed(2)}x`;
};

const formatPct = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return `${(num * 100).toFixed(0)}%`;
};

const formatDate = (value) => {
  if (!value) return "--";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "now";
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

const StatCard = ({ title, children, accent }) => (
  <div className="rounded-3xl bg-slate-900/80 border border-slate-800 p-5 shadow-xl">
    <div className="flex items-center justify-between mb-4">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
        {title}
      </div>
      {accent ? (
        <span className="text-[11px] px-2 py-1 rounded-full border border-slate-700 text-slate-300">
          {accent}
        </span>
      ) : null}
    </div>
    {children}
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

const AccordionItem = ({ title, children }) => (
  <details className="group rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4">
    <summary className="cursor-pointer list-none flex items-center justify-between text-sm font-semibold text-slate-100">
      <span>{title}</span>
      <span className="text-slate-400 group-open:rotate-180 transition">v</span>
    </summary>
    <div className="mt-3 text-sm text-slate-300 leading-relaxed">
      {children}
    </div>
  </details>
);

export default function PointsPage({ address, onConnect }) {
  const [copied, setCopied] = useState("");
  const leaderboardQuery = useLeaderboard(SEASON_ID, 0);
  const { data: userStats, isLoading, error } = useUserPoints(address);

  const seasonWindow = `${formatDate(SEASON_START_MS)} - ${
    SEASON_END_MS ? formatDate(SEASON_END_MS) : "Ongoing"
  }`;

  const hasBoostLp = Boolean(userStats?.hasBoostLp);
  const hasAge = Boolean(userStats?.lpAgeAvailable);
  const multiplier = userStats?.baseMultiplier || 1;
  const effectiveMultiplier = userStats?.multiplier || multiplier;
  const nextTier = userStats?.tier?.nextTier || null;
  const nextIn = userStats?.tier?.secondsToNext;
  const progressPct = userStats?.tier?.progressPct ?? 0;
  const rangeStatus = hasBoostLp
    ? hasAge
      ? userStats?.hasRangeData
        ? userStats?.hasInRange
          ? "In range"
          : `Out of range (${OUT_OF_RANGE_FACTOR * 100}% boost)`
        : "Range pending"
      : "LP detected"
    : "No boost";

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
      <div className="flex flex-col gap-4 mb-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="text-3xl sm:text-4xl font-semibold">{SEASON_LABEL}</div>
            <div className="text-sm text-slate-400 mt-1">{seasonWindow}</div>
          </div>
          <div className="rounded-2xl bg-slate-900/70 border border-slate-800 px-4 py-3 text-xs text-slate-300">
            <div className="uppercase tracking-[0.2em] text-[10px] text-slate-500">Season rules</div>
            <div className="mt-1">$1 traded = 1 point · LP boosts capped at {BOOST_CAP_MULTIPLIER}x LP value</div>
          </div>
        </div>

        {!address ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">Connect to track your points</div>
              <div className="text-sm text-slate-400 mt-1">
                Add CRX/ETH or CRX/USDM V3 liquidity to unlock the multiplier tiers.
              </div>
              <ul className="mt-3 text-xs text-slate-400 space-y-1">
                <li>1 USD traded = 1 point (all pairs).</li>
                <li>Boost cap = 10x active LP USD.</li>
                <li>Out-of-range LP applies 50% of the multiplier.</li>
              </ul>
            </div>
            <button
              type="button"
              onClick={onConnect}
              className="px-5 py-2 rounded-full bg-sky-500/90 text-slate-900 font-semibold text-sm shadow-lg shadow-sky-500/30"
            >
              Connect wallet
            </button>
          </div>
        ) : null}
      </div>

      {address ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-10">
          <StatCard title="Your Points" accent={isLoading ? "Loading" : "Season total"}>
            <div className="text-3xl font-semibold">
              {isLoading ? "--" : formatCompactNumber(userStats?.points || 0)}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Rank: {userStats?.rank ? `#${userStats.rank}` : "--"}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2">
              <InfoRow label="Base points" value={formatCompactNumber(userStats?.basePoints || 0)} />
              <InfoRow label="Bonus points" value={formatCompactNumber(userStats?.bonusPoints || 0)} />
              <InfoRow label="Total" value={formatCompactNumber(userStats?.points || 0)} />
            </div>
          </StatCard>

          <StatCard title="Wallet Multiplier" accent={hasBoostLp ? "LP boost" : "No LP"}>
            <div className="text-2xl font-semibold">
              {formatMultiplier(effectiveMultiplier)}
              {hasBoostLp && effectiveMultiplier !== multiplier ? (
                <span className="text-sm text-slate-400 ml-2">
                  ({formatMultiplier(multiplier)} base)
                </span>
              ) : null}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {hasBoostLp
                ? hasAge
                  ? `${rangeStatus} · Tier ${multiplier.toFixed(1)}x`
                  : "LP detected · Multiplier pending"
                : "Add CRX/ETH or CRX/USDM V3 liquidity to unlock boosts."}
            </div>
            <div className="mt-4">
              {hasBoostLp && hasAge ? (
                nextTier ? (
                  <div className="text-xs text-slate-400">
                    Next tier: {nextTier.multiplier}x in {formatDuration(nextIn)}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">Max tier reached.</div>
                )
              ) : (
                <div className="text-xs text-slate-500">
                  {hasBoostLp ? "Age data pending." : "Connect LP to start the timer."}
                </div>
              )}
              <div className="mt-2 h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 via-indigo-400 to-emerald-400"
                  style={{
                    width: `${Math.round((hasBoostLp && hasAge ? progressPct : 0) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </StatCard>

          <StatCard
            title="Active LP & Boost Cap"
            accent={hasBoostLp ? "V3 LP" : "No LP"}
          >
            <div className="grid grid-cols-1 gap-2">
              <InfoRow
                label="Active LP (USD)"
                value={
                  userStats?.lpUsd === null && hasBoostLp
                    ? "LP detected"
                    : formatUsd(userStats?.lpUsd || 0)
                }
                hint="Total USD value of active CRX/ETH + CRX/USDM V3 positions."
              />
              <InfoRow
                label="Boosted Volume Cap (USD)"
                value={
                  userStats?.boostedVolumeCap === null
                    ? "--"
                    : formatUsd(userStats?.boostedVolumeCap || 0)
                }
                hint="Boost applies to min(VolumeUSD, 10 x LP USD)."
              />
              <InfoRow
                label="LP in range"
                value={
                  userStats?.hasRangeData ? formatPct(userStats?.lpInRangePct || 0) : "--"
                }
                hint="If out of range, multiplier is reduced by 50%."
              />
            </div>
          </StatCard>

          <StatCard title="Season Volume" accent="USD">
            <div className="grid grid-cols-1 gap-2">
              <InfoRow
                label="Season Volume (USD)"
                value={formatUsd(userStats?.volumeUsd || 0)}
              />
              <InfoRow
                label="Boosted Volume (USD)"
                value={formatUsd(userStats?.boostedVolumeUsd || 0)}
                hint="Eligible volume for boost (cap applied)."
              />
            </div>
          </StatCard>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-900/30 px-4 py-3 text-sm text-rose-100 mb-8">
          {error.message || "Unable to load points."}
        </div>
      ) : null}

      <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 mb-10">
        <div className="text-lg font-semibold mb-4">Leaderboard</div>
        {!leaderboardQuery.available ? (
          <div className="text-sm text-slate-400">
            Top wallets leaderboard is coming soon. We will surface the top 100 once the
            season indexer is live.
          </div>
        ) : leaderboardQuery.isLoading ? (
          <div className="text-sm text-slate-400">Loading leaderboard...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left py-2">Rank</th>
                  <th className="text-left py-2">Wallet</th>
                  <th className="text-right py-2">Points</th>
                  <th className="text-right py-2">Multiplier</th>
                  <th className="text-right py-2">Active LP USD</th>
                </tr>
              </thead>
              <tbody>
                {leaderboardQuery.data.map((row, idx) => {
                  const isUser = address && row.address?.toLowerCase() === address.toLowerCase();
                  return (
                    <tr
                      key={row.address || idx}
                      className={
                        isUser
                          ? "bg-slate-800/70 text-slate-50"
                          : "border-t border-slate-800"
                      }
                    >
                      <td className="py-2">{row.rank || idx + 1}</td>
                      <td className="py-2">
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
                      </td>
                      <td className="py-2 text-right">{formatCompactNumber(row.points || 0)}</td>
                      <td className="py-2 text-right">{formatMultiplier(row.multiplier || 1)}</td>
                      <td className="py-2 text-right">{formatUsd(row.lpUsd || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mb-10">
        <div className="text-lg font-semibold mb-4">How it works</div>
        <div className="grid grid-cols-1 gap-3">
          <AccordionItem title="Base rules">
            1 USD traded = 1 point across all pairs. Season points reset each season.
          </AccordionItem>
          <AccordionItem title="LP Boost formula">
            Points = VolumeUSD + min(VolumeUSD, 10 x LP_USD) x (Multiplier - 1).
            The boosted cap is 10x your active LP USD value on CRX/ETH and CRX/USDM.
          </AccordionItem>
          <AccordionItem title="Tier multipliers">
            {MULTIPLIER_TIERS.map((tier) => (
              <div key={tier.label} className="flex items-center justify-between">
                <span>{tier.label}</span>
                <span>{tier.multiplier}x</span>
              </div>
            ))}
          </AccordionItem>
          <AccordionItem title="Out-of-range note">
            If your V3 position is out of range, the multiplier is reduced to
            {` ${OUT_OF_RANGE_FACTOR * 100}%`} of its value (example: 2.0x becomes 1.5x).
          </AccordionItem>
        </div>
      </div>
    </div>
  );
}
