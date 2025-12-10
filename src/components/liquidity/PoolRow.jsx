import { TOKEN_ICONS } from "../../utils/tokenIcons";

export default function PoolRow({ pool, isOdd }) {
  const icons = pool.tokens?.slice(0, 2) || [];

  return (
    <div
      className={`px-4 sm:px-5 py-3.5 sm:py-4 text-[11px] sm:text-xs flex items-center text-slate-100 ${
        isOdd ? "bg-slate-950/40" : "bg-slate-950/10"
      } border-t border-slate-900/70`}
    >
      {/* POOL + ICONS */}
      <div className="w-[28%] flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {icons.map((sym) => (
              <img
                key={sym}
                src={TOKEN_ICONS[sym]}
                alt={sym}
                className="h-6 w-6 rounded-full border border-slate-950 bg-slate-900 object-cover shadow-md"
              />
            ))}
          </div>

          <div className="flex flex-col">
            <span className="text-xs sm:text-sm font-medium">{pool.pair}</span>
            <span className="text-[10px] text-slate-400">{pool.type}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mt-1">
          {pool.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center rounded-full border border-slate-700/70 bg-slate-950/70 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em]"
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="w-[14%] text-right hidden sm:block">{pool.volume}</div>
      <div className="w-[14%] text-right hidden sm:block">{pool.fees}</div>
      <div className="w-[14%] text-right">{pool.tvl}</div>
      <div className="w-[12%] text-right text-emerald-300 font-medium">
        {pool.apr}
      </div>

      <div className="w-[18%] flex justify-end gap-2 pr-1 sm:pr-2">
        <button className="rounded-full bg-sky-500/90 hover:bg-sky-400 text-slate-950 px-3 py-1.5 text-[10px] sm:text-xs font-semibold">
          Deposit
        </button>
        <button className="rounded-full border border-slate-600/70 px-3 py-1.5 text-[10px] sm:text-xs text-slate-200 hover:bg-slate-900/70">
          Details
        </button>
      </div>
    </div>
  );
}
