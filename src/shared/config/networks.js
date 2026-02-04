// src/shared/config/networks.js
// Centralized network presets with optional testnet override.
// Switching preset requires a page reload to re-evaluate imports that use these constants.

const env = typeof import.meta !== "undefined" ? import.meta.env || {} : {};
const LOCAL_STORAGE_KEY = "MEGAETH_NETWORK_PRESET";
const URL_PARAM_KEY = "network";
const DEFAULT_MAINNET_SUBGRAPH_URL =
  env.VITE_UNIV2_SUBGRAPH ||
  "https://gateway.thegraph.com/api/subgraphs/id/AokDW2tqCMiFvVqXUEfiwY94mNXoBQfsszwd5bnPiNcr";
const DEFAULT_MAINNET_SUBGRAPH_API_KEY = env.VITE_UNIV2_SUBGRAPH_API_KEY || "";
const DEFAULT_TESTNET_SUBGRAPH_URL =
  env.VITE_UNIV2_SUBGRAPH_TESTNET ||
  "https://api.goldsky.com/api/public/project_cmg8hsgg04qnz01wnhnnj9s1y/subgraphs/current-x-testnet/1.0.0/gn";

const dedupeList = (arr = []) => {
  const seen = new Set();
  const out = [];
  arr.forEach((entry) => {
    const parts = (entry || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    parts.forEach((p) => {
      if (seen.has(p)) return;
      seen.add(p);
      out.push(p);
    });
  });
  return out;
};

const mainnetPreset = {
  id: "mainnet",
  label: "Mainnet",
  name: "MegaETH",
  chainIdHex: "0x10e6", // 4326
  explorer:
    env.VITE_EXPLORER_BASE ||
    env.VITE_MEGAETH_EXPLORER ||
    "https://megaeth.blockscout.com",
  subgraphUrl: DEFAULT_MAINNET_SUBGRAPH_URL,
  subgraphApiKey: DEFAULT_MAINNET_SUBGRAPH_API_KEY,
  rpcUrls: dedupeList([
    env.VITE_RPC_URL,
    env.VITE_RPC_URLS,
    env.VITE_MEGAETH_RPC,
    env.VITE_RPC_FALLBACK,
    env.VITE_RPC_TATUM,
    env.VITE_RPC_THIRDWEB,
    "https://mainnet.megaeth.com/rpc",
    "https://rpc-megaeth-mainnet.globalstake.io",
  ]),
  wsUrls: dedupeList([
    env.VITE_WS_URL,
    env.VITE_WS_URLS,
    env.VITE_MEGAETH_REALTIME_WS,
  ]),
  addresses: {
    WETH_ADDRESS: "0x4200000000000000000000000000000000000006",
    USDC_ADDRESS: "0x4c99d545E82D32dA12Cc634a3964b1698073DA2B",
    CUSD_ADDRESS: "0xcCcc62962d17b8914c62D74FfB843d73B2a3cccC",
    STCUSD_ADDRESS: "0x88887bE419578051FF9F4eb6C858A951921D8888",
    SUSDE_ADDRESS: "0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2",
    USDE_ADDRESS: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
    EZETH_ADDRESS: "0x09601A65e7de7BC8A19813D263dD9E98bFdC3c57",
    WSTETH_ADDRESS: "0x601aC63637933D88285A025C685AC4e9a92a98dA",
    USDM_ADDRESS: "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
    CRX_ADDRESS: "0xDEdDFD6F6fD2eDa3B0bC01c3Dfa03F2eA6f40504",
    MEGA_TOKEN_ADDRESS: "0x28B7E77f82B25B95953825F1E3eA0E36c1c29861",
    XBTC_ADDRESS: "",
    BTCB_ADDRESS: "0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072",
    WUSD_ADDRESS: "",
    WUSDC_ADDRESS: "",
    MASTER_CHEF_ADDRESS: "0x0e59533B28df0537bc28D05618a2c4f20EBE07a0",
    CRX_WETH_LP_ADDRESS: "0x340d63169285e5ae01a722ce762c0e81a7fa3037",
    HIGH_PRECISION_TIMESTAMP_ORACLE_ADDRESS:
      "0x6342000000000000000000000000000000000002",
    UNIV2_FACTORY_ADDRESS: "0xC60940F182F7699522970517f6d753A560546937",
    UNIV2_ROUTER_ADDRESS: "0x189b27c207b4cBBae1C65086F31383532443f5f2",
    UNIV2_PAIR_CODE_HASH:
      "0x552cb211a6cb6b2c7b263255f787f454e28411eb3ffb49389d5b6e73cd2966d0",
    UNIV3_FACTORY_ADDRESS: "0x09cF8A0b9e8C89bff6d1ACbe1467e8E335Bdd03E",
    UNIV3_QUOTER_V2_ADDRESS: "0x962e62df3df243844bd89ffb5b061919725dca2d",
    UNIV3_TICK_LENS_ADDRESS: "0xd8fe4a55f7f79d2937637671923e59d8488683c3",
    UNIV3_SWAP_ROUTER_ADDRESS: "0x5a8bc70674d82ac2bc04be91cf172f60169c50b3",
    UNIV3_POSITION_MANAGER_ADDRESS: "0xa02e90a5f5ef73c434f5a7e6a77e6508f009cb9d",
    UNIV3_MULTICALL_ADDRESS: "0x47163ef055ac5efdfdd946303f86820736bfbb8d",
    UNIV3_MIGRATOR_ADDRESS: "0xAA5B9F20e788063CD1e7e482c9F55b8c803E5456",
    UNIV3_POOL_INIT_CODE_HASH:
      "0xc5b9323f38f7ec5daae18bf2b6696c143def3728c6f6ed2aa34dcb31ad4fbf3f",
    UNIV3_UNIVERSAL_ROUTER_ADDRESS: "0x2c61d16Ad68f030bec95370Ab8a0Ba60e7E7B0a6",
    PERMIT2_ADDRESS: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  },
};

const testnetDefaults = {
  id: "testnet",
  label: "Testnet",
  name: "MegaETH Testnet",
  chainIdHex: "0x18c7",
  explorer: "https://megaeth-testnet-v2.blockscout.com",
  subgraphUrl: DEFAULT_TESTNET_SUBGRAPH_URL,
  subgraphApiKey: env.VITE_UNIV2_SUBGRAPH_API_KEY_TESTNET || "",
  rpcUrls: [
    "https://carrot.megaeth.com/rpc",
    "https://timothy.megaeth.com/rpc",
    "https://megaeth-timothy.gateway.tatum.io/",
  ],
  wsUrls: dedupeList([
    env.VITE_TESTNET_WS_URL,
    env.VITE_TESTNET_WS_URLS,
    env.VITE_MEGAETH_REALTIME_WS_TESTNET,
  ]),
  addresses: {
    WETH_ADDRESS: "0x4200000000000000000000000000000000000006",
    USDC_ADDRESS: "0x09cF8A0b9e8C89bff6d1ACbe1467e8E335Bdd03E",
    CUSD_ADDRESS: "0xc3d7f5BDbdB5a74b29B17D1804e23B527F7A1D58",
    STCUSD_ADDRESS: "",
    SUSDE_ADDRESS: "",
    USDE_ADDRESS: "",
    EZETH_ADDRESS: "",
    WSTETH_ADDRESS: "",
    USDM_ADDRESS: "0xd8fe4a55f7f79d2937637671923e59d8488683c3",
    CRX_ADDRESS: "0x189b27c207b4cBBae1C65086F31383532443f5f2",
    MEGA_TOKEN_ADDRESS: "0x5a8bc70674d82ac2bc04be91cf172f60169c50b3",
    XBTC_ADDRESS: "0x463151b80DFf738Bb02BA3B4C9Bd788daeEc751c",
    BTCB_ADDRESS: "",
    WUSD_ADDRESS: "0x07b1EDd4a0D76D07C5A91B9159D13Cb51C8e4E42",
    WUSDC_ADDRESS: "0x9f5A17BD53310D012544966b8e3cF7863fc8F05f",
    MASTER_CHEF_ADDRESS: "0xE01FA0e28B5a2FaaC5E1c6780B7E8e4059083708",
    CRX_WETH_LP_ADDRESS: "",
    HIGH_PRECISION_TIMESTAMP_ORACLE_ADDRESS: "",
    UNIV2_FACTORY_ADDRESS: "0x28c56b84190FA59Ce3903d5fE4b3FdbE5315FA24",
    UNIV2_ROUTER_ADDRESS: "0x2A6a1e904c86551B195D79DaE8B51202bF645080",
    UNIV2_PAIR_CODE_HASH: "",
    UNIV3_FACTORY_ADDRESS: "",
    UNIV3_QUOTER_V2_ADDRESS: "",
    UNIV3_TICK_LENS_ADDRESS: "",
    UNIV3_SWAP_ROUTER_ADDRESS: "",
    UNIV3_POSITION_MANAGER_ADDRESS: "",
    UNIV3_MULTICALL_ADDRESS: "",
    UNIV3_MIGRATOR_ADDRESS: "",
    UNIV3_POOL_INIT_CODE_HASH: "",
    UNIV3_UNIVERSAL_ROUTER_ADDRESS: "",
    PERMIT2_ADDRESS: "",
  },
};

const testnetPreset = (() => {
  const rpcUrls = dedupeList([
    env.VITE_TESTNET_RPC_URL,
    env.VITE_TESTNET_RPC_URLS,
    ...(testnetDefaults.rpcUrls || []),
  ]);
  const addresses = {
    WETH_ADDRESS: env.VITE_TESTNET_WETH_ADDRESS || testnetDefaults.addresses.WETH_ADDRESS,
    USDC_ADDRESS: env.VITE_TESTNET_USDC_ADDRESS || testnetDefaults.addresses.USDC_ADDRESS,
    CUSD_ADDRESS: env.VITE_TESTNET_CUSD_ADDRESS || testnetDefaults.addresses.CUSD_ADDRESS,
    STCUSD_ADDRESS: env.VITE_TESTNET_STCUSD_ADDRESS || testnetDefaults.addresses.STCUSD_ADDRESS,
    SUSDE_ADDRESS: env.VITE_TESTNET_SUSDE_ADDRESS || testnetDefaults.addresses.SUSDE_ADDRESS,
    USDE_ADDRESS: env.VITE_TESTNET_USDE_ADDRESS || testnetDefaults.addresses.USDE_ADDRESS,
    EZETH_ADDRESS: testnetDefaults.addresses.EZETH_ADDRESS,
    WSTETH_ADDRESS: testnetDefaults.addresses.WSTETH_ADDRESS,
    USDM_ADDRESS: env.VITE_TESTNET_USDM_ADDRESS || testnetDefaults.addresses.USDM_ADDRESS,
    CRX_ADDRESS: env.VITE_TESTNET_CRX_ADDRESS || testnetDefaults.addresses.CRX_ADDRESS,
    MEGA_TOKEN_ADDRESS:
      env.VITE_TESTNET_MEGA_TOKEN_ADDRESS || testnetDefaults.addresses.MEGA_TOKEN_ADDRESS,
    XBTC_ADDRESS: env.VITE_TESTNET_XBTC_ADDRESS || testnetDefaults.addresses.XBTC_ADDRESS,
    BTCB_ADDRESS: testnetDefaults.addresses.BTCB_ADDRESS,
    WUSD_ADDRESS: env.VITE_TESTNET_WUSD_ADDRESS || testnetDefaults.addresses.WUSD_ADDRESS,
    WUSDC_ADDRESS: env.VITE_TESTNET_WUSDC_ADDRESS || testnetDefaults.addresses.WUSDC_ADDRESS,
    MASTER_CHEF_ADDRESS:
      env.VITE_TESTNET_MASTER_CHEF_ADDRESS || testnetDefaults.addresses.MASTER_CHEF_ADDRESS,
    CRX_WETH_LP_ADDRESS:
      env.VITE_TESTNET_CRX_WETH_LP_ADDRESS || testnetDefaults.addresses.CRX_WETH_LP_ADDRESS,
    HIGH_PRECISION_TIMESTAMP_ORACLE_ADDRESS:
      env.VITE_TESTNET_TIMESTAMP_ORACLE_ADDRESS ||
      testnetDefaults.addresses.HIGH_PRECISION_TIMESTAMP_ORACLE_ADDRESS,
    UNIV2_FACTORY_ADDRESS:
      env.VITE_TESTNET_FACTORY_ADDRESS || testnetDefaults.addresses.UNIV2_FACTORY_ADDRESS,
    UNIV2_ROUTER_ADDRESS:
      env.VITE_TESTNET_ROUTER_ADDRESS || testnetDefaults.addresses.UNIV2_ROUTER_ADDRESS,
    UNIV2_PAIR_CODE_HASH:
      env.VITE_TESTNET_V2_PAIR_CODE_HASH || testnetDefaults.addresses.UNIV2_PAIR_CODE_HASH,
    UNIV3_FACTORY_ADDRESS:
      env.VITE_TESTNET_V3_FACTORY_ADDRESS || testnetDefaults.addresses.UNIV3_FACTORY_ADDRESS,
    UNIV3_QUOTER_V2_ADDRESS:
      env.VITE_TESTNET_V3_QUOTER_V2_ADDRESS ||
      testnetDefaults.addresses.UNIV3_QUOTER_V2_ADDRESS,
    UNIV3_TICK_LENS_ADDRESS:
      env.VITE_TESTNET_V3_TICK_LENS_ADDRESS ||
      testnetDefaults.addresses.UNIV3_TICK_LENS_ADDRESS,
    UNIV3_SWAP_ROUTER_ADDRESS:
      env.VITE_TESTNET_V3_SWAP_ROUTER_ADDRESS ||
      testnetDefaults.addresses.UNIV3_SWAP_ROUTER_ADDRESS,
    UNIV3_POSITION_MANAGER_ADDRESS:
      env.VITE_TESTNET_V3_POSITION_MANAGER_ADDRESS ||
      testnetDefaults.addresses.UNIV3_POSITION_MANAGER_ADDRESS,
    UNIV3_MULTICALL_ADDRESS:
      env.VITE_TESTNET_V3_MULTICALL_ADDRESS ||
      testnetDefaults.addresses.UNIV3_MULTICALL_ADDRESS,
    UNIV3_MIGRATOR_ADDRESS:
      env.VITE_TESTNET_V3_MIGRATOR_ADDRESS ||
      testnetDefaults.addresses.UNIV3_MIGRATOR_ADDRESS,
    UNIV3_POOL_INIT_CODE_HASH:
      env.VITE_TESTNET_V3_POOL_INIT_CODE_HASH ||
      testnetDefaults.addresses.UNIV3_POOL_INIT_CODE_HASH,
    UNIV3_UNIVERSAL_ROUTER_ADDRESS:
      env.VITE_TESTNET_V3_UNIVERSAL_ROUTER_ADDRESS ||
      testnetDefaults.addresses.UNIV3_UNIVERSAL_ROUTER_ADDRESS,
    PERMIT2_ADDRESS:
      env.VITE_TESTNET_PERMIT2_ADDRESS || testnetDefaults.addresses.PERMIT2_ADDRESS,
  };

  const required = [
    addresses.UNIV2_ROUTER_ADDRESS,
    addresses.UNIV2_FACTORY_ADDRESS,
    addresses.WETH_ADDRESS,
    rpcUrls[0],
  ];
  if (required.some((v) => !v)) return null;

  return {
    id: testnetDefaults.id,
    label: testnetDefaults.label,
    name: env.VITE_TESTNET_NAME || testnetDefaults.name,
    chainIdHex: env.VITE_TESTNET_CHAIN_ID_HEX || testnetDefaults.chainIdHex,
    explorer: env.VITE_TESTNET_EXPLORER || env.VITE_EXPLORER_BASE_TESTNET || testnetDefaults.explorer,
    subgraphUrl: testnetDefaults.subgraphUrl,
    subgraphApiKey: testnetDefaults.subgraphApiKey,
    rpcUrls,
    addresses,
  };
})();

const presets = [mainnetPreset, ...(testnetPreset ? [testnetPreset] : [])];

let inMemoryPreset = null;

export const getInjectedPresetId = () => {
  if (typeof window === "undefined") return null;
  try {
    const eth = window.ethereum;
    const chainId = eth?.chainId || eth?.networkVersion || eth?.selectedProvider?.chainId;
    if (!chainId) return null;
    const preset = findPresetByChainId(chainId);
    return preset?.id || null;
  } catch {
    return null;
  }
};

const getUrlPresetId = () => {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get(URL_PARAM_KEY);
    if (fromQuery) {
      // Clean the address bar once we've captured the override.
      url.searchParams.delete(URL_PARAM_KEY);
      window.history.replaceState({}, "", url.toString());
      const normalized = fromQuery.toLowerCase();
      try {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem(LOCAL_STORAGE_KEY, normalized);
        } else {
          inMemoryPreset = normalized;
        }
      } catch {
        inMemoryPreset = normalized;
      }
      return normalized;
    }
  } catch {
    // ignore malformed URLs
  }
  return null;
};

