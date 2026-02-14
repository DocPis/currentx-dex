import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RelayKitProvider, SwapWidget } from "@relayprotocol/relay-kit-ui";
import { adaptViemWallet, convertViemChainToRelayChain } from "@relayprotocol/relay-sdk";
import "@relayprotocol/relay-kit-ui/styles.css";
import { useAccount, useConnect, useReconnect, useWalletClient } from "wagmi";
import { arbitrum, base, bsc, mainnet, optimism, polygon } from "viem/chains";
import { createWalletClient, custom, defineChain } from "viem";
import { getActiveNetworkConfig } from "../../shared/config/networks";
import { getInjectedEthereum } from "../../shared/config/web3";
import megaethLogo from "../../tokens/megaeth.png";
import relayLogo from "../../assets/social/relay.png";

const RELAY_SOURCE = "currentx.app";
const RELAY_SUPPORTED_WALLETS = ["evm"];
const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
const RELAY_OFFICIAL_URL = "https://relay.link";
const DISCORD_SUPPORT_URL = "https://discord.gg/hebSwdXwVv";
const DOCS_URL = "https://docs.currentx.app/";
const GENERIC_SWAP_ERROR =
  "Oops! Something went wrong while processing your transaction.";
const HOW_IT_WORKS_STEPS = [
  "Select asset and amount",
  "Confirm in your wallet",
  "Wait for completion",
  "Funds arrive on MegaETH",
];

const parseRelayErrorMessage = (rawError) => {
  if (!rawError) return "";
  let current = rawError;
  for (let i = 0; i < 2; i += 1) {
    if (typeof current !== "string") break;
    try {
      const parsed = JSON.parse(current);
      if (parsed && typeof parsed === "object") {
        current = parsed.message || parsed.error || current;
        continue;
      }
    } catch {
      // Keep raw value when payload is not JSON.
    }
    break;
  }
  return typeof current === "string" ? current : String(current);
};

const extractExecutionErrorMessage = (executionData) => {
  if (!executionData || typeof executionData !== "object") return "";

  const topLevelError = executionData?.errors?.find?.((entry) => entry?.message)?.message;
  if (topLevelError) return String(topLevelError);

  const steps = Array.isArray(executionData?.steps) ? executionData.steps : [];
  for (const step of steps) {
    if (step?.error) return String(step.error);
    const items = Array.isArray(step?.items) ? step.items : [];
    for (const item of items) {
      if (item?.error) return String(item.error);
      if (item?.errorData?.message) return String(item.errorData.message);
    }
  }

  return "";
};

const getBridgeErrorHint = (message) => {
  const lowered = String(message || "").toLowerCase();
  if (!lowered) return "";
  if (lowered.includes("insufficient funds")) {
    return "Not enough balance for amount + gas on the source chain.";
  }
  if (lowered.includes("switch") || lowered.includes("chain")) {
    return "Confirm the network switch in your wallet and retry.";
  }
  if (lowered.includes("reject") || lowered.includes("denied")) {
    return "The transaction was rejected in wallet.";
  }
  if (lowered.includes("no quotes available")) {
    return "No route available for this pair/amount right now.";
  }
  if (lowered.includes("missing a wallet") || lowered.includes("valid wallet")) {
    return "Wallet session non sincronizzata con Relay. Riconnetti il wallet e riprova.";
  }
  return "";
};

