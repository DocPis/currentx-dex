import ethLogo from "../assets/tokens/eth.png";
import usdcLogo from "../assets/tokens/usdc.png";

export const TOKENS = {
  ETH: {
    symbol: "ETH",
    address: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
    decimals: 18,
    isNative: true,
    logo: ethLogo,
  },
  USDC: {
    symbol: "USDC",
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    decimals: 18, // il tuo mock USDC su Sepolia
    isNative: false,
    logo: usdcLogo,
  },
};
