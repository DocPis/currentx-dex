// src/services/amm.js
import { Contract, Interface, formatUnits } from "ethers";
import { UNIV2_FACTORY_ABI, UNIV2_PAIR_ABI } from "../config/abis";
import {
  UNIV2_FACTORY_ADDRESS,
  WETH_ADDRESS,
} from "../config/addresses";
import { TOKENS } from "../config/tokens";
import { getRegisteredCustomTokens } from "../config/customTokens";
import { getReadOnlyProvider } from "../config/web3";
import { multicall, hasMulticall } from "./multicall";

const pairInterface = new Interface(UNIV2_PAIR_ABI);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function getAmountOut(amountIn, reserveIn, reserveOut) {
  const amountInWithFee = amountIn * 997n;
  return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
}

function normalize(amount, decimals) {
  return Number(formatUnits(amount, decimals));
}

export function computePriceImpact(
  amountIn,
  amountOut,
  reserveIn,
  reserveOut,
  decimalsIn,
  decimalsOut
) {
  if (
    !reserveIn ||
    !reserveOut ||
    amountIn <= 0n ||
    amountOut <= 0n ||
    decimalsIn === undefined ||
    decimalsOut === undefined
  ) {
    return 0;
  }

  const midPrice =
    normalize(reserveOut, decimalsOut) / normalize(reserveIn, decimalsIn);
  const execPrice =
    normalize(amountOut, decimalsOut) / normalize(amountIn, decimalsIn);
  if (!midPrice || !execPrice || !Number.isFinite(midPrice)) return 0;
  const impact = ((midPrice - execPrice) / midPrice) * 100;
  return Math.max(0, impact);
}

function findTokenMeta(address) {
  if (!address) return null;
  const lower = address.toLowerCase();
  const registered = getRegisteredCustomTokens();
  const customMatch = Object.values(registered || {}).find(
    (t) => t.address && t.address.toLowerCase() === lower
  );
  if (customMatch) return customMatch;
  return Object.values(TOKENS).find(
    (t) => t.address && t.address.toLowerCase() === lower
  );
}

export async function getV2Quote(provider, amountIn, path) {
  if (!provider) throw new Error("Missing provider");
  if (!Array.isArray(path) || path.length < 2)
    throw new Error("Invalid path");

  const factory = new Contract(
    UNIV2_FACTORY_ADDRESS,
    UNIV2_FACTORY_ABI,
    provider
  );

  let amount = amountIn;

  for (let i = 0; i < path.length - 1; i += 1) {
    const tokenIn = path[i];
    const tokenOut = path[i + 1];

    const pairAddress = await factory.getPair(tokenIn, tokenOut);
    if (!pairAddress || pairAddress === ZERO_ADDRESS) {
      throw new Error("Pair not found on MegaETH (not deployed yet)");
    }

    const pair = new Contract(pairAddress, UNIV2_PAIR_ABI, provider);
    let reserve0;
    let reserve1;
    let token0;
    try {
      [reserve0, reserve1] = await pair.getReserves();
      token0 = await pair.token0();
    } catch {
      throw new Error("Pair not found on MegaETH (not deployed yet)");
    }

    const tokenInIs0 = token0.toLowerCase() === tokenIn.toLowerCase();
    const reserveIn = tokenInIs0 ? reserve0 : reserve1;
    const reserveOut = tokenInIs0 ? reserve1 : reserve0;

    if (reserveIn === 0n || reserveOut === 0n) {
      throw new Error("Pool has no liquidity");
    }

    amount = getAmountOut(amount, reserveIn, reserveOut);
  }

  return amount;
}

