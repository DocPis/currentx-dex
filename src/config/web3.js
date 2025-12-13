// src/config/web3.js
import { BrowserProvider, Contract, formatUnits } from "ethers";
import daiLogo from "../tokens/dai.png";
import ethLogo from "../tokens/eth.png";
import usdcLogo from "../tokens/usdc.png";
import wbtcLogo from "../tokens/wbtc.png";
import wethLogo from "../tokens/weth.png";

export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";

// Addresses (lowercase to avoid checksum issues)
export const WETH_ADDRESS =
  "0xfff9976782d46cc05630d1f6ebab18b2324d6b14";
export const USDC_ADDRESS =
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
// Fixed WETH/USDC pair on Sepolia (provided by user)
export const WETH_USDC_PAIR_ADDRESS =
  "0x72e46e15ef83c896de44B1874B4AF7dDAB5b4F74";

// Uniswap V2 (Sepolia) - factory provided by the user
export const UNIV2_FACTORY_ADDRESS =
  "0xF62c03E08ada871A0bEb309762E260a7a6a880E6";

// Minimal ERC20 ABI
export const ERC20_ABI = [
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
];

export const WETH_ABI = [
  ...ERC20_ABI,
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
];

// Minimal Uniswap V2 ABI
export const UNIV2_FACTORY_ABI = [
  {
    inputs: [
      { internalType: "address", name: "tokenA", type: "address" },
      { internalType: "address", name: "tokenB", type: "address" },
    ],
    name: "getPair",
    outputs: [{ internalType: "address", name: "pair", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];

export const UNIV2_PAIR_ABI = [
  {
    inputs: [],
    name: "getReserves",
    outputs: [
      { internalType: "uint112", name: "_reserve0", type: "uint112" },
      { internalType: "uint112", name: "_reserve1", type: "uint112" },
      { internalType: "uint32", name: "_blockTimestampLast", type: "uint32" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token0",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token1",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "to", type: "address" }],
    name: "mint",
    outputs: [{ internalType: "uint256", name: "liquidity", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "to", type: "address" }],
    name: "burn",
    outputs: [
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amount0Out", type: "uint256" },
      { internalType: "uint256", name: "amount1Out", type: "uint256" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "bytes", name: "data", type: "bytes" },
    ],
    name: "swap",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

// Registry dei token che usiamo nello swap
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
  USDC: {
    symbol: "USDC",
    name: "USD Coin (test)",
    address: USDC_ADDRESS,
    decimals: 6,
    logo: usdcLogo,
  },
  DAI: {
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0x3e622317f8c93f7328350cf0b56d9ed4c620c5d6",
    decimals: 18,
    logo: daiLogo,
  },
  WBTC: {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    address: null,
    decimals: 8,
    logo: wbtcLogo,
  },
};

export function getInjectedEthereum() {
  if (typeof window === "undefined") return null;
  const { ethereum } = window;
  if (!ethereum) return null;
  if (Array.isArray(ethereum.providers) && ethereum.providers.length) {
    const metamask = ethereum.providers.find((p) => p.isMetaMask);
    return metamask || ethereum.providers[0];
  }
  return ethereum;
}

export async function getProvider() {
  const eth = getInjectedEthereum();
  if (!eth) {
    throw new Error(
      "No wallet found. On mobile, open the site in the MetaMask in-app browser or another injected wallet."
    );
  }
  return new BrowserProvider(eth);
}

export async function getErc20(address, provider) {
  return new Contract(address, ERC20_ABI, provider);
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function getAmountOut(amountIn, reserveIn, reserveOut) {
  const amountInWithFee = (amountIn * 997n) / 1000n;
  return (
    (amountInWithFee * reserveOut) /
    (reserveIn * 1000n + amountInWithFee)
  );
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

// Calcola una quote Uniswap V2 (getAmountsOut) per un path
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

    const tokenInIs0 =
      token0.toLowerCase() === tokenIn.toLowerCase();
    const reserveIn = tokenInIs0 ? reserve0 : reserve1;
    const reserveOut = tokenInIs0 ? reserve1 : reserve0;

    if (reserveIn === 0n || reserveOut === 0n) {
      throw new Error("Pool has no liquidity");
    }

    amount = getAmountOut(amount, reserveIn, reserveOut);
  }

  return amount;
}

function findTokenMeta(address) {
  if (!address) return null;
  const lower = address.toLowerCase();
  return Object.values(TOKENS).find(
    (t) => t.address && t.address.toLowerCase() === lower
  );
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
    priceImpactPct,
  };
}

export async function getV2PairReserves(provider, tokenA, tokenB) {
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

  const pairAddress = isWethUsdc
    ? WETH_USDC_PAIR_ADDRESS
    : await factory.getPair(tokenA, tokenB);
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
