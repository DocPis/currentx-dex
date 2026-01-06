// src/config/web3.js
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import {
  ERC20_ABI,
  MASTER_CHEF_ABI,
  UNIV2_FACTORY_ABI,
  UNIV2_ROUTER_ABI,
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
  SEPOLIA_CHAIN_ID_HEX,
  UNIV2_FACTORY_ADDRESS,
  UNIV2_ROUTER_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  WBTC_ADDRESS,
  WETH_ADDRESS,
  WETH_USDC_PAIR_ADDRESS,
} from "./addresses";

const DEFAULT_RPC_URL =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_SEPOLIA_RPC) ||
  "https://1rpc.io/sepolia";

export function getReadOnlyProvider() {
  return new JsonRpcProvider(DEFAULT_RPC_URL);
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
  MASTER_CHEF_ABI,
  UNIV2_FACTORY_ABI,
  UNIV2_ROUTER_ABI,
  WETH_ABI,
};

function collectInjectedProviders() {
  if (typeof window === "undefined") return [];
  const { ethereum, trustwallet, rabby } = window;
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
  if (Array.isArray(trustwallet?.providers)) trustwallet.providers.forEach(push);
  if (Array.isArray(trustwallet?.ethereum?.providers))
    trustwallet.ethereum.providers.forEach(push);
  push(ethereum);
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
    if (trustwallet?.ethereum) return trustwallet.ethereum;
    if (trustwallet) return trustwallet;
    if (Array.isArray(ethereum?.providers)) {
      const tw = ethereum.providers.find((p) => isTrust(p));
      if (tw) return tw;
    }
    if (ethereum && isTrust(ethereum)) return ethereum;
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
      "No wallet found. On mobile, open the site in the MetaMask in-app browser or another injected wallet."
    );
  }
  return new BrowserProvider(eth);
}

export async function getErc20(address, provider) {
  return new Contract(address, ERC20_ABI, provider);
}

// Wrappers to preserve existing API while delegating to services
export const fetchMasterChefFarms = (providerOverride) =>
  fetchMasterChefFarmsService(providerOverride || getReadOnlyProvider());

export const fetchMasterChefUserData = (address, pools, providerOverride) =>
  fetchMasterChefUserDataService(
    address,
    pools,
    providerOverride || getReadOnlyProvider()
  );
