// src/hooks/usePoolsOnChain.js

import { useQuery } from "@tanstack/react-query";
import { BrowserProvider, Contract } from "ethers";

import {
  UNISWAP_V2_FACTORY,
  UNISWAP_V2_FACTORY_ABI,
  UNISWAP_V2_PAIR_ABI,
  SEPOLIA_CHAIN_ID_HEX,
} from "../config/uniswapSepolia";

import { TOKENS } from "../config/tokenRegistry";

// Prezzi fittizi per testnet (solo per dare numeri "umani" in USD)
const TEST_PRICES_USD = {
  ETH: 3000,
  WETH: 3000,
  USDC: 1,
  DAI: 1,
  WBTC: 60000,
  CXT: 1,
};

function formatUsd(value) {
  if (value == null || Number.isNaN(value)) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatPct(value) {
  if (value == null || Number.isNaN(value)) return "—";
  if (value === 0) return "0%";
  if (value < 0.01) return "<0.01%";
  return `${value.toFixed(2)}%`;
}

// Helper: costruisce la versione "vuota" di una pool se non abbiamo dati on-chain
function buildEmptyPool(bp, options = {}) {
  return {
    ...bp,
    pairAddress: options.pairAddress ?? null,
    hasOnChainPool: options.hasOnChainPool ?? false,
    tvlUsd: null,
    tvlLabel: options.tvlLabel ?? "—",
    volume24hUsd: null,
    volume24hLabel: "—",
    fees24hUsd: null,
    fees24hLabel: "—",
    userLpRaw: 0n,
    userLpLabel: "—",
    userSharePct: 0,
    userShareLabel: "—",
    userTvlUsd: null,
    userTvlLabel: "—",
  };
}

/**
 * Funzione che carica i dati on-chain delle pool da Uniswap V2 su Sepolia.
 * È "pura" e usata da React Query.
 */
async function fetchPoolsOnChain({ queryKey }) {
  const [_key, { basePools, address, chainId }] = queryKey;

  // Se non c'è window.ethereum, ritorniamo solo i dati base "vuoti"
  if (typeof window === "undefined" || !window.ethereum) {
    return basePools.map((bp) => buildEmptyPool(bp));
  }

  // Se non siamo su Sepolia, ritorniamo le pool "vuote"
  const isSepolia = chainId === SEPOLIA_CHAIN_ID_HEX || !chainId;
  if (!isSepolia) {
    return basePools.map((bp) =>
      buildEmptyPool(bp, { tvlLabel: "Wrong network" })
    );
  }

  const provider = new BrowserProvider(window.ethereum);
  const factory = new Contract(
    UNISWAP_V2_FACTORY,
    UNISWAP_V2_FACTORY_ABI,
    provider
  );

  const currentBlock = await provider.getBlockNumber();
  // Approx 24h worth of blocks (12s/block ~ 7200 blocks)
  const BLOCKS_24H = 7200;
  const fromBlock =
    currentBlock > BLOCKS_24H ? currentBlock - BLOCKS_24H : 0;

  const results = [];

  for (const bp of basePools) {
    const [symA, symB] = bp.tokens;
    const tokenA = TOKENS[symA];
    const tokenB = TOKENS[symB];

    if (!tokenA?.address || !tokenB?.address) {
      results.push(buildEmptyPool(bp));
      continue;
    }

    const pairAddress = await factory.getPair(
      tokenA.address,
      tokenB.address
    );

    if (
      !pairAddress ||
      pairAddress === "0x0000000000000000000000000000000000000000"
    ) {
      results.push(
        buildEmptyPool(bp, {
          tvlLabel: "No pool",
        })
      );
      continue;
    }

    const pair = new Contract(
      pairAddress,
      UNISWAP_V2_PAIR_ABI,
      provider
    );

    // ---------- TVL ----------
    const token0Addr = (await pair.token0()).toLowerCase();
    const [reserve0, reserve1] = await pair.getReserves();

    const addrA = tokenA.address.toLowerCase();
    const addrB = tokenB.address.toLowerCase();

    let reserveA, reserveB;
    const decA = tokenA.decimals || 18;
    const decB = tokenB.decimals || 18;

    if (token0Addr === addrA) {
      reserveA = reserve0;
      reserveB = reserve1;
    } else if (token0Addr === addrB) {
      reserveA = reserve1;
      reserveB = reserve0;
    } else {
      reserveA = reserve0;
      reserveB = reserve1;
    }

    const amountA = Number(reserveA) / Math.pow(10, decA);
    const amountB = Number(reserveB) / Math.pow(10, decB);

    const priceA = TEST_PRICES_USD[symA] ?? 1;
    const priceB = TEST_PRICES_USD[symB] ?? 1;

    const tvlUsd = amountA * priceA + amountB * priceB;

    // ---------- VOLUME & FEES 24H ----------
    let volume24hUsd = 0;

    try {
      const swapFilter = pair.filters.Swap();
      const swaps = await pair.queryFilter(
        swapFilter,
        fromBlock,
        currentBlock
      );

      for (const ev of swaps) {
        const a0In = Number(ev.args.amount0In || 0n);
        const a1In = Number(ev.args.amount1In || 0n);
        const a0Out = Number(ev.args.amount0Out || 0n);
        const a1Out = Number(ev.args.amount1Out || 0n);

        const vol0 =
          (a0In + a0Out) / Math.pow(10, decA);
        const vol1 =
          (a1In + a1Out) / Math.pow(10, decB);

        const usd0 = vol0 * priceA;
        const usd1 = vol1 * priceB;

        const tradeUsd = (usd0 + usd1) / 2;
        volume24hUsd += tradeUsd;
      }
    } catch (e) {
      console.warn(
        `Failed to fetch Swap events for pair ${pairAddress}`,
        e
      );
    }

    const fees24hUsd = volume24hUsd * 0.003; // 0.3%

    // ---------- USER LP POSITION ----------
    let userLpRaw = 0n;
    let totalSupplyRaw = 0n;
    let userSharePct = 0;
    let userTvlUsd = null;

    try {
      totalSupplyRaw = await pair.totalSupply();

      if (address) {
        userLpRaw = await pair.balanceOf(address);
      }

      if (totalSupplyRaw > 0n && userLpRaw > 0n) {
        const lpUser = Number(userLpRaw);
        const lpTotal = Number(totalSupplyRaw);

        if (lpTotal > 0) {
          userSharePct = (lpUser / lpTotal) * 100;
          userTvlUsd = tvlUsd * (lpUser / lpTotal);
        }
      }
    } catch (e) {
      console.warn(
        `Failed to fetch LP data for pair ${pairAddress}`,
        e
      );
    }

    results.push({
      ...bp,
      pairAddress,
      hasOnChainPool: true,
      tvlUsd,
      tvlLabel: formatUsd(tvlUsd),
      volume24hUsd,
      volume24hLabel: volume24hUsd
        ? formatUsd(volume24hUsd)
        : "—",
      fees24hUsd,
      fees24hLabel: fees24hUsd ? formatUsd(fees24hUsd) : "—",

      userLpRaw,
      userLpLabel:
        userLpRaw > 0n ? `${userLpRaw.toString()} LP` : "—",
      userSharePct,
      userShareLabel:
        userSharePct > 0 ? formatPct(userSharePct) : "—",
      userTvlUsd,
      userTvlLabel:
        userTvlUsd != null ? formatUsd(userTvlUsd) : "—",
    });
  }

  return results;
}

/**
 * Hook React Query:
 * - usa fetchPoolsOnChain come queryFn
 * - cache, auto-refresh, refetch on focus, retry, ecc.
 */
export function usePoolsOnChain(basePools, address, chainId, options = {}) {
  const {
    enabled = true,
    refetchInterval, // se vuoi override rispetto ai 15s globali
  } = options;

  const query = useQuery({
    queryKey: [
      "poolsOnChain",
      {
        basePools,
        address: address || null,
        chainId: chainId || null,
      },
    ],
    queryFn: fetchPoolsOnChain,
    enabled,
    // Lasciamo usare il default globale se non passiamo refetchInterval:
    ...(refetchInterval != null ? { refetchInterval } : {}),
  });

  const pools = query.data ?? basePools.map((bp) => buildEmptyPool(bp));

  return {
    pools,
    loading: query.isLoading && !query.data,
    error: query.isError ? query.error?.message || "Failed to load pools." : null,
    refetch: query.refetch,
    query, // se ti serve più info (isFetching, status, ecc.)
  };
}
