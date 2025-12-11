// src/config/uniswapSepolia.js

import { TOKEN_REGISTRY } from "../utils/tokenRegistry";
import IUniswapV2FactoryJSON from "../abi/IUniswapV2Factory.json";
import IUniswapV2RouterJSON from "../abi/IUniswapV2Router02.json";
import IUniswapV2PairJSON from "../abi/IUniswapV2Pair.json";

// ChainId di Sepolia in formato hex
export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";

/**
 * ---- TOKEN ADDRESS ALIAS (compatibili con il vecchio codice) ----
 *  Usiamo GLI STESSI indirizzi della tua tx di addLiquidity.
 */

export const WETH_ADDRESS =
  "0xfff9976782d46cc05630d1f6ebab18b2324d6b14"; // tokenA

export const USDC_ADDRESS =
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238"; // tokenB

/**
 * ---- UNISWAP V2 ADDRESS ALIAS ----
 */

export const UNISWAP_V2_FACTORY =
  "0xf62c03e08ada871a0beb309762e260a7a6a880e6";

export const UNISWAP_V2_ROUTER =
  "0xee567fe1712faf6149d80da1e6934e354124cfe3";

/**
 * ---- ABIs (alias per i vecchi hook) ----
 */

export const UNISWAP_V2_FACTORY_ABI =
  IUniswapV2FactoryJSON.abi ?? IUniswapV2FactoryJSON;

export const UNISWAP_V2_ROUTER_ABI =
  IUniswapV2RouterJSON.abi ?? IUniswapV2RouterJSON;

export const UNISWAP_V2_PAIR_ABI =
  IUniswapV2PairJSON.abi ?? IUniswapV2PairJSON;

// ABI generico ERC20 usato da useTokenAllowance e simili
export const ERC20_ABI = [
  {
    inputs: [],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "address", name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
];

/**
 * ---- ABI per il contratto WETH (wrap / unwrap) ----
 * (deposit, withdraw + funzioni ERC20 base)
 */
export const WETH_ABI = [
  // deposit() payable
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  // withdraw(uint256)
  {
    inputs: [
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // ---- ERC20 base ----
  ...ERC20_ABI,
];

/**
 * ---- Registry loader usato in App.jsx ----
 */
export async function loadTokenRegistry(_provider) {
  return TOKEN_REGISTRY;
}
