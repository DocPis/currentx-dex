import { Contract, JsonRpcProvider, formatUnits } from "ethers";

const DEFAULT_V3_URLS = [
  "https://api.goldsky.com/api/public/project_cmlbj5xkhtfha01z0caladt37/subgraphs/currentx-v3/1.0.0/gn",
  "https://gateway.thegraph.com/api/subgraphs/id/Hw24iWxGzMM5HvZqENyBQpA6hwdUTQzCSK5e5BfCXyHd",
];
const DEFAULT_WETH = "0x4200000000000000000000000000000000000006";
const DEFAULT_CURRENTX = "0xb1dfc63cbe9305fa6a8fe97b4c72241148e451d1";
const DEFAULT_LP_LOCKER = "0xc43b8a818c9dad3c3f04230c4033131fe040408f";
const DEFAULT_CURRENTX_DEPLOY_BLOCK = 8_000_000;
const DEFAULT_RPC = "https://mainnet.megaeth.com/rpc";
const SNAPSHOT_TTL_MS = 20_000;
const META_TTL_MS = 10 * 60 * 1000;
const LP_LOCK_EVENT_CACHE_TTL_MS = 20_000;
const LP_LOCK_OWNER_CACHE_TTL_MS = 20_000;
const LP_LOCK_LOG_BLOCK_SPAN = 300_000;
const ADDRESS_RE = /^0x[0-9a-f]{40}$/u;

const ERC20_META_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  // CurrentXToken uses imageUrl(); some earlier iterations used image().
  "function imageUrl() view returns (string)",
  "function image() view returns (string)",
  "function metadata() view returns (string)",
  "function context() view returns (string)",
];
const CURRENTX_LAUNCH_ABI = [
  "function positionManager() view returns (address)",
  "event TokenCreated(address indexed tokenAddress, address indexed creatorAdmin, address indexed interfaceAdmin, address creatorRewardRecipient, address interfaceRewardRecipient, uint256 positionId, string name, string symbol, int24 startingTickIfToken0IsNewToken, string metadata, uint256 amountTokensBought, uint256 vaultDuration, uint8 vaultPercentage, address msgSender)",
];
const POSITION_MANAGER_ABI = ["function ownerOf(uint256 tokenId) view returns (address)"];

const toLower = (v) => String(v || "").toLowerCase();
const toNumber = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const csv = (v) =>
  String(v || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const dedupe = (arr) => [...new Set((arr || []).map((v) => String(v || "").trim()).filter(Boolean))];
const IPFS_CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[0-9a-z]{20,})$/iu;
const DEFAULT_ONLY_LAUNCHPAD_TOKENS = true;

const getWeth = () => toLower(process.env.LAUNCHPAD_WETH_ADDRESS || process.env.VITE_WETH_ADDRESS || DEFAULT_WETH);
const getCurrentX = () => {
  const candidates = [
    process.env.LAUNCHPAD_CURRENTX_ADDRESS,
    process.env.CURRENTX_ADDRESS,
    process.env.VITE_CURRENTX_ADDRESS,
    DEFAULT_CURRENTX,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim().toLowerCase();
    if (ADDRESS_RE.test(value)) return value;
  }
  return "";
};
const getCurrentXDeployBlock = () => {
  const raw = Number(
    process.env.LAUNCHPAD_CURRENTX_DEPLOY_BLOCK ||
      process.env.CURRENTX_DEPLOY_BLOCK ||
      process.env.VITE_CURRENTX_DEPLOY_BLOCK
  );
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_CURRENTX_DEPLOY_BLOCK;
};
const getLpLocker = () => {
  const candidates = [
    process.env.LAUNCHPAD_LP_LOCKER_V2_ADDRESS,
    process.env.LAUNCHPAD_LP_LOCKER_ADDRESS,
    process.env.VITE_LP_LOCKER_V2_ADDRESS,
    DEFAULT_LP_LOCKER,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim().toLowerCase();
    if (ADDRESS_RE.test(value)) return value;
  }
  return "";
};
const getRpcUrl = () => {
  const list = [
    process.env.LAUNCHPAD_RPC_URL,
    process.env.RPC_URL,
    process.env.VITE_RPC_URL,
    process.env.VITE_RPC_URLS,
    process.env.VITE_RPC_FALLBACK,
    DEFAULT_RPC,
  ];
  for (const item of list) {
    const parsed = csv(item);
    if (parsed.length) return parsed[0];
  }
  return DEFAULT_RPC;
};

const getGraphCfg = () => {
  const urls = dedupe([
    ...csv(process.env.LAUNCHPAD_UNIV3_SUBGRAPH_URL),
    ...csv(process.env.UNIV3_SUBGRAPH_URL),
    ...csv(process.env.VITE_UNIV3_SUBGRAPH),
    ...DEFAULT_V3_URLS,
  ]);
  const key = String(
    process.env.LAUNCHPAD_UNIV3_SUBGRAPH_API_KEY ||
      process.env.UNIV3_SUBGRAPH_API_KEY ||
      process.env.VITE_UNIV3_SUBGRAPH_API_KEY ||
      ""
  ).trim();
  return { urls, key };
};

const graphNeedsAuth = (url) => {
  const lower = String(url || "").toLowerCase();
  return lower.includes("thegraph.com") || lower.includes("gateway");
};

const graphError = (error) => {
  const message = String(error?.message || "Subgraph unavailable");
  const lower = message.toLowerCase();
  if (
    lower.includes("bad indexer") ||
    lower.includes("indexer not available") ||
    lower.includes("indexer issue")
  ) {
    return "Subgraph temporarily unavailable (indexer issue)";
  }
  return message;
};

const graph = async (query, variables = {}) => {
  const { urls, key } = getGraphCfg();
  if (!urls.length) throw new Error("Missing launchpad subgraph URL");
  let last = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key && graphNeedsAuth(url) ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) throw new Error(`Subgraph HTTP ${res.status}`);
      const json = await res.json();
      if (json?.errors?.length) throw new Error(String(json.errors[0]?.message || "Subgraph error"));
      return json?.data || {};
    } catch (e) {
      last = e;
    }
  }
  throw new Error(graphError(last));
};

