// src/components/LiquiditySection.jsx

import { useState } from "react";

import LiquidityHeaderCard from "./liquidity/LiquidityHeaderCard";
import LiquidityHeroBanner from "./liquidity/LiquidityHeroBanner";
import LiquidityFilters from "./liquidity/LiquidityFilters";
import PoolsTable from "./liquidity/PoolsTable";
import AddLiquidityModal from "./liquidity/AddLiquidityModal";

import { usePoolsFilter } from "../hooks/usePoolsFilter";
import { usePoolsOnChain } from "../hooks/usePoolsOnChain";

// Config “base” delle pool: nomi, tag, APR “di marketing”
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
  // Dati on-chain (TVL, volume 24h, fees 24h, posizione LP, ecc.)
  const { pools: onChainPools, loading, error } = usePoolsOnChain(
    BASE_POOLS,
    address,
    chainId
  );

  // Filtri / search / sort lato UI
  const {
    activeFilter,
    setActiveFilter,
    search,
    setSearch,
    sort,
    setSort,
    filtered,
  } = usePoolsFilter(onChainPools);

  // Stato per il modal “Add liquidity”
  const [selectedPool, setSelectedPool] = useState(null);
  const [showDeposit, setShowDeposit] = useState(false);

  const handleOpenDeposit = (pool) => {
    if (!pool) return;
    setSelectedPool(pool);
    setShowDeposit(true);
  };

  const handleCloseDeposit = () => {
    setShowDeposit(false);
    setSelectedPool(null);
  };

  return (
    <section className="w-full px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
      <div className="max-w-6xl mx-auto space-y-6 lg:space-y-8">
        {/* Header + banner tipo Aerodrome */}
        <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2fr,1.3fr] items-stretch">
          <LiquidityHeaderCard />
          <LiquidityHeroBanner />
        </div>

        {/* Filtri + search + sort */}
        <LiquidityFilters
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
          search={search}
          setSearch={setSearch}
          sort={sort}
          setSort={setSort}
        />

        {/* Eventuale errore nel fetch on-chain */}
        {error && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-[11px] text-amber-100">
            Failed to load on-chain pool data: {error}
          </div>
        )}

        {/* Tabella pools con TVL/fees/volume e pulsante Deposit */}
        <PoolsTable
          pools={filtered}
          loading={loading}
          onDepositPool={handleOpenDeposit}
        />
      </div>

      {/* Modal Add liquidity */}
      {showDeposit && selectedPool && (
        <AddLiquidityModal
          isOpen={showDeposit}
          onClose={handleCloseDeposit}
          pool={selectedPool}
          address={address}
          chainId={chainId}
        />
      )}
    </section>
  );
}
