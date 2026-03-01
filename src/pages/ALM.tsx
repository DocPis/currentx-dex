import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  parseUnits,
  formatUnits,
  getAddress,
  id,
  toUtf8String,
} from "ethers";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleHelp,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { EXPLORER_BASE_URL } from "../shared/config/addresses";
import { getProvider } from "../shared/config/web3";
import { TOKENS } from "../shared/config/tokens";
import StrategyWizard from "../features/alm/wizard/StrategyWizard";
import type { WizardSubmitPayload } from "../features/alm/wizard/strategyWizardSchema";
import {
  ALM_ADDRESSES,
  ALM_CHAIN_ID,
  ALM_EVENT_FROM_BLOCK,
  ALM_RPC_URL,
} from "../shared/config/almConfig";
import {
  ALM_ABI,
  ERC20_METADATA_ABI,
  NFPM_ABI,
  POOL_SLOT0_ABI,
  STRATEGY_REGISTRY_ABI,
  V3_FACTORY_MIN_ABI,
} from "../shared/config/almAbis";

type StatusState = "idle" | "pending" | "success" | "error";
type ToastTone = "success" | "error" | "info";
type DepositWizardStep = 1 | 2 | 3;
type MainView = "deposit" | "positions" | "logs" | "advanced";

interface ALMPageProps {
  address?: string | null;
  chainId?: string | null;
  onConnect?: () => void;
}

interface ToastState {
  id: number;
  tone: ToastTone;
  text: string;
}

interface TokenMeta {
  address: string;
  symbol: string;
  decimals: number;
}

interface StrategyConfig {
  id: number;
  poolClass: number;
  type: "VOLATILE" | "STABLE";
  widthBps: number;
  recenterBps: number;
  minRebalanceInterval: number;
  maxSwapSlippageBps: number;
  mintSlippageBps: number;
  allowSwap: boolean;
  feeTierBitmap: bigint;
  allowedFeeTiers: number[];
  route: "DIRECT_ONLY" | "DIRECT_OR_WETH";
  minCardinality: number;
  oracleParamsHex: string;
  wethHopFee: number;
  targetRatioBps0: number;
  minCompoundValueToken1: bigint;
  ratioDeadbandBps: number;
  minSwapValueToken1: bigint;
  recommendedLabel: string;
}

interface NftLookupItem {
  tokenId: string;
  owner: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  pool: string;
  currentTick: number | null;
  observationCardinality: number | null;
  approvedToAlm: boolean;
}

interface AlmPositionRow {
  positionId: string;
  owner: string;
  strategyId: number;
  pool: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  fee: number;
  tickSpacing: number;
  currentTokenId: string;
  currentTick: number | null;
  centerTick: number | null;
  lastRebalanceAt: number;
  active: boolean;
  dust0: bigint;
  dust1: bigint;
  sqrtPriceX96: bigint | null;
  dustValueToken1: bigint;
}

interface ActivityItem {
  id: string;
  blockNumber: number;
  timestamp: number | null;
  txHash: string;
  eventType: string;
  positionId: string;
  details: string;
}

const LazyMyPositions = lazy(() => import("../features/alm/components/AlmPositionsPanel"));
const LazyActivityLog = lazy(() => import("../features/alm/components/AlmActivityPanel"));

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const FEE_TIERS = [100, 500, 3000, 10000];
const MAX_USER_POSITIONS_SCAN = 64;
const MAX_ACTIVITY_ITEMS = 80;
const Q192 = 1n << 192n;
const EVENT_TYPES_TO_RENDER = new Set([
  "Deposited",
  "Rotated",
  "Withdrawn",
  "DustUpdated",
  "RebalanceSkipped",
  "SwapToTarget",
]);
const abiCoder = AbiCoder.defaultAbiCoder();
const almEventsInterface = new Interface(ALM_ABI as any);

const KNOWN_REASON_SELECTORS: Record<string, string> = {
  [id("BadPoolClass()").slice(0, 10).toLowerCase()]: "Invalid pool class",
  [id("CardinalityTooLow()").slice(0, 10).toLowerCase()]: "Observation cardinality too low",
  [id("Cooldown()").slice(0, 10).toLowerCase()]: "Cooldown not finished",
  [id("EmergencyEnabled()").slice(0, 10).toLowerCase()]: "Emergency mode enabled",
  [id("FeeDisabled()").slice(0, 10).toLowerCase()]: "Fee disabled",
  [id("FeeNotAllowed()").slice(0, 10).toLowerCase()]: "Fee tier not allowed",
  [id("NotEnoughObservations()").slice(0, 10).toLowerCase()]: "Not enough observations",
  [id("PriceManipulationDetected()").slice(0, 10).toLowerCase()]: "Price manipulation detected",
  [id("NotKeeper()").slice(0, 10).toLowerCase()]: "Only keeper can execute",
  [id("NotOwner()").slice(0, 10).toLowerCase()]: "Only owner can execute",
  [id("NotPositionOwner()").slice(0, 10).toLowerCase()]: "Wallet does not own this position",
  [id("PoolNotFound()").slice(0, 10).toLowerCase()]: "Pool not found",
  [id("SwapPoolNotFound()").slice(0, 10).toLowerCase()]: "Swap pool not found",
  [id("RouterNotAllowed()").slice(0, 10).toLowerCase()]: "Router not allowed",
  [id("RouterFactoryMismatch()").slice(0, 10).toLowerCase()]: "Router/factory mismatch",
  [id("FactoryNotSet()").slice(0, 10).toLowerCase()]: "Factory not set",
  [id("QuoterNotSet()").slice(0, 10).toLowerCase()]: "Quoter not set",
  [id("BadMaxSwapInBps()").slice(0, 10).toLowerCase()]: "Invalid maxSwapInBps",
  [id("PositionInactive()").slice(0, 10).toLowerCase()]: "Position inactive",
};

const normalizeAddress = (value: string) => {
  try {
    return getAddress(String(value || ""));
  } catch {
    return String(value || "");
  }
};

const isZeroAddress = (value: string) =>
  normalizeAddress(value).toLowerCase() === ZERO_ADDRESS.toLowerCase();

const shortenAddress = (value: string, start = 6, end = 4) => {
  if (!value) return "--";
  if (value.length <= start + end) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
};

const formatPercentFromBps = (bps: number, digits = 2) =>
  `${(bps / 100).toFixed(digits).replace(/\.?0+$/u, "")}%`;

const formatFeeTier = (feeTier: number) => `${(feeTier / 10_000).toFixed(2)}%`;

const formatDateTime = (timestampSec: number | null) => {
  if (!timestampSec || !Number.isFinite(timestampSec)) return "--";
  return new Date(timestampSec * 1000).toLocaleString();
};

