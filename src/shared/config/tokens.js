// src/shared/config/tokens.js
import ethLogo from "../../tokens/eth.png";
import usdcLogo from "../../tokens/usdc.png";
import usdmLogo from "../../tokens/usdm.png";
import cusdLogo from "../../tokens/cusd.png";
import wethLogo from "../../tokens/weth.png";
import currentxLogo from "../../assets/currentx.png";
import megaLogo from "../../tokens/megaeth.png";
import {
  CRX_ADDRESS,
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
};
