// src/utils/getBalances.js

import { BrowserProvider, Contract, formatEther, formatUnits } from "ethers";
import { TOKENS } from "../config/tokenRegistry";
import { ERC20_ABI } from "../config/uniswapSepolia";

/**
 * Ritorna un oggetto con tutti i balance:
 * {
 *   ETH: 0.1234,
 *   WETH: 1.2345,
 *   USDC: 14075.9,
 *   WBTC: 0.0012,
 *   ...
 * }
 */
export async function getAllBalances(address) {
  if (!window.ethereum || !address) return {};

  const provider = new BrowserProvider(window.ethereum);
  const balances = {};

  // ETH nativo
  try {
    const ethRaw = await provider.getBalance(address);
    balances["ETH"] = parseFloat(formatEther(ethRaw));
  } catch (e) {
    console.error("Error loading ETH balance:", e);
    balances["ETH"] = 0;
  }

  // Tutti i token ERC20 nel registry (WETH, USDC, WBTC, altri futuri)
  for (const symbol of Object.keys(TOKENS)) {
    const token = TOKENS[symbol];

    if (token.isNative) continue; // saltiamo ETH

    try {
      const c = new Contract(token.address, ERC20_ABI, provider);
      const raw = await c.balanceOf(address);
      balances[symbol] = parseFloat(
        formatUnits(raw, token.decimals || 18)
      );
    } catch (e) {
      console.error(`Error loading balance for ${symbol}:`, e);
      balances[symbol] = 0;
    }
  }

  return balances;
}
