import { TOKENS } from "../config/tokenRegistry";
import { WETH_ADDRESS, USDC_ADDRESS } from "../config/uniswapSepolia";

export function buildPath(tokenIn, tokenOut) {
  if (tokenIn === tokenOut) throw new Error("Cannot swap identical tokens.");

  const tIn = TOKENS[tokenIn];
  const tOut = TOKENS[tokenOut];

  // ETH <-> token
  if (tokenIn === "ETH") return [WETH_ADDRESS, tOut.address];
  if (tokenOut === "ETH") return [tIn.address, WETH_ADDRESS];

  // Direct pair?
  return [tIn.address, tOut.address];
}