// Quote + meta (single hop) for price impact and swaps
export async function getV2QuoteWithMeta(provider, amountIn, tokenIn, tokenOut) {
  if (!provider) throw new Error("Missing provider");

  const factory = new Contract(
    UNIV2_FACTORY_ADDRESS,
    UNIV2_FACTORY_ABI,
    provider
  );

  const pairAddress = await factory.getPair(tokenIn, tokenOut);
  if (!pairAddress || pairAddress === ZERO_ADDRESS) {
    throw new Error("Pair not found on MegaETH (not deployed yet)");
  }

  const pair = new Contract(pairAddress, UNIV2_PAIR_ABI, provider);
  let reserve0;
  let reserve1;
  let token0;
  let token1;
  try {
    [reserve0, reserve1] = await pair.getReserves();
    token0 = await pair.token0();
    token1 = await pair.token1();
  } catch {
    throw new Error("Pair not found on MegaETH (not deployed yet)");
  }

  const tokenInIs0 = token0.toLowerCase() === tokenIn.toLowerCase();
  const reserveIn = tokenInIs0 ? reserve0 : reserve1;
  const reserveOut = tokenInIs0 ? reserve1 : reserve0;

  if (reserveIn === 0n || reserveOut === 0n) {
    throw new Error("Pool has no liquidity");
  }

  const metaIn = findTokenMeta(tokenIn);
  const metaOut = findTokenMeta(tokenOut);
  const amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
  const priceImpactPct = computePriceImpact(
    amountIn,
    amountOut,
    reserveIn,
    reserveOut,
    metaIn?.decimals ?? 18,
    metaOut?.decimals ?? 18
  );

  return {
    amountOut,
    reserveIn,
    reserveOut,
    tokenInIs0,
    pairAddress,
    token0,
    token1,
    reserve0,
    reserve1,
    decimalsIn: metaIn?.decimals ?? 18,
    decimalsOut: metaOut?.decimals ?? 18,
    priceImpactPct,
  };
}

export async function getV2PairReserves(
  provider,
  tokenA,
  tokenB,
  pairAddressOverride
) {
  if (!provider) throw new Error("Missing provider");

  const factory = new Contract(
    UNIV2_FACTORY_ADDRESS,
    UNIV2_FACTORY_ABI,
    provider
  );

  const pairAddress =
    pairAddressOverride || (await factory.getPair(tokenA, tokenB));
  if (!pairAddress || pairAddress === ZERO_ADDRESS) {
    return null;
  }

  // Try multicall to grab token0/token1/reserves in one go (retry once with rotated RPC)
  const tryMulticall = async (prov) => {
    const calls = [
      { target: pairAddress, callData: pairInterface.encodeFunctionData("token0", []) },
      { target: pairAddress, callData: pairInterface.encodeFunctionData("token1", []) },
      { target: pairAddress, callData: pairInterface.encodeFunctionData("getReserves", []) },
    ];
    const res = await multicall(calls, prov);
    const dec = (idx, fn) =>
      res[idx]?.success
        ? pairInterface.decodeFunctionResult(fn, res[idx].returnData)
        : null;
    const token0 = dec(0, "token0")?.[0];
    const token1 = dec(1, "token1")?.[0];
    const reserves = dec(2, "getReserves");
    if (token0 && token1 && reserves) {
      const [reserve0, reserve1] = reserves;
      return { pairAddress, reserve0, reserve1, token0, token1 };
    }
    return null;
  };

  let canMc = await hasMulticall(provider).catch(() => false);
  if (canMc) {
    try {
      const res = await tryMulticall(provider);
      if (res) return res;
    } catch {
      // try rotate
    }
    try {
      const alt = getReadOnlyProvider(true, true);
      if (alt && (await hasMulticall(alt).catch(() => false))) {
        const res = await tryMulticall(alt);
        if (res) return res;
      }
    } catch {
      // fall through to direct reads
    }
  }

  const pair = new Contract(pairAddress, UNIV2_PAIR_ABI, provider);
  let reserve0;
  let reserve1;
  let token0;
  let token1;
  try {
    [reserve0, reserve1] = await pair.getReserves();
    token0 = await pair.token0();
    token1 = await pair.token1();
  } catch {
    return null;
  }

  return {
    pairAddress,
    reserve0,
    reserve1,
    token0,
    token1,
  };
}
