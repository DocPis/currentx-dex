// src/config/tokenRegistry.js

import ethLogo from "../assets/tokens/eth.png";
import wethLogo from "../assets/tokens/weth.png";
import usdcLogo from "../assets/tokens/usdc.png";
import daiLogo from "../assets/tokens/dai.png";    // <— assicurati che il file esista
import wbtcLogo from "../assets/tokens/wbtc.png";  // <— idem

import { WETH_ADDRESS, USDC_ADDRESS } from "./uniswapSepolia";

export const TOKENS = {
  ETH: {
    symbol: "ETH",
    name: "Ether",
    address: null, // native
    isNative: true,
    isWrappedNative: false,
    decimals: 18,
    logo: ethLogo,
  },

  WETH: {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: WETH_ADDRESS,
    isNative: false,
    isWrappedNative: true,
    decimals: 18,
    logo: wethLogo,
  },

  USDC: {
    symbol: "USDC",
    name: "USD Coin (Sepolia)",
    address: USDC_ADDRESS,
    isNative: false,
    isWrappedNative: false,
    decimals: 6,
    logo: usdcLogo,
  },

  DAI: {
    symbol: "DAI",
    name: "Dai Stablecoin (Sepolia)",
    address: "0x776b6fC2Ed15D6BB5fC32E0c89de68683118c62A",
    isNative: false,
    isWrappedNative: false,
    decimals: 18,
    logo: daiLogo,      // <— ora usa il tuo PNG
  },

  WBTC: {
    symbol: "WBTC",
    name: "Wrapped Bitcoin (Sepolia)",
    address: "0x92f3b59A79BFF5Dc60C0D59ea13a44d082B2bDFC",
    isNative: false,
    isWrappedNative: false,
    decimals: 8,
    logo: wbtcLogo,     // <— idem
  },
};

// Token che compaiono nel selettore dello swap
export const AVAILABLE_TOKENS = ["ETH", "WETH", "USDC", "DAI", "WBTC"];
