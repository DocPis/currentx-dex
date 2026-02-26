/* eslint-env node */
import { Contract, JsonRpcProvider, id, toBeHex, zeroPadValue } from "ethers";

const PAGE_LIMIT = 200;
const MAX_POSITIONS = 200;
const CONCURRENCY = 4;
const POINTS_DEFAULT_VOLUME_CAP_USD = 250_000;
const POINTS_DEFAULT_DIMINISHING_FACTOR = 0.25;
const POINTS_DEFAULT_SCORING_MODE = "volume";
const POINTS_DEFAULT_FEE_BPS = 30;
const GRAPH_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_GRAPH_TIMEOUT_MS = 12_000;
const DEFAULT_ONCHAIN_TIMEOUT_MS = 12_000;
const DEFAULT_ONCHAIN_CALL_TIMEOUT_MS = 4_000;
const DEFAULT_ONCHAIN_POOL_TIMEOUT_MS = 2_500;
const DEFAULT_STAKER_SCAN_TIMEOUT_MS = 3_500;
const DEFAULT_LP_AGE_TIMEOUT_MS = 2_500;
const MAX_INFERRED_TOKEN_USD = 1_000_000_000;
const PRICE_INFERENCE_MAX_PASSES = 3;

const CANONICAL_WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const CANONICAL_USDM_ADDRESS = "0xfafddbb3fc7688494971a79cc65dca3ef82079e7";
const CANONICAL_CRX_ADDRESS = "0xbd5e387fa453cebf03b1a6a9dfe2a828b93aa95b";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_UNIV3_FACTORY_ADDRESS = "0x09cf8a0b9e8c89bff6d1acbe1467e8e335bdd03e";
const DEFAULT_UNIV3_POSITION_MANAGER_ADDRESS =
  "0xa02e90a5f5ef73c434f5a7e6a77e6508f009cb9d";
const DEFAULT_V3_STAKER_ADDRESS = "0xc6a9db70b5618dfbca05fa7db11bec48782d5590";
const DEFAULT_V3_STAKER_DEPLOY_BLOCK = 7873058;
const STAKER_LOG_CHUNK_SIZE = 5000;
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
const positionsQueryCache = new Map();

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
    staker: normalize(
      pickEnvValue(
        process.env.POINTS_V3_STAKER_ADDRESS,
        process.env.POINTS_UNIV3_STAKER_ADDRESS,
        process.env.VITE_V3_STAKER_ADDRESS,
        DEFAULT_V3_STAKER_ADDRESS
      )
    ),
    stakerDeployBlock:
      parseBlock(process.env.POINTS_V3_STAKER_DEPLOY_BLOCK) ||
      parseBlock(process.env.VITE_V3_STAKER_DEPLOY_BLOCK) ||
      DEFAULT_V3_STAKER_DEPLOY_BLOCK,
  };
};

const providerCache = new Map();
const tokenDecimalsCache = new Map();
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
const ERC20_METADATA_ABI = [
  "function decimals() view returns (uint8)",
];
const UNIV3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
];
const UNIV3_POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
];

