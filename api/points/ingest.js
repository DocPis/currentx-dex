import { kv } from "@vercel/kv";
import { Contract, JsonRpcProvider, id, toBeHex, zeroPadValue } from "ethers";
import {
  buildPointsSummary,
  getLeaderboardRewardsConfig,
} from "../../src/server/leaderboardRewardsLib.js";


const PAGE_LIMIT = 1000;
const MAX_POSITIONS = 200;
const CONCURRENCY = 4;
const SNAPSHOT_WINDOW_MS = 24 * 60 * 60 * 1000;
const POINTS_DEFAULT_VOLUME_CAP_USD = 250_000;
const POINTS_DEFAULT_DIMINISHING_FACTOR = 0.25;
const POINTS_DEFAULT_SCORING_MODE = "volume";
const POINTS_DEFAULT_FEE_BPS = 30;


const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_UNIV3_FACTORY_ADDRESS = "0x09cf8a0b9e8c89bff6d1acbe1467e8e335bdd03e";
const DEFAULT_UNIV3_POSITION_MANAGER_ADDRESS =
  "0xa02e90a5f5ef73c434f5a7e6a77e6508f009cb9d";
const MAX_ONCHAIN_POSITIONS = 50;
const MAX_AGE_LOGS = 12;
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

const parseRpcUrls = (value) => {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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

const getRpcUrl = () => {
  const candidates = [
    process.env.POINTS_RPC_URL,
    process.env.RPC_URL,
    process.env.VITE_RPC_URL,
    process.env.VITE_RPC_URLS,
    process.env.VITE_RPC_FALLBACK,
    process.env.VITE_RPC_TATUM,
    process.env.VITE_RPC_THIRDWEB,
    "https://mainnet.megaeth.com/rpc",
    "https://rpc-megaeth-mainnet.globalstake.io",
  ];
  for (const candidate of candidates) {
    const parsed = parseRpcUrls(candidate);
    if (parsed.length) return parsed[0];
  }
  return "";
};

const getOnchainConfig = () => {
  const normalize = (v) => (v ? String(v).toLowerCase() : "");
  return {
    rpcUrl: getRpcUrl(),
    factory: normalize(
      pickEnvValue(
        process.env.POINTS_UNIV3_FACTORY_ADDRESS,
        process.env.VITE_UNIV3_FACTORY_ADDRESS,
        DEFAULT_UNIV3_FACTORY_ADDRESS
      )
    ),
    positionManager: normalize(
      pickEnvValue(
        process.env.POINTS_UNIV3_POSITION_MANAGER_ADDRESS,
        process.env.VITE_UNIV3_POSITION_MANAGER_ADDRESS,
        DEFAULT_UNIV3_POSITION_MANAGER_ADDRESS
      )
    ),
  };
};

const providerCache = new Map();
const getRpcProvider = (rpcUrl) => {
  if (!rpcUrl) return null;
  if (providerCache.has(rpcUrl)) return providerCache.get(rpcUrl);
  const provider = new JsonRpcProvider(rpcUrl);
  providerCache.set(rpcUrl, provider);
  return provider;
};

const POSITION_MANAGER_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function positions(uint256 tokenId) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)",
];
const UNIV3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
];
const UNIV3_POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
];

