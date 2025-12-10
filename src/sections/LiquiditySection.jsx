import LiquidityHeaderCard from "../components/liquidity/LiquidityHeaderCard";
import LiquidityHeroBanner from "../components/liquidity/LiquidityHeroBanner";
import LiquidityFilters from "../components/liquidity/LiquidityFilters";
import PoolsTable from "../components/liquidity/PoolsTable";

import { usePoolsFilter } from "../hooks/usePoolsFilter";

const POOLS = [
  {
    id: 1,
    pair: "CXT / WETH",
    tokens: ["CXT", "WETH"],
    type: "Volatile 0.3%",
    tags: ["Core", "Listed"],
    volume: "$26.5K",
    fees: "$790.12",
    tvl: "$39.2K",
    apr: "23.4%",
    volumeNum: 26500,
    tvlNum: 39200,
    aprNum: 23.4,
  },
  {
    id: 2,
    pair: "WETH / USDC",
    tokens: ["WETH", "USDC"],
    type: "Stable 0.01%",
    tags: ["Bluechip"],
    volume: "$519.1K",
    fees: "$1.2K",
    tvl: "$30.6K",
    apr: "18.7%",
    volumeNum: 519100,
    tvlNum: 30600,
    aprNum: 18.7,
  },
  {
    id: 3,
    pair: "CXT / USDC",
    tokens: ["CXT", "USDC"],
    type: "Volatile 1%",
    tags: ["Experimental"],
    volume: "$79.2K",
    fees: "$274.8",
    tvl: "$22.6K",
    apr: "32.1%",
    volumeNum: 79200,
    tvlNum: 22600,
    aprNum: 32.1,
  },
];

export default function LiquiditySection() {
  const {
    activeFilter,
    setActiveFilter,
    search,
    setSearch,
    sort,
    setSort,
    filtered,
  } = usePoolsFilter(POOLS);

  return (
    <section className="w-full px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
      <div className="max-w-6xl mx-auto space-y-6 lg:space-y-8">

        {/* HEADER GRID */}
        <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2fr,1.3fr] items-stretch">
          <LiquidityHeaderCard />
          <LiquidityHeroBanner />
        </div>

        {/* FILTERS */}
        <LiquidityFilters
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
          search={search}
          setSearch={setSearch}
          sort={sort}
          setSort={setSort}
        />

        {/* POOLS TABLE */}
        <PoolsTable pools={filtered} />
      </div>
    </section>
  );
}
