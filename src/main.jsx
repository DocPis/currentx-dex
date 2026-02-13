import React from "react";
import ReactDOM from "react-dom/client";
import { inject } from "@vercel/analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { arbitrum, base, bsc, mainnet, optimism, polygon } from "viem/chains";
import { WidgetThemeProvider } from "@avon_xyz/widget";
import App from "./App";
import { getActiveNetworkConfig } from "./shared/config/networks";
import "./index.css";

// Only enable analytics in production to avoid dev warnings.
if (import.meta.env.MODE === "production") {
  inject();
}


const queryClient = new QueryClient();
const activeNetwork = getActiveNetworkConfig();
const chainId = Number.parseInt(activeNetwork?.chainIdHex || "0x10e6", 16) || 4326;
const rpcUrls = (activeNetwork?.rpcUrls || []).filter(Boolean);
const fallbackRpc = "https://mainnet.megaeth.com/rpc";
const megaethChain = defineChain({
  id: chainId,
  name: activeNetwork?.name || "MegaETH",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: rpcUrls.length ? rpcUrls : [fallbackRpc] },
    public: { http: rpcUrls.length ? rpcUrls : [fallbackRpc] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: activeNetwork?.explorer || "https://megaeth.blockscout.com",
    },
  },
});
const walletChains = [megaethChain, mainnet, base, arbitrum, optimism, bsc, polygon];
const transports = Object.fromEntries(
  walletChains.map((chain) => [
    chain.id,
    chain.id === megaethChain.id ? http(rpcUrls[0] || fallbackRpc) : http(),
  ])
);

const resolvePreferredInjectedProvider = (windowObj) => {
  if (windowObj?.__cxActiveInjectedProvider) {
    return windowObj.__cxActiveInjectedProvider;
  }
  if (windowObj?.ethereum?.selectedProvider) {
    return windowObj.ethereum.selectedProvider;
  }
  if (Array.isArray(windowObj?.ethereum?.providers) && windowObj.ethereum.providers.length) {
    return windowObj.ethereum.providers[0];
  }
  return windowObj?.ethereum;
};

const wagmiConfig = createConfig({
  chains: walletChains,
  connectors: [
    injected({
      shimDisconnect: true,
      target: {
        id: "currentxInjected",
        name: "CurrentX Injected",
        provider: (windowObj) => resolvePreferredInjectedProvider(windowObj),
      },
    }),
  ],
  transports,
  ssr: false,
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WidgetThemeProvider>
          <App />
        </WidgetThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);
