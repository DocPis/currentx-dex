import { kv } from "@vercel/kv";
import {
  buildPointsSummary,
  getLeaderboardRewardsConfig,
} from "../../src/server/leaderboardRewardsLib.js";
import {
  computeLpData as computeLpDataShared,
  computePoints as computePointsShared,
  fetchTokenPrices as fetchTokenPricesShared,
} from "../../src/server/pointsLib.js";


const PAGE_LIMIT = 200;
const CONCURRENCY = 4;
const SNAPSHOT_WINDOW_MS = 24 * 60 * 60 * 1000;
const INGEST_DEFAULT_MAX_WINDOW_SECONDS = 10 * 60;
const LP_DISCOVERY_DEFAULT_BACKFILL_SECONDS = 24 * 60 * 60;
const CURSOR_NEAR_TIP_DEFAULT_SECONDS = 120;
const GRAPH_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);


const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_V2_FALLBACK_SUBGRAPHS = [
  "https://gateway.thegraph.com/api/subgraphs/id/3berhRZGzFfAhEB5HZGHEsMAfQ2AQpDk2WyVr5Nnkjyv",
  "https://api.goldsky.com/api/public/project_cmlbj5xkhtfha01z0caladt37/subgraphs/currentx-v2/1.0.0/gn",
];
const DEFAULT_V3_FALLBACK_SUBGRAPHS = [
  "https://api.goldsky.com/api/public/project_cmlbj5xkhtfha01z0caladt37/subgraphs/currentx-v3/1.0.0/gn",
  "https://gateway.thegraph.com/api/subgraphs/id/Hw24iWxGzMM5HvZqENyBQpA6hwdUTQzCSK5e5BfCXyHd",
];

const parseTime = (value) => {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};
const parseBlock = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num);
};

const parseSubgraphUrls = (...values) =>
  values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);

