// src/shared/config/tokens.js
import ethLogo from "../../tokens/eth.png";
import usdcLogo from "../../tokens/usdc.png";
import wethLogo from "../../tokens/weth.png";
import currentxLogo from "../../assets/currentx.png";
import {
  CRX_ADDRESS,
  USDC_ADDRESS,
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
};
