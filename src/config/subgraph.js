// src/config/subgraph.js
const SUBGRAPH_URL = import.meta.env.VITE_UNIV2_SUBGRAPH;

async function postSubgraph(query, variables = {}) {
  if (!SUBGRAPH_URL) {
    throw new Error("Missing VITE_UNIV2_SUBGRAPH env var");
  }

  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
export async function fetchV2PairData(tokenA, tokenB) {
  const query = `
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
        pairDayDatas(
          first: 1
          orderBy: date
          orderDirection: desc
        ) {
          date
          dailyVolumeUSD
          reserveUSD
        }
      }
    }
  `;

  const data = await postSubgraph(query, {
    tokenA: tokenA.toLowerCase(),
    tokenB: tokenB.toLowerCase(),
  });

  const pair = data?.pairs?.[0];
  if (!pair) throw new Error("Pair not found in subgraph");

  const day = pair.pairDayDatas?.[0];
  const tvlUsd = Number(pair.reserveUSD || 0);
  const volume24hUsd = Number(day?.dailyVolumeUSD || 0);
  const fees24hUsd = volume24hUsd * 0.003; // 0.30% fee tier

  return {
    pairId: pair.id,
    tvlUsd,
    volume24hUsd,
    fees24hUsd,
  };
}