const dedupeUrls = (urls = []) => {
  const seen = new Set();
  const out = [];
  urls.forEach((url) => {
    const normalized = String(url || "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
};

const pickEnvValue = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
};

const getSeasonConfig = () => {
  const seasonId = pickEnvValue(
    process.env.POINTS_SEASON_ID,
    process.env.VITE_POINTS_SEASON_ID
  );
  const startMs =
    parseTime(process.env.POINTS_SEASON_START) ||
    parseTime(process.env.VITE_POINTS_SEASON_START);
  const startBlock =
    parseBlock(process.env.POINTS_SEASON_START_BLOCK) ||
    parseBlock(process.env.VITE_POINTS_SEASON_START_BLOCK);
  const endMs =
    parseTime(process.env.POINTS_SEASON_END) ||
    parseTime(process.env.VITE_POINTS_SEASON_END);
  const missing = [];
  if (!seasonId) missing.push("POINTS_SEASON_ID");
  if (!Number.isFinite(startMs)) missing.push("POINTS_SEASON_START");
  if (!Number.isFinite(startBlock)) missing.push("POINTS_SEASON_START_BLOCK");
  return {
    seasonId,
    startMs,
    startBlock,
    endMs: Number.isFinite(endMs) ? endMs : null,
    missing,
  };
};

const getSubgraphConfig = () => {
  const v2Primary = parseSubgraphUrls(
    process.env.POINTS_UNIV2_SUBGRAPH_URL,
    process.env.UNIV2_SUBGRAPH_URL,
    process.env.VITE_UNIV2_SUBGRAPH
  );
  const v2Fallback = parseSubgraphUrls(
    process.env.POINTS_UNIV2_SUBGRAPH_FALLBACKS,
    process.env.UNIV2_SUBGRAPH_FALLBACKS,
    process.env.VITE_UNIV2_SUBGRAPH_FALLBACKS,
    DEFAULT_V2_FALLBACK_SUBGRAPHS.join(",")
  );
  const v2Urls = dedupeUrls([...v2Primary, ...v2Fallback]);

  const v3Primary = parseSubgraphUrls(
    process.env.POINTS_UNIV3_SUBGRAPH_URL,
    process.env.UNIV3_SUBGRAPH_URL,
    process.env.VITE_UNIV3_SUBGRAPH
  );
  const v3Fallback = parseSubgraphUrls(
    process.env.POINTS_UNIV3_SUBGRAPH_FALLBACKS,
    process.env.UNIV3_SUBGRAPH_FALLBACKS,
    process.env.VITE_UNIV3_SUBGRAPH_FALLBACKS,
    DEFAULT_V3_FALLBACK_SUBGRAPHS.join(",")
  );
  const v3Urls = dedupeUrls([...v3Primary, ...v3Fallback]);

  return {
    // First URL is preferred; subsequent URLs are runtime fallback endpoints.
    v2Url: v2Urls.join(","),
    v2Key:
      process.env.POINTS_UNIV2_SUBGRAPH_API_KEY ||
      process.env.UNIV2_SUBGRAPH_API_KEY ||
      process.env.VITE_UNIV2_SUBGRAPH_API_KEY ||
      "",
    v3Url: v3Urls.join(","),
    v3Key:
      process.env.POINTS_UNIV3_SUBGRAPH_API_KEY ||
      process.env.UNIV3_SUBGRAPH_API_KEY ||
      process.env.VITE_UNIV3_SUBGRAPH_API_KEY ||
      "",
  };
};

const getAddressConfig = () => {
  const normalize = (v) => (v ? String(v).toLowerCase() : "");
  const crx = normalize(pickEnvValue(process.env.POINTS_CRX_ADDRESS, process.env.VITE_CRX_ADDRESS));
  const weth = normalize(pickEnvValue(process.env.POINTS_WETH_ADDRESS, process.env.VITE_WETH_ADDRESS));
  const usdm = normalize(pickEnvValue(process.env.POINTS_USDM_ADDRESS, process.env.VITE_USDM_ADDRESS));
  const missing = [];
  if (!crx) missing.push("POINTS_CRX_ADDRESS");
  if (!weth) missing.push("POINTS_WETH_ADDRESS");
  if (!usdm) missing.push("POINTS_USDM_ADDRESS");
  return {
    crx,
    weth,
    usdm,
    missing,
  };
};

const buildHeaders = (apiKey) => {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parsePositiveInt = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
};

const getIngestWindowSeconds = () =>
  Math.max(
    60,
    Math.min(
      24 * 60 * 60,
      parsePositiveInt(
        process.env.POINTS_INGEST_MAX_WINDOW_SECONDS,
        INGEST_DEFAULT_MAX_WINDOW_SECONDS
      )
    )
  );

const getLpDiscoveryBackfillSeconds = () =>
  Math.max(
    0,
    Math.min(
      30 * 24 * 60 * 60,
      parsePositiveInt(
        process.env.POINTS_LP_DISCOVERY_BACKFILL_SECONDS,
        LP_DISCOVERY_DEFAULT_BACKFILL_SECONDS
      )
    )
  );

const getCursorNearTipSeconds = () =>
  Math.max(
    0,
    Math.min(
      3600,
      parsePositiveInt(
        process.env.POINTS_CURSOR_NEAR_TIP_SECONDS,
        CURSOR_NEAR_TIP_DEFAULT_SECONDS
      )
    )
  );

const postGraph = async (url, apiKey, query, variables) => {
  const urls = dedupeUrls(parseSubgraphUrls(url));
  if (!urls.length) {
    throw new Error("Subgraph URL not configured");
  }
  let lastError = null;
  for (const candidate of urls) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const res = await fetch(candidate, {
          method: "POST",
          headers: buildHeaders(apiKey),
          body: JSON.stringify({ query, variables }),
        });
        if (!res.ok) {
          const err = new Error(`Subgraph HTTP ${res.status}`);
          err.httpStatus = Number(res.status || 0);
          throw err;
        }
        const json = await res.json();
        if (json.errors?.length) {
          throw new Error(json.errors[0]?.message || "Subgraph error");
        }
        return json.data;
      } catch (err) {
        lastError = err;
        const status = Number(err?.httpStatus || 0);
        if (!GRAPH_RETRY_STATUSES.has(status) || attempt >= 4) {
          break;
        }
        const backoffMs = 1000 * (attempt + 1);
        await sleep(backoffMs);
      }
    }
  }
  throw lastError || new Error("Subgraph unavailable");
};

function normalizeAddress(addr) {
  return addr ? String(addr).toLowerCase() : "";
}

const resolveWallet = (swap, isV3) => {
  if (!swap) return "";
  if (isV3) {
    return (
      normalizeAddress(swap.origin) ||
      normalizeAddress(swap.sender) ||
      normalizeAddress(swap.recipient)
    );
  }
  return normalizeAddress(swap.sender) || normalizeAddress(swap.to);
};

