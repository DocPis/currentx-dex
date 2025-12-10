// src/utils/tokenRegistry.js

// Registry centrale dei token usati da Swap + Liquidity + Balances

export const TOKEN_REGISTRY = [
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    // WETH Sepolia (lowercase)
    address: "0xdd13e55209fd76afe204dbda4007c227904f0a81",
    decimals: 18,
    logo: "/assets/tokens/weth.svg",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    // USDC Sepolia (lowercase)
    address: "0x1c7d4b196cb0c7c4d6ae731ffdf8c9cd39f8d71a",
    decimals: 6,
    logo: "/assets/tokens/usdc.svg",
  },
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    // WBTC Sepolia (lowercase)
    address: "0x15e0a221c673eee703f3a35e52747b3032f23366",
    decimals: 8,
    logo: "/assets/tokens/wbtc.svg",
  },
  {
    symbol: "DAI",
    name: "Dai",
    // DAI Sepolia (lowercase)
    address: "0x7ea2be2df7ba6e54b1aa62ddb07b2bf14d0be1b5",
    decimals: 18,
    logo: "/assets/tokens/dai.svg",
  },
];
