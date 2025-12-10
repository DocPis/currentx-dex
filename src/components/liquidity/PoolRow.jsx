// src/components/liquidity/PoolRow.jsx
import { TOKEN_ICONS } from "../../utils/tokenIcons";

export default function PoolRow({ pool, isOdd }) {
  const icons = pool.tokens?.slice(0, 2) || [];

  const volumeText =
    pool.volume24hLabel || pool.volumeLabel || pool.volume || "—";
  const feesText =
    pool.fees24hLabel || pool.feesLabel || pool.fees || "—";
  const tvlText = pool.tvlLabel || pool.tvl || "—";
  const aprText = pool.apr || "—";

  const hasPosition =
    pool.userTvlUsd != null && pool.userTvlUsd > 0 && pool.userSharePct > 0;

  const detailsUrl = pool.pairAddress
    ? `https://sepolia.etherscan.io/address/${pool.pairAddress}`
    : null;

  return (
    <div
      className={`px-4 sm:px-5 py-3.5 sm:py-4 text-[11px] sm:text-xs flex items-center text-slate-100 ${
        isOdd ? "bg-slate-950/40" : "bg-slate-950/10"
      } border-t border-slate-900/70`}
    >
      {/* POOL + ICONS + MY POSITION */}
      <div className="w-[28%] flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {icons.map((sym) => {
              const src = TOKEN_ICONS[sym];
              if (!src)
                return (
                  <span
                    key={sym}
                    className="h-6 w-6 rounded-full bg-slate-700 border border-slate-950"
                  />
                );
              return (
                <img
                  key={sym}
                  src={src}
                  alt={sym}
                  className="h-6 w-6 rounded-full border border-slate-950 bg-slate-900 object-cover shadow-md"
                />
              );
            })}
          </div>

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
                {pool.userTvlLabel}
              </span>
            </span>
            <span className="text-emerald-200/90">
              ({pool.userShareLabel} of pool)
            </span>
          </div>
        )}
      </div>

      {/* VOLUME 24H */}
      <div className="w-[14%] text-right hidden sm:block text-slate-200">
        {volumeText}
      </div>

      {/* FEES 24H */}
      <div className="w-[14%] text-right hidden sm:block text-slate-200">
        {feesText}
      </div>

      {/* TVL */}
      <div className="w-[14%] text-right text-slate-100">{tvlText}</div>

      {/* APR */}
      <div className="w-[12%] text-right text-emerald-300 font-medium">
        {aprText}
      </div>

      {/* ACTIONS */}
      <div className="w-[18%] flex justify-end gap-2 pr-1 sm:pr-2">
        <button
          className="rounded-full bg-sky-500/90 hover:bg-sky-400 text-slate-950 px-3 py-1.5 text-[10px] sm:text-xs font-semibold"
          disabled={!pool.hasOnChainPool}
          title={
            pool.hasOnChainPool
              ? "Add liquidity via router (todo)"
              : "No on-chain pool for this pair"
          }
        >
          Deposit
        </button>

        {detailsUrl ? (
          <a
            href={detailsUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-slate-600/70 px-3 py-1.5 text-[10px] sm:text-xs text-slate-200 hover:border-slate-300/80 hover:bg-slate-900/70 transition-colors"
          >
            Details
          </a>
        ) : (
          <button
            className="rounded-full border border-slate-600/70 px-3 py-1.5 text-[10px] sm:text-xs text-slate-400 cursor-default"
            disabled
          >
            Details
          </button>
        )}
      </div>
    </div>
  );
}
