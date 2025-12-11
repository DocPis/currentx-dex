// src/utils/tokenRegistry.js

// Registry centrale dei token usati da Swap + Liquidity.
// Qui usiamo esattamente i token della tua pool su Sepolia.

export const TOKEN_REGISTRY = [
  {
    symbol: "WETH",
    name: "Wrapped Ether (Test)",
    address: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14", // tokenA della tx
    decimals: 18,
    logo: "/assets/tokens/weth.svg",
  },
  {
    symbol: "USDC",
    name: "USD Coin (Test)",
    address: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238", // tokenB della tx
    decimals: 6,
    logo: "/assets/tokens/usdc.svg",
  },
];
