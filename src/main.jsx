import React from "react";
import ReactDOM from "react-dom/client";
import { inject } from "@vercel/analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { WidgetThemeProvider } from "@avon_xyz/widget";
import App from "./App";
import WhitelistPage from "./features/whitelist/WhitelistPage";
import { getActiveNetworkConfig } from "./shared/config/networks";
import "./index.css";
import "@avon_xyz/widget/styles.css";

// Only enable analytics in production to avoid dev warnings.
if (import.meta.env.MODE === "production") {
  inject();
}

const path = (window?.location?.pathname || "").toLowerCase();
const isWhitelistPage = path.includes("whitelist");

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
const wagmiConfig = createConfig({
  chains: [megaethChain],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [megaethChain.id]: http(rpcUrls[0] || fallbackRpc),
  },
  ssr: false,
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WidgetThemeProvider>
          {isWhitelistPage ? <WhitelistPage /> : <App />}
        </WidgetThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);
