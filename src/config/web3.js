// src/config/web3.js
import { BrowserProvider, Contract, JsonRpcProvider, formatUnits } from "ethers";
import { fetchV2PairData } from "./subgraph";
import daiLogo from "../tokens/dai.png";
import ethLogo from "../tokens/eth.png";
import tetherLogo from "../tokens/tether.png";
import usdcLogo from "../tokens/usdc.png";
import wbtcLogo from "../tokens/wbtc.png";
import wethLogo from "../tokens/weth.png";
import currentxLogo from "../assets/currentx.png";

const CUSTOM_TOKEN_STORE_KEY = "__CX_CUSTOM_TOKENS__";
const DEFAULT_RPC_URL =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_SEPOLIA_RPC) ||
  "https://1rpc.io/sepolia";

export function getRegisteredCustomTokens() {
  if (typeof globalThis === "undefined") return {};
  return globalThis[CUSTOM_TOKEN_STORE_KEY] || {};
}

export function setRegisteredCustomTokens(tokens) {
  if (typeof globalThis === "undefined") return;
  globalThis[CUSTOM_TOKEN_STORE_KEY] = tokens || {};
}

export function getReadOnlyProvider() {
  return new JsonRpcProvider(DEFAULT_RPC_URL);
}

export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";

// Addresses (lowercase to avoid checksum issues)
export const WETH_ADDRESS =
  "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
export const USDC_ADDRESS =
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
export const USDT_ADDRESS =
  "0xaa8e23fb1079ea71e0a56f48a2aa51851d8433d0";
export const WBTC_ADDRESS =
  "0x29f2d40b0605204364af54ec677bd022da425d03";
export const CRX_ADDRESS =
  "0x46bb8cf9f25986201c1d91f095622e37be2463a3";
export const MASTER_CHEF_ADDRESS =
  "0x8d29ebbf13786fe6c5439937d5d47e2fb8cc9f9a";
export const CRX_WETH_LP_ADDRESS =
  "0x340d63169285e5ae01a722ce762c0e81a7fa3037";
// Fixed WETH/USDC pair (provided by user)
export const WETH_USDC_PAIR_ADDRESS =
  "0x92aC66C621832EF02629c10A3Db25C5e92eA33d4";



// Uniswap V2 (Sepolia) - factory provided by the user
export const UNIV2_FACTORY_ADDRESS =
  "0xb70112d72da5d6df0bb2b26a2307e4ba27cfe042";
export const UNIV2_ROUTER_ADDRESS =
  "0xf9ac1ee27a2db3a471e1f590cd689dee6a2c391d";

// Minimal ERC20 ABI
export const ERC20_ABI = [
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
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
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
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
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
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
];