const fetchSwapsPage = async ({ url, apiKey, start, end, isV3, includeBlock }) => {
  const query = `
    query Swaps($start: Int!, $end: Int!, $first: Int!) {
      swaps(
        first: $first
        orderBy: timestamp
        orderDirection: asc
        where: { timestamp_gte: $start, timestamp_lte: $end }
      ) {
        id
        timestamp
        amountUSD
        ${isV3 ? "origin sender recipient" : "sender to"}
        ${includeBlock ? "transaction { blockNumber }" : ""}
      }
    }
  `;

  const data = await postGraph(url, apiKey, query, {
    start,
    end,
    first: PAGE_LIMIT,
  });
  return data?.swaps || [];
};

const isMissingFieldError = (err) => {
  const message = err?.message || "";
  return (
    message.includes("Cannot query field") ||
    message.includes("has no field") ||
    message.includes("Unknown field")
  );
};

const getKeys = (seasonId, source) => {
  const base = `points:${seasonId}`;
  return {
    leaderboard: `${base}:leaderboard`,
    summary: `${base}:summary`,
    updatedAt: `${base}:updatedAt`,
    cursor: source ? `${base}:cursor:${source}` : null,
    user: (address) => `${base}:user:${address}`,
    rewardUser: (address) => `${base}:reward:user:${address}`,
  };
};

const ingestSource = async ({
  source,
  url,
  apiKey,
  startSec,
  endSec,
  startBlock,
}) => {
  const totals = new Map();
  let cursor = startSec;
  let done = false;
  let iterations = 0;
  let includeBlock = Number.isFinite(startBlock);

  while (!done && iterations < 50) {
    iterations += 1;
    let swaps = [];
    try {
      swaps = await fetchSwapsPage({
        url,
        apiKey,
        start: cursor,
        end: endSec,
        isV3: source === "v3",
        includeBlock,
      });
    } catch (err) {
      if (includeBlock && isMissingFieldError(err)) {
        includeBlock = false;
        swaps = await fetchSwapsPage({
          url,
          apiKey,
          start: cursor,
          end: endSec,
          isV3: source === "v3",
          includeBlock,
        });
      } else {
        throw err;
      }
    }
    if (!swaps.length) {
      if (Number.isFinite(endSec) && endSec >= cursor) {
        cursor = endSec + 1;
      }
      break;
    }

    let lastTs = cursor;
    swaps.forEach((swap) => {
      if (includeBlock && Number.isFinite(startBlock)) {
        const blockNumber = Number(swap?.transaction?.blockNumber ?? swap?.blockNumber);
        if (Number.isFinite(blockNumber) && blockNumber < startBlock) return;
      }
      const wallet = resolveWallet(swap, source === "v3");
      if (!wallet) return;
      const amount = Math.abs(Number(swap.amountUSD || 0));
      if (!Number.isFinite(amount) || amount <= 0) return;
      totals.set(wallet, (totals.get(wallet) || 0) + amount);
      const ts = Number(swap.timestamp || 0);
      if (Number.isFinite(ts) && ts > lastTs) lastTs = ts;
    });

    if (lastTs <= cursor) {
      // Advance cursor past this time window when no valid rows survive filters.
      if (Number.isFinite(endSec) && endSec >= cursor) {
        cursor = endSec + 1;
      }
      done = true;
    } else {
      cursor = lastTs + 1; // move past the last timestamp
    }

    if (swaps.length < PAGE_LIMIT) {
      done = true;
    }
  }

  return { totals, cursor };
};

const runWithConcurrency = async (items, limit, fn) => {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
};

const toNumberSafe = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const ETH_ALIAS_ADDRESSES = new Set([
  ZERO_ADDRESS,
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
]);

const isWethLike = (token, addr) => {
  const normalized = normalizeAddress(token);
  if (!normalized) return false;
  if (addr?.weth && normalized === addr.weth) return true;
  return ETH_ALIAS_ADDRESSES.has(normalized);
};

const getBoostPairMultiplier = (token0, token1, addr) => {
  const a = normalizeAddress(token0);
  const b = normalizeAddress(token1);
  if (!a || !b) return 1;
  const hasCrx = a === addr.crx || b === addr.crx;
  if (!hasCrx) return 1;
  const hasUsdm = a === addr.usdm || b === addr.usdm;
  if (hasUsdm) return 3;
  const hasWeth = isWethLike(a, addr) || isWethLike(b, addr);
  if (hasWeth) return 2;
  return 1;
};

