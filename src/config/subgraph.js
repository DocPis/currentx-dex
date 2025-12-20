// src/config/subgraph.js
const SUBGRAPH_URL = import.meta.env.VITE_UNIV2_SUBGRAPH;
const SUBGRAPH_API_KEY = import.meta.env.VITE_UNIV2_SUBGRAPH_API_KEY;

async function postSubgraph(query, variables = {}) {
  if (!SUBGRAPH_URL) {
    throw new Error("Missing VITE_UNIV2_SUBGRAPH env var");
  }

  const headers = {
    "Content-Type": "application/json",
  };

  if (SUBGRAPH_API_KEY) {
    headers.Authorization = `Bearer ${SUBGRAPH_API_KEY}`;
  }

  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Subgraph HTTP ${res.status}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || "Subgraph error");
  }
  return json.data;
}

// Fetch Uniswap V2 pair data (tvl, 24h volume) by token addresses
// Falls back to pairCreateds when the schema does not expose `pairs`
export async function fetchV2PairData(tokenA, tokenB) {
  const tokenALower = tokenA.toLowerCase();
  const tokenBLower = tokenB.toLowerCase();

  const mainQuery = `
    query PairData($tokenA: String!, $tokenB: String!) {
      pairs(
        first: 1
        where: {
          token0_in: [$tokenA, $tokenB]
          token1_in: [$tokenA, $tokenB]
        }
      ) {
        id
        reserveUSD
        volumeUSD
        token0 { id symbol }
        token1 { id symbol }
      }
    }
  `;

  const pairDayQuery = `
    query PairDay($pairId: Bytes!) {
      pairDayDatas(
        first: 1
        where: { pairAddress: $pairId }
        orderBy: date
        orderDirection: desc
      ) {
        date
        dailyVolumeUSD
        reserveUSD
      }
    }
  `;

  try {
    const data = await postSubgraph(mainQuery, {
      tokenA: tokenALower,
      tokenB: tokenBLower,
    });

    const pair = data?.pairs?.[0];
    if (!pair) {
      return {
        pairId: null,
        tvlUsd: undefined,
        volume24hUsd: undefined,
        fees24hUsd: undefined,
        note: "Pair not found in subgraph; live TVL/volume unavailable.",
      };
    }

    const dayRes = await postSubgraph(pairDayQuery, { pairId: pair.id });
    const day = dayRes?.pairDayDatas?.[0];
    const tvlUsd = Number(pair.reserveUSD || 0);
    const volume24hUsd = Number(day?.dailyVolumeUSD || 0);
    const fees24hUsd = volume24hUsd * 0.003; // 0.30% fee tier

    return {
      pairId: pair.id,
      tvlUsd,
      volume24hUsd,
      fees24hUsd,
    };
  } catch (err) {
    const message = err?.message || "";
    const noPairsField =
      message.includes("Type `Query` has no field `pairs`") ||
      message.includes('Cannot query field "pairs"');

    if (!noPairsField) {
      throw err;
    }

    // Fallback for schemas that only expose pairCreateds events
    const fallbackQuery = `
      query PairCreated($tokenA: String!, $tokenB: String!) {
        pairCreateds(
          first: 1
          where: {
            token0_in: [$tokenA, $tokenB]
            token1_in: [$tokenA, $tokenB]
          }
          orderBy: blockNumber
          orderDirection: desc
        ) {
          id
          token0
          token1
          pair
        }
      }
    `;

    const data = await postSubgraph(fallbackQuery, {
      tokenA: tokenALower,
      tokenB: tokenBLower,
    });

    const evt = data?.pairCreateds?.[0];
    if (evt) {
      return {
        pairId: evt.pair || evt.id,
        tvlUsd: undefined,
        volume24hUsd: undefined,
        fees24hUsd: undefined,
        note:
          "Live TVL/volume unavailable: subgraph schema lacks `pairs` (using pairCreateds fallback).",
      };
    }

    // Final fallback: show the most recent pair, regardless of tokens, to avoid blank UI
    const catchAllQuery = `
      query LastPairCreated {
        pairCreateds(
          first: 1
          orderBy: blockNumber
          orderDirection: desc
        ) {
          id
          token0
          token1
          pair
        }
      }
    `;

    const catchAll = await postSubgraph(catchAllQuery);
    const any = catchAll?.pairCreateds?.[0];
    if (any) {
      return {
        pairId: any.pair || any.id,
        tvlUsd: undefined,
        volume24hUsd: undefined,
        fees24hUsd: undefined,
        note:
          "Pair not found for the configured tokens; showing the most recent pairCreated (no live TVL/volume).",
      };
    }

    throw new Error(
      "No pairCreateds found in subgraph; check indexing or schema."
    );
  }
}