export const UNIV2_ROUTER_ABI = [
  {
    inputs: [
      { internalType: "address", name: "_factory", type: "address" },
      { internalType: "address", name: "_WETH", type: "address" },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [],
    name: "WETH",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "tokenA", type: "address" },
      { internalType: "address", name: "tokenB", type: "address" },
      { internalType: "uint256", name: "amountADesired", type: "uint256" },
      { internalType: "uint256", name: "amountBDesired", type: "uint256" },
      { internalType: "uint256", name: "amountAMin", type: "uint256" },
      { internalType: "uint256", name: "amountBMin", type: "uint256" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "addLiquidity",
    outputs: [
      { internalType: "uint256", name: "amountA", type: "uint256" },
      { internalType: "uint256", name: "amountB", type: "uint256" },
      { internalType: "uint256", name: "liquidity", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "token", type: "address" },
      { internalType: "uint256", name: "amountTokenDesired", type: "uint256" },
      { internalType: "uint256", name: "amountTokenMin", type: "uint256" },
      { internalType: "uint256", name: "amountETHMin", type: "uint256" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "addLiquidityETH",
    outputs: [
      { internalType: "uint256", name: "amountToken", type: "uint256" },
      { internalType: "uint256", name: "amountETH", type: "uint256" },
      { internalType: "uint256", name: "liquidity", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    name: "factory",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountOut", type: "uint256" },
      { internalType: "uint256", name: "reserveIn", type: "uint256" },
      { internalType: "uint256", name: "reserveOut", type: "uint256" },
    ],
    name: "getAmountIn",
    outputs: [{ internalType: "uint256", name: "amountIn", type: "uint256" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountIn", type: "uint256" },
      { internalType: "uint256", name: "reserveIn", type: "uint256" },
      { internalType: "uint256", name: "reserveOut", type: "uint256" },
    ],
    name: "getAmountOut",
    outputs: [{ internalType: "uint256", name: "amountOut", type: "uint256" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountOut", type: "uint256" },
      { internalType: "address[]", name: "path", type: "address[]" },
    ],
    name: "getAmountsIn",
    outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountIn", type: "uint256" },
      { internalType: "address[]", name: "path", type: "address[]" },
    ],
    name: "getAmountsOut",
    outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountA", type: "uint256" },
      { internalType: "uint256", name: "reserveA", type: "uint256" },
      { internalType: "uint256", name: "reserveB", type: "uint256" },
    ],
    name: "quote",
    outputs: [{ internalType: "uint256", name: "amountB", type: "uint256" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "tokenA", type: "address" },
      { internalType: "address", name: "tokenB", type: "address" },
      { internalType: "uint256", name: "liquidity", type: "uint256" },
      { internalType: "uint256", name: "amountAMin", type: "uint256" },
      { internalType: "uint256", name: "amountBMin", type: "uint256" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "removeLiquidity",
    outputs: [
      { internalType: "uint256", name: "amountA", type: "uint256" },
      { internalType: "uint256", name: "amountB", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "token", type: "address" },
      { internalType: "uint256", name: "liquidity", type: "uint256" },
      { internalType: "uint256", name: "amountTokenMin", type: "uint256" },
      { internalType: "uint256", name: "amountETHMin", type: "uint256" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "removeLiquidityETH",
    outputs: [
      { internalType: "uint256", name: "amountToken", type: "uint256" },
      { internalType: "uint256", name: "amountETH", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountOutMin", type: "uint256" },
      { internalType: "address[]", name: "path", type: "address[]" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "swapExactETHForTokens",
    outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountIn", type: "uint256" },
      { internalType: "uint256", name: "amountOutMin", type: "uint256" },
      { internalType: "address[]", name: "path", type: "address[]" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "swapExactTokensForETH",
    outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountIn", type: "uint256" },
      { internalType: "uint256", name: "amountOutMin", type: "uint256" },
      { internalType: "address[]", name: "path", type: "address[]" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "swapExactTokensForTokens",
    outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountOut", type: "uint256" },
      { internalType: "address[]", name: "path", type: "address[]" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "swapETHForExactTokens",
    outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountOut", type: "uint256" },
      { internalType: "uint256", name: "amountInMax", type: "uint256" },
      { internalType: "address[]", name: "path", type: "address[]" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "swapTokensForExactETH",
    outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountOut", type: "uint256" },
      { internalType: "uint256", name: "amountInMax", type: "uint256" },
      { internalType: "address[]", name: "path", type: "address[]" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "swapTokensForExactTokens",
    outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  { stateMutability: "payable", type: "receive" },
];

// Minimal MasterChef ABI (reward + pool info)
export const MASTER_CHEF_ABI = [
  {
    inputs: [],
    name: "poolLength",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "poolInfo",
    outputs: [
      { internalType: "contract IERC20", name: "lpToken", type: "address" },
      { internalType: "uint256", name: "allocPoint", type: "uint256" },
      { internalType: "uint256", name: "lastRewardBlock", type: "uint256" },
      { internalType: "uint256", name: "accCurrentXPerShare", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalAllocPoint",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "currentxPerBlock",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_pid", type: "uint256" },
      { internalType: "uint256", name: "_amount", type: "uint256" },
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_pid", type: "uint256" },
      { internalType: "uint256", name: "_amount", type: "uint256" },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_pid", type: "uint256" }],
    name: "emergencyWithdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_pid", type: "uint256" },
      { internalType: "address", name: "_user", type: "address" },
    ],
    name: "pendingCurrentX",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "", type: "uint256" },
      { internalType: "address", name: "", type: "address" },
    ],
    name: "userInfo",
    outputs: [
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "uint256", name: "rewardDebt", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
];

export const WETH_ABI = [
  ...ERC20_ABI,
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "wad", type: "uint256" }],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

// Minimal Uniswap V2 ABI
export const UNIV2_FACTORY_ABI = [
  {
    inputs: [{ internalType: "address", name: "_feeToSetter", type: "address" }],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "token0", type: "address" },
      { indexed: true, internalType: "address", name: "token1", type: "address" },
      { indexed: false, internalType: "address", name: "pair", type: "address" },
      { indexed: false, internalType: "uint256", name: "", type: "uint256" },
    ],
    name: "PairCreated",
    type: "event",
  },
  {
    constant: true,
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "allPairs",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "allPairsLength",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { internalType: "address", name: "tokenA", type: "address" },
      { internalType: "address", name: "tokenB", type: "address" },
    ],
    name: "createPair",
    outputs: [{ internalType: "address", name: "pair", type: "address" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "feeTo",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "feeToSetter",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "address", name: "", type: "address" },
    ],
    name: "getPair",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "pairCodeHash",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    constant: false,
    inputs: [{ internalType: "address", name: "_feeTo", type: "address" }],
    name: "setFeeTo",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: false,
    inputs: [{ internalType: "address", name: "_feeToSetter", type: "address" }],
    name: "setFeeToSetter",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export const UNIV2_PAIR_ABI = [
  {
    inputs: [],
    name: "getReserves",
    outputs: [
      { internalType: "uint112", name: "_reserve0", type: "uint112" },
      { internalType: "uint112", name: "_reserve1", type: "uint112" },
      { internalType: "uint32", name: "_blockTimestampLast", type: "uint32" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token0",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token1",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "to", type: "address" }],
    name: "mint",
    outputs: [{ internalType: "uint256", name: "liquidity", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "to", type: "address" }],
    name: "burn",
    outputs: [
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amount0Out", type: "uint256" },
      { internalType: "uint256", name: "amount1Out", type: "uint256" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "bytes", name: "data", type: "bytes" },
    ],
    name: "swap",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

// Registry dei token che usiamo nello swap
// Token registry used across swaps
export const TOKENS = {
  ETH: {
    symbol: "ETH",
    name: "Ether",
    address: null, // native
    decimals: 18,
    logo: ethLogo,
  },
  WETH: {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: WETH_ADDRESS,
    decimals: 18,
    logo: wethLogo,
  },
  CRX: {
    symbol: "CRX",
    name: "CurrentX",
    address: CRX_ADDRESS,
    decimals: 6,
    logo: currentxLogo,
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin (test)",
    address: USDC_ADDRESS,
    decimals: 6,
    logo: usdcLogo,
  },
  USDT: {
    symbol: "USDT",
    name: "Tether USD (test)",
    address: USDT_ADDRESS,
    decimals: 6,
    logo: tetherLogo,
  },
  DAI: {
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0xff34b3d4aee8ddcd6f9afffb6fe49bd371b8a357",
    decimals: 18,
    logo: daiLogo,
  },
  WBTC: {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    address: WBTC_ADDRESS,
    decimals: 8,
    logo: wbtcLogo,
  },
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
    eth = getInjectedEthereum();
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function getAmountOut(amountIn, reserveIn, reserveOut) {
  // Uniswap V2 formula (no scaling loss):
  // amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
  const amountInWithFee = amountIn * 997n;
  return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
}

function normalize(amount, decimals) {
  return Number(formatUnits(amount, decimals));
}

export function computePriceImpact(
  amountIn,
  amountOut,
  reserveIn,
  reserveOut,
  decimalsIn,
  decimalsOut
) {
  if (
    !reserveIn ||
    !reserveOut ||
    amountIn <= 0n ||
    amountOut <= 0n ||
    decimalsIn === undefined ||
    decimalsOut === undefined
  ) {
    return 0;
  }

  const midPrice =
    normalize(reserveOut, decimalsOut) / normalize(reserveIn, decimalsIn);
  const execPrice =
    normalize(amountOut, decimalsOut) / normalize(amountIn, decimalsIn);
  if (!midPrice || !execPrice || !Number.isFinite(midPrice)) return 0;
  const impact = ((midPrice - execPrice) / midPrice) * 100;
  return Math.max(0, impact);
}

// Compute a Uniswap V2 quote (getAmountsOut) for a given path
export async function getV2Quote(provider, amountIn, path) {
  if (!provider) throw new Error("Missing provider");
  if (!Array.isArray(path) || path.length < 2)
    throw new Error("Invalid path");

  const factory = new Contract(
    UNIV2_FACTORY_ADDRESS,
    UNIV2_FACTORY_ABI,
    provider
  );

  let amount = amountIn;

  for (let i = 0; i < path.length - 1; i += 1) {
    const tokenIn = path[i];
    const tokenOut = path[i + 1];

    const tokenInLower = tokenIn?.toLowerCase?.();
    const tokenOutLower = tokenOut?.toLowerCase?.();
    const isWethUsdc =
      tokenInLower &&
      tokenOutLower &&
      [WETH_ADDRESS.toLowerCase(), USDC_ADDRESS.toLowerCase()].includes(
        tokenInLower
      ) &&
      [WETH_ADDRESS.toLowerCase(), USDC_ADDRESS.toLowerCase()].includes(
        tokenOutLower
      );

    const pairAddress = isWethUsdc
      ? WETH_USDC_PAIR_ADDRESS
      : await factory.getPair(tokenIn, tokenOut);
    if (!pairAddress || pairAddress === ZERO_ADDRESS) {
      throw new Error("Pair not found on Sepolia");
    }

    const pair = new Contract(pairAddress, UNIV2_PAIR_ABI, provider);
    const [reserve0, reserve1] = await pair.getReserves();
    const token0 = await pair.token0();

    const tokenInIs0 =
      token0.toLowerCase() === tokenIn.toLowerCase();
    const reserveIn = tokenInIs0 ? reserve0 : reserve1;
    const reserveOut = tokenInIs0 ? reserve1 : reserve0;

    if (reserveIn === 0n || reserveOut === 0n) {
      throw new Error("Pool has no liquidity");
    }

    amount = getAmountOut(amount, reserveIn, reserveOut);
  }

  return amount;
}

function findTokenMeta(address) {
  if (!address) return null;
  const lower = address.toLowerCase();
  const registered = getRegisteredCustomTokens();
  const customMatch = Object.values(registered || {}).find(
    (t) => t.address && t.address.toLowerCase() === lower
  );
  if (customMatch) return customMatch;
  return Object.values(TOKENS).find(
    (t) => t.address && t.address.toLowerCase() === lower
  );
}

// Quote + meta (single hop) per price impact e swap
export async function getV2QuoteWithMeta(provider, amountIn, tokenIn, tokenOut) {
  if (!provider) throw new Error("Missing provider");

  const factory = new Contract(
    UNIV2_FACTORY_ADDRESS,
    UNIV2_FACTORY_ABI,
    provider
  );

  const tokenInLower = tokenIn?.toLowerCase?.();
  const tokenOutLower = tokenOut?.toLowerCase?.();
  const isWethUsdc =
    tokenInLower &&
    tokenOutLower &&
    [WETH_ADDRESS.toLowerCase(), USDC_ADDRESS.toLowerCase()].includes(
      tokenInLower
    ) &&
    [WETH_ADDRESS.toLowerCase(), USDC_ADDRESS.toLowerCase()].includes(
      tokenOutLower
    );

  const pairAddress = isWethUsdc
    ? WETH_USDC_PAIR_ADDRESS
    : await factory.getPair(tokenIn, tokenOut);
  if (!pairAddress || pairAddress === ZERO_ADDRESS) {
    throw new Error("Pair not found on Sepolia");
  }

  const pair = new Contract(pairAddress, UNIV2_PAIR_ABI, provider);
  const [reserve0, reserve1] = await pair.getReserves();
  const token0 = await pair.token0();
  const token1 = await pair.token1();

  const tokenInIs0 = token0.toLowerCase() === tokenIn.toLowerCase();
  const reserveIn = tokenInIs0 ? reserve0 : reserve1;
  const reserveOut = tokenInIs0 ? reserve1 : reserve0;

  if (reserveIn === 0n || reserveOut === 0n) {
    throw new Error("Pool has no liquidity");
  }

  const metaIn = findTokenMeta(tokenIn);
  const metaOut = findTokenMeta(tokenOut);
  const amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
  const priceImpactPct = computePriceImpact(
    amountIn,
    amountOut,
    reserveIn,
    reserveOut,
    metaIn?.decimals ?? 18,
    metaOut?.decimals ?? 18
  );

  return {
    amountOut,
    reserveIn,
    reserveOut,
    tokenInIs0,
    pairAddress,
    token0,
    token1,
    reserve0,
    reserve1,
    priceImpactPct,
  };
}

export async function getV2PairReserves(
  provider,
  tokenA,
  tokenB,
  pairAddressOverride
) {
  if (!provider) throw new Error("Missing provider");

  const factory = new Contract(
    UNIV2_FACTORY_ADDRESS,
    UNIV2_FACTORY_ABI,
    provider
  );

  const tokenALower = tokenA?.toLowerCase?.();
  const tokenBLower = tokenB?.toLowerCase?.();
  const isWethUsdc =
    tokenALower &&
    tokenBLower &&
    [WETH_ADDRESS.toLowerCase(), USDC_ADDRESS.toLowerCase()].includes(
      tokenALower
    ) &&
    [WETH_ADDRESS.toLowerCase(), USDC_ADDRESS.toLowerCase()].includes(
      tokenBLower
    );

  const pairAddress =
    pairAddressOverride ||
    (isWethUsdc
      ? WETH_USDC_PAIR_ADDRESS
      : await factory.getPair(tokenA, tokenB));
  if (!pairAddress || pairAddress === ZERO_ADDRESS) {
    throw new Error("Pair not found on Sepolia");
  }

  const pair = new Contract(pairAddress, UNIV2_PAIR_ABI, provider);
  const [reserve0, reserve1] = await pair.getReserves();
  const token0 = await pair.token0();
  const token1 = await pair.token1();

  return {
    pairAddress,
    reserve0,
    reserve1,
    token0,
    token1,
  };
}

const BLOCKS_PER_YEAR = 2628000n; // ~12s block time

async function fetchTokenMeta(provider, address, cache = {}) {
  if (!address) return null;
  const lower = address.toLowerCase();
  if (cache[lower]) return cache[lower];

  const known = Object.values(TOKENS).find(
    (t) => t.address && t.address.toLowerCase() === lower
  );
  if (known) {
    cache[lower] = known;
    return known;
  }

  const erc = new Contract(address, ERC20_ABI, provider);
  const [symbol, name, decimals] = await Promise.all([
    erc.symbol().catch(() => "TOKEN"),
    erc.name().catch(() => "Token"),
    erc.decimals().catch(() => 18),
  ]);

  const meta = {
    symbol,
    name,
    address,
    decimals: Number(decimals) || 18,
    logo: currentxLogo,
  };
  cache[lower] = meta;
  return meta;
}

async function getWethPriceUSD(provider, priceCache) {
  const key = WETH_ADDRESS.toLowerCase();
  const cached = priceCache[key];
  if (typeof cached === "number") return cached;
  const { reserve0, reserve1, token0 } = await getV2PairReserves(
    provider,
    WETH_ADDRESS,
    USDC_ADDRESS,
    WETH_USDC_PAIR_ADDRESS
  );
  const wethIs0 = token0.toLowerCase() === WETH_ADDRESS.toLowerCase();
  const wethRes = wethIs0 ? reserve0 : reserve1;
  const usdcRes = wethIs0 ? reserve1 : reserve0;
  const price =
    Number(formatUnits(usdcRes, TOKENS.USDC.decimals)) /
    Number(formatUnits(wethRes, TOKENS.WETH.decimals));
  priceCache[key] = price;
  return price;
}

async function getTokenPriceUSD(provider, address, priceCache, metaCache) {
  if (!address) return null;
  const lower = address.toLowerCase();
  if (priceCache[lower] !== undefined) return priceCache[lower];

  if (
    lower === USDC_ADDRESS.toLowerCase() ||
    lower === USDT_ADDRESS.toLowerCase() ||
    lower === TOKENS.DAI.address.toLowerCase()
  ) {
    priceCache[lower] = 1;
    return 1;
  }

  if (lower === WETH_ADDRESS.toLowerCase()) {
    return getWethPriceUSD(provider, priceCache);
  }

  if (lower === CRX_ADDRESS.toLowerCase()) {
    const wethPrice = await getWethPriceUSD(provider, priceCache);
    const pair = new Contract(CRX_WETH_LP_ADDRESS, UNIV2_PAIR_ABI, provider);
    const [reserve0, reserve1] = await pair.getReserves();
    const token0 = await pair.token0();
    const token1 = await pair.token1();
    const crxIs0 = token0.toLowerCase() === lower;
    const crxRes = crxIs0 ? reserve0 : reserve1;
    const wethRes = crxIs0 ? reserve1 : reserve0;
    const priceInWeth =
      Number(formatUnits(wethRes, TOKENS.WETH.decimals)) /
      Number(formatUnits(crxRes, TOKENS.CRX.decimals));
    const usd = priceInWeth * wethPrice;
    priceCache[lower] = usd;
    return usd;
  }

  return null;
}

async function getLpSummary(provider, lpAddress, priceCache, metaCache) {
  const pair = new Contract(lpAddress, UNIV2_PAIR_ABI, provider);
  const [reserve0, reserve1] = await pair.getReserves();
  const [token0, token1, totalSupply, lpDecimalsRaw] = await Promise.all([
    pair.token0(),
    pair.token1(),
    pair.totalSupply(),
    pair.decimals().catch(() => 18),
  ]);
  const lpDecimals = Number(lpDecimalsRaw) || 18;

  const meta0 = await fetchTokenMeta(provider, token0, metaCache);
  const meta1 = await fetchTokenMeta(provider, token1, metaCache);
  const price0 = await getTokenPriceUSD(provider, token0, priceCache, metaCache);
  const price1 = await getTokenPriceUSD(provider, token1, priceCache, metaCache);

  let tvlUsd = null;
  const val0 =
    price0 !== null
      ? Number(formatUnits(reserve0, meta0.decimals)) * price0
      : null;
  const val1 =
    price1 !== null
      ? Number(formatUnits(reserve1, meta1.decimals)) * price1
      : null;
  if (val0 !== null && val1 !== null) {
    tvlUsd = val0 + val1;
  } else if (val0 !== null) {
    tvlUsd = val0 * 2;
  } else if (val1 !== null) {
    tvlUsd = val1 * 2;
  }

  if (tvlUsd === null || Number.isNaN(tvlUsd)) {
    try {
      const sub = await fetchV2PairData(token0, token1);
      if (sub?.tvlUsd !== undefined) tvlUsd = Number(sub.tvlUsd);
    } catch (e) {
      // ignore subgraph issues
    }
  }

  return {
    token0: meta0,
    token1: meta1,
    reserve0,
    reserve1,
    totalSupply,
    tvlUsd,
    lpDecimals,
  };
}

export async function fetchMasterChefFarms(providerOverride) {
  const provider = providerOverride || getReadOnlyProvider();
  const chef = new Contract(MASTER_CHEF_ADDRESS, MASTER_CHEF_ABI, provider);
  const [poolLengthRaw, totalAllocPointRaw, perBlockRaw] = await Promise.all([
    chef.poolLength(),
    chef.totalAllocPoint(),
    chef.currentxPerBlock(),
  ]);
  const poolLength = Number(poolLengthRaw);
  const totalAllocPoint = BigInt(totalAllocPointRaw || 0n);
  const perBlock = BigInt(perBlockRaw || 0n);

  const priceCache = {};
  const metaCache = {};
  const crxPriceUsd = await getTokenPriceUSD(
    provider,
    CRX_ADDRESS,
    priceCache,
    metaCache
  );
  const pools = [];
  for (let pid = 0; pid < poolLength; pid++) {
    const info = await chef.poolInfo(pid);
    const allocPoint = BigInt(info.allocPoint || 0n);
    const lpToken = info.lpToken;
    const rewardPerBlock =
      totalAllocPoint > 0n ? (perBlock * allocPoint) / totalAllocPoint : 0n;

    let apr = null;
    let tvlUsd = null;
    let tokens = [];
    let pairLabel = "";
    let lpSummary = null;

    try {
      lpSummary = await getLpSummary(provider, lpToken, priceCache, metaCache);
      tvlUsd = lpSummary.tvlUsd;
      tokens = [lpSummary.token0, lpSummary.token1];
      pairLabel = `${lpSummary.token0.symbol} / ${lpSummary.token1.symbol}`;
      if (crxPriceUsd !== null && tvlUsd && tvlUsd > 0) {
        const rewardsPerYear = Number(
          formatUnits(rewardPerBlock * BLOCKS_PER_YEAR, TOKENS.CRX.decimals)
        );
        const rewardUsd = rewardsPerYear * crxPriceUsd;
        apr = (rewardUsd / tvlUsd) * 100;
      }
    } catch (e) {
      // ignore per-pool errors
    }

    pools.push({
      pid,
      lpToken,
      allocPoint: Number(allocPoint),
      rewardPerBlock: Number(formatUnits(rewardPerBlock, TOKENS.CRX.decimals)),
      rewardToken: TOKENS.CRX,
      apr,
      tvlUsd,
      tokens,
      pairLabel,
      lpDecimals: Number(lpSummary?.lpDecimals || 18),
    });
  }

  return {
    emissionPerBlock: Number(formatUnits(perBlock, TOKENS.CRX.decimals)),
    totalAllocPoint: Number(totalAllocPoint),
    pools,
  };
}

export async function fetchMasterChefUserData(address, pools, providerOverride) {
  if (!address || !pools?.length) return {};
  const provider = providerOverride || getReadOnlyProvider();
  const chef = new Contract(MASTER_CHEF_ADDRESS, MASTER_CHEF_ABI, provider);
  const out = {};
  for (const pool of pools) {
    try {
      const lpContract = new Contract(pool.lpToken, ERC20_ABI, provider);
      const [userInfo, pendingRaw, walletBalRaw] = await Promise.all([
        chef.userInfo(pool.pid, address),
        chef.pendingCurrentX(pool.pid, address),
        lpContract.balanceOf(address).catch(() => 0n),
      ]);
      const staked =
        pool.lpDecimals !== undefined
          ? Number(formatUnits(userInfo.amount || 0n, pool.lpDecimals))
          : Number(userInfo.amount || 0n);
      const lpBalance =
        pool.lpDecimals !== undefined
          ? Number(formatUnits(walletBalRaw || 0n, pool.lpDecimals))
          : Number(walletBalRaw || 0n);
      out[pool.pid] = {
        staked,
        lpBalance,
        pending: Number(formatUnits(pendingRaw || 0n, TOKENS.CRX.decimals)),
      };
    } catch (e) {
      out[pool.pid] = { staked: 0, pending: 0, lpBalance: 0 };
    }
  }
  return out;
}
