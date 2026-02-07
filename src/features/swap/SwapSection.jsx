// src/features/swap/SwapSection.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  EXPLORER_BASE_URL,
  NETWORK_NAME,
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

const BASE_TOKEN_OPTIONS = ["ETH", "WETH", "USDT0", "CUSD", "USDm", "CRX", "MEGA"];
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
const V3_FEE_TIERS = [100, 500, 3000, 10000];
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
const trimTrailingZeros = (value) => {
  if (typeof value !== "string" || !value.includes(".")) return value;
  return value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
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
const TokenLogo = ({
  token,
  fallbackSymbol,
  imgClassName = "h-10 w-10 rounded-full border border-slate-800 bg-slate-900 object-contain",
  placeholderClassName =
    "h-10 w-10 rounded-full bg-slate-800 border border-slate-700 text-sm font-semibold text-white flex items-center justify-center",
}) => {
  const displaySym = displaySymbol(token, fallbackSymbol);
  const primaryLogo = token?.logo || null;
  const fallbackLogo =
    (fallbackSymbol && TOKENS[fallbackSymbol]?.logo) ||
    (token?.symbol && TOKENS[token.symbol]?.logo) ||
    null;
  const [src, setSrc] = useState(primaryLogo || fallbackLogo || null);

  useEffect(() => {
    setSrc(primaryLogo || fallbackLogo || null);
  }, [primaryLogo, fallbackLogo]);

  if (!src) {
    return (
      <div className={placeholderClassName}>
        {(displaySym || "?").slice(0, 3)}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`${displaySym || token?.symbol || "token"} logo`}
      className={imgClassName}
      onError={() => {
        if (fallbackLogo && src !== fallbackLogo) {
          setSrc(fallbackLogo);
        } else {
          setSrc(null);
        }
      }}
    />
  );
};
const paddedTopicAddress = (addr) =>
  `0x${(addr || "").toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

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

const formatDisplayAmount = (val, symbol) => {
  const num = Number(val);
  if (!Number.isFinite(num)) return "--";
  const str = formatCompactNumber(num);
  return symbol ? `${str} ${symbol}` : str;
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
    return "Permit2 allowance missing or expired. Click Approve, then retry the swap.";
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

const buildRealtimeProof = (
  receipt,
  { buyDecimals, buySymbol, routeLabels, slippagePct, minRaw, expectedRaw }
) => {
  const actual = receipt?.logs?.length
    ? (() => {
        const target = receipt.to?.toLowerCase?.() || "";
        const log = receipt.logs.find((l) => (l?.address || "").toLowerCase() === target);
        return null;
      })()
    : null;
  return {
    route: routeLabels,
    slippage: slippagePct,
    minReceived: minRaw ? formatDisplayAmount(Number(formatUnits(minRaw, buyDecimals)), buySymbol) : "--",
    expected: expectedRaw
      ? formatDisplayAmount(Number(formatUnits(expectedRaw, buyDecimals)), buySymbol)
      : "--",
  };
};

import { getActiveNetworkConfig } from "../../shared/config/networks";

export default function SwapSection({ balances, address, chainId, onBalancesRefresh }) {
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
      out[sym] = {
        ...base,
        ...meta,
        address: meta.address || base?.address || null,
        decimals: meta.decimals ?? base?.decimals,
        name: meta.name || base?.name,
        displaySymbol: meta.displaySymbol || base?.displaySymbol,
        logo: meta.logo || base?.logo || null,
      };
    });
    return out;
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
      UNIV3_UNIVERSAL_ROUTER_ADDRESS &&
      PERMIT2_ADDRESS
  );
  const hasV3Support = Boolean(
    UNIV3_FACTORY_ADDRESS &&
      UNIV3_QUOTER_V2_ADDRESS &&
      UNIV3_UNIVERSAL_ROUTER_ADDRESS &&
      PERMIT2_ADDRESS
  );
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
  const [swapStatus, setSwapStatus] = useState(null);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapPulse, setSwapPulse] = useState(false);
  const [approvalTargets, setApprovalTargets] = useState([]); // { symbol, address, desiredAllowance, spender, label, kind, expiration }
  const [approveLoading, setApproveLoading] = useState(false);
  const [quoteVolatilityPct, setQuoteVolatilityPct] = useState(0);
  const [selectorOpen, setSelectorOpen] = useState(null); // "sell" | "buy" | null
  const [tokenSearch, setTokenSearch] = useState("");
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
  const pendingTxHashRef = useRef(null);
  const autoRefreshTimerRef = useRef(null);
  const approvalCacheRef = useRef(new Map());
  const lastQuoteSourceRef = useRef("Live quote via CurrentX API...");
  const quoteInFlightRef = useRef(false);
  const lastQuoteKeyRef = useRef("");
  const routeCandidateCacheRef = useRef(new Map());

  const makeApprovalKey = (kind, token, spender) =>
    `${kind}:${(token || "").toLowerCase()}:${(spender || "").toLowerCase()}`;
  const getApprovalStorageKey = (wallet) =>
    `${APPROVAL_CACHE_KEY}:${(activeChainHex || "").toLowerCase()}:${(wallet || "").toLowerCase()}`;
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
    [activeChainHex]
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
    [activeChainHex]
  );
  const getCachedApproval = (kind, token, spender) => {
    if (!token || !spender) return null;
    const entry = approvalCacheRef.current.get(
      makeApprovalKey(kind, token, spender)
    );
    return entry || null;
  };
  const setCachedApproval = (target) => {
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
  };

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
  const approvalTarget = approvalTargetsForSell[0] || null;
  const approveNeeded = approvalTargetsForSell.length > 0;
  const approvalSteps = approvalTargetsForSell.length;
  const approvalButtonLabel = approvalSteps > 1
    ? `Approve ${sellToken} (${approvalSteps} steps)`
    : `Approve ${sellToken}`;

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
      .map((sym) => tokenRegistry[sym])
      .filter(
        (t) =>
          t &&
          (t.address || t.symbol === "ETH" || t.symbol === "WETH")
      );
    if (!q) return all;
    return all.filter((t) => {
      const addr = (t.address || "").toLowerCase();
      return (
        t.symbol.toLowerCase().includes(q) ||
        (t.name || "").toLowerCase().includes(q) ||
        addr.includes(q)
      );
    });
  }, [tokenOptions, tokenRegistry, tokenSearch]);
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
        const ercTokens = Object.values(tokenRegistry).filter((t) => t && t.address);
        if (!ercTokens.length) return;
        const calls = ercTokens.map((t) => ({
          target: t.address,
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
            const num = Number(formatUnits(raw, token.decimals || 18));
            if (Number.isFinite(num)) next[token.symbol] = num;
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
      setAmountIn("");
      setSwapInputMode("in");
      setQuoteError("");
      setSwapStatus(null);
      return;
    }
    const val = (bal * pct).toFixed(decimals);
    setAmountIn(val);
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
  const clearExecutionProof = useCallback(() => {
    setExecutionProof(null);
    if (executionClearRef.current) {
      clearTimeout(executionClearRef.current);
      executionClearRef.current = null;
    }
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
        const directPools = await listV3Pools(factory, a, b);
        const directRoutes = directPools.map((pool) => ({
          kind: "direct",
          path: [a, b],
          pools: [pool.pool],
          fees: [pool.fee],
        }));

        const candidateMids = getRouteCandidates(a, b);
        const hopCandidates = candidateMids.length
          ? await Promise.all(
              candidateMids.map(async (mid) => {
                const poolsA = await listV3Pools(factory, a, mid);
                if (!poolsA.length) return null;
                const poolsB = await listV3Pools(factory, mid, b);
                if (!poolsB.length) return null;
                return { mid, poolsA, poolsB };
              })
            )
          : [];
        const hopRoutes = hopCandidates
          .filter(Boolean)
          .flatMap((candidate) =>
            candidate.poolsA.flatMap((poolA) =>
              candidate.poolsB.map((poolB) => ({
                kind: "hop",
                path: [a, candidate.mid, b],
                pools: [poolA.pool, poolB.pool],
                fees: [poolA.fee, poolB.fee],
              }))
            )
          );

        return { directRoutes, hopRoutes };
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
      hasV3Support,
      listV3Pools,
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
      const factory = new Contract(UNIV3_FACTORY_ADDRESS, UNIV3_FACTORY_ABI, provider);
      const a = sellToken === "ETH" ? WETH_ADDRESS : sellMeta?.address;
      const b = buyToken === "ETH" ? WETH_ADDRESS : buyMeta?.address;
      if (!a || !b) throw new Error("Select tokens with valid addresses.");

      const directPools = await listV3Pools(factory, a, b);
      const hasDirect = directPools.length > 0;
      const candidateMids = getRouteCandidates(a, b);
      const hopCandidates = candidateMids.length
        ? await Promise.all(
            candidateMids.map(async (mid) => {
              const poolsA = await listV3Pools(factory, a, mid);
              if (!poolsA.length) return null;
              const poolsB = await listV3Pools(factory, mid, b);
              if (!poolsB.length) return null;
              return { mid, poolsA, poolsB };
            })
          )
        : [];
      const hopOptions = hopCandidates.filter(Boolean);
      const hasHop = hopOptions.length > 0;

      if (!hasDirect && !hasHop) {
        throw new Error("No V3 pools found for this pair.");
      }

      const buildDirectRoutes = () =>
        directPools.map((pool) => ({
          kind: "direct",
          path: [a, b],
          pools: [pool.pool],
          fees: [pool.fee],
        }));

      const pickBestForAmount = async (routes, amountIn) => {
        if (!routes.length) return null;
        if (!amountIn || amountIn <= 0n) return routes[0];
        const results = await Promise.all(
          routes.map(async (route) => {
            try {
              const amountOut = await quoteV3Route(provider, amountIn, route);
              return { ...route, amountOut };
            } catch {
              return null;
            }
          })
        );
        const valid = results.filter(Boolean);
        if (!valid.length) return null;
        return valid.reduce((best, next) => {
          if (!best) return next;
          return next.amountOut > best.amountOut ? next : best;
        }, null);
      };

      const pickBestHop = async () => {
        if (!hopOptions.length) return null;
        if (!amountWei || amountWei <= 0n) {
          const first = hopOptions[0];
          const poolA = first?.poolsA?.[0];
          const poolB = first?.poolsB?.[0];
          if (!poolA || !poolB) return null;
          return {
            kind: "hop",
            path: [a, first.mid, b],
            pools: [poolA.pool, poolB.pool],
            fees: [poolA.fee, poolB.fee],
          };
        }
        const results = await Promise.all(
          hopOptions.map(async (candidate) => {
            const routesA = candidate.poolsA.map((pool) => ({
              kind: "direct",
              path: [a, candidate.mid],
              pools: [pool.pool],
              fees: [pool.fee],
            }));
            const bestA = await pickBestForAmount(routesA, amountWei);
            if (!bestA?.amountOut) return null;
            const routesB = candidate.poolsB.map((pool) => ({
              kind: "direct",
              path: [candidate.mid, b],
              pools: [pool.pool],
              fees: [pool.fee],
            }));
            const bestB = await pickBestForAmount(routesB, bestA.amountOut);
            if (!bestB?.amountOut) return null;
            return {
              kind: "hop",
              path: [a, candidate.mid, b],
              pools: [bestA.pools?.[0] || null, bestB.pools?.[0] || null],
              fees: [bestA.fees?.[0], bestB.fees?.[0]],
              amountOut: bestB.amountOut,
            };
          })
        );
        const valid = results.filter(Boolean);
        if (!valid.length) return null;
        return valid.reduce((best, next) => {
          if (!best) return next;
          return next.amountOut > best.amountOut ? next : best;
        }, null);
      };

      const stripAmountOut = (route) => {
        if (!route) return null;
        const { amountOut, ...rest } = route;
        return rest;
      };

      const bestDirect = hasDirect ? await pickBestForAmount(buildDirectRoutes(), amountWei) : null;
      const bestHop = hasHop ? await pickBestHop() : null;
      if (bestDirect && bestHop) {
        return stripAmountOut(bestHop.amountOut > bestDirect.amountOut ? bestHop : bestDirect);
      }
      if (bestDirect) return stripAmountOut(bestDirect);
      if (bestHop) return stripAmountOut(bestHop);
      throw new Error("No V3 route available for this pair.");
    },
    [
      buyMeta?.address,
      buyToken,
      getRouteCandidates,
      hasV3Support,
      listV3Pools,
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
        const directPair = await factory.getPair(a, b).catch(() => ZERO_ADDRESS);
        const hasDirect = directPair && directPair !== ZERO_ADDRESS;
        const directRoute = hasDirect
          ? {
              protocol: "V2",
              kind: "direct",
              path: [a, b],
              pairs: [directPair].filter(Boolean),
            }
          : null;

        const candidateMids = getRouteCandidates(a, b);
        const hopPairs = candidateMids.length
          ? await Promise.all(
              candidateMids.map(async (mid) => {
                const pairA = await factory.getPair(a, mid).catch(() => ZERO_ADDRESS);
                if (!pairA || pairA === ZERO_ADDRESS) return null;
                const pairB = await factory.getPair(mid, b).catch(() => ZERO_ADDRESS);
                if (!pairB || pairB === ZERO_ADDRESS) return null;
                return { mid, pairA, pairB };
              })
            )
          : [];
        const hopRoutes = hopPairs
          .filter(Boolean)
          .map((pair) => ({
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

      const directPair = await factory.getPair(a, b).catch(() => ZERO_ADDRESS);
      const hasDirect = directPair && directPair !== ZERO_ADDRESS;
      const candidateMids = getRouteCandidates(a, b);
      const hopPairs = candidateMids.length
        ? await Promise.all(
            candidateMids.map(async (mid) => {
              const pairA = await factory.getPair(a, mid).catch(() => ZERO_ADDRESS);
              if (!pairA || pairA === ZERO_ADDRESS) return null;
              const pairB = await factory.getPair(mid, b).catch(() => ZERO_ADDRESS);
              if (!pairB || pairB === ZERO_ADDRESS) return null;
              return { mid, pairA, pairB };
            })
          )
        : [];
      const hopRoutes = hopPairs
        .filter(Boolean)
        .map((pair) => ({
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

      throw new Error("No V2 route available for this pair.");
    },
    [
      buyMeta?.address,
      buyToken,
      getRouteCandidates,
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
  const activeInputAmount = isExactOut ? amountOutInput : amountIn;

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
          : "";

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
        setQuoteVolatilityPct(0);
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
      if (!activeInputAmount || Number.isNaN(Number(activeInputAmount))) {
        resetQuoteState();
        return;
      }
      if (!isSupported) {
        setQuoteError("Select tokens with valid addresses.");
        resetQuoteState();
        return;
      }
      if (!hasV2Support && !hasV3Support) {
        setQuoteError("No router configured for this network.");
        resetQuoteState();
        return;
      }
      if (routePreference === "v2" && !hasV2Support) {
        setQuoteError("V2 support not configured for this network.");
        resetQuoteState();
        return;
      }
      if (routePreference === "v3" && !hasV3Support) {
        setQuoteError("V3 router not configured for this network.");
        resetQuoteState();
        return;
      }
      if (routePreference === "split" && (!hasV2Support || !hasV3Support)) {
        setQuoteError("Split routing requires both V2 and V3 routers.");
        resetQuoteState();
        return;
      }

      if (isDirectEthWeth) {
        const sellDecimals = sellMeta?.decimals ?? 18;
        const buyDecimals = buyMeta?.decimals ?? 18;
        const directAmount = isExactOut ? amountOutInput : amountIn;
        const directWei = parseUnits(directAmount, isExactOut ? buyDecimals : sellDecimals);
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
          const amountWei = isExactOut ? null : parseUnits(amountIn, sellDecimals);
          const desiredOutWei = isExactOut
            ? parseUnits(amountOutInput || "0", buyDecimals)
            : null;

          let v3Route = null;
          let v2Route = null;
          let splitRoute = null;

          if (isExactOut) {
            if (!desiredOutWei || desiredOutWei <= 0n) {
              setQuoteError("Enter an amount to fetch a quote.");
              return;
            }
            if (hasV3Support && routePreference !== "v2") {
              try {
                const { directRoutes, hopRoutes } = await buildV3RouteCandidates();
                const candidates = [...directRoutes, ...hopRoutes];
                const quoted = await Promise.all(
                  candidates.map(async (route) => {
                    try {
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
                    } catch {
                      return null;
                    }
                  })
                );
                const valid = quoted.filter(Boolean);
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
            if (hasV2Support && routePreference !== "v3") {
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

            const v3Candidates =
              hasV3Support && routePreference !== "v2"
                ? await buildV3RouteCandidates()
                : { directRoutes: [], hopRoutes: [] };
            const v2Candidates =
              hasV2Support && routePreference !== "v3"
                ? await buildV2RouteCandidates()
                : { directRoute: null, hopRoutes: [] };

            const v3Routes = [...v3Candidates.directRoutes, ...v3Candidates.hopRoutes].map(
              (route) => ({ ...route, protocol: "V3" })
            );
            const v2Routes = [
              ...(v2Candidates.directRoute ? [v2Candidates.directRoute] : []),
              ...v2Candidates.hopRoutes,
            ].map((route) => ({ ...route, protocol: "V2" }));

            const quotedV3 = await Promise.all(
              v3Routes.map(async (route) => {
                try {
                  const amountOut = await quoteV3Route(provider, amountWei, route);
                  return { ...route, amountOut };
                } catch {
                  return null;
                }
              })
            );
            const quotedV2 = await Promise.all(
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
            );

            const v3Valid = quotedV3.filter(Boolean);
            const v2Valid = quotedV2.filter(Boolean);
            if (v3Valid.length) {
              v3Route = v3Valid.reduce((best, next) => {
                if (!best) return next;
                return next.amountOut > best.amountOut ? next : best;
              }, null);
            }
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
                const maxCandidates = 3;
                const ranked = allQuoted
                  .slice()
                  .sort((a, b) => Number(b.amountOut - a.amountOut))
                  .slice(0, maxCandidates);
                const pairSteps = [];
                for (let pct = 5; pct <= 95; pct += 5) pairSteps.push(pct);
                const tripleSteps = [];
                for (let pct = 10; pct <= 90; pct += 10) tripleSteps.push(pct);
                const tripleStepSet = new Set(tripleSteps);
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

                for (let i = 0; i < ranked.length; i += 1) {
                  for (let j = i + 1; j < ranked.length; j += 1) {
                    const routeA = ranked[i];
                    const routeB = ranked[j];
                    for (const share of pairSteps) {
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
                  }
                }

                if (ranked.length >= 3 && tripleSteps.length) {
                  const trio = ranked.slice(0, 3);
                  for (let aIdx = 0; aIdx < tripleSteps.length; aIdx += 1) {
                    const shareA = tripleSteps[aIdx];
                    for (let bIdx = 0; bIdx < tripleSteps.length; bIdx += 1) {
                      const shareB = tripleSteps[bIdx];
                      const shareC = 100 - shareA - shareB;
                      if (shareC <= 0 || shareC >= 100) continue;
                      if (!tripleStepSet.has(shareC)) continue;
                      const amountA = (amountWei * BigInt(shareA)) / 100n;
                      const amountB = (amountWei * BigInt(shareB)) / 100n;
                      const amountC = amountWei - amountA - amountB;
                      if (amountA <= 0n || amountB <= 0n || amountC <= 0n) continue;
                      const [outA, outB, outC] = await Promise.all([
                        getCachedQuote(trio[0], amountA),
                        getCachedQuote(trio[1], amountB),
                        getCachedQuote(trio[2], amountC),
                      ]);
                      if (!outA || !outB || !outC) continue;
                      const total = outA + outB + outC;
                      if (!bestSplit || total > bestSplit.amountOut) {
                        bestSplit = {
                          protocol: "SPLIT",
                          kind: "split",
                          amountOut: total,
                          routes: [
                            {
                              ...trio[0],
                              amountIn: amountA,
                              amountOut: outA,
                              sharePct: shareA,
                            },
                            {
                              ...trio[1],
                              amountIn: amountB,
                              amountOut: outB,
                              sharePct: shareB,
                            },
                            {
                              ...trio[2],
                              amountIn: amountC,
                              amountOut: outC,
                              sharePct: shareC,
                            },
                          ],
                        };
                      }
                    }
                  }
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

          const amountOut = selectedRoute.amountOut;
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
          const prevRaw = lastQuoteOutRef.current;
          lastQuoteOutRef.current = amountOut;
          if (prevRaw) {
            const prevNum = Number(formatUnits(prevRaw, buyMeta?.decimals ?? 18));
            const currNum = Number(formattedOut);
            if (prevNum > 0 && Number.isFinite(prevNum) && Number.isFinite(currNum)) {
              const deltaPct = Math.abs((currNum - prevNum) / prevNum) * 100;
              setQuoteVolatilityPct(deltaPct);
            } else {
              setQuoteVolatilityPct(0);
            }
          } else {
            setQuoteVolatilityPct(0);
          }

          const routeImpact =
            selectedRoute.estimatedSlippage ??
            selectedRoute.priceImpact ??
            null;
          setPriceImpact(routeImpact);
          const resolvedAmountInWei = isExactOut
            ? selectedRoute.amountIn
            : amountWei;

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
                const checkErc20 = async (spender, label) => {
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
                      label,
                      kind: "erc20",
                    });
                  } else {
                    setCachedApproval({
                      symbol: sellToken,
                      address: sellAddress,
                      desiredAllowance: allowance,
                      spender,
                      label,
                      kind: "erc20",
                    });
                  }
                };
                const permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, readProvider);
                const checkPermit2 = async (spender, label) => {
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
                      label,
                      kind: "permit2",
                      expiration: permit2Expiration,
                    });
                  } else {
                    setCachedApproval({
                      symbol: sellToken,
                      address: sellAddress,
                      desiredAllowance: allowance,
                      spender,
                      label,
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
                  await checkErc20(PERMIT2_ADDRESS, "Token approval (Permit2)");
                  await checkPermit2(
                    UNIV3_UNIVERSAL_ROUTER_ADDRESS,
                    "Permit2 allowance (Universal Router)"
                  );
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
    amountOutInput,
    buyMeta?.address,
    buyMeta?.decimals,
    buyToken,
    buildV2Route,
    buildV2RouteCandidates,
    buildV3Route,
    buildV3RouteCandidates,
    quoteV2Route,
    quoteV2RouteExactOut,
    quoteV3Route,
    quoteV3RouteExactOut,
    isDirectEthWeth,
    isExactOut,
    isSupported,
    hasV2Support,
    hasV3Support,
    sellMeta?.address,
    sellMeta?.decimals,
    sellToken,
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
  const safePriceImpact = Number.isFinite(priceImpact) ? Math.max(priceImpact, 0) : 0;
  const safeVolatility = Number.isFinite(quoteVolatilityPct)
    ? Math.max(quoteVolatilityPct, 0)
    : 0;
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
  const activeRouteTokens = (
    displayRoute && displayRoute.length ? displayRoute : [displaySellSymbol, displayBuySymbol]
  ).map((label) => resolveRouteToken(label));
  const isQuoteLocked = quoteLockedUntil && quoteLockedUntil > Date.now();
  const quoteSourceLabel = (() => {
    if (quoteError) return quoteError;
    if (!activeInputAmount) {
      return isExactOut
        ? "Enter a target output to fetch a quote"
        : "Enter an amount to fetch a quote";
    }
    if (isDirectEthWeth) return "Direct wrap/unwrap (no fee)";
    if (quoteMeta?.protocol === "V2") return "Live quote via CurrentX API (V2)";
    if (quoteMeta?.protocol === "SPLIT") return "Smart split via CurrentX API (V2 + V3)";
    if (quoteMeta?.protocol === "V3") return "Live quote via CurrentX API (V3)";
    return lastQuoteSourceRef.current || "Live quote via CurrentX API...";
  })();
  const routeProtocolLabel = isDirectEthWeth
    ? "Wrap/Unwrap"
    : quoteMeta?.protocol === "SPLIT"
      ? "V2 + V3"
      : quoteMeta?.protocol || "V3";
  const hopCount = routeSegments.reduce((sum, seg) => sum + (seg.hops?.length || 0), 0);
  const approvalSummary = approvalTargetsForSell.length
    ? approvalTargetsForSell.map((t) => t.label || "Approval").join(" + ")
    : "";

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
      lastQuoteSourceRef.current = "Smart split via CurrentX API (V2 + V3)";
      return;
    }
    if (quoteMeta?.protocol === "V3") {
      lastQuoteSourceRef.current = "Live quote via CurrentX API (V3)";
    }
  }, [quoteMeta?.protocol, isDirectEthWeth]);

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
    pendingTxHashRef.current = null;
  }, []);

  const handleApprove = async () => {
    if (!approvalTargets.length) return;
    const pending = approvalTargets.filter((t) => t.symbol === sellToken);
    if (!pending.length) return;
    if (!isChainMatch) {
      setSwapStatus({
        variant: "error",
        message: "Switch wallet to the selected network before approving.",
      });
      return;
    }
    let provider;
    try {
      setApproveLoading(true);
      setSwapStatus(null);
      provider = await getProvider();
      const signer = await provider.getSigner();
      const ordered = [...pending].sort((a, b) => {
        const aScore = a.kind === "erc20" ? 0 : 1;
        const bScore = b.kind === "erc20" ? 0 : 1;
        return aScore - bScore;
      });
      for (let i = 0; i < ordered.length; i += 1) {
        const target = ordered[i];
        const stepLabel =
          ordered.length > 1 ? ` (${i + 1}/${ordered.length})` : "";
        setSwapStatus({
          variant: "pending",
          message: `Approving ${target.label || target.symbol}${stepLabel}...`,
        });
        let tx;
        if (target.kind === "permit2") {
          const permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, signer);
          const spender = target.spender || UNIV3_UNIVERSAL_ROUTER_ADDRESS;
          const expiration =
            typeof target.expiration === "bigint" ? target.expiration : MAX_UINT48;
          tx = await permit2.approve(
            target.address,
            spender,
            target.desiredAllowance,
            expiration
          );
        } else {
          const token = new Contract(target.address, ERC20_ABI, signer);
          const spender = target.spender || PERMIT2_ADDRESS;
          tx = await token.approve(spender, target.desiredAllowance);
        }
        const receipt = await tx.wait();
        if (receipt?.status === 0 || receipt?.status === 0n) {
          throw new Error("Approval failed");
        }
        setCachedApproval(target);
      }
      setApprovalTargets((prev) => prev.filter((t) => t.symbol !== sellToken));
      setSwapStatus({
        variant: "success",
        message: `Approval updated for ${sellToken}.`,
      });
      setLiveRouteTick((t) => t + 1);
    } catch (e) {
      const txHash = extractTxHash(e);
      if (txHash) {
        const receipt = await tryFetchReceipt(txHash, provider);
        const status = receipt?.status;
        const normalized = typeof status === "bigint" ? Number(status) : status;
        const symbol = approvalTarget?.symbol || sellToken || "token";
        if (normalized === 1) {
          setApprovalTargets((prev) => prev.filter((t) => t.symbol !== sellToken));
          setSwapStatus({
            variant: "success",
            hash: txHash,
            message: `Approval confirmed for ${symbol}.`,
          });
          return;
        }
        if (normalized === 0) {
          setSwapStatus({
            variant: "error",
            hash: txHash,
            message: friendlySwapError(e) || "Approve failed",
          });
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
      setSwapStatus({
        variant: "error",
        message: userRejected
          ? "Approval was rejected in wallet."
          : friendlySwapError(e) || "Approve failed",
      });
    } finally {
      setApproveLoading(false);
    }
  };

  const handleSwap = async () => {
    let provider;
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
      if (routeProtocol === "SPLIT" && (!hasV2Support || !hasV3Support)) {
        throw new Error("Split routing requires both V2 and V3 routers.");
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
      const amountWei = parseUnits(amountIn, sellDecimals);

      if (sellToken !== "ETH" && !isDirectEthWeth) {
        const token = new Contract(sellAddress, ERC20_ABI, signer);
        const checkErc20Allowance = async (spender, label) => {
          const allowance = await token.allowance(user, spender);
          if (allowance < amountWei) {
            throw new Error(
              `Approval required for ${sellToken}. Please approve ${label} before swapping.`
            );
          }
        };
        const permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, signer);
        const checkPermit2Allowance = async (spender, label) => {
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
          if (allowance < amountWei || expired) {
            throw new Error(
              `Approval required for ${sellToken}. Please approve ${label} before swapping.`
            );
          }
        };
        if (routeProtocol === "V2" || routeProtocol === "V3" || routeProtocol === "SPLIT") {
          await checkErc20Allowance(PERMIT2_ADDRESS, "Token approval (Permit2)");
          await checkPermit2Allowance(
            UNIV3_UNIVERSAL_ROUTER_ADDRESS,
            "Permit2 allowance (Universal Router)"
          );
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
        setQuoteVolatilityPct(deltaPct);

        if (deltaPct > reQuoteThreshold) {
          const refreshedRoute = { ...candidateRoute, protocol: "V3", amountOut: freshOut };
          setQuoteOut(formatUnits(freshOut, decimalsOut));
          setQuoteOutRaw(freshOut);
          setQuoteRoute(refreshedRoute?.path || []);
          setQuotePairs([]);
          setQuoteMeta(refreshedRoute);
          setLastQuoteAt(Date.now());
          setPriceImpact(null);
          setQuoteVolatilityPct(deltaPct);
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
        setQuoteVolatilityPct(deltaPct);

        if (deltaPct > reQuoteThreshold) {
          const refreshedRoute = guardedRouteMeta;
          setQuoteOut(formatUnits(freshOut, decimalsOut));
          setQuoteOutRaw(freshOut);
          setQuoteRoute(refreshedRoute?.path || []);
          setQuotePairs(refreshedRoute?.pairs || []);
          setQuoteMeta(refreshedRoute);
          setLastQuoteAt(Date.now());
          setPriceImpact(null);
          setQuoteVolatilityPct(deltaPct);
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
        setQuoteVolatilityPct(deltaPct);

        if (deltaPct > reQuoteThreshold) {
          const refreshedRoute = guardedRouteMeta;
          setQuoteOut(formatUnits(freshTotal, decimalsOut));
          setQuoteOutRaw(freshTotal);
          setQuoteMeta(refreshedRoute);
          setLastQuoteAt(Date.now());
          setPriceImpact(null);
          setQuoteVolatilityPct(deltaPct);
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
          )} ${buyToken}`,
          hash: receipt.hash,
          variant: "success",
        });
        await refreshBalances();
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
          )} ${buyToken}`,
          hash: receipt.hash,
          variant: "success",
        });
        await refreshBalances();
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
          )} ${buyToken}`,
          hash: receipt.hash,
          variant: "success",
        });
        await refreshBalances();
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
        )} ${buyToken}`,
        hash: receipt.hash,
        variant: "success",
      });
      await refreshBalances();
    } catch (e) {
      const txHash = extractTxHash(e) || pendingTxHashRef.current;
      if (txHash) {
        const receipt = await tryFetchReceipt(txHash, provider);
        const status = receipt?.status;
        const normalized = typeof status === "bigint" ? Number(status) : status;
        if (normalized === 1) {
          setSwapStatus({
            variant: "success",
            hash: txHash,
            message: "Swap confirmed. Check the explorer for details.",
          });
          await refreshBalances();
          return;
        }
        if (normalized === 0) {
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
        <div className="mb-4 rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="flex items-center justify-between mb-2 text-xs text-slate-400">
            <span>Sell</span>
            <span className="font-medium text-slate-300">
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
              className="px-3 py-2 rounded-xl bg-slate-800 text-xs text-slate-100 border border-slate-700 flex items-center gap-2 shadow-inner shadow-black/30 min-w-0 w-full sm:w-auto sm:min-w-[140px] hover:border-sky-500/60 transition"
            >
              <TokenLogo
                token={displaySellMeta}
                fallbackSymbol={sellToken}
                imgClassName="h-6 w-6 rounded-full object-contain"
                placeholderClassName="h-6 w-6 rounded-full bg-slate-700 text-[10px] font-semibold flex items-center justify-center text-white"
              />
              <div className="flex flex-col items-start">
                <span className="text-sm font-semibold">
                  {displaySellSymbol}
                </span>
                <span className="text-[10px] text-slate-400">
                  {displaySellAddress ? shortenAddress(displaySellAddress) : "Native"}
                </span>
              </div>
              <svg
                className="ml-auto h-3.5 w-3.5 text-slate-400"
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
              onChange={(e) => {
                setAmountIn(e.target.value);
                if (swapInputMode !== "in") {
                  setSwapInputMode("in");
                }
                if (quoteError) setQuoteError("");
                if (swapStatus) setSwapStatus(null);
              }}
              placeholder="0.00"
              className={`flex-1 text-right bg-transparent font-semibold text-slate-50 outline-none placeholder:text-slate-700 w-full ${amountTextClass(amountIn, "text-2xl")}`}
            />
          </div>
          <div className="flex justify-end gap-2 mt-3 text-[11px] sm:text-xs">
            {[0.25, 0.5, 0.75, 1].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleQuickPercent(p)}
                className="px-2 py-1 rounded-lg border border-slate-700 bg-slate-800/60 text-slate-200 hover:border-sky-500/60 transition"
              >
                {Math.round(p * 100)}%
              </button>
            ))}
            <div className="px-2 py-1 text-slate-400">
              {formatBalance(sellBalance)} {displaySellSymbol} available
            </div>
          </div>
        </div>

        <div className="flex justify-center my-2">
          <div className="relative group">
            <div className="absolute inset-0 blur-lg bg-gradient-to-r from-sky-500/30 via-indigo-500/30 to-purple-600/30 opacity-0 group-hover:opacity-70 transition duration-500" />
            <button
              onClick={() => {
                setSwapPulse(true);
                setSellToken(buyToken);
                setBuyToken(sellToken);
                setTimeout(() => setSwapPulse(false), 320);
              }}
              className="relative h-11 w-11 rounded-full border border-slate-700 bg-slate-900 flex items-center justify-center text-slate-200 text-lg shadow-md shadow-black/40 hover:border-sky-500/60 transition-transform duration-300 hover:rotate-6 active:scale-95"
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
                className="h-5 w-5 text-slate-100 transition duration-300 ease-out"
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

        <div className="mb-4 rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="flex items-center justify-between mb-2 text-xs text-slate-400">
            <span>Buy</span>
            <span className="font-medium text-slate-300">
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
              className="px-3 py-2 rounded-xl bg-slate-800 text-xs text-slate-100 border border-slate-700 flex items-center gap-2 shadow-inner shadow-black/30 min-w-0 w-full sm:w-auto sm:min-w-[140px] hover:border-sky-500/60 transition"
            >
              <TokenLogo
                token={displayBuyMeta}
                fallbackSymbol={buyToken}
                imgClassName="h-6 w-6 rounded-full object-contain"
                placeholderClassName="h-6 w-6 rounded-full bg-slate-700 text-[10px] font-semibold flex items-center justify-center text-white"
              />
              <div className="flex flex-col items-start">
                <span className="text-sm font-semibold">
                  {displayBuySymbol}
                </span>
                <span className="text-[10px] text-slate-400">
                  {displayBuyAddress ? shortenAddress(displayBuyAddress) : "Native"}
                </span>
              </div>
              <svg
                className="ml-auto h-3.5 w-3.5 text-slate-400"
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
                value={isExactOut ? amountOutInput : quoteOut || ""}
                onChange={(e) => {
                  setAmountOutInput(e.target.value);
                  if (swapInputMode !== "out") {
                    setSwapInputMode("out");
                  }
                  if (quoteError) setQuoteError("");
                  if (swapStatus) setSwapStatus(null);
                }}
                onFocus={() => {
                  if (!isExactOut) {
                    setSwapInputMode("out");
                    if (!amountOutInput && quoteOut) {
                      setAmountOutInput(quoteOut);
                    }
                  }
                }}
                placeholder="0.00"
                className={`w-full text-right bg-transparent font-semibold text-slate-50 outline-none placeholder:text-slate-700 ${amountTextClass(
                  isExactOut ? amountOutInput : quoteOut,
                  "text-2xl sm:text-3xl"
                )}`}
              />
              <div className="text-[11px] text-slate-500">
                {quoteSourceLabel}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-3 rounded-2xl bg-slate-900/70 border border-slate-800 p-4 shadow-[0_14px_40px_-24px_rgba(56,189,248,0.6)]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-slate-100">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm font-semibold">Route</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="px-2 py-0.5 rounded-full bg-slate-900/70 border border-slate-700 text-slate-200">
                {routeProtocolLabel}
              </span>
              {routeModeLabel && (
                <span className="px-2 py-0.5 rounded-full bg-slate-900/70 border border-slate-700 text-slate-200">
                  {routeModeLabel}
                </span>
              )}
              {hopCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-slate-900/70 border border-slate-700 text-slate-200">
                  {hopCount} hop{hopCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          <div className="mt-2 relative group">
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
            <div
              className="absolute left-0 top-full mt-2 w-full max-w-[420px] rounded-2xl border border-slate-800 bg-slate-950/95 p-3 shadow-2xl shadow-black/50 opacity-0 translate-y-1 pointer-events-none transition duration-200 group-hover:opacity-100 group-hover:translate-y-0 z-20"
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
            </div>
          </div>

          {quoteMeta?.protocol === "SPLIT" ? (
            <div className="mt-2 text-[11px] text-amber-200">
              Split routing (single transaction).
            </div>
          ) : null}

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12px] text-slate-100">
            <div className="flex flex-col gap-1">
              <span className="text-slate-500 text-[11px]">Expected</span>
              <span className="font-semibold">
                {quoteOut !== null ? formatDisplayAmount(quoteOut, displayBuySymbol) : "--"}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-slate-500 text-[11px]">Min received</span>
              <span className="font-semibold">{minReceivedDisplay}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-slate-500 text-[11px]">Price impact</span>
              <span className="font-semibold">
                {priceImpact !== null ? `${priceImpact.toFixed(2)}%` : "--"}
              </span>
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

        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <div className="flex-1 rounded-2xl bg-slate-900 border border-slate-800 p-3 text-xs text-slate-300">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400">Slippage (%)</span>
              <div className="flex items-center gap-2">
                {[0.1, 0.5, 1].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setSlippage(String(p))}
                    className={`px-2 py-1 rounded-lg text-[11px] border ${
                      Number(slippage) === p
                        ? "bg-sky-500/20 border-sky-500/50 text-sky-100"
                        : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {p}%
                  </button>
                ))}
                <input
                  name="swap-slippage"
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  className="w-20 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-right text-slate-100 text-sm"
                />
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
                      {approvalSummary ? ` (${approvalSummary})` : ""}
                    </span>
                  ) : (
                    <span className="text-slate-400">
                      No approval required for the current selection.
                    </span>
                  )}
                </div>
              </div>
            ) : null}
            {!isDirectEthWeth &&
            approveNeeded &&
            approvalTarget?.symbol === sellToken &&
            sellToken !== "ETH" ? (
              <button
                onClick={handleApprove}
                disabled={approveLoading || quoteLoading}
                className="w-full py-3 rounded-2xl bg-slate-800 border border-slate-700 text-sm font-semibold text-white hover:border-sky-500/60 transition disabled:opacity-60"
              >
                {approveLoading ? "Approving..." : approvalButtonLabel}
              </button>
            ) : null}
            <button
              onClick={handleSwap}
              disabled={
                swapLoading ||
                quoteLoading ||
                (!isDirectEthWeth && approveNeeded && sellToken !== "ETH")
              }
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-sky-500 via-indigo-500 to-purple-600 text-sm font-semibold text-white shadow-[0_10px_40px_-15px_rgba(56,189,248,0.75)] hover:scale-[1.01] active:scale-[0.99] transition disabled:opacity-60 disabled:scale-100"
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
                <div className="text-sm font-semibold text-slate-100">Select token</div>
              </div>
              <button
                onClick={closeSelector}
                className="h-9 w-9 rounded-full bg-slate-900 text-slate-200 flex items-center justify-center border border-slate-800 hover:border-slate-600"
                aria-label="Close token select"
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
                  onChange={(e) => setTokenSearch(e.target.value)}
                  placeholder="Search name or paste token address"
                  className="bg-transparent outline-none flex-1 text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </div>

            <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-800">
              {filteredTokens.map((t) => {
                const displayAddress = t.address || "";
                const displaySym = displaySymbol(t, t.symbol);
                return (
                  <button
                    key={`${selectorOpen}-${t.symbol}`}
                    type="button"
                    onClick={() => handleSelectToken(t.symbol)}
                    className="w-full px-4 py-3 flex items-center gap-3 bg-slate-950/50 hover:bg-slate-900/70 transition text-left"
                  >
                    <TokenLogo
                      token={t}
                      fallbackSymbol={t.symbol}
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
                      <div>{formatBalance(effectiveBalances[t.symbol])}</div>
                    </div>
                  </button>
                );
              })}
              {!filteredTokens.length && (
                <div className="px-4 py-6 text-center text-sm text-slate-400">
                  No tokens found.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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

