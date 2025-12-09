// src/config/tokenRegistry.js
// Registry centralizzato dei token supportati da CurrentX su Sepolia.

import ethLogo from "../assets/tokens/eth.png";
import wethLogo from "../assets/tokens/weth.png";
import usdcLogo from "../assets/tokens/usdc.png";
import wbtcLogo from "../assets/tokens/wbtc.png";

export const TOKENS = {
  ETH: {
    symbol: "ETH",
    name: "Ethereum",
    address: null,          // nativo
    isNative: true,
    isWrappedNative: false,
    decimals: 18,
    logo: ethLogo,
  },

  WETH: {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14", // WETH Sepolia
    isNative: false,
    isWrappedNative: true,
    decimals: 18,
    logo: wethLogo,
  },

  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // USDC Sepolia
    isNative: false,
    isWrappedNative: false,
    decimals: 6,
    logo: usdcLogo,
  },

  WBTC: {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    // ⚠ se usi un altro contratto WBTC, cambia solo address + decimals
    address: "0x92f3b59a79bff5dc60c0d59ea13a44d082b2bdfc",
    isNative: false,
    isWrappedNative: false,
    decimals: 8,
    logo: wbtcLogo,
  },
};

export const AVAILABLE_TOKENS = Object.keys(TOKENS);

export function getToken(symbol) {
  return TOKENS[symbol];
}
