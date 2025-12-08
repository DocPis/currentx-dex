// src/config/uniswapSepolia.js
import { Contract } from "ethers";

// Chain
export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111

// Uniswap V2 official on Ethereum Sepolia
export const UNISWAP_V2_ROUTER =
  "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";
export const UNISWAP_V2_FACTORY =
  "0xF62c03E08ada871A0bEb309762E260a7a6a880E6";

// Tokens (addresses fissi, decimali li rileviamo a runtime)
export const WETH_ADDRESS = "0xfff9976782d46cc05630d1f6ebab18b2324d6b14";
export const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

// Default decimals (usati SOLO se la call .decimals() fallisce)
export const WETH_DECIMALS = 18;
export const USDC_DECIMALS = 18; // il tuo USDC mock è 18, non 6

// Router ABI
export const UNISWAP_V2_ROUTER_ABI = [
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
];

// Factory ABI
export const UNISWAP_V2_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

// Pair ABI
export const UNISWAP_V2_PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

// ERC20 ABI (usato sia per balance/allowance/approve che per decimals)
export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
];

// Base token list: qui aggiungi altri token in futuro
const BASE_TOKENS = [
  {
    symbol: "ETH",
    address: WETH_ADDRESS, // wrapped native
    isNative: true,
    defaultDecimals: WETH_DECIMALS,
  },
  {
    symbol: "USDC",
    address: USDC_ADDRESS,
    isNative: false,
    defaultDecimals: USDC_DECIMALS,
  },
];

// 🔍 Carica registry token leggendo i decimals dai contratti
export async function loadTokenRegistry(provider) {
  const registry = {};

  for (const t of BASE_TOKENS) {
    let decimals = t.defaultDecimals;

    if (t.address) {
      try {
        const c = new Contract(t.address, ERC20_ABI, provider);
        const d = await c.decimals();
        decimals = Number(d);
      } catch (e) {
        console.warn(`Using default decimals for ${t.symbol}`, e);
      }
    }

    registry[t.symbol] = { ...t, decimals };
  }

  return registry;
}
