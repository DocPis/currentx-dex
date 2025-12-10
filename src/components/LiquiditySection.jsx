// src/components/LiquiditySection.jsx

import LiquidityHeaderCard from "./liquidity/LiquidityHeaderCard";
import LiquidityHeroBanner from "./liquidity/LiquidityHeroBanner";
import LiquidityFilters from "./liquidity/LiquidityFilters";
import PoolsTable from "./liquidity/PoolsTable";

import { usePoolsFilter } from "../hooks/usePoolsFilter";
import { usePoolsOnChain } from "../hooks/usePoolsOnChain";

// Definizione base delle pool (UI + info statiche tipo APR, tags)
const BASE_POOLS = [
  {
    id: 1,
    pair: "CXT / WETH",
    tokens: ["CXT", "WETH"],
    type: "Volatile 0.3%",
    tags: ["Core", "Listed"],
    apr: "23.4%",
  },
  {
    id: 2,
    pair: "WETH / USDC",
    tokens: ["WETH", "USDC"],
    type: "Stable 0.01%",
    tags: ["Bluechip"],
    apr: "18.7%",
  },
  {
    id: 3,
    pair: "CXT / USDC",
    tokens: ["CXT", "USDC"],
    type: "Volatile 1%",
    tags: ["Experimental"],
    apr: "32.1%",
  },
];

export default function LiquiditySection({ address, chainId }) {
  const { pools: onChainPools, loading, error } = usePoolsOnChain(
    BASE_POOLS,
    address,
    chainId
  );

  const {
    activeFilter,
    setActiveFilter,
    search,
    setSearch,
    sort,
    setSort,
    filtered,
  } = usePoolsFilter(onChainPools);

  return (
    <section className="w-full px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
      <div className="max-w-6xl mx-auto space-y-6 lg:space-y-8">
        {/* Header + banner */}
        <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2fr,1.3fr] items-stretch">
          <LiquidityHeaderCard />
          <LiquidityHeroBanner />
        </div>

        {/* Filters */}
        <LiquidityFilters
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
          search={search}
          setSearch={setSearch}
          sort={sort}
          setSort={setSort}
        />

        {/* Error banner se qualcosa va storto */}
        {error && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-[11px] text-amber-100">
            Failed to load on-chain pool data: {error}
          </div>
        )}

        {/* Pools table con TVL + volume/fees + "My position" */}
        <PoolsTable pools={filtered} loading={loading} />
      </div>
    </section>
  );
}
