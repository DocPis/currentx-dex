// src/shared/config/networks.js
// Centralized network presets with optional testnet override.
// Switching preset requires a page reload to re-evaluate imports that use these constants.

const env = typeof import.meta !== "undefined" ? import.meta.env || {} : {};
const LOCAL_STORAGE_KEY = "MEGAETH_NETWORK_PRESET";

const mainnetPreset = {
  id: "mainnet",
  label: "Mainnet",
  name: "MegaETH",
  chainIdHex: "0x10e6", // 4326
  explorer:
    env.VITE_EXPLORER_BASE ||
    env.VITE_MEGAETH_EXPLORER ||
    "https://megaeth.blockscout.com",
  rpcUrls: [
    env.VITE_RPC_URLS,
    env.VITE_RPC_URL,
    env.VITE_MEGAETH_RPC,
    env.VITE_RPC_FALLBACK,
    env.VITE_RPC_TATUM,
    env.VITE_RPC_THIRDWEB,
    "https://mainnet.megaeth.com/rpc",
  ].filter(Boolean),
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

const testnetPreset = (() => {
  // Only expose testnet if minimally configured.
  const router = env.VITE_TESTNET_ROUTER_ADDRESS;
  const factory = env.VITE_TESTNET_FACTORY_ADDRESS;
  const weth = env.VITE_TESTNET_WETH_ADDRESS;
  const rpc = env.VITE_TESTNET_RPC_URL;
  if (!router || !factory || !weth || !rpc) return null;

  return {
    id: "testnet",
    label: "Testnet",
    name: env.VITE_TESTNET_NAME || "MegaETH Testnet",
    chainIdHex: env.VITE_TESTNET_CHAIN_ID_HEX || "0x10e7", // placeholder; override via env
    explorer:
      env.VITE_TESTNET_EXPLORER || env.VITE_EXPLORER_BASE_TESTNET || "",
    rpcUrls: [
      env.VITE_TESTNET_RPC_URLS,
      env.VITE_TESTNET_RPC_URL,
      rpc,
    ].filter(Boolean),
    addresses: {
      WETH_ADDRESS: weth,
      USDC_ADDRESS:
        env.VITE_TESTNET_USDC_ADDRESS || "",
      CUSD_ADDRESS:
        env.VITE_TESTNET_CUSD_ADDRESS || "",
      USDM_ADDRESS: "",
      CRX_ADDRESS:
        env.VITE_TESTNET_CRX_ADDRESS || "",
      MEGA_TOKEN_ADDRESS:
        env.VITE_TESTNET_MEGA_TOKEN_ADDRESS || "",
      XBTC_ADDRESS:
        env.VITE_TESTNET_XBTC_ADDRESS || "",
      WUSD_ADDRESS:
        env.VITE_TESTNET_WUSD_ADDRESS || "",
      WUSDC_ADDRESS:
        env.VITE_TESTNET_WUSDC_ADDRESS || "",
      MASTER_CHEF_ADDRESS:
        env.VITE_TESTNET_MASTER_CHEF_ADDRESS || "",
      CRX_WETH_LP_ADDRESS:
        env.VITE_TESTNET_CRX_WETH_LP_ADDRESS || "",
      HIGH_PRECISION_TIMESTAMP_ORACLE_ADDRESS: "",
      UNIV2_FACTORY_ADDRESS: factory,
      UNIV2_ROUTER_ADDRESS: router,
    },
  };
})();

const presets = [mainnetPreset, ...(testnetPreset ? [testnetPreset] : [])];

const getStoredPresetId = () => {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(LOCAL_STORAGE_KEY);
  } catch {
    return null;
  }
};

export const getAvailableNetworkPresets = () => presets;

export const getActiveNetworkPresetId = () => {
  const fromEnv = env.VITE_DEFAULT_NETWORK_PRESET || env.VITE_DEFAULT_NETWORK;
  const stored = getStoredPresetId();
  const desired = (stored || fromEnv || "").toLowerCase();
  const match = presets.find((p) => p.id === desired);
  return match ? match.id : "mainnet";
};

export const getActiveNetworkConfig = () => {
  const id = getActiveNetworkPresetId();
  return presets.find((p) => p.id === id) || mainnetPreset;
};

export const setActiveNetworkPreset = (id) => {
  if (typeof localStorage === "undefined") return;
  const match = presets.find((p) => p.id === id);
  if (!match) return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, id);
  } catch {
    // ignore storage errors
  }
};