const getStore = () => {
  const k = "__cxLaunchpadApi";
  if (!globalThis[k]) {
    globalThis[k] = {
      snapshot: { ts: 0, value: null },
      meta: new Map(),
      provider: null,
      lpLock: {
        currentx: "",
        latestBlock: -1,
        refreshedAt: 0,
        positionManager: "",
        tokenToPosition: new Map(),
        positionToOwner: new Map(),
      },
    };
  }
  const store = globalThis[k];
  if (!store.snapshot) store.snapshot = { ts: 0, value: null };
  if (!(store.meta instanceof Map)) store.meta = new Map();
  if (!store.lpLock || typeof store.lpLock !== "object") {
    store.lpLock = {
      currentx: "",
      latestBlock: -1,
      refreshedAt: 0,
      positionManager: "",
      tokenToPosition: new Map(),
      positionToOwner: new Map(),
    };
  }
  if (!(store.lpLock.tokenToPosition instanceof Map)) store.lpLock.tokenToPosition = new Map();
  if (!(store.lpLock.positionToOwner instanceof Map)) store.lpLock.positionToOwner = new Map();
  if (!Number.isFinite(Number(store.lpLock.latestBlock))) store.lpLock.latestBlock = -1;
  if (!Number.isFinite(Number(store.lpLock.refreshedAt))) store.lpLock.refreshedAt = 0;
  if (typeof store.lpLock.currentx !== "string") store.lpLock.currentx = "";
  if (typeof store.lpLock.positionManager !== "string") store.lpLock.positionManager = "";
  if (!("provider" in store)) store.provider = null;
  return store;
};

const getProvider = () => {
  const store = getStore();
  if (!store.provider) {
    store.provider = new JsonRpcProvider(getRpcUrl());
  }
  return store.provider;
};

const priceFromRow = (row, tokenIs0) => {
  const direct = tokenIs0 ? toNumber(row?.token1Price, 0) : toNumber(row?.token0Price, 0);
  if (direct > 0) return direct;
  const close = toNumber(row?.close, 0);
  if (close <= 0) return 0;
  return tokenIs0 ? close : 1 / close;
};

// Some subgraph deployments return 0 for token0Price/token1Price when liquidity is 0,
// even though the pool tick/sqrtPrice is initialized. Derive a fallback price from tick.
// Returns "paired token per token" (e.g., WETH per token) for the launchpad token side.
const priceFromPoolTick = (pool, tokenIs0) => {
  const tick = toNumber(pool?.tick, NaN);
  if (!Number.isFinite(tick)) return 0;

  const decimals0 = toNumber(pool?.token0?.decimals, 18);
  const decimals1 = toNumber(pool?.token1?.decimals, 18);
  const decimalsDiff = decimals0 - decimals1;

  const logBase = Math.log(1.0001);
  const logRaw = tick * logBase;
  const rawRatio = Math.exp(logRaw); // token1 per token0 (raw)
  if (!Number.isFinite(rawRatio) || rawRatio <= 0) return 0;

  const adj = Math.pow(10, decimalsDiff);
  const token1Price = rawRatio * adj; // token1 per token0 (human units)
  if (!Number.isFinite(token1Price) || token1Price <= 0) return 0;

  // v3 subgraph semantics: token0Price = token0 per token1, token1Price = token1 per token0.
  const token0Price = 1 / token1Price;
  return tokenIs0 ? token1Price : token0Price;
};

// Some subgraph deployments can overstate totalValueLockedUSD for thin/out-of-range pools.
// Use WETH-side liquidity as a conservative cap: effective TVL <= 2 * WETH-side USD value.
const liquidityFromPool = ({ pool, wethAddress, ethPriceUSD }) => {
  const rawTvlUsd = Math.max(0, toNumber(pool?.totalValueLockedUSD, 0));
  const token0 = toLower(pool?.token0?.id);
  const token1 = toLower(pool?.token1?.id);
  const wethIs0 = token0 === wethAddress;
  const wethIs1 = token1 === wethAddress;
  const wethAmount = wethIs0
    ? Math.max(0, toNumber(pool?.totalValueLockedToken0, 0))
    : wethIs1
      ? Math.max(0, toNumber(pool?.totalValueLockedToken1, 0))
      : 0;
  const wethSideUsd = wethAmount > 0 && ethPriceUSD > 0 ? wethAmount * ethPriceUSD : 0;
  const conservativeCap = wethSideUsd > 0 ? wethSideUsd * 2 : 0;
  if (conservativeCap > 0 && rawTvlUsd > 0) return Math.min(rawTvlUsd, conservativeCap);
  if (conservativeCap > 0) return conservativeCap;
  return rawTvlUsd;
};

const supplyToNumber = (raw, decimals) => {
  try {
    return Number(formatUnits(BigInt(raw || 0n), Number(decimals || 18)));
  } catch {
    return 0;
  }
};