const formatRelativeTimeFromNow = (timestampSec: number | null) => {
  if (!timestampSec || !Number.isFinite(timestampSec)) return "--";
  const now = Math.floor(Date.now() / 1000);
  const delta = now - timestampSec;
  if (!Number.isFinite(delta)) return "--";
  if (delta <= 0) return "just now";
  if (delta < 60) return `${delta}s ago`;
  const minutes = Math.floor(delta / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const formatBigInt = (value: bigint) => {
  try {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return value.toString();
  }
};

const formatTokenAmount = (amount: bigint, decimals: number, maxFrac = 6) => {
  try {
    const value = formatUnits(amount, decimals);
    const num = Number(value);
    if (!Number.isFinite(num)) return value;
    if (num === 0) return "0";
    if (num >= 1) return num.toFixed(Math.min(maxFrac, 6)).replace(/\.?0+$/u, "");
    return num.toFixed(Math.min(maxFrac + 2, 8)).replace(/\.?0+$/u, "");
  } catch {
    return amount.toString();
  }
};

const parseTokenUnitsSafe = (value: string, decimals: number): bigint | null => {
  const normalized = String(value || "").trim().replace(",", ".");
  if (!normalized) return null;
  try {
    return BigInt(parseUnits(normalized, decimals));
  } catch {
    return null;
  }
};

const computeValue0In1FromSqrtPriceX96 = (amount0: bigint, sqrtPriceX96: bigint | null) => {
  if (!sqrtPriceX96 || sqrtPriceX96 <= 0n || amount0 <= 0n) return 0n;
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  return (amount0 * priceX192) / Q192;
};

const parseChainId = (value: string | null | undefined) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    const parsedHex = Number.parseInt(raw, 16);
    return Number.isFinite(parsedHex) ? parsedHex : null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const decodeFeeTiers = (bitmap: bigint) =>
  FEE_TIERS.filter((_, index) => (bitmap & (1n << BigInt(index))) !== 0n);

const bytesToHex = (value: unknown) => {
  if (!value) return "0x";
  if (typeof value === "string") return value;
  try {
    const bytes = Array.from(value as ArrayLike<number>);
    return `0x${bytes.map((byte) => Number(byte).toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return "0x";
  }
};

const decodeUtf8Reason = (reasonHex: string) => {
  try {
    const decoded = toUtf8String(reasonHex).replace(/\u0000+$/gu, "").trim();
    if (!decoded) return "";
    if (!/^[\x20-\x7E]+$/u.test(decoded)) return "";
    return decoded;
  } catch {
    return "";
  }
};

const decodeRebalanceReason = (rawReason: string) => {
  const reasonHex = String(rawReason || "0x").toLowerCase();
  if (reasonHex === "0x") return "No details available";
  if (reasonHex.length === 10 && KNOWN_REASON_SELECTORS[reasonHex]) {
    return KNOWN_REASON_SELECTORS[reasonHex];
  }
  if (reasonHex.startsWith("0x08c379a0")) {
    try {
      const decoded = abiCoder.decode(["string"], `0x${reasonHex.slice(10)}`);
      const msg = String(decoded?.[0] || "").trim();
      if (msg) return msg;
    } catch {
      // ignore decode failures
    }
  }
  if (reasonHex.startsWith("0x4e487b71")) {
    return "Panic error";
  }
  if (KNOWN_REASON_SELECTORS[reasonHex.slice(0, 10)]) {
    return KNOWN_REASON_SELECTORS[reasonHex.slice(0, 10)];
  }
  const utf8Reason = decodeUtf8Reason(reasonHex);
  if (utf8Reason) return utf8Reason;
  return reasonHex;
};

const getReadableErrorMessage = (error: any, fallback: string) => {
  const detail = String(error?.shortMessage || error?.reason || error?.message || "").trim();
  if (!detail) return fallback;
  if (/user rejected|rejected the request|denied transaction|ACTION_REJECTED/iu.test(detail)) {
    return "Action cancelled in wallet.";
  }
  return `${fallback} Details: ${detail}`;
};

const getStatusVisual = (status: StatusState) => {
  if (status === "success") {
    return {
      label: "Done",
      icon: CheckCircle2,
      className: "border-emerald-400/45 bg-emerald-500/10 text-emerald-100",
    };
  }
  if (status === "pending") {
    return {
      label: "Pending",
      icon: Loader2,
      className: "border-sky-400/45 bg-sky-500/10 text-sky-100",
    };
  }
  if (status === "error") {
    return {
      label: "Error",
      icon: AlertTriangle,
      className: "border-rose-400/45 bg-rose-500/10 text-rose-100",
    };
  }
  return {
    label: "Idle",
    icon: Circle,
    className: "border-slate-700/70 bg-slate-900/60 text-slate-200",
  };
};

function InfoHint({ title }: { title: string }) {
  return (
    <span className="group relative inline-flex items-center">
      <CircleHelp className="h-3.5 w-3.5 text-slate-400" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200 group-hover:block">
        {title}
      </span>
    </span>
  );
}

const parseStrategyStruct = (strategyId: number, strategyRaw: any): StrategyConfig | null => {
  const poolClass = Number(strategyRaw?.poolClass ?? strategyRaw?.[0] ?? 0);
  const widthBps = Number(strategyRaw?.widthBps ?? strategyRaw?.[1] ?? 0);
  const recenterBps = Number(strategyRaw?.recenterBps ?? strategyRaw?.[2] ?? 0);
  const minRebalanceInterval = Number(strategyRaw?.minRebalanceInterval ?? strategyRaw?.[3] ?? 0);
  const maxSwapSlippageBps = Number(strategyRaw?.maxSwapSlippageBps ?? strategyRaw?.[4] ?? 0);
  const mintSlippageBps = Number(strategyRaw?.mintSlippageBps ?? strategyRaw?.[5] ?? 0);
  const allowSwap = Boolean(strategyRaw?.allowSwap ?? strategyRaw?.[6] ?? false);
  const routeRaw = Number(strategyRaw?.route ?? strategyRaw?.[7] ?? 0);
  const minCardinality = Number(strategyRaw?.minCardinality ?? strategyRaw?.[8] ?? 0);
  const allowedFeeBitmap = BigInt(strategyRaw?.allowedFeeBitmap ?? strategyRaw?.[10] ?? 0n);
  const oracleParamsRaw = strategyRaw?.oracleParams ?? strategyRaw?.[11] ?? "0x";
  const oracleParamsHex = bytesToHex(oracleParamsRaw);
  const wethHopFee = Number(strategyRaw?.wethHopFee ?? strategyRaw?.[12] ?? 0);
  const targetRatioBps0 = Number(strategyRaw?.targetRatioBps0 ?? strategyRaw?.[13] ?? 0);
  const minCompoundValueToken1 = BigInt(strategyRaw?.minCompoundValueToken1 ?? strategyRaw?.[14] ?? 0n);
  const ratioDeadbandBps = Number(strategyRaw?.ratioDeadbandBps ?? strategyRaw?.[15] ?? 0);
  const minSwapValueToken1 = BigInt(strategyRaw?.minSwapValueToken1 ?? strategyRaw?.[16] ?? 0n);

  const looksEmpty =
    poolClass === 0 &&
    widthBps === 0 &&
    recenterBps === 0 &&
    minRebalanceInterval === 0 &&
    maxSwapSlippageBps === 0 &&
    mintSlippageBps === 0 &&
    !allowSwap &&
    routeRaw === 0 &&
    minCardinality === 0 &&
    allowedFeeBitmap === 0n &&
    targetRatioBps0 === 0 &&
    minCompoundValueToken1 === 0n &&
    ratioDeadbandBps === 0 &&
    minSwapValueToken1 === 0n &&
    (oracleParamsHex === "0x" || oracleParamsHex === "");

  if (looksEmpty) return null;

  const allowedFeeTiers = decodeFeeTiers(allowedFeeBitmap);
  const primaryFeeTier = allowedFeeTiers[0] || 500;

  return {
    id: strategyId,
    poolClass,
    type: poolClass === 1 ? "STABLE" : "VOLATILE",
    widthBps,
    recenterBps,
    minRebalanceInterval,
    maxSwapSlippageBps,
    mintSlippageBps,
    allowSwap,
    feeTierBitmap: allowedFeeBitmap,
    allowedFeeTiers,
    route: routeRaw === 0 ? "DIRECT_ONLY" : "DIRECT_OR_WETH",
    minCardinality,
    oracleParamsHex: oracleParamsHex || "0x",
    wethHopFee,
    targetRatioBps0: Math.max(0, Math.min(10_000, targetRatioBps0 || 0)),
    minCompoundValueToken1,
    ratioDeadbandBps,
    minSwapValueToken1,
    recommendedLabel: `+/-${formatPercentFromBps(widthBps, 1)} range, rebalance at +/-${formatPercentFromBps(
      recenterBps,
      1
    )}, fee ${formatFeeTier(primaryFeeTier)}`,
  };
};

const defaultTokenMeta = (address: string): TokenMeta => ({
  address,
  symbol: shortenAddress(address, 6, 4),
  decimals: 18,
});

const formatDust = (amount: bigint, decimals: number) => {
  try {
    const value = formatUnits(amount, decimals);
    const num = Number(value);
    if (!Number.isFinite(num)) return value;
    if (num === 0) return "0";
    if (num >= 1) return num.toFixed(6).replace(/\.?0+$/u, "");
    return num.toFixed(8).replace(/\.?0+$/u, "");
  } catch {
    return amount.toString();
  }
};

export default function ALM({ address, chainId, onConnect }: ALMPageProps) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [strategies, setStrategies] = useState<StrategyConfig[]>([]);
  const [strategiesLoading, setStrategiesLoading] = useState(false);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [keeper, setKeeper] = useState("");
  const [treasury, setTreasury] = useState("");
  const [almOwner, setAlmOwner] = useState("");
  const [maxSwapInBpsCurrent, setMaxSwapInBpsCurrent] = useState<number | null>(null);
  const [registryAddress, setRegistryAddress] = useState(ALM_ADDRESSES.STRATEGY_REGISTRY);
  const [registryOwner, setRegistryOwner] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [emergencyDelay, setEmergencyDelay] = useState(0);
  const [strategyRouterDefaults, setStrategyRouterDefaults] = useState<{
    routerAddress: string;
    quoterAddress: string;
    factoryAddress: string;
  } | null>(null);

  const [lookupTokenId, setLookupTokenId] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [nftItems, setNftItems] = useState<NftLookupItem[]>([]);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null);
  const [selectedToken1Stable, setSelectedToken1Stable] = useState<boolean | null>(null);
  const [feeAllowedOnChain, setFeeAllowedOnChain] = useState<boolean | null>(null);
  const [savingStrategy, setSavingStrategy] = useState(false);

  const [approveStatus, setApproveStatus] = useState<StatusState>("idle");
  const [approveTxHash, setApproveTxHash] = useState("");
  const [depositStatus, setDepositStatus] = useState<StatusState>("idle");
  const [depositTxHash, setDepositTxHash] = useState("");
  const [lastDepositSummary, setLastDepositSummary] = useState<{
    tokenId: string;
    strategyId: number;
    tokenPair: string;
    feeTier: string;
    liquidityUnits: string;
    timestampSec: number;
  } | null>(null);

  const [positions, setPositions] = useState<AlmPositionRow[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [withdrawingPositionId, setWithdrawingPositionId] = useState("");
  const [compoundingPositionId, setCompoundingPositionId] = useState("");

  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [activeView, setActiveView] = useState<MainView>("deposit");
  const [depositWizardStep, setDepositWizardStep] = useState<DepositWizardStep>(1);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  const toastTimerRef = useRef<number | null>(null);
  const tokenMetaCacheRef = useRef<Map<string, TokenMeta>>(new Map());
  const nftLookupCacheRef = useRef<Map<string, NftLookupItem>>(new Map());
  const copiedTimeoutRef = useRef<number | null>(null);
  const [copiedValue, setCopiedValue] = useState("");

  const readProvider = useMemo(
    () =>
      new JsonRpcProvider(ALM_RPC_URL, {
        chainId: ALM_CHAIN_ID,
        name: "MegaETH",
      }),
    []
  );

  const connectedChainId = useMemo(() => parseChainId(chainId), [chainId]);
  const wrongChain = Boolean(address && connectedChainId && connectedChainId !== ALM_CHAIN_ID);

  const strategyById = useMemo(() => {
    const map = new Map<number, StrategyConfig>();
    strategies.forEach((strategy) => map.set(strategy.id, strategy));
    return map;
  }, [strategies]);

  const selectedNft = useMemo(
    () => nftItems.find((item) => item.tokenId === selectedTokenId) || null,
    [nftItems, selectedTokenId]
  );
  const selectedStrategy = useMemo(
    () => (selectedStrategyId === null ? null : strategyById.get(selectedStrategyId) || null),
    [selectedStrategyId, strategyById]
  );
  const isKeeperWallet = useMemo(() => {
    if (!address || !keeper) return false;
    return normalizeAddress(address).toLowerCase() === normalizeAddress(keeper).toLowerCase();
  }, [address, keeper]);
  const isRegistryOwnerWallet = useMemo(() => {
    if (!address || !registryOwner) return false;
    return normalizeAddress(address).toLowerCase() === normalizeAddress(registryOwner).toLowerCase();
  }, [address, registryOwner]);
  const isAlmOwnerWallet = useMemo(() => {
    if (!address || !almOwner) return false;
    return normalizeAddress(address).toLowerCase() === normalizeAddress(almOwner).toLowerCase();
  }, [address, almOwner]);

  const knownTokensByAddress = useMemo(() => {
    const map = new Map<string, TokenMeta>();
    Object.values(TOKENS || {}).forEach((token: any) => {
      if (!token?.address) return;
      const normalized = normalizeAddress(token.address);
      map.set(normalized.toLowerCase(), {
        address: normalized,
        symbol: token.displaySymbol || token.symbol || shortenAddress(normalized),
        decimals: Number(token.decimals) || 18,
      });
    });
    return map;
  }, []);

  const showToast = useCallback((tone: ToastTone, text: string) => {
    const nextToast = { id: Date.now(), tone, text };
    setToast(nextToast);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast((current) => (current?.id === nextToast.id ? null : current));
      toastTimerRef.current = null;
    }, 4000);
  }, []);

  const copyValue = useCallback(
    async (value: string) => {
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        setCopiedValue(value);
        if (copiedTimeoutRef.current) {
          window.clearTimeout(copiedTimeoutRef.current);
        }
        copiedTimeoutRef.current = window.setTimeout(() => {
          setCopiedValue("");
          copiedTimeoutRef.current = null;
        }, 1200);
      } catch {
        showToast("error", "Unable to copy value to clipboard.");
      }
    },
    [showToast]
  );

  const resolveTokenMeta = useCallback(
    async (tokenAddress: string): Promise<TokenMeta> => {
      const normalized = normalizeAddress(tokenAddress);
      if (!normalized || isZeroAddress(normalized)) return defaultTokenMeta(tokenAddress);
      const cacheKey = normalized.toLowerCase();
      const cached = tokenMetaCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const known = knownTokensByAddress.get(cacheKey);
      if (known) {
        tokenMetaCacheRef.current.set(cacheKey, known);
        return known;
      }

      try {
        const erc20 = new Contract(normalized, ERC20_METADATA_ABI as any, readProvider);
        const [symbolRaw, decimalsRaw] = await Promise.all([
          erc20.symbol().catch(() => ""),
          erc20.decimals().catch(() => 18),
        ]);
        const nextMeta: TokenMeta = {
          address: normalized,
          symbol: String(symbolRaw || shortenAddress(normalized)).trim() || shortenAddress(normalized),
          decimals: Number(decimalsRaw) || 18,
        };
        tokenMetaCacheRef.current.set(cacheKey, nextMeta);
        return nextMeta;
      } catch {
        const fallback = defaultTokenMeta(normalized);
        tokenMetaCacheRef.current.set(cacheKey, fallback);
        return fallback;
      }
    },
    [knownTokensByAddress, readProvider]
  );

  const loadPoolTick = useCallback(
    async (poolAddress: string) => {
      const normalized = normalizeAddress(poolAddress);
      if (!normalized || isZeroAddress(normalized)) {
        return { currentTick: null, observationCardinality: null, sqrtPriceX96: null };
      }
      try {
        const pool = new Contract(normalized, POOL_SLOT0_ABI as any, readProvider);
        const slot0 = await pool.slot0();
        return {
          currentTick: Number(slot0.tick),
          observationCardinality: Number(slot0.observationCardinality),
          sqrtPriceX96: BigInt(slot0.sqrtPriceX96 || 0n),
        };
      } catch {
        return { currentTick: null, observationCardinality: null, sqrtPriceX96: null };
      }
    },
    [readProvider]
  );

  const fetchNftPosition = useCallback(
    async (tokenId: string) => {
      const nfpm = new Contract(ALM_ADDRESSES.NFPM, NFPM_ABI as any, readProvider);
      const tokenIdBig = BigInt(tokenId);
      const [ownerRaw, positionRaw] = await Promise.all([nfpm.ownerOf(tokenIdBig), nfpm.positions(tokenIdBig)]);
      const owner = normalizeAddress(String(ownerRaw || ""));

      const [token0Meta, token1Meta] = await Promise.all([
        resolveTokenMeta(positionRaw.token0),
        resolveTokenMeta(positionRaw.token1),
      ]);

      let poolAddress = ZERO_ADDRESS;
      try {
        const factoryAddress = normalizeAddress(String(await nfpm.factory()));
        if (factoryAddress && !isZeroAddress(factoryAddress)) {
          const factory = new Contract(factoryAddress, V3_FACTORY_MIN_ABI as any, readProvider);
          poolAddress = normalizeAddress(
            String(await factory.getPool(positionRaw.token0, positionRaw.token1, Number(positionRaw.fee)))
          );
        }
      } catch {
        poolAddress = ZERO_ADDRESS;
      }

      const { currentTick, observationCardinality } = await loadPoolTick(poolAddress);
      const approvedAddress = normalizeAddress(String(await nfpm.getApproved(tokenIdBig).catch(() => ZERO_ADDRESS)));
      const approvedForAll = await nfpm
        .isApprovedForAll(owner || ZERO_ADDRESS, ALM_ADDRESSES.ALM)
        .catch(() => false);

      return {
        tokenId,
        owner,
        token0: normalizeAddress(positionRaw.token0),
        token1: normalizeAddress(positionRaw.token1),
        token0Symbol: token0Meta.symbol,
        token1Symbol: token1Meta.symbol,
        token0Decimals: token0Meta.decimals,
        token1Decimals: token1Meta.decimals,
        fee: Number(positionRaw.fee),
        tickLower: Number(positionRaw.tickLower),
        tickUpper: Number(positionRaw.tickUpper),
        liquidity: BigInt(positionRaw.liquidity || 0n),
        pool: poolAddress,
        currentTick,
        observationCardinality,
        approvedToAlm:
          approvedAddress.toLowerCase() === normalizeAddress(ALM_ADDRESSES.ALM).toLowerCase() ||
          Boolean(approvedForAll),
      } as NftLookupItem;
    },
    [loadPoolTick, readProvider, resolveTokenMeta]
  );

  const loadStrategies = useCallback(async () => {
    setStrategiesLoading(true);
    try {
      const registryAddr = normalizeAddress(registryAddress || ALM_ADDRESSES.STRATEGY_REGISTRY);
      const registry = new Contract(registryAddr, STRATEGY_REGISTRY_ABI as any, readProvider);
      const [countRaw, ownerRaw] = await Promise.all([
        registry.strategiesCount(),
        registry.owner().catch(() => ZERO_ADDRESS),
      ]);
      setRegistryOwner(normalizeAddress(String(ownerRaw || ZERO_ADDRESS)));
      const count = Number(countRaw || 0n);
      const ids = Array.from({ length: count }, (_, index) => index + 1);

      const decoded = await Promise.all(
        ids.map(async (strategyId) => {
          const strategyRaw = await registry.getStrategy(BigInt(strategyId));
          return parseStrategyStruct(strategyId, strategyRaw);
        })
      );

      const nonEmpty = decoded.filter(Boolean) as StrategyConfig[];
      const sorted = nonEmpty.sort((a, b) => a.id - b.id);
      setStrategies(sorted);
      setSelectedStrategyId((current) => {
        if (current !== null && sorted.some((entry) => entry.id === current)) return current;
        return sorted.length ? sorted[0].id : null;
      });
    } catch (error: any) {
      showToast(
        "error",
        getReadableErrorMessage(
          error,
          "Unable to load strategies. Check your connection and try again."
        )
      );
    } finally {
      setStrategiesLoading(false);
    }
  }, [readProvider, registryAddress, showToast]);

  const loadGlobalInfo = useCallback(async () => {
    setGlobalLoading(true);
    try {
      const alm = new Contract(ALM_ADDRESSES.ALM, ALM_ABI as any, readProvider);
      const [keeperRaw, treasuryRaw, emergencyRaw, delayRaw, registryRaw, ownerRaw, maxSwapInRaw] = await Promise.all([
        alm.keeper(),
        alm.treasury(),
        alm.emergency(),
        alm.EMERGENCY_DELAY(),
        alm.registry().catch(() => ALM_ADDRESSES.STRATEGY_REGISTRY),
        alm.owner().catch(() => ZERO_ADDRESS),
        alm.maxSwapInBps().catch(() => null),
      ]);
      setKeeper(normalizeAddress(String(keeperRaw || "")));
      setTreasury(normalizeAddress(String(treasuryRaw || "")));
      setEmergency(Boolean(emergencyRaw));
      setEmergencyDelay(Number(delayRaw || 0n));
      setAlmOwner(normalizeAddress(String(ownerRaw || ZERO_ADDRESS)));
      setMaxSwapInBpsCurrent(maxSwapInRaw === null ? null : Number(maxSwapInRaw || 0n));
      const nextRegistry = normalizeAddress(String(registryRaw || ALM_ADDRESSES.STRATEGY_REGISTRY));
      if (nextRegistry && !isZeroAddress(nextRegistry)) {
        setRegistryAddress(nextRegistry);
      }
    } catch (error: any) {
      showToast(
        "error",
        getReadableErrorMessage(
          error,
          "Unable to load ALM metadata. Check network settings and try again."
        )
      );
    } finally {
      setGlobalLoading(false);
    }
  }, [readProvider, showToast]);
  const loadUserPositions = useCallback(async () => {
    if (!address) {
      setPositions([]);
      return;
    }
    setPositionsLoading(true);
    try {
      const alm = new Contract(ALM_ADDRESSES.ALM, ALM_ABI as any, readProvider);
      const nfpm = new Contract(ALM_ADDRESSES.NFPM, NFPM_ABI as any, readProvider);
      const user = normalizeAddress(address);

      const ids: string[] = [];
      for (let index = 0; index < MAX_USER_POSITIONS_SCAN; index += 1) {
        try {
          const idRaw = await alm.userPositions(user, BigInt(index));
          const positionId = BigInt(idRaw || 0n).toString();
          if (positionId === "0" && index > 0) break;
          if (positionId !== "0") ids.push(positionId);
        } catch {
          break;
        }
      }

      const uniqueIds = Array.from(new Set(ids));
      const rows = await Promise.all(
        uniqueIds.map(async (positionId) => {
          const tuple = await alm.positionsById(BigInt(positionId));
          const owner = normalizeAddress(String(tuple?.[0] || ZERO_ADDRESS));
          if (!owner || isZeroAddress(owner)) return null;

          const strategyId = Number(tuple?.[1] || 0n);
          const pool = normalizeAddress(String(tuple?.[2] || ZERO_ADDRESS));
          const token0 = normalizeAddress(String(tuple?.[3] || ZERO_ADDRESS));
          const token1 = normalizeAddress(String(tuple?.[4] || ZERO_ADDRESS));
          const fee = Number(tuple?.[5] || 0n);
          const tickSpacing = Number(tuple?.[6] || 0n);
          const currentTokenId = BigInt(tuple?.[7] || 0n).toString();
          const lastRebalanceAt = Number(tuple?.[8] || 0n);
          const active = Boolean(tuple?.[9]);

          const [dust0Raw, dust1Raw, token0Meta, token1Meta, poolTick] = await Promise.all([
            alm.dust0(BigInt(positionId)).catch(() => 0n),
            alm.dust1(BigInt(positionId)).catch(() => 0n),
            resolveTokenMeta(token0),
            resolveTokenMeta(token1),
            loadPoolTick(pool),
          ]);
          const dust0 = BigInt(dust0Raw || 0n);
          const dust1 = BigInt(dust1Raw || 0n);
          const dustValueToken1 = computeValue0In1FromSqrtPriceX96(dust0, poolTick.sqrtPriceX96) + dust1;

          let centerTick: number | null = null;
          if (currentTokenId !== "0") {
            try {
              const currentNft = await nfpm.positions(BigInt(currentTokenId));
              centerTick = Math.round((Number(currentNft.tickLower) + Number(currentNft.tickUpper)) / 2);
            } catch {
              centerTick = null;
            }
          }

          return {
            positionId,
            owner,
            strategyId,
            pool,
            token0,
            token1,
            token0Symbol: token0Meta.symbol,
            token1Symbol: token1Meta.symbol,
            token0Decimals: token0Meta.decimals,
            token1Decimals: token1Meta.decimals,
            fee,
            tickSpacing,
            currentTokenId,
            currentTick: poolTick.currentTick,
            centerTick,
            lastRebalanceAt,
            active,
            dust0,
            dust1,
            sqrtPriceX96: poolTick.sqrtPriceX96,
            dustValueToken1,
          } as AlmPositionRow;
        })
      );

      const filtered = rows.filter(Boolean) as AlmPositionRow[];
      filtered.sort((a, b) => (BigInt(a.positionId) < BigInt(b.positionId) ? 1 : -1));
      setPositions(filtered);
    } catch (error: any) {
      showToast(
        "error",
        getReadableErrorMessage(error, "Unable to load your ALM positions right now.")
      );
      setPositions([]);
    } finally {
      setPositionsLoading(false);
    }
  }, [address, loadPoolTick, readProvider, resolveTokenMeta, showToast]);

  const loadActivityLog = useCallback(async (mode: "initial" | "manual" | "poll" = "manual") => {
    const showLoading = mode !== "poll";
    if (showLoading) setActivityLoading(true);
    try {
      const alm = new Contract(ALM_ADDRESSES.ALM, ALM_ABI as any, readProvider);
      const latestBlock = await readProvider.getBlockNumber();
      const fromBlock = ALM_EVENT_FROM_BLOCK > 0 ? ALM_EVENT_FROM_BLOCK : 0;
      const logs = await readProvider.getLogs({
        address: ALM_ADDRESSES.ALM,
        fromBlock,
        toBlock: latestBlock,
      });

      const parsedLogs = logs
        .map((log) => {
          try {
            const parsed = almEventsInterface.parseLog({ topics: log.topics, data: log.data });
            const eventType = parsed?.name || "Unknown";
            if (!EVENT_TYPES_TO_RENDER.has(eventType)) return null;
            const positionIdRaw = parsed?.args?.positionId ?? parsed?.args?.[0] ?? 0n;
            const positionId = BigInt(positionIdRaw || 0n).toString();
            const reasonValue =
              eventType === "RebalanceSkipped"
                ? decodeRebalanceReason(String(parsed?.args?.reason || parsed?.args?.[1] || "0x"))
                : "";
            const zeroForOne =
              eventType === "SwapToTarget" ? Boolean(parsed?.args?.zeroForOne ?? parsed?.args?.[1]) : undefined;
            const amountIn =
              eventType === "SwapToTarget" ? BigInt(parsed?.args?.amountIn ?? parsed?.args?.[2] ?? 0n) : undefined;
            const amountOut =
              eventType === "SwapToTarget" ? BigInt(parsed?.args?.amountOut ?? parsed?.args?.[3] ?? 0n) : undefined;
            return {
              id: `${log.transactionHash}-${log.index}`,
              blockNumber: Number(log.blockNumber),
              timestamp: null,
              txHash: log.transactionHash,
              eventType,
              positionId,
              details: reasonValue || "",
              zeroForOne,
              amountIn,
              amountOut,
              logIndex: Number(log.index),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<
        ActivityItem & {
          logIndex: number;
          zeroForOne?: boolean;
          amountIn?: bigint;
          amountOut?: bigint;
        }
      >;

      const uniqueBlocks = Array.from(new Set(parsedLogs.map((entry) => entry.blockNumber)));
      const blockMap = new Map<number, number>();
      await Promise.all(
        uniqueBlocks.map(async (blockNumber) => {
          try {
            const block = await readProvider.getBlock(blockNumber);
            if (block?.timestamp) {
              blockMap.set(blockNumber, Number(block.timestamp));
            }
          } catch {
            // ignore block timestamp fetch errors
          }
        })
      );

      const withTimestamps = parsedLogs.map((entry) => ({
        ...entry,
        timestamp: blockMap.get(entry.blockNumber) || null,
      }));

      withTimestamps.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return b.blockNumber - a.blockNumber;
        return b.logIndex - a.logIndex;
      });

      const topItems = withTimestamps.slice(0, MAX_ACTIVITY_ITEMS);
      const swapPositionIds = Array.from(
        new Set(topItems.filter((item) => item.eventType === "SwapToTarget").map((item) => item.positionId))
      );
      const positionTokenMap = new Map<string, { token0: TokenMeta; token1: TokenMeta }>();
      await Promise.all(
        swapPositionIds.map(async (positionId) => {
          try {
            const tuple = await alm.positionsById(BigInt(positionId));
            const token0 = normalizeAddress(String(tuple?.[3] || ZERO_ADDRESS));
            const token1 = normalizeAddress(String(tuple?.[4] || ZERO_ADDRESS));
            const [token0Meta, token1Meta] = await Promise.all([resolveTokenMeta(token0), resolveTokenMeta(token1)]);
            positionTokenMap.set(positionId, { token0: token0Meta, token1: token1Meta });
          } catch {
            // ignore metadata resolution failures for logs
          }
        })
      );

      const enriched = topItems.map((item) => {
        if (item.eventType !== "SwapToTarget") return item;
        const tokenPair = positionTokenMap.get(item.positionId);
        const zeroForOne = Boolean(item.zeroForOne);
        const amountIn = BigInt(item.amountIn || 0n);
        const amountOut = BigInt(item.amountOut || 0n);
        const tokenIn = zeroForOne ? tokenPair?.token0 : tokenPair?.token1;
        const tokenOut = zeroForOne ? tokenPair?.token1 : tokenPair?.token0;
        const inSymbol = tokenIn?.symbol || (zeroForOne ? "token0" : "token1");
        const outSymbol = tokenOut?.symbol || (zeroForOne ? "token1" : "token0");
        const inDecimals = tokenIn?.decimals ?? 18;
        const outDecimals = tokenOut?.decimals ?? 18;
        const direction = zeroForOne ? "token0 -> token1" : "token1 -> token0";
        const details = `${direction} | ${formatTokenAmount(amountIn, inDecimals)} ${inSymbol} -> ${formatTokenAmount(
          amountOut,
          outDecimals
        )} ${outSymbol}`;
        return {
          ...item,
          details,
        };
      });

      setActivity(enriched);
    } catch (error: any) {
      showToast(
        "error",
        getReadableErrorMessage(error, "Unable to load activity log. Please retry in a few seconds.")
      );
    } finally {
      if (showLoading) setActivityLoading(false);
    }
  }, [readProvider, resolveTokenMeta, showToast]);

  useEffect(() => {
    void loadStrategies();
    void loadGlobalInfo();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadStrategies();
      void loadGlobalInfo();
    }, 45_000);
    return () => window.clearInterval(interval);
  }, [loadGlobalInfo, loadStrategies]);

  useEffect(() => {
    void loadActivityLog("initial");
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadActivityLog("poll");
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [loadActivityLog, refreshNonce]);

  useEffect(() => {
    if (!address) {
      setPositions([]);
      return;
    }
    void loadUserPositions();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadUserPositions();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [address, loadUserPositions, refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedNft || !selectedStrategy) {
      setFeeAllowedOnChain(null);
      return () => {
        cancelled = true;
      };
    }
    setFeeAllowedOnChain(null);

    const verifyFee = async () => {
      try {
        const registry = new Contract(
          normalizeAddress(registryAddress || ALM_ADDRESSES.STRATEGY_REGISTRY),
          STRATEGY_REGISTRY_ABI as any,
          readProvider
        );
        const allowed = await registry.isFeeAllowed(BigInt(selectedStrategy.id), selectedNft.fee);
        if (!cancelled) setFeeAllowedOnChain(Boolean(allowed));
      } catch {
        if (!cancelled) setFeeAllowedOnChain(null);
      }
    };

    void verifyFee();
    return () => {
      cancelled = true;
    };
  }, [readProvider, registryAddress, selectedNft, selectedStrategy]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedStrategy) {
      setStrategyRouterDefaults(null);
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      try {
        const alm = new Contract(ALM_ADDRESSES.ALM, ALM_ABI as any, readProvider);
        const routerRaw = await alm.strategyRouter(BigInt(selectedStrategy.id)).catch(() => ZERO_ADDRESS);
        const routerAddress = normalizeAddress(String(routerRaw || ZERO_ADDRESS));
        if (!routerAddress || isZeroAddress(routerAddress)) {
          if (!cancelled) {
            setStrategyRouterDefaults({
              routerAddress: "",
              quoterAddress: "",
              factoryAddress: "",
            });
          }
          return;
        }
        const [factoryRaw, quoterRaw] = await Promise.all([
          alm.factoryByRouter(routerAddress).catch(() => ZERO_ADDRESS),
          alm.quoterByRouter(routerAddress).catch(() => ZERO_ADDRESS),
        ]);
        if (!cancelled) {
          setStrategyRouterDefaults({
            routerAddress: normalizeAddress(String(routerAddress)),
            factoryAddress: normalizeAddress(String(factoryRaw || ZERO_ADDRESS)),
            quoterAddress: normalizeAddress(String(quoterRaw || ZERO_ADDRESS)),
          });
        }
      } catch {
        if (!cancelled) {
          setStrategyRouterDefaults({
            routerAddress: "",
            quoterAddress: "",
            factoryAddress: "",
          });
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [readProvider, selectedStrategy]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedNft) {
      setSelectedToken1Stable(null);
      return () => {
        cancelled = true;
      };
    }
    const run = async () => {
      try {
        const registry = new Contract(
          normalizeAddress(registryAddress || ALM_ADDRESSES.STRATEGY_REGISTRY),
          STRATEGY_REGISTRY_ABI as any,
          readProvider
        );
        const isStable = await registry.isStableToken(selectedNft.token1);
        if (!cancelled) setSelectedToken1Stable(Boolean(isStable));
      } catch {
        if (!cancelled) setSelectedToken1Stable(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [readProvider, registryAddress, selectedNft]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (copiedTimeoutRef.current) window.clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    setLastDepositSummary(null);
  }, [selectedStrategyId, selectedTokenId]);

  const handleLookup = useCallback(async () => {
    const raw = lookupTokenId.trim();
    if (!raw || !/^\d+$/u.test(raw)) {
      showToast("error", "Invalid tokenId: enter a whole number.");
      return;
    }
    const cached = nftLookupCacheRef.current.get(raw);
    if (cached) {
      setNftItems((prev) => {
        const next = [cached, ...prev.filter((entry) => entry.tokenId !== cached.tokenId)];
        return next.slice(0, 15);
      });
      setSelectedTokenId(cached.tokenId);
      setApproveStatus("idle");
      setDepositStatus("idle");
      setLastDepositSummary(null);
      showToast("info", `NFT #${cached.tokenId} already loaded. Using local cache.`);
      return;
    }
    setLookupLoading(true);
    try {
      const row = await fetchNftPosition(raw);
      nftLookupCacheRef.current.set(row.tokenId, row);
      setNftItems((prev) => {
        const next = [row, ...prev.filter((entry) => entry.tokenId !== row.tokenId)];
        return next.slice(0, 15);
      });
      setSelectedTokenId(row.tokenId);
      setApproveStatus("idle");
      setDepositStatus("idle");
      setLastDepositSummary(null);
      showToast("success", `NFT #${row.tokenId} loaded successfully.`);
    } catch (error: any) {
      showToast(
        "error",
        getReadableErrorMessage(error, "Unable to fetch NFT position. Check tokenId and try again.")
      );
    } finally {
      setLookupLoading(false);
    }
  }, [fetchNftPosition, lookupTokenId, showToast]);

  const refreshSelectedNft = useCallback(async () => {
    if (!selectedTokenId) return;
    try {
      const fresh = await fetchNftPosition(selectedTokenId);
      nftLookupCacheRef.current.set(fresh.tokenId, fresh);
      setNftItems((prev) => prev.map((item) => (item.tokenId === fresh.tokenId ? fresh : item)));
    } catch {
      // ignore refresh failures
    }
  }, [fetchNftPosition, selectedTokenId]);

  const handleApprove = useCallback(async () => {
    if (!selectedNft) return;
    if (!address) {
      onConnect?.();
      return;
    }
    if (wrongChain) {
      showToast("error", `Switch wallet to chain ${ALM_CHAIN_ID} before approval.`);
      return;
    }
    setApproveStatus("pending");
    setApproveTxHash("");
    try {
      const walletProvider = await getProvider();
      const signer = await walletProvider.getSigner();
      const nfpm = new Contract(ALM_ADDRESSES.NFPM, NFPM_ABI as any, signer);
      const tx = await nfpm.approve(ALM_ADDRESSES.ALM, BigInt(selectedNft.tokenId));
      setApproveTxHash(tx.hash);
      await tx.wait();
      setApproveStatus("success");
      showToast("success", `Approval confirmed for NFT #${selectedNft.tokenId}.`);
      await refreshSelectedNft();
      setRefreshNonce((value) => value + 1);
    } catch (error: any) {
      setApproveStatus("error");
      showToast(
        "error",
        getReadableErrorMessage(error, "Approval transaction failed. Check wallet and try again.")
      );
    }
  }, [address, onConnect, refreshSelectedNft, selectedNft, showToast, wrongChain]);

  const handleDeposit = useCallback(async () => {
    if (!selectedNft || selectedStrategyId === null) return;
    if (!address) {
      onConnect?.();
      return;
    }
    if (wrongChain) {
      showToast("error", `Switch wallet to chain ${ALM_CHAIN_ID} before deposit.`);
      return;
    }
    setDepositStatus("pending");
    setDepositTxHash("");
    try {
      const walletProvider = await getProvider();
      const signer = await walletProvider.getSigner();
      const alm = new Contract(ALM_ADDRESSES.ALM, ALM_ABI as any, signer);
      const tx = await alm.deposit(BigInt(selectedNft.tokenId), BigInt(selectedStrategyId));
      setDepositTxHash(tx.hash);
      await tx.wait();
      setDepositStatus("success");
      setLastDepositSummary({
        tokenId: selectedNft.tokenId,
        strategyId: selectedStrategyId,
        tokenPair: `${selectedNft.token0Symbol}/${selectedNft.token1Symbol}`,
        feeTier: formatFeeTier(selectedNft.fee),
        liquidityUnits: formatBigInt(selectedNft.liquidity),
        timestampSec: Math.floor(Date.now() / 1000),
      });
      showToast("success", `Deposit completed for NFT #${selectedNft.tokenId}.`);
      setRefreshNonce((value) => value + 1);
      await Promise.all([refreshSelectedNft(), loadUserPositions(), loadActivityLog()]);
    } catch (error: any) {
      setDepositStatus("error");
      showToast(
        "error",
        getReadableErrorMessage(error, "Deposit failed. Check approval and strategy conditions.")
      );
    }
  }, [
    address,
    loadActivityLog,
    loadUserPositions,
    onConnect,
    refreshSelectedNft,
    selectedNft,
    selectedStrategyId,
    showToast,
    wrongChain,
  ]);

  const handleWithdraw = useCallback(
    async (positionId: string) => {
      if (!address) {
        onConnect?.();
        return;
      }
      if (wrongChain) {
        showToast("error", `Switch wallet to chain ${ALM_CHAIN_ID} before withdraw.`);
        return;
      }
      setWithdrawingPositionId(positionId);
      try {
        const walletProvider = await getProvider();
        const signer = await walletProvider.getSigner();
        const alm = new Contract(ALM_ADDRESSES.ALM, ALM_ABI as any, signer);
        const tx = await alm.withdraw(BigInt(positionId));
        await tx.wait();
        showToast("success", `Position #${positionId} withdrawn successfully.`);
        setRefreshNonce((value) => value + 1);
        await Promise.all([loadUserPositions(), loadActivityLog()]);
      } catch (error: any) {
        showToast(
          "error",
          getReadableErrorMessage(error, "Withdraw failed. Check gas balance and try again.")
        );
      } finally {
        setWithdrawingPositionId("");
      }
    },
    [address, loadActivityLog, loadUserPositions, onConnect, showToast, wrongChain]
  );

  const handleCompoundWeighted = useCallback(
    async (positionId: string) => {
      if (!address) {
        onConnect?.();
        return;
      }
      if (!isKeeperWallet) {
        showToast("error", "Only keeper wallet can execute compound.");
        return;
      }
      if (wrongChain) {
        showToast("error", `Switch wallet to chain ${ALM_CHAIN_ID} before compound.`);
        return;
      }
      setCompoundingPositionId(positionId);
      try {
        const walletProvider = await getProvider();
        const signer = await walletProvider.getSigner();
        const alm = new Contract(ALM_ADDRESSES.ALM, ALM_ABI as any, signer);
        const tx = await alm.compoundWeighted(BigInt(positionId));
        await tx.wait();
        showToast("success", `compoundWeighted executed for position #${positionId}.`);
        setRefreshNonce((value) => value + 1);
        await Promise.all([loadUserPositions(), loadActivityLog("manual")]);
      } catch (error: any) {
        showToast(
          "error",
          getReadableErrorMessage(error, "compoundWeighted failed. Retry or verify keeper requirements.")
        );
      } finally {
        setCompoundingPositionId("");
      }
    },
    [address, isKeeperWallet, loadActivityLog, loadUserPositions, onConnect, showToast, wrongChain]
  );

  const handleSaveStrategyParams = useCallback(
    async (input: WizardSubmitPayload) => {
      if (!address) {
        onConnect?.();
        return;
      }
      if (!isRegistryOwnerWallet) {
        showToast("error", "Only registry owner can update strategies.");
        return;
      }
      if (wrongChain) {
        showToast("error", `Switch wallet to chain ${ALM_CHAIN_ID} before saving strategy.`);
        return;
      }
      const strategy = strategyById.get(input.strategyId);
      if (!strategy) {
        showToast("error", "Strategy not found.");
        return;
      }
      if (!Number.isFinite(input.targetRatioBps0) || input.targetRatioBps0 < 0 || input.targetRatioBps0 > 10_000) {
        showToast("error", "Target ratio must be between 0% and 100%.");
        return;
      }
      if (!Number.isFinite(input.ratioDeadbandBps) || input.ratioDeadbandBps < 0 || input.ratioDeadbandBps > 10_000) {
        showToast("error", "Deadband must be between 0% and 100%.");
        return;
      }
      const minCompoundValueToken1 = parseTokenUnitsSafe(input.minCompoundInput, input.token1Decimals);
      const minSwapValueToken1 = parseTokenUnitsSafe(input.minSwapInput, input.token1Decimals);
      if (minCompoundValueToken1 === null || minSwapValueToken1 === null) {
        showToast("error", "Invalid numeric values for compound/swap thresholds.");
        return;
      }
      setSavingStrategy(true);
      try {
        const walletProvider = await getProvider();
        const signer = await walletProvider.getSigner();
        const alm = new Contract(ALM_ADDRESSES.ALM, ALM_ABI as any, signer);
        const registry = new Contract(
          normalizeAddress(registryAddress || ALM_ADDRESSES.STRATEGY_REGISTRY),
          STRATEGY_REGISTRY_ABI as any,
          signer
        );

        const shouldUpdateMaxSwapIn =
          Number.isFinite(input.maxSwapInBps) &&
          Number.isFinite(maxSwapInBpsCurrent || 0) &&
          maxSwapInBpsCurrent !== null &&
          Number(input.maxSwapInBps) !== Number(maxSwapInBpsCurrent);
        if ((shouldUpdateMaxSwapIn || input.useExternalDex) && !isAlmOwnerWallet) {
          showToast("error", "Cross-DEX or maxSwapIn updates require ALM owner wallet.");
          return;
        }

        if (shouldUpdateMaxSwapIn) {
          const txMaxSwap = await alm.setMaxSwapInBps(Number(input.maxSwapInBps));
          await txMaxSwap.wait();
        }

        if (input.useExternalDex) {
          const router = normalizeAddress(input.routerAddress || "");
          const factory = normalizeAddress(input.factoryAddress || "");
          const quoter = normalizeAddress(input.quoterAddress || "");
          if (isZeroAddress(router) || isZeroAddress(factory) || isZeroAddress(quoter)) {
            showToast("error", "Cross-DEX requires router, quoter, and factory.");
            return;
          }

          const [allowedRouterRaw, currentFactoryRaw, currentQuoterRaw, currentStrategyRouterRaw] = await Promise.all([
            alm.allowedRouters(router).catch(() => false),
            alm.factoryByRouter(router).catch(() => ZERO_ADDRESS),
            alm.quoterByRouter(router).catch(() => ZERO_ADDRESS),
            alm.strategyRouter(BigInt(input.strategyId)).catch(() => ZERO_ADDRESS),
          ]);

          if (!Boolean(allowedRouterRaw)) {
            const txAllowRouter = await alm.setAllowedRouter(router, true);
            await txAllowRouter.wait();
          }
          if (normalizeAddress(String(currentFactoryRaw || ZERO_ADDRESS)).toLowerCase() !== factory.toLowerCase()) {
            const txSetFactory = await alm.setRouterFactory(router, factory);
            await txSetFactory.wait();
          }
          if (normalizeAddress(String(currentQuoterRaw || ZERO_ADDRESS)).toLowerCase() !== quoter.toLowerCase()) {
            const txSetQuoter = await alm.setRouterQuoter(router, quoter);
            await txSetQuoter.wait();
          }
          if (
            normalizeAddress(String(currentStrategyRouterRaw || ZERO_ADDRESS)).toLowerCase() !==
            router.toLowerCase()
          ) {
            const txSetStrategyRouter = await alm.setStrategyRouter(BigInt(input.strategyId), router);
            await txSetStrategyRouter.wait();
          }
        }

        const feeIndex = FEE_TIERS.indexOf(Number(input.lpFeeTier));
        const allowedFeeBitmap =
          feeIndex >= 0 ? 1n << BigInt(feeIndex) : BigInt(strategy.feeTierBitmap || 0n);
        const tuple = {
          poolClass: strategy.poolClass,
          widthBps: input.widthBps,
          recenterBps: input.recenterBps,
          minRebalanceInterval: input.minRebalanceInterval,
          maxSwapSlippageBps: input.maxSwapSlippageBps,
          mintSlippageBps: input.mintSlippageBps,
          allowSwap: Boolean(input.allowSwap || input.useExternalDex),
          route: Number.isFinite(input.routeCode)
            ? input.routeCode
            : strategy.route === "DIRECT_ONLY"
            ? 0
            : 1,
          minCardinality: input.minCardinality,
          _pad: 0,
          allowedFeeBitmap,
          oracleParams: input.oracleParamsHex || "0x",
          wethHopFee: input.wethHopFee,
          targetRatioBps0: input.targetRatioBps0,
          minCompoundValueToken1,
          ratioDeadbandBps: input.ratioDeadbandBps,
          minSwapValueToken1,
        };
        const tx = await registry.setStrategy(BigInt(input.strategyId), tuple);
        await tx.wait();
        showToast("success", `Strategy #${input.strategyId} updated via wizard.`);
        await Promise.all([loadStrategies(), loadUserPositions(), loadGlobalInfo()]);
      } catch (error: any) {
        showToast(
          "error",
          getReadableErrorMessage(error, "Strategy update failed. Verify parameters and try again.")
        );
      } finally {
        setSavingStrategy(false);
      }
    },
    [
      address,
      isRegistryOwnerWallet,
      loadStrategies,
      loadGlobalInfo,
      loadUserPositions,
      onConnect,
      registryAddress,
      showToast,
      strategyById,
      maxSwapInBpsCurrent,
      isAlmOwnerWallet,
      wrongChain,
    ]
  );

  const ownerMatches =
    Boolean(address) &&
    Boolean(selectedNft) &&
    normalizeAddress(address || "").toLowerCase() === normalizeAddress(selectedNft?.owner || "").toLowerCase();
  const hasLiquidity = Boolean(selectedNft && selectedNft.liquidity > 0n);
  const feeAllowedByBitmap =
    !selectedNft || !selectedStrategy
      ? true
      : selectedStrategy.allowedFeeTiers.length === 0 ||
        selectedStrategy.allowedFeeTiers.includes(selectedNft.fee);
  const feeAllowed =
    !selectedNft || !selectedStrategy ? true : feeAllowedOnChain === null ? feeAllowedByBitmap : feeAllowedOnChain;
  const needsMoreCardinality =
    Boolean(
      selectedNft &&
        selectedStrategy &&
        selectedStrategy.minCardinality > 0 &&
        selectedNft.observationCardinality !== null &&
        selectedNft.observationCardinality < selectedStrategy.minCardinality
    );

  const depositWarnings = [
    !ownerMatches && selectedNft
      ? "Selected NFT is not owned by this wallet. Connect the owning wallet or select another NFT."
      : "",
    !hasLiquidity && selectedNft
      ? "Selected NFT has zero liquidity. Add liquidity first, then retry deposit."
      : "",
    !feeAllowed && selectedNft && selectedStrategy
      ? `Fee tier mismatch: strategy #${selectedStrategy.id} does not support ${formatFeeTier(
          selectedNft.fee
        )}. Choose a compatible strategy for this NFT fee tier.`
      : "",
    needsMoreCardinality && selectedNft && selectedStrategy
      ? `Pool observation cardinality is ${selectedNft.observationCardinality}, below required minimum ${selectedStrategy.minCardinality}. Wait for more observations or choose another strategy.`
      : "",
  ].filter(Boolean);

  const strategyHint = selectedStrategy
    ? `Target allocation: ${(selectedStrategy.targetRatioBps0 / 100).toFixed(2).replace(/\.?0+$/u, "")}% token0 / ${(
        (10_000 - selectedStrategy.targetRatioBps0) /
        100
      )
        .toFixed(2)
        .replace(/\.?0+$/u, "")}% token1. Rebalances keep this ratio over time.`
    : "";

  const lookupTokenIdTrimmed = lookupTokenId.trim();
  const lookupError = useMemo(() => {
    if (!lookupTokenIdTrimmed) return "Enter a numeric tokenId.";
    if (!/^\d+$/u.test(lookupTokenIdTrimmed)) return "Invalid tokenId: use whole numbers only.";
    return "";
  }, [lookupTokenIdTrimmed]);
  const canLookup = !lookupError && !lookupLoading;
  const isNftApproved = Boolean(selectedNft?.approvedToAlm) || approveStatus === "success";
  const canOpenStep2 = Boolean(selectedNft);
  const canOpenStep3 = Boolean(selectedNft && selectedStrategy);

  const canApprove = Boolean(selectedNft && ownerMatches && hasLiquidity && !wrongChain);
  const canDeposit =
    Boolean(selectedNft) &&
    Boolean(selectedStrategy) &&
    Boolean(ownerMatches) &&
    Boolean(hasLiquidity) &&
    Boolean(feeAllowed) &&
    !wrongChain &&
    Boolean(isNftApproved);

  useEffect(() => {
    if (!selectedNft) {
      setDepositWizardStep(1);
      return;
    }
    if (selectedNft && depositWizardStep === 1) {
      setDepositWizardStep(2);
    }
  }, [depositWizardStep, selectedNft]);

  useEffect(() => {
    if (!selectedNft || !selectedStrategy) {
      setDepositWizardStep((current) => (current === 3 ? 2 : current));
      return;
    }
    if (depositWizardStep < 3) {
      setDepositWizardStep(3);
    }
  }, [depositWizardStep, selectedNft, selectedStrategy]);

  const mainViews = [
    {
      id: "deposit" as const,
      label: "Guided Deposit",
      description: "NFT lookup, strategy, and deposit",
      status:
        depositStatus === "success"
          ? ("success" as const)
          : approveStatus === "pending" || depositStatus === "pending"
          ? ("pending" as const)
          : ("idle" as const),
    },
    {
      id: "positions" as const,
      label: "My Positions",
      description: `${positions.length} positions`,
      status: positionsLoading ? ("pending" as const) : positions.length ? ("success" as const) : ("idle" as const),
    },
    {
      id: "logs" as const,
      label: "Activity Logs",
      description: `${activity.length} events`,
      status: activityLoading ? ("pending" as const) : activity.length ? ("success" as const) : ("idle" as const),
    },
    {
      id: "advanced" as const,
      label: "Advanced Settings",
      description: "Admin, keeper, and safety",
      status: globalLoading ? ("pending" as const) : showAdvancedSettings ? ("success" as const) : ("idle" as const),
    },
  ];

  const depositSteps: Array<{
    step: DepositWizardStep;
    title: string;
    ready: boolean;
    active: boolean;
    disabled: boolean;
  }> = [
    {
      step: 1,
      title: "1. Select NFT",
      ready: Boolean(selectedNft),
      active: depositWizardStep === 1,
      disabled: false,
    },
    {
      step: 2,
      title: "2. Choose strategy",
      ready: Boolean(selectedStrategy),
      active: depositWizardStep === 2,
      disabled: !canOpenStep2,
    },
    {
      step: 3,
      title: "3. Approve and deposit",
      ready: depositStatus === "success",
      active: depositWizardStep === 3,
      disabled: !canOpenStep3,
    },
  ];

  const canGoPrevStep = depositWizardStep > 1;
  const canGoNextStep =
    (depositWizardStep === 1 && canOpenStep2) || (depositWizardStep === 2 && canOpenStep3) || depositWizardStep === 3;

  return (
    <section className="px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-[1320px] space-y-4">
        {toast && (
          <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2">
            <div
              className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm shadow-xl backdrop-blur ${
                toast.tone === "success"
                  ? "border-emerald-500/40 bg-emerald-950/75 text-emerald-100"
                  : toast.tone === "error"
                  ? "border-rose-500/40 bg-rose-950/75 text-rose-100"
                  : "border-sky-500/40 bg-slate-950/80 text-slate-100"
              }`}
            >
              {toast.tone === "success" && <CheckCircle2 className="h-4 w-4" />}
              {toast.tone === "error" && <AlertTriangle className="h-4 w-4" />}
              {toast.tone === "info" && <Loader2 className="h-4 w-4" />}
              {toast.text}
            </div>
          </div>
        )}

        <header className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-200">
                CurrentX ALM
              </div>
              <h1 className="mt-2 font-display text-2xl font-semibold text-slate-100 sm:text-3xl">
                Liquidity NFT Manager
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                Use the guided flow: select NFT, choose a strategy, then approve and deposit with fewer clicks.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 text-xs text-slate-400">
              <div>Chain: {ALM_CHAIN_ID}</div>
              <div className="max-w-[280px] truncate text-right">RPC: {ALM_RPC_URL}</div>
              {wrongChain && (
                <div className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-amber-100">
                  Wallet on wrong chain
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {mainViews.map((view) => {
            const visual = getStatusVisual(view.status);
            const Icon = visual.icon;
            return (
              <button
                key={view.id}
                type="button"
                onClick={() => setActiveView(view.id)}
                className={`rounded-2xl border p-3 text-left transition ${
                  activeView === view.id
                    ? "border-sky-400/70 bg-sky-500/10"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-600"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-display text-sm font-semibold text-slate-100">{view.label}</div>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${visual.className}`}>
                    <Icon className={`h-3.5 w-3.5 ${view.status === "pending" ? "animate-spin" : ""}`} />
                    {visual.label}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-400">{view.description}</div>
              </button>
            );
          })}
        </div>

        {activeView === "deposit" && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-base font-semibold text-slate-100">Deposit wizard</h2>
                  <div className="text-xs text-slate-400">Show only the active step</div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {depositSteps.map((step) => (
                    <button
                      key={step.step}
                      type="button"
                      disabled={step.disabled}
                      onClick={() => setDepositWizardStep(step.step)}
                      className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                        step.active
                          ? "border-sky-400/70 bg-sky-500/10 text-sky-100"
                          : step.ready
                          ? "border-emerald-400/45 bg-emerald-500/10 text-emerald-100"
                          : "border-slate-700 bg-slate-900/50 text-slate-300"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <div className="flex items-center gap-2">
                        {step.ready ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : step.active ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Circle className="h-4 w-4" />
                        )}
                        {step.title}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setDepositWizardStep((current) => Math.max(1, current - 1) as DepositWizardStep)}
                    disabled={!canGoPrevStep}
                    className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepositWizardStep((current) => Math.min(3, current + 1) as DepositWizardStep)}
                    disabled={!canGoNextStep || depositWizardStep === 3}
                    className="rounded-xl border border-sky-400/45 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>

              {depositWizardStep === 1 && (
                <NftPositionLookup
                  address={address}
                  onConnect={onConnect}
                  lookupTokenId={lookupTokenId}
                  onLookupTokenIdChange={setLookupTokenId}
                  onLookup={handleLookup}
                  lookupLoading={lookupLoading}
                  items={nftItems}
                  selectedTokenId={selectedTokenId}
                  onSelectTokenId={setSelectedTokenId}
                  lookupError={lookupError}
                  canLookup={canLookup}
                  copiedValue={copiedValue}
                  onCopy={copyValue}
                />
              )}

              {depositWizardStep === 2 && (
                <StrategyList
                  loading={strategiesLoading}
                  strategies={strategies}
                  selectedStrategyId={selectedStrategyId}
                  onSelectStrategy={setSelectedStrategyId}
                  selectedToken1={selectedNft}
                  selectedToken1Stable={selectedToken1Stable}
                />
              )}

              {depositWizardStep === 3 && (
                <DepositFlow
                  selectedNft={selectedNft}
                  selectedStrategy={selectedStrategy}
                  canApprove={canApprove}
                  canDeposit={canDeposit}
                  warnings={depositWarnings}
                  strategyHint={strategyHint}
                  registryAddress={registryAddress}
                  lastDepositSummary={lastDepositSummary}
                  approveStatus={approveStatus}
                  approveTxHash={approveTxHash}
                  depositStatus={depositStatus}
                  depositTxHash={depositTxHash}
                  onApprove={handleApprove}
                  onDeposit={handleDeposit}
                  onConnect={onConnect}
                  address={address}
                />
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-base font-semibold text-slate-100">Quick status</h2>
                  {globalLoading && <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />}
                </div>
                <div className="mt-3 space-y-2 text-sm text-slate-300">
                  <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                    Selected NFT: <span className="text-slate-100">{selectedNft ? `#${selectedNft.tokenId}` : "--"}</span>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                    Strategy: <span className="text-slate-100">{selectedStrategy ? `#${selectedStrategy.id}` : "--"}</span>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                    NFT approval:{" "}
                    <span className={isNftApproved ? "text-emerald-200" : "text-amber-200"}>
                      {isNftApproved ? "Ready" : "Pending"}
                    </span>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                    Keeper: <span className="font-mono text-xs text-slate-200">{keeper || "--"}</span>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                    Emergency mode:{" "}
                    <span className={emergency ? "text-rose-200" : "text-emerald-200"}>
                      {emergency ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveView("advanced")}
                  className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500"
                >
                  Open advanced settings
                </button>
              </div>
            </div>
          </div>
        )}

        {activeView === "positions" && (
          <Suspense
            fallback={
              <div className="rounded-2xl border border-slate-800 bg-slate-950/55 px-4 py-5 text-sm text-slate-300">
                Loading positions module...
              </div>
            }
          >
            <LazyMyPositions
              address={address}
              onConnect={onConnect}
              loading={positionsLoading}
              positions={positions}
              strategyById={strategyById}
              onWithdraw={handleWithdraw}
              onCompoundWeighted={handleCompoundWeighted}
              withdrawingPositionId={withdrawingPositionId}
              compoundingPositionId={compoundingPositionId}
              isKeeperWallet={isKeeperWallet}
              copiedValue={copiedValue}
              onCopy={copyValue}
            />
          </Suspense>
        )}

        {activeView === "logs" && (
          <Suspense
            fallback={
              <div className="rounded-2xl border border-slate-800 bg-slate-950/55 px-4 py-5 text-sm text-slate-300">
                Loading logs module...
              </div>
            }
          >
            <LazyActivityLog
              loading={activityLoading}
              items={activity}
              copiedValue={copiedValue}
              onCopy={copyValue}
              onRefresh={loadActivityLog}
            />
          </Suspense>
        )}

        {activeView === "advanced" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-base font-semibold text-slate-100">Protocol data</h2>
                {globalLoading && <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />}
              </div>
              <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Keeper</div>
                  <div className="mt-1 font-mono text-xs text-slate-200">{keeper || "--"}</div>
                  <div className="mt-1 text-xs text-slate-400">Automation wallet that executes rebalances and compound operations.</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Treasury</div>
                  <div className="mt-1 font-mono text-xs text-slate-200">{treasury || "--"}</div>
                  <div className="mt-1 text-xs text-slate-400">Protocol fee receiver and accounting destination.</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Registry</div>
                  <div className="mt-1 font-mono text-xs text-slate-200">{registryAddress || "--"}</div>
                  <div className="mt-1 text-xs text-slate-400">On-chain contract containing strategy definitions.</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">ALM Owner</div>
                  <div className="mt-1 font-mono text-xs text-slate-200">{almOwner || "--"}</div>
                  <div className="mt-1 text-xs text-slate-400">Administrative wallet for protocol-level parameters.</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">maxSwapInBps</div>
                  <div className="mt-1 text-slate-200">
                    {Number.isFinite(maxSwapInBpsCurrent || 0) && maxSwapInBpsCurrent !== null
                      ? `${(Number(maxSwapInBpsCurrent) / 100).toFixed(2).replace(/\.?0+$/u, "")}%`
                      : "--"}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">Caps swap size per rebalance to limit execution risk.</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Emergency</div>
                  <div className="mt-1 text-slate-200">{emergency ? "Enabled" : "Disabled"}</div>
                  <div className="text-xs text-slate-400">Delay: {formatDuration(emergencyDelay)}</div>
                  <div className="mt-1 text-xs text-slate-400">Safety mode that can restrict keeper actions after delay.</div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-base font-semibold text-slate-100">Advanced settings</h2>
                <button
                  type="button"
                  onClick={() => setShowAdvancedSettings((current) => !current)}
                  className="rounded-full border border-amber-400/45 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100"
                >
                  {showAdvancedSettings ? "Hide" : "Show"} advanced settings
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                This section is intended for admin wallets (strategy registry owner / ALM owner).
              </p>

              {showAdvancedSettings && (
                <div className="mt-4 space-y-4">
                  {!(isRegistryOwnerWallet || isAlmOwnerWallet) && (
                    <div className="rounded-xl border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                      Current wallet is not admin: you can review settings but cannot save changes.
                    </div>
                  )}
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
                      <div className="font-semibold text-slate-100">Swap settings</div>
                      <div className="mt-1 text-slate-400">Typical: slippage 0.30% to 1.00%, maxSwapIn 10% to 25%.</div>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
                      <div className="font-semibold text-slate-100">Risk management</div>
                      <div className="mt-1 text-slate-400">Typical: cooldown 30m to 4h, deadband 0.10% to 0.50%.</div>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
                      <div className="font-semibold text-slate-100">Liquidity routing</div>
                      <div className="mt-1 text-slate-400">Use external router/factory/quoter only when ALM owner approves.</div>
                    </div>
                  </div>
                  <StrategyWizard
                    readProvider={readProvider}
                    selectedStrategy={selectedStrategy}
                    selectedNft={selectedNft}
                    selectedToken1Stable={selectedToken1Stable}
                    crossDexDefaults={strategyRouterDefaults}
                    canEditRegistry={isRegistryOwnerWallet}
                    canEditAlm={isAlmOwnerWallet}
                    saving={savingStrategy}
                    maxSwapInBpsCurrent={maxSwapInBpsCurrent}
                    onSubmit={handleSaveStrategyParams}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
interface NftPositionLookupProps {
  address?: string | null;
  onConnect?: () => void;
  lookupTokenId: string;
  onLookupTokenIdChange: (value: string) => void;
  onLookup: () => void;
  lookupLoading: boolean;
  items: NftLookupItem[];
  selectedTokenId: string | null;
  onSelectTokenId: (value: string) => void;
  lookupError: string;
  canLookup: boolean;
  copiedValue: string;
  onCopy: (value: string) => void;
}

export function NftPositionLookup({
  address,
  onConnect,
  lookupTokenId,
  onLookupTokenIdChange,
  onLookup,
  lookupLoading,
  items,
  selectedTokenId,
  onSelectTokenId,
  lookupError,
  canLookup,
  copiedValue,
  onCopy,
}: NftPositionLookupProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-slate-100">1. Find LP NFT</h2>
        {!address && (
          <button
            type="button"
            onClick={onConnect}
            className="rounded-full border border-sky-400/50 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-100 hover:border-sky-300/70"
          >
            Connect wallet
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-400">
        Enter your Uniswap V3 NFT tokenId to fetch position data on-chain.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={lookupTokenId}
          inputMode="numeric"
          onChange={(event) => onLookupTokenIdChange(event.target.value)}
          placeholder="Example: 101"
          className={`w-full rounded-2xl border bg-slate-900/60 px-4 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 ${
            lookupError ? "border-rose-500/70 focus:border-rose-400/70" : "border-slate-700/80 focus:border-sky-400/70"
          }`}
        />
        <button
          type="button"
          onClick={onLookup}
          disabled={!canLookup}
          className="inline-flex items-center justify-center rounded-2xl border border-sky-300/55 bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {lookupLoading ? "Loading..." : "Find NFT"}
        </button>
      </div>
      {lookupError && <div className="mt-2 text-xs text-rose-200">{lookupError}</div>}

      <div className="mt-4 space-y-2">
        {lookupLoading && items.length === 0 && (
          <>
            <div className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/45" />
            <div className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/45" />
          </>
        )}

        {!lookupLoading && items.length === 0 && (
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/45 px-4 py-4 text-sm text-slate-400">
            No NFT loaded yet.
          </div>
        )}

        {items.map((item) => {
          const selected = selectedTokenId === item.tokenId;
          return (
            <button
              key={item.tokenId}
              type="button"
              onClick={() => onSelectTokenId(item.tokenId)}
              className={`w-full rounded-2xl border p-3 text-left transition ${
                selected
                  ? "border-sky-400/70 bg-sky-500/10 shadow-[0_0_0_1px_rgba(56,189,248,0.2)]"
                  : "border-slate-800/80 bg-slate-900/45 hover:border-slate-600/80"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-display text-sm font-semibold text-slate-100">Token #{item.tokenId}</div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                  <span className="rounded-full border border-slate-700/70 bg-slate-900/60 px-2 py-0.5">
                    {item.token0Symbol} / {item.token1Symbol}
                  </span>
                  <span className="rounded-full border border-slate-700/70 bg-slate-900/60 px-2 py-0.5">
                    Fee {formatFeeTier(item.fee)}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 ${
                      item.currentTick !== null &&
                      item.currentTick >= item.tickLower &&
                      item.currentTick <= item.tickUpper
                        ? "border-emerald-400/45 bg-emerald-500/12 text-emerald-100"
                        : "border-amber-400/45 bg-amber-500/12 text-amber-100"
                    }`}
                    title={
                      item.currentTick === null
                        ? "Current pool tick is unavailable."
                        : `Current tick ${item.currentTick}, range ${item.tickLower} to ${item.tickUpper}.`
                    }
                  >
                    {item.currentTick === null
                      ? "Tick unavailable"
                      : item.currentTick >= item.tickLower && item.currentTick <= item.tickUpper
                      ? "In range"
                      : "Out of range"}
                  </span>
                  {!item.approvedToAlm && (
                    <span className="rounded-full border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 text-amber-100">
                      Not approved
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                <div className="inline-flex items-center gap-1">
                  Owner: {shortenAddress(item.owner, 8, 6)}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCopy(item.owner);
                    }}
                    className="inline-flex items-center rounded-md border border-slate-700/70 bg-slate-900/70 p-1 text-slate-300 hover:border-slate-500"
                    aria-label="Copy owner address"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  {copiedValue === item.owner && <span className="text-emerald-200">Copied</span>}
                </div>
                <div className="inline-flex items-center gap-1">
                  Liquidity: {formatBigInt(item.liquidity)} units
                  <InfoHint title="Uniswap V3 liquidity uses protocol units, not direct token amounts." />
                </div>
                <div className="inline-flex items-center gap-1">
                  Tick range: {item.tickLower} to {item.tickUpper}
                  <InfoHint title="Ticks define the active price range where liquidity earns fees." />
                </div>
                <div className="inline-flex items-center gap-1">
                  Current market tick: {item.currentTick ?? "--"}
                  <InfoHint title="When current tick stays inside range, your NFT is active for fee earning." />
                </div>
                <div>Observation cardinality: {item.observationCardinality ?? "--"}</div>
                <div className="inline-flex items-center gap-1">
                  Dust balances: available after deposit
                  <InfoHint title="Dust is tracked per ALM position after your NFT is deposited and managed." />
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`${EXPLORER_BASE_URL}/token/${ALM_ADDRESSES.NFPM}?a=${item.tokenId}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex items-center gap-1 text-sky-200 underline decoration-dotted underline-offset-2"
                  >
                    View NFT <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface StrategyListProps {
  loading: boolean;
  strategies: StrategyConfig[];
  selectedStrategyId: number | null;
  onSelectStrategy: (strategyId: number) => void;
  selectedToken1: NftLookupItem | null;
  selectedToken1Stable: boolean | null;
}

export function StrategyList({
  loading,
  strategies,
  selectedStrategyId,
  onSelectStrategy,
  selectedToken1,
  selectedToken1Stable,
}: StrategyListProps) {
  const token1Symbol = selectedToken1?.token1Symbol || "token1";
  const token1Decimals = selectedToken1?.token1Decimals || 18;
  const recommendedStrategyId = useMemo(() => (strategies.length ? strategies[0].id : null), [strategies]);

  const renderCompoundThreshold = (strategy: StrategyConfig) => {
    const valueText = `${formatTokenAmount(strategy.minCompoundValueToken1, token1Decimals)} ${token1Symbol}`;
    if (!selectedToken1Stable) return valueText;
    return `${valueText} (approx. $${formatTokenAmount(strategy.minCompoundValueToken1, token1Decimals, 2)})`;
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-slate-100">2. Choose Strategy</h2>
        <div className="text-xs text-slate-500">{strategies.length} loaded</div>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Compare essential parameters first, then open advanced details only when needed.
      </p>

      <div className="mt-3 space-y-2">
        {loading && strategies.length === 0 && (
          <>
            <div className="h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/45" />
            <div className="h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/45" />
          </>
        )}

        {!loading && strategies.length === 0 && (
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/45 px-4 py-4 text-sm text-slate-400">
            No strategies returned by the registry.
          </div>
        )}

        {strategies.map((strategy) => {
          const selected = selectedStrategyId === strategy.id;
          const isRecommended = recommendedStrategyId === strategy.id;
          return (
            <article
              key={strategy.id}
              className={`w-full rounded-2xl border p-3 text-left transition ${
                selected
                  ? "border-cyan-300/70 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.22)]"
                  : "border-slate-800/80 bg-slate-900/45 hover:border-slate-600/80"
              }`}
            >
              <button type="button" onClick={() => onSelectStrategy(strategy.id)} className="w-full text-left">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2">
                    <div className="font-display text-sm font-semibold text-slate-100">Strategy #{strategy.id}</div>
                    {isRecommended && (
                      <span className="rounded-full border border-emerald-400/45 bg-emerald-500/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span
                      className={`rounded-full border px-2 py-0.5 ${
                        strategy.type === "STABLE"
                          ? "border-emerald-400/45 bg-emerald-500/12 text-emerald-100"
                          : "border-sky-400/45 bg-sky-500/12 text-sky-100"
                      }`}
                    >
                      {strategy.type}
                    </span>
                    <span className="rounded-full border border-slate-700/70 bg-slate-900/60 px-2 py-0.5 text-slate-200">
                      {strategy.route === "DIRECT_ONLY" ? "Direct route" : "Direct or WETH route"}
                    </span>
                  </div>
                </div>

                <div className="mt-2 text-xs text-slate-300">{strategy.recommendedLabel}</div>

                <div className="mt-2 grid gap-2 text-xs text-slate-300 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="inline-flex items-center gap-1">
                    Range width: +/-{formatPercentFromBps(strategy.widthBps, 2)}
                    <InfoHint title="Total width of active liquidity around center price." />
                  </div>
                  <div className="inline-flex items-center gap-1">
                    Recenter trigger: +/-{formatPercentFromBps(strategy.recenterBps, 2)}
                    <InfoHint title="Price deviation threshold that triggers rebalance." />
                  </div>
                  <div className="inline-flex items-center gap-1">
                    Cooldown: {formatDuration(strategy.minRebalanceInterval)}
                    <InfoHint title="Minimum waiting time between two keeper rebalances." />
                  </div>
                  <div className="inline-flex items-center gap-1">
                    Target ratio: {formatPercentFromBps(strategy.targetRatioBps0, 2)} token0
                    <InfoHint title="Target portfolio value split used during rebalances." />
                  </div>
                  <div className="inline-flex items-center gap-1">
                    Compound threshold: {renderCompoundThreshold(strategy)}
                    <InfoHint title="Minimum accumulated dust before compound can execute." />
                  </div>
                  <div className="inline-flex items-center gap-1">
                    Min swap value: {formatTokenAmount(strategy.minSwapValueToken1, token1Decimals)} {token1Symbol}
                    <InfoHint title="Minimum amount required before swap logic is allowed." />
                  </div>
                </div>
              </button>

              <details className="mt-3 rounded-xl border border-slate-800/70 bg-slate-950/45 px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-200">Advanced details</summary>
                <div className="mt-2 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                  <div className="inline-flex items-center gap-1">
                    Swap enabled: {strategy.allowSwap ? "Yes" : "No"}
                    <InfoHint title="If disabled, strategy avoids swap-based rebalancing actions." />
                  </div>
                  <div>
                    Fee tiers:{" "}
                    {strategy.allowedFeeTiers.length
                      ? strategy.allowedFeeTiers.map((tier) => formatFeeTier(tier)).join(" / ")
                      : "none"}
                  </div>
                  <div className="inline-flex items-center gap-1">
                    Swap slippage: +/-{formatPercentFromBps(strategy.maxSwapSlippageBps, 2)}
                    <InfoHint title="Maximum tolerated price impact for swaps." />
                  </div>
                  <div className="inline-flex items-center gap-1">
                    Mint slippage: +/-{formatPercentFromBps(strategy.mintSlippageBps, 2)}
                    <InfoHint title="Maximum tolerated price impact when minting LP." />
                  </div>
                  <div className="inline-flex items-center gap-1">
                    Ratio deadband: +/-{formatPercentFromBps(strategy.ratioDeadbandBps, 2)}
                    <InfoHint title="No-swap zone around target ratio to avoid noisy trades." />
                  </div>
                  <div className="inline-flex items-center gap-1">
                    Observation cardinality minimum: {strategy.minCardinality || "--"}
                    <InfoHint title="Minimum oracle observations required for safer rebalance checks." />
                  </div>
                  <div className="inline-flex items-center gap-1">
                    WETH hop fee: {strategy.wethHopFee ? formatFeeTier(strategy.wethHopFee) : "--"}
                    <InfoHint title="Fee tier used for optional WETH intermediate swap route." />
                  </div>
                  <div className="inline-flex items-center gap-1">
                    Oracle params: {strategy.oracleParamsHex !== "0x" ? "Configured" : "Empty"}
                    <InfoHint title="Raw oracle bytes used by on-chain oracle validation logic." />
                  </div>
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </div>
  );
}
interface DepositFlowProps {
  selectedNft: NftLookupItem | null;
  selectedStrategy: StrategyConfig | null;
  canApprove: boolean;
  canDeposit: boolean;
  warnings: string[];
  strategyHint: string;
  registryAddress: string;
  lastDepositSummary: {
    tokenId: string;
    strategyId: number;
    tokenPair: string;
    feeTier: string;
    liquidityUnits: string;
    timestampSec: number;
  } | null;
  approveStatus: StatusState;
  approveTxHash: string;
  depositStatus: StatusState;
  depositTxHash: string;
  onApprove: () => void;
  onDeposit: () => void;
  onConnect?: () => void;
  address?: string | null;
}

export function DepositFlow({
  selectedNft,
  selectedStrategy,
  canApprove,
  canDeposit,
  warnings,
  strategyHint,
  registryAddress,
  lastDepositSummary,
  approveStatus,
  approveTxHash,
  depositStatus,
  depositTxHash,
  onApprove,
  onDeposit,
  onConnect,
  address,
}: DepositFlowProps) {
  const approveVisual = getStatusVisual(approveStatus);
  const depositVisual = getStatusVisual(depositStatus);
  const ApproveIcon = approveVisual.icon;
  const DepositIcon = depositVisual.icon;
  const nftApproved = Boolean(selectedNft?.approvedToAlm) || approveStatus === "success";
  const targetRatioText = selectedStrategy
    ? `${formatPercentFromBps(selectedStrategy.targetRatioBps0, 2)} token0 / ${formatPercentFromBps(
        10_000 - selectedStrategy.targetRatioBps0,
        2
      )} token1`
    : "--";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-slate-100">3. Approve and Deposit</h2>
        {!address && (
          <button
            type="button"
            onClick={onConnect}
            className="rounded-full border border-sky-400/50 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-100 hover:border-sky-300"
          >
            Connect Wallet
          </button>
        )}
      </div>

      <div className="mt-3 rounded-2xl border border-slate-800/70 bg-slate-900/45 px-3 py-3 text-xs text-slate-300">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            Selected NFT: <span className="text-slate-100">{selectedNft ? `#${selectedNft.tokenId}` : "--"}</span>
          </div>
          <div>
            Strategy: <span className="text-slate-100">{selectedStrategy ? `#${selectedStrategy.id}` : "--"}</span>
          </div>
          <div>
            Pair: <span className="text-slate-100">{selectedNft ? `${selectedNft.token0Symbol}/${selectedNft.token1Symbol}` : "--"}</span>
          </div>
          <div>
            Fee tier: <span className="text-slate-100">{selectedNft ? formatFeeTier(selectedNft.fee) : "--"}</span>
          </div>
          <div className="sm:col-span-2">
            Target ratio: <span className="text-slate-100">{targetRatioText}</span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-3">
          {selectedNft && (
            <a
              href={`${EXPLORER_BASE_URL}/token/${ALM_ADDRESSES.NFPM}?a=${selectedNft.tokenId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sky-200 underline decoration-dotted underline-offset-2"
            >
              View NFT on explorer <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {selectedStrategy && (
            <a
              href={`${EXPLORER_BASE_URL}/address/${registryAddress}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sky-200 underline decoration-dotted underline-offset-2"
            >
              View strategy registry <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {strategyHint && (
        <div className="mt-2 rounded-2xl border border-sky-400/35 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
          {strategyHint}
        </div>
      )}

      <div className="mt-2 space-y-2">
        {warnings.map((warning, index) => (
          <div
            key={`${warning}-${index}`}
            className="rounded-2xl border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
          >
            {warning}
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className={`rounded-2xl border px-3 py-3 ${approveVisual.className}`}>
          <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide">
            <ApproveIcon className={`h-3.5 w-3.5 ${approveStatus === "pending" ? "animate-spin" : ""}`} />
            NFT approval
          </div>
          <div className="mt-1 text-xs">
            {nftApproved ? "NFT approved. You can proceed to deposit." : "Approval required before deposit."}
          </div>
          <button
            type="button"
            onClick={onApprove}
            disabled={!canApprove || approveStatus === "pending" || nftApproved}
            className="mt-2 w-full rounded-xl border border-current/30 bg-black/15 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {approveStatus === "pending"
              ? "Approval in progress..."
              : nftApproved
              ? "NFT approved"
              : "Approve NFT"}
          </button>
          {approveTxHash && (
            <a
              href={`${EXPLORER_BASE_URL}/tx/${approveTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-200 underline decoration-dotted underline-offset-2"
            >
              View approval transaction <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        <div className={`rounded-2xl border px-3 py-3 ${depositVisual.className}`}>
          <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide">
            <DepositIcon className={`h-3.5 w-3.5 ${depositStatus === "pending" ? "animate-spin" : ""}`} />
            Deposit
          </div>
          <div className="mt-1 text-xs">
            {canDeposit
              ? "All checks passed. Deposit is ready."
              : "Deposit is locked until ownership, liquidity, and strategy checks pass."}
          </div>
          <button
            type="button"
            onClick={onDeposit}
            disabled={!canDeposit || depositStatus === "pending"}
            className="mt-2 w-full rounded-xl border border-current/30 bg-black/15 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {depositStatus === "pending"
              ? "Deposit in progress..."
              : depositStatus === "success"
              ? "Deposit completed"
              : nftApproved
              ? "Deposit now"
              : "Approve NFT first"}
          </button>
          {depositTxHash && (
            <a
              href={`${EXPLORER_BASE_URL}/tx/${depositTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-200 underline decoration-dotted underline-offset-2"
            >
              View deposit transaction <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {depositStatus === "success" && lastDepositSummary && (
        <div className="mt-3 rounded-2xl border border-emerald-400/35 bg-emerald-500/10 px-3 py-3 text-xs text-emerald-100">
          <div className="font-semibold">Deposit complete</div>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            <div>NFT: #{lastDepositSummary.tokenId}</div>
            <div>Strategy: #{lastDepositSummary.strategyId}</div>
            <div>Pair: {lastDepositSummary.tokenPair}</div>
            <div>Fee tier: {lastDepositSummary.feeTier}</div>
            <div>Liquidity units: {lastDepositSummary.liquidityUnits}</div>
            <div title={formatDateTime(lastDepositSummary.timestampSec)}>
              Completed: {formatRelativeTimeFromNow(lastDepositSummary.timestampSec)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
