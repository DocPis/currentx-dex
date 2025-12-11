// src/components/LiquiditySection.jsx

import React, { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, formatUnits } from "ethers";

import {
  SEPOLIA_CHAIN_ID_HEX,
  UNISWAP_V2_FACTORY,
  UNISWAP_V2_FACTORY_ABI,
  UNISWAP_V2_PAIR_ABI,
  WETH_ADDRESS,
  USDC_ADDRESS,
} from "../config/uniswapSepolia";

import { TOKEN_REGISTRY } from "../utils/tokenRegistry";
import RemoveLiquidityModal from "./RemoveLiquidityModal";

// Trova i metadati del token per simbolo
function findTokenMeta(symbol) {
  return TOKEN_REGISTRY.find(
    (t) => t.symbol.toUpperCase() === symbol.toUpperCase()
  );
}

// Iconcine dei due token
function TokenPairIcons({ token0Symbol, token1Symbol }) {
  const t0 = findTokenMeta(token0Symbol);
  const t1 = findTokenMeta(token1Symbol);

  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-3">
        {t0 && (
          <img
            src={t0.logo}
            alt={t0.symbol}
            className="h-7 w-7 rounded-full border border-slate-900 bg-slate-950 object-contain"
          />
        )}
        {t1 && (
          <img
            src={t1.logo}
            alt={t1.symbol}
            className="h-7 w-7 rounded-full border border-slate-900 bg-slate-950 object-contain"
          />
        )}
      </div>
      <span className="text-sm font-semibold text-slate-50">
        {token0Symbol} / {token1Symbol}
      </span>
    </div>
  );
}

