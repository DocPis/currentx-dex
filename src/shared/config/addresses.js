// src/config/addresses.js
// Central place for chain IDs and on-chain addresses, driven by the active network preset.
import { getActiveNetworkConfig } from "./networks";

const active = getActiveNetworkConfig();

export const MEGAETH_CHAIN_ID_HEX = active.chainIdHex;
export const NETWORK_NAME = active.name;
export const EXPLORER_BASE_URL = active.explorer;

// Infra
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

// Tokens
export const WETH_ADDRESS = active.addresses.WETH_ADDRESS;
export const USDC_ADDRESS = active.addresses.USDC_ADDRESS;
export const USDT0_ADDRESS = active.addresses.USDT0_ADDRESS;
export const CUSD_ADDRESS = active.addresses.CUSD_ADDRESS;
export const STCUSD_ADDRESS = active.addresses.STCUSD_ADDRESS;
export const SUSDE_ADDRESS = active.addresses.SUSDE_ADDRESS;
export const USDE_ADDRESS = active.addresses.USDE_ADDRESS;
export const EZETH_ADDRESS = active.addresses.EZETH_ADDRESS;
export const WSTETH_ADDRESS = active.addresses.WSTETH_ADDRESS;
export const USDM_ADDRESS = active.addresses.USDM_ADDRESS;
export const CRX_ADDRESS = active.addresses.CRX_ADDRESS;
export const MEGA_TOKEN_ADDRESS = active.addresses.MEGA_TOKEN_ADDRESS;
export const XBTC_ADDRESS = active.addresses.XBTC_ADDRESS;
export const BTCB_ADDRESS = active.addresses.BTCB_ADDRESS;
export const WUSD_ADDRESS = active.addresses.WUSD_ADDRESS;
export const WUSDC_ADDRESS = active.addresses.WUSDC_ADDRESS;

// Protocol contracts
export const MASTER_CHEF_ADDRESS = active.addresses.MASTER_CHEF_ADDRESS;
export const CRX_WETH_LP_ADDRESS = active.addresses.CRX_WETH_LP_ADDRESS;

// Infra: high-precision timestamp oracle (microsecond)
export const HIGH_PRECISION_TIMESTAMP_ORACLE_ADDRESS =
  active.addresses.HIGH_PRECISION_TIMESTAMP_ORACLE_ADDRESS;

// Uniswap V2 factory/router
export const UNIV2_FACTORY_ADDRESS = active.addresses.UNIV2_FACTORY_ADDRESS;
export const UNIV2_ROUTER_ADDRESS = active.addresses.UNIV2_ROUTER_ADDRESS;
export const UNIV2_PAIR_CODE_HASH = active.addresses.UNIV2_PAIR_CODE_HASH;

// Uniswap V3 factory (mainnet-only unless provided in preset/env)
export const UNIV3_FACTORY_ADDRESS = active.addresses.UNIV3_FACTORY_ADDRESS;
export const UNIV3_QUOTER_V2_ADDRESS = active.addresses.UNIV3_QUOTER_V2_ADDRESS;
export const UNIV3_TICK_LENS_ADDRESS = active.addresses.UNIV3_TICK_LENS_ADDRESS;
export const UNIV3_SWAP_ROUTER_ADDRESS = active.addresses.UNIV3_SWAP_ROUTER_ADDRESS;
export const UNIV3_POSITION_MANAGER_ADDRESS = active.addresses.UNIV3_POSITION_MANAGER_ADDRESS;
export const UNIV3_MULTICALL_ADDRESS = active.addresses.UNIV3_MULTICALL_ADDRESS;
export const UNIV3_MIGRATOR_ADDRESS = active.addresses.UNIV3_MIGRATOR_ADDRESS;
export const UNIV3_POOL_INIT_CODE_HASH = active.addresses.UNIV3_POOL_INIT_CODE_HASH;
export const UNIV3_UNIVERSAL_ROUTER_ADDRESS = active.addresses.UNIV3_UNIVERSAL_ROUTER_ADDRESS;
export const PERMIT2_ADDRESS = active.addresses.PERMIT2_ADDRESS;
