import { Contract, JsonRpcProvider, formatUnits } from "ethers";

const DEFAULT_V3_URLS = [
  "https://api.goldsky.com/api/public/project_cmlbj5xkhtfha01z0caladt37/subgraphs/currentx-v3/1.0.0/gn",
  "https://gateway.thegraph.com/api/subgraphs/id/Hw24iWxGzMM5HvZqENyBQpA6hwdUTQzCSK5e5BfCXyHd",
];
const DEFAULT_WETH = "0x4200000000000000000000000000000000000006";
const DEFAULT_RPC = "https://mainnet.megaeth.com/rpc";
const SNAPSHOT_TTL_MS = 20_000;
const META_TTL_MS = 10 * 60 * 1000;

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

const KNOWN_VERIFIED = new Set([
  "0x4200000000000000000000000000000000000006",
  "0xfafddbb3fc7688494971a79cc65dca3ef82079e7",
  "0xcccc62962d17b8914c62d74ffb843d73b2a3cccc",
  "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb",
  "0xbd5e387fa453cebf03b1a6a9dfe2a828b93aa95b",
]);

const toLower = (v) => String(v || "").toLowerCase();
const toNumber = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const toBigInt = (v, fallback = 0n) => {
  try {
    const raw = String(v ?? "").trim();
    if (!raw) return fallback;
    return BigInt(raw);
  } catch {
    return fallback;
  }
};
const ADDRESS_RE = /^0x[a-f0-9]{40}$/iu;
const isAddressLike = (v) => ADDRESS_RE.test(String(v || "").trim());
const csv = (v) =>
  String(v || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const dedupe = (arr) => [...new Set((arr || []).map((v) => String(v || "").trim()).filter(Boolean))];
const IPFS_CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[0-9a-z]{20,})$/iu;
const DEFAULT_ONLY_LAUNCHPAD_TOKENS = true;

const getWeth = () => toLower(process.env.LAUNCHPAD_WETH_ADDRESS || process.env.VITE_WETH_ADDRESS || DEFAULT_WETH);
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
      verify: new Map(),
      blockscout: new Map(),
      deployments: new Map(),
      lockerMeta: new Map(),
      provider: null,
    };
  }
  // Allow upgrading an already-initialized singleton without restarting the process.
  if (!globalThis[k].verify) globalThis[k].verify = new Map();
  if (!globalThis[k].blockscout) globalThis[k].blockscout = new Map();
  if (!globalThis[k].deployments) globalThis[k].deployments = new Map();
  if (!globalThis[k].lockerMeta) globalThis[k].lockerMeta = new Map();
  return globalThis[k];
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

const VERIFY_FALSE_TTL_MS = 5 * 60 * 1000; // 5m
const VERIFY_TRUE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const VERIFY_TTL_MS = 15 * 60 * 1000; // default fallback (used when entry has no custom ttl)
const BLOCKSCOUT_TTL_MS = 30 * 60 * 1000; // 30m
const DEPLOYMENTS_TTL_MS = 10 * 60 * 1000; // 10m
const HOLDERS_TTL_MS = 5 * 60 * 1000; // 5m

const AUTO_VERIFY_ENABLED = parseBoolean(
  process.env.LAUNCHPAD_AUTO_VERIFY || process.env.VITE_LAUNCHPAD_AUTO_VERIFY,
  true
);
const AUTO_VERIFY_MAX_PER_SNAPSHOT = Math.max(
  0,
  Math.min(60, toNumber(process.env.LAUNCHPAD_AUTO_VERIFY_MAX_PER_SNAPSHOT, 12))
);

const EXTRA_VERIFIED = new Set(
  dedupe([
    ...csv(process.env.LAUNCHPAD_VERIFIED_TOKENS),
    ...csv(process.env.VITE_LAUNCHPAD_VERIFIED_TOKENS),
  ])
    .map((x) => toLower(x))
    .filter((x) => isAddressLike(x))
);
const isManuallyVerified = (address) => {
  const key = toLower(address);
  return KNOWN_VERIFIED.has(key) || EXTRA_VERIFIED.has(key);
};

const normalizeBaseUrl = (url) => String(url || "").trim().replace(/\/+$/u, "");

const getExplorerBase = () => {
  const list = [
    process.env.LAUNCHPAD_EXPLORER_BASE,
    process.env.EXPLORER_BASE_URL,
    process.env.VITE_EXPLORER_BASE,
    process.env.VITE_MEGAETH_EXPLORER,
    "https://megaeth.blockscout.com",
  ];
  for (const item of list) {
    const normalized = normalizeBaseUrl(item);
    if (normalized) return normalized;
  }
  return "https://megaeth.blockscout.com";
};

