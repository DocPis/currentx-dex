// src/config/addresses.js
// Central place for chain IDs and on-chain addresses
export const MEGAETH_CHAIN_ID_HEX = "0x10e6"; // Chain 4326 (MegaETH)
export const NETWORK_NAME = "MegaETH";
export const EXPLORER_BASE_URL =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    (import.meta.env.VITE_EXPLORER_BASE || import.meta.env.VITE_MEGAETH_EXPLORER)) ||
  "https://megaeth.blockscout.com";

// Infra
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

// Tokens
export const WETH_ADDRESS =
  "0x4200000000000000000000000000000000000006";
export const USDC_ADDRESS =
  "0x4c99d545E82D32dA12Cc634a3964b1698073DA2B";
export const USDM_ADDRESS =
  "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7";
export const CRX_ADDRESS =
  "0xDEdDFD6F6fD2eDa3B0bC01c3Dfa03F2eA6f40504";

// Protocol contracts
export const MASTER_CHEF_ADDRESS =
  "0x0e59533B28df0537bc28D05618a2c4f20EBE07a0";
export const CRX_WETH_LP_ADDRESS =
  "0x340d63169285e5ae01a722ce762c0e81a7fa3037";

// Infra: high-precision timestamp oracle (microsecond)
export const HIGH_PRECISION_TIMESTAMP_ORACLE_ADDRESS =
  "0x6342000000000000000000000000000000000002";

// Uniswap V2 factory/router
export const UNIV2_FACTORY_ADDRESS =
  "0x1F49127E87A1B925694a67C437dd2252641B3875";
export const UNIV2_ROUTER_ADDRESS =
  "0x40276Cff28774FaFaF758992415cFA03b6E4689c";