const toTopicAddress = (addr) =>
  `0x${(addr || "").toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

const parseAddressTopic = (topic) => {
  if (!topic) return "";
  const value = String(topic).toLowerCase().replace(/^0x/, "");
  if (value.length < 40) return "";
  return `0x${value.slice(-40)}`;
};

const isValidAddress = (value) =>
  /^0x[a-f0-9]{40}$/u.test(String(value || "").toLowerCase());

const readTokenDecimals = async (provider, tokenAddress) => {
  const token = normalizeAddress(tokenAddress);
  if (!isValidAddress(token) || token === ZERO_ADDRESS) return 18;
  if (tokenDecimalsCache.has(token)) return tokenDecimalsCache.get(token);
  try {
    const contract = new Contract(token, ERC20_METADATA_ABI, provider);
    const decimals = Number(await contract.decimals());
    const safe = Number.isFinite(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18;
    tokenDecimalsCache.set(token, safe);
    return safe;
  } catch {
    tokenDecimalsCache.set(token, 18);
    return 18;
  }
};

const fetchLogsInChunks = async ({
  provider,
  address,
  topics,
  fromBlock,
  toBlock,
  chunkSize = STAKER_LOG_CHUNK_SIZE,
}) => {
  if (!provider || !address || !Array.isArray(topics)) return [];
  if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock)) return [];
  const out = [];
  let start = Math.max(0, Math.floor(fromBlock));
  const end = Math.max(0, Math.floor(toBlock));
  while (start <= end) {
    const chunkEnd = Math.min(end, start + Math.max(1, chunkSize) - 1);
    const logs = await provider.getLogs({
      address,
      topics,
      fromBlock: start,
      toBlock: chunkEnd,
    });
    if (logs?.length) out.push(...logs);
    if (chunkEnd >= end) break;
    start = chunkEnd + 1;
  }
  return out;
};

const fetchStakerPositionIdsForOwner = async ({
  provider,
  staker,
  owner,
  fromBlock,
}) => {
  if (!provider || !staker || !owner) return [];
  const topic = id("DepositTransferred(uint256,address,address)");
  const ownerTopic = toTopicAddress(owner);
  const latest = await provider.getBlockNumber();
  const from = Number.isFinite(fromBlock) && fromBlock > 0 ? Math.floor(fromBlock) : 0;
  if (from > latest) return [];

  const [logsOld, logsNew] = await Promise.all([
    fetchLogsInChunks({
      provider,
      address: staker,
      topics: [topic, null, ownerTopic],
      fromBlock: from,
      toBlock: latest,
    }),
    fetchLogsInChunks({
      provider,
      address: staker,
      topics: [topic, null, null, ownerTopic],
      fromBlock: from,
      toBlock: latest,
    }),
  ]);

  const logs = [...logsOld, ...logsNew].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return (a.logIndex || 0) - (b.logIndex || 0);
  });

  const ownerByToken = new Map();
  logs.forEach((log) => {
    const tokenTopic = log?.topics?.[1];
    const newOwnerTopic = log?.topics?.[3];
    if (!tokenTopic || !newOwnerTopic) return;
    try {
      const tokenId = BigInt(tokenTopic).toString();
      ownerByToken.set(tokenId, normalizeAddress(parseAddressTopic(newOwnerTopic)));
    } catch {
      // ignore malformed log topics
    }
  });

  const normalizedOwner = normalizeAddress(owner);
  const tokenIds = [];
  ownerByToken.forEach((currentOwner, tokenId) => {
    if (currentOwner !== normalizedOwner) return;
    try {
      tokenIds.push(BigInt(tokenId));
    } catch {
      // ignore malformed token ids
    }
  });

  tokenIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return tokenIds;
};

const fetchPositionsOnchain = async ({
  wallet,
  addr,
  startBlock,
  allowStakerScan = true,
}) => {
  const { rpcUrl, factory, positionManager, staker, stakerDeployBlock } = getOnchainConfig();
  if (!rpcUrl || !factory || !positionManager) return null;
  const provider = getRpcProvider(rpcUrl);
  if (!provider) return null;
  const manager = new Contract(positionManager, POSITION_MANAGER_ABI, provider);
  const onchainCallTimeoutMs = getOnchainCallTimeoutMs();
  const onchainPoolTimeoutMs = getOnchainPoolTimeoutMs();
  const balanceRaw = await withTimeout(
    manager.balanceOf(wallet),
    onchainCallTimeoutMs,
    `On-chain balance lookup timeout for ${wallet}`
  ).catch(() => 0n);
  const count = Math.min(Number(balanceRaw || 0), MAX_ONCHAIN_POSITIONS);
  const walletIds = count
    ? (
        await Promise.all(
          Array.from({ length: count }, (_, idx) =>
            withTimeout(
              manager.tokenOfOwnerByIndex(wallet, idx),
              onchainCallTimeoutMs,
              `On-chain token index timeout for ${wallet}#${idx}`
            ).catch(() => null)
          )
        )
      ).filter((tokenId) => tokenId !== null && tokenId !== undefined)
    : [];
  const mapPosition = (pos, tokenId) => {
    const token0 = normalizeAddress(pos?.token0 || "");
    const token1 = normalizeAddress(pos?.token1 || "");
    return {
      __normalized: true,
      tokenId,
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
  };

  const walletPositions = walletIds.length
    ? await Promise.all(
        walletIds.map((tokenId) =>
          withTimeout(
            manager.positions(tokenId),
            onchainCallTimeoutMs,
            `On-chain position lookup timeout for token ${BigInt(tokenId).toString()}`
          ).catch(() => null)
        )
      )
    : [];
  let normalized = walletPositions
    .map((pos, idx) => (pos ? mapPosition(pos, walletIds[idx]) : null))
    .filter(Boolean);

  const hasWalletBoost = normalized.some(
    (pos) => pos.liquidity > 0n && isBoostPair(pos.token0, pos.token1, addr)
  );

  if (allowStakerScan && (!normalized.length || !hasWalletBoost) && staker) {
    const stakerTokenIds = await withTimeout(
      fetchStakerPositionIdsForOwner({
        provider,
        staker,
        owner: wallet,
        fromBlock: stakerDeployBlock,
      }),
      getStakerScanTimeoutMs(),
      `Staker LP lookup timeout for ${wallet}`
    ).catch(() => []);

    if (stakerTokenIds.length) {
      const seen = new Set(walletIds.map((tokenId) => BigInt(tokenId).toString()));
      const remainingSlots = Math.max(0, MAX_ONCHAIN_POSITIONS - seen.size);
      const extraTokenIds = stakerTokenIds
        .filter((tokenId) => !seen.has(tokenId.toString()))
        .slice(0, remainingSlots);

      if (extraTokenIds.length) {
        const extraPositions = await Promise.all(
          extraTokenIds.map((tokenId) =>
            withTimeout(
              manager.positions(tokenId),
              onchainCallTimeoutMs,
              `On-chain staker position timeout for token ${tokenId.toString()}`
            ).catch(() => null)
          )
        );
        normalized = normalized.concat(
          extraPositions
            .map((pos, idx) => (pos ? mapPosition(pos, extraTokenIds[idx]) : null))
            .filter(Boolean)
        );
      }
    }
  }

  if (!normalized.length) {
    return { positions: [], lpAgeSeconds: null };
  }

  const tokensToLoadDecimals = Array.from(
    new Set(
      normalized
        .flatMap((pos) => [normalizeAddress(pos?.token0), normalizeAddress(pos?.token1)])
        .filter((token) => isValidAddress(token) && token !== ZERO_ADDRESS)
    )
  );
  if (tokensToLoadDecimals.length) {
    const decimalsRows = await Promise.all(
      tokensToLoadDecimals.map(async (token) => [
        token,
        await withTimeout(
          readTokenDecimals(provider, token),
          onchainCallTimeoutMs,
          `On-chain token decimals timeout for ${token}`
        ).catch(() => 18),
      ])
    );
    const decimalsMap = Object.fromEntries(decimalsRows);
    normalized = normalized.map((pos) => ({
      ...pos,
      decimals0: Number.isFinite(decimalsMap[pos.token0]) ? decimalsMap[pos.token0] : 18,
      decimals1: Number.isFinite(decimalsMap[pos.token1]) ? decimalsMap[pos.token1] : 18,
    }));
  }

  const factoryContract = new Contract(factory, UNIV3_FACTORY_ABI, provider);
  const uniquePools = new Map();
  normalized.forEach((pos) => {
    if (pos.liquidity <= 0n || !pos.token0 || !pos.token1) return;
    const key = `${pos.token0}:${pos.token1}:${pos.fee}`;
    if (!uniquePools.has(key)) uniquePools.set(key, pos);
  });

  const poolState = new Map();
  const poolRows = await Promise.all(
    Array.from(uniquePools.values()).map(async (pos) => {
      const key = `${pos.token0}:${pos.token1}:${pos.fee}`;
      try {
        let poolAddress = await withTimeout(
          factoryContract.getPool(pos.token0, pos.token1, pos.fee),
          onchainPoolTimeoutMs,
          `On-chain getPool timeout for ${key}`
        ).catch(() => ZERO_ADDRESS);
        if (!poolAddress || poolAddress === ZERO_ADDRESS) {
          poolAddress = await withTimeout(
            factoryContract.getPool(pos.token1, pos.token0, pos.fee),
            onchainPoolTimeoutMs,
            `On-chain getPool reverse timeout for ${key}`
          ).catch(() => ZERO_ADDRESS);
        }
        if (!poolAddress || poolAddress === ZERO_ADDRESS) return null;
        const pool = new Contract(poolAddress, UNIV3_POOL_ABI, provider);
        const slot0 = await withTimeout(
          pool.slot0(),
          onchainPoolTimeoutMs,
          `On-chain slot0 timeout for ${poolAddress}`
        ).catch(() => null);
        if (!slot0) return null;
        return [
          key,
          {
            sqrtPriceX96: slot0?.sqrtPriceX96 ?? null,
            tick: Number(slot0?.tick ?? 0),
          },
        ];
      } catch {
        return null;
      }
    })
  );
  poolRows.forEach((row) => {
    if (!row) return;
    const [key, value] = row;
    if (!key || !value) return;
    poolState.set(key, value);
  });

  normalized.forEach((pos) => {
    const key = `${pos.token0}:${pos.token1}:${pos.fee}`;
    const state = poolState.get(key);
    if (state) {
      pos.poolSqrt = state.sqrtPriceX96;
      pos.poolTick = Number.isFinite(state.tick) ? state.tick : null;
      return;
    }
    // Fallback: keep LP valuation available when slot0 RPC is slow.
    if (Number.isFinite(pos.tickLower) && Number.isFinite(pos.tickUpper)) {
      pos.poolTick = Math.floor((Number(pos.tickLower) + Number(pos.tickUpper)) / 2);
    }
  });

  const lpAgeSeconds = await withTimeout(
    fetchLpAgeSecondsOnchain({
      provider,
      wallet,
      tokenIds: normalized.map((pos) => pos.tokenId).filter(Boolean),
      positionManager,
      startBlock,
    }),
    getLpAgeLookupTimeoutMs(),
    `LP age lookup timeout for ${wallet}`
  ).catch(() => null);

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

export const getSeasonConfig = () => {
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

export const getSubgraphConfig = () => {
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

export const getAddressConfig = () => {
  const normalize = (v) => (v ? String(v).toLowerCase() : "");
  const crx = normalize(
    pickEnvValue(
      process.env.POINTS_CRX_ADDRESS,
      process.env.VITE_CRX_ADDRESS,
      CANONICAL_CRX_ADDRESS
    )
  );
  const weth = normalize(
    pickEnvValue(
      process.env.POINTS_WETH_ADDRESS,
      process.env.VITE_WETH_ADDRESS,
      CANONICAL_WETH_ADDRESS
    )
  );
  const usdm = normalize(
    pickEnvValue(
      process.env.POINTS_USDM_ADDRESS,
      process.env.VITE_USDM_ADDRESS,
      CANONICAL_USDM_ADDRESS
    )
  );
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

const parsePositiveInt = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
};

const getGraphTimeoutMs = () =>
  Math.max(
    1000,
    Math.min(
      120000,
      parsePositiveInt(process.env.POINTS_GRAPH_TIMEOUT_MS, DEFAULT_GRAPH_TIMEOUT_MS)
    )
  );

const getOnchainTimeoutMs = () =>
  Math.max(
    1000,
    Math.min(
      120000,
      parsePositiveInt(process.env.POINTS_ONCHAIN_TIMEOUT_MS, DEFAULT_ONCHAIN_TIMEOUT_MS)
    )
  );

const getOnchainCallTimeoutMs = () =>
  Math.max(
    500,
    Math.min(
      getOnchainTimeoutMs(),
      parsePositiveInt(
        process.env.POINTS_ONCHAIN_CALL_TIMEOUT_MS,
        DEFAULT_ONCHAIN_CALL_TIMEOUT_MS
      )
    )
  );

const getOnchainPoolTimeoutMs = () =>
  Math.max(
    500,
    Math.min(
      getOnchainTimeoutMs(),
      parsePositiveInt(
        process.env.POINTS_ONCHAIN_POOL_TIMEOUT_MS,
        DEFAULT_ONCHAIN_POOL_TIMEOUT_MS
      )
    )
  );

const getStakerScanTimeoutMs = () =>
  Math.max(
    500,
    Math.min(
      getOnchainTimeoutMs(),
      parsePositiveInt(
        process.env.POINTS_STAKER_SCAN_TIMEOUT_MS,
        DEFAULT_STAKER_SCAN_TIMEOUT_MS
      )
    )
  );

const getLpAgeLookupTimeoutMs = () =>
  Math.max(
    500,
    Math.min(
      getOnchainTimeoutMs(),
      parsePositiveInt(process.env.POINTS_LP_AGE_TIMEOUT_MS, DEFAULT_LP_AGE_TIMEOUT_MS)
    )
  );

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async (promise, timeoutMs, message) => {
  const safeTimeout = Math.max(1000, Math.floor(Number(timeoutMs) || 0));
  let timeoutId = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), safeTimeout);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export const postGraph = async (url, apiKey, query, variables) => {
  const urls = dedupeUrls(parseSubgraphUrls(url));
  if (!urls.length) {
    throw new Error("Subgraph URL not configured");
  }
  const timeoutMs = getGraphTimeoutMs();
  let lastError = null;
  for (const candidate of urls) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        let res;
        try {
          res = await fetch(candidate, {
            method: "POST",
            headers: buildHeaders(apiKey),
            body: JSON.stringify({ query, variables }),
            signal: controller.signal,
          });
        } catch (error) {
          if (error?.name === "AbortError") {
            const timeoutError = new Error(`Subgraph timeout after ${timeoutMs}ms`);
            timeoutError.httpStatus = 0;
            throw timeoutError;
          }
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
        if (!res.ok) {
          const err = new Error(`Subgraph HTTP ${res.status}`);
          err.httpStatus = Number(res.status || 0);
          throw err;
        }
        const json = await res.json();
        if (json.errors?.length) {
          const graphError = new Error(json.errors[0]?.message || "Subgraph error");
          graphError.httpStatus = 400;
          throw graphError;
        }
        return json.data;
      } catch (err) {
        lastError = err;
        const status = Number(err?.httpStatus || 0);
        const retriable = GRAPH_RETRY_STATUSES.has(status) || status === 0;
        if (!retriable || attempt >= 4) {
          break;
        }
        const backoffMs = 1000 * (attempt + 1);
        await sleep(backoffMs);
      }
    }
  }
  throw lastError || new Error("Subgraph unavailable");
};

