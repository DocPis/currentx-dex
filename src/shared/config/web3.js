// src/config/web3.js
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import {
  ERC20_ABI,
  HIGH_PRECISION_TIMESTAMP_ORACLE_ABI,
  MASTER_CHEF_ABI,
  UNIV2_FACTORY_ABI,
  UNIV2_ROUTER_ABI,
  UNIV3_FACTORY_ABI,
  WETH_ABI,
} from "./abis";
import { TOKENS } from "./tokens";
import {
  fetchMasterChefFarms as fetchMasterChefFarmsService,
  fetchMasterChefUserData as fetchMasterChefUserDataService,
} from "../services/masterchef";
import {
  CRX_ADDRESS,
  CRX_WETH_LP_ADDRESS,
  MASTER_CHEF_ADDRESS,
  MEGAETH_CHAIN_ID_HEX,
  UNIV2_FACTORY_ADDRESS,
  UNIV2_ROUTER_ADDRESS,
  USDC_ADDRESS,
  WETH_ADDRESS,
} from "./addresses";
import { getActiveNetworkConfig } from "./networks";

const env = typeof import.meta !== "undefined" ? import.meta.env || {} : {};
const activeNetwork = getActiveNetworkConfig();

const RAW_RPC_SOURCES = [
  ...(activeNetwork.rpcUrls || []),
  env.VITE_RPC_URLS,
  env.VITE_RPC_URL,
  env.VITE_MEGAETH_RPC,
  env.VITE_RPC_FALLBACK,
  env.VITE_RPC_TATUM,
  env.VITE_RPC_THIRDWEB,
  ...(activeNetwork.id === "mainnet"
    ? ["https://mainnet.megaeth.com/rpc"]
    : [
        env.VITE_TESTNET_RPC_URLS,
        env.VITE_TESTNET_RPC_URL,
        "https://timothy.megaeth.com/rpc",
        "https://carrot.megaeth.com/rpc",
        "https://megaeth-timothy.gateway.tatum.io/",
      ]),
];

const dedupe = (arr) => {
  const seen = new Set();
  const out = [];
  arr.forEach((u) => {
    const clean = (u || "").trim();
    if (!clean) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    out.push(clean);
  });
  return out;
};