const resolveLiquidityActor = (event) =>
  normalizeAddress(event?.origin) ||
  normalizeAddress(event?.sender) ||
  normalizeAddress(event?.owner);

const fetchBoostLiquidityActivityPage = async ({
  url,
  apiKey,
  start,
  end,
}) => {
  const query = `
    query BoostLiquidityActivity($start: Int!, $end: Int!, $first: Int!) {
      mints(
        first: $first
        orderBy: timestamp
        orderDirection: asc
        where: { timestamp_gte: $start, timestamp_lte: $end }
      ) {
        id
        timestamp
        origin
        sender
        owner
        pool {
          token0 { id }
          token1 { id }
        }
      }
      burns(
        first: $first
        orderBy: timestamp
        orderDirection: asc
        where: { timestamp_gte: $start, timestamp_lte: $end }
      ) {
        id
        timestamp
        origin
        owner
        pool {
          token0 { id }
          token1 { id }
        }
      }
    }
  `;

  const data = await postGraph(url, apiKey, query, {
    start,
    end,
    first: PAGE_LIMIT,
  });
  return {
    mints: data?.mints || [],
    burns: data?.burns || [],
  };
};

const ingestBoostLiquidityActivitySource = async ({
  url,
  apiKey,
  startSec,
  endSec,
  addr,
}) => {
  const wallets = new Set();
  let cursor = startSec;
  let done = false;
  let iterations = 0;

  while (!done && iterations < 50) {
    iterations += 1;
    let mints = [];
    let burns = [];
    try {
      const page = await fetchBoostLiquidityActivityPage({
        url,
        apiKey,
        start: cursor,
        end: endSec,
      });
      mints = page?.mints || [];
      burns = page?.burns || [];
    } catch (err) {
      if (isMissingFieldError(err)) {
        if (Number.isFinite(endSec) && endSec >= cursor) {
          cursor = endSec + 1;
        }
        break;
      }
      throw err;
    }

    const events = [...mints, ...burns];
    if (!events.length) {
      if (Number.isFinite(endSec) && endSec >= cursor) {
        cursor = endSec + 1;
      }
      break;
    }

    let lastTs = cursor;
    events.forEach((event) => {
      const ts = Number(event?.timestamp || 0);
      if (Number.isFinite(ts) && ts > lastTs) lastTs = ts;
      const token0 = normalizeAddress(event?.pool?.token0?.id);
      const token1 = normalizeAddress(event?.pool?.token1?.id);
      if (getBoostPairMultiplier(token0, token1, addr) < 2) return;
      const wallet = resolveLiquidityActor(event);
      if (!wallet) return;
      wallets.add(wallet);
    });

    if (lastTs <= cursor) {
      if (Number.isFinite(endSec) && endSec >= cursor) {
        cursor = endSec + 1;
      }
      done = true;
    } else {
      cursor = lastTs + 1;
    }

    if (mints.length < PAGE_LIMIT && burns.length < PAGE_LIMIT) {
      done = true;
    }
  }

  return { wallets, cursor };
};

