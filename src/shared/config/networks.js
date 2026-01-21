// src/shared/config/networks.js
// Centralized network presets with optional testnet override.
// Switching preset requires a page reload to re-evaluate imports that use these constants.

const env = typeof import.meta !== "undefined" ? import.meta.env || {} : {};
const LOCAL_STORAGE_KEY = "MEGAETH_NETWORK_PRESET";
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
  rpcUrls: [env.VITE_RPC_URL].filter(Boolean),
  addresses: {
    WETH_ADDRESS: "0x4200000000000000000000000000000000000006",
    USDC_ADDRESS: "0x4c99d545E82D32dA12Cc634a3964b1698073DA2B",
    CUSD_ADDRESS: "0xcCcc62962d17b8914c62D74FfB843d73B2a3cccC",
    USDM_ADDRESS: "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
    CRX_ADDRESS: "0xDEdDFD6F6fD2eDa3B0bC01c3Dfa03F2eA6f40504",
    MEGA_TOKEN_ADDRESS: "0x28B7E77f82B25B95953825F1E3eA0E36c1c29861",
    XBTC_ADDRESS: "",
    WUSD_ADDRESS: "",
    WUSDC_ADDRESS: "",
    MASTER_CHEF_ADDRESS: "0x0e59533B28df0537bc28D05618a2c4f20EBE07a0",
    CRX_WETH_LP_ADDRESS: "0x340d63169285e5ae01a722ce762c0e81a7fa3037",
    HIGH_PRECISION_TIMESTAMP_ORACLE_ADDRESS:
      "0x6342000000000000000000000000000000000002",
    UNIV2_FACTORY_ADDRESS: "0x1F49127E87A1B925694a67C437dd2252641B3875",
    UNIV2_ROUTER_ADDRESS: "0x40276Cff28774FaFaF758992415cFA03b6E4689c",
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
  rpcUrls: ["https://carrot.megaeth.com/rpc"],
  addresses: {
    WETH_ADDRESS: "0x4200000000000000000000000000000000000006",
    USDC_ADDRESS: "0x09cF8A0b9e8C89bff6d1ACbe1467e8E335Bdd03E",
    CUSD_ADDRESS: "0xc3d7f5BDbdB5a74b29B17D1804e23B527F7A1D58",
    USDM_ADDRESS: "0xd8fe4a55f7f79d2937637671923e59d8488683c3",
    CRX_ADDRESS: "0x189b27c207b4cBBae1C65086F31383532443f5f2",
    MEGA_TOKEN_ADDRESS: "0x5a8bc70674d82ac2bc04be91cf172f60169c50b3",
    XBTC_ADDRESS: "0x463151b80DFf738Bb02BA3B4C9Bd788daeEc751c",
    WUSD_ADDRESS: "0x07b1EDd4a0D76D07C5A91B9159D13Cb51C8e4E42",
    WUSDC_ADDRESS: "0x9f5A17BD53310D012544966b8e3cF7863fc8F05f",
    MASTER_CHEF_ADDRESS: "0xE01FA0e28B5a2FaaC5E1c6780B7E8e4059083708",
    CRX_WETH_LP_ADDRESS: "",
    HIGH_PRECISION_TIMESTAMP_ORACLE_ADDRESS: "",
    UNIV2_FACTORY_ADDRESS: "0x28c56b84190FA59Ce3903d5fE4b3FdbE5315FA24",
    UNIV2_ROUTER_ADDRESS: "0x2A6a1e904c86551B195D79DaE8B51202bF645080",
  },
};

const testnetPreset = (() => {
  const rpcUrls = dedupeList([env.VITE_TESTNET_RPC_URL, ...(testnetDefaults.rpcUrls || [])]);
  const addresses = {
    WETH_ADDRESS: env.VITE_TESTNET_WETH_ADDRESS || testnetDefaults.addresses.WETH_ADDRESS,
    USDC_ADDRESS: env.VITE_TESTNET_USDC_ADDRESS || testnetDefaults.addresses.USDC_ADDRESS,
    CUSD_ADDRESS: env.VITE_TESTNET_CUSD_ADDRESS || testnetDefaults.addresses.CUSD_ADDRESS,
    USDM_ADDRESS: env.VITE_TESTNET_USDM_ADDRESS || testnetDefaults.addresses.USDM_ADDRESS,
    CRX_ADDRESS: env.VITE_TESTNET_CRX_ADDRESS || testnetDefaults.addresses.CRX_ADDRESS,
    MEGA_TOKEN_ADDRESS:
      env.VITE_TESTNET_MEGA_TOKEN_ADDRESS || testnetDefaults.addresses.MEGA_TOKEN_ADDRESS,
    XBTC_ADDRESS: env.VITE_TESTNET_XBTC_ADDRESS || testnetDefaults.addresses.XBTC_ADDRESS,
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
  const fromEnv = (env.VITE_DEFAULT_NETWORK_PRESET || env.VITE_DEFAULT_NETWORK || "").toLowerCase();
  const stored = (getStoredPresetId() || "").toLowerCase();
  const desired = stored || fromEnv;
  const match = presets.find((p) => p.id === desired);
  return match ? match.id : "mainnet";
};

export const getActiveNetworkConfig = () => {
  const id = getActiveNetworkPresetId();
  return presets.find((p) => p.id === id) || mainnetPreset;
};

export const setActiveNetworkPreset = (id) => {
  const match = presets.find((p) => p.id === id);
  if (!match) return;

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