const expandRpcList = () =>
  RAW_RPC_SOURCES.flatMap((entry) =>
    (entry || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );

const RPC_POOL = dedupe(expandRpcList());

if (!RPC_POOL.length) {
  throw new Error("No RPC endpoints configured for the selected network.");
}

export const RPC_URL = RPC_POOL[0];
export const getCurrentRpcUrl = () => RPC_POOL[rpcIndex] || RPC_POOL[0];

const providerCache = new Map();
const getProviderForUrl = (url) => {
  if (!url) return null;
  if (providerCache.has(url)) return providerCache.get(url);
  const chainIdDec = parseInt(activeNetwork.chainIdHex, 16);
  const provider = new JsonRpcProvider(url, {
    chainId: Number.isFinite(chainIdDec) ? chainIdDec : undefined,
    name: activeNetwork.name || "network",
  });
  providerCache.set(url, provider);
  return provider;
};

let rpcIndex = 0;

export function getReadOnlyProvider(preferNext = false, forceRpc = false) {
  // Prefer injected provider when available to avoid CORS on some RPCs, unless explicitly forced to use RPC.
  if (!forceRpc && typeof window !== "undefined" && window.ethereum) {
    try {
      return new BrowserProvider(window.ethereum);
    } catch {
      // fallback to RPC pool
    }
  }
  if (preferNext) rpcIndex = (rpcIndex + 1) % RPC_POOL.length;
  const url = RPC_POOL[rpcIndex] || RPC_POOL[0];
  return getProviderForUrl(url);
}

export function rotateRpcProvider() {
  rpcIndex = (rpcIndex + 1) % RPC_POOL.length;
  return getReadOnlyProvider();
}

export function getRpcPool() {
  return [...RPC_POOL];
}

// Re-export key config bits
export * from "./addresses";
export * from "./tokens";
export {
  computePriceImpact,
  getV2PairReserves,
  getV2Quote,
  getV2QuoteWithMeta,
} from "../services/amm";
export { getRegisteredCustomTokens, setRegisteredCustomTokens } from "./customTokens";

// Re-export ABIs for convenience across the app
export {
  ERC20_ABI,
  HIGH_PRECISION_TIMESTAMP_ORACLE_ABI,
  MASTER_CHEF_ABI,
  UNIV2_FACTORY_ABI,
  UNIV2_ROUTER_ABI,
  UNIV3_FACTORY_ABI,
  WETH_ABI,
};

function collectInjectedProviders() {
  if (typeof window === "undefined") return [];
  const { ethereum, trustwallet, rabby } = window;
  const trustWallet =
    window.trustWallet || window.TrustWallet || window.tw || trustwallet;
  const out = [];
  const seen = new Set();
  const push = (p) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };

  // Some wallets expose a selected provider when multiple are present
  if (ethereum?.selectedProvider) {
    push(ethereum.selectedProvider);
  }

  if (Array.isArray(ethereum?.providers)) ethereum.providers.forEach(push);
  if (Array.isArray(ethereum?.detected)) ethereum.detected.forEach(push);
  if (ethereum?.providerMap) {
    if (typeof ethereum.providerMap.values === "function") {
      Array.from(ethereum.providerMap.values()).forEach(push);
    } else if (typeof ethereum.providerMap === "object") {
      Object.values(ethereum.providerMap).forEach(push);
    }
  }
  if (Array.isArray(trustWallet?.providers)) trustWallet.providers.forEach(push);
  if (Array.isArray(trustWallet?.ethereum?.providers))
    trustWallet.ethereum.providers.forEach(push);
  if (Array.isArray(trustwallet?.providers)) trustwallet.providers.forEach(push);
  if (Array.isArray(trustwallet?.ethereum?.providers))
    trustwallet.ethereum.providers.forEach(push);
  push(ethereum);
  push(trustWallet);
  push(trustWallet?.ethereum);
  push(trustWallet?.provider);
  push(trustwallet);
  push(trustwallet?.ethereum);
  push(trustwallet?.provider);
  push(rabby);

  return out;
}

let activeInjectedProvider = null;

export const setActiveInjectedProvider = (provider) => {
  activeInjectedProvider = provider || null;
};

const resolveActiveProvider = (candidates) => {
  if (!activeInjectedProvider) return null;
  const match = candidates.find((p) => p === activeInjectedProvider);
  return match || null;
};

const isTrust = (p) => {
  const name =
    (p?.walletName ||
      p?.name ||
      p?.providerInfo?.name ||
      p?.info?.name ||
      "")?.toLowerCase?.() || "";
  const rdns =
    (p?.providerInfo?.rdns || p?.info?.rdns || "")?.toLowerCase?.() || "";

  return (
    p?.isTrustWallet ||
    p?.isTrustWalletV2 ||
    p?.isTrust ||
    p?.isTrustProvider ||
    name.includes("trust") ||
    rdns.includes("trustwallet") ||
    rdns.includes("trust")
  );
};
const isBrave = (p) => p?.isBraveWallet || p?.isBraveWalletProvider;
const isRabby = (p) =>
  p?.isRabby ||
  p?.rabby ||
  p?.__isRabby ||
  (typeof p?.isMetaMask !== "undefined" && p?.walletName === "Rabby");
const hasMetaMaskInternal = (p) =>
  Boolean(p?._metamask && typeof p._metamask.isUnlocked === "function");
const isMetaMaskCompat = (p) => {
  const name =
    (p?.walletName ||
      p?.name ||
      p?.providerInfo?.name ||
      p?.info?.name ||
      "")?.toLowerCase?.() || "";
  return hasMetaMaskInternal(p) || p?.isMetaMask || name.includes("metamask");
};
const isMetaMaskStrict = (p) =>
  (hasMetaMaskInternal(p) || (p?.isMetaMask && !isRabby(p))) &&
  !isTrust(p) &&
  !isBrave(p);