const getStoredPresetId = () => {
  const read = (storage) => {
    if (!storage) return null;
    try {
      return storage.getItem(LOCAL_STORAGE_KEY);
    } catch {
      return null;
    }
  };

  // Prefer session-scoped selection so a previous visit doesn't pin the network forever.
  const fromSession =
    typeof sessionStorage !== "undefined" ? read(sessionStorage) : null;
  if (fromSession) return fromSession;

  // Legacy migration: move any persisted choice from localStorage into the session and clear it.
  const fromLocal = typeof localStorage !== "undefined" ? read(localStorage) : null;
  if (fromLocal && typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.setItem(LOCAL_STORAGE_KEY, fromLocal);
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  }

  if (fromLocal) return fromLocal;
  return inMemoryPreset;
};

export const getAvailableNetworkPresets = () => presets;

export const getActiveNetworkPresetId = () => {
  const fromUrl = getUrlPresetId();
  const fromEnv = (env.VITE_DEFAULT_NETWORK_PRESET || env.VITE_DEFAULT_NETWORK || "").toLowerCase();
  const stored = (getStoredPresetId() || "").toLowerCase();
  // Respect explicit user choice (URL override or stored selection) first,
  // then fall back to env/default. We intentionally ignore injected wallet
  // chain here so the UI can show a mismatch state instead of silently
  // switching networks.
  const desired = fromUrl || stored || fromEnv;
  const match = presets.find((p) => p.id === desired);
  return match ? match.id : "mainnet";
};