const getCurrentxAddress = () => {
  const list = [
    process.env.LAUNCHPAD_CURRENTX_ADDRESS,
    process.env.CURRENTX_ADDRESS,
    process.env.VITE_CURRENTX_ADDRESS,
  ];
  for (const item of list) {
    const normalized = toLower(item).trim();
    if (isAddressLike(normalized)) return normalized;
  }
  return "0xb1dfc63cbe9305fa6a8fe97b4c72241148e451d1";
};

const getVaultAddress = () => {
  const list = [
    process.env.LAUNCHPAD_VAULT_ADDRESS,
    process.env.CURRENTX_VAULT_ADDRESS,
    process.env.VITE_CURRENTX_VAULT_ADDRESS,
  ];
  for (const item of list) {
    const normalized = toLower(item).trim();
    if (isAddressLike(normalized)) return normalized;
  }
  return "0x61186f1a227c1225a3660628c728d6943c836feb";
};

const getDefaultLockerAddress = () => {
  const list = [
    process.env.LAUNCHPAD_LP_LOCKER_ADDRESS,
    process.env.LP_LOCKER_V2_ADDRESS,
    process.env.VITE_LP_LOCKER_V2_ADDRESS,
  ];
  for (const item of list) {
    const normalized = toLower(item).trim();
    if (isAddressLike(normalized)) return normalized;
  }
  return "0xc43b8a818c9dad3c3f04230c4033131fe040408f";
};

const fetchJson = async (url, { timeoutMs = 8_000 } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || 8_000));
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
};

const cacheGet = (map, key, ttlMs) => {
  const hit = map.get(key);
  if (!hit) return null;
  const storedTtl = toNumber(hit.ttlMs, 0);
  const effectiveTtl = storedTtl > 0 ? storedTtl : Math.max(1, Number(ttlMs) || 0);
  if (Date.now() - toNumber(hit.ts, 0) < effectiveTtl) return hit.value;
  return null;
};

const cacheSet = (map, key, value, ttlMs) => {
  const entry = { ts: Date.now(), value };
  const ttl = toNumber(ttlMs, 0);
  if (ttl > 0) entry.ttlMs = ttl;
  map.set(key, entry);
  return value;
};

const parseBlockscoutSource = (payload) => {
  const row = payload?.result?.[0] || null;
  const sourceCode = String(row?.SourceCode || "").trim();
  const abiRaw = String(row?.ABI || "").trim();
  const impl = String(row?.ImplementationAddress || row?.Implementation || "").trim();
  let abi = null;
  try {
    const parsed = JSON.parse(abiRaw);
    if (Array.isArray(parsed)) abi = parsed;
  } catch {
    abi = null;
  }
  const proxyRaw = String(row?.IsProxy ?? "").trim().toLowerCase();
  const isProxy =
    proxyRaw === "true" || proxyRaw === "1"
      ? true
      : proxyRaw === "false" || proxyRaw === "0"
      ? false
      : null;
  const isVerified = Boolean(sourceCode) && Array.isArray(abi) && abi.length > 0;
  return {
    isVerified,
    abi,
    isProxy,
    implementationAddress: isAddressLike(impl) ? toLower(impl) : "",
  };
};

const getBlockscoutSourceInfo = async (tokenAddress) => {
  const key = toLower(tokenAddress);
  if (!isAddressLike(key)) return null;
  const store = getStore();
  const cached = cacheGet(store.blockscout, `source:${key}`, BLOCKSCOUT_TTL_MS);
  if (cached) return cached;
  const base = getExplorerBase();
  const url = `${base}/api?module=contract&action=getsourcecode&address=${key}`;
  try {
    const json = await fetchJson(url, { timeoutMs: 8_000 });
    const parsed = parseBlockscoutSource(json);
    return cacheSet(store.blockscout, `source:${key}`, parsed);
  } catch {
    return cacheSet(store.blockscout, `source:${key}`, {
      isVerified: false,
      abi: null,
      isProxy: null,
      implementationAddress: "",
    });
  }
};

const getBlockscoutHolders = async (tokenAddress) => {
  const key = toLower(tokenAddress);
  if (!isAddressLike(key)) return [];
  const store = getStore();
  const cached = cacheGet(store.blockscout, `holders:${key}`, HOLDERS_TTL_MS);
  if (cached) return cached;
  const base = getExplorerBase();
  const url = `${base}/api/v2/tokens/${key}/holders`;
  try {
    const json = await fetchJson(url, { timeoutMs: 8_000 });
    const holders = (Array.isArray(json?.items) ? json.items : [])
      .map((item) => ({
        address: toLower(item?.address?.hash || ""),
        value: toBigInt(item?.value, 0n),
      }))
      .filter((h) => isAddressLike(h.address) && h.value > 0n);
    return cacheSet(store.blockscout, `holders:${key}`, holders);
  } catch {
    return cacheSet(store.blockscout, `holders:${key}`, []);
  }
};