export default function BridgeSection({ address, onConnect }) {
  const activeNetwork = useMemo(() => getActiveNetworkConfig(), []);
  const { isConnected } = useAccount();
  const { data: wagmiWalletClient } = useWalletClient();
  const { connectAsync, connectors } = useConnect();
  const { reconnect } = useReconnect();
  const wagmiConnectAttempted = useRef(false);
  const megaethChainId = useMemo(() => {
    const parsed = Number.parseInt(activeNetwork?.chainIdHex || "0x10e6", 16);
    return Number.isFinite(parsed) ? parsed : 4326;
  }, [activeNetwork]);
  const relayChains = useMemo(() => {
    const fallbackRpc = "https://mainnet.megaeth.com/rpc";
    const rpcUrls = (activeNetwork?.rpcUrls || []).filter(Boolean);
    const megaethViemChain = defineChain({
      id: megaethChainId,
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

    const viemChains = [
      megaethViemChain,
      mainnet,
      base,
      arbitrum,
      optimism,
      bsc,
      polygon,
    ];

    return Array.from(
      new Map(
        viemChains.map((chain) => [chain.id, convertViemChainToRelayChain(chain)])
      ).values()
    ).map((relayChain) =>
      relayChain.id === megaethChainId
        ? {
            ...relayChain,
            icon: {
              dark: megaethLogo,
              light: megaethLogo,
              squaredDark: megaethLogo,
              squaredLight: megaethLogo,
            },
          }
        : relayChain
    );
  }, [activeNetwork, megaethChainId]);

  const relayOptions = useMemo(
    () => ({
      appName: "CurrentX",
      source: RELAY_SOURCE,
      uiVersion: "currentx-dex-bridge",
      themeScheme: "dark",
      chains: relayChains,
    }),
    [relayChains]
  );

  const relayTheme = useMemo(
    () => ({
      primaryColor: "#38bdf8",
      focusColor: "#0ea5e9",
      subtleBackgroundColor: "#0f172a",
      subtleBorderColor: "rgba(71, 85, 105, 0.65)",
      text: {
        default: "#f8fafc",
        subtle: "#cbd5e1",
        error: "#f87171",
        success: "#34d399",
      },
      buttons: {
        primary: {
          background: "#0284c7",
          color: "#ffffff",
          hover: {
            background: "#0ea5e9",
            color: "#ffffff",
          },
        },
        secondary: {
          background: "#1e293b",
          color: "#e2e8f0",
          hover: {
            background: "#334155",
            color: "#f8fafc",
          },
        },
        disabled: {
          background: "#1f2937",
          color: "#94a3b8",
        },
      },
      input: {
        background: "#0b1220",
        color: "#f8fafc",
        borderRadius: "12px",
      },
      anchor: {
        color: "#67e8f9",
        hover: {
          color: "#22d3ee",
        },
      },
      dropdown: {
        background: "#0b1220",
        borderRadius: "12px",
        border: "1px solid rgba(56, 189, 248, 0.2)",
      },
      widget: {
        background: "#081227",
        borderRadius: "16px",
        border: "1px solid rgba(56, 189, 248, 0.2)",
        boxShadow: "0 30px 80px -46px rgba(2, 6, 23, 0.9)",
        card: {
          background: "#0f172a",
          borderRadius: "14px",
          border: "1px solid rgba(51, 65, 85, 0.75)",
          gutter: "10px",
        },
        selector: {
          background: "#111b30",
          hover: {
            background: "#18263f",
          },
        },
        swapCurrencyButtonBorderColor: "rgba(56, 189, 248, 0.38)",
        swapCurrencyButtonBorderWidth: "2px",
        swapCurrencyButtonBorderRadius: "10px",
      },
      modal: {
        background: "#0b1220",
        border: "1px solid rgba(56, 189, 248, 0.24)",
        borderRadius: "16px",
      },
    }),
    []
  );

  const popularChainIds = useMemo(
    () => Array.from(new Set([megaethChainId, 1, 8453, 42161, 10, 56, 137])),
    [megaethChainId]
  );

  const defaultMegaethToken = useMemo(
    () => ({
      chainId: megaethChainId,
      address: ETH_ADDRESS,
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
      logoURI: "https://assets.relay.link/icons/1/light.png",
    }),
    [megaethChainId]
  );

  const [toToken, setToToken] = useState(defaultMegaethToken);
  const [bridgeError, setBridgeError] = useState(null);
  const [isTransactionMode, setIsTransactionMode] = useState(false);
  const [isSupportOpen, setIsSupportOpen] = useState(false);

  useEffect(() => {
    if (!address || isConnected) return;
    reconnect();
  }, [address, isConnected, reconnect]);

  useEffect(() => {
    if (!address || wagmiWalletClient || wagmiConnectAttempted.current) return;
    const connector =
      connectors.find((item) => item?.type === "injected") || connectors[0];
    if (!connector) return;
    wagmiConnectAttempted.current = true;
    connectAsync({ connector, chainId: megaethChainId }).catch(() => {
      wagmiConnectAttempted.current = false;
    });
  }, [address, wagmiWalletClient, connectors, connectAsync, megaethChainId]);

  const relayWallet = useMemo(() => {
    if (wagmiWalletClient) {
      return adaptViemWallet(wagmiWalletClient);
    }

    if (!address) return undefined;
    const injected = getInjectedEthereum();
    if (!injected) return undefined;

    const fallbackRpc = "https://mainnet.megaeth.com/rpc";
    const rpcUrls = (activeNetwork?.rpcUrls || []).filter(Boolean);
    const megaethViemChain = defineChain({
      id: megaethChainId,
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

    try {
      const walletClient = createWalletClient({
        account: address,
        chain: megaethViemChain,
        transport: custom(injected),
      });
      return adaptViemWallet(walletClient);
    } catch {
      return undefined;
    }
  }, [wagmiWalletClient, address, activeNetwork, megaethChainId]);

  const handleSwapError = useCallback((error, executionData) => {
    const parsedError = parseRelayErrorMessage(error);
    const executionError = extractExecutionErrorMessage(executionData);
    const resolvedMessage =
      parsedError && parsedError !== GENERIC_SWAP_ERROR
        ? parsedError
        : executionError || parsedError || GENERIC_SWAP_ERROR;

    setBridgeError({
      message: resolvedMessage,
      hint: getBridgeErrorHint(resolvedMessage),
      rawError: error,
      executionError,
    });

    console.error("[CurrentX][Bridge] Relay swap error", {
      rawError: error,
      parsedError,
      executionError,
      executionData,
    });
  }, []);

  const handleSwapSuccess = useCallback(() => {
    setBridgeError(null);
  }, []);

  const handleSwapValidating = useCallback(() => {
    setBridgeError(null);
  }, []);

  const handleWidgetInputActivity = useCallback((event) => {
    const target = event?.target;
    const tagName = String(target?.tagName || "").toLowerCase();
    const isEditable = Boolean(target?.isContentEditable);
    if (tagName !== "input" && tagName !== "textarea" && !isEditable) return;
    setIsTransactionMode(true);
    setIsSupportOpen(false);
  }, []);

  const relayScopedVars = useMemo(
    () => ({
      "--relay-colors-slate-1": "#030912",
      "--relay-colors-slate-2": "#071022",
      "--relay-colors-slate-3": "#0d1a30",
      "--relay-colors-slate-4": "#132340",
      "--relay-colors-slate-5": "#1a2d4f",
      "--relay-colors-slate-6": "#233b63",
      "--relay-colors-slate-7": "#2d4977",
      "--relay-colors-slate-8": "#3a5d93",
      "--relay-colors-slate-9": "#4a74b4",
      "--relay-colors-slate-10": "#6a93c7",
      "--relay-colors-slate-11": "#b8cde8",
      "--relay-colors-slate-12": "#edf4ff",
      "--relay-colors-gray-1": "#030912",
      "--relay-colors-gray-2": "#071022",
      "--relay-colors-gray-3": "#0d1a30",
      "--relay-colors-gray-4": "#132340",
      "--relay-colors-gray-5": "#1a2d4f",
      "--relay-colors-gray-6": "#233b63",
      "--relay-colors-gray-7": "#2d4977",
      "--relay-colors-gray-8": "#3a5d93",
      "--relay-colors-gray-9": "#4a74b4",
      "--relay-colors-gray-10": "#6a93c7",
      "--relay-colors-gray-11": "#b8cde8",
      "--relay-colors-gray-12": "#edf4ff",
      "--relay-colors-gray1": "#030912",
      "--relay-colors-gray2": "#071022",
      "--relay-colors-gray3": "#0d1a30",
      "--relay-colors-gray4": "#132340",
      "--relay-colors-gray5": "#1a2d4f",
      "--relay-colors-gray6": "#233b63",
      "--relay-colors-gray7": "#2d4977",
      "--relay-colors-gray8": "#3a5d93",
      "--relay-colors-gray9": "#84a4cd",
      "--relay-colors-gray10": "#a9c2de",
      "--relay-colors-gray11": "#c8d9ee",
      "--relay-colors-gray12": "#edf4ff",
      "--relay-colors-widget-background": "#050f22",
      "--relay-colors-widget-card-background": "#081428",
      "--relay-colors-widget-selector-background": "#0d1b34",
      "--relay-colors-widget-selector-hover-background": "#142949",
      "--relay-colors-modal-background": "#061125",
      "--relay-colors-dropdown-background": "#09162c",
      "--relay-colors-input-background": "#09162c",
      "--relay-colors-input-color": "#edf4ff",
      "--relay-colors-subtle-background-color": "rgba(56, 189, 248, 0.12)",
      "--relay-colors-subtle-border-color": "rgba(56, 189, 248, 0.36)",
      "--relay-colors-text-default": "#edf4ff",
      "--relay-colors-text-subtle": "#c8d9ee",
      "--relay-colors-text-subtle-secondary": "#a9c2de",
      "--relay-colors-button-disabled-background": "#1a2a44",
      "--relay-colors-button-disabled-color": "#7f9ab8",
      "--relay-colors-primary3": "rgba(56, 189, 248, 0.2)",
      "--relay-colors-primary4": "rgba(56, 189, 248, 0.34)",
      "--relay-colors-primary5": "rgba(56, 189, 248, 0.45)",
      "--relay-colors-primary11": "#7dd3fc",
      "--relay-colors-primary12": "#dff5ff",
      "--relay-borders-dropdown-border": "1px solid rgba(56, 189, 248, 0.28)",
      "--relay-borders-modal-border": "1px solid rgba(56, 189, 248, 0.24)",
    }),
    []
  );

  const relayScopedCss = useMemo(() => {
    const declarations = Object.entries(relayScopedVars)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join("\n");
    return `.relay-kit-reset {\n${declarations}\n}`;
  }, [relayScopedVars]);

  return (
    <section className="px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-6xl xl:max-w-7xl 2xl:max-w-[1480px]">
        <div className="mb-3 rounded-3xl border border-slate-800/80 bg-slate-900/60 p-5 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.9)] lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.35em] text-sky-300/90">
              Bridge
            </div>
            <a
              href={RELAY_OFFICIAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open Relay official website"
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-sky-300/35 bg-sky-500/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-sky-100 transition hover:border-sky-300/55 hover:bg-sky-400/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            >
              <span className="text-slate-200/80">Powered by</span>
              <span className="font-semibold text-sky-100">Relay</span>
              <img
                src={relayLogo}
                alt="Relay"
                loading="lazy"
                className="h-4 w-auto object-contain"
              />
              <span aria-hidden="true" className="text-[11px] leading-none text-sky-100/85">
                {"\u2197"}
              </span>
            </a>
          </div>
          <h2 className="mt-2 font-display text-3xl font-semibold text-slate-100">
            Cross-chain with Relay
          </h2>
          <p className="mt-2 text-sm text-slate-300/80">
            Bridge assets across chains inside CurrentX.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] md:items-stretch lg:gap-6 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] xl:gap-7 xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,38rem)_minmax(0,1fr)]">
          <div className="min-w-0 md:self-start">
            <RelayKitProvider options={relayOptions} theme={relayTheme}>
              <style>{relayScopedCss}</style>
              <div
                className="relative lg:mt-8"
                onInputCapture={handleWidgetInputActivity}
                onChangeCapture={handleWidgetInputActivity}
                onKeyDownCapture={handleWidgetInputActivity}
              >
                <div
                  className="rounded-3xl border border-slate-800/80 bg-slate-900/70 p-2 shadow-[0_28px_80px_-48px_rgba(2,6,23,0.9)] sm:p-4"
                  style={relayScopedVars}
                >
                  <SwapWidget
                    wallet={relayWallet}
                    supportedWalletVMs={RELAY_SUPPORTED_WALLETS}
                    popularChainIds={popularChainIds}
                    toToken={toToken}
                    setToToken={setToToken}
                    defaultToAddress={address}
                    onConnectWallet={onConnect}
                    onSwapError={handleSwapError}
                    onSwapSuccess={handleSwapSuccess}
                    onSwapValidating={handleSwapValidating}
                  />
                </div>
              </div>
            </RelayKitProvider>
            {bridgeError ? (
              <div className="mt-3 rounded-2xl border border-rose-400/35 bg-rose-950/35 p-4 text-sm text-rose-100 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.9)]">
                <p className="font-semibold tracking-wide text-rose-200">Bridge error details</p>
                <p className="mt-1 break-words text-rose-100/95">{bridgeError.message}</p>
                {bridgeError.hint ? (
                  <p className="mt-2 text-rose-200/95">{bridgeError.hint}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <aside
            className={`flex h-fit flex-col gap-3 md:self-start lg:gap-4 xl:gap-5 ${
              isTransactionMode ? "lg:sticky lg:top-[120px]" : ""
            }`}
          >
            <section
              className={`flex flex-col rounded-3xl border border-slate-800/80 bg-slate-900/60 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.9)] ${
                isTransactionMode ? "px-4 py-4 lg:px-5 lg:py-5" : "px-4 py-5 lg:px-5 lg:py-6"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-xl font-semibold text-slate-100">How it works</h3>
                {isTransactionMode ? (
                  <span className="rounded-full border border-sky-300/35 bg-sky-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-sky-100/90">
                    Transaction mode
                  </span>
                ) : null}
              </div>
              <ol className={isTransactionMode ? "mt-3 space-y-2.5" : "mt-3 space-y-2.5"}>
                {HOW_IT_WORKS_STEPS.map((step, index) => (
                  <li
                    key={step}
                    className={`flex items-center leading-relaxed text-slate-200/92 ${
                      isTransactionMode ? "gap-2.5 text-xs" : "gap-2.5 text-[13px]"
                    }`}
                  >
                    <span
                      className={`inline-flex items-center justify-center rounded-full border border-sky-300/25 bg-sky-400/5 font-semibold text-sky-200/80 ${
                        isTransactionMode ? "h-4 w-4 text-[10px]" : "h-[18px] w-[18px] text-[10px]"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              {isTransactionMode ? (
                <div className="mt-3 text-[11px] text-slate-400/70">
                  Transaction mode active: focus on execution details.
                </div>
              ) : (
                <div className="mt-auto flex flex-col gap-1 pt-4 text-[11px] text-slate-400/78 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <p>Start with a small test transfer if it's your first time.</p>
                  <a
                    href={DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-medium text-slate-500/85 underline-offset-2 transition hover:text-slate-200 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 sm:shrink-0"
                  >
                    Learn more in Docs
                  </a>
                </div>
              )}
            </section>

            <section
              className={`rounded-3xl shadow-[0_24px_60px_-36px_rgba(15,23,42,0.9)] ${
                isTransactionMode
                  ? "border border-slate-800/80 bg-slate-900/60 px-4 py-4 lg:px-5 lg:py-5"
                  : "border border-slate-800/60 bg-slate-900/45 px-4 py-4 lg:px-5 lg:py-5"
              }`}
            >
              {isTransactionMode ? (
                <>
                  <button
                    type="button"
                    onClick={() => setIsSupportOpen((open) => !open)}
                    className="flex w-full items-center justify-between rounded-2xl border border-slate-700/80 bg-slate-900/65 px-3 py-2 text-left"
                    aria-expanded={isSupportOpen}
                  >
                    <span className="font-display text-sm font-semibold text-slate-100">Support</span>
                    <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                      {isSupportOpen ? "Hide" : "Show"}
                    </span>
                  </button>
                  {isSupportOpen ? (
                    <div className="pt-3">
                      <p className="text-xs text-slate-300/80">
                        Share your wallet address and transaction hash.
                      </p>
                      <a
                        href={DISCORD_SUPPORT_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-sky-400/40 bg-sky-500/70 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-500/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 sm:w-auto sm:self-start sm:px-4"
                      >
                        <span>Open Discord support</span>
                      </a>
                      <p className="mt-2 text-[11px] text-slate-400/80">#need-help</p>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <h3 className="font-display text-base font-semibold text-slate-200/92">Support</h3>
                  <p className="mt-2 text-[11px] text-slate-400/75">
                    Share your wallet address and transaction hash.
                  </p>
                  <a
                    href={DISCORD_SUPPORT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-600/80 bg-slate-800/80 px-4 py-1.5 text-sm font-semibold text-slate-100 transition hover:bg-slate-700/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 sm:w-auto sm:self-start sm:px-4"
                  >
                    <span>Open Discord support</span>
                  </a>
                  <p className="mt-2 text-[10px] text-slate-500/80">#need-help</p>
                </>
              )}
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}

