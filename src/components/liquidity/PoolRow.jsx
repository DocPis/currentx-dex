// src/components/liquidity/PoolRow.jsx

import TokenPairIcons from "./TokenPairIcons.jsx";
import PoolStats from "./PoolStats.jsx";
import PoolActions from "./PoolActions.jsx";

export default function PoolRow({
  pool,
  isOdd,
  onDepositPool,
  onWithdrawPool,
}) {
  const icons = pool.tokens?.slice(0, 2) || [];

  const volumeText =
    pool.volume24hLabel || pool.volumeLabel || pool.volume || "—";
  const feesText =
    pool.fees24hLabel || pool.feesLabel || pool.fees || "—";
  const tvlText = pool.tvlLabel || pool.tvl || "—";
  const aprText = pool.apr || "—";

  // ✅ NUOVA LOGICA: hai posizione se hai LP token > 0
  const hasPosition = (pool.userLpRaw ?? 0n) > 0n;

  const detailsUrl = pool.pairAddress
    ? `https://sepolia.etherscan.io/address/${pool.pairAddress}`
    : null;

  const handleDepositClick = () => {
    if (onDepositPool) onDepositPool(pool);
  };

  const handleWithdrawClick = () => {
    if (onWithdrawPool) onWithdrawPool(pool);
  };

  return (
    <div
      className={`px-4 sm:px-5 py-3.5 sm:py-4 text-[11px] sm:text-xs flex items-center text-slate-100 ${
        isOdd ? "bg-slate-950/40" : "bg-slate-950/10"
      } border-t border-slate-900/70`}
    >
      {/* LEFT CELL: pool name + tags + my position */}
      <div className="w-[28%] flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <TokenPairIcons tokens={icons} />

          <div className="flex flex-col">
            <span className="text-xs sm:text-sm font-medium">
              {pool.pair}
            </span>
            <span className="text-[10px] text-slate-400">
              {pool.type}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mt-1">
          {pool.tags?.map((t) => (
            <span
              key={t}
              className="inline-flex items-center rounded-full border border-slate-700/70 bg-slate-950/70 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em]"
            >
              {t}
            </span>
          ))}
        </div>

        {hasPosition && (
          <div className="mt-1 text-[10px] text-emerald-300 flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 border border-emerald-400/50 px-2 py-[2px]">
              My liquidity:&nbsp;
              <span className="font-semibold">
                {pool.userTvlLabel || "—"}
              </span>
            </span>
            {pool.userShareLabel && (
              <span className="text-emerald-200/90">
                ({pool.userShareLabel} of pool)
              </span>
            )}
          </div>
        )}
      </div>

      {/* MIDDLE: stats */}
      <PoolStats
        volumeText={volumeText}
        feesText={feesText}
        tvlText={tvlText}
        aprText={aprText}
      />

      {/* RIGHT: actions */}
      <PoolActions
        hasOnChainPool={pool.hasOnChainPool}
        detailsUrl={detailsUrl}
        onDeposit={handleDepositClick}
        onWithdraw={handleWithdrawClick}
        hasPosition={hasPosition}
      />
    </div>
  );
}