export function normalizeAddress(addr) {
  return addr ? String(addr).toLowerCase() : "";
}

export const resolveWallet = (swap, isV3) => {
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

export const fetchSwapsPage = async ({ url, apiKey, start, end, isV3 }) => {
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

export const getKeys = (seasonId, source) => {
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

export const ingestSource = async ({
  source,
  url,
  apiKey,
  startSec,
  endSec,
}) => {
  const totals = new Map();
  let cursor = startSec;
  let done = false;
  let iterations = 0;

  while (!done && iterations < 50) {
    iterations += 1;
    const swaps = await fetchSwapsPage({
      url,
      apiKey,
      start: cursor,
      end: endSec,
      isV3: source === "v3",
    });
    if (!swaps.length) break;

    let lastTs = cursor;
    swaps.forEach((swap) => {
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

export const runWithConcurrency = async (items, limit, fn) => {
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

export const toNumberSafe = (value) => {
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

export const getPointsScoringPolicy = () => {
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

export const computePoints = ({
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
export const tickToSqrtPriceX96 = (tick) => {
  if (!Number.isFinite(tick)) return null;
  const ratio = Math.pow(1.0001, Number(tick));
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const sqrt = Math.sqrt(ratio);
  if (!Number.isFinite(sqrt) || sqrt <= 0) return null;
  const scaled = sqrt * Number(Q96);
  if (!Number.isFinite(scaled) || scaled <= 0) return null;
  return BigInt(Math.floor(scaled));
};

export const getAmountsForLiquidity = (sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, liquidity) => {
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

export const formatUnits = (value, decimals = 18) => {
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
  if (CANONICAL_WETH_ADDRESS && normalized === normalizeAddress(CANONICAL_WETH_ADDRESS)) {
    return true;
  }
  return ETH_ALIAS_ADDRESSES.has(normalized);
};

const matchAnyAddress = (token, ...candidates) => {
  const normalized = normalizeAddress(token);
  if (!normalized) return false;
  return candidates.some((candidate) => {
    const addr = normalizeAddress(candidate);
    return Boolean(addr) && addr === normalized;
  });
};

export const isBoostPair = (token0, token1, addr) => {
  const a = normalizeAddress(token0);
  const b = normalizeAddress(token1);
  if (!a || !b) return false;
  const hasCrx =
    matchAnyAddress(a, addr?.crx, CANONICAL_CRX_ADDRESS) ||
    matchAnyAddress(b, addr?.crx, CANONICAL_CRX_ADDRESS);
  const hasWeth = isWethLike(a, addr) || isWethLike(b, addr);
  const hasUsdm =
    matchAnyAddress(a, addr?.usdm, CANONICAL_USDM_ADDRESS) ||
    matchAnyAddress(b, addr?.usdm, CANONICAL_USDM_ADDRESS);
  return hasCrx && (hasWeth || hasUsdm);
};

const getBoostPairMultiplier = (token0, token1, addr) => {
  const a = normalizeAddress(token0);
  const b = normalizeAddress(token1);
  if (!a || !b) return 1;
  const hasCrx =
    matchAnyAddress(a, addr?.crx, CANONICAL_CRX_ADDRESS) ||
    matchAnyAddress(b, addr?.crx, CANONICAL_CRX_ADDRESS);
  if (!hasCrx) return 1;
  const hasUsdm =
    matchAnyAddress(a, addr?.usdm, CANONICAL_USDM_ADDRESS) ||
    matchAnyAddress(b, addr?.usdm, CANONICAL_USDM_ADDRESS);
  if (hasUsdm) return 3;
  const hasWeth = isWethLike(a, addr) || isWethLike(b, addr);
  if (hasWeth) return 2;
  return 1;
};

export const fetchTokenPrices = async ({ url, apiKey, tokenIds }) => {
  if (!url || !tokenIds.length) return {};
  const ids = Array.from(
    new Set(
      (tokenIds || [])
        .map((token) => normalizeAddress(token))
        .filter(Boolean)
    )
  );
  if (!ids.length) return {};

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

  const buildPriceMap = (data) => {
    const bundle = data?.bundles?.[0] || {};
    const ethPrice = Number(bundle.ethPriceUSD || bundle.ethPrice || 0);
    if (!Number.isFinite(ethPrice) || ethPrice <= 0) return {};
    const out = {};
    (data?.tokens || []).forEach((token) => {
      const normalized = normalizeAddress(token?.id);
      const derived = Number(token?.derivedETH || 0);
      if (!normalized || !Number.isFinite(derived) || derived <= 0) return;
      out[normalized] = derived * ethPrice;
    });
    return out;
  };

  const urls = dedupeUrls(parseSubgraphUrls(url));
  if (!urls.length) return {};

  let best = {};
  let lastError = null;

  for (const candidate of urls) {
    try {
      const data = await postGraph(candidate, apiKey, query, { ids });
      const candidatePrices = buildPriceMap(data);
      if (Object.keys(candidatePrices).length > Object.keys(best).length) {
        best = candidatePrices;
      }
      if (Object.keys(best).length >= ids.length) break;
    } catch (err) {
      lastError = err;
    }
  }

  if (Object.keys(best).length) return best;
  if (lastError) throw lastError;
  return {};
};

export const fetchPositions = async ({ url, apiKey, owner }) => {
  if (!url) return [];
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

  const cacheKey = dedupeUrls(parseSubgraphUrls(url)).join(",");
  const cachedQuery = positionsQueryCache.has(cacheKey)
    ? positionsQueryCache.get(cacheKey)
    : undefined;
  let selectedQuery = cachedQuery === undefined ? null : cachedQuery;

  if (selectedQuery === undefined) selectedQuery = null;

  if (cachedQuery === undefined) {
    for (const variant of queryVariants) {
      try {
        await postGraph(url, apiKey, variant.query, {
          owner,
          first: 1,
          skip: 0,
        });
        selectedQuery = variant.query;
        positionsQueryCache.set(cacheKey, selectedQuery);
        break;
      } catch (err) {
        const message = err?.message || "";
        if (message.includes("Cannot query field") || message.includes("has no field")) {
          continue;
        }
        throw err;
      }
    }
    if (!selectedQuery) {
      positionsQueryCache.set(cacheKey, null);
      return null;
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

export const computeLpData = async ({
  url,
  apiKey,
  wallet,
  addr,
  priceMap,
  startBlock,
  allowOnchain = true,
  allowStakerScan = true,
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

  let positions = null;
  let lpAgeSeconds = null;
  if (url) {
    try {
      positions = await fetchPositions({ url, apiKey, owner: wallet });
    } catch {
      positions = null;
    }
  }
  let active = normalizeActive(positions);
  const missingPoolData = !hasPoolPriceData(active);

  const needOnchain =
    allowOnchain &&
    (
      !positions ||
      !positions.length ||
      !active.length ||
      !hasCreatedAtData(active) ||
      missingPoolData
    );

  if (needOnchain) {
    const onchain = await withTimeout(
      fetchPositionsOnchain({
        wallet,
        addr,
        startBlock,
        allowStakerScan,
      }).catch(() => null),
      getOnchainTimeoutMs(),
      "On-chain LP lookup timeout"
    ).catch(() => null);
    const onchainActive = normalizeActive(onchain?.positions || []);
    const onchainLpAgeSeconds = Number(onchain?.lpAgeSeconds);
    if (Number.isFinite(onchainLpAgeSeconds) && onchainLpAgeSeconds >= 0) {
      lpAgeSeconds = Math.floor(onchainLpAgeSeconds);
    }
    if ((!active.length || missingPoolData) && onchainActive.length) {
      active = onchainActive;
    }
  }

  if (!active.length) return emptyData();

  const mergedPriceMap = { ...(priceMap || {}) };
  [addr?.usdm, CANONICAL_USDM_ADDRESS]
    .map((token) => normalizeAddress(token))
    .filter(Boolean)
    .forEach((token) => {
      mergedPriceMap[token] = 1;
    });
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

  const inferPairPriceRatioFromTick = (pos) => {
    if (!Number.isFinite(pos?.poolTick)) return null;
    const decimals0 = Number.isFinite(pos?.decimals0) ? Number(pos.decimals0) : 18;
    const decimals1 = Number.isFinite(pos?.decimals1) ? Number(pos.decimals1) : 18;
    const ratioRaw = Math.pow(1.0001, Number(pos.poolTick));
    if (!Number.isFinite(ratioRaw) || ratioRaw <= 0) return null;
    const scale = Math.pow(10, decimals0 - decimals1);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const ratio = ratioRaw * scale; // token1 per token0
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    return ratio;
  };

  // Expand token USD coverage from active pools when one side is already priced.
  for (let pass = 0; pass < PRICE_INFERENCE_MAX_PASSES; pass += 1) {
    let changed = false;
    active.forEach((pos) => {
      const token0 = normalizeAddress(pos?.token0);
      const token1 = normalizeAddress(pos?.token1);
      if (!token0 || !token1) return;
      const ratio = inferPairPriceRatioFromTick(pos);
      if (!Number.isFinite(ratio) || ratio <= 0) return;

      const known0 = Number(mergedPriceMap[token0]);
      const known1 = Number(mergedPriceMap[token1]);
      const has0 = Number.isFinite(known0) && known0 > 0;
      const has1 = Number.isFinite(known1) && known1 > 0;

      if (has0 && !has1) {
        const inferred1 = known0 / ratio;
        if (
          Number.isFinite(inferred1) &&
          inferred1 > 0 &&
          inferred1 <= MAX_INFERRED_TOKEN_USD
        ) {
          mergedPriceMap[token1] = inferred1;
          changed = true;
        }
      } else if (!has0 && has1) {
        const inferred0 = known1 * ratio;
        if (
          Number.isFinite(inferred0) &&
          inferred0 > 0 &&
          inferred0 <= MAX_INFERRED_TOKEN_USD
        ) {
          mergedPriceMap[token0] = inferred0;
          changed = true;
        }
      }
    });
    if (!changed) break;
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
    lpAgeSeconds,
    baseMultiplier: highestPoolMultiplier,
  };
};

export const getConcurrency = () => CONCURRENCY;
export const getPageLimit = () => PAGE_LIMIT;