const logoFrom = (address, image = "") => {
  const raw = String(image || "").trim();
  if (/^data:image\//iu.test(raw)) return raw;
  if (/^https?:\/\//iu.test(raw)) return raw;
  if (/^ipfs:\/\//iu.test(raw)) {
    const hash = raw.replace(/^ipfs:\/\//iu, "").replace(/^ipfs\//iu, "");
    if (hash) return `https://gateway.pinata.cloud/ipfs/${hash}`;
  }
  if (/^(\/)?ipfs\//iu.test(raw)) {
    const hash = raw.replace(/^(\/)?ipfs\//iu, "");
    if (hash) return `https://gateway.pinata.cloud/ipfs/${hash}`;
  }
  if (/^ar:\/\//iu.test(raw)) {
    const arId = raw.replace(/^ar:\/\//iu, "").trim();
    if (arId) return `https://arweave.net/${arId}`;
  }
  if (IPFS_CID_RE.test(raw)) {
    return `https://gateway.pinata.cloud/ipfs/${raw}`;
  }
  return `https://effigy.im/a/${toLower(address)}.svg`;
};

const parseJson = (value) => {
  try {
    const parsed = JSON.parse(String(value || ""));
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // ignore invalid json
  }
  return null;
};

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
};

const isLaunchpadContext = (context) => {
  if (!context || typeof context !== "object") return false;
  const uiSchema = String(context?.uiSchema || "").trim().toLowerCase();
  if (uiSchema.includes("launchpad")) return true;
  if (context?.poolConfiguration && typeof context.poolConfiguration === "object") return true;
  if (context?.creatorVault && typeof context.creatorVault === "object") return true;
  if (Array.isArray(context?.rewardRecipients) && context.rewardRecipients.length > 0) return true;
  return false;
};

const mapLimit = async (items, limit, mapper) => {
  const input = Array.isArray(items) ? items : [];
  if (!input.length) return [];
  const concurrency = Math.max(1, Math.min(24, Number(limit) || 1));
  const out = new Array(input.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < input.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await mapper(input[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, input.length) }, () => worker()));
  return out;
};

const pickMetadataImage = (metadata) => {
  if (!metadata || typeof metadata !== "object") return "";
  const links = metadata.links || {};
  return String(
    metadata.image ||
      metadata.logo ||
      metadata.logoURI ||
      metadata.image_url ||
      metadata.imageUrl ||
      metadata.icon ||
      links.image ||
      links.logo ||
      ""
  )
    .trim();
};

const readContractMethod = async (contract, fn) => {
  try {
    return await contract[fn]();
  } catch {
    return null;
  }
};

const readTokenImageMeta = async (address) => {
  const key = toLower(address);
  if (!key) return "";
  const store = getStore();
  const cached = store.meta.get(key);
  const cachedValue = cached?.value && typeof cached.value === "object" ? cached.value : {};
  const cachedImage = String(cachedValue?.image || "").trim();
  if (cached && Date.now() - cached.ts < META_TTL_MS && cachedImage) {
    return cachedImage;
  }

  const contract = new Contract(key, ERC20_META_ABI, getProvider());
  const [imageUrl, imageLegacy, metadataRaw] = await Promise.all([
    readContractMethod(contract, "imageUrl"),
    readContractMethod(contract, "image"),
    readContractMethod(contract, "metadata"),
  ]);
  const metadata = parseJson(metadataRaw);
  const metadataImage = pickMetadataImage(metadata);
  const resolved = String(imageUrl || imageLegacy || metadataImage || cachedImage || "").trim();

  store.meta.set(key, {
    ts: Date.now(),
    value: {
      ...cachedValue,
      image: resolved,
      detailReady: Boolean(cachedValue?.detailReady),
    },
  });

  return resolved;
};

const readTokenContextMeta = async (address) => {
  const key = toLower(address);
  if (!key) return "";
  const store = getStore();
  const cached = store.meta.get(key);
  const cachedValue = cached?.value && typeof cached.value === "object" ? cached.value : {};
  const cachedContext =
    String(cachedValue?.contextRaw || cachedValue?.context || "").trim() ||
    String(cachedValue?.contextJson || "").trim();

  if (cached && Date.now() - cached.ts < META_TTL_MS && cachedValue?.contextFetched) {
    return cachedContext;
  }

  const contract = new Contract(key, ERC20_META_ABI, getProvider());
  const contextRaw = await readContractMethod(contract, "context");
  const resolved = String(contextRaw || cachedContext || "").trim();

  store.meta.set(key, {
    ts: Date.now(),
    value: {
      ...cachedValue,
      contextRaw: resolved,
      contextFetched: true,
      detailReady: Boolean(cachedValue?.detailReady),
    },
  });

  return resolved;
};

const filterLaunchpadTokenAddresses = async (addresses = []) => {
  const uniqueAddresses = dedupe((addresses || []).map((item) => toLower(item)).filter(Boolean));
  if (!uniqueAddresses.length) return new Set();

  const checked = await mapLimit(uniqueAddresses, 8, async (address) => {
    try {
      const contextRaw = await readTokenContextMeta(address);
      const context = parseJson(contextRaw);
      return isLaunchpadContext(context) ? address : "";
    } catch {
      return "";
    }
  });

  return new Set(checked.filter(Boolean));
};

const groupByPool = (rows = []) => {
  const out = new Map();
  rows.forEach((row) => {
    const id = toLower(row?.pool?.id);
    if (!id) return;
    const bucket = out.get(id) || [];
    bucket.push(row);
    out.set(id, bucket);
  });
  out.forEach((bucket) => {
    bucket.sort((a, b) => toNumber(b?.periodStartUnix || b?.date, 0) - toNumber(a?.periodStartUnix || a?.date, 0));
  });
  return out;
};

const normalizeTrade = (swap, tokenAddress, tokenIs0) => {
  const tokenAmount = toNumber(tokenIs0 ? swap?.amount0 : swap?.amount1, 0);
  if (!tokenAmount) return null;
  const pairAmount = toNumber(tokenIs0 ? swap?.amount1 : swap?.amount0, 0);
  return {
    txHash: String(swap?.transaction?.id || swap?.id || "").split("-")[0],
    tokenAddress: toLower(tokenAddress),
    side: tokenAmount < 0 ? "BUY" : "SELL",
    amountIn: Math.abs(pairAmount).toString(),
    amountOut: Math.abs(tokenAmount).toString(),
    amountUSD: Math.abs(toNumber(swap?.amountUSD, 0)),
    buyer: toLower(swap?.origin || swap?.sender || swap?.recipient || ""),
    timestamp: new Date(toNumber(swap?.timestamp, 0) * 1000).toISOString(),
    blockNumber: Math.floor(toNumber(swap?.transaction?.blockNumber, 0)),
  };
};

const toLockedPoolSet = (rows = []) => {
  const out = new Set();
  (rows || []).forEach((row) => {
    const poolId = toLower(row?.pool?.id);
    if (!poolId) return;
    out.add(poolId);
  });
  return out;
};

const resolveLockedPools = async (poolIds = []) => {
  const locker = getLpLocker();
  const normalizedPoolIds = dedupe((poolIds || []).map((poolId) => toLower(poolId)).filter(Boolean));
  if (!locker || !normalizedPoolIds.length) {
    return { available: false, lockedPools: new Set() };
  }

  const first = Math.min(5000, Math.max(200, normalizedPoolIds.length * 10));
  const attempts = [
    {
      query: `
        query LockedPools($owner: Bytes!, $ids: [Bytes!], $first: Int!) {
          positions(first: $first, where: { owner: $owner, pool_in: $ids }) {
            pool { id }
          }
        }
      `,
    },
    {
      query: `
        query LockedPoolsNested($owner: Bytes!, $ids: [Bytes!], $first: Int!) {
          positions(first: $first, where: { owner: $owner, pool_: { id_in: $ids } }) {
            pool { id }
          }
        }
      `,
    },
  ];

  for (const attempt of attempts) {
    try {
      const data = await graph(attempt.query, { owner: locker, ids: normalizedPoolIds, first });
      if (Array.isArray(data?.positions)) {
        return { available: true, lockedPools: toLockedPoolSet(data.positions) };
      }
    } catch {
      // try next schema variant
    }
  }

  return { available: false, lockedPools: new Set() };
};

const readTokenCreatedLogs = async (provider, currentx, topic0, fromBlock, toBlock) => {
  const startBlock = Math.max(0, Number(fromBlock) || 0);
  const endBlock = Math.max(startBlock, Number(toBlock) || startBlock);
  const logs = [];
  for (let start = startBlock; start <= endBlock; start += LP_LOCK_LOG_BLOCK_SPAN) {
    const end = Math.min(endBlock, start + LP_LOCK_LOG_BLOCK_SPAN - 1);
    const chunk = await provider.getLogs({
      address: currentx,
      fromBlock: start,
      toBlock: end,
      topics: [topic0],
    });
    if (Array.isArray(chunk) && chunk.length) logs.push(...chunk);
  }
  return logs;
};

const refreshOnchainLpLockCache = async () => {
  const currentx = getCurrentX();
  if (!currentx) return { available: false, currentx: "" };

  const store = getStore();
  const cache = store.lpLock;
  if (cache.currentx !== currentx) {
    cache.currentx = currentx;
    cache.latestBlock = -1;
    cache.refreshedAt = 0;
    cache.positionManager = "";
    cache.tokenToPosition = new Map();
    cache.positionToOwner = new Map();
  }

  const provider = getProvider();
  const latestBlock = await provider.getBlockNumber();
  const freshEnough = Date.now() - Number(cache.refreshedAt || 0) < LP_LOCK_EVENT_CACHE_TTL_MS;
  if (freshEnough && Number(cache.latestBlock || -1) >= latestBlock && ADDRESS_RE.test(cache.positionManager || "")) {
    return { available: true, currentx };
  }

  const currentxContract = new Contract(currentx, CURRENTX_LAUNCH_ABI, provider);
  const topic0 = currentxContract.interface.getEvent("TokenCreated").topicHash;
  const fromBlock = Number(cache.latestBlock) >= 0 ? Number(cache.latestBlock) + 1 : getCurrentXDeployBlock();
  if (fromBlock <= latestBlock) {
    const logs = await readTokenCreatedLogs(provider, currentx, topic0, fromBlock, latestBlock);
    logs.forEach((log) => {
      try {
        const parsed = currentxContract.interface.parseLog(log);
        const tokenAddress = toLower(parsed?.args?.tokenAddress);
        const positionId = parsed?.args?.positionId != null ? BigInt(parsed.args.positionId).toString() : "";
        if (!tokenAddress || !positionId) return;
        cache.tokenToPosition.set(tokenAddress, positionId);
      } catch {
        // ignore malformed logs
      }
    });
  }

  if (!ADDRESS_RE.test(cache.positionManager || "")) {
    try {
      const resolvedPositionManager = toLower(await currentxContract.positionManager());
      cache.positionManager = ADDRESS_RE.test(resolvedPositionManager) ? resolvedPositionManager : "";
    } catch {
      cache.positionManager = "";
    }
  }

  cache.latestBlock = latestBlock;
  cache.refreshedAt = Date.now();
  if (!ADDRESS_RE.test(cache.positionManager || "")) return { available: false, currentx };
  return { available: true, currentx };
};

const resolveLockedTokensOnchain = async (tokenAddresses = []) => {
  const locker = getLpLocker();
  const normalizedTokens = dedupe((tokenAddresses || []).map((address) => toLower(address)).filter(Boolean));
  if (!locker || !normalizedTokens.length) {
    return { available: false, lockedTokens: new Set() };
  }

  try {
    const status = await refreshOnchainLpLockCache();
    if (!status.available) return { available: false, lockedTokens: new Set() };

    const store = getStore();
    const cache = store.lpLock;
    const positionManagerAddress = toLower(cache.positionManager || "");
    if (!ADDRESS_RE.test(positionManagerAddress)) {
      return { available: false, lockedTokens: new Set() };
    }

    const tokenPositionPairs = normalizedTokens
      .map((tokenAddress) => ({
        tokenAddress,
        positionId: String(cache.tokenToPosition.get(tokenAddress) || "").trim(),
      }))
      .filter((item) => item.positionId);

    if (!tokenPositionPairs.length) {
      return { available: true, lockedTokens: new Set() };
    }

    const now = Date.now();
    const uniquePositions = dedupe(tokenPositionPairs.map((item) => item.positionId).filter(Boolean));
    const stalePositions = uniquePositions.filter((positionId) => {
      const cachedOwner = cache.positionToOwner.get(positionId);
      if (!cachedOwner || typeof cachedOwner !== "object") return true;
      return now - Number(cachedOwner.ts || 0) > LP_LOCK_OWNER_CACHE_TTL_MS;
    });

    if (stalePositions.length) {
      const positionManager = new Contract(positionManagerAddress, POSITION_MANAGER_ABI, getProvider());
      const resolvedOwners = await mapLimit(stalePositions, 8, async (positionId) => {
        try {
          const owner = toLower(await positionManager.ownerOf(BigInt(positionId)));
          return { positionId, owner };
        } catch {
          return { positionId, owner: "" };
        }
      });

      resolvedOwners.forEach(({ positionId, owner }) => {
        cache.positionToOwner.set(String(positionId), { owner: toLower(owner || ""), ts: now });
      });
    }

    const lockedTokens = new Set();
    tokenPositionPairs.forEach(({ tokenAddress, positionId }) => {
      const ownerData = cache.positionToOwner.get(positionId);
      const owner = toLower(ownerData?.owner || "");
      if (owner && owner === locker) lockedTokens.add(tokenAddress);
    });

    return { available: true, lockedTokens };
  } catch {
    return { available: false, lockedTokens: new Set() };
  }
};

const buildSnapshot = async () => {
  const weth = getWeth();
  const scan = Math.max(30, Math.min(400, Number(process.env.LAUNCHPAD_POOL_SCAN_LIMIT || 220)));
  const poolsQuery = `
    query Pools($weth: Bytes!, $scan: Int!) {
      bundle(id: "1") { ethPriceUSD }
      by0: pools(first: $scan, orderBy: createdAtTimestamp, orderDirection: desc, where: { token0: $weth }) {
        id feeTier createdAtTimestamp totalValueLockedUSD totalValueLockedToken0 totalValueLockedToken1 volumeUSD token0Price token1Price tick
        token0 { id name symbol decimals derivedETH totalSupply }
        token1 { id name symbol decimals derivedETH totalSupply }
      }
      by1: pools(first: $scan, orderBy: createdAtTimestamp, orderDirection: desc, where: { token1: $weth }) {
        id feeTier createdAtTimestamp totalValueLockedUSD totalValueLockedToken0 totalValueLockedToken1 volumeUSD token0Price token1Price tick
        token0 { id name symbol decimals derivedETH totalSupply }
        token1 { id name symbol decimals derivedETH totalSupply }
      }
    }
  `;
  const poolsData = await graph(poolsQuery, { weth, scan });
  const ethPriceUSD = toNumber(poolsData?.bundle?.ethPriceUSD, 0);
  const rawPools = [...(poolsData?.by0 || []), ...(poolsData?.by1 || [])];
  const pools = dedupe(rawPools.map((p) => p?.id)).map((id) => rawPools.find((p) => toLower(p?.id) === toLower(id)));

  let tokenMap = new Map();
  let poolSide = {};
  let tokenPools = {};

  pools.forEach((pool) => {
    const token0 = toLower(pool?.token0?.id);
    const token1 = toLower(pool?.token1?.id);
    const is0 = token1 === weth;
    const is1 = token0 === weth;
    if (!is0 && !is1) return;
    const tokenAddress = is0 ? token0 : token1;
    const tokenEntity = is0 ? pool?.token0 : pool?.token1;
    const decimals = Number(tokenEntity?.decimals || 18);
    const derivedETH = toNumber(tokenEntity?.derivedETH, 0);
    const poolPriceETH = is0 ? toNumber(pool?.token1Price, 0) : toNumber(pool?.token0Price, 0);
    const tickPriceETH = priceFromPoolTick(pool, Boolean(is0));
    const refPriceEth = poolPriceETH > 0 ? poolPriceETH : tickPriceETH > 0 ? tickPriceETH : derivedETH;
    const priceUSD = refPriceEth > 0 && ethPriceUSD > 0 ? refPriceEth * ethPriceUSD : 0;
    const supply = supplyToNumber(tokenEntity?.totalSupply || "0", decimals);
    const createdAt = new Date(toNumber(pool?.createdAtTimestamp, 0) * 1000).toISOString();
    const liquidityUSD = liquidityFromPool({ pool, wethAddress: weth, ethPriceUSD });
    const card = {
      address: tokenAddress,
      name: String(tokenEntity?.name || tokenEntity?.symbol || "Token"),
      symbol: String(tokenEntity?.symbol || "TKN"),
      decimals,
      logoUrl: logoFrom(tokenAddress),
      createdAt,
      creator: "0x0000000000000000000000000000000000000000",
      tags: ["launchpad", ...(Date.now() - Date.parse(createdAt) < 72 * 3600 * 1000 ? ["new"] : [])],
      buysPerMinute: 0,
      sparkline: [priceUSD || 0],
      market: {
        priceUSD: priceUSD || 0,
        mcapUSD: priceUSD > 0 ? priceUSD * supply : 0,
        liquidityUSD,
        volume24hUSD: 0,
        change1h: 0,
        change24h: 0,
        updatedAt: new Date().toISOString(),
      },
      launchParams: {
        poolFeeBps: Math.floor(toNumber(pool?.feeTier, 3000) / 100),
        creatorAllocationPct: 0,
      },
      __poolId: toLower(pool?.id),
      __tokenIs0: Boolean(is0),
    };
    const existing = tokenMap.get(tokenAddress);
    if (!existing || toNumber(card.market.liquidityUSD, 0) > toNumber(existing.market.liquidityUSD, 0)) {
      tokenMap.set(tokenAddress, card);
    }
    if (!tokenPools[tokenAddress]) tokenPools[tokenAddress] = [];
    tokenPools[tokenAddress].push(toLower(pool.id));
    poolSide[toLower(pool.id)] = { tokenAddress, tokenIs0: Boolean(is0) };
  });

  const onlyLaunchpadTokens = parseBoolean(
    process.env.LAUNCHPAD_ONLY_CONTEXT_TOKENS ||
      process.env.VITE_LAUNCHPAD_ONLY_CONTEXT_TOKENS ||
      DEFAULT_ONLY_LAUNCHPAD_TOKENS,
    DEFAULT_ONLY_LAUNCHPAD_TOKENS
  );

  if (onlyLaunchpadTokens && tokenMap.size > 0) {
    const allowedAddresses = await filterLaunchpadTokenAddresses(Array.from(tokenMap.keys()));
    tokenMap = new Map(Array.from(tokenMap.entries()).filter(([address]) => allowedAddresses.has(address)));

    const nextTokenPools = {};
    Object.entries(tokenPools).forEach(([address, poolsForToken]) => {
      const key = toLower(address);
      if (!allowedAddresses.has(key)) return;
      nextTokenPools[key] = dedupe((poolsForToken || []).map((poolId) => toLower(poolId)));
    });
    tokenPools = nextTokenPools;

    const allowedPoolIds = new Set(Object.values(tokenPools).flat().map((poolId) => toLower(poolId)));
    const nextPoolSide = {};
    Object.entries(poolSide).forEach(([poolId, side]) => {
      const normalizedPoolId = toLower(poolId);
      const tokenAddress = toLower(side?.tokenAddress);
      if (!allowedPoolIds.has(normalizedPoolId)) return;
      if (!allowedAddresses.has(tokenAddress)) return;
      nextPoolSide[normalizedPoolId] = { tokenAddress, tokenIs0: Boolean(side?.tokenIs0) };
    });
    poolSide = nextPoolSide;
  }

  const poolIds = Object.keys(poolSide);
  const volume24hSince = Math.floor(Date.now() / 1000) - 24 * 3600;
  const [dayData, hourData, hour24VolumeData, recentSwaps, lockStatus] = await Promise.all([
    poolIds.length
      ? graph(
          `
            query Day($ids: [Bytes!], $first: Int!) {
              poolDayDatas(first: $first, orderBy: date, orderDirection: desc, where: { pool_in: $ids }) {
                pool { id } date volumeUSD open high low close token0Price token1Price
              }
            }
          `,
          { ids: poolIds, first: Math.min(5000, Math.max(400, poolIds.length * 6)) }
        ).then((x) => x?.poolDayDatas || [])
      : [],
    poolIds.length
      ? graph(
          `
            query Hour($ids: [Bytes!], $first: Int!) {
              poolHourDatas(first: $first, orderBy: periodStartUnix, orderDirection: desc, where: { pool_in: $ids }) {
                pool { id } periodStartUnix volumeUSD open high low close token0Price token1Price
              }
            }
          `,
          { ids: poolIds, first: Math.min(5000, Math.max(600, poolIds.length * 30)) }
        ).then((x) => x?.poolHourDatas || [])
      : [],
    poolIds.length
      ? graph(
          `
            query Hour24Volume($ids: [Bytes!], $since: Int!, $first: Int!) {
              poolHourDatas(
                first: $first
                orderBy: periodStartUnix
                orderDirection: desc
                where: { pool_in: $ids, periodStartUnix_gte: $since }
              ) {
                pool { id }
                volumeUSD
              }
            }
          `,
          {
            ids: poolIds,
            since: volume24hSince,
            first: Math.min(5000, Math.max(600, poolIds.length * 30)),
          }
        ).then((x) => x?.poolHourDatas || [])
      : [],
    poolIds.length
      ? graph(
          `
            query Swaps($ids: [Bytes!], $since: Int!, $first: Int!) {
              swaps(
                first: $first
                orderBy: timestamp
                orderDirection: desc
                where: { pool_in: $ids, timestamp_gte: $since }
              ) {
                id timestamp amountUSD amount0 amount1 sender origin recipient
                pool { id token0 { id } token1 { id } }
                transaction { id blockNumber }
              }
            }
          `,
          {
            ids: poolIds,
            since: Math.floor(Date.now() / 1000) - 3600,
            first: Math.min(5000, Math.max(600, poolIds.length * 40)),
          }
        ).then((x) => x?.swaps || [])
      : [],
    resolveLockedPools(poolIds),
  ]);
  const onchainLockStatus = !lockStatus?.available
    ? await resolveLockedTokensOnchain(Array.from(tokenMap.keys()))
    : { available: false, lockedTokens: new Set() };

  const dayByPool = groupByPool(dayData);
  const hourByPool = groupByPool(hourData);
  const volume24hByPool = new Map();
  const buysByToken = new Map();

  hour24VolumeData.forEach((row) => {
    const poolId = toLower(row?.pool?.id);
    if (!poolId) return;
    const volume = Math.max(0, toNumber(row?.volumeUSD, 0));
    volume24hByPool.set(poolId, (volume24hByPool.get(poolId) || 0) + volume);
  });

  tokenMap.forEach((token, address) => {
    const dayRows = dayByPool.get(token.__poolId) || [];
    const hourRows = hourByPool.get(token.__poolId) || [];
    const latestDay = dayRows[0] || null;
    const prevDay = dayRows[1] || null;
    const latestHour = hourRows[0] || null;
    const prevHour = hourRows[1] || null;
    const dayPrice = priceFromRow(latestDay, token.__tokenIs0);
    const prevDayPrice = priceFromRow(prevDay, token.__tokenIs0);
    const hourPrice = priceFromRow(latestHour, token.__tokenIs0);
    const prevHourPrice = priceFromRow(prevHour, token.__tokenIs0);
    token.market.volume24hUSD = Math.max(0, toNumber(volume24hByPool.get(token.__poolId), 0));
    token.market.change24h = prevDayPrice > 0 && dayPrice > 0 ? ((dayPrice - prevDayPrice) / prevDayPrice) * 100 : 0;
    token.market.change1h = prevHourPrice > 0 && hourPrice > 0 ? ((hourPrice - prevHourPrice) / prevHourPrice) * 100 : 0;
    token.sparkline = hourRows
      .slice()
      .sort((a, b) => toNumber(a?.periodStartUnix, 0) - toNumber(b?.periodStartUnix, 0))
      .map((row) => priceFromRow(row, token.__tokenIs0))
      .filter((p) => p > 0)
      .slice(-30);
    if (!token.sparkline.length) token.sparkline = [token.market.priceUSD];
    token.market.updatedAt = new Date().toISOString();
    tokenMap.set(address, token);
  });

  recentSwaps.forEach((swap) => {
    const id = toLower(swap?.pool?.id);
    const side = poolSide[id];
    if (!side) return;
    const trade = normalizeTrade(swap, side.tokenAddress, side.tokenIs0);
    if (!trade || trade.side !== "BUY") return;
    buysByToken.set(side.tokenAddress, (buysByToken.get(side.tokenAddress) || 0) + 1);
  });

  tokenMap.forEach((token, address) => {
    token.buysPerMinute = Number(((buysByToken.get(address) || 0) / 60).toFixed(4));
    if (lockStatus?.available) {
      const poolsForToken = tokenPools[address] || [];
      token.lpLocked = poolsForToken.some((poolId) => lockStatus.lockedPools.has(toLower(poolId)));
    } else if (onchainLockStatus?.available) {
      token.lpLocked = onchainLockStatus.lockedTokens.has(toLower(address));
    }
  });

  const tokens = Array.from(tokenMap.values()).map((token) => {
    const out = { ...token };
    delete out.__poolId;
    delete out.__tokenIs0;
    return out;
  });

  return {
    updatedAt: new Date().toISOString(),
    ethPriceUSD,
    tokens,
    poolIds,
    tokenPools,
    poolSide,
    tokenPrimaryPool: Object.fromEntries(Array.from(tokenMap.entries()).map(([addr, t]) => [addr, t.__poolId])),
    tokenSide: Object.fromEntries(Array.from(tokenMap.entries()).map(([addr, t]) => [addr, t.__tokenIs0])),
  };
};

export const getTokensSnapshot = async (force = false) => {
  const store = getStore();
  if (!force && store.snapshot.value && Date.now() - store.snapshot.ts < SNAPSHOT_TTL_MS) {
    return store.snapshot.value;
  }
  try {
    const value = await buildSnapshot();
    store.snapshot = { ts: Date.now(), value };
    return value;
  } catch (error) {
    // Keep serving the last good snapshot during transient backend/subgraph failures.
    if (store.snapshot.value) {
      return store.snapshot.value;
    }
    throw error;
  }
};

export const filterTokens = (tokens, q = "", filters = []) => {
  const query = String(q || "").trim().toLowerCase();
  const active = (filters || []).map((x) => String(x || "").toLowerCase()).filter(Boolean);
  if (!query && !active.length) return tokens;
  const threshold = (pick) => {
    const values = tokens.map((t) => toNumber(pick(t), 0)).filter(Number.isFinite).sort((a, b) => a - b);
    if (!values.length) return Number.POSITIVE_INFINITY;
    return values[Math.min(values.length - 1, Math.floor(values.length * 0.7))];
  };
  const mcap = threshold((t) => t.market?.mcapUSD);
  const vol = threshold((t) => t.market?.volume24hUSD);
  const gain = threshold((t) => t.market?.change24h);
  const buys = threshold((t) => t.buysPerMinute);
  return tokens.filter((t) => {
    if (query) {
      const hay = [t.name, t.symbol, t.address, ...(t.tags || [])].join(" ").toLowerCase();
      if (!hay.includes(query)) return false;
    }
    for (const f of active) {
      if (f === "new" && Date.now() - Date.parse(t.createdAt || "") > 72 * 3600 * 1000) return false;
      if (f === "trending" && toNumber(t.buysPerMinute, 0) < buys) return false;
      if (f === "top-mcap" && toNumber(t.market?.mcapUSD, 0) < mcap) return false;
      if (f === "top-volume" && toNumber(t.market?.volume24hUSD, 0) < vol) return false;
      if (f === "top-gainers" && toNumber(t.market?.change24h, 0) < gain) return false;
      if (!["new", "trending", "top-mcap", "top-volume", "top-gainers"].includes(f)) {
        const tags = (t.tags || []).map((x) => String(x).toLowerCase());
        if (!tags.includes(f)) return false;
      }
    }
    return true;
  });
};

export const sortTokens = (tokens, sort = "mcap") => {
  const out = [...(tokens || [])];
  out.sort((a, b) => {
    if (sort === "newest") return Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "");
    if (sort === "volume24h") return toNumber(b.market?.volume24hUSD, 0) - toNumber(a.market?.volume24hUSD, 0);
    if (sort === "buysPerMinute") return toNumber(b.buysPerMinute, 0) - toNumber(a.buysPerMinute, 0);
    if (sort === "change1h") return toNumber(b.market?.change1h, 0) - toNumber(a.market?.change1h, 0);
    if (sort === "change24h") return toNumber(b.market?.change24h, 0) - toNumber(a.market?.change24h, 0);
    return toNumber(b.market?.mcapUSD, 0) - toNumber(a.market?.mcapUSD, 0);
  });
  return out;
};

export const paginateTokens = (tokens, page = 1, pageSize = 24) => {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.max(1, Math.min(100, Number(pageSize) || 24));
  const offset = (p - 1) * s;
  return { pageItems: tokens.slice(offset, offset + s), total: tokens.length, hasMore: offset + s < tokens.length };
};

export const hydrateTokenLogos = async (tokens = []) => {
  if (!Array.isArray(tokens) || !tokens.length) return [];
  const hydrated = await Promise.all(
    tokens.map(async (token) => {
      if (!token?.address) return token;
      try {
        const image = await readTokenImageMeta(token.address);
        if (!image) return token;
        return { ...token, logoUrl: logoFrom(token.address, image) };
      } catch {
        return token;
      }
    })
  );
  return hydrated;
};

export const getTokenDetail = async (address) => {
  const snapshot = await getTokensSnapshot();
  const key = toLower(address);
  const token = (snapshot.tokens || []).find((x) => toLower(x.address) === key);
  if (!token) return null;

  const store = getStore();
  const cached = store.meta.get(key);
  const cachedValue = cached && Date.now() - cached.ts < META_TTL_MS ? cached.value : null;
  let meta = cachedValue && cachedValue?.detailReady ? cachedValue : null;
  if (!meta) {
    const contract = new Contract(key, ERC20_META_ABI, getProvider());
    const [name, symbol, decimals, totalSupply, imageUrl, imageLegacy, metadataRaw, contextRaw] = await Promise.all([
      readContractMethod(contract, "name"),
      readContractMethod(contract, "symbol"),
      readContractMethod(contract, "decimals"),
      readContractMethod(contract, "totalSupply"),
      readContractMethod(contract, "imageUrl"),
      readContractMethod(contract, "image"),
      readContractMethod(contract, "metadata"),
      readContractMethod(contract, "context"),
    ]);
    const metadata = parseJson(metadataRaw);
    const metadataImage = pickMetadataImage(metadata);
    let description = "";
    let website = "";
    let socials = {};
    let creator = "";
    let launchParams = {};
    try {
      const links = metadata?.links || {};
      description = String(metadata?.description || "").trim();
      website = String(metadata?.website || links.website || "").trim();
      socials = {
        x: String(links.x || metadata?.x || "").trim() || undefined,
        telegram: String(links.telegram || metadata?.telegram || "").trim() || undefined,
        discord: String(links.discord || metadata?.discord || "").trim() || undefined,
      };
    } catch {
      // ignore invalid/malformed metadata shape
    }
    try {
      const context = parseJson(contextRaw);
      const creatorEntry = Array.isArray(context?.rewardRecipients)
        ? context.rewardRecipients.find((r) => r?.role === "creator")
        : null;
      creator =
        String(creatorEntry?.admin || creatorEntry?.recipient || "")
          .trim()
          .toLowerCase() || "";
      launchParams = {
        poolFeeBps: toNumber(context?.poolConfiguration?.fixedPoolFee, token?.launchParams?.poolFeeBps || 30),
        creatorAllocationPct: toNumber(context?.creatorVault?.vaultPercentage, token?.launchParams?.creatorAllocationPct || 0),
        initialMcapUSD:
          toNumber(context?.poolConfiguration?.startingMarketCapEth, 0) > 0
            ? toNumber(context.poolConfiguration.startingMarketCapEth, 0) * toNumber(snapshot.ethPriceUSD, 0)
            : token?.launchParams?.initialMcapUSD,
      };
    } catch {
      // ignore invalid/malformed context payload
    }
    meta = {
      name: String(name || "").trim() || "",
      symbol: String(symbol || "").trim() || "",
      decimals: Number.isFinite(Number(decimals)) ? Number(decimals) : null,
      totalSupply: totalSupply != null ? String(totalSupply) : "",
      image: String(imageUrl || imageLegacy || metadataImage || "").trim() || "",
      description,
      website,
      socials,
      creator,
      launchParams,
      contextRaw: String(contextRaw || "").trim(),
      detailReady: true,
    };
    store.meta.set(key, { ts: Date.now(), value: meta });
  }
  const out = {
    ...token,
    name: meta?.name || token.name,
    symbol: meta?.symbol || token.symbol,
    decimals: Number.isFinite(meta?.decimals) ? meta.decimals : token.decimals,
    logoUrl: logoFrom(token.address, meta?.image || ""),
    description: meta?.description || token.description || "",
    website: meta?.website || token.website || "",
    socials: { ...(token.socials || {}), ...(meta?.socials || {}) },
    creator: meta?.creator || token.creator,
    launchParams: { ...(token.launchParams || {}), ...(meta?.launchParams || {}) },
  };
  if (meta?.totalSupply && out.market?.priceUSD > 0) {
    const supply = supplyToNumber(meta.totalSupply, out.decimals);
    if (supply > 0) out.market.mcapUSD = supply * out.market.priceUSD;
  }
  return out;
};

export const getActivity = async ({ tokenAddress = "", type = "buys", limit = 20 }) => {
  const snapshot = await getTokensSnapshot();
  const key = toLower(tokenAddress);
  const pools = key ? snapshot.tokenPools[key] || [] : snapshot.poolIds || [];
  if (!pools.length) return { items: [], updatedAt: new Date().toISOString() };
  const tokenMeta = new Map(
    (snapshot.tokens || [])
      .filter(Boolean)
      .map((t) => [
        toLower(t.address),
        { name: String(t.name || "").trim(), symbol: String(t.symbol || "").trim() },
      ])
  );
  const first = Math.min(5000, Math.max(100, Number(limit || 20) * 12));
  const data = await graph(
    `
      query Swaps($ids: [Bytes!], $first: Int!) {
        swaps(first: $first, orderBy: timestamp, orderDirection: desc, where: { pool_in: $ids }) {
          id timestamp amountUSD amount0 amount1 sender origin recipient
          pool { id token0 { id } token1 { id } }
          transaction { id blockNumber }
        }
      }
    `,
    { ids: pools, first }
  );
  const trades = (data?.swaps || [])
    .map((swap) => {
      const side = snapshot.poolSide[toLower(swap?.pool?.id)];
      if (!side) return null;
      if (key && side.tokenAddress !== key) return null;
      const trade = normalizeTrade(swap, side.tokenAddress, side.tokenIs0);
      if (!trade) return null;
      const meta = tokenMeta.get(trade.tokenAddress);
      if (!meta) return trade;
      return {
        ...trade,
        tokenName: meta.name || undefined,
        tokenSymbol: meta.symbol || undefined,
      };
    })
    .filter(Boolean)
    .filter((trade) => {
      const t = String(type || "buys").toLowerCase();
      if (t === "trades") return true;
      if (t === "sells") return trade.side === "SELL";
      if (t === "liquidity") return false;
      return trade.side === "BUY";
    })
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 20)));
  return { items: trades, updatedAt: new Date().toISOString() };
};

