// src/shared/config/tokens.js
import ethLogo from "../../tokens/eth.svg";
import tetherLogo from "../../tokens/tether.png";
import usdmLogo from "../../tokens/usdm.png";
import cusdLogo from "../../tokens/cusd.svg";
import wethLogo from "../../tokens/weth.svg";
import stcusdLogo from "../../tokens/stcusd.png";
import susdeLogo from "../../tokens/susde.svg";
import usdeLogo from "../../tokens/usde.svg";
import ezethLogo from "../../tokens/ezeth.svg";
import wstethLogo from "../../tokens/wsteth.svg";
import currentxLogo from "../../assets/currentx.png";
import megaLogo from "../../tokens/megaeth.png";
import xbtcLogo from "../../tokens/xbtc.png";
import btcbLogo from "../../tokens/btcb.svg";
import wusdLogo from "../../tokens/wusd.png";
import wusdcLogo from "../../tokens/wusdc.png";
import krownCreditsLogo from "../../tokens/krowncredits.png";
import defaultTokenLogo from "../../tokens/token-placeholder megaeth.svg";
// placeholder for xBTC logo; wire later
// import xbtcLogo from "../../tokens/xbtc.png";
import {
  CRX_ADDRESS,
  XBTC_ADDRESS,
  BTCB_ADDRESS,
  USDT0_ADDRESS,
  CUSD_ADDRESS,
  STCUSD_ADDRESS,
  SUSDE_ADDRESS,
  USDE_ADDRESS,
  EZETH_ADDRESS,
  WSTETH_ADDRESS,
  USDM_ADDRESS,
  WETH_ADDRESS,
  MEGA_TOKEN_ADDRESS,
} from "./addresses";

export const applyTokenAliases = (registry = {}) => {
  if (!registry || typeof registry !== "object") return registry;
  Object.entries(registry).forEach(([, token]) => {
    if (!token || typeof token !== "object") return;
    const aliases = [token.symbol, token.displaySymbol].filter(Boolean);
    aliases.forEach((alias) => {
      if (typeof alias !== "string") return;
      const key = alias.trim();
      if (!key) return;
      if (Object.prototype.hasOwnProperty.call(registry, key)) return;
      try {
        Object.defineProperty(registry, key, {
          value: token,
          enumerable: false,
          configurable: true,
        });
      } catch {
        // ignore define errors
      }
    });
  });
  return registry;
};

const RAW_TOKENS = {
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
    decimals: 18,
    logo: currentxLogo,
  },
  USDT0: {
    symbol: "USDT0",
    name: "Tether Stablecoin",
    address: USDT0_ADDRESS,
    decimals: 6,
    logo: tetherLogo,
    description: "Tether Stablecoin on MegaETH",
  },
  CUSD: {
    symbol: "CUSD",
    displaySymbol: "cUSD",
    name: "Cap USD",
    address: CUSD_ADDRESS,
    decimals: 18,
    logo: cusdLogo,
  },
  STCUSD: {
    symbol: "STCUSD",
    name: "Staked Cap USD",
    address: STCUSD_ADDRESS,
    decimals: 18,
    logo: stcusdLogo,
  },
  sUSDe: {
    symbol: "sUSDe",
    name: "Staked USDe",
    address: SUSDE_ADDRESS,
    decimals: 18,
    logo: susdeLogo,
    hidden: true,
    description: "Ethena Staked USDe on MegaETH",
    sources: {
      ethereum: {
        address: "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497",
        bridge: "0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2",
      },
      megaeth: {
        address: "0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2",
      },
    },
  },
  USDe: {
    symbol: "USDe",
    name: "USDe",
    address: USDE_ADDRESS,
    decimals: 18,
    logo: usdeLogo,
  },
  ezETH: {
    symbol: "ezETH",
    name: "Renzo Restaked ETH",
    address: EZETH_ADDRESS,
    decimals: 18,
    logo: ezethLogo,
    hidden: true,
    description: "Renzo Restaked ETH on MegaETH",
    sources: {
      ethereum: {
        address: "0xbf5495Efe5DB9ce00f80364C8B423567e58d2110",
        bridge: "0xC8140dA31E6bCa19b287cC35531c2212763C2059",
      },
      megaeth: {
        address: "0x09601A65e7de7BC8A19813D263dD9E98bFdC3c57",
      },
    },
  },
  wstETH: {
    symbol: "wstETH",
    name: "Wrapped liquid staked Ether 2.0",
    address: WSTETH_ADDRESS,
    decimals: 18,
    logo: wstethLogo,
    hidden: true,
    description: "Wrapped liquid staked Ether 2.0",
    website: "https://lido.fi",
    sources: {
      ethereum: {
        address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
      },
      megaeth: {
        address: "0x601aC63637933D88285A025C685AC4e9a92a98dA",
        bridge: "0x1ba9bE96A5c21dcdB9D22bEC3f00abCb6336fd65",
      },
    },
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
  BTCB: {
    symbol: "BTC.b",
    name: "Bitcoin",
    address: BTCB_ADDRESS,
    decimals: 8,
    logo: btcbLogo,
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
  CROWN: {
    symbol: "CROWN",
    name: "Crown",
    address: "0xf7d2F0d0b0517CBDbf87C86910ce10FaAab3589D",
    decimals: 18,
    logo: krownCreditsLogo,
  },
};

const buildTokens = () => {
  const out = {};
  Object.entries(RAW_TOKENS).forEach(([key, token]) => {
    if (!token) return;
    if (token.hidden) return;
    // Always keep native ETH/WETH entries for UX.
    if (key === "ETH" || key === "WETH") {
      out[key] = token;
      return;
    }
    // Only include tokens that have an address on the active network.
    if (token.address) {
      out[key] = token;
    }
  });
  return applyTokenAliases(out);
};

// Token registry used across swaps/liquidity; filtered per-network by presence of an address.
export const TOKENS = buildTokens();
export const DEFAULT_TOKEN_LOGO = defaultTokenLogo;