const DANGEROUS_NAMES = new Set([
  "pause",
  "unpause",
  "blacklist",
  "whitelist",
  "setblacklist",
  "setwhitelist",
  "addtoblacklist",
  "removefromblacklist",
  "addtowhitelist",
  "removefromwhitelist",
  "enabletrading",
  "disabletrading",
  "settradingenabled",
  "settradingactive",
]);

const isDangerousFunctionName = (name) => {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return false;
  if (DANGEROUS_NAMES.has(n)) return true;
  if (n.startsWith("mint") || n.includes("minter")) return true;
  // Fee/tax setters: allow read-only views (fee(), tax()) but flag setters/updaters.
  const isSetter = n.startsWith("set") || n.startsWith("update") || n.startsWith("configure");
  if (isSetter && (n.includes("fee") || n.includes("fees") || n.includes("tax") || n.includes("taxes"))) {
    return true;
  }
  if (n.includes("blacklist") || n.includes("whitelist") || n.includes("blocklist")) return true;
  return false;
};

const scanDangerousAbi = (abi) => {
  const entries = Array.isArray(abi) ? abi : [];
  const matched = [];
  for (const entry of entries) {
    if (!entry || entry.type !== "function") continue;
    const name = entry.name;
    if (!name) continue;
    if (isDangerousFunctionName(name)) matched.push(String(name));
  }
  return { ok: matched.length === 0, matched };
};

const CURRENTX_DEPLOYMENTS_ABI = [
  "function getTokensDeployedByUser(address user) view returns ((address token, uint256 positionId, address locker)[])",
];
const LP_LOCKER_ABI = ["function positionManager() view returns (address)"];
const ERC721_ABI = ["function ownerOf(uint256 tokenId) view returns (address)"];

const getCreatorFromContext = async (tokenAddress) => {
  try {
    const raw = await readTokenContextMeta(tokenAddress);
    const ctx = parseJson(raw);
    const list = Array.isArray(ctx?.rewardRecipients) ? ctx.rewardRecipients : [];
    const creator =
      list.find((r) => String(r?.role || "").trim().toLowerCase() === "creator") || null;
    const candidate = toLower(creator?.admin || creator?.recipient || "").trim();
    return isAddressLike(candidate) ? candidate : "";
  } catch {
    return "";
  }
};

const getCreatorDeployments = async (creatorAddress) => {
  const key = toLower(creatorAddress);
  if (!isAddressLike(key)) return [];
  const store = getStore();
  const cached = cacheGet(store.deployments, key, DEPLOYMENTS_TTL_MS);
  if (cached) return cached;
  const currentxAddress = getCurrentxAddress();
  if (!isAddressLike(currentxAddress)) return cacheSet(store.deployments, key, []);
  try {
    const currentx = new Contract(currentxAddress, CURRENTX_DEPLOYMENTS_ABI, getProvider());
    const rows = await currentx.getTokensDeployedByUser(key);
    const list = (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        token: toLower(row?.token || row?.[0] || ""),
        positionId: toBigInt(row?.positionId ?? row?.[1], 0n),
        locker: toLower(row?.locker || row?.[2] || ""),
      }))
      .filter((row) => isAddressLike(row.token) && row.positionId > 0n && isAddressLike(row.locker));
    return cacheSet(store.deployments, key, list);
  } catch {
    return cacheSet(store.deployments, key, []);
  }
};

const isLiquidityLockedForToken = async (tokenAddress) => {
  const key = toLower(tokenAddress);
  if (!isAddressLike(key)) return false;
  const creator = await getCreatorFromContext(key);
  if (!creator) return false;

  const deployments = await getCreatorDeployments(creator);
  const row = deployments.find((d) => d.token === key) || null;
  if (!row) return false;

  const locker = toLower(row.locker || "") || getDefaultLockerAddress();
  if (!isAddressLike(locker)) return false;

  const store = getStore();
  const cachedManager = cacheGet(store.lockerMeta, locker, VERIFY_TTL_MS);
  let positionManager = cachedManager;
  if (!isAddressLike(positionManager)) {
    try {
      const lockerContract = new Contract(locker, LP_LOCKER_ABI, getProvider());
      const pm = await lockerContract.positionManager();
      positionManager = toLower(pm || "");
      cacheSet(store.lockerMeta, locker, positionManager);
    } catch {
      return false;
    }
  }

  if (!isAddressLike(positionManager)) return false;
  try {
    const pm = new Contract(positionManager, ERC721_ABI, getProvider());
    const owner = toLower(await pm.ownerOf(row.positionId));
    return owner === locker;
  } catch {
    return false;
  }
};

