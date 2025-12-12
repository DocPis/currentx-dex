// src/config/web3.js
import { BrowserProvider, Contract } from "ethers";
import daiLogo from "../tokens/dai.png";
import ethLogo from "../tokens/eth.png";
import usdcLogo from "../tokens/usdc.png";
import wbtcLogo from "../tokens/wbtc.png";
import wethLogo from "../tokens/weth.png";

export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";

// Indirizzi (in lowercase per evitare errori di checksum)
export const WETH_ADDRESS =
  "0xfff9976782d46cc05630d1f6ebab18b2324d6b14";
export const USDC_ADDRESS =
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";

// Uniswap V2 (Sepolia) - factory fornita dall'utente
export const UNIV2_FACTORY_ADDRESS =
  "0xF62c03E08ada871A0bEb309762E260a7a6a880E6";

// Semplice ERC20 ABI
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

// ABI minimale Uniswap V2
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
];

// Registry dei token che usiamo nello swap
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
    address: null,
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

export async function getProvider() {
  if (!window.ethereum) throw new Error("No wallet found");
  return new BrowserProvider(window.ethereum);
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

    const pairAddress = await factory.getPair(tokenIn, tokenOut);
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

export async function getV2PairReserves(provider, tokenA, tokenB) {
  if (!provider) throw new Error("Missing provider");

  const factory = new Contract(
    UNIV2_FACTORY_ADDRESS,
    UNIV2_FACTORY_ABI,
    provider
  );

  const pairAddress = await factory.getPair(tokenA, tokenB);
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
