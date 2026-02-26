import { getActiveNetworkConfig } from "./networks";

const env = typeof import.meta !== "undefined" ? import.meta.env || {} : {};
const activeNetwork = getActiveNetworkConfig();

const parseChainId = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    const parsedHex = Number.parseInt(raw, 16);
    return Number.isFinite(parsedHex) ? parsedHex : fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const defaultChainId = parseChainId(activeNetwork?.chainIdHex || "0x10e6", 4326);

export const ALM_CHAIN_ID = parseChainId(env.VITE_ALM_CHAIN_ID, defaultChainId);
export const ALM_RPC_URL =
  env.VITE_ALM_RPC_URL ||
  env.VITE_RPC_URL ||
  (activeNetwork?.rpcUrls || []).find(Boolean) ||
  "https://mainnet.megaeth.com/rpc";
export const ALM_EVENT_FROM_BLOCK = Number.parseInt(
  String(env.VITE_ALM_EVENT_FROM_BLOCK || "0"),
  10
);

export const ALM_ADDRESSES = {
  ALM: env.VITE_ALM_ADDRESS || "0x64b2d8349e0cfe88ff832a89a9ffe6457d41c227",
  NFPM: env.VITE_ALM_NFPM_ADDRESS || "0xA02E90A5F5eF73c434f5A7E6A77E6508f009cB9D",
  STRATEGY_REGISTRY:
    env.VITE_ALM_STRATEGY_REGISTRY_ADDRESS || "0x14d23d874EE025EbDE846307Fc8A624cde6291F1",
  WETH: env.VITE_ALM_WETH_ADDRESS || "0x4200000000000000000000000000000000000006",
  USDM: env.VITE_ALM_USDM_ADDRESS || "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
  USDT0: env.VITE_ALM_USDT0_ADDRESS || "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
} as const;
