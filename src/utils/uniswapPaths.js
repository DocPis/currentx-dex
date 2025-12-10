// src/utils/uniswapPaths.js

import {
  WETH_ADDRESS,
  USDC_ADDRESS,
} from "../config/uniswapSepolia";

import { TOKENS } from "../config/tokenRegistry";

/**
 * Restituisce l'address corretto per uno symbol usato nei path Uniswap.
 */
export function addrForPath(symbol) {
  if (symbol === "ETH" || symbol === "WETH") return WETH_ADDRESS;
  if (symbol === "USDC") return USDC_ADDRESS;
  if (symbol === "DAI") return TOKENS.DAI.address;
  if (symbol === "WBTC") return TOKENS.WBTC.address;
  throw new Error(`Unsupported token symbol in path: ${symbol}`);
}

/**
 * Costruisce il path per Uniswap V2 su Sepolia in base alla coppia.
 * Usa WETH come hop intermedio dove serve.
 */
export function buildPath(tokenIn, tokenOut) {
  if (tokenIn === tokenOut) {
    throw new Error("Cannot swap the same token.");
  }

  const inIsEthish = tokenIn === "ETH" || tokenIn === "WETH";
  const outIsEthish = tokenOut === "ETH" || tokenOut === "WETH";

  // ETH/WETH <-> USDC
  if (inIsEthish && tokenOut === "USDC") {
    return [addrForPath("ETH"), addrForPath("USDC")];
  }
  if (tokenIn === "USDC" && outIsEthish) {
    return [addrForPath("USDC"), addrForPath("ETH")];
  }

  // ETH/WETH <-> DAI
  if (inIsEthish && tokenOut === "DAI") {
    return [addrForPath("ETH"), addrForPath("DAI")];
  }
  if (tokenIn === "DAI" && outIsEthish) {
    return [addrForPath("DAI"), addrForPath("ETH")];
  }

  // ETH/WETH <-> WBTC
  if (inIsEthish && tokenOut === "WBTC") {
    return [addrForPath("ETH"), addrForPath("WBTC")];
  }
  if (tokenIn === "WBTC" && outIsEthish) {
    return [addrForPath("WBTC"), addrForPath("ETH")];
  }

  // USDC <-> WBTC via WETH
  if (tokenIn === "USDC" && tokenOut === "WBTC") {
    return [addrForPath("USDC"), addrForPath("ETH"), addrForPath("WBTC")];
  }
  if (tokenIn === "WBTC" && tokenOut === "USDC") {
    return [addrForPath("WBTC"), addrForPath("ETH"), addrForPath("USDC")];
  }

  // DAI <-> USDC via WETH
  if (tokenIn === "DAI" && tokenOut === "USDC") {
    return [addrForPath("DAI"), addrForPath("ETH"), addrForPath("USDC")];
  }
  if (tokenIn === "USDC" && tokenOut === "DAI") {
    return [addrForPath("USDC"), addrForPath("ETH"), addrForPath("DAI")];
  }

  // DAI <-> WBTC via WETH
  if (tokenIn === "DAI" && tokenOut === "WBTC") {
    return [addrForPath("DAI"), addrForPath("ETH"), addrForPath("WBTC")];
  }
  if (tokenIn === "WBTC" && tokenOut === "DAI") {
    return [addrForPath("WBTC"), addrForPath("ETH"), addrForPath("DAI")];
  }

  // fallback generico via WETH
  return [addrForPath(tokenIn), addrForPath("ETH"), addrForPath(tokenOut)];
}
