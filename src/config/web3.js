// src/config/web3.js
import { BrowserProvider, Contract } from "ethers";
import daiLogo from "../tokens/dai.png";
import ethLogo from "../tokens/eth.png";
import usdcLogo from "../tokens/usdc.png";
import wbtcLogo from "../tokens/wbtc.png";
import wethLogo from "../tokens/weth.png";

export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";

// Indirizzi (in lowercase per evitare errori di checksum)
export const WETH_ADDRESS =
  "0xfff9976782d46cc05630d1f6ebab18b2324d6b14";
export const USDC_ADDRESS =
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";

// Semplice ERC20 ABI
export const ERC20_ABI = [
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
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
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
];

// Registry dei token che usiamo nello swap
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
  USDC: {
    symbol: "USDC",
    name: "USD Coin (test)",
    address: USDC_ADDRESS,
    decimals: 6,
    logo: usdcLogo,
  },
  DAI: {
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: null,
    decimals: 18,
    logo: daiLogo,
  },
  WBTC: {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    address: null,
    decimals: 8,
    logo: wbtcLogo,
  },
};

export async function getProvider() {
  if (!window.ethereum) throw new Error("No wallet found");
  return new BrowserProvider(window.ethereum);
}

export async function getErc20(address, provider) {
  return new Contract(address, ERC20_ABI, provider);
}
