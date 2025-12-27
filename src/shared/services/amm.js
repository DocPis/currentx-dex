// src/services/amm.js
import { Contract, formatUnits } from "ethers";
import { UNIV2_FACTORY_ABI, UNIV2_PAIR_ABI } from "../config/abis";
import {
  UNIV2_FACTORY_ADDRESS,
  USDC_ADDRESS,
  WETH_ADDRESS,
  WETH_USDC_PAIR_ADDRESS,
} from "../config/addresses";
import { TOKENS } from "../config/tokens";
import { getRegisteredCustomTokens } from "../config/customTokens";

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

    const tokenInLower = tokenIn?.toLowerCase?.();
    const tokenOutLower = tokenOut?.toLowerCase?.();
    const isWethUsdc =
      tokenInLower &&
      tokenOutLower &&
      [WETH_ADDRESS.toLowerCase(), USDC_ADDRESS.toLowerCase()].includes(
        tokenInLower
      ) &&
      [WETH_ADDRESS.toLowerCase(), USDC_ADDRESS.toLowerCase()].includes(
        tokenOutLower
      );

    const pairAddress = isWethUsdc
      ? WETH_USDC_PAIR_ADDRESS
      : await factory.getPair(tokenIn, tokenOut);
    if (!pairAddress || pairAddress === ZERO_ADDRESS) {
      throw new Error("Pair not found on Sepolia");
    }

    const pair = new Contract(pairAddress, UNIV2_PAIR_ABI, provider);
    const [reserve0, reserve1] = await pair.getReserves();
    const token0 = await pair.token0();

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

// Quote + meta (single hop) per price impact e swap
export async function getV2QuoteWithMeta(provider, amountIn, tokenIn, tokenOut) {
  if (!provider) throw new Error("Missing provider");

  const factory = new Contract(
    UNIV2_FACTORY_ADDRESS,
    UNIV2_FACTORY_ABI,
    provider
  );

  const tokenInLower = tokenIn?.toLowerCase?.();
  const tokenOutLower = tokenOut?.toLowerCase?.();
  const isWethUsdc =
    tokenInLower &&
    tokenOutLower &&
    [WETH_ADDRESS.toLowerCase(), USDC_ADDRESS.toLowerCase()].includes(
      tokenInLower
    ) &&
    [WETH_ADDRESS.toLowerCase(), USDC_ADDRESS.toLowerCase()].includes(
      tokenOutLower
    );

  const pairAddress = isWethUsdc
    ? WETH_USDC_PAIR_ADDRESS
    : await factory.getPair(tokenIn, tokenOut);
  if (!pairAddress || pairAddress === ZERO_ADDRESS) {
    throw new Error("Pair not found on Sepolia");
  }

  const pair = new Contract(pairAddress, UNIV2_PAIR_ABI, provider);
  const [reserve0, reserve1] = await pair.getReserves();
  const token0 = await pair.token0();
  const token1 = await pair.token1();

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

  const tokenALower = tokenA?.toLowerCase?.();
  const tokenBLower = tokenB?.toLowerCase?.();
  const isWethUsdc =
    tokenALower &&
    tokenBLower &&
    [WETH_ADDRESS.toLowerCase(), USDC_ADDRESS.toLowerCase()].includes(
      tokenALower
    ) &&
    [WETH_ADDRESS.toLowerCase(), USDC_ADDRESS.toLowerCase()].includes(
      tokenBLower
    );

  const pairAddress =
    pairAddressOverride ||
    (isWethUsdc
      ? WETH_USDC_PAIR_ADDRESS
      : await factory.getPair(tokenA, tokenB));
  if (!pairAddress || pairAddress === ZERO_ADDRESS) {
    throw new Error("Pair not found on Sepolia");
  }

  const pair = new Contract(pairAddress, UNIV2_PAIR_ABI, provider);
  const [reserve0, reserve1] = await pair.getReserves();
  const token0 = await pair.token0();
  const token1 = await pair.token1();

  return {
    pairAddress,
    reserve0,
    reserve1,
    token0,
    token1,
  };
}
