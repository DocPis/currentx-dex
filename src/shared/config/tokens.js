// src/shared/config/tokens.js
import ethLogo from "../../tokens/eth.png";
import usdcLogo from "../../tokens/usdc.png";
import usdmLogo from "../../tokens/usdm.png";
import cusdLogo from "../../tokens/cusd.png";
import wethLogo from "../../tokens/weth.png";
import currentxLogo from "../../assets/currentx.png";
import megaLogo from "../../tokens/megaeth.png";
import xbtcLogo from "../../tokens/xbtc.png";
import wusdLogo from "../../tokens/wusd.png";
import wusdcLogo from "../../tokens/wusdc.png";
// placeholder for xBTC logo; wire later
// import xbtcLogo from "../../tokens/xbtc.png";
import {
  CRX_ADDRESS,
  XBTC_ADDRESS,
  USDC_ADDRESS,
  CUSD_ADDRESS,
  USDM_ADDRESS,
  WETH_ADDRESS,
  MEGA_TOKEN_ADDRESS,
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
    name: "USD Coin",
    address: USDC_ADDRESS,
    decimals: 6,
    logo: usdcLogo,
  },
  CUSD: {
    symbol: "CUSD",
    displaySymbol: "cUSD",
    name: "Cap USD",
    address: CUSD_ADDRESS,
    decimals: 18,
    logo: cusdLogo,
  },
  USDm: {
    symbol: "USDm",
    name: "MegaUSD",
    address: USDM_ADDRESS,
    decimals: 18,
    logo: usdmLogo,
  },
  MEGA: {
    symbol: "MEGA",
    name: "Mega Token",
    address: MEGA_TOKEN_ADDRESS,
    decimals: 18,
    logo: megaLogo,
  },
  XBTC: {
    symbol: "XBTC",
    displaySymbol: "xBTC",
    name: "xBitcoin",
    address: XBTC_ADDRESS,
    decimals: 18,
    logo: xbtcLogo,
  },
  WUSD: {
    symbol: "WUSD",
    displaySymbol: "wUSD",
    name: "Wrapped USD",
    address: null, // set per network via env
    decimals: 18,
    logo: wusdLogo,
  },
  WUSDC: {
    symbol: "WUSDC",
    displaySymbol: "wUSDC",
    name: "Wrapped USDC",
    address: null, // set per network via env
    decimals: 6,
    logo: wusdcLogo,
  },
};
