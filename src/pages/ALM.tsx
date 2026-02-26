import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  formatUnits,
  getAddress,
  id,
  toUtf8String,
} from "ethers";
import { Copy, RefreshCw } from "lucide-react";
import { EXPLORER_BASE_URL } from "../shared/config/addresses";
import { getProvider } from "../shared/config/web3";
import { TOKENS } from "../shared/config/tokens";
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
  feeTierBitmap: number;
  allowedFeeTiers: number[];
  route: "DIRECT_ONLY" | "DIRECT_OR_WETH";
  minCardinality: number;
  oracleParamsHex: string;
  wethHopFee: number;
  rawFields: number[];
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
}

interface ActivityItem {
  id: string;
  blockNumber: number;
  timestamp: number | null;
  txHash: string;
  eventType: string;
  positionId: string;
  reason: string;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const FEE_TIERS = [100, 500, 3000, 10000];
const MAX_USER_POSITIONS_SCAN = 64;
const MAX_ACTIVITY_ITEMS = 80;
const abiCoder = AbiCoder.defaultAbiCoder();
const almEventsInterface = new Interface(ALM_ABI as any);

const KNOWN_REASON_SELECTORS: Record<string, string> = {
  [id("BadPoolClass()").slice(0, 10).toLowerCase()]: "Bad pool class",
  [id("CardinalityTooLow()").slice(0, 10).toLowerCase()]: "Cardinality too low",
  [id("Cooldown()").slice(0, 10).toLowerCase()]: "Cooldown",
  [id("EmergencyEnabled()").slice(0, 10).toLowerCase()]: "Emergency enabled",
  [id("FeeDisabled()").slice(0, 10).toLowerCase()]: "Fee disabled",
  [id("FeeNotAllowed()").slice(0, 10).toLowerCase()]: "Fee tier not allowed",
  [id("NotEnoughObservations()").slice(0, 10).toLowerCase()]: "Not enough observations",
  [id("PriceManipulationDetected()").slice(0, 10).toLowerCase()]: "Price manipulation detected",
  [id("NotKeeper()").slice(0, 10).toLowerCase()]: "Only keeper can execute",
  [id("NotPositionOwner()").slice(0, 10).toLowerCase()]: "Not position owner",
  [id("PoolNotFound()").slice(0, 10).toLowerCase()]: "Pool not found",
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
  if (reasonHex === "0x") return "No reason provided";
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
    feeTierBitmap: Number(allowedFeeBitmap & 0xffffffffn),
    allowedFeeTiers,
    route: routeRaw === 0 ? "DIRECT_ONLY" : "DIRECT_OR_WETH",
    minCardinality,
    oracleParamsHex: oracleParamsHex || "0x",
    wethHopFee,
    rawFields: [
      poolClass,
      widthBps,
      recenterBps,
      minRebalanceInterval,
      maxSwapSlippageBps,
      mintSlippageBps,
      allowSwap ? 1 : 0,
      routeRaw,
      minCardinality,
      Number(allowedFeeBitmap & 0xffffffffn),
      wethHopFee,
    ],
    recommendedLabel: `±${formatPercentFromBps(widthBps, 1)} range, rebalance at ±${formatPercentFromBps(
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
  const [emergency, setEmergency] = useState(false);
  const [emergencyDelay, setEmergencyDelay] = useState(0);

  const [lookupTokenId, setLookupTokenId] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [nftItems, setNftItems] = useState<NftLookupItem[]>([]);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null);
  const [feeAllowedOnChain, setFeeAllowedOnChain] = useState<boolean | null>(null);

  const [approveStatus, setApproveStatus] = useState<StatusState>("idle");
  const [approveTxHash, setApproveTxHash] = useState("");
  const [depositStatus, setDepositStatus] = useState<StatusState>("idle");
  const [depositTxHash, setDepositTxHash] = useState("");

  const [positions, setPositions] = useState<AlmPositionRow[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [withdrawingPositionId, setWithdrawingPositionId] = useState("");

  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const toastTimerRef = useRef<number | null>(null);
  const tokenMetaCacheRef = useRef<Map<string, TokenMeta>>(new Map());
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
        showToast("error", "Unable to copy value.");
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
        return { currentTick: null, observationCardinality: null };
      }
      try {
        const pool = new Contract(normalized, POOL_SLOT0_ABI as any, readProvider);
        const slot0 = await pool.slot0();
        return {
          currentTick: Number(slot0.tick),
          observationCardinality: Number(slot0.observationCardinality),
        };
      } catch {
        return { currentTick: null, observationCardinality: null };
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
      const registry = new Contract(ALM_ADDRESSES.STRATEGY_REGISTRY, STRATEGY_REGISTRY_ABI as any, readProvider);
      const countRaw = await registry.strategiesCount();
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
      showToast("error", error?.message || "Unable to load strategies.");
    } finally {
      setStrategiesLoading(false);
    }
  }, [readProvider, showToast]);

  const loadGlobalInfo = useCallback(async () => {
    setGlobalLoading(true);
    try {
      const alm = new Contract(ALM_ADDRESSES.ALM, ALM_ABI as any, readProvider);
      const [keeperRaw, treasuryRaw, emergencyRaw, delayRaw] = await Promise.all([
        alm.keeper(),
        alm.treasury(),
        alm.emergency(),
        alm.EMERGENCY_DELAY(),
      ]);
      setKeeper(normalizeAddress(String(keeperRaw || "")));
      setTreasury(normalizeAddress(String(treasuryRaw || "")));
      setEmergency(Boolean(emergencyRaw));
      setEmergencyDelay(Number(delayRaw || 0n));
    } catch (error: any) {
      showToast("error", error?.message || "Unable to load ALM metadata.");
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
            dust0: BigInt(dust0Raw || 0n),
            dust1: BigInt(dust1Raw || 0n),
          } as AlmPositionRow;
        })
      );

      const filtered = rows.filter(Boolean) as AlmPositionRow[];
      filtered.sort((a, b) => (BigInt(a.positionId) < BigInt(b.positionId) ? 1 : -1));
      setPositions(filtered);
    } catch (error: any) {
      showToast("error", error?.message || "Unable to load your ALM positions.");
      setPositions([]);
    } finally {
      setPositionsLoading(false);
    }
  }, [address, loadPoolTick, readProvider, resolveTokenMeta, showToast]);

  const loadActivityLog = useCallback(async (mode: "initial" | "manual" | "poll" = "manual") => {
    const showLoading = mode !== "poll";
    if (showLoading) setActivityLoading(true);
    try {
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
            const positionIdRaw = parsed?.args?.positionId ?? parsed?.args?.[0] ?? 0n;
            const positionId = BigInt(positionIdRaw || 0n).toString();
            const reasonValue =
              eventType === "RebalanceSkipped"
                ? decodeRebalanceReason(String(parsed?.args?.reason || parsed?.args?.[1] || "0x"))
                : "";
            return {
              id: `${log.transactionHash}-${log.index}`,
              blockNumber: Number(log.blockNumber),
              timestamp: null,
              txHash: log.transactionHash,
              eventType,
              positionId,
              reason: reasonValue,
              logIndex: Number(log.index),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<ActivityItem & { logIndex: number }>;

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

      setActivity(withTimestamps.slice(0, MAX_ACTIVITY_ITEMS));
    } catch (error: any) {
      showToast("error", error?.message || "Unable to load ALM activity.");
    } finally {
      if (showLoading) setActivityLoading(false);
    }
  }, [readProvider, showToast]);

  useEffect(() => {
    void loadStrategies();
    void loadGlobalInfo();
    const interval = window.setInterval(() => {
      void loadStrategies();
      void loadGlobalInfo();
    }, 45_000);
    return () => window.clearInterval(interval);
  }, [loadGlobalInfo, loadStrategies]);

  useEffect(() => {
    void loadActivityLog("initial");
    const interval = window.setInterval(() => {
      void loadActivityLog("poll");
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [loadActivityLog, refreshNonce]);

  useEffect(() => {
    if (!address) {
      setPositions([]);
      return;
    }
    void loadUserPositions();
    const interval = window.setInterval(() => {
      void loadUserPositions();
    }, 20_000);
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
        const registry = new Contract(ALM_ADDRESSES.STRATEGY_REGISTRY, STRATEGY_REGISTRY_ABI as any, readProvider);
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
  }, [readProvider, selectedNft, selectedStrategy]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (copiedTimeoutRef.current) window.clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  const handleLookup = useCallback(async () => {
    const raw = lookupTokenId.trim();
    if (!raw || !/^\d+$/u.test(raw)) {
      showToast("error", "TokenId must be a valid integer.");
      return;
    }
    setLookupLoading(true);
    try {
      const row = await fetchNftPosition(raw);
      setNftItems((prev) => {
        const next = [row, ...prev.filter((entry) => entry.tokenId !== row.tokenId)];
        return next.slice(0, 15);
      });
      setSelectedTokenId(row.tokenId);
      setApproveStatus("idle");
      setDepositStatus("idle");
      showToast("success", `Loaded NFT #${row.tokenId}.`);
    } catch (error: any) {
      showToast("error", error?.message || "Unable to fetch NFT position.");
    } finally {
      setLookupLoading(false);
    }
  }, [fetchNftPosition, lookupTokenId, showToast]);

  const refreshSelectedNft = useCallback(async () => {
    if (!selectedTokenId) return;
    try {
      const fresh = await fetchNftPosition(selectedTokenId);
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
      showToast("error", `Switch wallet to chain ${ALM_CHAIN_ID} before approving.`);
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
      showToast("error", error?.message || "Approve transaction failed.");
    }
  }, [address, onConnect, refreshSelectedNft, selectedNft, showToast, wrongChain]);

  const handleDeposit = useCallback(async () => {
    if (!selectedNft || selectedStrategyId === null) return;
    if (!address) {
      onConnect?.();
      return;
    }
    if (wrongChain) {
      showToast("error", `Switch wallet to chain ${ALM_CHAIN_ID} before depositing.`);
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
      showToast("success", `Deposit completed for NFT #${selectedNft.tokenId}.`);
      setRefreshNonce((value) => value + 1);
      await Promise.all([refreshSelectedNft(), loadUserPositions(), loadActivityLog()]);
    } catch (error: any) {
      setDepositStatus("error");
      showToast("error", error?.message || "Deposit transaction failed.");
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
        showToast("error", `Switch wallet to chain ${ALM_CHAIN_ID} before withdrawing.`);
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
        showToast("error", error?.message || "Withdraw transaction failed.");
      } finally {
        setWithdrawingPositionId("");
      }
    },
    [address, loadActivityLog, loadUserPositions, onConnect, showToast, wrongChain]
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
    !ownerMatches && selectedNft ? "Selected NFT is not owned by your connected wallet." : "",
    !hasLiquidity && selectedNft ? "Selected NFT has zero liquidity and cannot be deposited." : "",
    !feeAllowed && selectedNft && selectedStrategy
      ? `Strategy #${selectedStrategy.id} does not allow fee tier ${formatFeeTier(selectedNft.fee)}.`
      : "",
    needsMoreCardinality && selectedNft && selectedStrategy
      ? `Pool observationCardinality (${selectedNft.observationCardinality}) is below strategy minimum (${selectedStrategy.minCardinality}).`
      : "",
  ].filter(Boolean);

  const canApprove = Boolean(selectedNft && ownerMatches && hasLiquidity && !wrongChain);
  const canDeposit =
    Boolean(selectedNft) &&
    Boolean(selectedStrategy) &&
    Boolean(ownerMatches) &&
    Boolean(hasLiquidity) &&
    Boolean(feeAllowed) &&
    !wrongChain &&
    Boolean(selectedNft?.approvedToAlm);

  return (
    <section className="px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-[1320px] space-y-4">
        {toast && (
          <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2">
            <div
              className={`rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${
                toast.tone === "success"
                  ? "border-emerald-500/40 bg-emerald-950/75 text-emerald-100"
                  : toast.tone === "error"
                  ? "border-rose-500/40 bg-rose-950/75 text-rose-100"
                  : "border-sky-500/40 bg-slate-950/80 text-slate-100"
              }`}
            >
              {toast.text}
            </div>
          </div>
        )}

        <header className="rounded-3xl border border-slate-800/80 bg-slate-950/55 p-5 shadow-[0_26px_60px_-45px_rgba(2,6,23,0.95)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-100">
                ALM
              </div>
              <h1 className="mt-2 font-display text-2xl font-semibold text-slate-100 sm:text-3xl">
                Automated Liquidity Manager
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                Deposit your CurrentX V3 LP NFT into the ALM contract and assign a predefined strategy.
                Rebalances are keeper-executed, with explicit cooldown and skip-reason visibility.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 text-xs text-slate-400">
              <div>Chain ID: {ALM_CHAIN_ID}</div>
              <div>RPC: {ALM_RPC_URL}</div>
              {wrongChain && (
                <div className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-amber-100">
                  Wallet on wrong chain
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <div className="space-y-4">
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
            />

            <StrategyList
              loading={strategiesLoading}
              strategies={strategies}
              selectedStrategyId={selectedStrategyId}
              onSelectStrategy={setSelectedStrategyId}
            />

            <DepositFlow
              selectedNft={selectedNft}
              selectedStrategy={selectedStrategy}
              canApprove={canApprove}
              canDeposit={canDeposit}
              warnings={depositWarnings}
              approveStatus={approveStatus}
              approveTxHash={approveTxHash}
              depositStatus={depositStatus}
              depositTxHash={depositTxHash}
              onApprove={handleApprove}
              onDeposit={handleDeposit}
              onConnect={onConnect}
              address={address}
            />
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-slate-100">Keeper Info</h2>
                {globalLoading && <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />}
              </div>
              <div className="mt-3 space-y-2 text-sm text-slate-300">
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Keeper</div>
                  <div className="mt-1 font-mono text-xs text-slate-200">{keeper || "--"}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Treasury</div>
                  <div className="mt-1 font-mono text-xs text-slate-200">{treasury || "--"}</div>
                </div>
                <div className="text-xs text-slate-400">
                  Rebalances are executed by the keeper address. If a rebalance is skipped, it is retried later.
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4">
              <h2 className="font-display text-base font-semibold text-slate-100">Emergency / Safety</h2>
              <div className="mt-3 grid gap-2 text-sm text-slate-300">
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Emergency Status</div>
                  <div
                    className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      emergency
                        ? "border-rose-400/45 bg-rose-500/12 text-rose-100"
                        : "border-emerald-400/45 bg-emerald-500/12 text-emerald-100"
                    }`}
                  >
                    {emergency ? "Enabled" : "Inactive"}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Emergency Delay</div>
                  <div className="mt-1 text-slate-200">{formatDuration(emergencyDelay)}</div>
                </div>
                <div className="text-xs text-slate-400">
                  Emergency mode can restrict keeper operations and enable protective actions after the protocol delay.
                </div>
              </div>
            </div>
          </div>
        </div>

        <MyPositions
          address={address}
          onConnect={onConnect}
          loading={positionsLoading}
          positions={positions}
          strategyById={strategyById}
          onWithdraw={handleWithdraw}
          withdrawingPositionId={withdrawingPositionId}
          copiedValue={copiedValue}
          onCopy={copyValue}
        />

        <ActivityLog
          loading={activityLoading}
          items={activity}
          copiedValue={copiedValue}
          onCopy={copyValue}
          onRefresh={loadActivityLog}
        />
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
}: NftPositionLookupProps) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-slate-100">My V3 LP NFTs</h2>
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

      <p className="mt-2 text-xs text-slate-400">
        Primary flow: paste tokenId and fetch on-chain from NonfungiblePositionManager.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={lookupTokenId}
          onChange={(event) => onLookupTokenIdChange(event.target.value.replace(/[^\d]/gu, ""))}
          placeholder="Paste tokenId (e.g. 101)"
          className="w-full rounded-2xl border border-slate-700/80 bg-slate-900/60 px-4 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/70"
        />
        <button
          type="button"
          onClick={onLookup}
          disabled={lookupLoading}
          className="inline-flex items-center justify-center rounded-2xl border border-sky-300/55 bg-gradient-to-r from-sky-500/90 via-cyan-400/90 to-emerald-400/85 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {lookupLoading ? "Loading..." : "Fetch NFT"}
        </button>
      </div>

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
                  {!item.approvedToAlm && (
                    <span className="rounded-full border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 text-amber-100">
                      Not approved
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                <div>Owner: {item.owner}</div>
                <div>Liquidity: {item.liquidity.toString()}</div>
                <div>
                  Ticks: {item.tickLower} / {item.tickUpper}
                </div>
                <div>Current tick: {item.currentTick ?? "--"}</div>
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
}

export function StrategyList({
  loading,
  strategies,
  selectedStrategyId,
  onSelectStrategy,
}: StrategyListProps) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-slate-100">Strategies</h2>
        <div className="text-xs text-slate-500">{strategies.length} loaded</div>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Strategies are read on-chain from StrategyRegistry and rendered with risk-relevant parameters.
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
            No strategy returned by registry.
          </div>
        )}

        {strategies.map((strategy) => {
          const selected = selectedStrategyId === strategy.id;
          return (
            <button
              key={strategy.id}
              type="button"
              onClick={() => onSelectStrategy(strategy.id)}
              className={`w-full rounded-2xl border p-3 text-left transition ${
                selected
                  ? "border-cyan-300/70 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.22)]"
                  : "border-slate-800/80 bg-slate-900/45 hover:border-slate-600/80"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-display text-sm font-semibold text-slate-100">Strategy #{strategy.id}</div>
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
                    {strategy.route}
                  </span>
                </div>
              </div>

              <div className="mt-2 text-xs text-slate-300">{strategy.recommendedLabel}</div>

              <div className="mt-2 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                <div>Range width: ±{formatPercentFromBps(strategy.widthBps, 2)}</div>
                <div>Recenter trigger: ±{formatPercentFromBps(strategy.recenterBps, 2)}</div>
                <div>Cooldown: {formatDuration(strategy.minRebalanceInterval)}</div>
                <div>Swap enabled: {strategy.allowSwap ? "yes" : "no"}</div>
                <div>
                  Fee tiers: {" "}
                  {strategy.allowedFeeTiers.length
                    ? strategy.allowedFeeTiers.map((tier) => formatFeeTier(tier)).join(" / ")
                    : "none"}
                </div>
                <div>Swap slippage: ±{formatPercentFromBps(strategy.maxSwapSlippageBps, 2)}</div>
                <div>Mint slippage: ±{formatPercentFromBps(strategy.mintSlippageBps, 2)}</div>
                <div>minCardinality: {strategy.minCardinality || "--"}</div>
                <div>WETH hop fee: {strategy.wethHopFee ? formatFeeTier(strategy.wethHopFee) : "--"}</div>
                <div>Oracle params: {strategy.oracleParamsHex !== "0x" ? "present" : "empty"}</div>
              </div>
            </button>
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
  approveStatus,
  approveTxHash,
  depositStatus,
  depositTxHash,
  onApprove,
  onDeposit,
  onConnect,
  address,
}: DepositFlowProps) {
  const stepClass = (status: StatusState) => {
    if (status === "success") return "border-emerald-400/45 bg-emerald-500/10 text-emerald-100";
    if (status === "pending") return "border-sky-400/45 bg-sky-500/10 text-sky-100";
    if (status === "error") return "border-rose-400/45 bg-rose-500/10 text-rose-100";
    return "border-slate-700/70 bg-slate-900/60 text-slate-200";
  };

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-slate-100">Deposit Flow</h2>
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

      <div className="mt-3 space-y-2">
        <div className="rounded-2xl border border-slate-800/70 bg-slate-900/45 px-3 py-2 text-xs text-slate-300">
          Selected NFT: {selectedNft ? `#${selectedNft.tokenId}` : "--"} | Strategy:{" "}
          {selectedStrategy ? `#${selectedStrategy.id}` : "--"}
        </div>

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
        <div className={`rounded-2xl border px-3 py-3 ${stepClass(approveStatus)}`}>
          <div className="text-[11px] uppercase tracking-wide">1) Approve NFT</div>
          <button
            type="button"
            onClick={onApprove}
            disabled={!canApprove || approveStatus === "pending"}
            className="mt-2 w-full rounded-xl border border-current/30 bg-black/15 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {approveStatus === "pending"
              ? "Approving..."
              : approveStatus === "success"
              ? "Approved"
              : "Approve NFT"}
          </button>
          {approveTxHash && (
            <a
              href={`${EXPLORER_BASE_URL}/tx/${approveTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-[11px] text-slate-200 underline decoration-dotted underline-offset-2"
            >
              View tx
            </a>
          )}
        </div>

        <div className={`rounded-2xl border px-3 py-3 ${stepClass(depositStatus)}`}>
          <div className="text-[11px] uppercase tracking-wide">2) Deposit</div>
          <button
            type="button"
            onClick={onDeposit}
            disabled={!canDeposit || depositStatus === "pending"}
            className="mt-2 w-full rounded-xl border border-current/30 bg-black/15 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {depositStatus === "pending"
              ? "Depositing..."
              : depositStatus === "success"
              ? "Deposited"
              : "Deposit to ALM"}
          </button>
          {depositTxHash && (
            <a
              href={`${EXPLORER_BASE_URL}/tx/${depositTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-[11px] text-slate-200 underline decoration-dotted underline-offset-2"
            >
              View tx
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

interface MyPositionsProps {
  address?: string | null;
  onConnect?: () => void;
  loading: boolean;
  positions: AlmPositionRow[];
  strategyById: Map<number, StrategyConfig>;
  onWithdraw: (positionId: string) => void;
  withdrawingPositionId: string;
  copiedValue: string;
  onCopy: (value: string) => void;
}

export function MyPositions({
  address,
  onConnect,
  loading,
  positions,
  strategyById,
  onWithdraw,
  withdrawingPositionId,
  copiedValue,
  onCopy,
}: MyPositionsProps) {
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTs(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const getEstimate = (position: AlmPositionRow, strategy: StrategyConfig | null) => {
    if (!strategy || position.currentTick === null || position.centerTick === null) {
      return {
        label: "Next rebalance when price deviates by strategy threshold",
        status: "unknown",
      };
    }
    const tickDelta = Math.abs(position.currentTick - position.centerTick);
    const deltaPct = (Math.pow(1.0001, tickDelta) - 1) * 100;
    const triggerPct = strategy.recenterBps / 100;
    const needs = deltaPct >= triggerPct;
    return {
      label: `${needs ? "Needs rebalance" : "In range"} (${deltaPct.toFixed(3)}% vs ${triggerPct.toFixed(
        3
      )}% trigger)`,
      status: needs ? "needs" : "in-range",
    };
  };

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-slate-100">My ALM Positions</h2>
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

      <div className="mt-3 space-y-2">
        {loading && positions.length === 0 && (
          <>
            <div className="h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/45" />
            <div className="h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/45" />
          </>
        )}

        {!loading && positions.length === 0 && (
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/45 px-4 py-4 text-sm text-slate-400">
            No ALM positions found for this wallet.
          </div>
        )}

        {positions.map((position) => {
          const strategy = strategyById.get(position.strategyId) || null;
          const cooldownSeconds = Math.max(
            0,
            (position.lastRebalanceAt || 0) + (strategy?.minRebalanceInterval || 0) - nowTs
          );
          const estimate = getEstimate(position, strategy);

          return (
            <div
              key={position.positionId}
              className="rounded-2xl border border-slate-800/80 bg-slate-900/45 px-3 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-display text-sm font-semibold text-slate-100">
                  Position #{position.positionId}
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span
                    className={`rounded-full border px-2 py-0.5 ${
                      position.active
                        ? "border-emerald-400/45 bg-emerald-500/12 text-emerald-100"
                        : "border-slate-500/45 bg-slate-800/70 text-slate-200"
                    }`}
                  >
                    {position.active ? "Active" : "Inactive"}
                  </span>
                  <span className="rounded-full border border-slate-700/70 bg-slate-900/60 px-2 py-0.5 text-slate-200">
                    Strategy #{position.strategyId}
                  </span>
                </div>
              </div>

              <div className="mt-2 grid gap-2 text-xs text-slate-400 sm:grid-cols-2 lg:grid-cols-3">
                <div>Owner: {shortenAddress(position.owner, 8, 6)}</div>
                <div>Pair: {position.token0Symbol} / {position.token1Symbol}</div>
                <div>Fee: {formatFeeTier(position.fee)}</div>
                <div>Tick spacing: {position.tickSpacing || "--"}</div>
                <div>Current NFT: #{position.currentTokenId}</div>
                <div>Last rebalance: {formatDateTime(position.lastRebalanceAt)}</div>
                <div>Cooldown remaining: {formatDuration(cooldownSeconds)}</div>
                <div>Pool: {shortenAddress(position.pool, 8, 6)}</div>
                <div>
                  Token0: {position.token0Symbol} ({shortenAddress(position.token0, 8, 6)})
                </div>
                <div>
                  Token1: {position.token1Symbol} ({shortenAddress(position.token1, 8, 6)})
                </div>
                <div>
                  Status:{" "}
                  <span
                    className={
                      estimate.status === "needs"
                        ? "text-amber-200"
                        : estimate.status === "in-range"
                        ? "text-emerald-200"
                        : "text-slate-300"
                    }
                  >
                    {estimate.label}
                  </span>
                </div>
                <div>
                  Dust0 ({position.token0Symbol}): {formatDust(position.dust0, position.token0Decimals)}
                </div>
                <div>
                  Dust1 ({position.token1Symbol}): {formatDust(position.dust1, position.token1Decimals)}
                </div>
                <div>Pool tick: {position.currentTick ?? "--"}</div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onWithdraw(position.positionId)}
                  disabled={withdrawingPositionId === position.positionId}
                  className="rounded-xl border border-rose-400/45 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {withdrawingPositionId === position.positionId ? "Withdrawing..." : "Withdraw"}
                </button>
                <button
                  type="button"
                  onClick={() => onCopy(position.positionId)}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copiedValue === position.positionId ? "Copied" : "Copy positionId"}
                </button>
                <a
                  href={`${EXPLORER_BASE_URL}/address/${position.pool}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200"
                >
                  View pool
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ActivityLogProps {
  loading: boolean;
  items: ActivityItem[];
  copiedValue: string;
  onCopy: (value: string) => void;
  onRefresh: () => void;
}

export function ActivityLog({ loading, items, copiedValue, onCopy, onRefresh }: ActivityLogProps) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-slate-100">Activity / Logs</h2>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1 rounded-full border border-slate-700/70 bg-slate-900/70 px-3 py-1 text-xs text-slate-200 hover:border-slate-500"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-500">
              <th className="px-2 py-2 font-medium uppercase tracking-wide">Time</th>
              <th className="px-2 py-2 font-medium uppercase tracking-wide">Event</th>
              <th className="px-2 py-2 font-medium uppercase tracking-wide">Position</th>
              <th className="px-2 py-2 font-medium uppercase tracking-wide">Reason</th>
              <th className="px-2 py-2 font-medium uppercase tracking-wide">Tx</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <>
                <tr className="border-b border-slate-900">
                  <td className="px-2 py-3"><div className="h-4 w-28 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-24 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-20 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-32 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-24 animate-pulse rounded bg-slate-800/90" /></td>
                </tr>
                <tr>
                  <td className="px-2 py-3"><div className="h-4 w-28 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-24 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-20 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-32 animate-pulse rounded bg-slate-800/90" /></td>
                  <td className="px-2 py-3"><div className="h-4 w-24 animate-pulse rounded bg-slate-800/90" /></td>
                </tr>
              </>
            )}

            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-sm text-slate-400">
                  No activity yet.
                </td>
              </tr>
            )}

            {items.map((item) => (
              <tr key={item.id} className="border-b border-slate-900/70 text-slate-300">
                <td className="px-2 py-2">
                  <div>{formatDateTime(item.timestamp)}</div>
                  <div className="text-[11px] text-slate-500">Block {item.blockNumber}</div>
                </td>
                <td className="px-2 py-2">
                  <span className="rounded-full border border-slate-700/70 bg-slate-900/70 px-2 py-0.5 text-[11px]">
                    {item.eventType}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    onClick={() => onCopy(item.positionId)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700/70 bg-slate-900/70 px-2 py-0.5 text-[11px] hover:border-slate-500"
                  >
                    <Copy className="h-3 w-3" />
                    {copiedValue === item.positionId ? "Copied" : `#${item.positionId}`}
                  </button>
                </td>
                <td className="px-2 py-2 text-[11px] text-slate-400">{item.reason || "--"}</td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1">
                    <a
                      href={`${EXPLORER_BASE_URL}/tx/${item.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[11px] text-sky-200 underline decoration-dotted underline-offset-2"
                    >
                      {shortenAddress(item.txHash, 10, 8)}
                    </a>
                    <button
                      type="button"
                      onClick={() => onCopy(item.txHash)}
                      className="inline-flex items-center rounded-md border border-slate-700/70 bg-slate-900/70 p-1 text-slate-300 hover:border-slate-500"
                      aria-label="Copy tx hash"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