export default function LiquiditySection({ address, chainId }) {
  const [loading, setLoading] = useState(false);
  const [pools, setPools] = useState([]);
  const [error, setError] = useState(null);

  const [selectedPool, setSelectedPool] = useState(null);
  const [showRemoveModal, setShowRemoveModal] = useState(false);

  // per forzare un reload dopo il remove
  const [reloadNonce, setReloadNonce] = useState(0);

  // Al momento tracciamo solo WETH/USDC
  const PAIRS_TO_TRACK = useMemo(
    () => [
      {
        symbol0: "WETH",
        symbol1: "USDC",
        token0: WETH_ADDRESS.toLowerCase(),
        token1: USDC_ADDRESS.toLowerCase(),
      },
    ],
    []
  );

  useEffect(() => {
    async function fetchPools() {
      setError(null);
      setPools([]);

      if (!window.ethereum) {
        console.warn("LiquiditySection: provider assente, non chiamo fetchPools");
        return;
      }
      if (!address) {
        console.warn("LiquiditySection: wallet non connesso");
        return;
      }
      if (chainId && chainId !== SEPOLIA_CHAIN_ID_HEX) {
        console.warn("LiquiditySection: chain diversa da Sepolia, niente fetch");
        return;
      }

      try {
        setLoading(true);

        const provider = new BrowserProvider(window.ethereum);

        const factory = new Contract(
          UNISWAP_V2_FACTORY,
          UNISWAP_V2_FACTORY_ABI,
          provider
        );

        console.log("Factory address from router:", UNISWAP_V2_FACTORY);

        const discoveredPools = [];

        for (const p of PAIRS_TO_TRACK) {
          console.log("Checking pair WETH/USDC");
          console.log("token0:", p.token0);
          console.log("token1:", p.token1);

          const pairAddress = await factory.getPair(p.token0, p.token1);

          if (
            !pairAddress ||
            pairAddress === "0x0000000000000000000000000000000000000000"
          ) {
            console.log("pair:", pairAddress, "(nessuna pool trovata)");
            continue;
          }

          console.log("pair:", pairAddress);

          const pairContract = new Contract(
            pairAddress,
            UNISWAP_V2_PAIR_ABI,
            provider
          );

          const [reserve0Raw, reserve1Raw] = await pairContract.getReserves();
          const totalSupplyRaw = await pairContract.totalSupply();
          const userLpRaw = await pairContract.balanceOf(address);

          const token0Meta = findTokenMeta(p.symbol0);
          const token1Meta = findTokenMeta(p.symbol1);

          const dec0 = token0Meta?.decimals ?? 18;
          const dec1 = token1Meta?.decimals ?? 18;

          const reserve0 = parseFloat(formatUnits(reserve0Raw, dec0));
          const reserve1 = parseFloat(formatUnits(reserve1Raw, dec1));
          const totalSupply = parseFloat(formatUnits(totalSupplyRaw, 18));
          const userLp = parseFloat(formatUnits(userLpRaw, 18));

          discoveredPools.push({
            id: `${p.symbol0}-${p.symbol1}`,
            pairAddress,
            token0Symbol: p.symbol0,
            token1Symbol: p.symbol1,
            token0Address: p.token0,
            token1Address: p.token1,
            reserve0,
            reserve1,
            totalSupply,
            userLp,
            reserve0Raw,
            reserve1Raw,
            totalSupplyRaw,
            userLpRaw,
            dec0,
            dec1,
          });
        }

        setPools(discoveredPools);
      } catch (err) {
        console.error("fetchPools error:", err);
        setError("Error loading pools.");
      } finally {
        setLoading(false);
      }
    }

    fetchPools();
  }, [address, chainId, PAIRS_TO_TRACK, reloadNonce]);

  const handleOpenRemove = (pool) => {
    setSelectedPool(pool);
    setShowRemoveModal(true);
  };

  const handleCloseRemove = () => {
    setShowRemoveModal(false);
    setSelectedPool(null);
  };

  const handleRemoved = () => {
    // dopo il remove, ricarica le pool
    setReloadNonce((n) => n + 1);
  };

  // --------- RENDER ---------

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-50">
          Provide liquidity. Earn CXT emissions.
        </h2>
        <p className="text-sm text-slate-400">
          Earn swap fees and CXT by providing liquidity to core pools.
        </p>
      </div>

      {loading && (
        <div className="rounded-xl bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
          Loading pools…
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-900/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {!loading && !error && pools.length === 0 && (
        <div className="rounded-xl bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-400">
          No pools found on this network.
        </div>
      )}

      {!loading &&
        !error &&
        pools.length > 0 &&
        pools.map((pool) => (
          <div
            key={pool.id}
            className="flex items-center justify-between rounded-xl bg-slate-900/80 px-5 py-4 shadow-lg shadow-black/40"
          >
            <div className="flex flex-col gap-2">
              <TokenPairIcons
                token0Symbol={pool.token0Symbol}
                token1Symbol={pool.token1Symbol}
              />

              <p className="text-xs text-slate-400">
                Reserves:{" "}
                <span className="text-slate-200">
                  {pool.reserve0} {pool.token0Symbol}
                </span>{" "}
                ·{" "}
                <span className="text-slate-200">
                  {pool.reserve1} {pool.token1Symbol}
                </span>
              </p>

              <p className="text-xs text-slate-400">
                Total supply:{" "}
                <span className="text-slate-200">
                  {pool.totalSupply.toFixed(12)} LP
                </span>{" "}
                — Your LP:{" "}
                <span className="text-teal-300">
                  {pool.userLp.toFixed(12)} LP
                </span>
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => handleOpenRemove(pool)}
                className="rounded-full bg-rose-500 px-4 py-2 text-xs font-semibold text-slate-50 shadow-md shadow-rose-900/40 transition hover:bg-rose-400 hover:shadow-rose-800/60"
              >
                Remove
              </button>
            </div>
          </div>
        ))}

      {showRemoveModal && selectedPool && (
        <RemoveLiquidityModal
          isOpen={showRemoveModal}
          onClose={handleCloseRemove}
          pool={selectedPool}
          onRemoved={handleRemoved}
        />
      )}
    </section>
  );
}
