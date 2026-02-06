// src/config/subgraph.js
import { getActiveNetworkConfig } from "./networks";

const env = typeof import.meta !== "undefined" ? import.meta.env || {} : {};
const activeNet = getActiveNetworkConfig() || {};
let SUBGRAPH_URL = activeNet.subgraphUrl;
let SUBGRAPH_API_KEY = activeNet.subgraphApiKey;
let SUBGRAPH_V3_URL = activeNet.v3SubgraphUrl || "";
let SUBGRAPH_V3_API_KEY = activeNet.v3SubgraphApiKey || "";
const SUBGRAPH_CACHE_TTL_MS = 20000;
const SUBGRAPH_MAX_RETRIES = 2;
const subgraphCache = new Map();
const subgraphCacheV3 = new Map();
const SUBGRAPH_PROXY =
  (typeof import.meta !== "undefined" ? import.meta.env?.VITE_SUBGRAPH_PROXY : null) ||
  "";

// Fallback to global env when missing (align behavior across networks).
if (!SUBGRAPH_URL) {
  SUBGRAPH_URL = env.VITE_UNIV2_SUBGRAPH || "";
}
if (!SUBGRAPH_API_KEY) {
  SUBGRAPH_API_KEY = env.VITE_UNIV2_SUBGRAPH_API_KEY || "";
}
if (!SUBGRAPH_V3_URL) {
  SUBGRAPH_V3_URL = env.VITE_UNIV3_SUBGRAPH || "";
}
if (!SUBGRAPH_V3_API_KEY) {
  SUBGRAPH_V3_API_KEY = env.VITE_UNIV3_SUBGRAPH_API_KEY || "";
}
const SUBGRAPH_MISSING_KEY =
  SUBGRAPH_URL &&
  !SUBGRAPH_API_KEY &&
  (SUBGRAPH_URL.includes("thegraph.com") || SUBGRAPH_URL.includes("gateway"));
