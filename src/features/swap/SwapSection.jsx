// src/features/swap/SwapSection.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Contract, Interface, formatUnits, id, parseUnits, AbiCoder } from "ethers";
import {
  TOKENS,
  getProvider,
  WETH_ADDRESS,
  UNIV2_ROUTER_ADDRESS,
  UNIV2_FACTORY_ADDRESS,
  UNIV3_FACTORY_ADDRESS,
  UNIV3_QUOTER_V2_ADDRESS,
  UNIV3_UNIVERSAL_ROUTER_ADDRESS,
  PERMIT2_ADDRESS,
  getV2Quote,
  getV2QuoteWithMeta,
  getRegisteredCustomTokens,
  getReadOnlyProvider,
  setRegisteredCustomTokens,
  EXPLORER_BASE_URL,
  NETWORK_NAME,
  DEFAULT_TOKEN_LOGO,
} from "../../shared/config/web3";
import {
  ERC20_ABI,
  PERMIT2_ABI,
  UNIV2_FACTORY_ABI,
  UNIV2_ROUTER_ABI,
  WETH_ABI,
  UNIV3_FACTORY_ABI,
  UNIV3_QUOTER_V2_ABI,
  UNIV3_UNIVERSAL_ROUTER_ABI,
} from "../../shared/config/abis";
import { multicall } from "../../shared/services/multicall";
import { getRealtimeClient } from "../../shared/services/realtime";
import { fetchTokenPrices } from "../../shared/config/subgraph";
import { getUserPointsQueryKey } from "../../shared/hooks/usePoints";
import { applyTokenAliases } from "../../shared/config/tokens";

const BASE_TOKEN_OPTIONS = ["ETH", "WETH", "USDT0", "CUSD", "USDm", "CRX", "MEGA", "BTCB"];
const MAX_ROUTE_CANDIDATES = 12;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT48 = (1n << 48n) - 1n;
const APPROVAL_CACHE_KEY = "cx_approval_cache_v1";
const EXPLORER_LABEL = `${NETWORK_NAME} Explorer`;
const SYNC_TOPIC =
  "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";
const TRANSFER_TOPIC = id("Transfer(address,address,uint256)").toLowerCase();
const WETH_WITHDRAWAL_TOPIC = id("Withdrawal(address,uint256)").toLowerCase();
const WETH_DEPOSIT_TOPIC = id("Deposit(address,uint256)").toLowerCase();
const V3_FEE_TIERS = [500, 3000, 10000];
const V3_FEE_PRIORITY = [3000, 500, 10000];
const MAX_V3_HOPS = 3;
const MAX_V3_PATHS = 30;
const MAX_V3_ROUTE_CANDIDATES = 24;
const MAX_V3_FEE_OPTIONS = 3;
const MAX_V3_COMBOS_PER_PATH = 9;
const FAST_QUOTE_BUDGET_MS = 1400;
const V3_QUOTE_BATCH_SIZE = 4;
const MAX_V3_QUOTES = 8;
const MAX_SPLIT_ROUTES = 2;
const SPLIT_SHARE_STEPS = [25, 50, 75];
const ALLOW_V2_ROUTING = true;
const SMART_MODE_V2_FALLBACK_ONLY = true;
const STABLE_SYMBOLS = new Set([
  "USDM",
  "USDT0",
  "CUSD",
  "USDC",
  "USDT",
  "DAI",
  "USDE",
  "SUSDE",
  "STCUSD",
]);
const UR_COMMANDS = {
  V3_SWAP_EXACT_IN: 0x00,
  V3_SWAP_EXACT_OUT: 0x01,
  SWEEP: 0x04,
  V2_SWAP_EXACT_IN: 0x08,
  WRAP_ETH: 0x0b,
  UNWRAP_WETH: 0x0c,
};
const shortenAddress = (addr) =>
  !addr ? "" : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
const isValidTokenAddress = (value) => /^0x[a-fA-F0-9]{40}$/.test((value || "").trim());
const trimTrailingZeros = (value) => {
  if (typeof value !== "string" || !value.includes(".")) return value;
  return value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
};
const toNumberSafe = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};
const formatAmountFloor = (value, decimals = 6) => {
  if (!Number.isFinite(value)) return "";
  const safeDecimals = Math.max(0, Math.min(18, Number(decimals) || 0));
  const factor = 10 ** safeDecimals;
  const floored = Math.floor((value + Number.EPSILON) * factor) / factor;
  return trimTrailingZeros(floored.toFixed(safeDecimals));
};
const sanitizeAmountInput = (raw, decimals) => {
  if (raw === null || raw === undefined) return "";
  const value = String(raw).replace(/,/g, ".");
  if (!value) return "";
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return "";
  const hasTrailingDot = cleaned.endsWith(".");
  const parts = cleaned.split(".");
  const intPart = parts[0] ?? "";
  let fracPart = parts.slice(1).join("");
  const maxDecimals = Number.isFinite(decimals) ? Math.max(0, decimals) : null;
  if (maxDecimals !== null) {
    fracPart = fracPart.slice(0, maxDecimals);
  }
  const safeInt = intPart === "" ? "0" : intPart;
  if (maxDecimals === 0) return safeInt;
  if (fracPart.length) return `${safeInt}.${fracPart}`;
  return hasTrailingDot ? `${safeInt}.` : safeInt;
};
const formatOutputPreviewValue = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (!value.includes(".")) return value;
  const [intPart, fracPartRaw = ""] = value.split(".");
  const absInt = Math.abs(Number(intPart || "0"));
  const maxDecimals = absInt >= 100 ? 4 : absInt >= 1 ? 5 : 6;
  const cleanedFrac = fracPartRaw.replace(/[^0-9]/g, "");
  const sliced = cleanedFrac.slice(0, maxDecimals);
  if (!sliced) return intPart || "0";
  return trimTrailingZeros(`${intPart}.${sliced}`);
};
const formatCompactNumber = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  const abs = Math.abs(num);
  const units = [
    { value: 1e21, suffix: "Sx" },
    { value: 1e18, suffix: "Qi" },
    { value: 1e15, suffix: "Q" },
    { value: 1e12, suffix: "T" },
    { value: 1e9, suffix: "B" },
    { value: 1e6, suffix: "M" },
    { value: 1e3, suffix: "K" },
  ];
  for (const unit of units) {
    if (abs >= unit.value) {
      const scaled = num / unit.value;
      const decimals = scaled >= 100 ? 2 : scaled >= 10 ? 3 : 4;
      return `${trimTrailingZeros(scaled.toFixed(decimals))}${unit.suffix}`;
    }
  }
  if (abs >= 1) return trimTrailingZeros(num.toFixed(4));
  if (abs >= 0.01) return trimTrailingZeros(num.toFixed(6));
  if (abs >= 0.0001) return trimTrailingZeros(num.toFixed(8));
  if (abs >= 0.00000001) return trimTrailingZeros(num.toFixed(8));
  return "<0.00000001";
};
const formatBalance = (v) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  return formatCompactNumber(n);
};
const displaySymbol = (token, fallback) =>
  (token && (token.displaySymbol || token.symbol)) || fallback;
const routeSymbol = (token, fallback) => {
  const sym = token?.symbol;
  if (typeof sym === "string" && sym.trim() && !sym.includes(" ")) return sym;
  const display = token?.displaySymbol;
  if (typeof display === "string" && display.trim() && !display.includes(" ")) return display;
  return fallback;
};
const amountTextClass = (value, baseClass = "text-2xl sm:text-3xl") => {
  const raw = String(value || "");
  if (!raw) return baseClass;
  const len = raw.replace(/[^0-9.]/g, "").length;
  if (len <= 12) return baseClass;
  if (len <= 16) return "text-xl sm:text-2xl tracking-tight";
  if (len <= 20) return "text-lg sm:text-xl tracking-tight";
  if (len <= 24) return "text-base sm:text-lg tracking-tight";
  if (len <= 30) return "text-sm sm:text-base tracking-tight";
  return "text-xs sm:text-sm tracking-tight";
};
const makeApprovalKey = (kind, token, spender) =>
  `${kind}:${(token || "").toLowerCase()}:${(spender || "").toLowerCase()}`;