const passesHolderConcentration = async (tokenAddress, supplyRaw, snapshot) => {
  const supply = toBigInt(supplyRaw, 0n);
  if (supply <= 0n) return { ok: false, reason: "missing_supply" };

  const excluded = new Set([
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
    toLower(tokenAddress),
  ]);
  const vault = getVaultAddress();
  if (isAddressLike(vault)) excluded.add(vault);
  const currentx = getCurrentxAddress();
  if (isAddressLike(currentx)) excluded.add(currentx);
  const lockerDefault = getDefaultLockerAddress();
  if (isAddressLike(lockerDefault)) excluded.add(lockerDefault);

  const pools = snapshot?.tokenPools?.[toLower(tokenAddress)] || [];
  (Array.isArray(pools) ? pools : []).forEach((pool) => {
    const p = toLower(pool);
    if (isAddressLike(p)) excluded.add(p);
  });

  const holders = await getBlockscoutHolders(tokenAddress);
  let top1 = 0n;
  let top5 = 0n;
  let count = 0;
  for (const holder of holders) {
    const addr = toLower(holder.address || "");
    if (!isAddressLike(addr) || excluded.has(addr)) continue;
    count += 1;
    if (count === 1) top1 = holder.value;
    if (count <= 5) top5 += holder.value;
    if (count >= 5) break;
  }

  if (count === 0) return { ok: false, reason: "no_holders" };

  const top1Bps = Number((top1 * 10_000n) / supply);
  const top5Bps = Number((top5 * 10_000n) / supply);
  const ok = top1Bps <= 2000 && top5Bps <= 5000;
  return { ok, top1Bps, top5Bps, count };
};

