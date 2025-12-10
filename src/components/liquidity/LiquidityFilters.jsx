export default function LiquidityFilters({
  activeFilter,
  setActiveFilter,
  search,
  setSearch,
  sort,
  setSort,
}) {
  const FILTERS = ["All", "Core", "Bluechip", "Experimental"];

  return (
    <div className="bg-[#050918]/90 border border-white/5 rounded-2xl lg:rounded-3xl px-4 sm:px-5 py-3 sm:py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      
      <div className="flex flex-wrap gap-2 sm:gap-3">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className={`rounded-full px-3 py-1.5 text-xs sm:text-sm border transition-all ${
              activeFilter === f
                ? "bg-sky-500 text-slate-950 border-sky-400 shadow-md shadow-sky-500/40"
                : "bg-slate-950/40 text-slate-300 border-slate-700/60 hover:border-slate-400/80 hover:bg-slate-900/80"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-xl bg-slate-950/60 border border-slate-700/70 text-xs sm:text-sm text-slate-200 px-3 py-2"
        >
          <option value="TVL">Sort by TVL</option>
          <option value="Volume">Sort by Volume 24h</option>
          <option value="APR">Sort by APR</option>
        </select>

        <div className="relative">
          <input
            type="text"
            placeholder="Symbol or address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48 sm:w-60 rounded-xl bg-slate-950/60 border border-slate-700/70 text-xs sm:text-sm text-slate-100 px-3 py-2 pl-8"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
        </div>
      </div>
    </div>
  );
}