const toTopicAddress = (addr) =>
  `0x${(addr || "").toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

const fetchPositionsOnchain = async ({ wallet, startBlock }) => {
  const { rpcUrl, factory, positionManager } = getOnchainConfig();
  if (!rpcUrl || !factory || !positionManager) return null;
  const provider = getRpcProvider(rpcUrl);
  if (!provider) return null;
  const manager = new Contract(positionManager, POSITION_MANAGER_ABI, provider);
  const balanceRaw = await manager.balanceOf(wallet);
  const count = Math.min(Number(balanceRaw || 0), MAX_ONCHAIN_POSITIONS);
  if (!count) {
    return { positions: [], lpAgeSeconds: null };
  }

  const ids = await Promise.all(
    Array.from({ length: count }, (_, idx) => manager.tokenOfOwnerByIndex(wallet, idx))
  );
  const positionsRaw = await Promise.all(ids.map((id) => manager.positions(id)));
  const normalized = positionsRaw.map((pos, idx) => {
    const token0 = normalizeAddress(pos?.token0 || "");
    const token1 = normalizeAddress(pos?.token1 || "");
    return {
      __normalized: true,
      tokenId: ids[idx],
      token0,
      token1,
      tickLower: Number(pos?.tickLower ?? 0),
      tickUpper: Number(pos?.tickUpper ?? 0),
      liquidity: BigInt(pos?.liquidity || 0),
      fee: Number(pos?.fee ?? 0),
      createdAt: null,
      poolTick: null,
      poolSqrt: null,
      decimals0: 18,
      decimals1: 18,
    };
  });

  const factoryContract = new Contract(factory, UNIV3_FACTORY_ABI, provider);
  const uniquePools = new Map();
  normalized.forEach((pos) => {
    if (pos.liquidity <= 0n || !pos.token0 || !pos.token1) return;
    const key = `${pos.token0}:${pos.token1}:${pos.fee}`;
    if (!uniquePools.has(key)) uniquePools.set(key, pos);
  });

  const poolState = new Map();
  for (const pos of uniquePools.values()) {
    let poolAddress = await factoryContract.getPool(pos.token0, pos.token1, pos.fee);
    if (!poolAddress || poolAddress === ZERO_ADDRESS) {
      poolAddress = await factoryContract.getPool(pos.token1, pos.token0, pos.fee);
    }
    if (!poolAddress || poolAddress === ZERO_ADDRESS) continue;
    try {
      const pool = new Contract(poolAddress, UNIV3_POOL_ABI, provider);
      const slot0 = await pool.slot0();
      poolState.set(`${pos.token0}:${pos.token1}:${pos.fee}`, {
        sqrtPriceX96: slot0?.sqrtPriceX96 ?? null,
        tick: Number(slot0?.tick ?? 0),
      });
    } catch {
      // ignore pool fetch errors
    }
  }

  normalized.forEach((pos) => {
    const key = `${pos.token0}:${pos.token1}:${pos.fee}`;
    const state = poolState.get(key);
    if (state) {
      pos.poolSqrt = state.sqrtPriceX96;
      pos.poolTick = Number.isFinite(state.tick) ? state.tick : null;
    }
  });

  const lpAgeSeconds = await fetchLpAgeSecondsOnchain({
    provider,
    wallet,
    tokenIds: ids,
    positionManager,
    startBlock,
  });

  return { positions: normalized, lpAgeSeconds };
};

const fetchLpAgeSecondsOnchain = async ({
  provider,
  wallet,
  tokenIds,
  positionManager,
  startBlock,
}) => {
  if (!provider || !positionManager || !wallet || !tokenIds?.length) return null;
  const transferTopic = id("Transfer(address,address,uint256)");
  const zeroTopic = toTopicAddress(ZERO_ADDRESS);
  const walletTopic = toTopicAddress(wallet);
  const fromBlock =
    Number.isFinite(startBlock) && startBlock > 0 ? startBlock : 0;
  let earliest = null;
  const sample = tokenIds.slice(0, MAX_AGE_LOGS);
  for (const tokenId of sample) {
    const tokenHex = zeroPadValue(toBeHex(tokenId), 32);
    const logs = await provider.getLogs({
      address: positionManager,
      fromBlock,
      toBlock: "latest",
      topics: [transferTopic, zeroTopic, walletTopic, tokenHex],
    });
    if (!logs?.length) continue;
    const log = logs[0];
    const block = await provider.getBlock(log.blockNumber);
    const ts = Number(block?.timestamp || 0);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    if (!earliest || ts < earliest) earliest = ts;
  }
  if (!earliest) return null;
  const diff = Math.floor(Date.now() / 1000 - earliest);
  return diff >= 0 ? diff : 0;
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

const postGraph = async (url, apiKey, query, variables) => {
  const urls = dedupeUrls(parseSubgraphUrls(url));
  if (!urls.length) {
    throw new Error("Subgraph URL not configured");
  }
  let lastError = null;
  for (const candidate of urls) {
    try {
      const res = await fetch(candidate, {
        method: "POST",
        headers: buildHeaders(apiKey),
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
    } catch (err) {
      lastError = err;
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
    if (!swaps.length) break;

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

const clampNumber = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

const normalizeScoringMode = (value) => {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "fees" || mode === "fee") return "fees";
  return "volume";
};

const getPointsScoringPolicy = () => {
  const volumeCapUsd = clampNumber(
    process.env.POINTS_WALLET_VOLUME_CAP_USD,
    0,
    1_000_000_000,
    POINTS_DEFAULT_VOLUME_CAP_USD
  );
  const diminishingFactor = clampNumber(
    process.env.POINTS_WALLET_DIMINISHING_FACTOR,
    0,
    1,
    POINTS_DEFAULT_DIMINISHING_FACTOR
  );
  const scoringMode = normalizeScoringMode(
    process.env.POINTS_SCORING_MODE || POINTS_DEFAULT_SCORING_MODE
  );
  const feeBps = clampNumber(
    process.env.POINTS_SCORING_FEE_BPS,
    1,
    10000,
    POINTS_DEFAULT_FEE_BPS
  );
  return {
    volumeCapUsd,
    diminishingFactor,
    scoringMode,
    feeBps,
  };
};

const applyDiminishingVolume = (volumeUsd, policy) => {
  const raw = Math.max(0, toNumberSafe(volumeUsd) ?? 0);
  const cap = Math.max(0, toNumberSafe(policy?.volumeCapUsd) ?? 0);
  const factor = clampNumber(
    policy?.diminishingFactor,
    0,
    1,
    POINTS_DEFAULT_DIMINISHING_FACTOR
  );
  if (!cap || raw <= cap) return raw;
  const excess = raw - cap;
  return cap + excess * factor;
};

const computeTradeBasePoints = (effectiveVolumeUsd, policy) => {
  const scoringMode = normalizeScoringMode(policy?.scoringMode);
  if (scoringMode === "fees") {
    const feeBps = clampNumber(policy?.feeBps, 1, 10000, POINTS_DEFAULT_FEE_BPS);
    return effectiveVolumeUsd * (feeBps / 10000);
  }
  return effectiveVolumeUsd;
};

const computePoints = ({
  volumeUsd,
  lpUsdTotal = null,
  lpUsdCrxEth = 0,
  lpUsdCrxUsdm = 0,
  boostEnabled = true,
  scoringPolicy = null,
}) => {
  const policy = scoringPolicy || getPointsScoringPolicy();
  const rawVolume = Math.max(0, toNumberSafe(volumeUsd) ?? 0);
  const effectiveVolume = applyDiminishingVolume(rawVolume, policy);
  const tradePoints = computeTradeBasePoints(effectiveVolume, policy);
  const lpEth = Math.max(0, toNumberSafe(lpUsdCrxEth) ?? 0);
  const lpUsdm = Math.max(0, toNumberSafe(lpUsdCrxUsdm) ?? 0);
  const lpPoints = boostEnabled !== false ? lpEth * 2 + lpUsdm * 3 : 0;
  const normalizedTotalLpUsd = toNumberSafe(lpUsdTotal);
  const totalLpUsd =
    normalizedTotalLpUsd !== null
      ? Math.max(0, normalizedTotalLpUsd)
      : lpEth + lpUsdm;
  const multiplier =
    boostEnabled !== false
      ? lpUsdm > 0
        ? 3
        : lpEth > 0
          ? 2
          : 1
      : 1;
  return {
    basePoints: tradePoints,
    bonusPoints: lpPoints,
    totalPoints: tradePoints + lpPoints,
    boostedVolumeUsd: 0,
    boostedVolumeCap: 0,
    lpPoints,
    lpUsd: totalLpUsd,
    lpUsdCrxEth: lpEth,
    lpUsdCrxUsdm: lpUsdm,
    effectiveMultiplier: multiplier,
    rawVolumeUsd: rawVolume,
    effectiveVolumeUsd: effectiveVolume,
    scoringMode: normalizeScoringMode(policy?.scoringMode),
    feeBps: clampNumber(policy?.feeBps, 1, 10000, POINTS_DEFAULT_FEE_BPS),
    volumeCapUsd: Math.max(0, toNumberSafe(policy?.volumeCapUsd) ?? 0),
    diminishingFactor: clampNumber(
      policy?.diminishingFactor,
      0,
      1,
      POINTS_DEFAULT_DIMINISHING_FACTOR
    ),
  };
};

const Q96 = 2n ** 96n;
const tickToSqrtPriceX96 = (tick) => {
  if (!Number.isFinite(tick)) return null;
  const ratio = Math.pow(1.0001, Number(tick));
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const sqrt = Math.sqrt(ratio);
  if (!Number.isFinite(sqrt) || sqrt <= 0) return null;
  const scaled = sqrt * Number(Q96);
  if (!Number.isFinite(scaled) || scaled <= 0) return null;
  return BigInt(Math.floor(scaled));
};

const getAmountsForLiquidity = (sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, liquidity) => {
  if (
    !sqrtPriceX96 ||
    !sqrtPriceAX96 ||
    !sqrtPriceBX96 ||
    !liquidity ||
    liquidity <= 0n
  ) {
    return null;
  }
  let sqrtA = sqrtPriceAX96;
  let sqrtB = sqrtPriceBX96;
  if (sqrtA > sqrtB) {
    [sqrtA, sqrtB] = [sqrtB, sqrtA];
  }
  if (sqrtPriceX96 <= sqrtA) {
    const amount0 = (liquidity * (sqrtB - sqrtA) * Q96) / (sqrtB * sqrtA);
    return { amount0, amount1: 0n };
  }
  if (sqrtPriceX96 < sqrtB) {
    const amount0 = (liquidity * (sqrtB - sqrtPriceX96) * Q96) / (sqrtB * sqrtPriceX96);
    const amount1 = (liquidity * (sqrtPriceX96 - sqrtA)) / Q96;
    return { amount0, amount1 };
  }
  const amount1 = (liquidity * (sqrtB - sqrtA)) / Q96;
  return { amount0: 0n, amount1 };
};

const formatUnits = (value, decimals = 18) => {
  if (value === null || value === undefined) return 0;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  return Number(whole) + Number(frac) / Number(base);
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

const fetchTokenPrices = async ({ url, apiKey, tokenIds }) => {
  if (!tokenIds.length) return {};
  const query = `
    query TokenPrices($ids: [Bytes!]!) {
      tokens(where: { id_in: $ids }) {
        id
        derivedETH
      }
      bundles(first: 1) {
        ethPriceUSD
      }
    }
  `;
  const data = await postGraph(url, apiKey, query, { ids: tokenIds });
  const bundle = data?.bundles?.[0] || {};
  const ethPrice = Number(bundle.ethPriceUSD || bundle.ethPrice || 0);
  const out = {};
  (data?.tokens || []).forEach((token) => {
    const derived = Number(token?.derivedETH || 0);
    if (!Number.isFinite(derived) || derived <= 0 || !ethPrice) return;
    out[normalizeAddress(token.id)] = derived * ethPrice;
  });
  return out;
};

const fetchPositions = async ({ url, apiKey, owner }) => {
  const queryVariants = [
    {
      label: "createdAt+sqrt+tx",
      query: `
        query Positions($owner: Bytes!, $first: Int!, $skip: Int!) {
          positions(where: { owner: $owner, liquidity_gt: 0 }, first: $first, skip: $skip) {
            id
            liquidity
            createdAtTimestamp
            transaction { timestamp }
            tickLower { tickIdx }
            tickUpper { tickIdx }
            token0 { id decimals }
            token1 { id decimals }
            pool { id tick sqrtPrice }
          }
        }
      `,
    },
    {
      label: "createdAt+sqrt",
      query: `
        query Positions($owner: Bytes!, $first: Int!, $skip: Int!) {
          positions(where: { owner: $owner, liquidity_gt: 0 }, first: $first, skip: $skip) {
            id
            liquidity
            createdAtTimestamp
            tickLower { tickIdx }
            tickUpper { tickIdx }
            token0 { id decimals }
            token1 { id decimals }
            pool { id tick sqrtPrice }
          }
        }
      `,
    },
    {
      label: "tx+sqrt",
      query: `
        query Positions($owner: Bytes!, $first: Int!, $skip: Int!) {
          positions(where: { owner: $owner, liquidity_gt: 0 }, first: $first, skip: $skip) {
            id
            liquidity
            transaction { timestamp }
            tickLower { tickIdx }
            tickUpper { tickIdx }
            token0 { id decimals }
            token1 { id decimals }
            pool { id tick sqrtPrice }
          }
        }
      `,
    },
    {
      label: "createdAt",
      query: `
        query Positions($owner: Bytes!, $first: Int!, $skip: Int!) {
          positions(where: { owner: $owner, liquidity_gt: 0 }, first: $first, skip: $skip) {
            id
            liquidity
            createdAtTimestamp
            tickLower { tickIdx }
            tickUpper { tickIdx }
            token0 { id decimals }
            token1 { id decimals }
            pool { id tick }
          }
        }
      `,
    },
    {
      label: "tx",
      query: `
        query Positions($owner: Bytes!, $first: Int!, $skip: Int!) {
          positions(where: { owner: $owner, liquidity_gt: 0 }, first: $first, skip: $skip) {
            id
            liquidity
            transaction { timestamp }
            tickLower { tickIdx }
            tickUpper { tickIdx }
            token0 { id decimals }
            token1 { id decimals }
            pool { id tick }
          }
        }
      `,
    },
    {
      label: "basic+sqrt",
      query: `
        query Positions($owner: Bytes!, $first: Int!, $skip: Int!) {
          positions(where: { owner: $owner, liquidity_gt: 0 }, first: $first, skip: $skip) {
            id
            liquidity
            tickLower { tickIdx }
            tickUpper { tickIdx }
            token0 { id decimals }
            token1 { id decimals }
            pool { id tick sqrtPrice }
          }
        }
      `,
    },
    {
      label: "basic",
      query: `
        query Positions($owner: Bytes!, $first: Int!, $skip: Int!) {
          positions(where: { owner: $owner, liquidity_gt: 0 }, first: $first, skip: $skip) {
            id
            liquidity
            tickLower { tickIdx }
            tickUpper { tickIdx }
            token0 { id decimals }
            token1 { id decimals }
            pool { id tick }
          }
        }
      `,
    },
  ];

  let selectedQuery = null;

  for (const variant of queryVariants) {
    try {
      await postGraph(url, apiKey, variant.query, {
        owner,
        first: 1,
        skip: 0,
      });
      selectedQuery = variant.query;
      break;
    } catch (err) {
      const message = err?.message || "";
      if (message.includes("Cannot query field") || message.includes("has no field")) {
        continue;
      }
      throw err;
    }
  }

  if (!selectedQuery) return null;

  const positions = [];
  let skip = 0;
  while (positions.length < MAX_POSITIONS) {
    const chunk = await postGraph(url, apiKey, selectedQuery, {
      owner,
      first: Math.min(100, MAX_POSITIONS - positions.length),
      skip,
    });
    const rows = chunk?.positions || [];
    positions.push(...rows);
    if (rows.length < 100) break;
    skip += rows.length;
  }

  return positions;
};

const computeLpData = async ({
  url,
  apiKey,
  wallet,
  addr,
  priceMap,
  startBlock,
}) => {
  const emptyData = () => ({
    hasBoostLp: false,
    lpUsd: 0,
    lpUsdCrxEth: 0,
    lpUsdCrxUsdm: 0,
    lpInRangePct: 0,
    hasRangeData: false,
    hasInRange: false,
    lpAgeSeconds: null,
    baseMultiplier: 1,
  });

  const normalizeActive = (rows) =>
    (rows || [])
      .map((pos) => {
        if (pos?.__normalized) return pos;
        const token0 = normalizeAddress(pos?.token0?.id || pos?.token0);
        const token1 = normalizeAddress(pos?.token1?.id || pos?.token1);
        const tickLower = Number(pos?.tickLower?.tickIdx ?? pos?.tickLower ?? 0);
        const tickUpper = Number(pos?.tickUpper?.tickIdx ?? pos?.tickUpper ?? 0);
        const liquidity = BigInt(pos?.liquidity || 0);
        const createdAt = Number(
          pos?.createdAtTimestamp || pos?.transaction?.timestamp || 0
        );
        const poolTick = pos?.pool?.tick ?? null;
        const poolSqrt = pos?.pool?.sqrtPrice ?? pos?.pool?.sqrtPriceX96 ?? null;
        const decimals0 = Number(pos?.token0?.decimals ?? 18);
        const decimals1 = Number(pos?.token1?.decimals ?? 18);
        return {
          token0,
          token1,
          tickLower,
          tickUpper,
          liquidity,
          createdAt,
          poolTick: poolTick !== null ? Number(poolTick) : null,
          poolSqrt,
          decimals0,
          decimals1,
        };
      })
      .filter((pos) => pos.liquidity > 0n);

  const hasCreatedAtData = (rows) =>
    rows.some((pos) => Number.isFinite(pos?.createdAt) && pos.createdAt > 0);
  const hasPoolPriceData = (rows) =>
    rows.some(
      (pos) =>
        pos?.poolSqrt !== null &&
        pos?.poolSqrt !== undefined &&
        pos.poolSqrt !== "" ||
        Number.isFinite(pos?.poolTick)
    );

  let positions = url ? await fetchPositions({ url, apiKey, owner: wallet }) : null;
  let active = normalizeActive(positions);
  const missingPoolData = !hasPoolPriceData(active);

  const needOnchain =
    !positions ||
    !positions.length ||
    !active.length ||
    !hasCreatedAtData(active) ||
    missingPoolData;

  if (needOnchain) {
    const onchain = await fetchPositionsOnchain({
      wallet,
      startBlock,
    }).catch(() => null);
    const onchainActive = normalizeActive(onchain?.positions || []);
    if ((!active.length || missingPoolData) && onchainActive.length) {
      active = onchainActive;
    }
  }

  if (!active.length) return emptyData();

  const mergedPriceMap = { ...(priceMap || {}) };
  if (addr?.usdm) mergedPriceMap[addr.usdm] = 1;
  const missingTokenIds = Array.from(
    new Set(
      active
        .flatMap((pos) => [pos.token0, pos.token1])
        .map((token) => normalizeAddress(token))
        .filter(Boolean)
        .filter((token) => !Number.isFinite(mergedPriceMap[token]))
    )
  );
  if (missingTokenIds.length && url) {
    try {
      const fetched = await fetchTokenPrices({
        url,
        apiKey,
        tokenIds: missingTokenIds,
      });
      Object.entries(fetched || {}).forEach(([token, value]) => {
        const normalized = normalizeAddress(token);
        const numeric = Number(value);
        if (!normalized || !Number.isFinite(numeric)) return;
        mergedPriceMap[normalized] = numeric;
      });
    } catch {
      // ignore token pricing fallback errors
    }
  }

  let lpUsd = 0;
  let lpUsdCrxEth = 0;
  let lpUsdCrxUsdm = 0;
  let missingPrice = false;
  let highestPoolMultiplier = 1;

  active.forEach((pos) => {
    let sqrtPriceX96 = null;
    if (pos.poolSqrt) {
      try {
        sqrtPriceX96 = BigInt(pos.poolSqrt);
      } catch {
        sqrtPriceX96 = null;
      }
    }
    if (!sqrtPriceX96 && Number.isFinite(pos.poolTick)) {
      sqrtPriceX96 = tickToSqrtPriceX96(pos.poolTick);
    }

    const sqrtA = tickToSqrtPriceX96(pos.tickLower);
    const sqrtB = tickToSqrtPriceX96(pos.tickUpper);

    if (!sqrtPriceX96 || !sqrtA || !sqrtB) {
      missingPrice = true;
      return;
    }

    const amounts = getAmountsForLiquidity(sqrtPriceX96, sqrtA, sqrtB, pos.liquidity);
    if (!amounts) {
      missingPrice = true;
      return;
    }

    const price0 = mergedPriceMap[pos.token0];
    const price1 = mergedPriceMap[pos.token1];
    if (!Number.isFinite(price0) || !Number.isFinite(price1)) {
      missingPrice = true;
      return;
    }

    const amount0 = formatUnits(amounts.amount0, pos.decimals0);
    const amount1 = formatUnits(amounts.amount1, pos.decimals1);
    const positionUsd = amount0 * price0 + amount1 * price1;
    if (!Number.isFinite(positionUsd)) {
      missingPrice = true;
      return;
    }

    const pairMultiplier = getBoostPairMultiplier(pos.token0, pos.token1, addr);
    lpUsd += positionUsd;
    if (pairMultiplier >= 3) lpUsdCrxUsdm += positionUsd;
    else if (pairMultiplier >= 2) lpUsdCrxEth += positionUsd;
    if (pairMultiplier > highestPoolMultiplier) {
      highestPoolMultiplier = pairMultiplier;
    }
  });

  const safeLpUsd = missingPrice && lpUsd === 0 ? 0 : lpUsd;
  const safeLpUsdCrxEth = missingPrice && lpUsdCrxEth === 0 ? 0 : lpUsdCrxEth;
  const safeLpUsdCrxUsdm = missingPrice && lpUsdCrxUsdm === 0 ? 0 : lpUsdCrxUsdm;
  const hasBoostLp = safeLpUsdCrxEth > 0 || safeLpUsdCrxUsdm > 0;

  return {
    hasBoostLp,
    lpUsd: safeLpUsd,
    lpUsdCrxEth: safeLpUsdCrxEth,
    lpUsdCrxUsdm: safeLpUsdCrxUsdm,
    lpInRangePct: 0,
    hasRangeData: false,
    hasInRange: false,
    lpAgeSeconds: null,
    baseMultiplier: highestPoolMultiplier,
  };
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
  const endSec = Math.floor((endMs || Date.now()) / 1000);
  const keys = getKeys(seasonId);

  try {
    const sources = [];
    if (v2Url) sources.push({ source: "v2", url: v2Url, apiKey: v2Key });
    if (v3Url) sources.push({ source: "v3", url: v3Url, apiKey: v3Key });

    const aggregated = new Map();
    const cursorsToSet = [];

    for (const src of sources) {
      const cursorKey = getKeys(seasonId, src.source).cursor;
      const storedCursor = await kv.get(cursorKey);
      const cursor =
        Number(storedCursor || 0) > startSec
          ? Number(storedCursor)
          : startSec;

      const { totals, cursor: nextCursor } = await ingestSource({
        source: src.source,
        url: src.url,
        apiKey: src.apiKey,
        startSec: cursor,
        endSec,
        startBlock,
      });

      if (nextCursor && nextCursor > cursor) {
        cursorsToSet.push({ key: cursorKey, value: nextCursor });
      }

      totals.forEach((amount, wallet) => {
        aggregated.set(wallet, (aggregated.get(wallet) || 0) + amount);
      });
    }

    const wallets = Array.from(aggregated.keys());
    if (!wallets.length) {
      res.status(200).json({ ok: true, seasonId, ingestedWallets: 0 });
      return;
    }

    const readPipeline = kv.pipeline();
    wallets.forEach((wallet) => readPipeline.hgetall(keys.user(wallet)));
    const existingRows = await readPipeline.exec();

    const priceMap = v3Url
      ? await fetchTokenPrices({
          url: v3Url,
          apiKey: v3Key,
          tokenIds: [addr.crx, addr.weth].filter(Boolean),
        })
      : {};
    if (addr.usdm) priceMap[addr.usdm] = 1;
    if (addr.weth && !Number.isFinite(priceMap[addr.weth])) {
      priceMap[addr.weth] = 0;
    }

    const now = Date.now();
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

      const lpData = await computeLpData({
        url: v3Url,
        apiKey: v3Key,
        wallet,
        addr,
        priceMap,
        startBlock,
      });

      const points = computePoints({
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
          ? Number.isFinite(snapshot24hRankRaw)
            ? snapshot24hRankRaw
            : Number.isFinite(previousRank)
            ? previousRank
            : ""
          : Number.isFinite(previousRank)
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
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}


