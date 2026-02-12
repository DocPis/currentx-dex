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
const DEFAULT_SUBGRAPH_PROXY = "/api/subgraph?url=";
const SUBGRAPH_PROXY =
  String(
    (typeof import.meta !== "undefined" ? import.meta.env?.VITE_SUBGRAPH_PROXY : null) ||
      DEFAULT_SUBGRAPH_PROXY
  ).trim();
const DEFAULT_V2_FALLBACK_SUBGRAPHS = [
  "https://gateway.thegraph.com/api/subgraphs/id/3berhRZGzFfAhEB5HZGHEsMAfQ2AQpDk2WyVr5Nnkjyv",
  "https://api.goldsky.com/api/public/project_cmlbj5xkhtfha01z0caladt37/subgraphs/currentx-v2/1.0.0/gn",
];
const DEFAULT_V3_FALLBACK_SUBGRAPHS = [
  "https://gateway.thegraph.com/api/subgraphs/id/Hw24iWxGzMM5HvZqENyBQpA6hwdUTQzCSK5e5BfCXyHd",
  "https://api.goldsky.com/api/public/project_cmlbj5xkhtfha01z0caladt37/subgraphs/currentx-v3/1.0.0/gn",
];

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

const parseUrlList = (...values) =>
  values
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);

const dedupeUrls = (urls = []) => {
  const out = [];
  const seen = new Set();
  urls.forEach((url) => {
    const normalized = String(url || "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
};

const endpointRequiresApiKey = (url = "") =>
  url.includes("thegraph.com") || url.includes("gateway");

const isFallbackProviderUrl = (url = "") => {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.includes("thegraph.com") || hostname.includes("goldsky.com");
  } catch {
    return false;
  }
};

const prioritizeSubgraphUrls = (urls = []) => {
  const primary = [];
  const fallback = [];
  urls.forEach((url) => {
    if (isFallbackProviderUrl(url)) {
      fallback.push(url);
      return;
    }
    primary.push(url);
  });
  return [...primary, ...fallback];
};

const buildSubgraphEndpoints = (primaryUrl, primaryApiKey, fallbackUrls = []) => {
  const normalizedPrimary = String(primaryUrl || "").trim();
  const urls = prioritizeSubgraphUrls(dedupeUrls([normalizedPrimary, ...fallbackUrls]));
  return urls.map((url) => ({
    url,
    // Keep key for the explicit primary, and for providers that require auth (The Graph gateway).
    apiKey:
      url === normalizedPrimary || endpointRequiresApiKey(url)
        ? String(primaryApiKey || "").trim()
        : "",
  }));
};

const hasUsableEndpoints = (endpoints = []) =>
  endpoints.some(
    (endpoint) =>
      endpoint?.url &&
      (!endpointRequiresApiKey(endpoint.url) || Boolean(endpoint.apiKey))
  );

const SUBGRAPH_ENDPOINTS = buildSubgraphEndpoints(
  SUBGRAPH_URL,
  SUBGRAPH_API_KEY,
  parseUrlList(
    env.VITE_UNIV2_SUBGRAPH_FALLBACKS,
    DEFAULT_V2_FALLBACK_SUBGRAPHS.join(",")
  )
);
const SUBGRAPH_V3_ENDPOINTS = buildSubgraphEndpoints(
  SUBGRAPH_V3_URL,
  SUBGRAPH_V3_API_KEY,
  parseUrlList(
    env.VITE_UNIV3_SUBGRAPH_FALLBACKS,
    DEFAULT_V3_FALLBACK_SUBGRAPHS.join(",")
  )
);
const SUBGRAPH_MISSING_KEY = !hasUsableEndpoints(SUBGRAPH_ENDPOINTS);
const SUBGRAPH_V3_MISSING_KEY = !hasUsableEndpoints(SUBGRAPH_V3_ENDPOINTS);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isIndexerUnavailableMessage = (value = "") => {
  const msg = String(value || "").toLowerCase();
  return (
    msg.includes("bad indexers") ||
    msg.includes("indexer not available") ||
    msg.includes("unavailable(no status")
  );
};

const normalizeSubgraphErrorMessage = (value = "", fallback = "Subgraph unavailable") => {
  const msg = String(value || "").trim();
  if (!msg) return fallback;
  if (isIndexerUnavailableMessage(msg)) {
    return "Subgraph temporarily unavailable (indexer issue). Please retry shortly.";
  }
  return msg;
};

const isTransientSubgraphMessage = (value = "") => {
  const msg = String(value || "").toLowerCase();
  return (
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("rate") ||
    isIndexerUnavailableMessage(msg)
  );
};

async function postSubgraph(query, variables = {}) {
  return postSubgraphWithFallback({
    query,
    variables,
    endpoints: SUBGRAPH_ENDPOINTS,
    cache: subgraphCache,
    missingConfigMessage: "Missing V2 subgraph endpoint configuration",
  });
}

async function postSubgraphV3(query, variables = {}) {
  return postSubgraphWithFallback({
    query,
    variables,
    endpoints: SUBGRAPH_V3_ENDPOINTS,
    cache: subgraphCacheV3,
    missingConfigMessage: "Missing V3 subgraph endpoint configuration",
  });
}

const isUsableSubgraphEndpoint = (endpoint) =>
  Boolean(
    endpoint?.url &&
      (!endpointRequiresApiKey(endpoint.url) || Boolean(endpoint.apiKey))
  );

const buildSubgraphHeaders = (endpoint, useProxy) => {
  const headers = {
    "Content-Type": "application/json",
  };
  if (!useProxy && endpoint?.apiKey) {
    headers.Authorization = `Bearer ${endpoint.apiKey}`;
  }
  return headers;
};

const shouldPreferProxyForEndpoint = (url = "") => {
  if (!SUBGRAPH_PROXY) return false;
  try {
    return new URL(url).hostname.endsWith(".goldsky.com");
  } catch {
    return false;
  }
};

async function postSubgraphWithFallback({
  query,
  variables = {},
  endpoints = [],
  cache,
  missingConfigMessage,
}) {
  const usableEndpoints = (endpoints || []).filter(isUsableSubgraphEndpoint);
  if (!usableEndpoints.length) {
    throw new Error(missingConfigMessage || "Subgraph unavailable");
  }

  const cacheKey = JSON.stringify({ q: query, v: variables });
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < SUBGRAPH_CACHE_TTL_MS) {
    return cached.data;
  }

  let lastError = null;

  for (const endpoint of usableEndpoints) {
    let endpointError = null;
    let attemptedProxy = shouldPreferProxyForEndpoint(endpoint.url);
    let canTryDirectFallback = attemptedProxy;

    for (let attempt = 0; attempt <= SUBGRAPH_MAX_RETRIES; attempt += 1) {
      try {
        const useProxy = attemptedProxy && Boolean(SUBGRAPH_PROXY);
        const url = useProxy
          ? `${SUBGRAPH_PROXY}${encodeURIComponent(endpoint.url)}`
          : endpoint.url;
        const res = await fetch(url, {
          method: "POST",
          headers: buildSubgraphHeaders(endpoint, useProxy),
          body: JSON.stringify({ query, variables }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const rateLimited =
            res.status === 429 ||
            text.toLowerCase().includes("rate") ||
            text.toLowerCase().includes("limit");
          const indexerUnavailable = isIndexerUnavailableMessage(text);
          endpointError = new Error(
            rateLimited
              ? "Subgraph rate-limited. Please retry shortly."
              : indexerUnavailable
                ? "Subgraph temporarily unavailable (indexer issue). Please retry shortly."
                : `Subgraph HTTP ${res.status}`
          );
          if (
            attempt < SUBGRAPH_MAX_RETRIES &&
            (res.status >= 500 || rateLimited || indexerUnavailable)
          ) {
            await sleep(250 * (attempt + 1));
            continue;
          }
          throw endpointError;
        }

        const json = await res.json();
        if (json.errors?.length) {
          endpointError = new Error(
            normalizeSubgraphErrorMessage(
              json.errors[0]?.message || "Subgraph error",
              "Subgraph error"
            )
          );
          throw endpointError;
        }
        cache.set(cacheKey, { ts: now, data: json.data });
        return json.data;
      } catch (err) {
        const msg = String(err?.message || "").toLowerCase();
        const transient = isTransientSubgraphMessage(msg);
        const corsLikely = msg.includes("cors") || msg.includes("failed to fetch");
        if (canTryDirectFallback) {
          attemptedProxy = false;
          canTryDirectFallback = false;
          // If proxy-first fails, retry immediately with direct endpoint.
          attempt -= 1;
          continue;
        }
        if (!attemptedProxy && corsLikely && SUBGRAPH_PROXY) {
          attemptedProxy = true;
          // retry immediately with proxy
          attempt -= 1;
          continue;
        }
        endpointError = err;
        if (attempt < SUBGRAPH_MAX_RETRIES && transient) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        break;
      }
    }

    if (endpointError) {
      lastError = endpointError;
    }
  }

  throw new Error(
    normalizeSubgraphErrorMessage(
      lastError?.message || "",
      "Subgraph unavailable"
    )
  );
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
      note: "Subgraph unavailable or key missing; skipping live TVL/volume.",
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
      const orderByMissing = message.toLowerCase().includes("order");
      if (isSchemaFieldMissing(message) || orderByMissing) {
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
      feesUsd: Number(d.dailyVolumeUSD || 0) * 0.003,
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
          feesUsd: entry.feesUsd,
          cumulativeVolumeUsd: entry.cumulativeVolumeUsd,
        });
      } else {
        result.push({
          date: dayId * 86400000,
          tvlUsd: lastKnownTvl !== null ? lastKnownTvl : 0,
          volumeUsd: 0,
          feesUsd: 0,
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
            feesUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.tvlUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        feesUsd: d.feesUSD !== undefined && d.feesUSD !== null ? Number(d.feesUSD || 0) : null,
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
        feesUsd: null,
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
            feesUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.tvlUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        feesUsd: d.feesUSD !== undefined && d.feesUSD !== null ? Number(d.feesUSD || 0) : null,
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
            tvlUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.tvlUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        feesUsd: null,
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
            feesUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.totalValueLockedUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        feesUsd: d.feesUSD !== undefined && d.feesUSD !== null ? Number(d.feesUSD || 0) : null,
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
        feesUsd: null,
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
            feesUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.totalValueLockedUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        feesUsd: d.feesUSD !== undefined && d.feesUSD !== null ? Number(d.feesUSD || 0) : null,
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
            totalValueLockedUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.totalValueLockedUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        feesUsd: null,
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
            feesUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.totalValueLockedUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        feesUsd: d.feesUSD !== undefined && d.feesUSD !== null ? Number(d.feesUSD || 0) : null,
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
        feesUsd: null,
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
            feesUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.totalValueLockedUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        feesUsd: d.feesUSD !== undefined && d.feesUSD !== null ? Number(d.feesUSD || 0) : null,
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
            totalValueLockedUSD
          }
        }
      `,
      map: (d) => ({
        date: Number(d.date) * 1000,
        dayId: Math.floor(Number(d.date) / 86400),
        tvlUsd: Number(d.totalValueLockedUSD || 0),
        volumeUsd: Number(d.volumeUSD || 0),
        feesUsd: null,
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
      feesUsd: 0,
      cumulativeVolumeUsd: 0,
      _cumCount: 0,
      _feesCount: 0,
    };
    existing.date = Math.max(existing.date || 0, date);
    existing.tvlUsd += Number(entry.tvlUsd || 0);
    existing.volumeUsd += Number(entry.volumeUsd || 0);
    if (entry.feesUsd !== null && entry.feesUsd !== undefined) {
      existing.feesUsd += Number(entry.feesUsd || 0);
      existing._feesCount += 1;
    }
    if (entry.cumulativeVolumeUsd !== null && entry.cumulativeVolumeUsd !== undefined) {
      existing.cumulativeVolumeUsd += Number(entry.cumulativeVolumeUsd || 0);
      existing._cumCount += 1;
    }
    map.set(dayId, existing);
  };

  v2.forEach(addEntry);
  v3.forEach(addEntry);

  const sources = [
    {
      entries: v2,
      hasCum: v2.some((d) => typeof d.cumulativeVolumeUsd === "number"),
      hasFees: v2.some((d) => typeof d.feesUsd === "number"),
    },
    {
      entries: v3,
      hasCum: v3.some((d) => typeof d.cumulativeVolumeUsd === "number"),
      hasFees: v3.some((d) => typeof d.feesUsd === "number"),
    },
  ].filter((s) => s.entries?.length);

  const requireCumulative = sources.length > 0 && sources.every((s) => s.hasCum);
  const expectedCumCount = requireCumulative ? sources.length : 0;
  const requireFees = sources.length > 0 && sources.every((s) => s.hasFees);
  const expectedFeesCount = requireFees ? sources.length : 0;

  return Array.from(map.values())
    .map((entry) => ({
      date: entry.date,
      tvlUsd: entry.tvlUsd,
      volumeUsd: entry.volumeUsd,
      feesUsd:
        requireFees && entry._feesCount >= expectedFeesCount
          ? entry.feesUsd
          : null,
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

export async function fetchV3TokenTvls(addresses = []) {
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
          totalValueLockedUSD
        }
      }
    `,
    `
      query Tokens($ids: [Bytes!]!) {
        tokens(where: { id_in: $ids }) {
          id
          totalValueLockedUSD
          totalValueLockedUSDUntracked
        }
      }
    `,
  ];

  for (const query of queries) {
    try {
      const res = await postSubgraphV3(query, { ids });
      const out = {};
      (res?.tokens || []).forEach((t) => {
        const tvlRaw =
          t?.totalValueLockedUSD ?? t?.totalValueLockedUSDUntracked ?? 0;
        const tvl = Number(tvlRaw);
        if (Number.isFinite(tvl) && tvl >= 0) {
          out[(t.id || "").toLowerCase()] = tvl;
        }
      });
      return out;
    } catch (err) {
      const message = err?.message || "";
      if (isSchemaFieldMissing(message)) {
        continue;
      }
      return {};
    }
  }

  return {};
}

// Fetch top pairs by all-time volume (falling back gracefully if unavailable)
export async function fetchTopPairsBreakdown(limit = 4) {
  const fetchTopPairsDay = async (finalLimit) => {
    try {
      const latestRes = await postSubgraph(`
        query LatestPairDay {
          pairDayDatas(first: 1, orderBy: date, orderDirection: desc) {
            date
          }
        }
      `);
      const latestDay = Number(latestRes?.pairDayDatas?.[0]?.date || 0);
      if (!Number.isFinite(latestDay) || latestDay <= 0) return [];

      const variants = [
        `
          query TopPairsDay($limit: Int!, $day: Int!) {
            pairDayDatas(
              first: $limit
              orderBy: reserveUSD
              orderDirection: desc
              where: { date: $day }
            ) {
              date
              reserveUSD
              pair {
                id
                token0 { id symbol }
                token1 { id symbol }
              }
            }
          }
        `,
        `
          query TopPairsDay($limit: Int!, $day: Int!) {
            pairDayDatas(
              first: $limit
              orderBy: volumeUSD
              orderDirection: desc
              where: { date: $day }
            ) {
              date
              reserveUSD
              pair {
                id
                token0 { id symbol }
                token1 { id symbol }
              }
            }
          }
        `,
      ];

      for (const query of variants) {
        try {
          const res = await postSubgraph(query, { limit: finalLimit, day: latestDay });
          const rows = res?.pairDayDatas || [];
          if (!rows.length) continue;
          const mapped = rows.map((row, idx) => {
            const pair = row?.pair || {};
            const t0 = pair?.token0?.symbol || "Token0";
            const t1 = pair?.token1?.symbol || "Token1";
            const label = `${t0}-${t1}`;
            const tvlUsd = Number(row?.reserveUSD ?? 0);
            return {
              id: (pair?.id || `${label}-${idx}`).toLowerCase(),
              label,
              tvlUsd,
              type: "V2",
              token0Symbol: pair?.token0?.symbol || "",
              token1Symbol: pair?.token1?.symbol || "",
              token0Id: pair?.token0?.id || "",
              token1Id: pair?.token1?.id || "",
            };
          });

          const filtered = mapped.filter((p) => p.tvlUsd > 0);
          if (!filtered.length) return [];
          const tvlSumTop = filtered.reduce((sum, p) => sum + (p.tvlUsd || 0), 0);
          return filtered.map((p, idx) => {
            const share = tvlSumTop ? (p.tvlUsd / tvlSumTop) * 100 : 0;
            return {
              ...p,
              share,
              rank: idx + 1,
            };
          });
        } catch (err) {
          const message = err?.message || "";
          const orderByMissing = message.toLowerCase().includes("order");
          if (isSchemaFieldMissing(message) || orderByMissing) {
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      const message = err?.message || "";
      const orderByMissing = message.toLowerCase().includes("order");
      if (isSchemaFieldMissing(message) || orderByMissing) return [];
      throw err;
    }
    return [];
  };

  const finalLimit = Math.max(1, Math.min(Number(limit) || 4, 20));

  const dayTop = await fetchTopPairsDay(finalLimit);
  if (dayTop.length) return dayTop;

  const pairQueries = [
    `
      query TopPairs($limit: Int!) {
        pairs(
          first: $limit
          orderBy: reserveUSD
          orderDirection: desc
        ) {
          id
          reserveUSD
          token0 { id symbol }
          token1 { id symbol }
        }
      }
    `,
    `
      query TopPairs($limit: Int!) {
        pairs(
          first: $limit
          orderBy: volumeUSD
          orderDirection: desc
        ) {
          id
          reserveUSD
          token0 { id symbol }
          token1 { id symbol }
        }
      }
    `,
  ];

  let topPairsRes = [];
  for (const query of pairQueries) {
    try {
      const res = await postSubgraph(query, { limit: finalLimit });
      topPairsRes = res?.pairs || [];
      if (topPairsRes.length) break;
    } catch (err) {
      const message = err?.message || "";
      const orderByMissing = message.toLowerCase().includes("order");
      if (isSchemaFieldMissing(message) || orderByMissing) {
        continue;
      }
      throw err;
    }
  }

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
    const tvlUsd = Number(p?.reserveUSD || 0);
    return {
      id: pairId || `${label}-${idx}`,
      label,
      tvlUsd,
      type: "V2",
      token0Symbol: meta?.token0?.symbol || "",
      token1Symbol: meta?.token1?.symbol || "",
      token0Id: meta?.token0?.id || "",
      token1Id: meta?.token1?.id || "",
    };
  });

  const filtered = mapped.filter((p) => p.tvlUsd > 0);
  if (!filtered.length) return [];

  const top = filtered.slice(0, finalLimit);
  const tvlSumTop = top.reduce((sum, p) => sum + (p.tvlUsd || 0), 0);
  return top.map((p, idx) => {
    const share = tvlSumTop ? (p.tvlUsd / tvlSumTop) * 100 : 0;
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
  const fetchTopPoolsDay = async () => {
    try {
      const latestRes = await postSubgraphV3(`
        query LatestPoolDay {
          poolDayDatas(first: 1, orderBy: date, orderDirection: desc) {
            date
          }
        }
      `);
      const latestDay = Number(latestRes?.poolDayDatas?.[0]?.date || 0);
      if (!Number.isFinite(latestDay) || latestDay <= 0) return [];

      const variants = [
        `
          query TopPoolsDay($limit: Int!, $day: Int!) {
            poolDayDatas(
              first: $limit
              orderBy: tvlUSD
              orderDirection: desc
              where: { date: $day }
            ) {
              date
              tvlUSD
              totalValueLockedUSD
              pool {
                id
                feeTier
                token0 { id symbol }
                token1 { id symbol }
              }
            }
          }
        `,
        `
          query TopPoolsDay($limit: Int!, $day: Int!) {
            poolDayDatas(
              first: $limit
              orderBy: volumeUSD
              orderDirection: desc
              where: { date: $day }
            ) {
              date
              tvlUSD
              totalValueLockedUSD
              pool {
                id
                feeTier
                token0 { id symbol }
                token1 { id symbol }
              }
            }
          }
        `,
      ];

      for (const query of variants) {
        try {
          const res = await postSubgraphV3(query, { limit: finalLimit, day: latestDay });
          const rows = res?.poolDayDatas || [];
          if (!rows.length) continue;
          const mapped = rows.map((row, idx) => {
            const pool = row?.pool || {};
            const t0 = pool?.token0?.symbol || "Token0";
            const t1 = pool?.token1?.symbol || "Token1";
            const feeLabel = formatFeeTierLabel(pool?.feeTier);
            const label = feeLabel ? `${t0}-${t1} (${feeLabel})` : `${t0}-${t1}`;
            const tvl =
              row?.tvlUSD !== undefined && row?.tvlUSD !== null
                ? row?.tvlUSD
                : row?.totalValueLockedUSD;
            return {
              id: (pool?.id || `${label}-${idx}`).toLowerCase(),
              label,
              tvlUsd: Number(tvl || 0),
              type: "V3",
              feeTier: pool?.feeTier,
              token0Symbol: pool?.token0?.symbol || "",
              token1Symbol: pool?.token1?.symbol || "",
              token0Id: pool?.token0?.id || "",
              token1Id: pool?.token1?.id || "",
            };
          });
          return mapped.filter((p) => p.tvlUsd > 0);
        } catch (err) {
          const message = err?.message || "";
          if (isSchemaFieldMissing(message)) {
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      const message = err?.message || "";
      if (isSchemaFieldMissing(message)) return [];
      throw err;
    }
    return [];
  };

  const dayTop = await fetchTopPoolsDay();
  if (dayTop.length) return dayTop;

  const candidates = [
    {
      query: `
        query TopPoolsV3($limit: Int!) {
          pools(
            first: $limit
            orderBy: totalValueLockedUSD
            orderDirection: desc
          ) {
            id
            totalValueLockedUSD
            feeTier
            token0 { id symbol }
            token1 { id symbol }
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
          tvlUsd: Number(pool?.totalValueLockedUSD || 0),
          type: "V3",
          feeTier: pool?.feeTier,
          token0Symbol: pool?.token0?.symbol || "",
          token1Symbol: pool?.token1?.symbol || "",
          token0Id: pool?.token0?.id || "",
          token1Id: pool?.token1?.id || "",
        };
      },
    },
    {
      query: `
        query TopPoolsV3($limit: Int!) {
          pools(
            first: $limit
            orderBy: totalValueLockedUSD
            orderDirection: desc
          ) {
            id
            feeTier
            token0 { id symbol }
            token1 { id symbol }
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
          tvlUsd: 0,
          type: "V3",
          feeTier: pool?.feeTier,
          token0Symbol: pool?.token0?.symbol || "",
          token1Symbol: pool?.token1?.symbol || "",
          token0Id: pool?.token0?.id || "",
          token1Id: pool?.token1?.id || "",
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
      const orderByMissing = message.toLowerCase().includes("order");
      if (isSchemaFieldMissing(message) || orderByMissing) {
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
    (p) => (p.tvlUsd || 0) > 0
  );

  if (!combined.length) return [];

  const sorted = combined
    .slice()
    .sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))
    .slice(0, finalLimit);
  const tvlSum = sorted.reduce((sum, p) => sum + (p.tvlUsd || 0), 0);
  return sorted.map((p, idx) => {
    const share = tvlSum ? (p.tvlUsd / tvlSum) * 100 : 0;
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
          reserve0
          reserve1
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
          reserve0
          reserve1
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
          reserve0
          reserve1
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
        reserve0: toNumberSafe(pair?.reserve0),
        reserve1: toNumberSafe(pair?.reserve1),
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
const runWithConcurrency = async (items = [], limit = 4, worker) => {
  if (!Array.isArray(items) || !items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
};

const normalizeIds = (ids = []) =>
  Array.from(new Set((ids || []).filter(Boolean).map((id) => id.toLowerCase())));

// Fetch rolling 24h stats for V2 pools using hourly data.
export async function fetchV2PoolsHourData(ids = [], hours = 24) {
  if (SUBGRAPH_MISSING_KEY) return {};
  const list = normalizeIds(ids);
  if (!list.length) return {};

  const count = Math.max(1, Math.min(Number(hours) || 24, 168));
  const since = Math.floor(Date.now() / 1000) - count * 3600;
  const chunks = chunkArray(list, 8);
  const out = {};
  const candidates = ["pair", "pairAddress"];
  const orderVariants = ["hourStartUnix", "periodStartUnix", "date"];
  const selectVariants = [
    `
      hourlyVolumeUSD
      reserveUSD
      feesUSD
    `,
    `
      hourlyVolumeUSD
      reserveUSD
    `,
    `
      volumeUSD
      reserveUSD
      feesUSD
    `,
    `
      volumeUSD
      reserveUSD
    `,
    `
      hourlyVolumeUSD
      totalValueLockedUSD
      feesUSD
    `,
    `
      hourlyVolumeUSD
      totalValueLockedUSD
    `,
    `
      volumeUSD
      totalValueLockedUSD
      feesUSD
    `,
    `
      volumeUSD
      totalValueLockedUSD
    `,
  ];

  const readVolume = (row) =>
    row?.hourlyVolumeUSD !== undefined && row?.hourlyVolumeUSD !== null
      ? row.hourlyVolumeUSD
      : row?.volumeUSD;
  const readTvl = (row) =>
    row?.reserveUSD !== undefined && row?.reserveUSD !== null
      ? row.reserveUSD
      : row?.totalValueLockedUSD;

  const parseRows = (rows) => {
    if (!rows?.length) return null;
    const volumeUsd = rows.reduce(
      (sum, row) => sum + toNumberSafe(readVolume(row)),
      0
    );
    const hasFees = rows.some(
      (row) => row?.feesUSD !== undefined && row?.feesUSD !== null
    );
    const feesUsd = hasFees
      ? rows.reduce((sum, row) => sum + toNumberSafe(row?.feesUSD), 0)
      : null;
    const tvlUsd = toNumberSafe(readTvl(rows[0]));
    return {
      volumeUsd: Number.isFinite(volumeUsd) ? volumeUsd : null,
      feesUsd,
      tvlUsd,
      hours: rows.length,
    };
  };

  const isFilterUnsupported = (message = "") =>
    message.includes("Unknown argument") ||
    message.includes("is not defined on") ||
    message.includes("has no field") ||
    message.includes("Cannot query field");

  const runChunk = async (chunk, field, orderBy, select, useSince = true) => {
    const timeField = useSince ? orderBy : null;
    const query = `
      query V2PoolHourData {
        ${chunk
          .map(
            (id, idx) => `
          p${idx}: pairHourDatas(
            first: ${count}
            orderBy: ${orderBy}
            orderDirection: desc
            where: { ${field}: "${id}"${timeField ? `, ${timeField}_gte: ${since}` : ""} }
          ) {
            ${select}
          }
        `
          )
          .join("\n")}
      }
    `;

    const res = await postSubgraph(query);
    chunk.forEach((id, idx) => {
      const rows = res?.[`p${idx}`] || [];
      const parsed = parseRows(rows);
      if (!parsed) return;
      out[id] = parsed;
    });
  };

  let resolvedSelect = null;
  let resolvedField = null;
  let resolvedOrderBy = null;
  let resolvedUseSince = true;
  if (chunks.length) {
    let matched = false;
    for (const select of selectVariants) {
      for (const orderBy of orderVariants) {
        for (const field of candidates) {
          try {
            try {
              await runChunk(chunks[0], field, orderBy, select, true);
              resolvedUseSince = true;
            } catch (err) {
              const message = err?.message || "";
              if (!isFilterUnsupported(message)) throw err;
              await runChunk(chunks[0], field, orderBy, select, false);
              resolvedUseSince = false;
            }
            resolvedSelect = select;
            resolvedField = field;
            resolvedOrderBy = orderBy;
            matched = true;
            break;
          } catch (err) {
            const message = err?.message || "";
            const orderByMissing =
              message.includes("PairHourData_orderBy") ||
              message.includes("PairHourData_orderBy!") ||
              message.includes("pairHourData_orderBy") ||
              message.includes("pairHourDatas_orderBy") ||
              message.includes("is not a valid PairHourData_orderBy");
            if (isSchemaFieldMissing(message) || orderByMissing) {
              continue;
            }
            throw err;
          }
        }
        if (matched) break;
      }
      if (matched) break;
    }
  }

  if (resolvedSelect && resolvedField && resolvedOrderBy) {
    await Promise.all(
      chunks.slice(1).map(async (chunk) => {
        try {
          await runChunk(chunk, resolvedField, resolvedOrderBy, resolvedSelect, resolvedUseSince);
        } catch {
          // ignore chunk failures to keep partial data
        }
      })
    );
  }

  return out;
}

// Fetch rolling 24h stats for V3 pools using hourly data.
export async function fetchV3PoolsHourData(ids = [], hours = 24) {
  if (SUBGRAPH_V3_MISSING_KEY) return {};
  const list = normalizeIds(ids);
  if (!list.length) return {};

  const count = Math.max(1, Math.min(Number(hours) || 24, 168));
  const since = Math.floor(Date.now() / 1000) - count * 3600;
  const chunks = chunkArray(list, 8);
  const out = {};
  const candidates = ["pool", "poolAddress"];
  const orderVariants = ["periodStartUnix", "hourStartUnix", "date"];
  const selectVariants = [
    `
      volumeUSD
      tvlUSD
      totalValueLockedUSD
      feesUSD
    `,
    `
      volumeUSD
      tvlUSD
      totalValueLockedUSD
    `,
    `
      volumeUSD
      totalValueLockedUSD
      feesUSD
    `,
    `
      volumeUSD
      totalValueLockedUSD
    `,
    `
      volumeUSD
      tvlUSD
      feesUSD
    `,
    `
      volumeUSD
      tvlUSD
    `,
    `
      volumeUSD
      feesUSD
    `,
    `
      volumeUSD
    `,
  ];

  const readTvl = (row) =>
    row?.tvlUSD !== undefined && row?.tvlUSD !== null
      ? row.tvlUSD
      : row?.totalValueLockedUSD;

  const parseRows = (rows) => {
    if (!rows?.length) return null;
    const volumeUsd = rows.reduce(
      (sum, row) => sum + toNumberSafe(row?.volumeUSD),
      0
    );
    const hasFees = rows.some(
      (row) => row?.feesUSD !== undefined && row?.feesUSD !== null
    );
    const feesUsd = hasFees
      ? rows.reduce((sum, row) => sum + toNumberSafe(row?.feesUSD), 0)
      : null;
    const tvlUsd = toNumberSafe(readTvl(rows[0]));
    return {
      volumeUsd: Number.isFinite(volumeUsd) ? volumeUsd : null,
      feesUsd,
      tvlUsd,
      hours: rows.length,
    };
  };

  const isFilterUnsupported = (message = "") =>
    message.includes("Unknown argument") ||
    message.includes("is not defined on") ||
    message.includes("has no field") ||
    message.includes("Cannot query field");

  const runChunk = async (chunk, field, orderBy, select, useSince = true) => {
    const timeField = useSince ? orderBy : null;
    const query = `
      query V3PoolHourData {
        ${chunk
          .map(
            (id, idx) => `
          p${idx}: poolHourDatas(
            first: ${count}
            orderBy: ${orderBy}
            orderDirection: desc
            where: { ${field}: "${id}"${timeField ? `, ${timeField}_gte: ${since}` : ""} }
          ) {
            ${select}
          }
        `
          )
          .join("\n")}
      }
    `;

    const res = await postSubgraphV3(query);
    chunk.forEach((id, idx) => {
      const rows = res?.[`p${idx}`] || [];
      const parsed = parseRows(rows);
      if (!parsed) return;
      out[id] = parsed;
    });
  };

  let resolvedSelect = null;
  let resolvedField = null;
  let resolvedOrderBy = null;
  let resolvedUseSince = true;
  if (chunks.length) {
    let matched = false;
    for (const select of selectVariants) {
      for (const orderBy of orderVariants) {
        for (const field of candidates) {
          try {
            try {
              await runChunk(chunks[0], field, orderBy, select, true);
              resolvedUseSince = true;
            } catch (err) {
              const message = err?.message || "";
              if (!isFilterUnsupported(message)) throw err;
              await runChunk(chunks[0], field, orderBy, select, false);
              resolvedUseSince = false;
            }
            resolvedSelect = select;
            resolvedField = field;
            resolvedOrderBy = orderBy;
            matched = true;
            break;
          } catch (err) {
            const message = err?.message || "";
            const orderByMissing =
              message.includes("PoolHourData_orderBy") ||
              message.includes("PoolHourData_orderBy!") ||
              message.includes("poolHourData_orderBy") ||
              message.includes("poolHourDatas_orderBy") ||
              message.includes("is not a valid PoolHourData_orderBy");
            if (isSchemaFieldMissing(message) || orderByMissing) {
              continue;
            }
            throw err;
          }
        }
        if (matched) break;
      }
      if (matched) break;
    }
  }

  if (resolvedSelect && resolvedField && resolvedOrderBy) {
    await Promise.all(
      chunks.slice(1).map(async (chunk) => {
        try {
          await runChunk(chunk, resolvedField, resolvedOrderBy, resolvedSelect, resolvedUseSince);
        } catch {
          // ignore chunk failures to keep partial data
        }
      })
    );
  }

  return out;
}

export async function fetchV2PoolsDayData(ids = []) {
  if (SUBGRAPH_MISSING_KEY) return {};
  const list = normalizeIds(ids);
  if (!list.length) return {};

  const chunks = chunkArray(list, 20);
  const out = {};
  const candidates = ["pairAddress", "pair"];
  const runChunk = async (chunk, field) => {
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

    const res = await postSubgraph(query);
    chunk.forEach((id, idx) => {
      const row = res?.[`p${idx}`]?.[0];
      if (!row) return;
      out[id] = {
        volumeUsd: toNumberSafe(row.dailyVolumeUSD),
        tvlUsd: toNumberSafe(row.reserveUSD),
      };
    });
  };

  let resolvedField = null;
  if (chunks.length) {
    for (const field of candidates) {
      try {
        await runChunk(chunks[0], field);
        resolvedField = field;
        break;
      } catch (err) {
        const message = err?.message || "";
        if (isSchemaFieldMissing(message)) {
          continue;
        }
        throw err;
      }
    }
  }
  if (!resolvedField) return out;

  await Promise.all(
    chunks.slice(1).map(async (chunk) => {
      try {
        await runChunk(chunk, resolvedField);
      } catch {
        // ignore chunk failures to keep partial data
      }
    })
  );

  return out;
}

export async function fetchV3PoolsDayData(ids = []) {
  if (SUBGRAPH_V3_MISSING_KEY) return {};
  const list = normalizeIds(ids);
  if (!list.length) return {};

  const chunks = chunkArray(list, 20);
  const out = {};
  const candidates = ["pool", "poolAddress"];
  const selectVariants = [
    `
      date
      volumeUSD
      tvlUSD
      totalValueLockedUSD
      feesUSD
    `,
    `
      date
      volumeUSD
      tvlUSD
      totalValueLockedUSD
    `,
    `
      date
      volumeUSD
      totalValueLockedUSD
      feesUSD
    `,
    `
      date
      volumeUSD
      totalValueLockedUSD
    `,
  ];
  const runChunk = async (chunk, field, select) => {
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
            ${select}
          }
        `
          )
          .join("\n")}
      }
    `;

    const res = await postSubgraphV3(query);
    chunk.forEach((id, idx) => {
      const row = res?.[`p${idx}`]?.[0];
      if (!row) return;
      const tvl =
        row.tvlUSD !== undefined && row.tvlUSD !== null
          ? row.tvlUSD
          : row.totalValueLockedUSD;
      const feesUsd =
        row.feesUSD !== undefined && row.feesUSD !== null
          ? toNumberSafe(row.feesUSD)
          : null;
      out[id] = {
        volumeUsd: toNumberSafe(row.volumeUSD),
        tvlUsd: toNumberSafe(tvl),
        feesUsd,
      };
    });
  };

  let resolvedSelect = null;
  let resolvedField = null;
  if (chunks.length) {
    let matched = false;
    for (const select of selectVariants) {
      for (const field of candidates) {
        try {
          await runChunk(chunks[0], field, select);
          resolvedSelect = select;
          resolvedField = field;
          matched = true;
          break;
        } catch (err) {
          const message = err?.message || "";
          if (isSchemaFieldMissing(message)) {
            continue;
          }
          throw err;
        }
      }
      if (matched) break;
    }
  }

  if (resolvedSelect && resolvedField) {
    await Promise.all(
      chunks.slice(1).map(async (chunk) => {
        try {
          await runChunk(chunk, resolvedField, resolvedSelect);
        } catch {
          // ignore chunk failures to keep partial data
        }
      })
    );
  }

  const missing = list.filter((id) => !out[id]);
  if (missing.length) {
    await runWithConcurrency(missing, 6, async (id) => {
      try {
        const res = await fetchV3PoolHourStats(id, 24);
        if (!res) return null;
        out[id] = {
          volumeUsd: toNumberSafe(res.volumeUsd),
          tvlUsd: toNumberSafe(res.tvlUsd),
          feesUsd:
            res.feesUsd !== null && res.feesUsd !== undefined
              ? toNumberSafe(res.feesUsd)
              : null,
        };
      } catch {
        // ignore single-pool failures
      }
      return null;
    });
  }

  return out;
}

// Fetch recent pool day data for a V3 pool (sorted desc by date)
export async function fetchV3PoolHistory(poolId, days = 14) {
  if (SUBGRAPH_V3_MISSING_KEY) return [];
  const id = (poolId || "").toLowerCase();
  if (!id) return [];
  const count = Math.max(1, Math.min(Number(days) || 14, 1000));
  const toOptionalPositive = (value) => {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
  };
  const hasPrice = (rows) =>
    rows.some(
      (row) =>
        (Number.isFinite(row.token0Price) && row.token0Price > 0) ||
        (Number.isFinite(row.token1Price) && row.token1Price > 0)
    );
  const normalizeRows = (rows, dateGetter) =>
    rows
      .map((row) => {
        const tvl =
          row.tvlUSD !== undefined && row.tvlUSD !== null
            ? row.tvlUSD
            : row.totalValueLockedUSD;
        const open = toOptionalPositive(row.open);
        const high = toOptionalPositive(row.high);
        const low = toOptionalPositive(row.low);
        const close = toOptionalPositive(row.close);
        let token0Price = toOptionalPositive(row.token0Price);
        let token1Price = toOptionalPositive(row.token1Price);
        if (!token0Price) {
          token0Price = close ?? open ?? high ?? low ?? null;
        }
        if (!token1Price && token0Price) {
          token1Price = 1 / token0Price;
        }
        return {
          date: dateGetter(row),
          tvlUsd: toNumberSafe(tvl),
          volumeUsd: toNumberSafe(row.volumeUSD),
          feesUsd: row.feesUSD !== undefined ? toNumberSafe(row.feesUSD) : null,
          token0Price,
          token1Price,
        };
      })
      .filter((row) => Number.isFinite(row.date) && row.date > 0)
      .sort((a, b) => a.date - b.date);

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
      open
      high
      low
      close
    `,
    `
      date
      volumeUSD
      tvlUSD
      totalValueLockedUSD
      token0Price
      token1Price
      open
      high
      low
      close
    `,
    `
      date
      volumeUSD
      tvlUSD
      totalValueLockedUSD
      open
      high
      low
      close
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

  let dayRows = null;
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
        const mapped = normalizeRows(rows, (row) => Number(row.date || 0) * 1000);
        if (!dayRows && mapped.length) {
          dayRows = mapped;
        }
        if (hasPrice(mapped)) {
          return mapped;
        }
      } catch (err) {
        const message = err?.message || "";
        if (isSchemaFieldMissing(message)) {
          continue;
        }
        throw err;
      }
    }
  }

  const hourVariants = [
    {
      name: "periodStartUnix",
      select: `
        periodStartUnix
        volumeUSD
        tvlUSD
        totalValueLockedUSD
        feesUSD
        token0Price
        token1Price
        open
        high
        low
        close
      `,
      dateGetter: (row) => Number(row.periodStartUnix || 0) * 1000,
    },
    {
      name: "hourStartUnix",
      select: `
        hourStartUnix
        volumeUSD
        tvlUSD
        totalValueLockedUSD
        feesUSD
        token0Price
        token1Price
        open
        high
        low
        close
      `,
      dateGetter: (row) => Number(row.hourStartUnix || 0) * 1000,
    },
    {
      name: "date",
      select: `
        date
        volumeUSD
        tvlUSD
        totalValueLockedUSD
        feesUSD
        token0Price
        token1Price
        open
        high
        low
        close
      `,
      dateGetter: (row) => Number(row.date || 0) * 1000,
    },
  ];
  const hourTarget = Math.max(24, Math.min(12000, count * 24));
  const downsampleDaily = (rows, maxDays) => {
    if (!rows.length) return rows;
    const byDay = new Map();
    rows.forEach((row) => {
      const dayId = Math.floor(row.date / 86400000);
      const existing = byDay.get(dayId);
      if (!existing || row.date > existing.date) {
        byDay.set(dayId, row);
      }
    });
    const out = Array.from(byDay.values()).sort((a, b) => a.date - b.date);
    if (out.length > maxDays) {
      return out.slice(out.length - maxDays);
    }
    return out;
  };

  for (const variant of hourVariants) {
    for (const field of candidates) {
      let skip = 0;
      let rows = [];
      while (rows.length < hourTarget) {
        const first = Math.min(1000, hourTarget - rows.length);
        const query = `
          query V3PoolHourHistory {
            poolHourDatas(
              first: ${first}
              skip: ${skip}
              orderBy: ${variant.name}
              orderDirection: desc
              where: { ${field}: "${id}" }
            ) {
              ${variant.select}
            }
          }
        `;
        try {
          const res = await postSubgraphV3(query);
          const chunk = res?.poolHourDatas || [];
          if (!chunk.length) break;
          rows = rows.concat(chunk);
          if (chunk.length < first) break;
          skip += chunk.length;
          if (skip >= 12000) break;
        } catch (err) {
          const message = err?.message || "";
          const orderByMissing =
            message.includes("PoolHourData_orderBy") ||
            message.includes("PoolHourData_orderBy!") ||
            message.includes("is not a valid PoolHourData_orderBy");
          if (isSchemaFieldMissing(message) || orderByMissing) {
            rows = [];
            break;
          }
          throw err;
        }
      }
      if (!rows.length) {
        continue;
      }
      const mapped = normalizeRows(rows, variant.dateGetter);
      if (hasPrice(mapped)) {
        return downsampleDaily(mapped, count);
      }
    }
  }

  return dayRows || [];
}

// Fetch recent pool hour data for a V3 pool and aggregate the last N hours.
export async function fetchV3PoolHourStats(poolId, hours = 24) {
  if (SUBGRAPH_V3_MISSING_KEY) return null;
  const id = (poolId || "").toLowerCase();
  if (!id) return null;
  const count = Math.max(1, Math.min(Number(hours) || 24, 1000));

  const candidates = ["pool", "poolAddress"];
  const variants = [
    { name: "periodStartUnix", dateGetter: (row) => Number(row.periodStartUnix || 0) * 1000 },
    { name: "hourStartUnix", dateGetter: (row) => Number(row.hourStartUnix || 0) * 1000 },
    { name: "date", dateGetter: (row) => Number(row.date || 0) * 1000 },
  ];
  const selectVariants = [
    `
      volumeUSD
      tvlUSD
      totalValueLockedUSD
      feesUSD
    `,
    `
      volumeUSD
      tvlUSD
      totalValueLockedUSD
    `,
    `
      volumeUSD
      totalValueLockedUSD
      feesUSD
    `,
    `
      volumeUSD
      totalValueLockedUSD
    `,
    `
      volumeUSD
      tvlUSD
      feesUSD
    `,
    `
      volumeUSD
      tvlUSD
    `,
    `
      volumeUSD
      feesUSD
    `,
    `
      volumeUSD
    `,
  ];

  for (const variant of variants) {
    for (const field of candidates) {
      for (const select of selectVariants) {
        const query = `
          query V3PoolHourStats {
            poolHourDatas(
              first: ${count}
              orderBy: ${variant.name}
              orderDirection: desc
              where: { ${field}: "${id}" }
            ) {
              ${variant.name}
              ${select}
            }
          }
        `;
        try {
          const res = await postSubgraphV3(query);
          const rows = res?.poolHourDatas || [];
          if (!rows.length) continue;
          const mapped = rows
            .map((row) => {
              const tvl =
                row?.tvlUSD !== undefined && row?.tvlUSD !== null
                  ? row.tvlUSD
                  : row?.totalValueLockedUSD;
              return {
                date: variant.dateGetter(row),
                volumeUsd: toNumberSafe(row?.volumeUSD),
                tvlUsd: toNumberSafe(tvl),
                feesUsd: row?.feesUSD !== undefined ? toNumberSafe(row.feesUSD) : null,
              };
            })
            .filter((row) => Number.isFinite(row.date) && row.date > 0);
          if (!mapped.length) continue;

          const volumeUsd = mapped.reduce((sum, row) => sum + (row.volumeUsd || 0), 0);
          const hasFees = mapped.some((row) => row.feesUsd !== null && row.feesUsd !== undefined);
          const feesUsd = hasFees
            ? mapped.reduce((sum, row) => sum + (row.feesUsd || 0), 0)
            : null;
          const latest = mapped.reduce(
            (acc, row) => (row.date > acc.date ? row : acc),
            mapped[0]
          );
          const tvlUsd =
            latest && Number.isFinite(latest.tvlUsd) && latest.tvlUsd > 0
              ? latest.tvlUsd
              : null;

          return {
            volumeUsd: Number.isFinite(volumeUsd) ? volumeUsd : null,
            feesUsd,
            tvlUsd,
            hours: mapped.length,
          };
        } catch (err) {
          const message = err?.message || "";
          const orderByMissing =
            message.includes("PoolHourData_orderBy") ||
            message.includes("PoolHourData_orderBy!") ||
            message.includes("is not a valid PoolHourData_orderBy");
          if (isSchemaFieldMissing(message) || orderByMissing) {
            continue;
          }
          throw err;
        }
      }
    }
  }

  return null;
}

export async function fetchV3TokenPairHistory(token0Id, token1Id, days = 14) {
  if (SUBGRAPH_V3_MISSING_KEY) return [];
  const id0 = (token0Id || "").toLowerCase();
  const id1 = (token1Id || "").toLowerCase();
  if (!id0 || !id1) return [];
  const count = Math.max(1, Math.min(Number(days) || 14, 1000));

  const toOptionalPositive = (value) => {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
  };
  const pickPriceUsd = (row) =>
    toOptionalPositive(row.priceUSD) ??
    toOptionalPositive(row.close) ??
    toOptionalPositive(row.open) ??
    toOptionalPositive(row.high) ??
    toOptionalPositive(row.low) ??
    null;
  const normalize = (rows, dateGetter) =>
    rows
      .map((row) => ({
        date: dateGetter(row),
        priceUsd: pickPriceUsd(row),
      }))
      .filter((row) => Number.isFinite(row.date) && row.date > 0)
      .sort((a, b) => a.date - b.date);

  const fetchTokenHistory = async (tokenId) => {
    const candidates = ["token", "tokenAddress"];
    const variants = [
      `
        date
        priceUSD
        open
        high
        low
        close
      `,
      `
        date
        priceUSD
      `,
      `
        date
        open
        high
        low
        close
      `,
    ];

    for (const variant of variants) {
      for (const field of candidates) {
        const query = `
          query TokenDayHistory {
            tokenDayDatas(
              first: ${count}
              orderBy: date
              orderDirection: desc
              where: { ${field}: "${tokenId}" }
            ) {
              ${variant}
            }
          }
        `;
        try {
          const res = await postSubgraphV3(query);
          const rows = res?.tokenDayDatas || [];
          const mapped = normalize(rows, (row) => Number(row.date || 0) * 1000);
          if (mapped.length) return mapped;
        } catch (err) {
          const message = err?.message || "";
          if (isSchemaFieldMissing(message)) {
            continue;
          }
          throw err;
        }
      }
    }

    const hourVariants = [
      {
        name: "periodStartUnix",
        select: `
          periodStartUnix
          priceUSD
          open
          high
          low
          close
        `,
        dateGetter: (row) => Number(row.periodStartUnix || 0) * 1000,
      },
      {
        name: "hourStartUnix",
        select: `
          hourStartUnix
          priceUSD
          open
          high
          low
          close
        `,
        dateGetter: (row) => Number(row.hourStartUnix || 0) * 1000,
      },
      {
        name: "date",
        select: `
          date
          priceUSD
          open
          high
          low
          close
        `,
        dateGetter: (row) => Number(row.date || 0) * 1000,
      },
    ];
    const hourTarget = Math.max(24, Math.min(12000, count * 24));

    for (const variant of hourVariants) {
      for (const field of candidates) {
        let skip = 0;
        let rows = [];
        while (rows.length < hourTarget) {
          const first = Math.min(1000, hourTarget - rows.length);
          const query = `
            query TokenHourHistory {
              tokenHourDatas(
                first: ${first}
                skip: ${skip}
                orderBy: ${variant.name}
                orderDirection: desc
                where: { ${field}: "${tokenId}" }
              ) {
                ${variant.select}
              }
            }
          `;
          try {
            const res = await postSubgraphV3(query);
            const chunk = res?.tokenHourDatas || [];
            if (!chunk.length) break;
            rows = rows.concat(chunk);
            if (chunk.length < first) break;
            skip += chunk.length;
            if (skip >= 12000) break;
          } catch (err) {
            const message = err?.message || "";
            const orderByMissing =
              message.includes("TokenHourData_orderBy") ||
              message.includes("TokenHourData_orderBy!") ||
              message.includes("is not a valid TokenHourData_orderBy");
            if (isSchemaFieldMissing(message) || orderByMissing) {
              rows = [];
              break;
            }
            throw err;
          }
        }
        if (!rows.length) continue;
        const mapped = normalize(rows, variant.dateGetter);
        if (mapped.length) return mapped;
      }
    }

    return [];
  };

  const [token0Rows, token1Rows] = await Promise.all([
    fetchTokenHistory(id0),
    fetchTokenHistory(id1),
  ]);
  if (!token0Rows.length || !token1Rows.length) return [];

  const byDay1 = new Map(
    token1Rows.map((row) => [Math.floor(row.date / 86400000), row])
  );
  const combined = [];
  token0Rows.forEach((row0) => {
    const dayId = Math.floor(row0.date / 86400000);
    const row1 = byDay1.get(dayId);
    if (!row1) return;
    const price0 = row0.priceUsd;
    const price1 = row1.priceUsd;
    if (!price0 || !price1) return;
    const ratio = price0 / price1;
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    combined.push({
      date: row0.date,
      token0Price: ratio,
      token1Price: 1 / ratio,
    });
  });
  return combined.sort((a, b) => a.date - b.date);
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

const normalizeUserAddress = (address) =>
  (address || "").toLowerCase().trim();

const sumSwapAmounts = (rows = [], amountKey = "amountUSD") =>
  rows.reduce((sum, row) => {
    const raw = row?.[amountKey];
    const num = Number(raw);
    return Number.isFinite(num) ? sum + num : sum;
  }, 0);

export async function fetchUserSwapVolume({
  address,
  startTime,
  endTime,
  source = "v2",
  limit = 5000,
} = {}) {
  const user = normalizeUserAddress(address);
  if (!user) return 0;
  const isV3 = source === "v3";
  if (isV3 && SUBGRAPH_V3_MISSING_KEY) return 0;
  if (!isV3 && SUBGRAPH_MISSING_KEY) return 0;

  const start = Math.floor(Number(startTime || 0) / 1000);
  const end = Math.floor(Number(endTime || Date.now()) / 1000);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (end <= 0 || start <= 0 || end < start) return 0;

  const queryRunner = isV3 ? postSubgraphV3 : postSubgraph;
  const variants = isV3
    ? [
        { addressField: "origin", amountField: "amountUSD" },
        { addressField: "sender", amountField: "amountUSD" },
        { addressField: "recipient", amountField: "amountUSD" },
      ]
    : [
        { addressField: "sender", amountField: "amountUSD" },
        { addressField: "to", amountField: "amountUSD" },
      ];

  const pageSize = 1000;
  for (const variant of variants) {
    let skip = 0;
    let total = 0;
    let succeeded = false;
    while (skip < limit) {
      const first = Math.min(pageSize, limit - skip);
      const query = `
        query UserSwaps($user: Bytes!, $start: Int!, $end: Int!, $first: Int!, $skip: Int!) {
          swaps(
            first: $first
            skip: $skip
            orderBy: timestamp
            orderDirection: desc
            where: {
              ${variant.addressField}: $user
              timestamp_gte: $start
              timestamp_lte: $end
            }
          ) {
            ${variant.amountField}
          }
        }
      `;
      try {
        const res = await queryRunner(query, {
          user,
          start,
          end,
          first,
          skip,
        });
        const rows = res?.swaps || [];
        succeeded = true;
        total += sumSwapAmounts(rows, variant.amountField);
        if (rows.length < first) break;
        skip += rows.length;
      } catch (err) {
        const message = err?.message || "";
        if (isSchemaFieldMissing(message)) {
          succeeded = false;
          break;
        }
        throw err;
      }
    }
    if (succeeded) return total;
  }

  return 0;
}

export async function fetchV3PositionsCreatedAt(ids = []) {
  if (SUBGRAPH_V3_MISSING_KEY) return {};
  const cleaned = Array.from(
    new Set((ids || []).map((id) => String(id)).filter(Boolean))
  );
  if (!cleaned.length) return {};

  const variants = [
    {
      field: "createdAtTimestamp",
      select: "createdAtTimestamp",
      map: (row) => Number(row?.createdAtTimestamp || 0) * 1000,
    },
    {
      field: "createdAt",
      select: "createdAt",
      map: (row) => Number(row?.createdAt || 0) * 1000,
    },
    {
      field: "transaction",
      select: "transaction { timestamp }",
      map: (row) => Number(row?.transaction?.timestamp || 0) * 1000,
    },
  ];

  for (const variant of variants) {
    const results = {};
    try {
      for (const chunk of chunkArray(cleaned, 50)) {
        const query = `
          query PositionCreatedAt($ids: [ID!]!) {
            positions(where: { id_in: $ids }) {
              id
              ${variant.select}
            }
          }
        `;
        const res = await postSubgraphV3(query, { ids: chunk });
        const rows = res?.positions || [];
        rows.forEach((row) => {
          const id = row?.id ? String(row.id) : null;
          const ts = variant.map(row);
          if (id && ts) results[id] = ts;
        });
      }
      return results;
    } catch (err) {
      const message = err?.message || "";
      if (isSchemaFieldMissing(message)) {
        continue;
      }
      throw err;
    }
  }

  return {};
}
