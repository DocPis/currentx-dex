// src/config/uniswapSepolia.js

// Chain
export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111

// Uniswap V2 official on Ethereum Sepolia
export const UNISWAP_V2_ROUTER =
  "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";
export const UNISWAP_V2_FACTORY =
  "0xF62c03E08ada871A0bEb309762E260a7a6a880E6";

// Tokens
export const WETH_ADDRESS = "0xfff9976782d46cc05630d1f6ebab18b2324d6b14";
export const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

export const WETH_DECIMALS = 18;
export const USDC_DECIMALS = 6;

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

// Minimal ERC20 ABI for USDC
export const ERC20_ABI = [
  "function approve(address spender, uint256 value) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];