export const getTokenCandles = async (tokenAddress, tf = "24h") => {
  const snapshot = await getTokensSnapshot();
  const key = toLower(tokenAddress);
  const poolIds = snapshot.tokenPools[key] || [];
  const token = (snapshot.tokens || []).find((item) => toLower(item.address) === key);
  if (!poolIds.length) {
    if (!token) return [];
    return [
      {
        timestamp: Date.now(),
        open: toNumber(token?.market?.priceUSD, 0),
        high: toNumber(token?.market?.priceUSD, 0),
        low: toNumber(token?.market?.priceUSD, 0),
        close: toNumber(token?.market?.priceUSD, 0),
        volumeUSD: 0,
      },
    ];
  }
  const tokenIs0 = Boolean(snapshot.tokenSide[key]);
  // Prefer the primary pool (highest liquidity) for a stable chart. The query below does not return pool IDs,
  // so we can't reliably merge multiple pools into one candle series.
  const primaryPoolId = toLower(snapshot.tokenPrimaryPool?.[key] || "") || toLower(poolIds[0] || "");
  const candlePoolIds = primaryPoolId ? [primaryPoolId] : poolIds;
  const ethPriceUSD = Math.max(0, toNumber(snapshot.ethPriceUSD, 0));
  const tfKey = String(tf || "24h").toLowerCase();
  const hours = tfKey === "1h" ? 2 : tfKey === "7d" ? 7 * 24 : tfKey === "30d" ? 30 * 24 : tfKey === "all" ? 180 * 24 : 24;
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const data = await graph(
    `
      query CandleHours($ids: [Bytes!], $since: Int!) {
        poolHourDatas(
          first: 1000
          orderBy: periodStartUnix
          orderDirection: desc
          where: { pool_in: $ids, periodStartUnix_gte: $since }
        ) {
          periodStartUnix
          volumeUSD
          close
          token0Price
          token1Price
        }
      }
    `,
    { ids: candlePoolIds, since }
  );
  const rows = (data?.poolHourDatas || [])
    .slice()
    .sort((a, b) => toNumber(a?.periodStartUnix, 0) - toNumber(b?.periodStartUnix, 0))
    .map((row) => {
      // Some subgraph deployments don't reliably populate token0Price/token1Price on hour/day tables.
      // Reuse the snapshot price fallback logic (tokenXPrice -> close -> inverted close).
      const pEth = priceFromRow(row, tokenIs0);
      const p = ethPriceUSD > 0 ? pEth * ethPriceUSD : pEth;
      return {
        timestamp: toNumber(row?.periodStartUnix, 0) * 1000,
        open: p,
        high: p,
        low: p,
        close: p,
        volumeUSD: Math.max(0, toNumber(row?.volumeUSD, 0)),
      };
    })
    .filter((row) => row.timestamp > 0 && row.close > 0);
  if (rows.length >= 2) return rows;

  // If we only have 0-1 hour buckets (common for new pools with a couple swaps),
  // fall back to swap-level points so the chart still shows something meaningful.
  try {
    const swapData = await graph(
      `
        query CandleSwaps($ids: [Bytes!], $since: Int!, $first: Int!) {
          swaps(
            first: $first
            orderBy: timestamp
            orderDirection: desc
            where: { pool_in: $ids, timestamp_gte: $since }
          ) {
            timestamp
            amount0
            amount1
            amountUSD
          }
        }
      `,
      { ids: candlePoolIds, since, first: 250 }
    );
    const swaps = Array.isArray(swapData?.swaps) ? swapData.swaps : [];
    const swapRows = swaps
      .slice()
      .reverse() // oldest -> newest
      .map((swap) => {
        const tokenAmount = toNumber(tokenIs0 ? swap?.amount0 : swap?.amount1, 0);
        const pairAmount = toNumber(tokenIs0 ? swap?.amount1 : swap?.amount0, 0);
        const pEth = tokenAmount ? Math.abs(pairAmount / tokenAmount) : 0;
        const p = ethPriceUSD > 0 ? pEth * ethPriceUSD : pEth;
        return {
          timestamp: Math.max(0, toNumber(swap?.timestamp, 0) * 1000),
          open: p,
          high: p,
          low: p,
          close: p,
          volumeUSD: Math.max(0, Math.abs(toNumber(swap?.amountUSD, 0))),
        };
      })
      .filter((row) => row.timestamp > 0 && row.close > 0);

    if (swapRows.length >= 2) return swapRows;
    if (swapRows.length === 1) return swapRows;
  } catch {
    // ignore swap fallback failures
  }

  if (rows.length) return rows;
  const fallbackPrice = toNumber(token?.market?.priceUSD, 0);
  if (fallbackPrice <= 0) {
    try {
      const last = await graph(
        `
          query LastSwap($ids: [Bytes!], $first: Int!) {
            swaps(first: $first, orderBy: timestamp, orderDirection: desc, where: { pool_in: $ids }) {
              timestamp
              amount0
              amount1
              amountUSD
            }
          }
        `,
        { ids: candlePoolIds, first: 1 }
      );
      const swap = (last?.swaps || [])[0];
      const tokenAmount = toNumber(tokenIs0 ? swap?.amount0 : swap?.amount1, 0);
      const pairAmount = toNumber(tokenIs0 ? swap?.amount1 : swap?.amount0, 0);
      const pEth = tokenAmount ? Math.abs(pairAmount / tokenAmount) : 0;
      const p = ethPriceUSD > 0 ? pEth * ethPriceUSD : pEth;
      const ts = Math.max(0, toNumber(swap?.timestamp, 0) * 1000) || Date.now();
      if (p > 0) {
        return [
          {
            timestamp: ts,
            open: p,
            high: p,
            low: p,
            close: p,
            volumeUSD: Math.max(0, Math.abs(toNumber(swap?.amountUSD, 0))),
          },
        ];
      }
    } catch {
      // ignore swap fallback failures
    }
    return [];
  }
  return [
    {
      timestamp: Date.now(),
      open: fallbackPrice,
      high: fallbackPrice,
      low: fallbackPrice,
      close: fallbackPrice,
      volumeUSD: 0,
    },
  ];
};

export const setCors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

export const sendJson = (res, status, payload) => {
  res.status(status).setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(payload));
};

export const requireGet = (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return false;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return false;
  }
  return true;
};

export const asArray = (value) =>
  Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

export const parseError = graphError;