export const findPresetByChainId = (chainIdHex) => {
  if (!chainIdHex) return null;
  const normalized =
    typeof chainIdHex === "string"
      ? chainIdHex.toLowerCase()
      : `0x${Number(chainIdHex).toString(16)}`.toLowerCase();
  return presets.find((p) => (p.chainIdHex || "").toLowerCase() === normalized) || null;
};

export const getActiveNetworkConfig = () => {
  const id = getActiveNetworkPresetId();
  return presets.find((p) => p.id === id) || mainnetPreset;
};

export const setActiveNetworkPreset = (id) => {
  const match = presets.find((p) => p.id === id);
  if (!match) return;

  // Keep URL clean; rely on storage/in-memory state to persist the selection.
  if (typeof window !== "undefined") {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has(URL_PARAM_KEY)) {
        url.searchParams.delete(URL_PARAM_KEY);
        window.history.replaceState({}, "", url.toString());
      }
    } catch {
      // ignore URL update errors
    }
  }

  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(LOCAL_STORAGE_KEY, id);
      return;
    }
  } catch {
    // ignore session errors and fall through
  }

  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LOCAL_STORAGE_KEY, id);
      return;
    }
  } catch {
    // ignore localStorage errors and fall through
  }

  // Final fallback so the selection at least sticks in-memory for this page.
  inMemoryPreset = id;
};