export function getInjectedEthereum() {
  const candidates = collectInjectedProviders();
  if (!candidates.length) return null;

  const active = resolveActiveProvider(candidates);
  if (active) return active;

  const metamask = candidates.find(isMetaMaskStrict);
  const trust = candidates.find(isTrust);
  const brave = candidates.find(isBrave);
  const rabbyProvider = candidates.find(isRabby);
  const metaCompat = candidates.find(
    (p) =>
      (hasMetaMaskInternal(p) || isMetaMaskCompat(p)) &&
      (!isRabby(p) || hasMetaMaskInternal(p)) &&
      !isTrust(p)
  );

  // Prefer explicit wallets: MetaMask strict > Trust > Brave > Rabby > any MetaMask flag > first available
  return metamask || trust || brave || rabbyProvider || metaCompat || candidates[0];
}

export function getInjectedProviderByType(type) {
  if (typeof window !== "undefined" && type === "trustwallet") {
    const { trustwallet, ethereum } = window;
    const trustAlias = window.trustWallet || window.TrustWallet || window.tw;
    if (trustwallet?.ethereum) return trustwallet.ethereum;
    if (trustAlias?.ethereum) return trustAlias.ethereum;
    if (trustwallet) return trustwallet;
    if (trustAlias) return trustAlias;
    if (Array.isArray(ethereum?.providers)) {
      const tw = ethereum.providers.find((p) => isTrust(p));
      if (tw) return tw;
    }
    if (ethereum && isTrust(ethereum)) return ethereum;
    const collected = collectInjectedProviders();
    const matchTrust = collected.find((p) => isTrust(p));
    if (matchTrust) return matchTrust;
    return null;
  }

  const candidates = collectInjectedProviders();
  if (!candidates.length) return null;

  const match = candidates.find((p) => {
    if (type === "rabby") return isRabby(p);
    if (type === "trustwallet") return isTrust(p);
    if (type === "metamask") return isMetaMaskStrict(p);
    return false;
  });

  if (match) return match;
  if (type === "metamask") {
    const internal = candidates.find(
      (p) => hasMetaMaskInternal(p) && !isTrust(p) && !isBrave(p)
    );
    if (internal && !isRabby(internal)) return internal;
    const fallback = candidates.find(
      (p) => isMetaMaskCompat(p) && !isRabby(p) && !isTrust(p)
    );
    if (fallback) return fallback;
    if (internal) return internal;
    if (
      typeof window !== "undefined" &&
      window.ethereum &&
      ((isMetaMaskCompat(window.ethereum) && !isRabby(window.ethereum)) ||
        hasMetaMaskInternal(window.ethereum)) &&
      !isTrust(window.ethereum)
    ) {
      return window.ethereum;
    }
  }

  return null;
}

export async function getProvider(preferredType) {
  let eth;
  if (preferredType) {
    eth = getInjectedProviderByType(preferredType);
    if (!eth) {
      throw new Error(
        "Selected wallet not detected. Please install/open the chosen wallet and retry."
      );
    }
  } else {
    eth = resolveActiveProvider(collectInjectedProviders()) || getInjectedEthereum();
  }
  if (!eth) {
    throw new Error(
      "No wallet found. On mobile, open the site in the Trust Wallet or MetaMask in-app browser."
    );
  }
  return new BrowserProvider(eth);
}

export async function getErc20(address, provider) {
  return new Contract(address, ERC20_ABI, provider);
}

async function getSafeReadOnlyProvider() {
  const targetChain = parseInt(getActiveNetworkConfig()?.chainIdHex || "0", 16);
  let provider = getReadOnlyProvider();
  if (!targetChain) return provider;
  try {
    const net = await provider.getNetwork();
    if (Number(net?.chainId || 0) === targetChain) {
      return provider;
    }
  } catch {
    // fall through to forced RPC
  }
  return getReadOnlyProvider(false, true);
}

// Wrappers to preserve existing API while delegating to services
export const fetchMasterChefFarms = async (providerOverride) =>
  fetchMasterChefFarmsService(providerOverride || (await getSafeReadOnlyProvider()));

export const fetchMasterChefUserData = async (address, pools, providerOverride) =>
  fetchMasterChefUserDataService(
    address,
    pools,
    providerOverride || (await getSafeReadOnlyProvider())
  );

// Simple telemetry: latest block and subgraph auth hint.
