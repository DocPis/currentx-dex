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
    name: "USD Coin",
    address: "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8",
    decimals: 6,
    logoURI: "/assets/tokens/usdc.png",
},
];
