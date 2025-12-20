// src/config/tokens.js
import daiLogo from "../tokens/dai.png";
import ethLogo from "../tokens/eth.png";
import tetherLogo from "../tokens/tether.png";
import usdcLogo from "../tokens/usdc.png";
import wbtcLogo from "../tokens/wbtc.png";
import wethLogo from "../tokens/weth.png";
import currentxLogo from "../assets/currentx.png";
import {
  CRX_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  WBTC_ADDRESS,
  WETH_ADDRESS,
} from "./addresses";

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