const shouldAutoVerifyToken = async (token, snapshot) => {
  const address = toLower(token?.address || token?.tokenAddress || "");
  if (!isAddressLike(address)) return false;
  if (isManuallyVerified(address)) return true;
  if (!AUTO_VERIFY_ENABLED) return false;

  const store = getStore();
  const cached = cacheGet(store.verify, address, VERIFY_TTL_MS);
  if (cached != null) return Boolean(cached);

  const source = await getBlockscoutSourceInfo(address);
  if (!source?.isVerified) return cacheSet(store.verify, address, false, VERIFY_FALSE_TTL_MS);
  if (source.isProxy !== false) return cacheSet(store.verify, address, false, VERIFY_FALSE_TTL_MS);
  if (source.implementationAddress && isAddressLike(source.implementationAddress)) {
    return cacheSet(store.verify, address, false, VERIFY_FALSE_TTL_MS);
  }

  const dangerous = scanDangerousAbi(source.abi);
  if (!dangerous.ok) return cacheSet(store.verify, address, false, VERIFY_FALSE_TTL_MS);

  // Use subgraph-provided supply when available, otherwise fall back to RPC.
  let supplyRaw = token?.__totalSupplyRaw || "";
  let supply = toBigInt(supplyRaw, 0n);
  if (supply <= 0n) {
    try {
      const contract = new Contract(address, ERC20_META_ABI, getProvider());
      supply = toBigInt(await readContractMethod(contract, "totalSupply"), 0n);
    } catch {
      supply = 0n;
    }
  }

  const dist = await passesHolderConcentration(address, supply, snapshot);
  if (!dist.ok) return cacheSet(store.verify, address, false, VERIFY_FALSE_TTL_MS);

  const locked = await isLiquidityLockedForToken(address);
  if (!locked) return cacheSet(store.verify, address, false, VERIFY_FALSE_TTL_MS);

  return cacheSet(store.verify, address, true, VERIFY_TRUE_TTL_MS);
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

const buildSnapshot = async () => {
  const weth = getWeth();
  const scan = Math.max(30, Math.min(400, Number(process.env.LAUNCHPAD_POOL_SCAN_LIMIT || 220)));
  const poolsQuery = `
    query Pools($weth: Bytes!, $scan: Int!) {
      bundle(id: "1") { ethPriceUSD }
      by0: pools(first: $scan, orderBy: createdAtTimestamp, orderDirection: desc, where: { token0: $weth }) {
        id feeTier createdAtTimestamp totalValueLockedUSD volumeUSD token0Price token1Price
        token0 { id name symbol decimals derivedETH totalSupply }
        token1 { id name symbol decimals derivedETH totalSupply }
      }
      by1: pools(first: $scan, orderBy: createdAtTimestamp, orderDirection: desc, where: { token1: $weth }) {
        id feeTier createdAtTimestamp totalValueLockedUSD volumeUSD token0Price token1Price
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
    const refPriceEth = poolPriceETH > 0 ? poolPriceETH : derivedETH;
    const priceUSD = refPriceEth > 0 && ethPriceUSD > 0 ? refPriceEth * ethPriceUSD : 0;
    const supply = supplyToNumber(tokenEntity?.totalSupply || "0", decimals);
    const createdAt = new Date(toNumber(pool?.createdAtTimestamp, 0) * 1000).toISOString();
    const card = {
      address: tokenAddress,
      name: String(tokenEntity?.name || tokenEntity?.symbol || "Token"),
      symbol: String(tokenEntity?.symbol || "TKN"),
      decimals,
      logoUrl: logoFrom(tokenAddress),
      createdAt,
      creator: "0x0000000000000000000000000000000000000000",
      verified: isManuallyVerified(tokenAddress),
      tags: ["launchpad", ...(Date.now() - Date.parse(createdAt) < 72 * 3600 * 1000 ? ["new"] : [])],
      buysPerMinute: 0,
      sparkline: [priceUSD || 0],
      market: {
        priceUSD: priceUSD || 0,
        mcapUSD: priceUSD > 0 ? priceUSD * supply : 0,
        liquidityUSD: Math.max(0, toNumber(pool?.totalValueLockedUSD, 0)),
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
      __totalSupplyRaw: String(tokenEntity?.totalSupply || "0"),
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
  const [dayData, hourData, recentSwaps] = await Promise.all([
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
  ]);

  const dayByPool = groupByPool(dayData);
  const hourByPool = groupByPool(hourData);
  const buysByToken = new Map();

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
    token.market.volume24hUSD = Math.max(0, toNumber(latestDay?.volumeUSD, token.market.volume24hUSD));
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
  });

  // Auto-verify tokens lazily to avoid turning snapshot builds into long-running jobs.
  // We first apply cached "true" results (fast), then evaluate a small budget of pending tokens.
  if (AUTO_VERIFY_ENABLED && tokenMap.size > 0) {
    const store = getStore();
    tokenMap.forEach((token) => {
      if (!token || token.verified) return;
      const addr = toLower(token.address);
      if (isManuallyVerified(addr)) {
        token.verified = true;
        return;
      }
      const cached = cacheGet(store.verify, addr, VERIFY_TTL_MS);
      if (cached === true) token.verified = true;
    });

    const pending = Array.from(tokenMap.values())
      .filter((token) => {
        if (!token || token.verified) return false;
        const addr = toLower(token.address);
        const cached = cacheGet(store.verify, addr, VERIFY_TTL_MS);
        return cached == null;
      })
      .sort((a, b) => toNumber(b?.market?.liquidityUSD, 0) - toNumber(a?.market?.liquidityUSD, 0))
      .slice(0, AUTO_VERIFY_MAX_PER_SNAPSHOT);

    if (pending.length) {
      await mapLimit(pending, 4, async (token) => {
        try {
          const ok = await shouldAutoVerifyToken(token, { tokenPools });
          if (ok) token.verified = true;
        } catch {
          // ignore auto-verify failures; tokens remain unverified.
        }
      });
    }
  }

  const tokens = Array.from(tokenMap.values()).map((token) => {
    const out = { ...token };
    delete out.__poolId;
    delete out.__tokenIs0;
    delete out.__totalSupplyRaw;
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
      if (f === "verified" && !t.verified) return false;
      if (f === "new" && Date.now() - Date.parse(t.createdAt || "") > 72 * 3600 * 1000) return false;
      if (f === "trending" && toNumber(t.buysPerMinute, 0) < buys) return false;
      if (f === "top-mcap" && toNumber(t.market?.mcapUSD, 0) < mcap) return false;
      if (f === "top-volume" && toNumber(t.market?.volume24hUSD, 0) < vol) return false;
      if (f === "top-gainers" && toNumber(t.market?.change24h, 0) < gain) return false;
      if (!["verified", "new", "trending", "top-mcap", "top-volume", "top-gainers"].includes(f)) {
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

  if (!token.verified && AUTO_VERIFY_ENABLED) {
    try {
      const ok = await shouldAutoVerifyToken(token, snapshot);
      if (ok) token.verified = true;
    } catch {
      // ignore
    }
  }

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