export default async function handler(req, res) {
  const secrets = [process.env.POINTS_INGEST_TOKEN, process.env.CRON_SECRET]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!secrets.length) {
    res.status(503).json({
      error: "Missing required env: set POINTS_INGEST_TOKEN or CRON_SECRET",
    });
    return;
  }
  const authHeader = req.headers?.authorization || "";
  const token = req.query?.token || "";

  if (secrets.length) {
    const matches = secrets.some(
      (secret) =>
        authHeader === `Bearer ${secret}` ||
        authHeader === secret ||
        token === secret
    );
    if (!matches) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { seasonId, startMs, startBlock, endMs, missing: missingSeasonEnv } = getSeasonConfig();
  const { v2Url, v2Key, v3Url, v3Key } = getSubgraphConfig();
  const addr = getAddressConfig();
  if (!seasonId || missingSeasonEnv?.length) {
    res.status(503).json({
      error: `Missing required env: ${missingSeasonEnv?.join(", ") || "POINTS_SEASON_ID"}`,
    });
    return;
  }
  if (addr?.missing?.length) {
    res.status(503).json({
      error: `Missing required env: ${addr.missing.join(", ")}`,
    });
    return;
  }
  if (!v2Url && !v3Url) {
    res.status(503).json({ error: "Subgraph URLs not configured" });
    return;
  }

  const startSec = Math.floor(startMs / 1000);
  const nowSec = Math.floor(Date.now() / 1000);
  const endSec = Math.floor((endMs || Date.now()) / 1000);
  const ingestCeilingSec = Math.min(endSec, nowSec);
  const ingestMaxWindowSeconds = getIngestWindowSeconds();
  const cursorNearTipSeconds = getCursorNearTipSeconds();
  const keys = getKeys(seasonId);

  try {
    const sources = [];
    if (v2Url) sources.push({ source: "v2", url: v2Url, apiKey: v2Key });
    if (v3Url) sources.push({ source: "v3", url: v3Url, apiKey: v3Key });

    const aggregated = new Map();
    const cursorsToSet = [];
    const sourceErrors = [];
    const failedSources = new Set();

    for (const src of sources) {
      const cursorKey = getKeys(seasonId, src.source).cursor;
      const storedCursor = await kv.get(cursorKey);
      const storedCursorNum = Number(storedCursor || 0);
      let cursor =
        Number.isFinite(storedCursorNum) && storedCursorNum > startSec
          ? storedCursorNum
          : startSec;

      try {
        const sourceEndSec = Math.min(
          ingestCeilingSec,
          cursor + ingestMaxWindowSeconds
        );
        const { totals, cursor: nextCursor } = await ingestSource({
          source: src.source,
          url: src.url,
          apiKey: src.apiKey,
          startSec: cursor,
          endSec: sourceEndSec,
          startBlock,
        });

        if (nextCursor && nextCursor > cursor) {
          const advancedEmptyNearTip =
            totals.size === 0 &&
            nextCursor === sourceEndSec + 1 &&
            sourceEndSec >= ingestCeilingSec - cursorNearTipSeconds;
          if (!advancedEmptyNearTip) {
            cursorsToSet.push({ key: cursorKey, value: nextCursor });
          }
        }

        totals.forEach((amount, wallet) => {
          aggregated.set(wallet, (aggregated.get(wallet) || 0) + amount);
        });

        if (src.source === "v3") {
          const lpCursorKey = getKeys(seasonId, "v3-lp").cursor;
          const storedLpCursor = await kv.get(lpCursorKey);
          const storedLpCursorNum = Number(storedLpCursor || 0);
          const lpBackfillSeconds = getLpDiscoveryBackfillSeconds();
          const lpBootstrapStart = Math.max(startSec, cursor - lpBackfillSeconds);
          let lpCursorStart =
            Number.isFinite(storedLpCursorNum) && storedLpCursorNum > startSec
              ? storedLpCursorNum
              : lpBootstrapStart;

          try {
            const lpEndSec = Math.min(
              ingestCeilingSec,
              lpCursorStart + ingestMaxWindowSeconds
            );
            const { wallets: lpWallets, cursor: nextLpCursor } =
              await ingestBoostLiquidityActivitySource({
                url: src.url,
                apiKey: src.apiKey,
                startSec: lpCursorStart,
                endSec: lpEndSec,
                addr,
              });
            lpWallets.forEach((wallet) => {
              if (!wallet) return;
              if (!aggregated.has(wallet)) aggregated.set(wallet, 0);
            });
            if (nextLpCursor && nextLpCursor > lpCursorStart) {
              const advancedEmptyNearTip =
                lpWallets.size === 0 &&
                nextLpCursor === lpEndSec + 1 &&
                lpEndSec >= ingestCeilingSec - cursorNearTipSeconds;
              if (!advancedEmptyNearTip) {
                cursorsToSet.push({ key: lpCursorKey, value: nextLpCursor });
              }
            }
          } catch (error) {
            sourceErrors.push({
              source: "v3-lp",
              message: error?.message || "Unable to process V3 LP activity",
            });
          }
        }
      } catch (error) {
        failedSources.add(src.source);
        sourceErrors.push({
          source: src.source,
          message: error?.message || "Unknown source error",
        });
      }
    }

    if (failedSources.size === sources.length) {
      throw new Error(
        `All points sources failed: ${sourceErrors
          .map((entry) => `${entry.source}=${entry.message}`)
          .join(" | ")}`
      );
    }

    const wallets = Array.from(aggregated.keys());
    const now = Date.now();
    if (!wallets.length) {
      const idlePipeline = kv.pipeline();
      cursorsToSet.forEach((cursor) => {
        if (cursor?.key) idlePipeline.set(cursor.key, cursor.value);
      });
      idlePipeline.set(keys.updatedAt, now);
      await idlePipeline.exec();
      res.status(200).json({
        ok: true,
        seasonId,
        ingestedWallets: 0,
        cursorUpdates: cursorsToSet.length,
        updatedAt: now,
        sourceErrors,
      });
      return;
    }

    const readPipeline = kv.pipeline();
    wallets.forEach((wallet) => readPipeline.hgetall(keys.user(wallet)));
    const existingRows = await readPipeline.exec();

    let priceMap = {};
    if (v3Url) {
      try {
        priceMap = await fetchTokenPricesShared({
          url: v3Url,
          apiKey: v3Key,
          tokenIds: [addr.crx, addr.weth].filter(Boolean),
        });
      } catch (error) {
        sourceErrors.push({
          source: "v3-prices",
          message: error?.message || "Unable to fetch token prices",
        });
        priceMap = {};
      }
    }
    if (addr.usdm) priceMap[addr.usdm] = 1;
    if (addr.weth && !Number.isFinite(priceMap[addr.weth])) {
      priceMap[addr.weth] = 0;
    }

    const seasonBoostActive = now >= startMs;

    const computed = await runWithConcurrency(wallets, CONCURRENCY, async (wallet, idx) => {
      const row = existingRows?.[idx] || {};
      const increment = aggregated.get(wallet) || 0;
      const currentVolume = (toNumberSafe(row?.volumeUsd) || 0) + increment;
      const previousPoints = toNumberSafe(row?.points);
      const previousRank = toNumberSafe(row?.rank);
      const previousUpdatedAt = toNumberSafe(row?.updatedAt);
      const snapshot24hAtRaw = toNumberSafe(row?.snapshot24hAt);
      const snapshot24hPointsRaw = toNumberSafe(row?.snapshot24hPoints);
      const snapshot24hRankRaw = toNumberSafe(row?.snapshot24hRank);
      const hasFreshSnapshot =
        Number.isFinite(snapshot24hAtRaw) &&
        snapshot24hAtRaw > 0 &&
        now - snapshot24hAtRaw < SNAPSHOT_WINDOW_MS;

      const lpData = await computeLpDataShared({
        url: v3Url,
        apiKey: v3Key,
        wallet,
        addr,
        priceMap,
        startBlock,
      });

      const points = computePointsShared({
        volumeUsd: currentVolume,
        lpUsdTotal: lpData.lpUsd,
        lpUsdCrxEth: lpData.lpUsdCrxEth,
        lpUsdCrxUsdm: lpData.lpUsdCrxUsdm,
        boostEnabled: seasonBoostActive,
      });

      return {
        wallet,
        volumeUsd: currentVolume,
        previousPoints,
        previousRank,
        previousUpdatedAt,
        snapshot24hAt: hasFreshSnapshot ? snapshot24hAtRaw : now,
        snapshot24hPoints: hasFreshSnapshot
          ? Number.isFinite(snapshot24hPointsRaw)
            ? snapshot24hPointsRaw
            : Number.isFinite(previousPoints)
            ? previousPoints
            : points.totalPoints
          : Number.isFinite(previousPoints)
          ? previousPoints
          : points.totalPoints,
        snapshot24hRank: hasFreshSnapshot
          ? Number.isFinite(snapshot24hRankRaw) && snapshot24hRankRaw > 0
            ? snapshot24hRankRaw
            : Number.isFinite(previousRank) && previousRank > 0
            ? previousRank
            : ""
          : Number.isFinite(previousRank) && previousRank > 0
          ? previousRank
          : "",
        rawVolumeUsd: points.rawVolumeUsd,
        effectiveVolumeUsd: points.effectiveVolumeUsd,
        scoringMode: points.scoringMode,
        feeBps: points.feeBps,
        volumeCapUsd: points.volumeCapUsd,
        diminishingFactor: points.diminishingFactor,
        basePoints: points.basePoints,
        bonusPoints: points.bonusPoints,
        points: points.totalPoints,
        boostedVolumeUsd: points.boostedVolumeUsd,
        boostedVolumeCap: points.boostedVolumeCap,
        multiplier: points.effectiveMultiplier,
        baseMultiplier: points.effectiveMultiplier,
        lpUsd: points.lpUsd,
        lpUsdCrxEth: points.lpUsdCrxEth,
        lpUsdCrxUsdm: points.lpUsdCrxUsdm,
        lpPoints: points.lpPoints,
        lpInRangePct: lpData.lpInRangePct,
        hasBoostLp: lpData.hasBoostLp,
        hasRangeData: lpData.hasRangeData,
        hasInRange: lpData.hasInRange,
        lpAgeSeconds: lpData.lpAgeSeconds,
      };
    });

    const writePipeline = kv.pipeline();
    computed.forEach((entry) => {
      const userKey = keys.user(entry.wallet);
      writePipeline.zadd(keys.leaderboard, {
        score: entry.points,
        member: entry.wallet,
      });
      writePipeline.hset(userKey, {
        address: entry.wallet,
        volumeUsd: entry.volumeUsd,
        rawVolumeUsd: entry.rawVolumeUsd,
        effectiveVolumeUsd: entry.effectiveVolumeUsd,
        scoringMode: entry.scoringMode,
        scoringFeeBps: entry.feeBps,
        volumeCapUsd: entry.volumeCapUsd,
        diminishingFactor: entry.diminishingFactor,
        points: entry.points,
        basePoints: entry.basePoints,
        bonusPoints: entry.bonusPoints,
        boostedVolumeUsd: entry.boostedVolumeUsd,
        boostedVolumeCap: entry.boostedVolumeCap,
        multiplier: entry.multiplier,
        baseMultiplier: entry.baseMultiplier,
        lpUsd: entry.lpUsd,
        lpUsdCrxEth: entry.lpUsdCrxEth,
        lpUsdCrxUsdm: entry.lpUsdCrxUsdm,
        lpPoints: entry.lpPoints,
        lpInRangePct: entry.lpInRangePct,
        hasBoostLp: entry.hasBoostLp ? 1 : 0,
        hasRangeData: entry.hasRangeData ? 1 : 0,
        hasInRange: entry.hasInRange ? 1 : 0,
        prevPoints: Number.isFinite(entry.previousPoints) ? entry.previousPoints : "",
        prevRank: Number.isFinite(entry.previousRank) ? entry.previousRank : "",
        prevUpdatedAt: Number.isFinite(entry.previousUpdatedAt) ? entry.previousUpdatedAt : "",
        snapshot24hPoints: entry.snapshot24hPoints,
        snapshot24hRank: entry.snapshot24hRank,
        snapshot24hAt: entry.snapshot24hAt,
        lpAgeSeconds: entry.lpAgeSeconds ?? "",
        updatedAt: now,
      });
    });

    cursorsToSet.forEach((cursor) => {
      if (cursor?.key) writePipeline.set(cursor.key, cursor.value);
    });

    writePipeline.set(keys.updatedAt, now);
    await writePipeline.exec();

    const rankPipeline = kv.pipeline();
    computed.forEach((entry) => {
      rankPipeline.zrevrank(keys.leaderboard, entry.wallet);
    });
    const rankResults = await rankPipeline.exec();

    const rankWrite = kv.pipeline();
    computed.forEach((entry, idx) => {
      const rankValue = Number(rankResults?.[idx]);
      if (Number.isFinite(rankValue)) {
        rankWrite.hset(keys.user(entry.wallet), { rank: rankValue + 1 });
      }
    });
    await rankWrite.exec();
    const leaderboardEntries = await kv.zrange(keys.leaderboard, 0, -1, {
      withScores: true,
    });
    let walletCount = 0;
    let totalPoints = 0;
    for (let i = 0; i < leaderboardEntries.length; i += 2) {
      const score = Number(leaderboardEntries[i + 1] || 0);
      if (!Number.isFinite(score) || score <= 0) continue;
      walletCount += 1;
      totalPoints += score;
    }
    const rewardsConfig = getLeaderboardRewardsConfig(seasonId);
    const scoringSample = computed[0] || {};
    const summary = buildPointsSummary({
      seasonId,
      walletCount,
      totalPoints,
      scoringMode: scoringSample.scoringMode || "",
      scoringFeeBps: scoringSample.feeBps || 0,
      volumeCapUsd: scoringSample.volumeCapUsd || 0,
      diminishingFactor: scoringSample.diminishingFactor || 0,
      config: rewardsConfig,
      nowMs: now,
    });
    await kv.hset(keys.summary, summary);

    res.status(200).json({
      ok: true,
      seasonId,
      updatedAt: now,
      ingestedWallets: aggregated.size,
      cursorUpdates: cursorsToSet.length,
      ingestMaxWindowSeconds,
      sourceErrors,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}