// Fetch global dashboard stats; tries Uniswap V2 naming first, then generic factory
export async function fetchDashboardStats() {
  const primaryQuery = `
    query Dashboard {
      uniswapFactories(first: 1) {
        totalLiquidityUSD
        totalVolumeUSD
        pairCount
        txCount
      }
    }
  `;

  const parseFactory = (factory) => ({
    totalLiquidityUsd: Number(factory?.totalLiquidityUSD || 0),
    totalVolumeUsd: Number(factory?.totalVolumeUSD || 0),
    pairCount: Number(factory?.pairCount || 0),
    txCount: Number(factory?.txCount || 0),
  });

  try {
    const data = await postSubgraph(primaryQuery);
    const factory = data?.uniswapFactories?.[0];
    if (factory) return parseFactory(factory);
    throw new Error("No factory data");
  } catch (err) {
    const message = err?.message || "";
    const noFactoriesField =
      message.includes("Type `Query` has no field `uniswapFactories`") ||
      message.includes('Cannot query field "uniswapFactories"');
    if (noFactoriesField) return null;
    throw err;
  }
}

// Fetch protocol-level daily history (TVL + volume) for the last `days`
export async function fetchProtocolHistory(days = 7) {
  const historyQuery = `
    query ProtocolHistory($days: Int!) {
      uniswapDayDatas(
        first: $days
        orderBy: date
        orderDirection: desc
      ) {
        date
        totalLiquidityUSD
        dailyVolumeUSD
        totalVolumeUSD
      }
    }
  `;

  try {
    const res = await postSubgraph(historyQuery, { days });
    const history = res?.uniswapDayDatas || [];
    return history.map((d) => ({
      date: Number(d.date) * 1000,
      tvlUsd: Number(d.totalLiquidityUSD || 0),
      volumeUsd: Number(d.dailyVolumeUSD || 0),
      cumulativeVolumeUsd: Number(d.totalVolumeUSD || 0),
    }));
  } catch (err) {
    const message = err?.message || "";
    const noDayField =
      message.includes("Type `Query` has no field `uniswapDayDatas`") ||
      message.includes('Cannot query field "uniswapDayDatas"');

    if (noDayField) {
      return [];
    }
    throw err;
  }
}

// Fetch recent pair day data for a token pair (sorted desc by date)
export async function fetchPairHistory(tokenA, tokenB, days = 7) {
  const tokenALower = tokenA.toLowerCase();
  const tokenBLower = tokenB.toLowerCase();

  const pairQuery = `
    query PairForHistory($tokenA: String!, $tokenB: String!) {
      pairs(
        first: 1
        where: {
          token0_in: [$tokenA, $tokenB]
          token1_in: [$tokenA, $tokenB]
        }
      ) {
        id
      }
    }
  `;

  const historyQuery = `
    query PairHistory($pairId: Bytes!, $days: Int!) {
      pairDayDatas(
        first: $days
        where: { pairAddress: $pairId }
        orderBy: date
        orderDirection: desc
      ) {
        date
        reserveUSD
        dailyVolumeUSD
      }
    }
  `;

  try {
    const pairRes = await postSubgraph(pairQuery, {
      tokenA: tokenALower,
      tokenB: tokenBLower,
    });

    const pair = pairRes?.pairs?.[0];
    if (!pair?.id) return [];

    const historyRes = await postSubgraph(historyQuery, {
      pairId: pair.id,
      days,
    });
    const history = historyRes?.pairDayDatas || [];
    return history.map((d) => ({
      date: Number(d.date) * 1000,
      tvlUsd: Number(d.reserveUSD || 0),
      volumeUsd: Number(d.dailyVolumeUSD || 0),
    }));
  } catch (err) {
    const message = err?.message || "";
    const noPairsField =
      message.includes("Type `Query` has no field `pairs`") ||
      message.includes('Cannot query field "pairs"');

    if (noPairsField) {
      // Schema lacks pairs/pairDayDatas; return empty to avoid hard failures.
      return [];
    }
    throw err;
  }
}