const SUBGRAPH_V3_MISSING_KEY =
  SUBGRAPH_V3_URL &&
  !SUBGRAPH_V3_API_KEY &&
  (SUBGRAPH_V3_URL.includes("thegraph.com") || SUBGRAPH_V3_URL.includes("gateway"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function postSubgraph(query, variables = {}) {
  if (!SUBGRAPH_URL) {
    throw new Error("Missing VITE_UNIV2_SUBGRAPH env var");
  }

  const cacheKey = JSON.stringify({ q: query, v: variables });
  const cached = subgraphCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < SUBGRAPH_CACHE_TTL_MS) {
    return cached.data;
  }

  const buildHeaders = (useProxy) => {
    const headers = {
      "Content-Type": "application/json",
    };
    if (SUBGRAPH_API_KEY && !useProxy) {
      headers.Authorization = `Bearer ${SUBGRAPH_API_KEY}`;
    }
    return headers;
  };

  let lastError = null;
  let attemptedProxy = false;
  for (let attempt = 0; attempt <= SUBGRAPH_MAX_RETRIES; attempt += 1) {
    try {
      const useProxy = attemptedProxy && Boolean(SUBGRAPH_PROXY);
      const url = useProxy
        ? `${SUBGRAPH_PROXY}${encodeURIComponent(SUBGRAPH_URL)}`
        : SUBGRAPH_URL;
      const res = await fetch(url, {
        method: "POST",
        headers: buildHeaders(useProxy),
        body: JSON.stringify({ query, variables }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const rateLimited =
          res.status === 429 ||
          text.toLowerCase().includes("rate") ||
          text.toLowerCase().includes("limit");
        lastError = new Error(rateLimited ? "Subgraph rate-limited. Please retry shortly." : `Subgraph HTTP ${res.status}`);
        if (attempt < SUBGRAPH_MAX_RETRIES && (res.status >= 500 || rateLimited)) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        throw lastError;
      }

      const json = await res.json();
      if (json.errors?.length) {
        throw new Error(json.errors[0]?.message || "Subgraph error");
      }
      subgraphCache.set(cacheKey, { ts: now, data: json.data });
      return json.data;
    } catch (err) {
      const msg = (err?.message || "").toLowerCase();
      const transient =
        msg.includes("fetch") ||
        msg.includes("network") ||
        msg.includes("timeout") ||
        msg.includes("rate");
      const corsLikely = msg.includes("cors") || msg.includes("failed to fetch");
      if (!attemptedProxy && corsLikely && SUBGRAPH_PROXY) {
        attemptedProxy = true;
        // retry immediately with proxy
        attempt -= 1;
        continue;
      }
      lastError = err;
      if (attempt < SUBGRAPH_MAX_RETRIES && transient) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  throw lastError || new Error("Subgraph unavailable");
}

async function postSubgraphV3(query, variables = {}) {
  if (!SUBGRAPH_V3_URL) {
    throw new Error("Missing VITE_UNIV3_SUBGRAPH env var");
  }

  const cacheKey = JSON.stringify({ q: query, v: variables });
  const cached = subgraphCacheV3.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < SUBGRAPH_CACHE_TTL_MS) {
    return cached.data;
  }

  const buildHeaders = (useProxy) => {
    const headers = {
      "Content-Type": "application/json",
    };
    if (SUBGRAPH_V3_API_KEY && !useProxy) {
      headers.Authorization = `Bearer ${SUBGRAPH_V3_API_KEY}`;
    }
    return headers;
  };

  let lastError = null;
  let attemptedProxy = false;
  for (let attempt = 0; attempt <= SUBGRAPH_MAX_RETRIES; attempt += 1) {
    try {
      const useProxy = attemptedProxy && Boolean(SUBGRAPH_PROXY);
      const url = useProxy
        ? `${SUBGRAPH_PROXY}${encodeURIComponent(SUBGRAPH_V3_URL)}`
        : SUBGRAPH_V3_URL;
      const res = await fetch(url, {
        method: "POST",
        headers: buildHeaders(useProxy),
        body: JSON.stringify({ query, variables }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const rateLimited =
          res.status === 429 ||
          text.toLowerCase().includes("rate") ||
          text.toLowerCase().includes("limit");
        lastError = new Error(rateLimited ? "Subgraph rate-limited. Please retry shortly." : `Subgraph HTTP ${res.status}`);
        if (attempt < SUBGRAPH_MAX_RETRIES && (res.status >= 500 || rateLimited)) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        throw lastError;
      }

      const json = await res.json();
      if (json.errors?.length) {
        throw new Error(json.errors[0]?.message || "Subgraph error");
      }
      subgraphCacheV3.set(cacheKey, { ts: now, data: json.data });
      return json.data;
    } catch (err) {
      const msg = (err?.message || "").toLowerCase();
      const transient =
        msg.includes("fetch") ||
        msg.includes("network") ||
        msg.includes("timeout") ||
        msg.includes("rate");
      const corsLikely = msg.includes("cors") || msg.includes("failed to fetch");
      if (!attemptedProxy && corsLikely && SUBGRAPH_PROXY) {
        attemptedProxy = true;
        // retry immediately with proxy
        attempt -= 1;
        continue;
      }
      lastError = err;
      if (attempt < SUBGRAPH_MAX_RETRIES && transient) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  throw lastError || new Error("Subgraph unavailable");
}

// Fetch Uniswap V2 pair data (tvl, 24h volume) by token addresses
// Falls back to pairCreateds when the schema does not expose `pairs`
export async function fetchV2PairData(tokenA, tokenB) {
  if (SUBGRAPH_MISSING_KEY) {
    return {
      pairId: null,
      tvlUsd: undefined,
      volume24hUsd: undefined,
      fees24hUsd: undefined,
      note: "Subgraph key missing; skipping live TVL/volume.",
    };
  }
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

  const pairDayQuery = (field = "pairAddress") => `
    query PairDay($pairId: Bytes!) {
      pairDayDatas(
        first: 1
        where: { ${field}: $pairId }
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

    const tvlUsd = Number(pair.reserveUSD || 0);

    const fetchDailyVolume = async () => {
      try {
        const dayRes = await postSubgraph(pairDayQuery("pairAddress"), { pairId: pair.id });
        const day = dayRes?.pairDayDatas?.[0];
        if (day?.dailyVolumeUSD !== undefined) return Number(day.dailyVolumeUSD || 0);
      } catch (err) {
        const msg = err?.message || "";
        const missingField =
          msg.includes("pairAddress") || msg.includes('Cannot query field "pairAddress"');
        if (!missingField) throw err;
      }
      // Fallback for schemas that expose `pair` instead of `pairAddress`
      try {
        const dayRes = await postSubgraph(pairDayQuery("pair"), { pairId: pair.id });
        const day = dayRes?.pairDayDatas?.[0];
        if (day?.dailyVolumeUSD !== undefined) return Number(day.dailyVolumeUSD || 0);
      } catch {
        // swallow and return 0 to avoid blocking TVL display
      }
      return 0;
    };

    const volume24hUsd = await fetchDailyVolume();
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

const isSchemaFieldMissing = (message = "") =>
  message.includes("Cannot query field") || message.includes("has no field");

// Fetch V3 factory stats (TVL + volume). Uses several schema variants for safety.
export async function fetchDashboardStatsV3() {
  if (SUBGRAPH_V3_MISSING_KEY) return null;

  const candidates = [
    {
      field: "factories",
      query: `
        query DashboardV3 {
          factories(first: 1) {
            totalValueLockedUSD
            totalVolumeUSD
          }
        }
      `,
      map: (factory) => ({
        totalLiquidityUsd: Number(factory?.totalValueLockedUSD || 0),
        totalVolumeUsd: Number(factory?.totalVolumeUSD || 0),
      }),
    },
    {
      field: "factories",
      query: `
        query DashboardV3 {
          factories(first: 1) {
            totalLiquidityUSD
            totalVolumeUSD
          }
        }
      `,
      map: (factory) => ({
        totalLiquidityUsd: Number(factory?.totalLiquidityUSD || 0),
        totalVolumeUsd: Number(factory?.totalVolumeUSD || 0),
      }),
    },
    {
      field: "factories",
      query: `
        query DashboardV3 {
          factories(first: 1) {
            totalValueLockedUSD
            volumeUSD
          }
        }
      `,
      map: (factory) => ({
        totalLiquidityUsd: Number(factory?.totalValueLockedUSD || 0),
        totalVolumeUsd: Number(factory?.volumeUSD || 0),
      }),
    },
    {
      field: "uniswapV3Factories",
      query: `
        query DashboardV3 {
          uniswapV3Factories(first: 1) {
            totalValueLockedUSD
            totalVolumeUSD
          }
        }
      `,
      map: (factory) => ({
        totalLiquidityUsd: Number(factory?.totalValueLockedUSD || 0),
        totalVolumeUsd: Number(factory?.totalVolumeUSD || 0),
      }),
    },
    {
      field: "uniswapFactories",
      query: `
        query DashboardV3 {
          uniswapFactories(first: 1) {
            totalLiquidityUSD
            totalVolumeUSD
          }
        }
      `,
      map: (factory) => ({
        totalLiquidityUsd: Number(factory?.totalLiquidityUSD || 0),
        totalVolumeUsd: Number(factory?.totalVolumeUSD || 0),
      }),
    },
    {
      field: "factory",
      query: `
        query DashboardV3 {
          factory {
            totalValueLockedUSD
            totalVolumeUSD
          }
        }
      `,
      map: (factory) => ({
        totalLiquidityUsd: Number(factory?.totalValueLockedUSD || 0),
        totalVolumeUsd: Number(factory?.totalVolumeUSD || 0),
      }),
      single: true,
    },
  ];

  for (const candidate of candidates) {
    try {
      const res = await postSubgraphV3(candidate.query);
      const factory = candidate.single
        ? res?.[candidate.field]
        : res?.[candidate.field]?.[0];
      if (!factory) {
        continue;
      }
      return candidate.map(factory);
    } catch (err) {
      const message = err?.message || "";
      if (isSchemaFieldMissing(message)) {
        continue;
      }
      throw err;
    }
  }

  return null;
}

export async function fetchDashboardStatsCombined() {
  const [v2, v3] = await Promise.all([
    fetchDashboardStats(),
    fetchDashboardStatsV3(),
  ]);

  if (!v2 && !v3) return null;

  const totalLiquidityUsd =
    Number(v2?.totalLiquidityUsd || 0) + Number(v3?.totalLiquidityUsd || 0);
  const totalVolumeUsd =
    Number(v2?.totalVolumeUsd || 0) + Number(v3?.totalVolumeUsd || 0);

  return {
    totalLiquidityUsd,
    totalVolumeUsd,
    v2,
    v3,
  };
}

// Fetch protocol-level daily history (TVL + volume) for the last `days`
export async function fetchProtocolHistory(days = 7) {
  // Fetch extra days to cover occasional gaps where some dates may be missing
  const fetchCount = Math.min(1000, Math.max(days * 3, days + 5)); // subgraph first cap is 1000

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
    const res = await postSubgraph(historyQuery, { days: fetchCount });
    const history = res?.uniswapDayDatas || [];

    const normalized = history.map((d) => ({
      date: Number(d.date) * 1000,
      dayId: Math.floor(Number(d.date) / 86400), // UTC day id
      tvlUsd: Number(d.totalLiquidityUSD || 0),
      volumeUsd: Number(d.dailyVolumeUSD || 0),
      cumulativeVolumeUsd: Number(d.totalVolumeUSD || 0),
    }));

    const byDayId = new Map(normalized.map((d) => [d.dayId, d]));
    const todayDayId = Math.floor(Date.now() / 86400000);
    const result = [];
    let lastKnownTvl = null;

    for (let i = 0; i < days; i += 1) {
      const dayId = todayDayId - i;
      const entry = byDayId.get(dayId);

      if (entry) {
        lastKnownTvl = entry.tvlUsd;
        result.push({
          date: entry.date,
          tvlUsd: entry.tvlUsd,
          volumeUsd: entry.volumeUsd,
          cumulativeVolumeUsd: entry.cumulativeVolumeUsd,
        });
      } else {
        result.push({
          date: dayId * 86400000,
          tvlUsd: lastKnownTvl !== null ? lastKnownTvl : 0,
          volumeUsd: 0,
          cumulativeVolumeUsd: null,
        });
      }
    }

    return result;
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

export async function fetchProtocolHistoryV3(days = 7) {
  if (SUBGRAPH_V3_MISSING_KEY) return [];

  const fetchCount = Math.min(1000, Math.max(days * 3, days + 5));

  const candidates = [
    {
      field: "uniswapDayDatas",
      query: `
        query ProtocolHistoryV3($days: Int!) {
          uniswapDayDatas(
            first: $days
            orderBy: date
            orderDirection: desc
          ) {
            date
            volumeUSD
            totalVolumeUSD
            tvlUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.tvlUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        cumulativeVolumeUsd:
          d.totalVolumeUSD !== undefined ? Number(d.totalVolumeUSD || 0) : null,
      }),
    },
    {
      field: "uniswapDayDatas",
      query: `
        query ProtocolHistoryV3($days: Int!) {
          uniswapDayDatas(
            first: $days
            orderBy: date
            orderDirection: desc
          ) {
            date
            volumeUSD
            tvlUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.tvlUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        cumulativeVolumeUsd: null,
      }),
    },
    {
      field: "uniswapDayDatas",
      query: `
        query ProtocolHistoryV3($days: Int!) {
          uniswapDayDatas(
            first: $days
            orderBy: date
            orderDirection: desc
          ) {
            date
            volumeUSD
            totalVolumeUSD
            totalValueLockedUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.totalValueLockedUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        cumulativeVolumeUsd:
          d.totalVolumeUSD !== undefined ? Number(d.totalVolumeUSD || 0) : null,
      }),
    },
    {
      field: "uniswapDayDatas",
      query: `
        query ProtocolHistoryV3($days: Int!) {
          uniswapDayDatas(
            first: $days
            orderBy: date
            orderDirection: desc
          ) {
            date
            volumeUSD
            totalValueLockedUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.totalValueLockedUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        cumulativeVolumeUsd: null,
      }),
    },
    {
      field: "factoryDayDatas",
      query: `
        query ProtocolHistoryV3($days: Int!) {
          factoryDayDatas(
            first: $days
            orderBy: date
            orderDirection: desc
          ) {
            date
            volumeUSD
            totalVolumeUSD
            totalValueLockedUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.totalValueLockedUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        cumulativeVolumeUsd:
          d.totalVolumeUSD !== undefined ? Number(d.totalVolumeUSD || 0) : null,
      }),
    },
    {
      field: "factoryDayDatas",
      query: `
        query ProtocolHistoryV3($days: Int!) {
          factoryDayDatas(
            first: $days
            orderBy: date
            orderDirection: desc
          ) {
            date
            volumeUSD
            totalValueLockedUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.totalValueLockedUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        cumulativeVolumeUsd: null,
      }),
    },
  ];

  for (const candidate of candidates) {
    try {
      const res = await postSubgraphV3(candidate.query, { days: fetchCount });
      const rows = res?.[candidate.field] || [];
      if (!rows.length) {
        continue;
      }
      return rows.map(candidate.map);
    } catch (err) {
      const message = err?.message || "";
      if (isSchemaFieldMissing(message)) {
        continue;
      }
      throw err;
    }
  }

  return [];
}

const mergeProtocolHistory = (v2 = [], v3 = []) => {
  const map = new Map();

  const addEntry = (entry) => {
    if (!entry) return;
    const date = Number(entry.date || 0);
    if (!date) return;
    const dayId = Math.floor(date / 86400000);
    const existing = map.get(dayId) || {
      date,
      tvlUsd: 0,
      volumeUsd: 0,
      cumulativeVolumeUsd: 0,
      _cumCount: 0,
    };
    existing.date = Math.max(existing.date || 0, date);
    existing.tvlUsd += Number(entry.tvlUsd || 0);
    existing.volumeUsd += Number(entry.volumeUsd || 0);
    if (entry.cumulativeVolumeUsd !== null && entry.cumulativeVolumeUsd !== undefined) {
      existing.cumulativeVolumeUsd += Number(entry.cumulativeVolumeUsd || 0);
      existing._cumCount += 1;
    }
    map.set(dayId, existing);
  };

  v2.forEach(addEntry);
  v3.forEach(addEntry);

  const sources = [
    { entries: v2, hasCum: v2.some((d) => typeof d.cumulativeVolumeUsd === "number") },
    { entries: v3, hasCum: v3.some((d) => typeof d.cumulativeVolumeUsd === "number") },
  ].filter((s) => s.entries?.length);

  const requireCumulative = sources.length > 0 && sources.every((s) => s.hasCum);
  const expectedCumCount = requireCumulative ? sources.length : 0;

  return Array.from(map.values())
    .map((entry) => ({
      date: entry.date,
      tvlUsd: entry.tvlUsd,
      volumeUsd: entry.volumeUsd,
      cumulativeVolumeUsd:
        requireCumulative && entry._cumCount >= expectedCumCount
          ? entry.cumulativeVolumeUsd
          : null,
    }))
    .sort((a, b) => b.date - a.date);
};

export async function fetchProtocolHistoryCombined(days = 7) {
  const [v2, v3] = await Promise.all([
    fetchProtocolHistory(days),
    fetchProtocolHistoryV3(days),
  ]);
  return mergeProtocolHistory(v2, v3);
}

// Fetch latest on-chain activity (swaps, mints, burns) sorted by timestamp desc
export async function fetchRecentTransactions(limit = 12) {
  const pairLabel = (pair) => {
    const t0 = pair?.token0?.symbol || "Token0";
    const t1 = pair?.token1?.symbol || "Token1";
    return `${t0}/${t1}`;
  };

  const parseHash = (id = "") => id.split("-")[0] || id;
  const toNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const mapSwap = (s) => ({
    type: "Swap",
    pair: pairLabel(s?.pair),
    amountUsd: toNumber(s?.amountUSD),
    timestamp: Number(s?.timestamp || 0) * 1000,
    txHash: s?.transaction?.id ? parseHash(s.transaction.id) : parseHash(s?.id),
    account: s?.to || s?.sender || null,
  });

  const mapMint = (m) => ({
    type: "Mint",
    pair: pairLabel(m?.pair),
    amountUsd: toNumber(m?.amountUSD),
    timestamp: Number(m?.timestamp || 0) * 1000,
    txHash: m?.transaction?.id ? parseHash(m.transaction.id) : parseHash(m?.id),
    account: m?.to || m?.sender || null,
  });

  const mapBurn = (b) => ({
    type: "Burn",
    pair: pairLabel(b?.pair),
    amountUsd: toNumber(b?.amountUSD),
    timestamp: Number(b?.timestamp || 0) * 1000,
    txHash: b?.transaction?.id ? parseHash(b.transaction.id) : parseHash(b?.id),
    account: b?.to || b?.sender || null,
  });

  const safeQuery = async (query, field) => {
    try {
      const res = await postSubgraph(query, { limit });
      return res?.[field] || [];
    } catch (err) {
      const message = err?.message || "";
      const noField =
        message.includes(`Cannot query field "${field}"`) ||
        message.includes(`Type \`Query\` has no field \`${field}\``);
      if (noField) return [];
      throw err;
    }
  };

  const swapQuery = `
    query RecentSwaps($limit: Int!) {
      swaps(first: $limit, orderBy: timestamp, orderDirection: desc) {
        id
        timestamp
        amountUSD
        to
        sender
        transaction { id }
        pair { token0 { symbol } token1 { symbol } }
      }
    }
  `;

  const mintQuery = `
    query RecentMints($limit: Int!) {
      mints(first: $limit, orderBy: timestamp, orderDirection: desc) {
        id
        timestamp
        amountUSD
        sender
        to
        transaction { id }
        pair { token0 { symbol } token1 { symbol } }
      }
    }
  `;

  const burnQuery = `
    query RecentBurns($limit: Int!) {
      burns(first: $limit, orderBy: timestamp, orderDirection: desc) {
        id
        timestamp
        amountUSD
        sender
        to
        transaction { id }
        pair { token0 { symbol } token1 { symbol } }
      }
    }
  `;

  const [swaps, mints, burns] = await Promise.all([
    safeQuery(swapQuery, "swaps"),
    safeQuery(mintQuery, "mints"),
    safeQuery(burnQuery, "burns"),
  ]);

  const events = [
    ...swaps.map(mapSwap),
    ...mints.map(mapMint),
    ...burns.map(mapBurn),
  ]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);

  return events;
}

// Fetch token USD prices using derivedETH + bundle price (Uniswap V2 schema)
async function fetchTokenPricesV2(addresses = []) {
  if (SUBGRAPH_MISSING_KEY) return {};
  const ids = Array.from(
    new Set(
      (addresses || [])
        .filter(Boolean)
        .map((a) => a.toLowerCase())
    )
  );
  if (!ids.length) return {};

  const query = `
    query Tokens($ids: [Bytes!]!) {
      tokens(where: { id_in: $ids }) {
        id
        symbol
        derivedETH
      }
      bundles(first: 1) {
        ethPrice
      }
    }
  `;

  try {
    const res = await postSubgraph(query, { ids });
    const bundlePrice = Number(res?.bundles?.[0]?.ethPrice || 0);
    const out = {};
    (res?.tokens || []).forEach((t) => {
      const derivedEth = Number(t?.derivedETH || 0);
      if (!Number.isFinite(derivedEth) || derivedEth <= 0) return;
      const usd =
        bundlePrice && Number.isFinite(bundlePrice)
          ? derivedEth * bundlePrice
          : null;
      if (usd !== null && Number.isFinite(usd)) {
        out[(t.id || "").toLowerCase()] = usd;
      }
    });
    return out;
  } catch (err) {
    const message = err?.message || "";
    const noTokensField =
      message.includes("Cannot query field \"tokens\"") ||
      message.includes("Type `Query` has no field `tokens`");
    if (noTokensField) return {};
    throw err;
  }
}

async function fetchTokenPricesV3(addresses = []) {
  if (SUBGRAPH_V3_MISSING_KEY) return {};
  const ids = Array.from(
    new Set(
      (addresses || [])
        .filter(Boolean)
        .map((a) => a.toLowerCase())
    )
  );
  if (!ids.length) return {};

  const queries = [
    `
      query Tokens($ids: [Bytes!]!) {
        tokens(where: { id_in: $ids }) {
          id
          symbol
          derivedETH
        }
        bundles(first: 1) {
          ethPriceUSD
        }
      }
    `,
    `
      query Tokens($ids: [Bytes!]!) {
        tokens(where: { id_in: $ids }) {
          id
          symbol
          derivedETH
        }
        bundles(first: 1) {
          ethPrice
        }
      }
    `,
  ];

  for (const query of queries) {
    try {
      const res = await postSubgraphV3(query, { ids });
      const bundlePrice = Number(
        res?.bundles?.[0]?.ethPriceUSD || res?.bundles?.[0]?.ethPrice || 0
      );
      const out = {};
      (res?.tokens || []).forEach((t) => {
        const derivedEth = Number(t?.derivedETH || 0);
        if (!Number.isFinite(derivedEth) || derivedEth <= 0) return;
        const usd =
          bundlePrice && Number.isFinite(bundlePrice)
            ? derivedEth * bundlePrice
            : null;
        if (usd !== null && Number.isFinite(usd)) {
          out[(t.id || "").toLowerCase()] = usd;
        }
      });
      return out;
    } catch (err) {
      const message = err?.message || "";
      const noTokensField =
        message.includes("Cannot query field \"tokens\"") ||
        message.includes("Type `Query` has no field `tokens`");
      if (noTokensField) return {};
      // try the next schema variant
    }
  }

  return {};
}

export async function fetchTokenPrices(addresses = []) {
  const ids = Array.from(
    new Set(
      (addresses || [])
        .filter(Boolean)
        .map((a) => a.toLowerCase())
    )
  );
  if (!ids.length) return {};

  const v2Prices = await fetchTokenPricesV2(ids);
  const missing = ids.filter((id) => v2Prices[id] === undefined);
  if (!missing.length) return v2Prices;

  const v3Prices = await fetchTokenPricesV3(missing);
  return { ...v2Prices, ...v3Prices };
}

// Fetch top pairs by all-time volume (falling back gracefully if unavailable)
export async function fetchTopPairsBreakdown(limit = 4) {
  const safeQuery = async (query, field, variables = {}) => {
    try {
      const res = await postSubgraph(query, variables);
      return res?.[field] || [];
    } catch (err) {
      const message = err?.message || "";
      const noField =
        message.includes(`Cannot query field "${field}"`) ||
        message.includes(`Type \`Query\` has no field \`${field}\``);
      if (noField) return [];
      throw err;
    }
  };

  const finalLimit = Math.max(1, Math.min(Number(limit) || 4, 20));

  const [topPairsRes, factoryRes] = await Promise.all([
    safeQuery(
      `
        query TopPairs($limit: Int!) {
          pairs(
            first: $limit
            orderBy: volumeUSD
            orderDirection: desc
          ) {
            id
            volumeUSD
            reserveUSD
            token0 { symbol }
            token1 { symbol }
          }
        }
      `,
      "pairs",
      { limit: finalLimit }
    ),
    safeQuery(
      `
        query FactoryVolume {
          uniswapFactories(first: 1) {
            totalVolumeUSD
          }
        }
      `,
      "uniswapFactories"
    ),
  ]);

  const pairIds = topPairsRes.map((p) => p?.id).filter(Boolean);

  let pairMetaById = {};
  if (pairIds.length) {
    try {
      pairMetaById = Object.fromEntries(
        (topPairsRes || []).map((p) => [
          p.id?.toLowerCase(),
          {
            token0: p.token0,
            token1: p.token1,
          },
        ])
      );
    } catch {
      pairMetaById = {};
    }
  }

  const mapped = topPairsRes.map((p, idx) => {
    const pairId = (p?.id || "").toLowerCase();
    const meta = pairMetaById[pairId];
    const t0 = meta?.token0?.symbol || "Token0";
    const t1 = meta?.token1?.symbol || "Token1";
    const label = meta ? `${t0}-${t1}` : (pairId ? `${pairId.slice(0, 6)}...${pairId.slice(-4)}` : "Pair");
    const volumeUsd = Number(p?.volumeUSD || 0);
    const tvlUsd = Number(p?.reserveUSD || 0);
    return {
      id: pairId || `${label}-${idx}`,
      label,
      volumeUsd,
      tvlUsd,
    };
  });

  const filtered = mapped.filter((p) => p.volumeUsd > 0 || p.tvlUsd > 0);
  if (!filtered.length) return [];

  const top = filtered.slice(0, finalLimit);
  const factoryVolumeUsd = Number(factoryRes?.[0]?.totalVolumeUSD || 0);
  const volumeSumTop = top.reduce((sum, p) => sum + (p.volumeUsd || 0), 0);
  const tvlSumTop = top.reduce((sum, p) => sum + (p.tvlUsd || 0), 0);
  const baseTotal = factoryVolumeUsd || volumeSumTop || tvlSumTop;
  const baseIsTvl = !factoryVolumeUsd && volumeSumTop === 0;

  return top.map((p, idx) => {
    const baseValue = baseIsTvl ? p.tvlUsd : p.volumeUsd;
    const share = baseTotal ? (baseValue / baseTotal) * 100 : 0;
    return {
      ...p,
      share,
      rank: idx + 1,
    };
  });
}

const formatFeeTierLabel = (feeTier) => {
  const num = Number(feeTier);
  if (!Number.isFinite(num) || num <= 0) return "";
  const pct = num / 10000;
  return `${pct}%`;
};

// Fetch top V3 pools by all-time volume (fallback to TVL if needed)
export async function fetchTopPoolsBreakdownV3(limit = 4) {
  if (SUBGRAPH_V3_MISSING_KEY) return [];

  const finalLimit = Math.max(1, Math.min(Number(limit) || 4, 20));
  const candidates = [
    {
      query: `
        query TopPoolsV3($limit: Int!) {
          pools(
            first: $limit
            orderBy: volumeUSD
            orderDirection: desc
          ) {
            id
            volumeUSD
            totalValueLockedUSD
            feeTier
            token0 { symbol }
            token1 { symbol }
          }
        }
      `,
      map: (pool, idx) => {
        const t0 = pool?.token0?.symbol || "Token0";
        const t1 = pool?.token1?.symbol || "Token1";
        const feeLabel = formatFeeTierLabel(pool?.feeTier);
        const label = feeLabel ? `${t0}-${t1} (${feeLabel})` : `${t0}-${t1}`;
        return {
          id: (pool?.id || `${label}-${idx}`).toLowerCase(),
          label,
          volumeUsd: Number(pool?.volumeUSD || 0),
          tvlUsd: Number(pool?.totalValueLockedUSD || 0),
        };
      },
    },
    {
      query: `
        query TopPoolsV3($limit: Int!) {
          pools(
            first: $limit
            orderBy: volumeUSD
            orderDirection: desc
          ) {
            id
            volumeUSD
            feeTier
            token0 { symbol }
            token1 { symbol }
          }
        }
      `,
      map: (pool, idx) => {
        const t0 = pool?.token0?.symbol || "Token0";
        const t1 = pool?.token1?.symbol || "Token1";
        const feeLabel = formatFeeTierLabel(pool?.feeTier);
        const label = feeLabel ? `${t0}-${t1} (${feeLabel})` : `${t0}-${t1}`;
        return {
          id: (pool?.id || `${label}-${idx}`).toLowerCase(),
          label,
          volumeUsd: Number(pool?.volumeUSD || 0),
          tvlUsd: 0,
        };
      },
    },
  ];

  for (const candidate of candidates) {
    try {
      const res = await postSubgraphV3(candidate.query, { limit: finalLimit });
      const pools = res?.pools || [];
      if (!pools.length) return [];
      return pools.map(candidate.map);
    } catch (err) {
      const message = err?.message || "";
      if (isSchemaFieldMissing(message)) {
        continue;
      }
      throw err;
    }
  }

  return [];
}

export async function fetchTopPairsBreakdownCombined(limit = 4) {
  const finalLimit = Math.max(1, Math.min(Number(limit) || 4, 20));
  const [v2Pairs, v3Pools] = await Promise.all([
    fetchTopPairsBreakdown(finalLimit),
    fetchTopPoolsBreakdownV3(finalLimit),
  ]);

  const combined = [...(v2Pairs || []), ...(v3Pools || [])].filter(
    (p) => (p.volumeUsd || 0) > 0 || (p.tvlUsd || 0) > 0
  );

  if (!combined.length) return [];

  const volumeSum = combined.reduce((sum, p) => sum + (p.volumeUsd || 0), 0);
  const tvlSum = combined.reduce((sum, p) => sum + (p.tvlUsd || 0), 0);
  const useTvl = volumeSum === 0;
  const baseTotal = useTvl ? tvlSum : volumeSum;

  return combined
    .sort((a, b) =>
      useTvl
        ? (b.tvlUsd || 0) - (a.tvlUsd || 0)
        : (b.volumeUsd || 0) - (a.volumeUsd || 0)
    )
    .slice(0, finalLimit)
    .map((p, idx) => {
      const baseValue = useTvl ? p.tvlUsd : p.volumeUsd;
      const share = baseTotal ? (baseValue / baseTotal) * 100 : 0;
      return {
        ...p,
        share,
        rank: idx + 1,
      };
    });
}

const toNumberSafe = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export async function fetchV2PoolsPage({ limit = 50, skip = 0 } = {}) {
  if (SUBGRAPH_MISSING_KEY) return [];
  const first = Math.max(1, Math.min(Number(limit) || 50, 200));
  const offset = Math.max(0, Number(skip) || 0);

  const candidates = [
    `
      query V2Pools($first: Int!, $skip: Int!) {
        pairs(
          first: $first
          skip: $skip
          orderBy: reserveUSD
          orderDirection: desc
        ) {
          id
          reserveUSD
          volumeUSD
          token0 { id symbol }
          token1 { id symbol }
        }
      }
    `,
    `
      query V2Pools($first: Int!, $skip: Int!) {
        pairs(
          first: $first
          skip: $skip
          orderBy: volumeUSD
          orderDirection: desc
        ) {
          id
          reserveUSD
          volumeUSD
          token0 { id symbol }
          token1 { id symbol }
        }
      }
    `,
    `
      query V2Pools($first: Int!, $skip: Int!) {
        pairs(
          first: $first
          skip: $skip
        ) {
          id
          token0 { id symbol }
          token1 { id symbol }
        }
      }
    `,
  ];

  for (const query of candidates) {
    try {
      const res = await postSubgraph(query, { first, skip: offset });
      const pairs = res?.pairs || [];
      return pairs.map((pair) => ({
        id: pair?.id || "",
        token0Symbol: pair?.token0?.symbol || "",
        token1Symbol: pair?.token1?.symbol || "",
        token0Id: pair?.token0?.id || "",
        token1Id: pair?.token1?.id || "",
        tvlUsd: toNumberSafe(pair?.reserveUSD),
        volumeUsd: toNumberSafe(pair?.volumeUSD),
        type: "V2",
      }));
    } catch (err) {
      const message = err?.message || "";
      if (isSchemaFieldMissing(message)) {
        continue;
      }
      throw err;
    }
  }

  return [];
}

export async function fetchV3PoolsPage({ limit = 50, skip = 0 } = {}) {
  if (SUBGRAPH_V3_MISSING_KEY) return [];
  const first = Math.max(1, Math.min(Number(limit) || 50, 200));
  const offset = Math.max(0, Number(skip) || 0);

  const candidates = [
    `
      query V3Pools($first: Int!, $skip: Int!) {
        pools(
          first: $first
          skip: $skip
          orderBy: totalValueLockedUSD
          orderDirection: desc
        ) {
          id
          totalValueLockedUSD
          volumeUSD
          feeTier
          token0 { id symbol }
          token1 { id symbol }
        }
      }
    `,
    `
      query V3Pools($first: Int!, $skip: Int!) {
        pools(
          first: $first
          skip: $skip
          orderBy: volumeUSD
          orderDirection: desc
        ) {
          id
          totalValueLockedUSD
          volumeUSD
          feeTier
          token0 { id symbol }
          token1 { id symbol }
        }
      }
    `,
    `
      query V3Pools($first: Int!, $skip: Int!) {
        pools(
          first: $first
          skip: $skip
        ) {
          id
          volumeUSD
          feeTier
          token0 { id symbol }
          token1 { id symbol }
        }
      }
    `,
  ];

  for (const query of candidates) {
    try {
      const res = await postSubgraphV3(query, { first, skip: offset });
      const pools = res?.pools || [];
      return pools.map((pool) => ({
        id: pool?.id || "",
        token0Symbol: pool?.token0?.symbol || "",
        token1Symbol: pool?.token1?.symbol || "",
        token0Id: pool?.token0?.id || "",
        token1Id: pool?.token1?.id || "",
        tvlUsd: toNumberSafe(pool?.totalValueLockedUSD),
        volumeUsd: toNumberSafe(pool?.volumeUSD),
        feeTier: pool?.feeTier,
        type: "V3",
      }));
    } catch (err) {
      const message = err?.message || "";
      if (isSchemaFieldMissing(message)) {
        continue;
      }
      throw err;
    }
  }

  return [];
}

const chunkArray = (items = [], size = 20) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

const normalizeIds = (ids = []) =>
  Array.from(new Set((ids || []).filter(Boolean).map((id) => id.toLowerCase())));

export async function fetchV2PoolsDayData(ids = []) {
  if (SUBGRAPH_MISSING_KEY) return {};
  const list = normalizeIds(ids);
  if (!list.length) return {};

  const chunks = chunkArray(list, 20);
  const out = {};

  for (const chunk of chunks) {
    let schemaMissing = false;
    const candidates = ["pairAddress", "pair"];
    for (const field of candidates) {
      const query = `
        query V2PoolDayData {
          ${chunk
            .map(
              (id, idx) => `
            p${idx}: pairDayDatas(
              first: 1
              orderBy: date
              orderDirection: desc
              where: { ${field}: "${id}" }
            ) {
              date
              dailyVolumeUSD
              reserveUSD
            }
          `
            )
            .join("\n")}
        }
      `;

      try {
        const res = await postSubgraph(query);
        chunk.forEach((id, idx) => {
          const row = res?.[`p${idx}`]?.[0];
          if (!row) return;
          out[id] = {
            volumeUsd: toNumberSafe(row.dailyVolumeUSD),
            tvlUsd: toNumberSafe(row.reserveUSD),
          };
        });
        schemaMissing = false;
        break;
      } catch (err) {
        const message = err?.message || "";
        if (isSchemaFieldMissing(message)) {
          schemaMissing = true;
          continue;
        }
        throw err;
      }
    }
    if (schemaMissing) {
      return out;
    }
  }

  return out;
}

export async function fetchV3PoolsDayData(ids = []) {
  if (SUBGRAPH_V3_MISSING_KEY) return {};
  const list = normalizeIds(ids);
  if (!list.length) return {};

  const chunks = chunkArray(list, 20);
  const out = {};

  for (const chunk of chunks) {
    let schemaMissing = false;
    const candidates = ["pool", "poolAddress"];
    for (const field of candidates) {
      const query = `
        query V3PoolDayData {
          ${chunk
            .map(
              (id, idx) => `
            p${idx}: poolDayDatas(
              first: 1
              orderBy: date
              orderDirection: desc
              where: { ${field}: "${id}" }
            ) {
              date
              volumeUSD
              tvlUSD
              totalValueLockedUSD
            }
          `
            )
            .join("\n")}
        }
      `;

      try {
        const res = await postSubgraphV3(query);
        chunk.forEach((id, idx) => {
          const row = res?.[`p${idx}`]?.[0];
          if (!row) return;
          const tvl =
            row.tvlUSD !== undefined && row.tvlUSD !== null
              ? row.tvlUSD
              : row.totalValueLockedUSD;
          out[id] = {
            volumeUsd: toNumberSafe(row.volumeUSD),
            tvlUsd: toNumberSafe(tvl),
          };
        });
        schemaMissing = false;
        break;
      } catch (err) {
        const message = err?.message || "";
        if (isSchemaFieldMissing(message)) {
          schemaMissing = true;
          continue;
        }
        throw err;
      }
    }
    if (schemaMissing) {
      return out;
    }
  }

  return out;
}

// Fetch recent pool day data for a V3 pool (sorted desc by date)
export async function fetchV3PoolHistory(poolId, days = 14) {
  if (SUBGRAPH_V3_MISSING_KEY) return [];
  const id = (poolId || "").toLowerCase();
  if (!id) return [];
  const count = Math.max(1, Math.min(Number(days) || 14, 1000));

  const candidates = ["pool", "poolAddress"];
  const variants = [
    `
      date
      volumeUSD
      tvlUSD
      totalValueLockedUSD
      feesUSD
      token0Price
      token1Price
    `,
    `
      date
      volumeUSD
      tvlUSD
      totalValueLockedUSD
      token0Price
      token1Price
    `,
    `
      date
      volumeUSD
      tvlUSD
      totalValueLockedUSD
    `,
  ];

  for (const variant of variants) {
    for (const field of candidates) {
      const query = `
        query V3PoolHistory {
          poolDayDatas(
            first: ${count}
            orderBy: date
            orderDirection: desc
            where: { ${field}: "${id}" }
          ) {
            ${variant}
          }
        }
      `;

      try {
        const res = await postSubgraphV3(query);
        const rows = res?.poolDayDatas || [];
        const mapped = rows.map((row) => {
          const tvl =
            row.tvlUSD !== undefined && row.tvlUSD !== null
              ? row.tvlUSD
              : row.totalValueLockedUSD;
          return {
            date: Number(row.date || 0) * 1000,
            tvlUsd: toNumberSafe(tvl),
            volumeUsd: toNumberSafe(row.volumeUSD),
            feesUsd: row.feesUSD !== undefined ? toNumberSafe(row.feesUSD) : null,
            token0Price:
              row.token0Price !== undefined ? toNumberSafe(row.token0Price) : null,
            token1Price:
              row.token1Price !== undefined ? toNumberSafe(row.token1Price) : null,
          };
        });
        return mapped
          .filter((row) => Number.isFinite(row.date) && row.date > 0)
          .sort((a, b) => a.date - b.date);
      } catch (err) {
        const message = err?.message || "";
        if (isSchemaFieldMissing(message)) {
          continue;
        }
        throw err;
      }
    }
  }

  return [];
}

// Fetch latest pool-level TVL snapshot for a V3 pool
export async function fetchV3PoolSnapshot(poolId) {
  if (SUBGRAPH_V3_MISSING_KEY) return null;
  const id = (poolId || "").toLowerCase();
  if (!id) return null;

  const candidates = [
    {
      field: "pools",
      query: `
        query V3PoolSnapshot {
          pools(where: { id: "${id}" }) {
            id
            totalValueLockedUSD
            volumeUSD
          }
        }
      `,
      map: (row) => ({
        tvlUsd: toNumberSafe(row?.totalValueLockedUSD),
        volumeUsd: toNumberSafe(row?.volumeUSD),
      }),
    },
    {
      field: "pools",
      query: `
        query V3PoolSnapshot {
          pools(where: { id: "${id}" }) {
            id
            tvlUSD
            volumeUSD
          }
        }
      `,
      map: (row) => ({
        tvlUsd: toNumberSafe(row?.tvlUSD),
        volumeUsd: toNumberSafe(row?.volumeUSD),
      }),
    },
    {
      field: "pool",
      query: `
        query V3PoolSnapshot {
          pool(id: "${id}") {
            id
            totalValueLockedUSD
            volumeUSD
          }
        }
      `,
      map: (row) => ({
        tvlUsd: toNumberSafe(row?.totalValueLockedUSD),
        volumeUsd: toNumberSafe(row?.volumeUSD),
      }),
      single: true,
    },
  ];

  for (const candidate of candidates) {
    try {
      const res = await postSubgraphV3(candidate.query);
      const row = candidate.single ? res?.[candidate.field] : res?.[candidate.field]?.[0];
      if (!row) {
        continue;
      }
      return candidate.map(row);
    } catch (err) {
      const message = err?.message || "";
      if (isSchemaFieldMissing(message)) {
        continue;
      }
      throw err;
    }
  }

  return null;
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