const TokenLogo = ({
  token,
  fallbackSymbol,
  imgClassName = "h-10 w-10 rounded-full border border-slate-800 bg-slate-900 object-contain",
  placeholderClassName =
    "h-10 w-10 rounded-full bg-slate-800 border border-slate-700 text-sm font-semibold text-white flex items-center justify-center",
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const displaySym = displaySymbol(token, fallbackSymbol);
  const primaryLogo = token?.logo || null;
  const fallbackLogo =
    (fallbackSymbol && TOKENS[fallbackSymbol]?.logo) ||
    (token?.symbol && TOKENS[token.symbol]?.logo) ||
    null;
  const imgSrc = imgFailed ? null : primaryLogo || fallbackLogo || DEFAULT_TOKEN_LOGO;

  if (!imgSrc) {
    return (
      <div className={placeholderClassName}>
        ?
      </div>
    );
  }

  return (
    <img
      src={imgSrc}
      alt={`${displaySym || token?.symbol || "token"} logo`}
      className={imgClassName}
      onError={(e) => {
        const target = e.currentTarget;
        if (fallbackLogo && target.getAttribute("data-fallback") !== "1") {
          target.setAttribute("data-fallback", "1");
          target.src = fallbackLogo;
        } else {
          setImgFailed(true);
        }
      }}
    />
  );
};
const normalizeCustomTokenLogo = (logo) => {
  const raw = String(logo || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const crxLogo = String(TOKENS?.CRX?.logo || "")
    .trim()
    .toLowerCase();
  // Legacy custom-token fallback used CRX logo; treat it as "no logo".
  if ((crxLogo && lower === crxLogo) || lower.includes("currentx")) return null;
  return raw;
};
const paddedTopicAddress = (addr) =>
  `0x${(addr || "").toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
const NATIVE_PARAM_VALUES = new Set([
  "eth",
  "native",
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "0x0000000000000000000000000000000000000000",
]);
const getQueryParamInsensitive = (params, key) => {
  if (!params || !key) return null;
  if (params.has(key)) return params.get(key);
  const target = String(key).toLowerCase();
  for (const [k, v] of params.entries()) {
    if (String(k).toLowerCase() === target) return v;
  }
  return null;
};
const isNativeParamValue = (value) => {
  if (!value) return false;
  const raw = String(value).trim().toLowerCase();
  return NATIVE_PARAM_VALUES.has(raw);
};
const resolveSwapTokenPair = (currentSell, currentBuy, desiredSell, desiredBuy) => {
  let sell = desiredSell || currentSell;
  let buy = desiredBuy || currentBuy;
  if (sell && buy && sell === buy) {
    const fallback = sell === "ETH" ? "CRX" : "ETH";
    if (desiredSell && !desiredBuy) {
      buy = currentBuy && currentBuy !== sell ? currentBuy : fallback;
    } else if (desiredBuy && !desiredSell) {
      sell = currentSell && currentSell !== buy ? currentSell : fallback;
    } else {
      sell = currentSell && currentSell !== buy ? currentSell : fallback;
    }
  }
  return { sell, buy };
};
const normalizeExactField = (value) => {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (raw === "input" || raw === "in") return "in";
  if (raw === "output" || raw === "out") return "out";
  return null;
};

const formatRelativeTime = (ts) => {
  if (!ts) return "--";
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
};
const compactRpcMessage = (raw, fallback) => {
  if (!raw) return fallback;
  const rawStr = typeof raw === "string" ? raw : String(raw || "");
  const stripped = rawStr
    .replace(/\{.*$/s, "")
    .replace(/\(error=.*$/i, "")
    .trim();
  const lower = stripped.toLowerCase();
  if (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("429") ||
    lower.includes("being rate limited")
  ) {
    return "RPC rate-limited. Switch RPC or retry in a few seconds.";
  }
  if (lower.includes("failed to fetch") || lower.includes("network error")) {
    return "RPC unreachable from your wallet. Switch RPC in network settings or retry.";
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) {
    return "RPC timeout. Retry or switch to a faster RPC.";
  }
  if (lower.includes("eth_requestaccounts")) {
    return "Open your wallet and approve the connection.";
  }
  if (
    lower.includes("could not decode result data") ||
    lower.includes("bad_data") ||
    lower.includes("decode result")
  ) {
    return "Pool data not available right now. Please retry.";
  }
  if (lower.includes("unknown error")) {
    return "Wallet RPC error. Please retry.";
  }
  const trimmed =
    stripped.length > 140 ? `${stripped.slice(0, 140).trim()}...` : stripped;
  return trimmed || fallback || "Service temporarily unavailable. Please retry.";
};
const formatV3Fee = (fee) => {
  const num = Number(fee);
  if (!Number.isFinite(num) || num <= 0) return "--";
  return `${(num / 10000).toFixed(2)}%`;
};
const computeProbeAmount = (amountWei, decimals) => {
  if (!amountWei || amountWei <= 0n) return 0n;
  const safeDecimals = Number.isFinite(decimals) ? Math.max(0, decimals) : 18;
  const minUnit =
    safeDecimals >= 6 ? 10n ** BigInt(safeDecimals - 6) : 1n;
  let probe = amountWei / 1000n;
  if (probe <= 0n) probe = minUnit;
  if (probe > amountWei) probe = amountWei;
  if (probe <= 0n) probe = amountWei;
  return probe;
};
const feeRateFromTier = (fee) => {
  const num = Number(fee);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num / 1_000_000;
};
const computeRouteFeeFraction = (route) => {
  if (!route) return 0;
  const path = Array.isArray(route.path) ? route.path : [];
  const hopCount = Math.max(0, path.length - 1);
  if (!hopCount) return 0;
  const protocol = route.protocol || (Array.isArray(route.fees) && route.fees.length ? "V3" : "V2");
  let multiplier = 1;
  for (let i = 0; i < hopCount; i += 1) {
    const feeTier =
      protocol === "V3" ? route.fees?.[i] ?? 3000 : 3000;
    const feeRate = feeRateFromTier(feeTier);
    if (feeRate > 0) {
      multiplier *= 1 - feeRate;
    }
  }
  return 1 - multiplier;
};
const safeParseUnits = (value, decimals) => {
  try {
    return parseUnits(value, decimals);
  } catch {
    return null;
  }
};
const isIncompleteAmount = (value) =>
  typeof value === "string" && (value === "." || value.endsWith("."));

const formatDisplayAmount = (val, symbol) => {
  const num = Number(val);
  if (!Number.isFinite(num)) return "--";
  const str = formatCompactNumber(num);
  return symbol ? `${str} ${symbol}` : str;
};
const formatUsdAmount = (value) => {
  if (!Number.isFinite(value)) return "--";
  const num = Number(value);
  if (num === 0) return "$0";
  const str = formatCompactNumber(num);
  return `$${str}`;
};

const extractTxHash = (err) => {
  const candidate =
    err?.transaction?.hash ||
    err?.receipt?.hash ||
    err?.transactionHash ||
    err?.hash ||
    err?.data?.txHash ||
    err?.data?.hash ||
    err?.error?.data?.txHash ||
    err?.error?.data?.hash ||
    err?.info?.error?.data?.txHash ||
    err?.info?.error?.data?.hash;
  if (typeof candidate !== "string") return null;
  if (!candidate.startsWith("0x")) return null;
  return candidate;
};

const tryFetchReceipt = async (hash, provider) => {
  if (!hash) return null;
  const providers = [];
  if (provider) providers.push(provider);
  const fallback = getReadOnlyProvider(true, true);
  if (fallback) providers.push(fallback);
  for (const p of providers) {
    try {
      const receipt = await p.getTransactionReceipt(hash);
      if (receipt) return receipt;
    } catch {
      // ignore provider failures
    }
  }
  return null;
};

const computeOutcomeGrade = (expected, actual, minReceived) => {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return { label: "OK", icon: "⚠️", deltaPct: null };
  }
  const deltaPct = expected
    ? ((actual - expected) / expected) * 100
    : null;
  if (deltaPct >= -0.1) return { label: "Great", icon: "✅", deltaPct };
  if (Number.isFinite(minReceived) && actual < minReceived) {
    return { label: "Bad", icon: "❌", deltaPct };
  }
  return { label: "OK", icon: "⚠️", deltaPct };
};

const findActualOutput = (receipt, targetAddress, userAddress, opts = {}) => {
  if (!receipt || !Array.isArray(receipt.logs) || !userAddress) return null;
  const targetLower = (targetAddress || "").toLowerCase();
  const userTopic = paddedTopicAddress(userAddress);
  let observed = null;

  for (let i = 0; i < receipt.logs.length; i += 1) {
    const log = receipt.logs[i];
    const addr = (log?.address || "").toLowerCase();
    const topic0 = (log?.topics?.[0] || "").toLowerCase();

    if (targetLower && addr === targetLower && topic0 === TRANSFER_TOPIC) {
      const toTopic = (log?.topics?.[2] || "").toLowerCase();
      if (toTopic === userTopic) {
        const amount = log?.data ? BigInt(log.data) : 0n;
        if (observed === null || amount > observed) observed = amount;
      }
    }

    if (
      opts.captureWithdrawal &&
      addr === WETH_ADDRESS.toLowerCase() &&
      topic0 === WETH_WITHDRAWAL_TOPIC
    ) {
      const dstTopic = (log?.topics?.[1] || "").toLowerCase();
      if (dstTopic === userTopic) {
        const amount = log?.data ? BigInt(log.data) : 0n;
        if (observed === null || amount > observed) observed = amount;
      }
    }

    if (
      opts.captureDeposit &&
      addr === WETH_ADDRESS.toLowerCase() &&
      topic0 === WETH_DEPOSIT_TOPIC
    ) {
      const dstTopic = (log?.topics?.[1] || "").toLowerCase();
      if (dstTopic === userTopic) {
        const amount = log?.data ? BigInt(log.data) : 0n;
        if (observed === null || amount > observed) observed = amount;
      }
    }
  }

  return observed;
};

const requireDecimals = (symbol, meta) => {
  if (symbol === "ETH") return 18;
  const dec = meta?.decimals;
  if (dec === undefined || dec === null || Number.isNaN(dec)) {
    throw new Error(`Missing decimals for ${symbol}. Reload tokens or re-add with decimals.`);
  }
  return dec;
};

const friendlySwapError = (e) => {
  const raw = e?.message || "";
  const lower = raw.toLowerCase();
  const rpcCode =
    e?.code || e?.error?.code || (typeof e?.data?.code !== "undefined" ? e.data.code : null);
  if (rpcCode === 4001 || rpcCode === "ACTION_REJECTED") {
    return "Transaction was rejected in wallet.";
  }
  if (
    rpcCode === -32603 ||
    lower.includes("internal json-rpc error") ||
    lower.includes("json-rpc") ||
    lower.includes("could not coalesce")
  ) {
    return "RPC rejected the transaction (internal error). Switch RPC (e.g. official MegaETH) and try again.";
  }
  if (lower.includes("insufficient funds")) {
    return "Not enough ETH to cover amount + gas. Reduce amount or add more ETH.";
  }
  if (
    lower.includes("replacement fee too low") ||
    lower.includes("underpriced") ||
    lower.includes("fee too low")
  ) {
    return "Gas fee too low. Increase max fee/priority or try again with the suggested gas.";
  }
  if (lower.includes("nonce too low") || lower.includes("already known")) {
    return "You have a pending transaction with this nonce. Speed up/cancel it in wallet, then retry.";
  }
  if (
    lower.includes("intrinsic gas") ||
    lower.includes("gas required exceeds") ||
    lower.includes("exceeds allowance")
  ) {
    return "Gas limit too low for this call. Try again or bump gas limit in wallet.";
  }
  if (lower.includes("execution reverted") || lower.includes("reverted")) {
    return "Swap reverted. Try a smaller size, higher slippage, or a different route.";
  }
  if (lower.includes("network") && lower.includes("mismatch")) {
    return "Wrong network. Please switch to MegaETH and retry.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "RPC rate-limited. Switch RPC or wait a few seconds and retry.";
  }
  if (
    lower.includes("insufficient output amount") ||
    lower.includes("uniswapv2router: insufficient_output_amount") ||
    lower.includes("universalrouter")
  ) {
    return "Slippage too tight or not enough liquidity for this route.";
  }
  if (lower.includes("transfer amount exceeds balance")) {
    return "Insufficient token balance for this swap.";
  }
  if (lower.includes("insufficient funds")) {
    return "Not enough native ETH to cover the swap + gas.";
  }
  if (lower.includes("missing revert data") || lower.includes("estimategas")) {
    return "Swap simulation failed (no revert data). Try a smaller size, a different route, or a higher slippage.";
  }
  if (lower.includes("permit2") && lower.includes("allowance")) {
    return "Approval missing or expired. Click Swap now to continue.";
  }
  if (lower.includes("transfer helper")) {
    return "Token transfer failed. Check allowance and balance, then retry.";
  }
  return raw || "Swap failed. Try again or change RPC.";
};

const friendlyQuoteError = (e, sellSymbol, buySymbol) => {
  const raw = e?.message || "";
  const lower = raw.toLowerCase();
  if (lower.includes("missing revert data") || lower.includes("call_exception")) {
    return `No pool found for ${sellSymbol}/${buySymbol} on the selected network. Create it first or try another pair.`;
  }
  if (lower.includes("could not find") || lower.includes("not found")) {
    return `Pool ${sellSymbol}/${buySymbol} not found on this network.`;
  }
  if (lower.includes("timeout") || lower.includes("rate limit") || lower.includes("429")) {
    return "RPC is slow or rate-limited. Switch RPC or retry in a few seconds.";
  }
  if (lower.includes("network") && lower.includes("mismatch")) {
    return "Wrong network for this pair. Switch to the correct network and retry.";
  }
  if (lower.includes("execution reverted") || lower.includes("reverted")) {
    return `Quote failed for ${sellSymbol}/${buySymbol}. Pool may be empty or not deployed.`;
  }
  return raw || "Quote unavailable right now. Retry or switch RPC.";
};

import { getActiveNetworkConfig } from "../../shared/config/networks";

export default function SwapSection({ balances, address, chainId, onBalancesRefresh }) {
  const queryClient = useQueryClient();
  const pointsSuffix = address ? " Points updated." : "";
  const refreshPoints = useCallback(() => {
    if (!address) return;
    queryClient.invalidateQueries({ queryKey: getUserPointsQueryKey(address) });
  }, [address, queryClient]);
  const normalizeChainHex = (value) => {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    if (str.startsWith("0x") || str.startsWith("0X")) return str.toLowerCase().replace(/^0x0+/, "0x");
    const num = Number(str);
    if (Number.isFinite(num)) return `0x${num.toString(16)}`;
    return str.toLowerCase();
  };
  const [localBalances, setLocalBalances] = useState({});
  const [localBalancesTick, setLocalBalancesTick] = useState(0);
  const [customTokens, setCustomTokens] = useState(() => getRegisteredCustomTokens());
  const tokenRegistry = useMemo(() => {
    const out = { ...TOKENS };
    Object.entries(customTokens || {}).forEach(([sym, meta]) => {
      if (!meta) return;
      const base = out[sym];
      const customLogo = normalizeCustomTokenLogo(meta.logo);
      out[sym] = {
        ...base,
        ...meta,
        address: meta.address || base?.address || null,
        decimals: meta.decimals ?? base?.decimals,
        name: meta.name || base?.name,
        displaySymbol: meta.displaySymbol || base?.displaySymbol,
        logo: customLogo || base?.logo || DEFAULT_TOKEN_LOGO,
      };
    });
    return applyTokenAliases(out);
  }, [customTokens]);
  useEffect(() => {
    const sync = () => {
      try {
        setCustomTokens(getRegisteredCustomTokens());
      } catch {
        // ignore sync errors
      }
    };
    sync();
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;
    const handleFocus = () => sync();
    const handleVisibility = () => {
      if (!document.hidden) sync();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const activeChainHex = normalizeChainHex(getActiveNetworkConfig()?.chainIdHex || "");
  const walletChainHex = normalizeChainHex(chainId);
  const isChainMatch = !walletChainHex || walletChainHex === activeChainHex;
  const hasV2Support = Boolean(
    UNIV2_FACTORY_ADDRESS &&
      UNIV2_ROUTER_ADDRESS &&
      UNIV3_UNIVERSAL_ROUTER_ADDRESS &&
      PERMIT2_ADDRESS
  );
  const hasV3Support = Boolean(
    UNIV3_FACTORY_ADDRESS &&
      UNIV3_QUOTER_V2_ADDRESS &&
      UNIV3_UNIVERSAL_ROUTER_ADDRESS &&
      PERMIT2_ADDRESS
  );
  const allowV2Routing = ALLOW_V2_ROUTING;
  const enableV2Routing = hasV2Support && allowV2Routing;
  const [sellToken, setSellToken] = useState("ETH");
  const [buyToken, setBuyToken] = useState("CRX");
  const [amountIn, setAmountIn] = useState("");
  const [amountOutInput, setAmountOutInput] = useState("");
  const [swapInputMode, setSwapInputMode] = useState("in"); // "in" | "out"
  const [quoteOut, setQuoteOut] = useState(null);
  const [quoteOutRaw, setQuoteOutRaw] = useState(null);
  const [priceImpact, setPriceImpact] = useState(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [slippage, setSlippage] = useState("0.5");
  const [quoteRoute, setQuoteRoute] = useState([]);
  const [quotePairs, setQuotePairs] = useState([]); // legacy V2 Sync-based refresh (unused for V3)
  const [quoteMeta, setQuoteMeta] = useState(null);
  const routePreference = "smart";
  const [liveRouteTick, setLiveRouteTick] = useState(0);
  const [lastQuoteAt, setLastQuoteAt] = useState(null);
  const [quoteAgeLabel, setQuoteAgeLabel] = useState("--");
  const [quoteLockedUntil, setQuoteLockedUntil] = useState(0);
  const [sellTokenUsd, setSellTokenUsd] = useState(null);
  const [sellTokenUsdLoading, setSellTokenUsdLoading] = useState(false);
  const [swapStatus, setSwapStatus] = useState(null);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapPulse, setSwapPulse] = useState(false);
  const [focusedAmountField, setFocusedAmountField] = useState(""); // "sell" | "buy" | ""
  const [activeQuickPercent, setActiveQuickPercent] = useState(null);
  const [routeRefreshFx, setRouteRefreshFx] = useState(false);
  const [approvalTargets, setApprovalTargets] = useState([]); // { symbol, address, desiredAllowance, spender, kind, expiration }
  const [selectorOpen, setSelectorOpen] = useState(null); // "sell" | "buy" | null
  const [tokenSearch, setTokenSearch] = useState("");
  const [customTokenAddError, setCustomTokenAddError] = useState("");
  const [customTokenAddLoading, setCustomTokenAddLoading] = useState(false);
  const [searchTokenMeta, setSearchTokenMeta] = useState(null);
  const [searchTokenMetaLoading, setSearchTokenMetaLoading] = useState(false);
  const [searchTokenMetaError, setSearchTokenMetaError] = useState("");
  const [copiedToken, setCopiedToken] = useState("");
  const [executionProof, setExecutionProof] = useState(null);
  const toastTimerRef = useRef(null);
  const copyTimerRef = useRef(null);
  const executionClearRef = useRef(null);
  const quoteLockTimerRef = useRef(null);
  const pendingExecutionRef = useRef(null);
  const lastQuoteOutRef = useRef(null);
  const quoteDebounceRef = useRef(null);
  const allowanceDebounceRef = useRef(null);
  const routeRefreshTimerRef = useRef(null);
  const pendingTxHashRef = useRef(null);
  const autoRefreshTimerRef = useRef(null);
  const approvalCacheRef = useRef(new Map());
  const lastQuoteSourceRef = useRef("Live quote via CurrentX API...");
  const quoteInFlightRef = useRef(false);
  const lastQuoteKeyRef = useRef("");
  const routeCandidateCacheRef = useRef(new Map());
  const lastFullQuoteAtRef = useRef(0);
  const lastRouteMetaRef = useRef(null);
  const lastRouteKeyRef = useRef("");

  const addCustomTokenByAddress = useCallback(
    async (rawAddress, { clearSearch = false } = {}) => {
      const addr = (rawAddress || "").trim();
      setCustomTokenAddError("");
      if (!isValidTokenAddress(addr)) {
        setCustomTokenAddError("Enter a valid token contract address (0x...)");
        return false;
      }
      const lower = addr.toLowerCase();
      const exists = Object.values(tokenRegistry).find(
        (t) => (t.address || "").toLowerCase() === lower
      );
      if (exists) {
        setCustomTokenAddError("Token already listed.");
        return false;
      }
      if (customTokenAddLoading) return false;
      setCustomTokenAddLoading(true);
      try {
        const metaOverride =
          searchTokenMeta &&
          (searchTokenMeta.address || "").toLowerCase() === lower
            ? searchTokenMeta
            : null;
        let tokenKey = metaOverride?.symbol || "";
        let name = metaOverride?.name || "";
        let decimals = metaOverride?.decimals;
        if (!tokenKey) {
          const provider = await getProvider().catch(() => getReadOnlyProvider(false, true));
          const erc20 = new Contract(addr, ERC20_ABI, provider);
          const [symbolRaw, nameRaw, decimalsRaw] = await Promise.all([
            erc20.symbol().catch(() => "TOKEN"),
            erc20.name().catch(() => "Custom Token"),
            erc20.decimals().catch(() => 18),
          ]);
          let symbol = (symbolRaw || "TOKEN").toString();
          symbol = symbol.replace(/\0/g, "").trim() || "TOKEN";
          tokenKey = symbol.toUpperCase();
          name = (nameRaw || tokenKey || "Custom Token").toString();
          const decimalsNum = Number(decimalsRaw);
          decimals = Number.isFinite(decimalsNum) ? decimalsNum : 18;
        }
        if (tokenRegistry[tokenKey]) {
          setCustomTokenAddError("Symbol already in use. Try another token.");
          return false;
        }
        const next = {
          ...customTokens,
          [tokenKey]: {
            symbol: tokenKey,
            name: name || tokenKey || "Custom Token",
            address: addr,
            decimals: Number.isFinite(decimals) ? decimals : 18,
            logo: normalizeCustomTokenLogo(metaOverride?.logo) || DEFAULT_TOKEN_LOGO,
          },
        };
        setCustomTokens(next);
        setRegisteredCustomTokens(next);
        if (clearSearch) setTokenSearch("");
        return true;
      } catch (err) {
        setCustomTokenAddError(
          compactRpcMessage(err?.message, "Unable to load token metadata")
        );
        return false;
      } finally {
        setCustomTokenAddLoading(false);
      }
    },
    [customTokenAddLoading, customTokens, tokenRegistry, searchTokenMeta]
  );

  const urlParamsRef = useRef(null);
  const urlAppliedRef = useRef(false);
  const urlPendingRef = useRef(new Set());

  const findTokenKeyBySymbol = useCallback(
    (symbol) => {
      if (!symbol) return null;
      const raw = String(symbol).trim().toLowerCase();
      if (!raw) return null;
      const byKey = Object.keys(tokenRegistry).find(
        (key) => key.toLowerCase() === raw
      );
      if (byKey) return byKey;
      const byMeta = Object.entries(tokenRegistry).find(([, meta]) => {
        const metaSymbol = (meta?.symbol || "").toLowerCase();
        const display = (meta?.displaySymbol || "").toLowerCase();
        return metaSymbol === raw || display === raw;
      });
      return byMeta ? byMeta[0] : null;
    },
    [tokenRegistry]
  );

  const findTokenKeyByAddress = useCallback(
    (addressValue) => {
      if (!addressValue) return null;
      const lower = String(addressValue).trim().toLowerCase();
      if (!lower) return null;
      const match = Object.entries(tokenRegistry).find(
        ([, meta]) => (meta?.address || "").toLowerCase() === lower
      );
      return match ? match[0] : null;
    },
    [tokenRegistry]
  );

  const resolveTokenParam = useCallback(
    async (value) => {
      if (!value) return null;
      if (isNativeParamValue(value)) return "ETH";
      const bySymbol = findTokenKeyBySymbol(value);
      if (bySymbol) return bySymbol;
      if (!isValidTokenAddress(value)) return null;
      const byAddress = findTokenKeyByAddress(value);
      if (byAddress) return byAddress;
      const lower = String(value).trim().toLowerCase();
      if (urlPendingRef.current.has(lower)) return "__PENDING__";
      urlPendingRef.current.add(lower);
      const added = await addCustomTokenByAddress(value);
      if (!added) {
        urlPendingRef.current.delete(lower);
        return null;
      }
      return "__PENDING__";
    },
    [addCustomTokenByAddress, findTokenKeyByAddress, findTokenKeyBySymbol]
  );

  const getApprovalStorageKey = useCallback(
    (wallet) =>
      `${APPROVAL_CACHE_KEY}:${(activeChainHex || "").toLowerCase()}:${(wallet || "").toLowerCase()}`,
    [activeChainHex]
  );
  const loadApprovalCache = useCallback(
    (wallet) => {
      if (typeof window === "undefined" || !wallet) return new Map();
      try {
        const raw = localStorage.getItem(getApprovalStorageKey(wallet));
        if (!raw) return new Map();
        const data = JSON.parse(raw);
        const map = new Map();
        Object.entries(data || {}).forEach(([key, entry]) => {
          if (!entry) return;
          map.set(key, {
            amount: BigInt(entry.amount || "0"),
            expiration: BigInt(entry.expiration || "0"),
            at: entry.at || 0,
          });
        });
        return map;
      } catch {
        return new Map();
      }
    },
    [getApprovalStorageKey]
  );
  const persistApprovalCache = useCallback(
    (wallet) => {
      if (typeof window === "undefined" || !wallet) return;
      try {
        const obj = {};
        approvalCacheRef.current.forEach((value, key) => {
          obj[key] = {
            amount: value?.amount?.toString?.() || "0",
            expiration: value?.expiration?.toString?.() || "0",
            at: value?.at || 0,
          };
        });
        localStorage.setItem(getApprovalStorageKey(wallet), JSON.stringify(obj));
      } catch {
        // ignore storage errors
      }
    },
    [getApprovalStorageKey]
  );
  const getCachedApproval = useCallback((kind, token, spender) => {
    if (!token || !spender) return null;
    const entry = approvalCacheRef.current.get(
      makeApprovalKey(kind, token, spender)
    );
    return entry || null;
  }, []);
  const setCachedApproval = useCallback(
    (target) => {
      if (!target?.address || !target?.spender || !target?.kind) return;
      approvalCacheRef.current.set(
        makeApprovalKey(target.kind, target.address, target.spender),
        {
          amount: target.desiredAllowance ?? 0n,
          expiration: target.expiration ?? MAX_UINT48,
          at: Date.now(),
        }
      );
      if (address) persistApprovalCache(address);
    },
    [address, persistApprovalCache]
  );

  useEffect(() => {
    if (!address) {
      approvalCacheRef.current.clear();
      return;
    }
    approvalCacheRef.current = loadApprovalCache(address);
  }, [address, loadApprovalCache]);

  const approvalTargetsForSell = useMemo(
    () => approvalTargets.filter((t) => t.symbol === sellToken),
    [approvalTargets, sellToken]
  );
  const approveNeeded = approvalTargetsForSell.length > 0;

  const [walletFlow, setWalletFlow] = useState({
    open: false,
    steps: [],
    lastError: "",
  });
  const closeWalletFlow = useCallback(() => {
    setWalletFlow((prev) => ({ ...prev, open: false, lastError: "" }));
  }, []);
  const setWalletFlowStepStatus = useCallback((id, status) => {
    setWalletFlow((prev) => {
      if (!prev?.steps?.length) return prev;
      return {
        ...prev,
        steps: prev.steps.map((step) => (step.id === id ? { ...step, status } : step)),
      };
    });
  }, []);
  const activateNextPendingWalletFlowStep = useCallback((allowedIds = null) => {
    setWalletFlow((prev) => {
      const steps = Array.isArray(prev?.steps) ? prev.steps : [];
      if (!steps.length) return prev;
      // If a step is already active, keep it.
      if (steps.some((s) => s.status === "active")) return prev;
      const allowAll = !Array.isArray(allowedIds) || allowedIds.length === 0;
      const nextIdx = steps.findIndex(
        (s) => s.status === "pending" && (allowAll || allowedIds.includes(s.id))
      );
      if (nextIdx < 0) return prev;
      return {
        ...prev,
        steps: steps.map((s, idx) => (idx === nextIdx ? { ...s, status: "active" } : s)),
      };
    });
  }, []);

  const tokenOptions = useMemo(() => {
    const orderedBase = BASE_TOKEN_OPTIONS.filter((sym) => {
      const meta = tokenRegistry[sym];
      return (
        meta &&
        (meta.address || sym === "ETH" || sym === "WETH")
      );
    });
    const customKeys = Object.keys(customTokens || {}).filter((k) => {
      const meta = customTokens[k];
      return meta && (meta.address || k === "ETH" || k === "WETH");
    });
    const extras = customKeys.filter((k) => !orderedBase.includes(k));
    return [...orderedBase, ...extras];
  }, [customTokens, tokenRegistry]);
  const filteredTokens = useMemo(() => {
    const q = tokenSearch.trim().toLowerCase();
    const all = tokenOptions
      .map((key) => ({ key, meta: tokenRegistry[key] }))
      .filter(({ key, meta }) => {
        if (!meta) return false;
        // Always allow selecting native ETH/WETH entries.
        if (key === "ETH" || key === "WETH") return true;
        return Boolean(meta.address);
      });
    if (!q) return all;
    return all.filter(({ key, meta }) => {
      const addr = (meta?.address || "").toLowerCase();
      const sym = String(meta?.symbol || "").toLowerCase();
      const display = String(meta?.displaySymbol || "").toLowerCase();
      const name = String(meta?.name || "").toLowerCase();
      const keyLower = String(key || "").toLowerCase();
      return (
        sym.includes(q) ||
        display.includes(q) ||
        name.includes(q) ||
        addr.includes(q) ||
        keyLower.includes(q)
      );
    });
  }, [tokenOptions, tokenRegistry, tokenSearch]);
  const searchAddress = tokenSearch.trim();
  const searchIsAddress = isValidTokenAddress(searchAddress);
  const showQuickAdd = searchIsAddress && filteredTokens.length === 0;
  useEffect(() => {
    if (!selectorOpen) {
      setSearchTokenMeta(null);
      setSearchTokenMetaError("");
      setSearchTokenMetaLoading(false);
      return;
    }
    if (!searchIsAddress) {
      setSearchTokenMeta(null);
      setSearchTokenMetaError("");
      setSearchTokenMetaLoading(false);
      return;
    }
    const lower = searchAddress.toLowerCase();
    const exists = Object.values(tokenRegistry).some(
      (t) => (t.address || "").toLowerCase() === lower
    );
    if (exists) {
      setSearchTokenMeta(null);
      setSearchTokenMetaError("");
      setSearchTokenMetaLoading(false);
      return;
    }
    let cancelled = false;
    setSearchTokenMetaLoading(true);
    setSearchTokenMetaError("");
    (async () => {
      try {
        const provider = await getProvider().catch(() => getReadOnlyProvider(false, true));
        const erc20 = new Contract(searchAddress, ERC20_ABI, provider);
        const [symbolRaw, nameRaw, decimalsRaw] = await Promise.all([
          erc20.symbol().catch(() => "TOKEN"),
          erc20.name().catch(() => "Custom Token"),
          erc20.decimals().catch(() => 18),
        ]);
        let symbol = (symbolRaw || "TOKEN").toString();
        symbol = symbol.replace(/\0/g, "").trim() || "TOKEN";
        const tokenKey = symbol.toUpperCase();
        const name = (nameRaw || tokenKey || "Custom Token").toString();
        const decimalsNum = Number(decimalsRaw);
        const decimals = Number.isFinite(decimalsNum) ? decimalsNum : 18;
        if (!cancelled) {
          setSearchTokenMeta({
            symbol: tokenKey,
            name,
            decimals,
            address: searchAddress,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setSearchTokenMeta(null);
          setSearchTokenMetaError(
            compactRpcMessage(err?.message, "Unable to load token metadata")
          );
        }
      } finally {
        if (!cancelled) setSearchTokenMetaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectorOpen, searchIsAddress, searchAddress, tokenRegistry]);
  const sellKey = sellToken === "ETH" ? "WETH" : sellToken;
  const buyKey = buyToken === "ETH" ? "WETH" : buyToken;
  const sellMeta = tokenRegistry[sellKey];
  const buyMeta = tokenRegistry[buyKey];
  const displaySellMeta = tokenRegistry[sellToken] || sellMeta;
  const displayBuyMeta = tokenRegistry[buyToken] || buyMeta;
  const displaySellSymbol = displaySymbol(displaySellMeta, sellToken);
  const displayBuySymbol = displaySymbol(displayBuyMeta, buyToken);
  const displaySellAddress =
    (displaySellMeta?.address || (sellToken === "ETH" ? WETH_ADDRESS : "")) ?? "";
  const displayBuyAddress =
    (displayBuyMeta?.address || (buyToken === "ETH" ? WETH_ADDRESS : "")) ?? "";
  // Local balance fetch fallback (multicall via provider)
  useEffect(() => {
    let cancelled = false;
    const fetchLocalBalances = async () => {
      if (!address) {
        setLocalBalances({});
        return;
      }
      try {
        const provider = await getProvider().catch(() => getReadOnlyProvider());
        const iface = new Interface(ERC20_ABI);
        const ercTokens = Object.entries(tokenRegistry)
          .map(([key, meta]) => ({ key, meta }))
          .filter(({ meta }) => meta && meta.address);
        if (!ercTokens.length) return;
        const calls = ercTokens.map(({ meta }) => ({
          target: meta.address,
          callData: iface.encodeFunctionData("balanceOf", [address]),
        }));
        const res = await multicall(
          calls.map((c) => ({ target: c.target, callData: c.callData })),
          provider
        );
        const next = {};
        res.forEach((r, idx) => {
          if (!r?.success) return;
          try {
            const raw = iface.decodeFunctionResult("balanceOf", r.returnData)[0];
            const token = ercTokens[idx];
            const num = Number(formatUnits(raw, token.meta?.decimals || 18));
            if (Number.isFinite(num)) next[token.key] = num;
          } catch {
            /* ignore */
          }
        });
        if (!cancelled && Object.keys(next).length) {
          setLocalBalances(next);
        }
      } catch {
        // ignore fallback errors
      }
    };
    fetchLocalBalances();
    return () => {
      cancelled = true;
    };
  }, [address, tokenRegistry, localBalancesTick]);
  useEffect(() => {
    if (!address) {
      setLocalBalances({});
    }
  }, [address]);
  const refreshBalances = useCallback(async () => {
    if (typeof onBalancesRefresh === "function") {
      try {
        await onBalancesRefresh(address, { silent: true });
      } catch {
        // ignore refresh errors
      }
    }
    setLocalBalancesTick((t) => t + 1);
  }, [onBalancesRefresh, address]);
  const effectiveBalances = useMemo(() => {
    const base = balances || {};
    const local = localBalances || {};
    if (!Object.keys(local).length) return base;
    return { ...base, ...local };
  }, [balances, localBalances]);
  const sellBalance = effectiveBalances?.[sellToken] || 0;
  const handleQuickPercent = (pct) => {
    const bal = effectiveBalances?.[sellToken] || 0;
    const decimals = Math.min(6, tokenRegistry[sellKey]?.decimals ?? 6);
    if (!bal) {
      setActiveQuickPercent(null);
      setAmountIn("");
      setSwapInputMode("in");
      setQuoteError("");
      setSwapStatus(null);
      return;
    }
    const raw = bal * pct;
    const val = formatAmountFloor(raw, decimals);
    setActiveQuickPercent(pct);
    setAmountIn(val || "");
    setSwapInputMode("in");
    setQuoteError("");
    setSwapStatus(null);
  };

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  const pushExecutionProof = useCallback((proof) => {
    setExecutionProof(proof);
    if (executionClearRef.current) clearTimeout(executionClearRef.current);
    executionClearRef.current = setTimeout(() => {
      setExecutionProof(null);
      executionClearRef.current = null;
    }, 20000);
  }, []);
  const listenForTx = useCallback(
    (txHash, meta) => {
      if (!txHash) return () => {};
      const client = getRealtimeClient();
      const unsubscribe = client.addTxListener(txHash, (rcpt) => {
        const routeLabels = meta?.routeLabels || [];
        const buyDecimals = meta?.buyDecimals ?? 18;
        const buySymbol = meta?.buySymbol;
        const minRaw = meta?.minReceivedRaw || meta?.minRaw || null;
        const expectedRaw = meta?.expectedRaw || null;
        const userAddr = (meta?.user || "").toLowerCase();
        const buyAddr = (meta?.buyAddress || "").toLowerCase();

        let actualRaw = null;
        if (userAddr && buyAddr) {
          actualRaw = findActualOutput(rcpt, buyAddr, userAddr, {
            captureWithdrawal: meta?.captureWithdrawal,
            captureDeposit: meta?.captureDeposit,
          });
        }

        const expectedNum =
          expectedRaw !== null && expectedRaw !== undefined
            ? Number(formatUnits(expectedRaw, buyDecimals))
            : null;
        const minNum =
          minRaw !== null && minRaw !== undefined
            ? Number(formatUnits(minRaw, buyDecimals))
            : null;
        const actualNum =
          actualRaw !== null && actualRaw !== undefined
            ? Number(formatUnits(actualRaw, buyDecimals))
            : null;
        const grade =
          actualNum !== null && expectedNum !== null
            ? computeOutcomeGrade(expectedNum, actualNum, minNum)
            : { label: "Included", icon: "⚡", deltaPct: null };

        pushExecutionProof({
          expected:
            expectedRaw !== null && expectedRaw !== undefined
              ? formatDisplayAmount(expectedNum, buySymbol)
              : "--",
          executed:
            actualNum !== null && Number.isFinite(actualNum)
              ? formatDisplayAmount(actualNum, buySymbol)
              : "-- (included)",
          minReceived:
            minRaw !== null && minRaw !== undefined
              ? formatDisplayAmount(minNum, buySymbol)
              : "--",
          priceImpact: meta?.priceImpactSnapshot ?? null,
          slippage: meta?.slippagePct ?? null,
          gasUsed: rcpt?.gasUsed ? Number(rcpt.gasUsed) : null,
          txHash: rcpt?.transactionHash || txHash,
          deltaPct: grade?.deltaPct ?? null,
          route: routeLabels,
          grade: { label: grade?.label || "Included", icon: grade?.icon || "⚡" },
        });
        setSwapStatus({
          message: "Included in block… finalizing",
          hash: rcpt?.transactionHash || txHash,
          variant: "pending",
        });
      });
      return unsubscribe;
    },
    [pushExecutionProof]
  );

  const encodeV3Path = useCallback((tokens, fees) => {
    if (
      !Array.isArray(tokens) ||
      !Array.isArray(fees) ||
      tokens.length !== fees.length + 1
    ) {
      throw new Error("Invalid V3 path.");
    }
    const parts = [];
    for (let i = 0; i < fees.length; i += 1) {
      const token = (tokens[i] || "").toLowerCase().replace(/^0x/, "");
      const next = (tokens[i + 1] || "").toLowerCase().replace(/^0x/, "");
      const fee = Number(fees[i]);
      if (!token || !next || !Number.isFinite(fee)) {
        throw new Error("Invalid V3 path.");
      }
      const feeHex = fee.toString(16).padStart(6, "0");
      if (i === 0) parts.push(token);
      parts.push(feeHex);
      parts.push(next);
    }
    return `0x${parts.join("")}`;
  }, []);

  const buildCommandBytes = useCallback((cmds = []) => {
    const hex = cmds
      .map((c) => Number(c).toString(16).padStart(2, "0"))
      .join("");
    return `0x${hex}`;
  }, []);

  const getRouteCandidates = useCallback(
    (tokenA, tokenB) => {
      const aLower = (tokenA || "").toLowerCase();
      const bLower = (tokenB || "").toLowerCase();
      const prioritized = new Map();
      BASE_TOKEN_OPTIONS.forEach((symbol) => {
        let addr = tokenRegistry?.[symbol]?.address;
        if (symbol === "ETH") addr = WETH_ADDRESS;
        if (!addr) return;
        const lower = addr.toLowerCase();
        if (!lower || lower === ZERO_ADDRESS) return;
        if (lower === aLower || lower === bLower) return;
        if (!prioritized.has(lower)) prioritized.set(lower, addr);
      });
      const fallback = new Map();
      Object.values(tokenRegistry || {}).forEach((meta) => {
        const addr = meta?.address;
        if (!addr) return;
        const lower = addr.toLowerCase();
        if (!lower || lower === ZERO_ADDRESS) return;
        if (lower === aLower || lower === bLower) return;
        if (prioritized.has(lower) || fallback.has(lower)) return;
        fallback.set(lower, addr);
      });
      const wethLower = (WETH_ADDRESS || "").toLowerCase();
      if (
        wethLower &&
        wethLower !== aLower &&
        wethLower !== bLower &&
        !prioritized.has(wethLower) &&
        !fallback.has(wethLower)
      ) {
        prioritized.set(wethLower, WETH_ADDRESS);
      }
      const merged = [...prioritized.values(), ...fallback.values()];
      return merged.slice(0, MAX_ROUTE_CANDIDATES);
    },
    [tokenRegistry]
  );

  const listV3Pools = useCallback(async (factory, tokenA, tokenB) => {
    if (!factory || !tokenA || !tokenB) return [];
    const factoryAddr =
      factory?.target || factory?.address || UNIV3_FACTORY_ADDRESS;
    const provider = factory?.runner || factory?.provider;
    const iface = new Interface(UNIV3_FACTORY_ABI);
    const calls = V3_FEE_TIERS.map((fee) => ({
      target: factoryAddr,
      callData: iface.encodeFunctionData("getPool", [tokenA, tokenB, fee]),
    }));
    try {
      const res = await multicall(calls, provider);
      const parsed = res
        .map((r, idx) => {
          if (!r?.success) return null;
          try {
            const pool = iface.decodeFunctionResult("getPool", r.returnData)[0];
            if (pool && pool !== ZERO_ADDRESS) {
              return { fee: V3_FEE_TIERS[idx], pool };
            }
          } catch {
            // ignore decode failures
          }
          return null;
        })
        .filter(Boolean);
      if (parsed.length) return parsed;
    } catch {
      // ignore multicall failures and fall back to direct RPCs
    }
    const results = await Promise.all(
      V3_FEE_TIERS.map(async (fee) => {
        try {
          const pool = await factory.getPool(tokenA, tokenB, fee);
          if (pool && pool !== ZERO_ADDRESS) {
            return { fee, pool };
          }
        } catch {
          // ignore fee probe errors
        }
        return null;
      })
    );
    return results.filter(Boolean);
  }, []);

  const getV3PoolsForPairs = useCallback(async (factory, pairs) => {
    const poolMap = new Map();
    if (!factory || !Array.isArray(pairs) || !pairs.length) return poolMap;
    const factoryAddr =
      factory?.target || factory?.address || UNIV3_FACTORY_ADDRESS;
    const provider = factory?.runner || factory?.provider;
    const iface = new Interface(UNIV3_FACTORY_ABI);
    const calls = [];
    const meta = [];
    pairs.forEach(([tokenA, tokenB]) => {
      if (!tokenA || !tokenB) return;
      V3_FEE_TIERS.forEach((fee) => {
        calls.push({
          target: factoryAddr,
          callData: iface.encodeFunctionData("getPool", [tokenA, tokenB, fee]),
        });
        meta.push({ tokenA, tokenB, fee });
      });
    });
    if (!calls.length) return poolMap;
    try {
      const res = await multicall(calls, provider);
      res.forEach((r, idx) => {
        if (!r?.success) return;
        const { tokenA, tokenB, fee } = meta[idx];
        try {
          const pool = iface.decodeFunctionResult("getPool", r.returnData)[0];
          if (!pool || pool === ZERO_ADDRESS) return;
          const aLower = tokenA.toLowerCase();
          const bLower = tokenB.toLowerCase();
          const key = `${aLower}-${bLower}`;
          const revKey = `${bLower}-${aLower}`;
          const entry = poolMap.get(key) || [];
          entry.push({ fee, pool });
          poolMap.set(key, entry);
          const revEntry = poolMap.get(revKey) || [];
          revEntry.push({ fee, pool });
          poolMap.set(revKey, revEntry);
        } catch {
          // ignore decode failures
        }
      });
      return poolMap;
    } catch {
      // ignore multicall failures and fall back to per-pair calls
    }
    for (const [tokenA, tokenB] of pairs) {
      if (!tokenA || !tokenB) continue;
      const pools = await listV3Pools(factory, tokenA, tokenB);
      if (!pools.length) continue;
      const aLower = tokenA.toLowerCase();
      const bLower = tokenB.toLowerCase();
      poolMap.set(`${aLower}-${bLower}`, pools);
      poolMap.set(`${bLower}-${aLower}`, pools);
    }
    return poolMap;
  }, [listV3Pools]);

  const getV2PairsForMids = useCallback(async (factory, tokenA, tokenB, mids) => {
    const factoryAddr =
      factory?.target || factory?.address || UNIV2_FACTORY_ADDRESS;
    const provider = factory?.runner || factory?.provider;
    const iface = new Interface(UNIV2_FACTORY_ABI);
    const calls = [];
    const meta = [];

    const pushCall = (kind, mid, a, b) => {
      calls.push({
        target: factoryAddr,
        callData: iface.encodeFunctionData("getPair", [a, b]),
      });
      meta.push({ kind, mid });
    };

    pushCall("direct", null, tokenA, tokenB);
    (mids || []).forEach((mid) => {
      if (!mid) return;
      pushCall("A", mid, tokenA, mid);
      pushCall("B", mid, mid, tokenB);
    });

    const parsePair = (res, idx) => {
      if (!res?.success) return null;
      try {
        const pair = iface.decodeFunctionResult("getPair", res.returnData)[0];
        if (!pair || pair === ZERO_ADDRESS) return null;
        return { pair, meta: meta[idx] };
      } catch {
        return null;
      }
    };

    try {
      const res = await multicall(calls, provider);
      const hopMap = new Map();
      let directPair = null;
      res.forEach((r, idx) => {
        const parsed = parsePair(r, idx);
        if (!parsed) return;
        if (parsed.meta.kind === "direct") {
          directPair = parsed.pair;
          return;
        }
        const mid = parsed.meta.mid;
        if (!mid) return;
        const entry = hopMap.get(mid) || {};
        if (parsed.meta.kind === "A") entry.pairA = parsed.pair;
        if (parsed.meta.kind === "B") entry.pairB = parsed.pair;
        hopMap.set(mid, entry);
      });
      const hopPairs = [];
      hopMap.forEach((value, mid) => {
        if (value?.pairA && value?.pairB) {
          hopPairs.push({ mid, pairA: value.pairA, pairB: value.pairB });
        }
      });
      return { directPair, hopPairs };
    } catch {
      // fall back to direct RPC calls
    }

    const directPair = await factory.getPair(tokenA, tokenB).catch(() => ZERO_ADDRESS);
    const hopPairs = (mids || []).length
      ? await Promise.all(
          mids.map(async (mid) => {
            const pairA = await factory.getPair(tokenA, mid).catch(() => ZERO_ADDRESS);
            if (!pairA || pairA === ZERO_ADDRESS) return null;
            const pairB = await factory.getPair(mid, tokenB).catch(() => ZERO_ADDRESS);
            if (!pairB || pairB === ZERO_ADDRESS) return null;
            return { mid, pairA, pairB };
          })
        )
      : [];
    return {
      directPair,
      hopPairs: hopPairs.filter(Boolean),
    };
  }, []);

  const quoteV3Route = useCallback(
    async (provider, amountWei, routeMeta) => {
      if (!provider || !routeMeta) throw new Error("Missing V3 route.");
      const quoter = new Contract(
        UNIV3_QUOTER_V2_ADDRESS,
        UNIV3_QUOTER_V2_ABI,
        provider
      );
      if (routeMeta.kind === "direct") {
        const params = {
          tokenIn: routeMeta.path[0],
          tokenOut: routeMeta.path[1],
          amountIn: amountWei,
          fee: routeMeta.fees[0],
          sqrtPriceLimitX96: 0,
        };
        const res = await quoter.quoteExactInputSingle.staticCall(params);
        return res?.[0] ?? res?.amountOut;
      }
      const encodedPath = encodeV3Path(routeMeta.path, routeMeta.fees);
      const res = await quoter.quoteExactInput.staticCall(encodedPath, amountWei);
      return res?.[0] ?? res?.amountOut;
    },
    [encodeV3Path]
  );

  const quoteV3RouteExactOut = useCallback(
    async (provider, amountOutWei, routeMeta) => {
      if (!provider || !routeMeta) throw new Error("Missing V3 route.");
      const quoter = new Contract(
        UNIV3_QUOTER_V2_ADDRESS,
        UNIV3_QUOTER_V2_ABI,
        provider
      );
      if (routeMeta.kind === "direct") {
        const params = {
          tokenIn: routeMeta.path[0],
          tokenOut: routeMeta.path[1],
          amount: amountOutWei,
          fee: routeMeta.fees[0],
          sqrtPriceLimitX96: 0,
        };
        const res = await quoter.quoteExactOutputSingle.staticCall(params);
        return res?.[0] ?? res?.amountIn;
      }
      const reversedPath = encodeV3Path(
        [...routeMeta.path].reverse(),
        [...routeMeta.fees].reverse()
      );
      const res = await quoter.quoteExactOutput.staticCall(reversedPath, amountOutWei);
      return res?.[0] ?? res?.amountIn;
    },
    [encodeV3Path]
  );

  const buildRouteKey = useCallback((route) => {
    if (!route) return "";
    const path = Array.isArray(route.path)
      ? route.path.map((p) => (p || "").toLowerCase()).join("-")
      : "";
    const fees = Array.isArray(route.fees) ? route.fees.join("-") : "";
    const protocol = route.protocol || (fees ? "V3" : "V2");
    return `${protocol}:${path}:${fees}`;
  }, []);

  const buildV3RouteCandidates = useCallback(
    async () => {
      if (!hasV3Support) {
        throw new Error("V3 router not configured for this network.");
      }
      const provider = getReadOnlyProvider();
      const factory = new Contract(UNIV3_FACTORY_ADDRESS, UNIV3_FACTORY_ABI, provider);
      const a = sellToken === "ETH" ? WETH_ADDRESS : sellMeta?.address;
      const b = buyToken === "ETH" ? WETH_ADDRESS : buyMeta?.address;
      if (!a || !b) throw new Error("Select tokens with valid addresses.");
      const cacheKey = `v3:${a.toLowerCase()}:${b.toLowerCase()}`;
      const cached = routeCandidateCacheRef.current.get(cacheKey);
      const now = Date.now();
      const ttlMs = 20000;
      if (cached && now - cached.ts < ttlMs) {
        if (cached.promise) return cached.promise;
        if (cached.value) return cached.value;
      }
      const buildPromise = (async () => {
        const candidateMids = getRouteCandidates(a, b);
        const tokenList = [];
        const seen = new Set();
        const pushToken = (token) => {
          if (!token) return;
          const lower = token.toLowerCase();
          if (seen.has(lower)) return;
          seen.add(lower);
          tokenList.push(token);
        };
        pushToken(a);
        pushToken(b);
        candidateMids.forEach(pushToken);
        if (tokenList.length < 2) {
          return { directRoutes: [], hopRoutes: [], multiRoutes: [] };
        }

        const pairs = [];
        for (let i = 0; i < tokenList.length; i += 1) {
          for (let j = i + 1; j < tokenList.length; j += 1) {
            pairs.push([tokenList[i], tokenList[j]]);
          }
        }
        const poolMap = await getV3PoolsForPairs(factory, pairs);
        const feePriorityIndex = new Map(
          V3_FEE_PRIORITY.map((fee, idx) => [fee, idx])
        );
        const getPools = (tokenA, tokenB) =>
          poolMap.get(`${tokenA.toLowerCase()}-${tokenB.toLowerCase()}`) || [];
        const sortPools = (pools) =>
          pools
            .slice()
            .sort(
              (aPool, bPool) =>
                (feePriorityIndex.get(aPool.fee) ?? 999) -
                (feePriorityIndex.get(bPool.fee) ?? 999)
            );

        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const paths = [];
        const queue = [{ path: [a], visited: new Set([aLower]) }];
        while (queue.length && paths.length < MAX_V3_PATHS) {
          const current = queue.shift();
          const path = current.path;
          const visited = current.visited;
          const last = path[path.length - 1];
          const lastLower = last.toLowerCase();
          const hops = path.length - 1;
          if (hops >= MAX_V3_HOPS) continue;
          for (const next of tokenList) {
            const nextLower = next.toLowerCase();
            if (nextLower === lastLower) continue;
            if (visited.has(nextLower)) continue;
            if (!getPools(last, next).length) continue;
            const nextPath = [...path, next];
            if (nextLower === bLower) {
              paths.push(nextPath);
              if (paths.length >= MAX_V3_PATHS) break;
            } else {
              const nextVisited = new Set(visited);
              nextVisited.add(nextLower);
              queue.push({ path: nextPath, visited: nextVisited });
            }
          }
        }

        const routes = [];
        for (const path of paths) {
          if (routes.length >= MAX_V3_ROUTE_CANDIDATES) break;
          const edgePools = [];
          let valid = true;
          for (let i = 0; i < path.length - 1; i += 1) {
            const pools = sortPools(getPools(path[i], path[i + 1]));
            if (!pools.length) {
              valid = false;
              break;
            }
            edgePools.push(pools.slice(0, MAX_V3_FEE_OPTIONS));
          }
          if (!valid) continue;
          let combos = [{ fees: [], pools: [] }];
          for (const edge of edgePools) {
            const nextCombos = [];
            for (const combo of combos) {
              for (const pool of edge) {
                nextCombos.push({
                  fees: [...combo.fees, pool.fee],
                  pools: [...combo.pools, pool.pool],
                });
                if (nextCombos.length >= MAX_V3_COMBOS_PER_PATH) break;
              }
              if (nextCombos.length >= MAX_V3_COMBOS_PER_PATH) break;
            }
            combos = nextCombos;
            if (!combos.length) break;
          }
          if (!combos.length) continue;
          const hopCount = path.length - 1;
          const kind = hopCount === 1 ? "direct" : hopCount === 2 ? "hop" : "multi";
          for (const combo of combos) {
            routes.push({
              kind,
              path,
              pools: combo.pools,
              fees: combo.fees,
            });
            if (routes.length >= MAX_V3_ROUTE_CANDIDATES) break;
          }
        }

        const directRoutes = routes.filter((r) => r.kind === "direct");
        const hopRoutes = routes.filter((r) => r.kind === "hop");
        const multiRoutes = routes.filter((r) => r.kind === "multi");
        return { directRoutes, hopRoutes, multiRoutes };
      })();
      routeCandidateCacheRef.current.set(cacheKey, { ts: now, promise: buildPromise });
      try {
        const result = await buildPromise;
        routeCandidateCacheRef.current.set(cacheKey, { ts: Date.now(), value: result });
        return result;
      } catch (err) {
        routeCandidateCacheRef.current.delete(cacheKey);
        throw err;
      }
    },
    [
      buyMeta?.address,
      buyToken,
      getRouteCandidates,
      getV3PoolsForPairs,
      hasV3Support,
      sellMeta?.address,
      sellToken,
    ]
  );

  const buildV3Route = useCallback(
    async (opts = {}) => {
      if (!hasV3Support) {
        throw new Error("V3 router not configured for this network.");
      }
      const { amountWei } = opts;
      const provider = getReadOnlyProvider();
      const a = sellToken === "ETH" ? WETH_ADDRESS : sellMeta?.address;
      const b = buyToken === "ETH" ? WETH_ADDRESS : buyMeta?.address;
      if (!a || !b) throw new Error("Select tokens with valid addresses.");

      const { directRoutes, hopRoutes, multiRoutes } = await buildV3RouteCandidates();
      const candidates = [...directRoutes, ...hopRoutes, ...multiRoutes];
      if (!candidates.length) {
        throw new Error("No V3 pools found for this pair.");
      }
      if (!amountWei || amountWei <= 0n) {
        return candidates[0];
      }
      const quoted = await Promise.all(
        candidates.map(async (route) => {
          try {
            const amountOut = await quoteV3Route(provider, amountWei, route);
            return { ...route, amountOut };
          } catch {
            return null;
          }
        })
      );
      const valid = quoted.filter(Boolean);
      if (!valid.length) throw new Error("No V3 route available for this pair.");
      const best = valid.reduce((acc, next) => {
        if (!acc) return next;
        return next.amountOut > acc.amountOut ? next : acc;
      }, null);
      if (!best) throw new Error("No V3 route available for this pair.");
      const { amountOut: _amountOut, ...rest } = best;
      return rest;
    },
    [
      buyMeta?.address,
      buyToken,
      buildV3RouteCandidates,
      hasV3Support,
      quoteV3Route,
      sellMeta?.address,
      sellToken,
    ]
  );
  const quoteV2Route = useCallback(
    async (provider, amountWei, routeMeta) => {
      if (!provider || !routeMeta?.path) throw new Error("Missing V2 route.");
      if (routeMeta.kind === "direct") {
        const meta = await getV2QuoteWithMeta(
          provider,
          amountWei,
          routeMeta.path[0],
          routeMeta.path[1]
        );
        return {
          amountOut: meta.amountOut,
          priceImpact: meta.priceImpactPct ?? null,
          pairs: [meta.pairAddress].filter(Boolean),
        };
      }
      const amountOut = await getV2Quote(provider, amountWei, routeMeta.path);
      return {
        amountOut,
        priceImpact: null,
        pairs: routeMeta.pairs || [],
      };
    },
    []
  );

  const quoteV2RouteExactOut = useCallback(
    async (provider, amountOutWei, routeMeta) => {
      if (!provider || !routeMeta?.path) throw new Error("Missing V2 route.");
      const router = new Contract(
        UNIV2_ROUTER_ADDRESS,
        UNIV2_ROUTER_ABI,
        provider
      );
      const res = await router.getAmountsIn(amountOutWei, routeMeta.path);
      const amounts = res?.amounts || res || [];
      const amountIn = amounts?.[0];
      if (!amountIn) throw new Error("No V2 exact output quote.");
      return {
        amountIn,
        pairs: routeMeta.pairs || [],
      };
    },
    []
  );

  const buildV2RouteCandidates = useCallback(
    async () => {
      if (!hasV2Support) {
        throw new Error("V2 support not configured for this network.");
      }
      const provider = getReadOnlyProvider();
      const factory = new Contract(UNIV2_FACTORY_ADDRESS, UNIV2_FACTORY_ABI, provider);
      const a = sellToken === "ETH" ? WETH_ADDRESS : sellMeta?.address;
      const b = buyToken === "ETH" ? WETH_ADDRESS : buyMeta?.address;
      if (!a || !b) throw new Error("Select tokens with valid addresses.");
      const cacheKey = `v2:${a.toLowerCase()}:${b.toLowerCase()}`;
      const cached = routeCandidateCacheRef.current.get(cacheKey);
      const now = Date.now();
      const ttlMs = 20000;
      if (cached && now - cached.ts < ttlMs) {
        if (cached.promise) return cached.promise;
        if (cached.value) return cached.value;
      }
      const buildPromise = (async () => {
        const candidateMids = getRouteCandidates(a, b);
        const { directPair, hopPairs } = await getV2PairsForMids(
          factory,
          a,
          b,
          candidateMids
        );
        const hasDirect = directPair && directPair !== ZERO_ADDRESS;
        const directRoute = hasDirect
          ? {
              protocol: "V2",
              kind: "direct",
              path: [a, b],
              pairs: [directPair].filter(Boolean),
            }
          : null;

        const hopRoutes = (hopPairs || []).map((pair) => ({
          protocol: "V2",
          kind: "hop",
          path: [a, pair.mid, b],
          pairs: [pair.pairA, pair.pairB],
        }));

        return { directRoute, hopRoutes };
      })();
      routeCandidateCacheRef.current.set(cacheKey, { ts: now, promise: buildPromise });
      try {
        const result = await buildPromise;
        routeCandidateCacheRef.current.set(cacheKey, { ts: Date.now(), value: result });
        return result;
      } catch (err) {
        routeCandidateCacheRef.current.delete(cacheKey);
        throw err;
      }
    },
    [
      buyMeta?.address,
      buyToken,
      getRouteCandidates,
      getV2PairsForMids,
      hasV2Support,
      sellMeta?.address,
      sellToken,
    ]
  );
  const buildV2Route = useCallback(
    async (opts = {}) => {
      if (!hasV2Support) {
        throw new Error("V2 support not configured for this network.");
      }
      const { amountWei } = opts;
      const provider = getReadOnlyProvider();
      const factory = new Contract(UNIV2_FACTORY_ADDRESS, UNIV2_FACTORY_ABI, provider);
      const a = sellToken === "ETH" ? WETH_ADDRESS : sellMeta?.address;
      const b = buyToken === "ETH" ? WETH_ADDRESS : buyMeta?.address;
      if (!a || !b) throw new Error("Select tokens with valid addresses.");

      const candidateMids = getRouteCandidates(a, b);
      const { directPair, hopPairs } = await getV2PairsForMids(
        factory,
        a,
        b,
        candidateMids
      );
      const hasDirect = directPair && directPair !== ZERO_ADDRESS;
      const hopRoutes = (hopPairs || []).map((pair) => ({
        protocol: "V2",
        kind: "hop",
        path: [a, pair.mid, b],
        pairs: [pair.pairA, pair.pairB],
      }));
      const hasHop = hopRoutes.length > 0;

      if (!hasDirect && !hasHop) {
        throw new Error("No V2 pools found for this pair.");
      }

      const directRoute = hasDirect
        ? {
            protocol: "V2",
            kind: "direct",
            path: [a, b],
            pairs: [directPair].filter(Boolean),
          }
        : null;

      if (!amountWei) {
        return directRoute || hopRoutes[0];
      }

      const candidateRoutes = [
        ...(directRoute ? [directRoute] : []),
        ...hopRoutes,
      ];
      const quoted = await Promise.all(
        candidateRoutes.map(async (route) => {
          try {
            const quote = await quoteV2Route(provider, amountWei, route);
            if (!quote?.amountOut) return null;
            return {
              ...route,
              amountOut: quote.amountOut,
              priceImpact: quote.priceImpact,
              pairs: quote.pairs || route.pairs,
            };
          } catch {
            return null;
          }
        })
      );
      const valid = quoted.filter(Boolean);
      if (!valid.length) throw new Error("No V2 route available for this pair.");
      return valid.reduce((best, next) => {
        if (!best) return next;
        return next.amountOut > best.amountOut ? next : best;
      }, null);
    },
    [
      buyMeta?.address,
      buyToken,
      getRouteCandidates,
      getV2PairsForMids,
      hasV2Support,
      quoteV2Route,
      sellMeta?.address,
      sellToken,
    ]
  );
  const isDirectEthWeth =
    (sellToken === "ETH" && buyToken === "WETH") ||
    (sellToken === "WETH" && buyToken === "ETH");
  const isSupported =
    Boolean(sellMeta?.address || sellToken === "ETH") &&
    Boolean(buyMeta?.address || buyToken === "ETH");
  const isExactOut = swapInputMode === "out";
  const sellInputDecimals = sellToken === "ETH" ? 18 : sellMeta?.decimals ?? 18;
  const buyInputDecimals = buyToken === "ETH" ? 18 : buyMeta?.decimals ?? 18;
  const activeInputAmount = isExactOut ? amountOutInput : amountIn;

  useEffect(() => {
    let cancelled = false;
    const symbol = (sellToken || "").toUpperCase();
    const addr = sellToken === "ETH" ? WETH_ADDRESS : sellMeta?.address;
    const addrLower = addr ? addr.toLowerCase() : "";
    if (!addr) {
      setSellTokenUsd(null);
      setSellTokenUsdLoading(false);
      return () => {
        cancelled = true;
      };
    }
    if (STABLE_SYMBOLS.has(symbol)) {
      setSellTokenUsd(1);
      setSellTokenUsdLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const cachedRegistryPrices =
      queryClient.getQueryData(["token-prices", "registry"]) || null;
    const cachedPrice = cachedRegistryPrices?.[addrLower];
    if (!cancelled && Number.isFinite(cachedPrice)) {
      setSellTokenUsd(cachedPrice);
      setSellTokenUsdLoading(false);
    } else {
      setSellTokenUsdLoading(true);
    }
    fetchTokenPrices([addr])
      .then((prices) => {
        if (cancelled) return;
        const price = prices?.[addrLower];
        const nextPrice = Number.isFinite(price) ? price : null;
        setSellTokenUsd(nextPrice);
        if (nextPrice !== null) {
          const merged = {
            ...(cachedRegistryPrices || {}),
            [addrLower]: nextPrice,
          };
          queryClient.setQueryData(["token-prices", "registry"], merged);
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (!Number.isFinite(cachedPrice)) {
          setSellTokenUsd(null);
        }
      })
      .finally(() => {
        if (!cancelled) setSellTokenUsdLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient, sellToken, sellMeta?.address]);

  useEffect(() => {
    if (!amountIn) return;
    const next = sanitizeAmountInput(amountIn, sellInputDecimals);
    if (next !== amountIn) setAmountIn(next);
  }, [amountIn, sellInputDecimals]);

  useEffect(() => {
    if (!amountOutInput) return;
    const next = sanitizeAmountInput(amountOutInput, buyInputDecimals);
    if (next !== amountOutInput) setAmountOutInput(next);
  }, [amountOutInput, buyInputDecimals]);

  useEffect(() => {
    if (urlAppliedRef.current) return;
    if (typeof window === "undefined") return;
    if (!urlParamsRef.current) {
      const params = new URLSearchParams(window.location.search || "");
      const inputRaw = getQueryParamInsensitive(params, "inputCurrency");
      const outputRaw = getQueryParamInsensitive(params, "outputCurrency");
      const exactAmountRaw = getQueryParamInsensitive(params, "exactAmount");
      const exactFieldRaw = getQueryParamInsensitive(params, "exactField");
      if (!inputRaw && !outputRaw && !exactAmountRaw && !exactFieldRaw) {
        urlAppliedRef.current = true;
        return;
      }
      urlParamsRef.current = { inputRaw, outputRaw, exactAmountRaw, exactFieldRaw };
    }

    let cancelled = false;
    const applyParams = async () => {
      const { inputRaw, outputRaw } = urlParamsRef.current || {};
      const inputSymbol = await resolveTokenParam(inputRaw);
      const outputSymbol = await resolveTokenParam(outputRaw);
      if (cancelled) return;
      if (inputSymbol === "__PENDING__" || outputSymbol === "__PENDING__") return;
      const { exactAmountRaw, exactFieldRaw } = urlParamsRef.current || {};
      const exactField = normalizeExactField(exactFieldRaw) || "in";
      const exactAmount = exactAmountRaw ? String(exactAmountRaw).trim() : "";
      if (!inputSymbol && !outputSymbol && !exactAmount) {
        urlAppliedRef.current = true;
        return;
      }
      const next = resolveSwapTokenPair(
        sellToken,
        buyToken,
        inputSymbol,
        outputSymbol
      );
      if (next.sell && next.sell !== sellToken) setSellToken(next.sell);
      if (next.buy && next.buy !== buyToken) setBuyToken(next.buy);
      if (exactAmount) {
        if (exactField === "out") {
          setSwapInputMode("out");
          setAmountOutInput(sanitizeAmountInput(exactAmount, buyInputDecimals));
          setAmountIn("");
        } else {
          setSwapInputMode("in");
          setAmountIn(sanitizeAmountInput(exactAmount, sellInputDecimals));
          setAmountOutInput("");
        }
      }
      urlAppliedRef.current = true;
    };
    void applyParams();
    return () => {
      cancelled = true;
    };
  }, [
    amountOutInput,
    buyInputDecimals,
    buyToken,
    resolveTokenParam,
    sellInputDecimals,
    sellToken,
  ]);

  useEffect(() => {
    lastFullQuoteAtRef.current = 0;
    lastRouteMetaRef.current = null;
    lastRouteKeyRef.current = "";
  }, [sellToken, buyToken, routePreference, swapInputMode]);

  const handleSelectToken = (symbol) => {
    if (!symbol) return;
    if (selectorOpen === "sell") {
      if (symbol === buyToken) setBuyToken(sellToken);
      setSellToken(symbol);
    } else if (selectorOpen === "buy") {
      if (symbol === sellToken) setSellToken(buyToken);
      setBuyToken(symbol);
    }
    setSelectorOpen(null);
    setTokenSearch("");
  };

  const closeSelector = () => {
    setSelectorOpen(null);
    setTokenSearch("");
  };

  const triggerQuoteLock = useCallback((ms = 4500) => {
    const until = Date.now() + ms;
    setQuoteLockedUntil(until);
    if (quoteLockTimerRef.current) {
      clearTimeout(quoteLockTimerRef.current);
      quoteLockTimerRef.current = null;
    }
    quoteLockTimerRef.current = setTimeout(() => {
      setQuoteLockedUntil(0);
      quoteLockTimerRef.current = null;
    }, ms);
  }, []);

  useEffect(() => () => {
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    if (quoteLockTimerRef.current) {
      clearTimeout(quoteLockTimerRef.current);
      quoteLockTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!lastQuoteAt) {
      setQuoteAgeLabel("--");
      return undefined;
    }
    const updateLabel = () => setQuoteAgeLabel(formatRelativeTime(lastQuoteAt));
    updateLabel();
    const id = setInterval(updateLabel, 1000);
    return () => clearInterval(id);
  }, [lastQuoteAt]);

  const displayRoute = useMemo(() => {
    if (!quoteRoute.length) return [];
    return quoteRoute.map((addrOrSymbol) => {
      const lower = (addrOrSymbol || "").toLowerCase();
      const metaByAddr =
        typeof addrOrSymbol === "string" && addrOrSymbol.startsWith("0x")
          ? Object.values(tokenRegistry).find(
              (t) => t.address && t.address.toLowerCase() === lower
            )
          : null;
      const label =
        typeof addrOrSymbol === "string" && addrOrSymbol.startsWith("0x")
          ? routeSymbol(metaByAddr, "Token")
          : addrOrSymbol;
      return label || "Token";
    });
  }, [quoteRoute, tokenRegistry]);
  const resolveRouteToken = useCallback(
    (value) => {
      if (!value) return { symbol: "Token", meta: null };
      if (typeof value === "string" && value.startsWith("0x")) {
        const lower = value.toLowerCase();
        const meta = Object.values(tokenRegistry).find(
          (t) => t.address && t.address.toLowerCase() === lower
        );
        const symbol = routeSymbol(meta, shortenAddress(value));
        return { symbol, meta };
      }
      const meta = tokenRegistry[value] || null;
      return { symbol: routeSymbol(meta, value), meta };
    },
    [tokenRegistry]
  );
  const routeSegments = useMemo(() => {
    if (isDirectEthWeth) {
      return [
        {
          protocol: "WRAP",
          sharePct: 100,
          hops: [
            {
              protocol: "WRAP",
              fee: null,
              pool: null,
              from: resolveRouteToken(sellToken),
              to: resolveRouteToken(buyToken),
            },
          ],
        },
      ];
    }
    if (!quoteMeta) return [];

    const buildSegment = (route, sharePct = 100) => {
      if (!route) return null;
      const path = Array.isArray(route.path) ? route.path : [];
      const fees = Array.isArray(route.fees) ? route.fees : [];
      const pools = Array.isArray(route.pools) ? route.pools : [];
      const pairs = Array.isArray(route.pairs) ? route.pairs : [];
      const protocol = route.protocol || (fees.length ? "V3" : "V2");
      const hops = [];
      if (path.length >= 2) {
        const hopCount = path.length - 1;
        for (let i = 0; i < hopCount; i += 1) {
          hops.push({
            protocol,
            fee: protocol === "V3" ? fees[i] : 3000,
            pool: protocol === "V3" ? pools[i] || null : pairs[i] || null,
            from: resolveRouteToken(path[i]),
            to: resolveRouteToken(path[i + 1]),
          });
        }
      }
      return {
        protocol,
        sharePct,
        hops,
        kind: route.kind,
      };
    };

    if (quoteMeta.protocol === "SPLIT" && Array.isArray(quoteMeta.routes)) {
      return quoteMeta.routes
        .map((route) => buildSegment(route, route.sharePct ?? 50))
        .filter(Boolean);
    }

    const single = buildSegment(quoteMeta, 100);
    return single ? [single] : [];
  }, [buyToken, isDirectEthWeth, quoteMeta, resolveRouteToken, sellToken]);
  const routeModeLabel = isDirectEthWeth
    ? "Wrap/Unwrap"
    : quoteMeta?.protocol === "SPLIT"
      ? "Split"
      : quoteMeta?.kind === "direct"
        ? "Direct"
        : quoteMeta?.kind === "hop"
          ? "2-hop"
          : quoteMeta?.kind === "multi"
            ? "Multi-hop"
            : "";
  const splitProtocolLabel = useMemo(() => {
    if (quoteMeta?.protocol !== "SPLIT") return null;
    const legs = Array.isArray(quoteMeta.routes) ? quoteMeta.routes : [];
    const hasV2 = legs.some((leg) => leg?.protocol === "V2");
    const hasV3 = legs.some((leg) => leg?.protocol === "V3");
    if (hasV2 && hasV3) return "V2 + V3";
    if (hasV3) return "V3";
    if (hasV2) return "V2";
    return "Split";
  }, [quoteMeta]);

  // Re-run quotes when LP reserves move (Sync events via miniBlocks)
  useEffect(() => {
    const pairs = (quotePairs || []).filter(Boolean);
    if (!pairs.length) return undefined;
    const watched = new Set(pairs.map((p) => p.toLowerCase()));
    const client = getRealtimeClient();

    const handleMini = (mini) => {
      const receipts = mini?.receipts;
      if (!Array.isArray(receipts)) return;
      for (let i = 0; i < receipts.length; i += 1) {
        const logs = receipts[i]?.logs;
        if (!Array.isArray(logs)) continue;
        for (let j = 0; j < logs.length; j += 1) {
          const log = logs[j];
          const addr = (log?.address || "").toLowerCase();
          if (!watched.has(addr)) continue;
          const topic0 = (log?.topics?.[0] || "").toLowerCase();
          if (topic0 !== SYNC_TOPIC) continue;
          setLiveRouteTick((t) => t + 1);
          return;
        }
      }
    };

    const unsubscribe = client.addMiniBlockListener(handleMini);
    return unsubscribe;
  }, [quotePairs]);

  useEffect(() => {
    // periodic auto-refresh of quote while amount is set and supported
    if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }
    const start = () => {
      if (autoRefreshTimerRef.current) return;
      if (!activeInputAmount || Number.isNaN(Number(activeInputAmount)) || !isSupported) {
        return;
      }
      autoRefreshTimerRef.current = setInterval(() => {
        setLiveRouteTick((t) => t + 1);
      }, 3000);
    };
    const stop = () => {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
    };
    start();
    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
        setLiveRouteTick((t) => t + 1); // immediate refresh on focus
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, [activeInputAmount, isSupported]);

  useEffect(() => {
    let cancelled = false;
    if (quoteDebounceRef.current) {
      clearTimeout(quoteDebounceRef.current);
      quoteDebounceRef.current = null;
    }
    const fetchQuote = async () => {
      const resetQuoteState = () => {
        setQuoteOut(null);
        setQuoteOutRaw(null);
        setPriceImpact(null);
        setApprovalTargets([]);
        setQuoteRoute([]);
        setQuotePairs([]);
        setQuoteMeta(null);
        setLastQuoteAt(null);
        lastQuoteOutRef.current = null;
      };
      if (!isChainMatch) {
        setQuoteError("Wallet network differs from selected network. Switch network to quote.");
        resetQuoteState();
        return;
      }
      const now = Date.now();
      if (quoteLockedUntil && now < quoteLockedUntil) {
        return;
      }
      setQuoteError("");
      if (
        !activeInputAmount ||
        Number.isNaN(Number(activeInputAmount)) ||
        isIncompleteAmount(activeInputAmount)
      ) {
        resetQuoteState();
        return;
      }
      if (!isSupported) {
        setQuoteError("Select tokens with valid addresses.");
        resetQuoteState();
        return;
      }
      if (!hasV3Support && !enableV2Routing) {
        setQuoteError("No router configured for this network.");
        resetQuoteState();
        return;
      }
      if (routePreference === "v2" && !enableV2Routing) {
        setQuoteError("V2 support not configured for this network.");
        resetQuoteState();
        return;
      }
      if (routePreference === "v3" && !hasV3Support) {
        setQuoteError("V3 router not configured for this network.");
        resetQuoteState();
        return;
      }
      if (
        routePreference === "split" &&
        (!hasV3Support || (allowV2Routing && !hasV2Support))
      ) {
        setQuoteError(
          allowV2Routing
            ? "Split routing requires both V2 and V3 routers."
            : "Split routing requires V3 support."
        );
        resetQuoteState();
        return;
      }

      if (isDirectEthWeth) {
        const sellDecimals = sellMeta?.decimals ?? 18;
        const buyDecimals = buyMeta?.decimals ?? 18;
        const directAmount = isExactOut ? amountOutInput : amountIn;
        const directWei = safeParseUnits(
          directAmount,
          isExactOut ? buyDecimals : sellDecimals
        );
        if (!directWei) {
          setQuoteError("Invalid amount format. Use dot for decimals.");
          resetQuoteState();
          return;
        }
        const formattedIn = trimTrailingZeros(formatUnits(directWei, sellDecimals));
        const formattedOut = trimTrailingZeros(formatUnits(directWei, buyDecimals));
        if (isExactOut) {
          setAmountIn(formattedIn);
        }
        setQuoteOut(isExactOut ? formattedOut : formattedOut);
        setQuoteOutRaw(directWei);
        setPriceImpact(0);
        // Direct wrap/unwrap never needs approvals; reset any previous state.
        setApprovalTargets([]);
        setQuoteRoute([sellToken, buyToken]);
        setQuotePairs([]);
        setQuoteMeta(null);
        setLastQuoteAt(Date.now());
        return;
      }

      quoteDebounceRef.current = setTimeout(async () => {
        let inFlightSet = false;
        try {
          const quoteKey = `${sellToken}-${buyToken}-${swapInputMode}-${amountIn}-${amountOutInput}-${routePreference}`;
          if (quoteInFlightRef.current && quoteKey === lastQuoteKeyRef.current) {
            return;
          }
          quoteInFlightRef.current = true;
          inFlightSet = true;
          lastQuoteKeyRef.current = quoteKey;
          const hadQuote = lastQuoteOutRef.current !== null;
          if (!hadQuote) {
            setQuoteLoading(true);
          } else {
            setQuoteLoading(false);
          }
          const provider = address
            ? getReadOnlyProvider()
            : getReadOnlyProvider(false, true);
          const sellAddress = sellToken === "ETH" ? WETH_ADDRESS : sellMeta?.address;
          const buyAddress = buyToken === "ETH" ? WETH_ADDRESS : buyMeta?.address;
          if (!sellAddress || !buyAddress) {
            setQuoteError("Select tokens with valid addresses.");
            return;
          }
          const sellDecimals = requireDecimals(sellToken, sellMeta);
          const buyDecimals = requireDecimals(buyToken, buyMeta);
          const amountWei = isExactOut
            ? null
            : safeParseUnits(amountIn, sellDecimals);
          const desiredOutWei = isExactOut
            ? safeParseUnits(amountOutInput || "0", buyDecimals)
            : null;
          if (!isExactOut && !amountWei) {
            setQuoteError("Invalid amount format. Use dot for decimals.");
            return;
          }
          if (isExactOut && !desiredOutWei) {
            setQuoteError("Invalid amount format. Use dot for decimals.");
            return;
          }
          const routeKey = `${sellAddress.toLowerCase()}-${buyAddress.toLowerCase()}-${routePreference}-${swapInputMode}`;
          const sellLower = sellAddress.toLowerCase();
          const buyLower = buyAddress.toLowerCase();

          const applyQuoteFromRoute = (selectedRoute, markFull = false) => {
            const amountOut = selectedRoute?.amountOut;
            if (!amountOut) {
              setQuoteError("Unable to compute quote.");
              return;
            }

            const formattedOut = trimTrailingZeros(formatUnits(amountOut, buyDecimals));
            setQuoteOut(formattedOut);
            setQuoteOutRaw(amountOut);
            setQuoteMeta(selectedRoute);
            setQuoteRoute(selectedRoute.path || [sellToken, buyToken]);
            if (isExactOut && selectedRoute.amountIn) {
              const formattedIn = trimTrailingZeros(
                formatUnits(selectedRoute.amountIn, sellDecimals)
              );
              if (formattedIn && formattedIn !== amountIn) {
                setAmountIn(formattedIn);
              }
            }

            const v2Pairs =
              selectedRoute.protocol === "V2"
                ? selectedRoute.pairs || []
                : selectedRoute.protocol === "SPLIT"
                  ? (selectedRoute.routes || [])
                      .filter((r) => r.protocol === "V2")
                      .flatMap((r) => r.pairs || [])
                  : [];
            setQuotePairs(v2Pairs);

            setLastQuoteAt(Date.now());
            lastQuoteOutRef.current = amountOut;

            const routeImpact =
              selectedRoute.estimatedSlippage ??
              selectedRoute.priceImpact ??
              null;
            setPriceImpact(routeImpact);
            const resolvedAmountInWei = isExactOut
              ? selectedRoute.amountIn
              : amountWei;

            lastRouteMetaRef.current = selectedRoute;
            lastRouteKeyRef.current = routeKey;
            if (markFull) {
              lastFullQuoteAtRef.current = Date.now();
            }

            if (allowanceDebounceRef.current) {
              clearTimeout(allowanceDebounceRef.current);
              allowanceDebounceRef.current = null;
            }
            if (!isDirectEthWeth && sellToken !== "ETH" && sellAddress) {
              if (!resolvedAmountInWei || resolvedAmountInWei <= 0n) {
                if (!cancelled) setApprovalTargets([]);
                return;
              }
              allowanceDebounceRef.current = setTimeout(async () => {
                try {
                  const user = address;
                  if (!user) {
                    if (cancelled) return;
                    setApprovalTargets([]);
                    return;
                  }
                  const readProvider = getReadOnlyProvider(false, true);
                  const token = new Contract(sellAddress, ERC20_ABI, readProvider);
                  const desiredErc20Allowance = MAX_UINT256;
                  const desiredPermit2Allowance = MAX_UINT160;
                  const permit2Expiration = MAX_UINT48;

                  const targets = [];
                  const checkErc20 = async (spender) => {
                    if (!spender) return;
                    const cached = getCachedApproval("erc20", sellAddress, spender);
                    if (cached && cached.amount >= resolvedAmountInWei) return;
                    const allowance = await token.allowance(user, spender);
                    if (allowance < resolvedAmountInWei) {
                      targets.push({
                        symbol: sellToken,
                        address: sellAddress,
                        desiredAllowance: desiredErc20Allowance,
                        spender,
                        kind: "erc20",
                      });
                    } else {
                      setCachedApproval({
                        symbol: sellToken,
                        address: sellAddress,
                        desiredAllowance: allowance,
                        spender,
                        kind: "erc20",
                      });
                    }
                  };
                  const permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, readProvider);
                  const checkPermit2 = async (spender) => {
                    if (!spender) return;
                    const cached = getCachedApproval("permit2", sellAddress, spender);
                    if (cached) {
                      const now = BigInt(Math.floor(Date.now() / 1000));
                      const expired = !cached.expiration || cached.expiration < now;
                      if (!expired && cached.amount >= resolvedAmountInWei) return;
                    }
                    const res = await permit2.allowance(user, sellAddress, spender);
                    const allowanceRaw = res?.amount ?? res?.[0] ?? 0n;
                    const expirationRaw = res?.expiration ?? res?.[1] ?? 0n;
                    const allowance =
                      typeof allowanceRaw === "bigint"
                        ? allowanceRaw
                        : BigInt(allowanceRaw || 0);
                    const expiration =
                      typeof expirationRaw === "bigint"
                        ? expirationRaw
                        : BigInt(expirationRaw || 0);
                    const now = BigInt(Math.floor(Date.now() / 1000));
                    const expired = !expiration || expiration < now;
                    if (allowance < resolvedAmountInWei || expired) {
                      targets.push({
                        symbol: sellToken,
                        address: sellAddress,
                        desiredAllowance: desiredPermit2Allowance,
                        spender,
                        kind: "permit2",
                        expiration: permit2Expiration,
                      });
                    } else {
                      setCachedApproval({
                        symbol: sellToken,
                        address: sellAddress,
                        desiredAllowance: allowance,
                        spender,
                        kind: "permit2",
                        expiration,
                      });
                    }
                  };

                  if (
                    selectedRoute.protocol === "V2" ||
                    selectedRoute.protocol === "V3" ||
                    selectedRoute.protocol === "SPLIT"
                  ) {
                    await checkErc20(PERMIT2_ADDRESS);
                    await checkPermit2(UNIV3_UNIVERSAL_ROUTER_ADDRESS);
                  }

                  if (cancelled) return;
                  setApprovalTargets(targets);
                } catch {
                  if (cancelled) return;
                  setApprovalTargets([]);
                }
              }, 200);
            } else {
              if (cancelled) return;
              setApprovalTargets([]);
            }
          };

          const isRouteCompatible = (route) => {
            if (!route) return false;
            const protocol = route.protocol || (route.fees ? "V3" : "V2");
            if (protocol === "SPLIT") {
              if (!Array.isArray(route.routes) || !route.routes.length) return false;
              return route.routes.every((leg) => {
                const path = Array.isArray(leg?.path) ? leg.path : [];
                if (path.length < 2) return false;
                const start = (path[0] || "").toLowerCase();
                const end = (path[path.length - 1] || "").toLowerCase();
                return start === sellLower && end === buyLower;
              });
            }
            const path = Array.isArray(route.path) ? route.path : [];
            if (path.length < 2) return false;
            const start = (path[0] || "").toLowerCase();
            const end = (path[path.length - 1] || "").toLowerCase();
            return start === sellLower && end === buyLower;
          };

          const fastQuoteRoute = async (route) => {
            if (!route) return null;
            const protocol = route.protocol || (route.fees ? "V3" : "V2");
            if (protocol === "SPLIT") {
              if (isExactOut) return null;
              if (!amountWei || amountWei <= 0n) return null;
              const legs = Array.isArray(route.routes) ? route.routes : [];
              if (!legs.length) return null;
              let remaining = amountWei;
              let totalOut = 0n;
              const updatedLegs = [];
              for (let i = 0; i < legs.length; i += 1) {
                const leg = legs[i];
                if (!leg) continue;
                let legAmountIn = leg.amountIn;
                if (!legAmountIn || legAmountIn <= 0n) {
                  const sharePct = Number.isFinite(leg.sharePct)
                    ? leg.sharePct
                    : 100 / legs.length;
                  const shareBps = Math.max(0, Math.min(10000, Math.round(sharePct * 100)));
                  if (i === legs.length - 1) {
                    legAmountIn = remaining;
                  } else {
                    legAmountIn = (amountWei * BigInt(shareBps)) / 10000n;
                    remaining -= legAmountIn;
                  }
                }
                if (!legAmountIn || legAmountIn <= 0n) continue;
                let legOut = null;
                let legPairs = leg.pairs || [];
                if (leg.protocol === "V3") {
                  legOut = await quoteV3Route(provider, legAmountIn, leg);
                } else if (leg.protocol === "V2") {
                  const v2Quote = await quoteV2Route(provider, legAmountIn, leg);
                  legOut = v2Quote?.amountOut ?? null;
                  legPairs = v2Quote?.pairs || legPairs;
                }
                if (!legOut || legOut <= 0n) continue;
                totalOut += legOut;
                updatedLegs.push({
                  ...leg,
                  amountIn: legAmountIn,
                  amountOut: legOut,
                  pairs: legPairs,
                });
              }
              if (!totalOut || !updatedLegs.length) return null;
              return {
                ...route,
                protocol: "SPLIT",
                amountOut: totalOut,
                routes: updatedLegs,
              };
            }
            if (protocol === "V3") {
              if (isExactOut) {
                if (!desiredOutWei || desiredOutWei <= 0n) return null;
                const amountIn = await quoteV3RouteExactOut(
                  provider,
                  desiredOutWei,
                  route
                );
                return {
                  ...route,
                  protocol: "V3",
                  amountIn,
                  amountOut: desiredOutWei,
                };
              }
              if (!amountWei || amountWei <= 0n) return null;
              const amountOut = await quoteV3Route(provider, amountWei, route);
              return { ...route, protocol: "V3", amountOut };
            }
            if (protocol === "V2") {
              if (isExactOut) {
                if (!desiredOutWei || desiredOutWei <= 0n) return null;
                const v2Quote = await quoteV2RouteExactOut(
                  provider,
                  desiredOutWei,
                  route
                );
                return {
                  ...route,
                  protocol: "V2",
                  amountIn: v2Quote.amountIn,
                  amountOut: desiredOutWei,
                  pairs: v2Quote.pairs || route.pairs,
                };
              }
              if (!amountWei || amountWei <= 0n) return null;
              const v2Quote = await quoteV2Route(provider, amountWei, route);
              return {
                ...route,
                protocol: "V2",
                amountOut: v2Quote.amountOut,
                priceImpact: v2Quote.priceImpact,
                pairs: v2Quote.pairs || route.pairs,
              };
            }
            return null;
          };

          const nowTs = Date.now();
          const cachedRoute = lastRouteMetaRef.current;
          const shouldFullQuote =
            !cachedRoute ||
            lastRouteKeyRef.current !== routeKey ||
            nowTs - lastFullQuoteAtRef.current > 3000;

          if (cachedRoute && isRouteCompatible(cachedRoute)) {
            const fastRoute = await fastQuoteRoute(cachedRoute);
            if (fastRoute) {
              applyQuoteFromRoute(fastRoute, false);
              if (!shouldFullQuote) {
                return;
              }
            }
          }

          const quoteBudgetStart = Date.now();
          const withinQuoteBudget = () =>
            Date.now() - quoteBudgetStart < FAST_QUOTE_BUDGET_MS;
          const buildPrioritizedV3Routes = (candidates) => {
            const directRoutes = candidates?.directRoutes || [];
            const hopRoutes = candidates?.hopRoutes || [];
            const multiRoutes = candidates?.multiRoutes || [];
            const ordered = [];
            let seen = new Set();
            const pushRoute = (route, hopLimit) => {
              if (!route) return;
              if (Number.isFinite(hopLimit)) {
                const hopCount = Array.isArray(route.path)
                  ? Math.max(0, route.path.length - 1)
                  : 0;
                if (hopCount > hopLimit) return;
              }
              const key = buildRouteKey(route);
              if (seen.has(key)) return;
              seen.add(key);
              ordered.push(route);
            };
            const fill = (hopLimit) => {
              pushRoute(directRoutes[0], hopLimit);
              pushRoute(hopRoutes[0], hopLimit);
              pushRoute(multiRoutes[0], hopLimit);
              [...directRoutes, ...hopRoutes, ...multiRoutes].forEach((route) =>
                pushRoute(route, hopLimit)
              );
            };
            // Fast phase: only allow up to 2 hops (direct/2-hop). If nothing found, allow all.
            fill(2);
            if (!ordered.length) {
              seen = new Set();
              fill(null);
            }
            return ordered.slice(0, MAX_V3_QUOTES);
          };
          const quoteV3ExactInWithBudget = async (routes, amountInWei) => {
            if (!routes.length) return [];
            const results = [];
            for (let i = 0; i < routes.length; i += V3_QUOTE_BATCH_SIZE) {
              if (i > 0 && !withinQuoteBudget()) break;
              const batch = routes.slice(i, i + V3_QUOTE_BATCH_SIZE);
              const quoted = await Promise.all(
                batch.map(async (route) => {
                  try {
                    const amountOut = await quoteV3Route(provider, amountInWei, route);
                    return { ...route, protocol: "V3", amountOut };
                  } catch {
                    return null;
                  }
                })
              );
              results.push(...quoted.filter(Boolean));
              if (!withinQuoteBudget()) break;
            }
            return results;
          };
          const quoteV3ExactOutWithBudget = async (routes, amountOutWei) => {
            if (!routes.length) return [];
            const results = [];
            for (let i = 0; i < routes.length; i += V3_QUOTE_BATCH_SIZE) {
              if (i > 0 && !withinQuoteBudget()) break;
              const batch = routes.slice(i, i + V3_QUOTE_BATCH_SIZE);
              const quoted = await Promise.all(
                batch.map(async (route) => {
                  try {
                    const amountIn = await quoteV3RouteExactOut(
                      provider,
                      amountOutWei,
                      route
                    );
                    return {
                      ...route,
                      protocol: "V3",
                      amountIn,
                      amountOut: amountOutWei,
                    };
                  } catch {
                    return null;
                  }
                })
              );
              results.push(...quoted.filter(Boolean));
              if (!withinQuoteBudget()) break;
            }
            return results;
          };

          let v3Route = null;
          let v2Route = null;
          let splitRoute = null;
          const shouldTryV3Routes = hasV3Support && routePreference !== "v2";
          const shouldTryV2Routes = enableV2Routing && routePreference !== "v3";
          const deferV2InSmartMode =
            SMART_MODE_V2_FALLBACK_ONLY &&
            routePreference === "smart" &&
            shouldTryV3Routes;

          if (isExactOut) {
            if (!desiredOutWei || desiredOutWei <= 0n) {
              setQuoteError("Enter an amount to fetch a quote.");
              return;
            }
            if (shouldTryV3Routes) {
              try {
                const v3Candidates = await buildV3RouteCandidates();
                const candidates = buildPrioritizedV3Routes(v3Candidates);
                const valid = await quoteV3ExactOutWithBudget(
                  candidates,
                  desiredOutWei
                );
                if (valid.length) {
                  v3Route = valid.reduce((best, next) => {
                    if (!best) return next;
                    return next.amountIn < best.amountIn ? next : best;
                  }, null);
                }
              } catch {
                v3Route = null;
              }
            }
            const shouldQuoteV2ExactOut =
              shouldTryV2Routes &&
              (routePreference === "v2" ||
                routePreference === "split" ||
                !shouldTryV3Routes ||
                !deferV2InSmartMode ||
                !v3Route);
            if (shouldQuoteV2ExactOut) {
              try {
                const { directRoute, hopRoutes } = await buildV2RouteCandidates();
                const candidates = [
                  ...(directRoute ? [directRoute] : []),
                  ...hopRoutes,
                ];
                const quoted = await Promise.all(
                  candidates.map(async (route) => {
                    try {
                      const v2Quote = await quoteV2RouteExactOut(
                        provider,
                        desiredOutWei,
                        route
                      );
                      return {
                        ...route,
                        amountIn: v2Quote.amountIn,
                        amountOut: desiredOutWei,
                        pairs: v2Quote.pairs || route.pairs,
                      };
                    } catch {
                      return null;
                    }
                  })
                );
                const valid = quoted.filter(Boolean);
                if (valid.length) {
                  v2Route = valid.reduce((best, next) => {
                    if (!best) return next;
                    return next.amountIn < best.amountIn ? next : best;
                  }, null);
                }
              } catch {
                v2Route = null;
              }
            }
          } else {
            const quoteRouteExactIn = async (route, amountIn) => {
              if (!route || !amountIn || amountIn <= 0n) return null;
              if (route.protocol === "V3") {
                return quoteV3Route(provider, amountIn, route);
              }
              if (route.protocol === "V2") {
                const v2Quote = await quoteV2Route(provider, amountIn, route);
                return v2Quote?.amountOut ?? null;
              }
              return null;
            };

            let v3Candidates = { directRoutes: [], hopRoutes: [], multiRoutes: [] };
            if (shouldTryV3Routes) {
              try {
                v3Candidates = await buildV3RouteCandidates();
              } catch {
                v3Candidates = { directRoutes: [], hopRoutes: [], multiRoutes: [] };
              }
            }

            const v3Routes = buildPrioritizedV3Routes(v3Candidates);
            const quotedV3 = shouldTryV3Routes
              ? await quoteV3ExactInWithBudget(v3Routes, amountWei)
              : [];
            const v3Valid = quotedV3.filter(Boolean);
            if (v3Valid.length) {
              v3Route = v3Valid.reduce((best, next) => {
                if (!best) return next;
                return next.amountOut > best.amountOut ? next : best;
              }, null);
            }

            const shouldQuoteV2ExactIn =
              shouldTryV2Routes &&
              (routePreference === "v2" ||
                routePreference === "split" ||
                !shouldTryV3Routes ||
                !deferV2InSmartMode ||
                !v3Route);

            const v2Candidates = shouldQuoteV2ExactIn
              ? await buildV2RouteCandidates()
              : { directRoute: null, hopRoutes: [] };
            const v2Routes = [
              ...(v2Candidates.directRoute ? [v2Candidates.directRoute] : []),
              ...v2Candidates.hopRoutes,
            ].map((route) => ({ ...route, protocol: "V2" }));

            const quotedV2 = shouldQuoteV2ExactIn
              ? await Promise.all(
                  v2Routes.map(async (route) => {
                    try {
                      const v2Quote = await quoteV2Route(provider, amountWei, route);
                      return {
                        ...route,
                        amountOut: v2Quote.amountOut,
                        priceImpact: v2Quote.priceImpact,
                        pairs: v2Quote.pairs || route.pairs,
                      };
                    } catch {
                      return null;
                    }
                  })
                )
              : [];
            const v2Valid = quotedV2.filter(Boolean);
            if (v2Valid.length) {
              v2Route = v2Valid.reduce((best, next) => {
                if (!best) return next;
                return next.amountOut > best.amountOut ? next : best;
              }, null);
            }

            const allQuoted = [...v3Valid, ...v2Valid].filter(
              (route) => route?.amountOut && route.amountOut > 0n
            );

            if (
              (routePreference === "split" || routePreference === "smart") &&
              allQuoted.length > 1
            ) {
              try {
                const maxCandidates = MAX_SPLIT_ROUTES;
                const sorted = allQuoted
                  .slice()
                  .sort((a, b) => Number(b.amountOut - a.amountOut));
                const bestByKind = new Map();
                for (const route of sorted) {
                  const kind = route?.kind || "unknown";
                  if (!bestByKind.has(kind)) bestByKind.set(kind, route);
                }
                const ranked = [];
                const seen = new Set();
                const pushRoute = (route) => {
                  if (!route) return;
                  const key = buildRouteKey(route);
                  if (seen.has(key)) return;
                  seen.add(key);
                  ranked.push(route);
                };
                bestByKind.forEach((route) => pushRoute(route));
                for (const route of sorted) {
                  if (ranked.length >= maxCandidates) break;
                  pushRoute(route);
                }
                const pairSteps = SPLIT_SHARE_STEPS;
                const quoteCache = new Map();
                const getCachedQuote = async (route, amountIn) => {
                  const key = `${buildRouteKey(route)}:${amountIn.toString()}`;
                  if (quoteCache.has(key)) return await quoteCache.get(key);
                  const pending = quoteRouteExactIn(route, amountIn);
                  quoteCache.set(key, pending);
                  const out = await pending;
                  quoteCache.set(key, out);
                  return out;
                };
                let bestSplit = null;
                const remainingBudget = Math.max(
                  200,
                  FAST_QUOTE_BUDGET_MS - (Date.now() - quoteBudgetStart)
                );
                const splitDeadline = Date.now() + Math.min(600, remainingBudget);
                let splitTimedOut = false;

                for (let i = 0; i < ranked.length; i += 1) {
                  for (let j = i + 1; j < ranked.length; j += 1) {
                    const routeA = ranked[i];
                    const routeB = ranked[j];
                    for (const share of pairSteps) {
                      if (Date.now() > splitDeadline) {
                        splitTimedOut = true;
                        break;
                      }
                      const amountA = (amountWei * BigInt(share)) / 100n;
                      const amountB = amountWei - amountA;
                      if (amountA <= 0n || amountB <= 0n) continue;
                      const [outA, outB] = await Promise.all([
                        getCachedQuote(routeA, amountA),
                        getCachedQuote(routeB, amountB),
                      ]);
                      if (!outA || !outB) continue;
                      const total = outA + outB;
                      if (!bestSplit || total > bestSplit.amountOut) {
                        bestSplit = {
                          protocol: "SPLIT",
                          kind: "split",
                          amountOut: total,
                          routes: [
                            {
                              ...routeA,
                              amountIn: amountA,
                              amountOut: outA,
                              sharePct: share,
                            },
                            {
                              ...routeB,
                              amountIn: amountB,
                              amountOut: outB,
                              sharePct: 100 - share,
                            },
                          ],
                        };
                      }
                    }
                    if (splitTimedOut) break;
                  }
                  if (splitTimedOut) break;
                }

                if (bestSplit) {
                  splitRoute = bestSplit;
                }
              } catch {
                splitRoute = null;
              }
            }

            if (cancelled) return;
          }

          const estimateRouteSlippage = async (route) => {
            try {
              if (!route || !route.amountOut) return null;
              const routeAmountIn = route.amountIn ?? amountWei;
              if (!routeAmountIn || routeAmountIn <= 0n) return null;
              const probeAmount = computeProbeAmount(routeAmountIn, sellDecimals);
              if (!probeAmount || probeAmount <= 0n) return null;
              let probeOut = null;
              if (route.protocol === "V3") {
                probeOut = await quoteV3Route(provider, probeAmount, route);
              } else if (route.protocol === "V2") {
                probeOut = await getV2Quote(provider, probeAmount, route.path || []);
              } else {
                return null;
              }
              if (!probeOut || probeOut <= 0n) return null;
              const expectedOut = (probeOut * routeAmountIn) / probeAmount;
              if (!expectedOut || expectedOut <= 0n) return null;
              const slipBps =
                expectedOut > route.amountOut
                  ? Number(((expectedOut - route.amountOut) * 10000n) / expectedOut)
                  : 0;
              return Math.max(0, slipBps / 100);
            } catch {
              return null;
            }
          };

          const estimateSplitSlippage = async (route) => {
            try {
              if (!route || !route.amountOut || !Array.isArray(route.routes)) return null;
              let expectedOut = 0n;
              for (const leg of route.routes) {
                if (!leg || !leg.amountIn) continue;
                const legAmountIn = leg.amountIn;
                const probeAmount = computeProbeAmount(legAmountIn, sellDecimals);
                if (!probeAmount || probeAmount <= 0n) continue;
                let probeOut = null;
                if (leg.protocol === "V3") {
                  probeOut = await quoteV3Route(provider, probeAmount, leg);
                } else if (leg.protocol === "V2") {
                  probeOut = await getV2Quote(provider, probeAmount, leg.path || []);
                }
                if (!probeOut || probeOut <= 0n) continue;
                expectedOut += (probeOut * legAmountIn) / probeAmount;
              }
              if (!expectedOut || expectedOut <= 0n) return null;
              const slipBps =
                expectedOut > route.amountOut
                  ? Number(((expectedOut - route.amountOut) * 10000n) / expectedOut)
                  : 0;
              return Math.max(0, slipBps / 100);
            } catch {
              return null;
            }
          };

          if (
            !isExactOut &&
            (routePreference === "split" || routePreference === "smart") &&
            v2Route &&
            v3Route &&
            !splitRoute
          ) {
            try {
              const half = amountWei / 2n;
              const rest = amountWei - half;
              const v3HalfOut = await quoteV3Route(provider, half, v3Route);
              const v2HalfOut = await getV2Quote(provider, rest, v2Route.path);
              splitRoute = {
                protocol: "SPLIT",
                kind: "split",
                amountOut: v3HalfOut + v2HalfOut,
                routes: [
                  {
                    ...v3Route,
                    amountIn: half,
                    amountOut: v3HalfOut,
                    sharePct: Number((half * 10000n) / amountWei) / 100,
                  },
                  {
                    ...v2Route,
                    amountIn: rest,
                    amountOut: v2HalfOut,
                    sharePct: Number((rest * 10000n) / amountWei) / 100,
                  },
                ],
              };
            } catch {
              splitRoute = null;
            }
          }

          if (v3Route) {
            const slippage = await estimateRouteSlippage(v3Route);
            v3Route = { ...v3Route, estimatedSlippage: slippage };
          }
          if (v2Route) {
            const slippage = await estimateRouteSlippage(v2Route);
            v2Route = { ...v2Route, estimatedSlippage: slippage };
          }
          if (splitRoute) {
            const slippage = await estimateSplitSlippage(splitRoute);
            splitRoute = { ...splitRoute, estimatedSlippage: slippage };
          }

          const pickBest = (...routes) => {
            const filtered = routes.filter(Boolean);
            if (!filtered.length) return null;
            const withSlippage = filtered.filter((r) =>
              Number.isFinite(r.estimatedSlippage)
            );
            if (withSlippage.length) {
              return withSlippage.reduce((best, next) => {
                if (!best) return next;
                if (next.estimatedSlippage < best.estimatedSlippage) return next;
                if (next.estimatedSlippage > best.estimatedSlippage) return best;
                if (isExactOut) {
                  return next.amountIn < best.amountIn ? next : best;
                }
                return next.amountOut > best.amountOut ? next : best;
              }, null);
            }
            return filtered.reduce((best, next) => {
              if (!best) return next;
              if (isExactOut) {
                return next.amountIn < best.amountIn ? next : best;
              }
              return next.amountOut > best.amountOut ? next : best;
            }, null);
          };

          let selectedRoute = null;
          if (routePreference === "v2") {
            selectedRoute = v2Route;
          } else if (routePreference === "v3") {
            selectedRoute = v3Route;
          } else if (routePreference === "split") {
            selectedRoute = splitRoute;
          } else {
            selectedRoute = pickBest(splitRoute, v3Route, v2Route);
          }

          if (!selectedRoute) {
            const msg =
              routePreference === "split"
                ? isExactOut
                  ? "Split routing is unavailable for exact output."
                  : "Split route unavailable for this pair."
                : routePreference === "v2"
                  ? "No V2 route available for this pair."
                  : routePreference === "v3"
                    ? "No V3 route available for this pair."
                    : "No route available for this pair.";
            setQuoteError(msg);
            return;
          }

          applyQuoteFromRoute(selectedRoute, true);
        } catch (e) {
          if (cancelled) return;
          setQuoteError(friendlyQuoteError(e, displaySellSymbol, displayBuySymbol));
        } finally {
          if (inFlightSet) {
            quoteInFlightRef.current = false;
          }
          if (!cancelled && inFlightSet) setQuoteLoading(false);
        }
      }, 250); // debounce 250ms to cut RPC spam
  };
    fetchQuote();
    return () => {
      cancelled = true;
      if (quoteDebounceRef.current) {
        clearTimeout(quoteDebounceRef.current);
        quoteDebounceRef.current = null;
      }
    };
  }, [
    address,
    activeInputAmount,
    amountIn,
    amountOutInput,
    buildRouteKey,
    buyMeta,
    buyMeta?.address,
    buyMeta?.decimals,
    buyToken,
    buildV2Route,
    buildV2RouteCandidates,
    buildV3Route,
    buildV3RouteCandidates,
    getCachedApproval,
    quoteV2Route,
    quoteV2RouteExactOut,
    quoteV3Route,
    quoteV3RouteExactOut,
    isDirectEthWeth,
    isExactOut,
    isSupported,
    hasV2Support,
    hasV3Support,
    enableV2Routing,
    allowV2Routing,
    sellMeta,
    sellMeta?.address,
    sellMeta?.decimals,
    sellToken,
    setCachedApproval,
    swapInputMode,
    liveRouteTick,
    quoteLockedUntil,
    routePreference,
    displaySellSymbol,
    displayBuySymbol,
    isChainMatch,
  ]);

  // If the networks realign after a mismatch, clear the guard message and trigger a fresh quote.
  useEffect(() => {
    if (!isChainMatch) return;
    setQuoteError("");
    setLiveRouteTick((t) => t + 1);
  }, [isChainMatch]);

  const baseSlippagePct = (() => {
    const val = Number(slippage);
    if (Number.isNaN(val) || val < 0) return 0.5;
    return Math.min(5, val);
  })();
  const autoSlippagePct = Math.max(0.05, Math.min(baseSlippagePct || 0.3, 0.8));
  const effectiveSlippagePct = autoSlippagePct;
  const reQuoteThresholdPct = 0.9;
  const slippageBps = (() => {
    if (Number.isNaN(effectiveSlippagePct) || effectiveSlippagePct < 0) return 50;
    return Math.min(5000, Math.round(effectiveSlippagePct * 100));
  })();

  const minReceivedRaw = quoteOutRaw
    ? (quoteOutRaw * BigInt(10000 - slippageBps)) / 10000n
    : null;
  const minReceivedDisplay = minReceivedRaw
    ? formatDisplayAmount(
        Number(formatUnits(minReceivedRaw, buyMeta?.decimals ?? 18)),
        displayBuySymbol
      )
    : "--";
  const routeFeeUsd = useMemo(() => {
    if (isDirectEthWeth) return 0;
    if (!quoteMeta) return null;
    if (!Number.isFinite(sellTokenUsd)) return null;
    const amountInNum =
      isExactOut && quoteMeta.amountIn
        ? toNumberSafe(formatUnits(quoteMeta.amountIn, sellInputDecimals))
        : toNumberSafe(amountIn);
    const computeLegFee = (route, legAmount) => {
      const feeFraction = computeRouteFeeFraction(route);
      if (!Number.isFinite(feeFraction) || feeFraction <= 0) return 0;
      if (!Number.isFinite(legAmount) || legAmount <= 0) return 0;
      return legAmount * feeFraction;
    };

    if (quoteMeta.protocol === "SPLIT" && Array.isArray(quoteMeta.routes)) {
      let totalFees = 0;
      for (const leg of quoteMeta.routes) {
        const legAmount = leg?.amountIn
          ? toNumberSafe(formatUnits(leg.amountIn, sellInputDecimals))
          : amountInNum !== null
            ? amountInNum * ((leg.sharePct ?? 0) / 100)
            : null;
        if (!Number.isFinite(legAmount) || legAmount <= 0) continue;
        totalFees += computeLegFee(leg, legAmount);
      }
      return totalFees * sellTokenUsd;
    }

    if (!Number.isFinite(amountInNum) || amountInNum <= 0) return null;
    return computeLegFee(quoteMeta, amountInNum) * sellTokenUsd;
  }, [
    amountIn,
    isDirectEthWeth,
    isExactOut,
    quoteMeta,
    sellInputDecimals,
    sellTokenUsd,
  ]);
  const routeFeeUsdLabel =
    routeFeeUsd === null
      ? sellTokenUsdLoading
        ? "..."
        : "--"
      : formatUsdAmount(routeFeeUsd);
  const activeRouteTokens = (
    displayRoute && displayRoute.length ? displayRoute : [displaySellSymbol, displayBuySymbol]
  ).map((label) => resolveRouteToken(label));
  const isQuoteLocked = quoteLockedUntil && quoteLockedUntil > Date.now();
  const quoteOutDisplayValue = isExactOut ? amountOutInput : formatOutputPreviewValue(quoteOut || "");
  const hasFullPrecisionHint =
    !isExactOut &&
    typeof quoteOut === "string" &&
    quoteOut.trim().length > 0 &&
    quoteOutDisplayValue !== quoteOut;
  const quoteSourceLabel = (() => {
    if (quoteError) return quoteError;
    if (!activeInputAmount) {
      return isExactOut
        ? "Enter a target output to fetch a quote"
        : "Enter an amount to fetch a quote";
    }
    if (isDirectEthWeth) return "Direct wrap/unwrap (no fee)";
    if (quoteMeta?.protocol === "V2") return "Live quote via CurrentX API (V2)";
    if (quoteMeta?.protocol === "SPLIT") {
      const label = splitProtocolLabel || "V3";
      return `Smart split via CurrentX API (${label})`;
    }
    if (quoteMeta?.protocol === "V3") return "Live quote via CurrentX API (V3)";
    return lastQuoteSourceRef.current || "Live quote via CurrentX API...";
  })();
  const routeProtocolLabel = isDirectEthWeth
    ? "Wrap/Unwrap"
    : quoteMeta?.protocol === "SPLIT"
      ? splitProtocolLabel || "V3"
      : quoteMeta?.protocol || "V3";
  const hopCount = routeSegments.reduce((sum, seg) => sum + (seg.hops?.length || 0), 0);
  const isSellAmountFocused = focusedAmountField === "sell";
  const isBuyAmountFocused = focusedAmountField === "buy";
  const hasSellAmountValue = String(amountIn || "").trim().length > 0;
  const isSellPanelActive = isSellAmountFocused || swapInputMode === "in";
  const PRICE_IMPACT_WARN_THRESHOLD = 1;
  const PRICE_IMPACT_DANGER_THRESHOLD = 3;
  const hasPriceImpact = Number.isFinite(priceImpact);
  const isPriceImpactWarning = hasPriceImpact && priceImpact > PRICE_IMPACT_WARN_THRESHOLD;
  const priceImpactToneClass = !hasPriceImpact
    ? "text-slate-200"
    : priceImpact > PRICE_IMPACT_DANGER_THRESHOLD
      ? "text-rose-300"
      : isPriceImpactWarning
        ? "text-amber-200"
        : "text-slate-200";

  useEffect(() => {
    if (isDirectEthWeth) {
      lastQuoteSourceRef.current = "Direct wrap/unwrap (no fee)";
      return;
    }
    if (quoteMeta?.protocol === "V2") {
      lastQuoteSourceRef.current = "Live quote via CurrentX API (V2)";
      return;
    }
    if (quoteMeta?.protocol === "SPLIT") {
      const label = splitProtocolLabel || "V3";
      lastQuoteSourceRef.current = `Smart split via CurrentX API (${label})`;
      return;
    }
    if (quoteMeta?.protocol === "V3") {
      lastQuoteSourceRef.current = "Live quote via CurrentX API (V3)";
    }
  }, [quoteMeta?.protocol, isDirectEthWeth, splitProtocolLabel]);

  useEffect(() => {
    setActiveQuickPercent(null);
  }, [sellToken, buyToken]);

  useEffect(() => {
    if (routeRefreshTimerRef.current) {
      clearTimeout(routeRefreshTimerRef.current);
      routeRefreshTimerRef.current = null;
    }
    setRouteRefreshFx(true);
    routeRefreshTimerRef.current = setTimeout(() => {
      setRouteRefreshFx(false);
      routeRefreshTimerRef.current = null;
    }, 320);
  }, [sellToken, buyToken, amountIn, amountOutInput, slippage, swapInputMode]);

  useEffect(() => {
    if (!swapStatus) return undefined;
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    const id = setTimeout(() => {
      setSwapStatus(null);
    }, 15000);
    toastTimerRef.current = id;
    return () => {
      clearTimeout(id);
      if (toastTimerRef.current === id) {
        toastTimerRef.current = null;
      }
    };
  }, [swapStatus]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    if (executionClearRef.current) clearTimeout(executionClearRef.current);
    if (quoteLockTimerRef.current) clearTimeout(quoteLockTimerRef.current);
    if (quoteDebounceRef.current) clearTimeout(quoteDebounceRef.current);
    if (allowanceDebounceRef.current) clearTimeout(allowanceDebounceRef.current);
    if (routeRefreshTimerRef.current) clearTimeout(routeRefreshTimerRef.current);
    pendingTxHashRef.current = null;
  }, []);

  const handleSwap = async () => {
    let provider;
    let walletFlowSwapStarted = false;
    let walletFlowOpenForAction = walletFlow.open;
    try {
      setSwapStatus(null);
      setExecutionProof(null);
      pendingTxHashRef.current = null;
      if (!isChainMatch) {
        throw new Error("Wallet network differs from selected network. Switch network to swap.");
      }
      if (swapLoading) return;
      if (!amountIn || Number.isNaN(Number(amountIn))) {
        throw new Error("Enter a valid amount");
      }
      if (isIncompleteAmount(amountIn)) {
        throw new Error("Finish typing the amount.");
      }
      if (!isSupported) {
        throw new Error("Select tokens with valid addresses.");
      }
      if (!hasV2Support && !hasV3Support) {
        throw new Error("No router configured for this network.");
      }
      if (!quoteOutRaw) {
        throw new Error("Fetching quote, please retry");
      }

      const routePlan = isDirectEthWeth ? { protocol: "WRAP" } : quoteMeta;
      if (!routePlan && !isDirectEthWeth) {
        throw new Error("Route not available. Fetch a quote first.");
      }
      const routeProtocol = routePlan?.protocol || "V3";
      if (routeProtocol === "V2" && !hasV2Support) {
        throw new Error("V2 support not configured for this network.");
      }
      if (routeProtocol === "V3" && !hasV3Support) {
        throw new Error("V3 router not configured for this network.");
      }
      if (routeProtocol === "SPLIT") {
        const legs = Array.isArray(routePlan?.routes) ? routePlan.routes : [];
        const needsV2 = legs.some((leg) => leg?.protocol === "V2");
        if (!hasV3Support || (needsV2 && !hasV2Support)) {
          throw new Error(
            needsV2
              ? "Split routing requires both V2 and V3 routers."
              : "Split routing requires V3 support."
          );
        }
      }

      const decimalsOut = requireDecimals(buyToken, buyMeta);
      const routeLabelsSnapshot =
        displayRoute && displayRoute.length
          ? displayRoute
          : [displaySellSymbol, displayBuySymbol];

      setSwapLoading(true);
      provider = await getProvider();
      const signer = await provider.getSigner();
      const user = await signer.getAddress();
      const sellAddress = sellMeta?.address;
      const sellDecimals = requireDecimals(sellToken, sellMeta);
      const amountWei = safeParseUnits(amountIn, sellDecimals);
      if (!amountWei) {
        throw new Error("Invalid amount format. Use dot for decimals.");
      }

      if (
        sellToken !== "ETH" &&
        !isDirectEthWeth &&
        (routeProtocol === "V2" || routeProtocol === "V3" || routeProtocol === "SPLIT")
      ) {
        if (!sellAddress) {
          throw new Error("Select tokens with valid addresses.");
        }

        const token = new Contract(sellAddress, ERC20_ABI, signer);
        const permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, signer);
        const now = BigInt(Math.floor(Date.now() / 1000));

        const cachedErc20 = getCachedApproval("erc20", sellAddress, PERMIT2_ADDRESS);
        let hasErc20Allowance = Boolean(cachedErc20 && cachedErc20.amount >= amountWei);
        if (!hasErc20Allowance) {
          const allowance = await token.allowance(user, PERMIT2_ADDRESS);
          if (allowance >= amountWei) {
            setCachedApproval({
              symbol: sellToken,
              address: sellAddress,
              desiredAllowance: allowance,
              spender: PERMIT2_ADDRESS,
              kind: "erc20",
            });
            hasErc20Allowance = true;
          }
        }

        const cachedPermit2 = getCachedApproval(
          "permit2",
          sellAddress,
          UNIV3_UNIVERSAL_ROUTER_ADDRESS
        );
        let hasPermit2Allowance = false;
        if (cachedPermit2) {
          const expired = !cachedPermit2.expiration || cachedPermit2.expiration < now;
          hasPermit2Allowance = !expired && cachedPermit2.amount >= amountWei;
        }
        if (!hasPermit2Allowance) {
          const res = await permit2.allowance(user, sellAddress, UNIV3_UNIVERSAL_ROUTER_ADDRESS);
          const allowanceRaw = res?.amount ?? res?.[0] ?? 0n;
          const expirationRaw = res?.expiration ?? res?.[1] ?? 0n;
          const allowance =
            typeof allowanceRaw === "bigint" ? allowanceRaw : BigInt(allowanceRaw || 0);
          const expiration =
            typeof expirationRaw === "bigint" ? expirationRaw : BigInt(expirationRaw || 0);
          const expired = !expiration || expiration < now;
          if (!expired && allowance >= amountWei) {
            setCachedApproval({
              symbol: sellToken,
              address: sellAddress,
              desiredAllowance: allowance,
              spender: UNIV3_UNIVERSAL_ROUTER_ADDRESS,
              kind: "permit2",
              expiration,
            });
            hasPermit2Allowance = true;
          }
        }

        const needsErc20 = !hasErc20Allowance;
        const needsPermit2 = !hasPermit2Allowance;
        if (needsErc20 || needsPermit2) {
          walletFlowOpenForAction = true;

          const ordered = [];
          if (needsErc20) {
            ordered.push({
              symbol: sellToken,
              address: sellAddress,
              desiredAllowance: MAX_UINT256,
              spender: PERMIT2_ADDRESS,
              kind: "erc20",
            });
          }
          if (needsPermit2) {
            ordered.push({
              symbol: sellToken,
              address: sellAddress,
              desiredAllowance: MAX_UINT160,
              spender: UNIV3_UNIVERSAL_ROUTER_ADDRESS,
              kind: "permit2",
              expiration: MAX_UINT48,
            });
          }

          const needsErc20Step = ordered.some((t) => t.kind === "erc20");
          const needsPermit2Step = ordered.some((t) => t.kind === "permit2");
          setWalletFlow({
            open: true,
            lastError: "",
            steps: [
              {
                id: "erc20",
                label: `Approve ${displaySellSymbol}`,
                status: needsErc20Step ? "active" : "done",
              },
              {
                id: "permit2",
                label: "Approve Permit2",
                status: needsPermit2Step ? (needsErc20Step ? "pending" : "active") : "done",
              },
              {
                id: "swap",
                label: "Confirm swap in wallet",
                status: "pending",
              },
            ],
          });

          let activeWalletFlowStepId = null;
          const runTargets = [...ordered].sort((a, b) => {
            const aScore = a.kind === "erc20" ? 0 : 1;
            const bScore = b.kind === "erc20" ? 0 : 1;
            return aScore - bScore;
          });

          for (let i = 0; i < runTargets.length; i += 1) {
            const target = runTargets[i];
            const stepId = target.kind === "permit2" ? "permit2" : "erc20";
            activeWalletFlowStepId = stepId;
            setWalletFlowStepStatus(stepId, "active");
            setSwapStatus({
              variant: "pending",
              message: `Approving ${target.symbol || sellToken}...`,
            });
            try {
              let tx;
              if (target.kind === "permit2") {
                const spender = target.spender || UNIV3_UNIVERSAL_ROUTER_ADDRESS;
                const expiration =
                  typeof target.expiration === "bigint" ? target.expiration : MAX_UINT48;
                tx = await permit2.approve(target.address, spender, target.desiredAllowance, expiration);
              } else {
                const spender = target.spender || PERMIT2_ADDRESS;
                tx = await token.approve(spender, target.desiredAllowance);
              }
              const receipt = await tx.wait();
              if (receipt?.status === 0 || receipt?.status === 0n) {
                throw new Error("Approval failed");
              }
              setCachedApproval(target);
              setWalletFlowStepStatus(stepId, "done");
              activeWalletFlowStepId = null;
              activateNextPendingWalletFlowStep(["erc20", "permit2"]);
            } catch (e) {
              const txHash = extractTxHash(e);
              if (txHash) {
                const receipt = await tryFetchReceipt(txHash, provider);
                const status = receipt?.status;
                const normalized = typeof status === "bigint" ? Number(status) : status;
                if (normalized === 1) {
                  setCachedApproval(target);
                  setWalletFlowStepStatus(stepId, "done");
                  activeWalletFlowStepId = null;
                  activateNextPendingWalletFlowStep(["erc20", "permit2"]);
                  continue;
                }
                if (normalized === 0) {
                  setWalletFlowStepStatus(stepId, "error");
                  const message = friendlySwapError(e) || "Approval failed";
                  setWalletFlow((prev) => ({ ...prev, lastError: message }));
                  setSwapStatus({ variant: "error", hash: txHash, message });
                  return;
                }
                setSwapStatus({
                  variant: "pending",
                  hash: txHash,
                  message: "Approval submitted. Waiting for confirmation.",
                });
                return;
              }

              const userRejected =
                e?.code === 4001 ||
                e?.code === "ACTION_REJECTED" ||
                (e?.message || "").toLowerCase().includes("user denied");
              if (activeWalletFlowStepId) {
                setWalletFlowStepStatus(activeWalletFlowStepId, "error");
              }
              const message = userRejected
                ? "Approval was rejected in wallet."
                : friendlySwapError(e) || "Approval failed";
              setWalletFlow((prev) => ({ ...prev, lastError: message }));
              setSwapStatus({ variant: "error", message });
              return;
            }
          }

          // Best-effort UI sync: clear any stale quote-derived target list for this token.
          setApprovalTargets((prev) => prev.filter((t) => t.symbol !== sellToken));
        }
      }

      // Pre-flight re-quote if the market moved too fast (anti-sandwich guard).
      let guardedRouteMeta = null;
      let guardedAmountOut = quoteOutRaw;
      if (!isDirectEthWeth && routeProtocol === "V3") {
        const readProvider = getReadOnlyProvider();
        const candidateRoute =
          routePlan || (await buildV3Route({ amountWei }));
        const freshOut = await quoteV3Route(readProvider, amountWei, candidateRoute);
        const freshOutNum = Number(formatUnits(freshOut, decimalsOut));
        const currentOutNum =
          quoteOut !== null && Number.isFinite(Number(quoteOut))
            ? Number(quoteOut)
            : freshOutNum;
        const deltaPct = currentOutNum
          ? Math.abs((freshOutNum - currentOutNum) / currentOutNum) * 100
          : 0;
        const reQuoteThreshold = reQuoteThresholdPct;
        guardedRouteMeta = candidateRoute;
        guardedAmountOut = freshOut;

        if (deltaPct > reQuoteThreshold) {
          const refreshedRoute = { ...candidateRoute, protocol: "V3", amountOut: freshOut };
          setQuoteOut(formatUnits(freshOut, decimalsOut));
          setQuoteOutRaw(freshOut);
          setQuoteRoute(refreshedRoute?.path || []);
          setQuotePairs([]);
          setQuoteMeta(refreshedRoute);
          setLastQuoteAt(Date.now());
          setPriceImpact(null);
          setSwapStatus({
            message: `Quote updated (${deltaPct.toFixed(2)}% move). Review and sign again.`,
            variant: "error",
          });
          setSwapLoading(false);
          return;
        }
      }
      if (!isDirectEthWeth && routeProtocol === "V2") {
        const readProvider = getReadOnlyProvider();
        const candidateRoute = routePlan || (await buildV2Route({ amountWei }));
        const path = candidateRoute?.path || [];
        const freshOut = await getV2Quote(readProvider, amountWei, path);
        const freshOutNum = Number(formatUnits(freshOut, decimalsOut));
        const currentOutNum =
          quoteOut !== null && Number.isFinite(Number(quoteOut))
            ? Number(quoteOut)
            : freshOutNum;
        const deltaPct = currentOutNum
          ? Math.abs((freshOutNum - currentOutNum) / currentOutNum) * 100
          : 0;
        const reQuoteThreshold = reQuoteThresholdPct;
        guardedRouteMeta = { ...candidateRoute, protocol: "V2", amountOut: freshOut };
        guardedAmountOut = freshOut;

        if (deltaPct > reQuoteThreshold) {
          const refreshedRoute = guardedRouteMeta;
          setQuoteOut(formatUnits(freshOut, decimalsOut));
          setQuoteOutRaw(freshOut);
          setQuoteRoute(refreshedRoute?.path || []);
          setQuotePairs(refreshedRoute?.pairs || []);
          setQuoteMeta(refreshedRoute);
          setLastQuoteAt(Date.now());
          setPriceImpact(null);
          setSwapStatus({
            message: `Quote updated (${deltaPct.toFixed(2)}% move). Review and sign again.`,
            variant: "error",
          });
          setSwapLoading(false);
          return;
        }
      }
      if (!isDirectEthWeth && routeProtocol === "SPLIT") {
        const readProvider = getReadOnlyProvider();
        const legs = Array.isArray(routePlan?.routes) ? routePlan.routes : [];
        const refreshedLegs = [];
        let freshTotal = 0n;
        for (const leg of legs) {
          if (!leg) continue;
          const legAmountIn = leg.amountIn ?? amountWei;
          let legAmountOut = leg.amountOut;
          if (leg.protocol === "V3") {
            legAmountOut = await quoteV3Route(readProvider, legAmountIn, leg);
          } else if (leg.protocol === "V2") {
            legAmountOut = await getV2Quote(readProvider, legAmountIn, leg.path || []);
          }
          if (!legAmountOut) {
            throw new Error("Unable to compute split output.");
          }
          freshTotal += legAmountOut;
          refreshedLegs.push({ ...leg, amountIn: legAmountIn, amountOut: legAmountOut });
        }
        const freshOutNum = Number(formatUnits(freshTotal, decimalsOut));
        const currentOutNum =
          quoteOut !== null && Number.isFinite(Number(quoteOut))
            ? Number(quoteOut)
            : freshOutNum;
        const deltaPct = currentOutNum
          ? Math.abs((freshOutNum - currentOutNum) / currentOutNum) * 100
          : 0;
        const reQuoteThreshold = reQuoteThresholdPct;
        guardedRouteMeta = {
          ...routePlan,
          protocol: "SPLIT",
          amountOut: freshTotal,
          routes: refreshedLegs,
        };
        guardedAmountOut = freshTotal;

        if (deltaPct > reQuoteThreshold) {
          const refreshedRoute = guardedRouteMeta;
          setQuoteOut(formatUnits(freshTotal, decimalsOut));
          setQuoteOutRaw(freshTotal);
          setQuoteMeta(refreshedRoute);
          setLastQuoteAt(Date.now());
          setPriceImpact(null);
          setSwapStatus({
            message: `Quote updated (${deltaPct.toFixed(2)}% move). Review and sign again.`,
            variant: "error",
          });
          setSwapLoading(false);
          return;
        }
      }

      triggerQuoteLock();
      pendingExecutionRef.current = null;

      if (isDirectEthWeth) {
        pendingExecutionRef.current = {
          expectedRaw: amountWei,
          minRaw: amountWei,
          priceImpactSnapshot: 0,
          slippagePct: "0",
          routeLabels: routeLabelsSnapshot,
          buyDecimals: decimalsOut,
          buySymbol: displayBuySymbol,
        };
        const weth = new Contract(WETH_ADDRESS, WETH_ABI, signer);
        // Some RPCs reject gas estimation; fall back to a safe manual limit if needed.
        const fallbackGas = 200000n;
        let tx;
        if (walletFlowOpenForAction) {
          walletFlowSwapStarted = true;
          setWalletFlowStepStatus("swap", "active");
        }
        if (sellToken === "ETH") {
          const wrapOpts = { value: amountWei };
          try {
            const est = await weth.deposit.estimateGas(wrapOpts);
            wrapOpts.gasLimit = (est * 120n) / 100n; // add 20% buffer
          } catch {
            wrapOpts.gasLimit = fallbackGas; // covers strict RPCs
          }
          tx = await weth.deposit(wrapOpts);
        } else {
          const unwrapOpts = {};
          try {
            const est = await weth.withdraw.estimateGas(amountWei);
            unwrapOpts.gasLimit = (est * 120n) / 100n;
          } catch {
            unwrapOpts.gasLimit = fallbackGas; // symmetric fallback for unwraps
          }
          tx = await weth.withdraw(amountWei, unwrapOpts);
        }
        const receipt = await tx.wait();
        const actualWrapOut = findActualOutput(
          receipt,
          WETH_ADDRESS,
          user,
          {
            captureWithdrawal: sellToken !== "ETH",
            captureDeposit: sellToken === "ETH",
          }
        );
        const actualValue = actualWrapOut ?? amountWei;
        const actualFloat = Number(formatUnits(actualValue, decimalsOut));
        const expectedFloat = Number(formatUnits(amountWei, decimalsOut));
  const grade = computeOutcomeGrade(expectedFloat, actualFloat, actualFloat);
        pushExecutionProof({
          expected: formatDisplayAmount(expectedFloat, displayBuySymbol),
          executed: formatDisplayAmount(actualFloat, displayBuySymbol),
          minReceived: formatDisplayAmount(actualFloat, displayBuySymbol),
          priceImpact: 0,
          slippage: "0",
          gasUsed: receipt?.gasUsed ? Number(receipt.gasUsed) : null,
          txHash: receipt?.hash,
          deltaPct: grade.deltaPct,
          route: pendingExecutionRef.current.routeLabels,
          grade,
        });
        setSwapStatus({
          message: `Swap executed (wrap/unwrap). Received ${formatUnits(
            amountWei,
            buyMeta?.decimals ?? 18
          )} ${buyToken}${pointsSuffix}`,
          hash: receipt.hash,
          variant: "success",
        });
        refreshPoints();
        await refreshBalances();
        if (walletFlowSwapStarted) {
          setWalletFlowStepStatus("swap", "done");
          setTimeout(closeWalletFlow, 900);
        }
        return;
      }

      if (routeProtocol === "SPLIT") {
        const activeRoute = guardedRouteMeta || routePlan;
        const legs = Array.isArray(activeRoute?.routes) ? activeRoute.routes : [];
        if (!legs.length) {
          throw new Error("Split route unavailable. Please re-quote.");
        }
        const readProvider = getReadOnlyProvider();
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
        const abi = AbiCoder.defaultAbiCoder();
        const universal = new Contract(
          UNIV3_UNIVERSAL_ROUTER_ADDRESS,
          UNIV3_UNIVERSAL_ROUTER_ABI,
          signer
        );
        const commands = [];
        const inputs = [];
        const isEthIn = sellToken === "ETH";
        const isEthOut = buyToken === "ETH";
        const payerIsUser = !isEthIn;
        let totalMinOut = 0n;

        if (isEthIn) {
          commands.push(UR_COMMANDS.WRAP_ETH);
          inputs.push(
            abi.encode(["address", "uint256"], [UNIV3_UNIVERSAL_ROUTER_ADDRESS, amountWei])
          );
        }

        for (const leg of legs) {
          if (!leg) continue;
          const legAmountIn = leg.amountIn ?? amountWei;
          let legAmountOut = leg.amountOut;
          if (!legAmountOut) {
            if (leg.protocol === "V3") {
              legAmountOut = await quoteV3Route(readProvider, legAmountIn, leg);
            } else if (leg.protocol === "V2") {
              legAmountOut = await getV2Quote(readProvider, legAmountIn, leg.path || []);
            }
          }
          if (!legAmountOut) {
            throw new Error("Unable to compute split leg output.");
          }
          const minOut = (legAmountOut * BigInt(10000 - slippageBps)) / 10000n;
          totalMinOut += minOut;
          const recipient = isEthOut ? UNIV3_UNIVERSAL_ROUTER_ADDRESS : user;

          if (leg.protocol === "V3") {
            const encodedPath = encodeV3Path(leg.path || [], leg.fees || []);
            commands.push(UR_COMMANDS.V3_SWAP_EXACT_IN);
            inputs.push(
              abi.encode(
                ["address", "uint256", "uint256", "bytes", "bool"],
                [recipient, legAmountIn, minOut, encodedPath, payerIsUser]
              )
            );
          } else if (leg.protocol === "V2") {
            commands.push(UR_COMMANDS.V2_SWAP_EXACT_IN);
            inputs.push(
              abi.encode(
                ["address", "uint256", "uint256", "address[]", "bool"],
                [recipient, legAmountIn, minOut, leg.path || [], payerIsUser]
              )
            );
          }
        }

        if (isEthOut) {
          commands.push(UR_COMMANDS.UNWRAP_WETH);
          inputs.push(abi.encode(["address", "uint256"], [user, totalMinOut]));
        }

        const commandBytes = buildCommandBytes(commands);
        const callOpts = isEthIn ? { value: amountWei } : {};
        if (walletFlowOpenForAction) {
          walletFlowSwapStarted = true;
          setWalletFlowStepStatus("swap", "active");
        }
        const tx = await universal.execute(commandBytes, inputs, deadline, callOpts);

        pendingTxHashRef.current = tx.hash;
        listenForTx(tx.hash, {
          routeLabels: routeLabelsSnapshot,
          buyDecimals: decimalsOut,
          buySymbol: displayBuySymbol,
          minReceivedRaw: totalMinOut,
          expectedRaw: guardedAmountOut || quoteOutRaw,
          buyAddress: buyToken === "ETH" ? WETH_ADDRESS : buyMeta?.address,
          user,
          captureWithdrawal: buyToken === "ETH",
        });

        const receipt = await tx.wait();
        pendingExecutionRef.current = {
          expectedRaw: guardedAmountOut || quoteOutRaw,
          minRaw: totalMinOut,
          priceImpactSnapshot: priceImpact,
          slippagePct: effectiveSlippagePct,
          routeLabels: routeLabelsSnapshot,
          buyDecimals: decimalsOut,
          buySymbol: displayBuySymbol,
        };
        const targetAddress =
          buyToken === "ETH" ? WETH_ADDRESS : buyMeta?.address;
        const actualOutRaw = findActualOutput(receipt, targetAddress, user, {
          captureWithdrawal: buyToken === "ETH",
        });
        const resolvedExpected = pendingExecutionRef.current.expectedRaw || quoteOutRaw;
        const resolvedMin = pendingExecutionRef.current.minRaw || totalMinOut;
        const resolvedActual = actualOutRaw || resolvedExpected || resolvedMin;
        const expectedFloat = resolvedExpected
          ? Number(formatUnits(resolvedExpected, decimalsOut))
          : null;
        const actualFloat = resolvedActual
          ? Number(formatUnits(resolvedActual, decimalsOut))
          : null;
        const minFloat = resolvedMin
          ? Number(formatUnits(resolvedMin, decimalsOut))
          : null;
        const grade = computeOutcomeGrade(expectedFloat, actualFloat, minFloat);
        pushExecutionProof({
          expected: formatDisplayAmount(expectedFloat, displayBuySymbol),
          executed: formatDisplayAmount(actualFloat, displayBuySymbol),
          minReceived: formatDisplayAmount(minFloat, displayBuySymbol),
          priceImpact: pendingExecutionRef.current.priceImpactSnapshot ?? priceImpact,
          slippage: pendingExecutionRef.current.slippagePct ?? effectiveSlippagePct,
          gasUsed: receipt?.gasUsed ? Number(receipt.gasUsed) : null,
          txHash: receipt?.hash,
          deltaPct: grade.deltaPct,
          route: pendingExecutionRef.current.routeLabels,
          grade,
        });
        setSwapStatus({
          message: `Split swap executed. Min received: ${formatUnits(
            totalMinOut,
            buyMeta?.decimals ?? 18
          )} ${buyToken}${pointsSuffix}`,
          hash: receipt.hash,
          variant: "success",
        });
        refreshPoints();
        await refreshBalances();
        if (walletFlowSwapStarted) {
          setWalletFlowStepStatus("swap", "done");
          setTimeout(closeWalletFlow, 900);
        }
        return;
      }

      if (routeProtocol === "V2") {
        const routeMeta = guardedRouteMeta || routePlan || {};
        const path = routeMeta?.path || [];
        if (!Array.isArray(path) || path.length < 2) {
          throw new Error("Invalid V2 path.");
        }
        const readProvider = getReadOnlyProvider();
        let amountOut = guardedAmountOut || routeMeta.amountOut;
        if (!amountOut) {
          amountOut = await getV2Quote(readProvider, amountWei, path);
        }
        if (!amountOut) {
          throw new Error("Unable to compute minimum output.");
        }
        const minOut = (amountOut * BigInt(10000 - slippageBps)) / 10000n;
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
        const abi = AbiCoder.defaultAbiCoder();
        const universal = new Contract(
          UNIV3_UNIVERSAL_ROUTER_ADDRESS,
          UNIV3_UNIVERSAL_ROUTER_ABI,
          signer
        );
        const commands = [];
        const inputs = [];
        const isEthIn = sellToken === "ETH";
        const isEthOut = buyToken === "ETH";
        const payerIsUser = !isEthIn;

        if (isEthIn) {
          commands.push(UR_COMMANDS.WRAP_ETH);
          inputs.push(
            abi.encode(["address", "uint256"], [UNIV3_UNIVERSAL_ROUTER_ADDRESS, amountWei])
          );
        }

        const recipient = isEthOut ? UNIV3_UNIVERSAL_ROUTER_ADDRESS : user;
        commands.push(UR_COMMANDS.V2_SWAP_EXACT_IN);
        inputs.push(
          abi.encode(
            ["address", "uint256", "uint256", "address[]", "bool"],
            [recipient, amountWei, minOut, path, payerIsUser]
          )
        );

        if (isEthOut) {
          commands.push(UR_COMMANDS.UNWRAP_WETH);
          inputs.push(abi.encode(["address", "uint256"], [user, minOut]));
        }

        const commandBytes = buildCommandBytes(commands);
        const callOpts = isEthIn ? { value: amountWei } : {};
        if (walletFlowOpenForAction) {
          walletFlowSwapStarted = true;
          setWalletFlowStepStatus("swap", "active");
        }
        const tx = await universal.execute(commandBytes, inputs, deadline, callOpts);

        pendingTxHashRef.current = tx.hash;
        listenForTx(tx.hash, {
          routeLabels: routeLabelsSnapshot,
          buyDecimals: decimalsOut,
          buySymbol: displayBuySymbol,
          minReceivedRaw: minOut,
          expectedRaw: amountOut,
          buyAddress: buyToken === "ETH" ? WETH_ADDRESS : buyMeta?.address,
          user,
          captureWithdrawal: buyToken === "ETH",
        });
        const receipt = await tx.wait();
        pendingExecutionRef.current = {
          expectedRaw: amountOut,
          minRaw: minOut,
          priceImpactSnapshot: priceImpact,
          slippagePct: effectiveSlippagePct,
          routeLabels: routeLabelsSnapshot,
          buyDecimals: decimalsOut,
          buySymbol: displayBuySymbol,
        };
        const targetAddress =
          buyToken === "ETH" ? WETH_ADDRESS : buyMeta?.address;
        const actualOutRaw = findActualOutput(receipt, targetAddress, user, {
          captureWithdrawal: buyToken === "ETH",
        });
        const resolvedExpected = pendingExecutionRef.current.expectedRaw || amountOut;
        const resolvedMin = pendingExecutionRef.current.minRaw || minOut;
        const resolvedActual = actualOutRaw || resolvedExpected || resolvedMin;
        const expectedFloat = resolvedExpected
          ? Number(formatUnits(resolvedExpected, decimalsOut))
          : null;
        const actualFloat = resolvedActual
          ? Number(formatUnits(resolvedActual, decimalsOut))
          : null;
        const minFloat = resolvedMin
          ? Number(formatUnits(resolvedMin, decimalsOut))
          : null;
        const grade = computeOutcomeGrade(expectedFloat, actualFloat, minFloat);
        pushExecutionProof({
          expected: formatDisplayAmount(expectedFloat, displayBuySymbol),
          executed: formatDisplayAmount(actualFloat, displayBuySymbol),
          minReceived: formatDisplayAmount(minFloat, displayBuySymbol),
          priceImpact: pendingExecutionRef.current.priceImpactSnapshot ?? priceImpact,
          slippage: pendingExecutionRef.current.slippagePct ?? effectiveSlippagePct,
          gasUsed: receipt?.gasUsed ? Number(receipt.gasUsed) : null,
          txHash: receipt?.hash,
          deltaPct: grade.deltaPct,
          route: pendingExecutionRef.current.routeLabels,
          grade,
        });
        setSwapStatus({
          message: `Swap executed. Min received: ${formatUnits(
            minOut,
            buyMeta?.decimals ?? 18
          )} ${buyToken}${pointsSuffix}`,
          hash: receipt.hash,
          variant: "success",
        });
        refreshPoints();
        await refreshBalances();
        if (walletFlowSwapStarted) {
          setWalletFlowStepStatus("swap", "done");
          setTimeout(closeWalletFlow, 900);
        }
        return;
      }

      const routeMeta =
        guardedRouteMeta ||
        (routePlan?.protocol === "V3" ? routePlan : null) ||
        (await buildV3Route({ amountWei }));
      const path = routeMeta?.path || [];
      if (!routeMeta?.fees || !routeMeta.fees.length) {
        throw new Error("Missing V3 fee tier for this route.");
      }
      let amountOut = guardedAmountOut;
      if (!amountOut) {
        const readProvider = getReadOnlyProvider();
        amountOut = await quoteV3Route(readProvider, amountWei, routeMeta);
      }
      if (!amountOut) {
        throw new Error("Unable to compute minimum output.");
      }

      const minOut = (amountOut * BigInt(10000 - slippageBps)) / 10000n;
      const universal = new Contract(
        UNIV3_UNIVERSAL_ROUTER_ADDRESS,
        UNIV3_UNIVERSAL_ROUTER_ABI,
        signer
      );
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
      const abi = AbiCoder.defaultAbiCoder();
      const encodedPath = encodeV3Path(path, routeMeta?.fees || []);

      const commands = [];
      const inputs = [];

      if (sellToken === "ETH") {
        commands.push(UR_COMMANDS.WRAP_ETH);
        inputs.push(
          abi.encode(["address", "uint256"], [UNIV3_UNIVERSAL_ROUTER_ADDRESS, amountWei])
        );
        const swapRecipient =
          buyToken === "ETH" ? UNIV3_UNIVERSAL_ROUTER_ADDRESS : user;
        commands.push(UR_COMMANDS.V3_SWAP_EXACT_IN);
        inputs.push(
          abi.encode(
            ["address", "uint256", "uint256", "bytes", "bool"],
            [swapRecipient, amountWei, minOut, encodedPath, false]
          )
        );
        if (buyToken === "ETH") {
          commands.push(UR_COMMANDS.UNWRAP_WETH);
          inputs.push(abi.encode(["address", "uint256"], [user, minOut]));
        }
      } else {
        const swapRecipient =
          buyToken === "ETH" ? UNIV3_UNIVERSAL_ROUTER_ADDRESS : user;
        commands.push(UR_COMMANDS.V3_SWAP_EXACT_IN);
        inputs.push(
          abi.encode(
            ["address", "uint256", "uint256", "bytes", "bool"],
            [swapRecipient, amountWei, minOut, encodedPath, true]
          )
        );
        if (buyToken === "ETH") {
          commands.push(UR_COMMANDS.UNWRAP_WETH);
          inputs.push(abi.encode(["address", "uint256"], [user, minOut]));
        }
      }

      const commandBytes = buildCommandBytes(commands);
      const callOpts = sellToken === "ETH" ? { value: amountWei } : {};
      if (walletFlowOpenForAction) {
        walletFlowSwapStarted = true;
        setWalletFlowStepStatus("swap", "active");
      }
      const tx = await universal.execute(commandBytes, inputs, deadline, callOpts);

      pendingTxHashRef.current = tx.hash;
      listenForTx(tx.hash, {
        routeLabels: routeLabelsSnapshot,
        buyDecimals: decimalsOut,
        buySymbol: displayBuySymbol,
        minReceivedRaw: minOut,
        expectedRaw: amountOut,
        buyAddress: buyToken === "ETH" ? WETH_ADDRESS : buyMeta?.address,
        user,
        captureWithdrawal: buyToken === "ETH",
      });

      const receipt = await tx.wait();
      pendingExecutionRef.current = {
        expectedRaw: amountOut,
        minRaw: minOut,
        priceImpactSnapshot: priceImpact,
        slippagePct: effectiveSlippagePct,
        routeLabels: routeLabelsSnapshot,
        buyDecimals: decimalsOut,
        buySymbol: displayBuySymbol,
      };

      const targetAddress =
        buyToken === "ETH" ? WETH_ADDRESS : buyMeta?.address;
      const actualOutRaw = findActualOutput(receipt, targetAddress, user, {
        captureWithdrawal: buyToken === "ETH",
      });
      const resolvedExpected = pendingExecutionRef.current.expectedRaw || amountOut;
      const resolvedMin = pendingExecutionRef.current.minRaw || minOut;
      const resolvedActual = actualOutRaw || resolvedExpected || resolvedMin;
      const expectedFloat = resolvedExpected
        ? Number(formatUnits(resolvedExpected, decimalsOut))
        : null;
      const actualFloat = resolvedActual
        ? Number(formatUnits(resolvedActual, decimalsOut))
        : null;
      const minFloat = resolvedMin
        ? Number(formatUnits(resolvedMin, decimalsOut))
        : null;
      const grade = computeOutcomeGrade(expectedFloat, actualFloat, minFloat);

      pushExecutionProof({
        expected: formatDisplayAmount(expectedFloat, displayBuySymbol),
        executed: formatDisplayAmount(actualFloat, displayBuySymbol),
        minReceived: formatDisplayAmount(minFloat, displayBuySymbol),
        priceImpact: pendingExecutionRef.current.priceImpactSnapshot ?? priceImpact,
        slippage: pendingExecutionRef.current.slippagePct ?? effectiveSlippagePct,
        gasUsed: receipt?.gasUsed ? Number(receipt.gasUsed) : null,
        txHash: receipt?.hash,
        deltaPct: grade.deltaPct,
        route: pendingExecutionRef.current.routeLabels,
        grade,
      });

      setSwapStatus({
        message: `Swap executed. Min received: ${formatUnits(
          minOut,
          buyMeta?.decimals ?? 18
        )} ${buyToken}${pointsSuffix}`,
        hash: receipt.hash,
        variant: "success",
      });
      refreshPoints();
      await refreshBalances();
      if (walletFlowSwapStarted) {
        setWalletFlowStepStatus("swap", "done");
        setTimeout(closeWalletFlow, 900);
      }
    } catch (e) {
      const txHash = extractTxHash(e) || pendingTxHashRef.current;
      if (txHash) {
        const receipt = await tryFetchReceipt(txHash, provider);
        const status = receipt?.status;
        const normalized = typeof status === "bigint" ? Number(status) : status;
        if (normalized === 1) {
          if (walletFlowOpenForAction) {
            setWalletFlowStepStatus("swap", "done");
            setTimeout(closeWalletFlow, 900);
          }
          setSwapStatus({
            variant: "success",
            hash: txHash,
            message: `Swap confirmed. Check the explorer for details.${pointsSuffix}`,
          });
          refreshPoints();
          await refreshBalances();
          return;
        }
        if (normalized === 0) {
          if (walletFlowOpenForAction) {
            setWalletFlowStepStatus("swap", "error");
            setWalletFlow((prev) => ({
              ...prev,
              lastError: friendlySwapError(e),
            }));
          }
          setSwapStatus({
            variant: "error",
            hash: txHash,
            message: friendlySwapError(e),
          });
          return;
        }
        setSwapStatus({
          variant: "pending",
          hash: txHash,
          message: "Transaction submitted. Waiting for confirmation.",
        });
        return;
      }
      const userRejected =
        e?.code === 4001 ||
        e?.code === "ACTION_REJECTED" ||
        (e?.message || "").toLowerCase().includes("user denied");
      const message = userRejected
        ? "Transaction was rejected in wallet."
        : friendlySwapError(e);
      if (walletFlowSwapStarted) {
        setWalletFlowStepStatus("swap", "error");
        setWalletFlow((prev) => ({ ...prev, lastError: message }));
      }
      setSwapStatus({ message, variant: "error" });
    } finally {
      setSwapLoading(false);
      pendingExecutionRef.current = null;
      pendingTxHashRef.current = null;
    }
  };

  return (
    <div className="w-full flex flex-col items-center mt-10 px-4 sm:px-0">
      <div className="w-full max-w-xl rounded-3xl bg-slate-900/80 border border-slate-800 p-4 sm:p-6 shadow-xl">
        <div
          className={`mb-4 rounded-2xl border p-4 transition-colors ${
            isSellPanelActive
              ? "bg-slate-900/92 border-sky-500/35"
              : hasSellAmountValue
                ? "bg-slate-900/88 border-sky-500/25 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.12)]"
              : "bg-slate-900/85 border-slate-800"
          }`}
        >
          <div className="flex items-center justify-between mb-2 text-[10px] text-slate-600/90">
            <span>Sell</span>
            <span className="font-medium text-slate-500/85">
              Balance: {formatBalance(effectiveBalances[sellToken])} {displaySellSymbol}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectorOpen("sell");
                setTokenSearch("");
              }}
              className="px-3 py-2 rounded-xl bg-slate-800/95 text-xs text-slate-50 border border-slate-600 flex items-center gap-2 shadow-[inset_0_1px_0_rgba(148,163,184,0.15),0_8px_20px_-14px_rgba(56,189,248,0.55)] min-w-0 w-full sm:w-auto sm:min-w-[140px] hover:border-sky-400/70 hover:bg-slate-800 transition"
            >
              <TokenLogo
                token={displaySellMeta}
                fallbackSymbol={sellToken}
                imgClassName="h-6 w-6 rounded-full object-contain"
                placeholderClassName="h-6 w-6 rounded-full bg-slate-700 text-[10px] font-semibold flex items-center justify-center text-white"
              />
              <div className="flex flex-col items-start">
                <span className="text-sm font-bold text-slate-50">
                  {displaySellSymbol}
                </span>
                <span className="text-[10px] text-slate-600">
                  {displaySellAddress ? shortenAddress(displaySellAddress) : "Native"}
                </span>
              </div>
              <svg
                className="ml-auto h-3.5 w-3.5 text-slate-500"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M6 8l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <input
              name="swap-amount-in"
              value={amountIn}
              autoComplete="off"
              data-lpignore="true"
              data-form-type="other"
              onChange={(e) => {
                const next = sanitizeAmountInput(e.target.value, sellInputDecimals);
                if (activeQuickPercent !== null) setActiveQuickPercent(null);
                setAmountIn(next);
                if (swapInputMode !== "in") {
                  setSwapInputMode("in");
                }
                if (quoteError) setQuoteError("");
                if (swapStatus) setSwapStatus(null);
              }}
              onFocus={() => setFocusedAmountField("sell")}
              onBlur={() =>
                setFocusedAmountField((prev) => (prev === "sell" ? "" : prev))
              }
              placeholder="0.00"
              className={`flex-1 text-right rounded-xl px-2 py-1.5 bg-transparent font-semibold ${
                hasSellAmountValue ? "text-white" : "text-slate-100"
              } outline-none placeholder:text-slate-600/60 w-full transition-shadow ${
                isSellAmountFocused
                  ? "shadow-[inset_0_0_0_1px_rgba(56,189,248,0.45),inset_0_0_26px_rgba(56,189,248,0.16)]"
                  : hasSellAmountValue
                    ? "shadow-[inset_0_0_0_1px_rgba(56,189,248,0.33),inset_0_0_22px_rgba(56,189,248,0.12)]"
                    : "shadow-[inset_0_0_0_1px_rgba(30,41,59,0.35)]"
              } ${amountTextClass(amountIn, "text-[1.95rem] sm:text-[2.55rem]")}`}
            />
          </div>
          <div className="flex justify-end gap-2 mt-3 text-[10px] sm:text-[11px]">
            {[0.25, 0.5, 0.75, 1].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleQuickPercent(p)}
                className={`px-2.5 py-1 rounded-lg border text-slate-200 transition-all ${
                  activeQuickPercent === p
                    ? "border-sky-400/80 bg-sky-500/25 text-sky-50 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.25),0_10px_20px_-14px_rgba(56,189,248,0.7)]"
                    : "border-slate-700 bg-slate-800/70 hover:border-sky-400/75 hover:bg-slate-700/90 hover:-translate-y-[1px]"
                }`}
              >
                {Math.round(p * 100)}%
              </button>
            ))}
            <div className="px-2 py-1 text-[10px] text-slate-600/85">
              {formatBalance(sellBalance)} {displaySellSymbol} available
            </div>
          </div>
        </div>

        <div className="flex justify-center my-2">
          <div className="relative group">
            <div className="absolute inset-0 blur-lg bg-gradient-to-r from-sky-500/35 via-cyan-400/30 to-sky-500/25 opacity-0 group-hover:opacity-80 transition duration-500" />
            <button
              onClick={() => {
                setSwapPulse(true);
                setSellToken(buyToken);
                setBuyToken(sellToken);
                setTimeout(() => setSwapPulse(false), 320);
              }}
              className="relative h-12 w-12 rounded-full border border-slate-500/80 bg-slate-900 flex items-center justify-center text-slate-200 text-lg shadow-md shadow-black/40 hover:border-sky-300/80 hover:scale-[1.04] hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-10px_rgba(56,189,248,0.62)] transition-transform duration-300 active:scale-95"
              aria-label="Invert tokens"
            >
              <span
                className="absolute inset-0 rounded-full bg-gradient-to-br from-sky-500/25 via-indigo-500/20 to-purple-500/25 opacity-0 group-hover:opacity-100 transition duration-300"
                style={{
                  transform: swapPulse ? "scale(1.1)" : "scale(0.9)",
                  filter: swapPulse ? "blur(6px)" : "blur(10px)",
                }}
              />
              <svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="h-[22px] w-[22px] text-slate-100 transition duration-300 ease-out"
                style={{
                  transform: swapPulse
                    ? "rotate(210deg) scale(1.1)"
                    : "rotate(0deg) scale(1)",
                  filter: swapPulse
                    ? "drop-shadow(0 0 12px rgba(56,189,248,0.8))"
                    : "drop-shadow(0 0 2px rgba(148,163,184,0.35))",
                }}
              >
                <path
                  d="M12 4l3 3h-2v7h-2V7H9l3-3ZM12 20l-3-3h2v-7h2v7h2l-3 3Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="mb-7 rounded-2xl bg-slate-900/95 border border-sky-500/30 p-4 shadow-[0_16px_36px_-26px_rgba(56,189,248,0.6)]">
          <div className="flex items-center justify-between mb-2 text-[10px] text-slate-600/90">
            <span>Buy</span>
            <span className="font-medium text-slate-500/85">
              Balance: {formatBalance(effectiveBalances[buyToken])} {displayBuySymbol}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectorOpen("buy");
                setTokenSearch("");
              }}
              className="px-3 py-2 rounded-xl bg-slate-800/95 text-xs text-slate-50 border border-slate-600 flex items-center gap-2 shadow-[inset_0_1px_0_rgba(148,163,184,0.15),0_8px_20px_-14px_rgba(56,189,248,0.55)] min-w-0 w-full sm:w-auto sm:min-w-[140px] hover:border-sky-400/70 hover:bg-slate-800 transition"
            >
              <TokenLogo
                token={displayBuyMeta}
                fallbackSymbol={buyToken}
                imgClassName="h-6 w-6 rounded-full object-contain"
                placeholderClassName="h-6 w-6 rounded-full bg-slate-700 text-[10px] font-semibold flex items-center justify-center text-white"
              />
              <div className="flex flex-col items-start">
                <span className="text-sm font-bold text-slate-50">
                  {displayBuySymbol}
                </span>
                <span className="text-[10px] text-slate-600">
                  {displayBuyAddress ? shortenAddress(displayBuyAddress) : "Native"}
                </span>
              </div>
              <svg
                className="ml-auto h-3.5 w-3.5 text-slate-500"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M6 8l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="flex-1 text-right w-full">
              <input
                name="swap-amount-out"
                value={quoteOutDisplayValue}
                autoComplete="off"
                data-lpignore="true"
                data-form-type="other"
                onChange={(e) => {
                  const next = sanitizeAmountInput(e.target.value, buyInputDecimals);
                  setAmountOutInput(next);
                  if (swapInputMode !== "out") {
                    setSwapInputMode("out");
                  }
                  if (quoteError) setQuoteError("");
                  if (swapStatus) setSwapStatus(null);
                }}
                onFocus={() => {
                  setFocusedAmountField("buy");
                  if (!isExactOut) {
                    setSwapInputMode("out");
                    if (!amountOutInput && quoteOut) {
                      setAmountOutInput(quoteOut);
                    }
                  }
                }}
                onBlur={() =>
                  setFocusedAmountField((prev) => (prev === "buy" ? "" : prev))
                }
                placeholder="0.00"
                title={
                  hasFullPrecisionHint
                    ? `Full precision: ${quoteOut || ""} ${displayBuySymbol || ""}`
                    : undefined
                }
                className={`w-full text-right rounded-xl px-2 py-1.5 bg-transparent font-semibold text-slate-50 outline-none placeholder:text-slate-600/60 transition-shadow ${
                  isBuyAmountFocused
                    ? "shadow-[inset_0_0_0_1px_rgba(56,189,248,0.5),inset_0_0_28px_rgba(56,189,248,0.22)]"
                    : "shadow-[inset_0_0_0_1px_rgba(56,189,248,0.22),inset_0_0_24px_rgba(56,189,248,0.1)]"
                } ${amountTextClass(
                  quoteOutDisplayValue,
                  "text-[2.1rem] sm:text-[2.75rem]"
                )}`}
              />
              {hasFullPrecisionHint ? (
                <div
                  className="text-[10px] text-slate-500/80"
                  title={`Full precision: ${quoteOut || ""} ${displayBuySymbol || ""}`}
                >
                  Full precision available
                </div>
              ) : null}
              <div className="text-[10px] text-slate-600/85">
                {quoteSourceLabel}
              </div>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden mb-3 rounded-2xl bg-slate-900/70 border border-slate-800 p-4 shadow-[0_14px_40px_-24px_rgba(56,189,248,0.6)]">
          <div
            className={`pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-sky-400/12 to-transparent transition-opacity duration-300 ${
              routeRefreshFx ? "opacity-100" : "opacity-0"
            }`}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-slate-100">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm font-semibold">Route</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="px-2 py-0.5 rounded-full bg-slate-900/55 border border-slate-700/60 text-slate-300">
                {routeProtocolLabel}
              </span>
              {routeModeLabel && (
                <span className="px-2 py-0.5 rounded-full bg-slate-900/55 border border-slate-700/60 text-slate-300">
                  {routeModeLabel}
                </span>
              )}
              {hopCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-slate-900/55 border border-slate-700/60 text-slate-300">
                  {hopCount} hop{hopCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          <div className="mt-2 relative group focus:outline-none" tabIndex={0}>
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-200">
              {activeRouteTokens.map((token, idx) => (
                <React.Fragment key={`${token.symbol || "token"}-${idx}`}>
                  <span title={token.symbol} aria-label={token.symbol}>
                    <TokenLogo
                      token={token.meta}
                      fallbackSymbol={token.symbol}
                      imgClassName="h-6 w-6 rounded-full object-contain"
                      placeholderClassName="h-6 w-6 rounded-full bg-slate-700 text-[9px] font-semibold flex items-center justify-center text-white"
                    />
                  </span>
                  {idx < activeRouteTokens.length - 1 && (
                    <span className="text-slate-500">-&gt;</span>
                  )}
                </React.Fragment>
              ))}
            </div>
            <div className="hidden pt-2 group-hover:block group-focus-within:block">
              <div
                className="w-full max-w-[420px] rounded-2xl border border-slate-800 bg-slate-950/95 p-3 shadow-2xl shadow-black/50"
                role="tooltip"
              >
                <div className="text-[10px] uppercase tracking-wide text-slate-400">
                  Full route
                </div>
                {routeSegments.length ? (
                  <div className="mt-2 space-y-2">
                    {routeSegments.map((segment, segIdx) => (
                      <div
                        key={`route-seg-${segIdx}`}
                        className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2"
                      >
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span>{segment.protocol}</span>
                          {quoteMeta?.protocol === "SPLIT" && (
                            <span>{Math.round(segment.sharePct || 0)}%</span>
                          )}
                        </div>
                        <div className="mt-2 space-y-1">
                          {segment.hops.map((hop, hopIdx) => (
                            <div
                              key={`route-hop-${segIdx}-${hopIdx}`}
                              className="flex items-center gap-3 text-xs text-slate-200"
                            >
                              <div className="flex items-center gap-2">
                                <div className="h-5 w-5 rounded-full border border-slate-700 bg-slate-950/80 overflow-hidden flex items-center justify-center">
                                  {hop.from?.meta?.logo ? (
                                    <img
                                      src={hop.from.meta.logo}
                                      alt={`${hop.from?.symbol || "Token"} logo`}
                                      className="h-full w-full object-contain"
                                    />
                                  ) : (
                                    <span className="text-[8px] font-semibold text-slate-300">
                                      {(hop.from?.symbol || "TKN").slice(0, 2)}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[11px] font-semibold text-slate-100">
                                  {hop.from?.symbol || "Token"}
                                </span>
                              </div>
                              <div className="flex-1 flex items-center gap-2 min-w-[72px]">
                                <div className="h-px flex-1 border-t border-dashed border-slate-600/70" />
                                <span className="px-2 py-0.5 rounded-full border border-slate-700 bg-slate-950/80 text-[10px] text-slate-300 whitespace-nowrap">
                                  {hop.protocol === "V3" ? formatV3Fee(hop.fee) : "V2"}
                                </span>
                                <div className="h-px flex-1 border-t border-dashed border-slate-600/70" />
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-semibold text-slate-100">
                                  {hop.to?.symbol || "Token"}
                                </span>
                                <div className="h-5 w-5 rounded-full border border-slate-700 bg-slate-950/80 overflow-hidden flex items-center justify-center">
                                  {hop.to?.meta?.logo ? (
                                    <img
                                      src={hop.to.meta.logo}
                                      alt={`${hop.to?.symbol || "Token"} logo`}
                                      className="h-full w-full object-contain"
                                    />
                                  ) : (
                                    <span className="text-[8px] font-semibold text-slate-300">
                                      {(hop.to?.symbol || "TKN").slice(0, 2)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-slate-500">No route data.</div>
                )}
                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Estimated LP fees</span>
                  <span className="text-slate-200">{routeFeeUsdLabel}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-6 gap-2.5 text-slate-100">
            <div className="sm:col-span-3 rounded-xl border border-slate-700/80 bg-slate-900/65 px-3 py-2.5 flex flex-col gap-1">
              <span className="text-slate-400 text-[10px] uppercase tracking-wide">Expected</span>
              <span className="text-[19px] sm:text-[22px] font-extrabold text-slate-50">
                {quoteOut !== null ? formatDisplayAmount(quoteOut, displayBuySymbol) : "--"}
              </span>
            </div>
            <div className="sm:col-span-1 rounded-xl border border-slate-800 bg-slate-900/50 px-2.5 py-1.5 flex flex-col gap-0.5">
              <span className="text-slate-500 text-[10px] uppercase tracking-wide">Min received</span>
              <span className="text-sm font-semibold text-slate-200">{minReceivedDisplay}</span>
            </div>
            <div className="sm:col-span-1 rounded-xl border border-slate-800 bg-slate-900/50 px-2.5 py-1.5 flex flex-col gap-0.5">
              <span className="text-slate-500 text-[10px] uppercase tracking-wide">Price impact</span>
              <span className={`text-sm font-semibold ${priceImpactToneClass}`}>
                {priceImpact !== null ? `${priceImpact.toFixed(2)}%` : "--"}
              </span>
            </div>
            <div className="sm:col-span-1 rounded-xl border border-slate-800/75 bg-slate-950/40 px-2.5 py-1.5 flex flex-col gap-0.5">
              <span className="text-slate-600 text-[10px] uppercase tracking-wide">LP fees (est.)</span>
              <span className="text-xs font-medium text-slate-400">{routeFeeUsdLabel}</span>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-2 text-emerald-100">
              <span
                className={`h-2 w-2 rounded-full ${
                  quoteLoading ? "bg-amber-400 animate-pulse" : "bg-emerald-400 animate-ping"
                }`}
              />
              {quoteLoading ? "Updating..." : `Updated ${quoteAgeLabel}`}
            </span>
            <span>
              Slippage{" "}
              <span className="text-emerald-200">
                {Number(effectiveSlippagePct || 0).toFixed(2)}%
              </span>
            </span>
          </div>

          {isQuoteLocked ? (
            <div className="mt-2 text-[11px] text-amber-200 inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>Quote locked while you sign. Auto re-quote resumes shortly.</span>
            </div>
          ) : null}
          {quoteError ? (
            <div className="mt-2 text-[11px] text-rose-300">
              {quoteError}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <div className="flex-1 rounded-2xl bg-slate-900 border border-slate-800 p-3 text-xs text-slate-300">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400">Slippage (%)</span>
              <div className="flex items-center gap-1.5">
                {[0.1, 0.5, 1].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setSlippage(String(p))}
                    className={`px-2 py-0.5 rounded-md text-[10px] border font-medium transition ${
                      Number(slippage) === p
                        ? "bg-sky-500/35 border-sky-300/90 text-sky-50 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.5),0_8px_16px_-12px_rgba(56,189,248,0.6)]"
                        : "bg-slate-800/90 border-slate-700 text-slate-300 hover:border-sky-500/50 hover:bg-slate-700/85"
                    }`}
                  >
                    {p}%
                  </button>
                ))}
                <div className="ml-1 pl-2 border-l border-slate-700/80">
                  <input
                    name="swap-slippage"
                    value={slippage}
                    onChange={(e) => setSlippage(e.target.value)}
                    className="w-16 px-2 py-1 rounded-md bg-slate-800/90 border border-slate-700 text-right text-slate-100 text-[12px]"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-500">Effective</span>
              <span className="text-slate-100">
                {Number(effectiveSlippagePct || 0).toFixed(2)}%
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] mt-1">
              <span className="text-slate-500">Min received</span>
              <span className="text-slate-100">{minReceivedDisplay}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2 w-full sm:w-44">
            {sellToken !== "ETH" ? (
              <div className="rounded-2xl bg-gradient-to-br from-slate-800/80 via-slate-800/90 to-slate-900 border border-slate-700 px-3 py-3 text-[11px] text-slate-100 flex flex-col gap-2 shadow-[0_12px_30px_-18px_rgba(56,189,248,0.5)]">
                <div className="flex items-center gap-2 text-slate-50 text-xs font-semibold">
                  <span className="h-7 w-7 inline-flex items-center justify-center rounded-xl bg-sky-500/20 border border-sky-500/30 text-sky-100 text-[10px] shadow-[0_0_18px_rgba(56,189,248,0.35)]">
                    ALW
                  </span>
                  Approval
                </div>
                <div className="flex flex-col gap-1 text-slate-200">
                  {!isDirectEthWeth && approveNeeded && amountIn ? (
                    <span className="text-slate-100 font-semibold">
                      Approval required for {sellToken}.
                    </span>
                  ) : (
                    <span className="text-slate-400">
                      No approval required for the current selection.
                    </span>
                  )}
                </div>
              </div>
            ) : null}
            <button
              onClick={handleSwap}
              disabled={
                swapLoading ||
                quoteLoading
              }
              className="w-full py-3 rounded-2xl border border-sky-300/55 bg-gradient-to-r from-sky-500/95 via-cyan-400/92 to-indigo-500/95 bg-[length:155%_155%] bg-[position:0%_50%] text-sm font-bold text-white shadow-[0_14px_26px_-16px_rgba(56,189,248,0.55)] transition-all duration-250 hover:bg-[position:100%_50%] hover:-translate-y-[1px] hover:shadow-[0_20px_34px_-18px_rgba(56,189,248,0.64)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 active:translate-y-0 active:scale-[0.99] disabled:from-slate-700 disabled:via-slate-700 disabled:to-slate-700 disabled:border-slate-600 disabled:text-slate-400 disabled:shadow-none disabled:translate-y-0 disabled:cursor-not-allowed disabled:scale-100"
            >
              <span className="inline-flex items-center gap-2 justify-center">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                >
                  <path
                    d="M5 12h14M13 6l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {swapLoading ? "Swapping..." : "Swap now"}
              </span>
            </button>
          </div>
        </div>

      </div>

{executionProof && (
        <div className="w-full max-w-xl mt-4 rounded-3xl bg-slate-950/85 border border-emerald-700/40 p-4 sm:p-5 shadow-[0_18px_48px_-24px_rgba(16,185,129,0.55)]">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 text-emerald-50">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-lg font-semibold">Swap receipt</span>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/80 border border-emerald-500/50 text-sm text-emerald-100">
              <span>{executionProof.grade?.icon || "✓"}</span>
              <span className="font-semibold">{executionProof.grade?.label || "Done"}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-100">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">You received</span>
              <span className="font-semibold">{executionProof.executed}</span>
              <span className="text-[11px] text-emerald-300">
                {executionProof.deltaPct !== null && executionProof.deltaPct !== undefined
                  ? executionProof.deltaPct >= -0.1
                    ? "Matched the quote"
                    : `-${Math.abs(executionProof.deltaPct).toFixed(2)}% vs quote`
                  : "Based on on-chain fill"}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">Quote safety</span>
              <span className="font-semibold">{executionProof.minReceived}</span>
              <span className="text-[11px] text-slate-400">
                Slippage guard:{" "}
                {executionProof.slippage
                  ? `${executionProof.slippage}%`
                  : `${Number(effectiveSlippagePct || slippage || 0).toFixed(2)}%`}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">Price impact</span>
              <span className="font-semibold">
                {executionProof.priceImpact !== null && executionProof.priceImpact !== undefined
                  ? `${Number(executionProof.priceImpact || 0).toFixed(2)}%`
                  : "--"}
              </span>
              <span className="text-[11px] text-slate-400">Includes LP fees</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">Network fee (gas units)</span>
              <span className="font-semibold">
                {executionProof.gasUsed ? executionProof.gasUsed.toLocaleString() : "--"}
              </span>
              <span className="text-[11px] text-slate-500">Wallet shows the fee you paid</span>
            </div>
          </div>

          {executionProof.route?.length ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-slate-200">
              <span className="text-slate-500">Route</span>
                            {executionProof.route.map((label, idx) => {
                const token = resolveRouteToken(label);
                return (
                  <React.Fragment key={`${label}-${idx}-proof`}>
                    <span title={token.symbol} aria-label={token.symbol}>
                      <TokenLogo
                        token={token.meta}
                        fallbackSymbol={token.symbol}
                        imgClassName="h-5 w-5 rounded-full object-contain"
                        placeholderClassName="h-5 w-5 rounded-full bg-slate-700 text-[8px] font-semibold flex items-center justify-center text-white"
                      />
                    </span>
                    {idx < executionProof.route.length - 1 && (
                      <span className="text-slate-500">→</span>
                    )}
                  </React.Fragment>
                );
              })}
              {executionProof.route.length === 2 &&
                executionProof.route.includes("ETH") &&
                executionProof.route.includes("WETH") ? (
                  <span className="ml-1 inline-flex items-center gap-1 text-emerald-200 bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 rounded-full">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span>Direct wrap/unwrap • no LP fee</span>
                  </span>
                ) : null}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            {executionProof.txHash ? (
              <button
                type="button"
                onClick={() =>
                  window.open(`${EXPLORER_BASE_URL}/tx/${executionProof.txHash}`, "_blank", "noopener,noreferrer")
                }
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/80 border border-emerald-500/40 text-emerald-100 hover:border-emerald-400/70 transition"
              >
                <span>View transaction</span>
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                >
                  <path
                    d="M5 13l9-9m0 0h-5m5 0v5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ) : null}
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-100">
              <span>{executionProof.grade?.icon || "✓"}</span>
              <span className="font-semibold">{executionProof.grade?.label || "OK"}</span>
            </div>
          </div>
        </div>
      )}

      {selectorOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeSelector} />
          <div className="relative w-full max-w-2xl bg-[#0a0f24] border border-slate-800 rounded-3xl shadow-2xl shadow-black/50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div>
                <div className="text-sm font-semibold text-slate-100">Select Token</div>
              </div>
              <button
                onClick={closeSelector}
                className="h-9 w-9 rounded-full bg-slate-900 text-slate-200 flex items-center justify-center border border-slate-800 hover:border-slate-600"
                aria-label="Close token selector"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                >
                  <path
                    d="M6 6l12 12M6 18L18 6"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="px-4 py-3 flex flex-col gap-3">
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 text-slate-500"
                >
                  <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <input
                  name="swap-token-search"
                  value={tokenSearch}
                  onChange={(e) => {
                    setTokenSearch(e.target.value);
                    if (customTokenAddError) setCustomTokenAddError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    if (!showQuickAdd) return;
                    e.preventDefault();
                    addCustomTokenByAddress(searchAddress, { clearSearch: true });
                  }}
                  placeholder="Search name or paste token address"
                  className="bg-transparent outline-none flex-1 text-slate-100 placeholder:text-slate-500"
                />
              </div>
              {customTokenAddError && (
                <div className="text-xs text-amber-300 px-1">
                  {customTokenAddError}
                </div>
              )}
            </div>

            <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-800">
              {filteredTokens.map(({ key: tokenKey, meta: t }) => {
                const displayAddress = t?.address || "";
                const displaySym = displaySymbol(t, tokenKey);
                return (
                  <button
                    key={`${selectorOpen}-${tokenKey}`}
                    type="button"
                    onClick={() => handleSelectToken(tokenKey)}
                    className="w-full px-4 py-3 flex items-center gap-3 bg-slate-950/50 hover:bg-slate-900/70 transition text-left"
                  >
                    <TokenLogo
                      token={t}
                      fallbackSymbol={tokenKey}
                      imgClassName="h-10 w-10 rounded-full border border-slate-800 bg-slate-900 object-contain"
                      placeholderClassName="h-10 w-10 rounded-full bg-slate-800 border border-slate-700 text-sm font-semibold text-white flex items-center justify-center"
                    />
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                        {displaySym}
                        {!displayAddress && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                            Native
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {t.name || (displayAddress ? shortenAddress(displayAddress) : "Token")}
                      </div>
                    </div>
                    <div className="ml-auto flex flex-col items-end gap-1 text-right text-sm text-slate-200">
                      {displayAddress ? (
                        <div className="flex items-center gap-2">
                          <a
                            href={`${EXPLORER_BASE_URL}/address/${displayAddress}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-200 hover:text-sky-100"
                          >
                            {shortenAddress(displayAddress)}
                            <svg
                              viewBox="0 0 20 20"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-3 w-3"
                            >
                              <path
                                d="M5 13l9-9m0 0h-5m5 0v5"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </a>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const copy = () => {
                                setCopiedToken(displayAddress);
                                if (copyTimerRef.current) {
                                  clearTimeout(copyTimerRef.current);
                                }
                                copyTimerRef.current = setTimeout(() => {
                                  setCopiedToken("");
                                  copyTimerRef.current = null;
                                }, 1000);
                              };
                              if (navigator?.clipboard?.writeText) {
                                navigator.clipboard.writeText(displayAddress).then(copy).catch(copy);
                              } else {
                                copy();
                              }
                            }}
                            className="h-6 w-6 inline-flex items-center justify-center rounded-md bg-slate-800 border border-slate-700 text-[11px] text-slate-300 hover:text-sky-100 hover:border-sky-500/60"
                            aria-label={`Copy ${displaySym} address`}
                          >
                            {copiedToken === displayAddress ? (
                              <svg
                                viewBox="0 0 20 20"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-3.5 w-3.5 text-emerald-300"
                              >
                                <path
                                  d="M5 11l3 3 7-7"
                                  stroke="currentColor"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            ) : (
                              <svg
                                viewBox="0 0 20 20"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-3.5 w-3.5"
                              >
                                <path
                                  d="M7 5.5C7 4.672 7.672 4 8.5 4H15.5C16.328 4 17 4.672 17 5.5V12.5C17 13.328 16.328 14 15.5 14H8.5C7.672 14 7 13.328 7 12.5V5.5Z"
                                  stroke="currentColor"
                                  strokeWidth="1.3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                <path
                                  d="M5 7H5.5C6.328 7 7 7.672 7 8.5V14.5C7 15.328 6.328 16 5.5 16H4.5C3.672 16 3 15.328 3 14.5V8.5C3 7.672 3.672 7 4.5 7H5Z"
                                  stroke="currentColor"
                                  strokeWidth="1.3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500">Native asset</span>
                      )}
                      <div>{formatBalance(effectiveBalances[tokenKey])}</div>
                    </div>
                  </button>
                );
              })}
              {showQuickAdd ? (
                <div className="px-4 py-6 text-sm text-slate-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <div className="text-slate-100 font-semibold">
                      {searchTokenMeta?.symbol
                        ? `${searchTokenMeta.symbol} · ${searchTokenMeta.name || "Token"}`
                        : searchTokenMetaLoading
                          ? "Loading token..."
                          : "Token not listed"}
                    </div>
                    <div className="text-xs text-slate-500">{shortenAddress(searchAddress)}</div>
                    {searchTokenMetaLoading && (
                      <div className="text-xs text-slate-500">Loading token info...</div>
                    )}
                    {searchTokenMetaError && (
                      <div className="text-xs text-amber-300">{searchTokenMetaError}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => addCustomTokenByAddress(searchAddress, { clearSearch: true })}
                    disabled={customTokenAddLoading || searchTokenMetaLoading}
                    className="px-3 py-2 rounded-full bg-emerald-600 text-xs font-semibold text-white shadow-lg shadow-emerald-500/30 disabled:opacity-60"
                  >
                    {customTokenAddLoading ? "Adding..." : "Add Token"}
                  </button>
                </div>
              ) : !filteredTokens.length ? (
                <div className="px-4 py-6 text-center text-sm text-slate-400">
                  No tokens found.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {walletFlow.open && walletFlow.steps.length ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 py-10">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={closeWalletFlow}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-md rounded-3xl bg-[#0a0f24] border border-slate-800 shadow-2xl shadow-black/60 overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div className="text-sm font-semibold text-slate-100">
                Continue in your wallet
              </div>
              <button
                type="button"
                onClick={closeWalletFlow}
                className="h-9 w-9 rounded-full bg-slate-900 text-slate-200 flex items-center justify-center border border-slate-800 hover:border-slate-600"
                aria-label="Close wallet flow"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                >
                  <path
                    d="M6 6l12 12M6 18L18 6"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="px-5 py-5">
              <div className="space-y-3">
                {walletFlow.steps.map((step, idx) => {
                  const total = walletFlow.steps.length;
                  const isLast = idx === total - 1;
                  const isActive = step.status === "active";
                  const isDone = step.status === "done";
                  const isError = step.status === "error";
                  const label = isDone
                    ? String(step.label || "").replace(/^Approve\s+/i, "Approved ")
                    : step.label;
                  const iconTone = isDone
                    ? "bg-emerald-600/25 border-emerald-500/40 text-emerald-100"
                    : isActive
                      ? "bg-sky-500/25 border-sky-400/40 text-sky-100"
                      : isError
                        ? "bg-rose-600/25 border-rose-500/40 text-rose-100"
                        : "bg-slate-900 border-slate-700 text-slate-500";

                  return (
                    <div key={step.id} className="flex items-start gap-3">
                      <div className="relative flex flex-col items-center">
                        <div
                          className={`h-9 w-9 rounded-2xl border flex items-center justify-center shadow-[inset_0_1px_0_rgba(148,163,184,0.12)] ${iconTone}`}
                        >
                          {isDone ? (
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4.5 w-4.5"
                            >
                              <path
                                d="M5 13l4 4L19 7"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          ) : isActive ? (
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4.5 w-4.5 animate-spin"
                            >
                              <circle
                                cx="12"
                                cy="12"
                                r="9"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeOpacity="0.35"
                              />
                              <path
                                d="M21 12a9 9 0 00-9-9"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                              />
                            </svg>
                          ) : isError ? (
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4.5 w-4.5"
                            >
                              <path
                                d="M6 6l12 12M6 18L18 6"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                            </svg>
                          ) : (
                            <span className="h-2 w-2 rounded-full bg-current opacity-60" />
                          )}
                        </div>
                        {!isLast ? (
                          <div className="w-px flex-1 bg-slate-800/80 mt-2" />
                        ) : null}
                      </div>

                      <div className="flex-1 min-w-0 pt-1">
                        <div className="flex items-center justify-between gap-3">
                          <div
                            className={`text-sm font-semibold truncate ${
                              isDone
                                ? "text-slate-100"
                                : isActive
                                  ? "text-white"
                                  : isError
                                    ? "text-rose-100"
                                    : "text-slate-400"
                            }`}
                          >
                            {label}
                          </div>
                          {isActive ? (
                            <div className="text-xs text-slate-500 whitespace-nowrap">
                              Step {idx + 1} of {total}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {walletFlow.lastError ? (
                <div className="mt-4 rounded-2xl bg-rose-900/35 border border-rose-500/30 px-3 py-2 text-xs text-rose-100">
                  {walletFlow.lastError}
                </div>
              ) : null}

              <div className="mt-4 text-[11px] text-slate-500">
                Keep this window open while confirming transactions in your wallet.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {swapStatus && (
        <div className="fixed left-4 bottom-4 z-50 max-w-sm">
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              if (swapStatus?.hash) {
                window.open(`${EXPLORER_BASE_URL}/tx/${swapStatus.hash}`, "_blank", "noopener,noreferrer");
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (swapStatus?.hash) {
                  window.open(`${EXPLORER_BASE_URL}/tx/${swapStatus.hash}`, "_blank", "noopener,noreferrer");
                }
              }
            }}
            className={`group relative flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-sm cursor-pointer transition ${
              swapStatus.variant === "success"
                ? "bg-emerald-900/80 border-emerald-500/50 text-emerald-50 hover:border-emerald-400/70"
                : swapStatus.variant === "pending"
                ? "bg-slate-900/80 border-slate-700/60 text-slate-100 hover:border-slate-500/70"
                : "bg-rose-900/80 border-rose-500/50 text-rose-50 hover:border-rose-400/70"
            }`}
          >
            <div
              className={`mt-0.5 h-8 w-8 rounded-xl flex items-center justify-center shadow-inner shadow-black/30 ${
                swapStatus.variant === "success"
                  ? "bg-emerald-600/50 text-emerald-100"
                  : swapStatus.variant === "pending"
                  ? "bg-slate-700/60 text-slate-200"
                  : "bg-rose-600/50 text-rose-100"
              }`}
            >
              {swapStatus.variant === "success" ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                >
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : swapStatus.variant === "pending" ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 animate-spin"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeOpacity="0.35"
                  />
                  <path
                    d="M21 12a9 9 0 00-9-9"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                >
                  <path
                    d="M6 6l12 12M6 18L18 6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold">
                {swapStatus.variant === "success"
                  ? "Transaction confirmed"
                  : swapStatus.variant === "pending"
                  ? "Working..."
                  : "Transaction failed"}
              </div>
              <div className="text-xs text-slate-200/90 mt-0.5">
                {swapStatus.message}
              </div>
              {swapStatus.hash && (
                <div className="text-[11px] text-sky-200 underline mt-1">
                  Open on {EXPLORER_LABEL}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSwapStatus(null);
              }}
              className="ml-2 text-sm text-slate-300 hover:text-white"
              aria-label="Dismiss"
            >
              X
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

