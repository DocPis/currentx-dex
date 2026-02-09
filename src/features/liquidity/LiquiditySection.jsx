// src/features/liquidity/LiquiditySection.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Contract, Interface, JsonRpcProvider, formatUnits, parseUnits } from "ethers";
import {
  TOKENS,
  getProvider,
  getReadOnlyProvider,
  getV2PairReserves,
  rotateRpcProvider,
  WETH_ADDRESS,
  UNIV2_ROUTER_ADDRESS,
  UNIV2_FACTORY_ADDRESS,
  getRegisteredCustomTokens,
  setRegisteredCustomTokens,
  EXPLORER_BASE_URL,
  NETWORK_NAME,
  CHAINLINK_ETH_USD_FEED_ADDRESS,
  CHAINLINK_RPC_URL,
  BTCB_ADDRESS,
  SUSDE_ADDRESS,
  EZETH_ADDRESS,
  WSTETH_ADDRESS,
  STCUSD_ADDRESS,
  USDE_ADDRESS,
  UNIV3_FACTORY_ADDRESS,
  UNIV3_POSITION_MANAGER_ADDRESS,
} from "../../shared/config/web3";
import {
  ERC20_ABI,
  UNIV2_FACTORY_ABI,
  UNIV2_PAIR_ABI,
  UNIV2_ROUTER_ABI,
  UNIV3_FACTORY_ABI,
  UNIV3_POOL_ABI,
  UNIV3_POSITION_MANAGER_ABI,
  CHAINLINK_AGGREGATOR_ABI,
} from "../../shared/config/abis";
import {
  fetchV2PairData,
  fetchTokenPrices,
  fetchV3TokenTvls,
  fetchV3PoolHistory,
  fetchV3PoolHourStats,
  fetchV3PoolSnapshot,
  fetchV3TokenPairHistory,
} from "../../shared/config/subgraph";
import { getRealtimeClient, TRANSFER_TOPIC } from "../../shared/services/realtime";
import { getActiveNetworkConfig } from "../../shared/config/networks";
import { useBalances } from "../../shared/hooks/useBalances";
import { multicall, hasMulticall } from "../../shared/services/multicall";

const EXPLORER_LABEL = `${NETWORK_NAME} Explorer`;
const SYNC_TOPIC =
  "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";
const V3_MIN_TICK = -887272;
const V3_MAX_TICK = 887272;
const V3_FEE_OPTIONS = [
  { fee: 500, label: "0.05%" },
  { fee: 3000, label: "0.30%" },
  { fee: 10000, label: "1.00%" },
];
const V3_TICK_SPACING = {
  500: 10,
  3000: 60,
  10000: 200,
};
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TICK_BASE = 1.0001;
const CHART_PADDING = 0.12;
const V3_TVL_HISTORY_DAYS = 14;
const getV3RangeDays = (timeframe) => {
  switch (timeframe) {
    case "1D":
      return 2;
    case "1W":
      return 10;
    case "1M":
      return 40;
    case "1Y":
      return 370;
    case "All":
      return 730;
    default:
      return V3_TVL_HISTORY_DAYS;
  }
};

const LIQUIDITY_BLOCKED_SYMBOLS = new Set(["BTC.B", "BTCB", "SUSDE", "EZETH", "WSTETH", "STCUSD", "USDE"]);
const LIQUIDITY_BLOCKED_ADDRESSES = new Set(
  [BTCB_ADDRESS, SUSDE_ADDRESS, EZETH_ADDRESS, WSTETH_ADDRESS, STCUSD_ADDRESS, USDE_ADDRESS]
    .filter(Boolean)
    .map((addr) => addr.toLowerCase())
);

const isLiquiditySymbolBlocked = (symbol) => {
  const normalized = (symbol || "").toString().toUpperCase();
  return Boolean(normalized && LIQUIDITY_BLOCKED_SYMBOLS.has(normalized));
};

const isLiquidityTokenBlocked = (token) => {
  if (!token) return false;
  if (isLiquiditySymbolBlocked(token.symbol)) return true;
  const addr = (token.address || "").toLowerCase();
  return Boolean(addr && LIQUIDITY_BLOCKED_ADDRESSES.has(addr));
};

const isValidTokenAddress = (value) => /^0x[a-fA-F0-9]{40}$/.test((value || "").trim());

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

const isStableSymbol = (symbol) => {
  const normalized = (symbol || "").toString().toUpperCase();
  return Boolean(normalized && STABLE_SYMBOLS.has(normalized));
};

const filterLiquidityRegistry = (registry = {}) => {
  const out = {};
  Object.entries(registry).forEach(([sym, meta]) => {
    if (!meta) return;
    if (isLiquiditySymbolBlocked(sym) || isLiquidityTokenBlocked(meta)) return;
    out[sym] = meta;
  });
  return out;
};

const formatNumber = (v) => {
  const num = Number(v || 0);
  if (!Number.isFinite(num)) return "~$0.00";
  const abs = Math.abs(num);
  if (abs >= 1e14) return "~>999T";
  if (abs >= 1_000_000_000) return `~$${(num / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `~$${(num / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `~$${(num / 1_000).toFixed(2)}K`;
  if (abs >= 1) return `~$${num.toFixed(2)}`;
  if (abs > 0) return "~$0";
  return "~$0";
};

const formatTokenBalance = (v) => {
  const num = Number(v || 0);
  if (!Number.isFinite(num) || num <= 0) return "0";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
    useGrouping: false,
  });
};

const safeNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const topicToAddress = (topic) => {
  if (typeof topic !== "string") return "";
  if (!topic.startsWith("0x") || topic.length < 66) return "";
  return `0x${topic.slice(-40)}`.toLowerCase();
};

const toOptionalNumber = (value) => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const trimTrailingZeros = (value) => {
  if (typeof value !== "string" || !value.includes(".")) return value;
  return value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
};

const formatPrice = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "--";
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
  if (abs === 0) return "0";
  const tiny = trimTrailingZeros(num.toFixed(10));
  return tiny === "0" ? "<0.00000001" : tiny;
};

const clampPercent = (value) => Math.min(100, Math.max(0, value));
const getTickSpacingFromFee = (fee) => V3_TICK_SPACING[Number(fee)] || null;
const isAddressLike = (value) => /^0x[a-fA-F0-9]{40}$/.test(value || "");
const isEthLikeAddress = (addr) =>
  Boolean(
    WETH_ADDRESS &&
      addr &&
      addr.toLowerCase &&
      addr.toLowerCase() === WETH_ADDRESS.toLowerCase()
  );
const sortAddressPair = (a, b) => {
  const left = (a || "").toLowerCase();
  const right = (b || "").toLowerCase();
  if (!left || !right) return [a, b];
  return left < right ? [a, b] : [b, a];
};
const getChainlinkProvider = () =>
  CHAINLINK_RPC_URL ? new JsonRpcProvider(CHAINLINK_RPC_URL) : getReadOnlyProvider(false, true);
const CHAINLINK_BATCH_SIZE = 80;
const CHAINLINK_MAX_BATCHES = 16;
const CHAINLINK_SAMPLE_ROUNDS = 6;
const buildHistorySignature = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return "0";
  const first = rows[0] || {};
  const last = rows[rows.length - 1] || {};
  const pick = (row) =>
    [
      row?.date ?? 0,
      row?.token0Price ?? row?.token1Price ?? row?.priceUsd ?? row?.tvlUsd ?? 0,
    ].join(":");
  return `${rows.length}|${pick(first)}|${pick(last)}`;
};

const fetchChainlinkEthUsdHistory = async ({
  feed,
  days,
  provider,
  poolToken0IsEthLike,
}) => {
  if (!feed || !days || !provider) return [];
  const aggregator = new Contract(feed, CHAINLINK_AGGREGATOR_ABI, provider);
  let decimals = 8;
  try {
    decimals = Number(await aggregator.decimals());
  } catch {
    // keep default
  }
  let latest;
  try {
    latest = await aggregator.latestRoundData();
  } catch {
    return [];
  }
  const latestRoundId = latest?.roundId ?? null;
  const latestUpdatedAt = Number(latest?.updatedAt || 0);
  const latestAnswer = latest?.answer;
  if (!latestRoundId || !latestUpdatedAt || !latestAnswer) return [];

  const latestPrice = safeNumber(formatUnits(latestAnswer, decimals));
  if (!latestPrice || latestPrice <= 0) return [];

  const priceToRow = (tsSec, price) => {
    if (!Number.isFinite(tsSec) || tsSec <= 0) return null;
    if (!Number.isFinite(price) || price <= 0) return null;
    if (poolToken0IsEthLike) {
      return {
        date: tsSec * 1000,
        token0Price: 1 / price,
        token1Price: price,
      };
    }
    return {
      date: tsSec * 1000,
      token0Price: price,
      token1Price: 1 / price,
    };
  };

  const roundInterface = new Interface(CHAINLINK_AGGREGATOR_ABI);
  const batchFetch = async (roundIds) => {
    if (!roundIds.length) return [];
    const useMulticall = await hasMulticall(provider).catch(() => false);
    if (useMulticall) {
      const target = aggregator.target || aggregator.address;
      const calls = roundIds.map((id) => ({
        target,
        callData: roundInterface.encodeFunctionData("getRoundData", [id]),
      }));
      const res = await multicall(calls, provider);
      return res.map((item) => {
        if (!item.success) return null;
        try {
          const decoded = roundInterface.decodeFunctionResult(
            "getRoundData",
            item.returnData
          );
          return {
            roundId: decoded[0],
            answer: decoded[1],
            updatedAt: decoded[3],
          };
        } catch {
          return null;
        }
      });
    }
    const out = new Array(roundIds.length);
    await Promise.all(
      roundIds.map(async (id, idx) => {
        try {
          const data = await aggregator.getRoundData(id);
          out[idx] = data;
        } catch {
          out[idx] = null;
        }
      })
    );
    return out;
  };

  const sampleIds = [];
  let sampleRound = BigInt(latestRoundId);
  for (let i = 0; i < CHAINLINK_SAMPLE_ROUNDS; i += 1) {
    if (sampleRound <= 1n) break;
    sampleRound -= 1n;
    sampleIds.push(sampleRound);
  }
  const sampleData = await batchFetch(sampleIds);
  const sampleTimes = [latestUpdatedAt]
    .concat(
      sampleData
        .map((row) => Number(row?.updatedAt || 0))
        .filter((ts) => Number.isFinite(ts) && ts > 0)
    )
    .sort((a, b) => b - a);
  let avgInterval = 3600;
  if (sampleTimes.length >= 2) {
    const diffs = [];
    for (let i = 0; i < sampleTimes.length - 1; i += 1) {
      const delta = sampleTimes[i] - sampleTimes[i + 1];
      if (Number.isFinite(delta) && delta > 0) diffs.push(delta);
    }
    if (diffs.length) {
      avgInterval = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    }
  }
  const roundsPerDay = Math.max(1, Math.round(86400 / avgInterval));
  const step = Math.max(1, Math.round(roundsPerDay));
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const pointsByDay = new Map();
  const latestRow = priceToRow(latestUpdatedAt, latestPrice);
  if (latestRow) {
    pointsByDay.set(Math.floor(latestUpdatedAt / 86400), latestRow);
  }

  let cursor = BigInt(latestRoundId) - BigInt(step);
  for (let batch = 0; batch < CHAINLINK_MAX_BATCHES && cursor > 0n; batch += 1) {
    const ids = [];
    for (let i = 0; i < CHAINLINK_BATCH_SIZE && cursor > 0n; i += 1) {
      ids.push(cursor);
      cursor -= BigInt(step);
    }
    const rows = await batchFetch(ids);
    let oldestTs = null;
    rows.forEach((row) => {
      if (!row) return;
      const updatedAt = Number(row.updatedAt || 0);
      if (!Number.isFinite(updatedAt) || updatedAt <= 0) return;
      const answer = row.answer;
      const price = safeNumber(formatUnits(answer, decimals));
      const point = priceToRow(updatedAt, price);
      if (point) {
        const dayId = Math.floor(updatedAt / 86400);
        if (!pointsByDay.has(dayId)) {
          pointsByDay.set(dayId, point);
        }
      }
      oldestTs = oldestTs === null ? updatedAt : Math.min(oldestTs, updatedAt);
    });
    if (oldestTs && oldestTs < cutoff && pointsByDay.size >= days) {
      break;
    }
  }

  return Array.from(pointsByDay.values())
    .filter((row) => Number.isFinite(row.date))
    .sort((a, b) => a.date - b.date);
};

const normalizeIpfsUri = (uri, gateway = IPFS_GATEWAYS[0]) => {
  if (!uri || typeof uri !== "string") return "";
  if (uri.startsWith("ipfs://")) {
    const trimmed = uri.replace("ipfs://", "");
    const clean = trimmed.startsWith("ipfs/") ? trimmed.slice(5) : trimmed;
    return `${gateway}${clean}`;
  }
  return uri;
};

const buildIpfsCandidates = (uri) => {
  if (!uri || typeof uri !== "string") return [];
  if (!uri.startsWith("ipfs://")) return [uri];
  const trimmed = uri.replace("ipfs://", "");
  const clean = trimmed.startsWith("ipfs/") ? trimmed.slice(5) : trimmed;
  return IPFS_GATEWAYS.map((gateway) => `${gateway}${clean}`);
};

const decodeBase64ToUtf8 = (b64) => {
  if (!b64) return "";
  const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = normalized + (pad ? "=".repeat(4 - pad) : "");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder().decode(bytes);
  }
  return decodeURIComponent(escape(binary));
};

const parseTokenUri = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  try {
    if (raw.startsWith("data:application/json")) {
      const [, data] = raw.split(",");
      if (raw.includes("base64")) {
        const json = decodeBase64ToUtf8(data || "");
        return JSON.parse(json);
      }
      const json = decodeURIComponent(data || "");
      return JSON.parse(json);
    }
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      return JSON.parse(trimmed);
    }
    // Some contracts return raw base64 JSON without a data: prefix.
    const base64Candidate = trimmed.replace(/\s/g, "");
    if (/^[A-Za-z0-9+/=_-]+$/.test(base64Candidate) && base64Candidate.length > 32) {
      try {
        const decoded = decodeBase64ToUtf8(base64Candidate);
        if (decoded.trim().startsWith("{")) {
          return JSON.parse(decoded);
        }
      } catch {
        // ignore base64 decode errors
      }
    }
    return null;
  } catch {
    return null;
  }
};

const resolveImageFromMeta = (meta) => {
  if (!meta || typeof meta !== "object") return "";
  let img =
    meta.image ||
    meta.image_url ||
    meta.imageUri ||
    meta.imageURI ||
    "";
  if (typeof img === "string" && img.trim().startsWith("<svg")) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(img)}`;
  }
  if (typeof img === "string") {
    const trimmed = img.trim();
    if (/^[A-Za-z0-9+/=_-]+$/.test(trimmed) && trimmed.length > 32) {
      try {
        const decoded = decodeBase64ToUtf8(trimmed);
        if (decoded.trim().startsWith("<svg")) {
          return `data:image/svg+xml;utf8,${encodeURIComponent(decoded)}`;
        }
      } catch {
        // ignore decode errors
      }
    }
  }
  if (!img && meta.image_data) {
    const raw = String(meta.image_data || "");
    if (raw.startsWith("data:image")) {
      img = raw;
    } else if (raw.trim().startsWith("<svg")) {
      img = `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`;
    } else {
      img = raw;
    }
  }
  return normalizeIpfsUri(img);
};

const guessImageUri = (raw) => {
  if (!raw || typeof raw !== "string") return "";
  if (raw.startsWith("data:image")) return raw;
  if (raw.startsWith("ipfs://")) return normalizeIpfsUri(raw);
  const lower = raw.toLowerCase();
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".svg") || lower.endsWith(".webp")) {
    return raw;
  }
  return "";
};

const withTimeout = (promise, ms, label = "Request") =>
  new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(id);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(id);
        reject(err);
      });
  });

const formatPositionTitle = (pos, isFullRange) => {
  if (!pos) return "CurrentX Position";
  return `CurrentX - ${formatFeeTier(pos.fee)} - ${pos.token0Symbol}/${pos.token1Symbol}${
    isFullRange ? " - MIN<>MAX" : ""
  }`;
};

const formatAmount = (value, decimals = 18) => {
  try {
    const num = Number(formatUnits(value || 0n, decimals));
    if (!Number.isFinite(num) || num <= 0) return "0";
    if (num >= 1) return num.toLocaleString("en-US", { maximumFractionDigits: 4 });
    return formatAutoAmount(num);
  } catch {
    return "0";
  }
};

const sqrtBigInt = (value) => {
  if (value < 0n) return 0n;
  if (value < 2n) return value;
  let x0 = value / 2n;
  let x1 = (x0 + value / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
};

const Q96 = 2n ** 96n;
const PRICE_SCALE = 10n ** 18n;

const encodePriceSqrt = (amount1, amount0) => {
  if (!amount0 || !amount1 || amount0 <= 0n || amount1 <= 0n) return null;
  const ratio = (amount1 << 192n) / amount0;
  return sqrtBigInt(ratio);
};

const invertPriceScaled = (priceScaled) => {
  if (!priceScaled || priceScaled <= 0n) return null;
  return (PRICE_SCALE * PRICE_SCALE) / priceScaled;
};

const encodePriceSqrtFromPrice = (priceScaled, decimals0, decimals1) => {
  if (!priceScaled || priceScaled <= 0n) return null;
  const base0 = 10n ** BigInt(decimals0 ?? 18);
  const base1 = 10n ** BigInt(decimals1 ?? 18);
  const ratioX192 = ((priceScaled * base1) << 192n) / (base0 * PRICE_SCALE);
  return sqrtBigInt(ratioX192);
};

const tickToSqrtPriceX96 = (tick) => {
  if (!Number.isFinite(tick)) return null;
  const ratio = Math.pow(1.0001, Number(tick));
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const sqrt = Math.sqrt(ratio);
  if (!Number.isFinite(sqrt) || sqrt <= 0) return null;
  const scaled = sqrt * Number(Q96);
  if (!Number.isFinite(scaled) || scaled <= 0) return null;
  return BigInt(Math.floor(scaled));
};

const getAmountsForLiquidity = (sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, liquidity) => {
  if (
    !sqrtPriceX96 ||
    !sqrtPriceAX96 ||
    !sqrtPriceBX96 ||
    !liquidity ||
    liquidity <= 0n
  ) {
    return null;
  }
  let sqrtA = sqrtPriceAX96;
  let sqrtB = sqrtPriceBX96;
  if (sqrtA > sqrtB) {
    [sqrtA, sqrtB] = [sqrtB, sqrtA];
  }
  if (sqrtPriceX96 <= sqrtA) {
    const amount0 = (liquidity * (sqrtB - sqrtA) * Q96) / (sqrtB * sqrtA);
    return { amount0, amount1: 0n };
  }
  if (sqrtPriceX96 < sqrtB) {
    const amount0 = (liquidity * (sqrtB - sqrtPriceX96) * Q96) / (sqrtB * sqrtPriceX96);
    const amount1 = (liquidity * (sqrtPriceX96 - sqrtA)) / Q96;
    return { amount0, amount1 };
  }
  const amount1 = (liquidity * (sqrtB - sqrtA)) / Q96;
  return { amount0: 0n, amount1 };
};

const getLiquidityForAmount0 = (sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, amount0) => {
  if (
    !sqrtPriceX96 ||
    !sqrtPriceAX96 ||
    !sqrtPriceBX96 ||
    !amount0 ||
    amount0 <= 0n
  ) {
    return 0n;
  }
  let sqrtA = sqrtPriceAX96;
  let sqrtB = sqrtPriceBX96;
  if (sqrtA > sqrtB) {
    [sqrtA, sqrtB] = [sqrtB, sqrtA];
  }
  if (sqrtPriceX96 <= sqrtA) {
    return (amount0 * sqrtA * sqrtB) / ((sqrtB - sqrtA) * Q96);
  }
  if (sqrtPriceX96 < sqrtB) {
    return (amount0 * sqrtPriceX96 * sqrtB) / ((sqrtB - sqrtPriceX96) * Q96);
  }
  return 0n;
};

const getLiquidityForAmount1 = (sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, amount1) => {
  if (
    !sqrtPriceX96 ||
    !sqrtPriceAX96 ||
    !sqrtPriceBX96 ||
    !amount1 ||
    amount1 <= 0n
  ) {
    return 0n;
  }
  let sqrtA = sqrtPriceAX96;
  let sqrtB = sqrtPriceBX96;
  if (sqrtA > sqrtB) {
    [sqrtA, sqrtB] = [sqrtB, sqrtA];
  }
  if (sqrtPriceX96 >= sqrtB) {
    return (amount1 * Q96) / (sqrtB - sqrtA);
  }
  if (sqrtPriceX96 > sqrtA) {
    return (amount1 * Q96) / (sqrtPriceX96 - sqrtA);
  }
  return 0n;
};

const tickToPrice = (tick, decimals0, decimals1) => {
  if (tick === null || tick === undefined) return null;
  const base = Math.exp(Number(tick) * Math.log(TICK_BASE));
  const scale = Math.pow(10, (decimals0 || 18) - (decimals1 || 18));
  const price = base * scale;
  return Number.isFinite(price) ? price : null;
};

const priceToTick = (price, decimals0, decimals1) => {
  if (!price || !Number.isFinite(price) || price <= 0) return null;
  const scale = Math.pow(10, (decimals0 || 18) - (decimals1 || 18));
  const raw = Math.log(price / scale) / Math.log(TICK_BASE);
  return Number.isFinite(raw) ? raw : null;
};

const resolveTokenAddress = (symbol, registry = TOKENS) => {
  if (!symbol) return null;
  if (symbol === "ETH") return WETH_ADDRESS;
  const token = registry[symbol];
  return token?.address || null;
};

const getPoolLabel = (pool) =>
  pool ? `${pool.token0Symbol} / ${pool.token1Symbol}` : "";
const MIN_LP_THRESHOLD = 1e-12;
const TOAST_DURATION_MS = 20000;
const MAX_BPS = 5000; // 50%
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;

// Simple concurrency limiter to speed up parallel RPC/subgraph calls without overloading endpoints.
const runWithConcurrency = async (items, limit, worker) => {
  if (!Array.isArray(items) || !items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
};

const pickHistoryPrice = (row) => {
  const p0 = toOptionalNumber(row?.token0Price);
  const p1 = toOptionalNumber(row?.token1Price);
  if (p0 && p0 > 0) return p0;
  if (p1 && p1 > 0) return p1;
  return null;
};

const isFlatHistory = (rows, minPoints = 3) => {
  const values = (rows || [])
    .map((row) => pickHistoryPrice(row))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length < minPoints) return true;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0) return true;
  return (max - min) / min < 0.001;
};

const formatUsdPrice = (v) => {
  const num = Number(v);
  if (!Number.isFinite(num) || num <= 0) return "--";
  if (num >= 1e6) return `~$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1_000) return `~$${num.toFixed(0)}`;
  if (num >= 1) return `$${trimTrailingZeros(num.toFixed(2))}`;
  if (num >= 0.01) return `$${trimTrailingZeros(num.toFixed(4))}`;
  return `$${num.toFixed(6)}`;
};

const formatUsdValue = (v) => {
  const num = Number(v);
  if (!Number.isFinite(num)) return "--";
  if (num <= 0) return "$0.00";
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1_000) return `$${num.toFixed(0)}`;
  if (num >= 1) return `$${trimTrailingZeros(num.toFixed(2))}`;
  if (num >= 0.01) return `$${trimTrailingZeros(num.toFixed(4))}`;
  return `$${num.toFixed(6)}`;
};

const formatShortDate = (value) => {
  try {
    const date = new Date(value);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
    });
  } catch {
    return "--";
  }
};

const buildSeriesChart = (series, padRatio = 0.1) => {
  const cleaned = (series || []).filter(
    (row) =>
      Number.isFinite(row?.date) &&
      row.date > 0 &&
      Number.isFinite(row?.value)
  );
  if (!cleaned.length) return null;

  let pointsSeries = cleaned;
  if (pointsSeries.length === 1) {
    pointsSeries = [
      pointsSeries[0],
      { ...pointsSeries[0], date: pointsSeries[0].date + 60 * 60 * 1000 },
    ];
  }

  const values = pointsSeries.map((row) => row.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(1, Math.abs(max));
  const pad = span * padRatio;
  const minY = min - pad;
  const maxY = max + pad;
  const points = pointsSeries.map((row, idx) => {
    const x =
      pointsSeries.length === 1 ? 0 : (idx / (pointsSeries.length - 1)) * 100;
    const y = 100 - ((row.value - minY) / (maxY - minY)) * 100;
    return { ...row, x, y };
  });
  const line = points
    .map((point, idx) => `${idx === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const area = `${line} L 100 100 L 0 100 Z`;
  const latest = pointsSeries[pointsSeries.length - 1]?.value ?? null;
  const prev = pointsSeries.length > 1 ? pointsSeries[pointsSeries.length - 2]?.value : null;
  const changePct =
    prev !== null && Number.isFinite(prev) && prev > 0 && latest !== null
      ? ((latest - prev) / prev) * 100
      : null;
  return {
    points,
    line,
    area,
    latest,
    changePct,
  };
};

const mergeSeriesSnapshot = (series, snapshot) => {
  if (snapshot === null || snapshot === undefined) return series;
  const now = Date.now();
  if (!series.length) return [{ date: now, value: snapshot }];
  const last = series[series.length - 1];
  if (now >= last.date) {
    return [...series.slice(0, -1), { ...last, date: now, value: snapshot }];
  }
  const merged = [...series, { date: now, value: snapshot }];
  merged.sort((a, b) => a.date - b.date);
  return merged;
};

const formatAutoAmount = (value, maxDecimals = null) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  if (num === 0) return "0";
  const abs = Math.abs(num);
  let decimals = 6;
  if (abs < 0.0001) decimals = 10;
  else if (abs < 0.01) decimals = 8;
  if (Number.isFinite(maxDecimals)) {
    decimals = Math.min(decimals, Math.max(0, maxDecimals));
  }
  return trimTrailingZeros(num.toFixed(decimals));
};

const formatAmountFromRaw = (raw, decimals) => {
  try {
    const num = Number(formatUnits(raw ?? 0n, decimals ?? 18));
    return formatAutoAmount(num, decimals ?? 18);
  } catch {
    return "";
  }
};

const safeLower = (v) => (typeof v === "string" ? v.toLowerCase() : "");

const safeParseUnits = (value, decimals) => {
  try {
    return parseUnits(value, decimals);
  } catch {
    return null;
  }
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
const applyMaxBuffer = (value, decimals) => {
  if (!Number.isFinite(value)) return 0;
  const dec = Number.isFinite(decimals) ? Math.max(0, decimals) : 18;
  const step = Math.pow(10, -Math.min(6, dec));
  const buffered = value - step;
  if (buffered > 0) return buffered;
  return Math.max(0, value);
};

const requireDecimals = (meta, symbol) => {
  const dec = meta?.decimals;
  if (dec === undefined || dec === null || Number.isNaN(dec)) {
    throw new Error(`Missing decimals for ${symbol}. Reload tokens or re-add with decimals.`);
  }
  return dec;
};

const derivePoolActivity = (pool, stats = {}) => {
  if (pool?.active === true) return true;
  if (pool?.active === false) return false;
  const hasPair = Boolean(stats.pairAddress || stats.pairId);
  const hasLiquidity =
    Number(stats.tvlUsd || 0) > 0 ||
    Number(stats.volume24hUsd || 0) > 0 ||
    Number(stats.fees24hUsd || 0) > 0;
  const hasEmissions = stats.emissionApr !== undefined;
  return hasPair || hasLiquidity || hasEmissions;
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

const friendlyActionError = (e, actionLabel = "Action") => {
  const raw =
    e?.reason ||
    e?.info?.error?.message ||
    e?.message ||
    e?.error?.message ||
    "";
  const rawStr = typeof raw === "string" ? raw : String(raw || "");
  const lower = rawStr.toLowerCase();
  if (
    lower.includes("insufficient liquidity") ||
    lower.includes("liquidity minted") ||
    lower.includes("liquidity burned")
  ) {
    return `${actionLabel} failed: not enough pool liquidity or pool not initialized yet. Try smaller amounts or create/fund the pool first.`;
  }
  if (
    lower.includes("insufficient_a_amount") ||
    lower.includes("insufficient_b_amount") ||
    lower.includes("amountmin") ||
    lower.includes("excessive_input_amount")
  ) {
    return `${actionLabel} failed because min amounts were not met. Increase slippage or reduce size and retry.`;
  }
  if (
    lower.includes("allowance") ||
    lower.includes("transfer amount exceeds allowance") ||
    lower.includes("transfer_from_failed") ||
    lower.includes("transfer helper")
  ) {
    return `${actionLabel} failed: insufficient allowance. Re-approve the tokens and try again.`;
  }
  if (lower.includes("missing revert data") || lower.includes("estimategas")) {
    return `${actionLabel} simulation failed. Try a smaller amount, refresh balances, or wait for liquidity.`;
  }
  if (lower.includes("nonce too low") || lower.includes("already known")) {
    return (
      `${actionLabel} was already submitted from your wallet (nonce too low). ` +
      "Check wallet activity or the explorer; if confirmed, refresh. If stuck, speed up/cancel and retry."
    );
  }
  if (lower.includes("user denied") || lower.includes("rejected")) {
    return `${actionLabel} was rejected in your wallet. Please approve to continue.`;
  }
  if (
    lower.includes("bignumberish") ||
    lower.includes("invalid argument") ||
    lower.includes("value null")
  ) {
    return `${actionLabel} failed: amount not readable by RPC. Re-enter amounts (use dot for decimals) or switch RPC and retry.`;
  }
  if (lower.includes("internal json-rpc error")) {
    return `${actionLabel} failed due to RPC error. Switch RPC in wallet or retry.`;
  }
  return compactRpcMessage(
    rawStr,
    `${actionLabel} could not be completed. Please retry.`
  );
};

const shortenAddress = (addr) => {
  if (!addr) return "Native asset";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
};

const formatFeeTier = (fee) => {
  const num = Number(fee || 0);
  if (!Number.isFinite(num)) return "--";
  return `${(num / 10000).toFixed(2)}%`;
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

const clampBps = (input) => {
  const num = Number(input);
  if (Number.isNaN(num) || num < 0) return 50;
  return Math.min(MAX_BPS, Math.round(num * 100));
};

const applySlippage = (amountBigInt, bps) => {
  if (!amountBigInt || amountBigInt <= 0n) return 0n;
  const safeBps = clampBps(bps);
  return (amountBigInt * BigInt(10000 - safeBps)) / 10000n;
};

const fetchAllowances = async (provider, owner, spender, tokenAddresses = []) => {
  const iface = new Interface(ERC20_ABI);
  const uniques = Array.from(
    new Set((tokenAddresses || []).filter(Boolean).map((a) => a.toLowerCase()))
  );
  const out = {};
  if (!uniques.length) return out;
  let mcProvider = provider;
  let canMc = await hasMulticall(mcProvider).catch(() => false);
  if (!canMc) {
    const alt = getReadOnlyProvider(true, true);
    if (alt) {
      mcProvider = alt;
      canMc = await hasMulticall(mcProvider).catch(() => false);
    }
  }
  if (canMc) {
    try {
      const calls = uniques.map((addr) => ({
        target: addr,
        callData: iface.encodeFunctionData("allowance", [owner, spender]),
      }));
      let res = await multicall(calls, mcProvider);
      if (!res || !Array.isArray(res)) throw new Error("multicall empty");
      res.forEach((r, idx) => {
        const addr = uniques[idx];
        if (!r.success) return;
        try {
          const decoded = iface.decodeFunctionResult("allowance", r.returnData)[0];
          out[addr] = decoded;
        } catch {
          /* ignore decode errors */
        }
      });
    } catch {
      // Retry once with rotated RPC before falling back to per-token queries
      try {
        const alt = getReadOnlyProvider(true, true);
        if (alt) {
          mcProvider = alt;
          const ok = await hasMulticall(mcProvider).catch(() => false);
          if (ok) {
            const calls = uniques.map((addr) => ({
              target: addr,
              callData: iface.encodeFunctionData("allowance", [owner, spender]),
            }));
            const res = await multicall(calls, mcProvider);
            res.forEach((r, idx) => {
              const addr = uniques[idx];
              if (!r.success) return;
              try {
                const decoded = iface.decodeFunctionResult("allowance", r.returnData)[0];
                out[addr] = decoded;
              } catch {
                /* ignore decode errors */
              }
            });
          }
        }
      } catch {
        // final fallback handled below
      }
    }
  }
  const missing = uniques.filter((a) => out[a] === undefined);
  if (missing.length) {
    await Promise.all(
      missing.map(async (addr) => {
        try {
          const c = new Contract(addr, ERC20_ABI, provider);
          out[addr] = await c.allowance(owner, spender);
        } catch {
          out[addr] = 0n;
        }
      })
    );
  }
  return out;
};

export default function LiquiditySection({
  address,
  chainId,
  balances: balancesProp,
  onBalancesRefresh,
  poolSelection,
  showV2 = true,
  showV3 = false,
}) {
  const queryClient = useQueryClient();
  const [basePools, setBasePools] = useState([]);
  const [onchainTokens, setOnchainTokens] = useState({});
  const [customTokens, setCustomTokens] = useState(() => getRegisteredCustomTokens());
  const [tokenPrices, setTokenPrices] = useState({});
  const [v3TokenTvls, setV3TokenTvls] = useState({});
  const [tvlError, setTvlError] = useState("");
  const [subgraphError, setSubgraphError] = useState("");
  const [poolStats, setPoolStats] = useState({});
  const [poolStatsReady, setPoolStatsReady] = useState(false);
  const [selectedPoolId, setSelectedPoolId] = useState(null);
  const [pairInfo, setPairInfo] = useState(null);
  const [pairError, setPairError] = useState("");
  const [pairNotDeployed, setPairNotDeployed] = useState(false);
  const [depositToken0, setDepositToken0] = useState("");
  const [depositToken1, setDepositToken1] = useState("");
  const [withdrawLp, setWithdrawLp] = useState("");
  const [v3Token0, setV3Token0] = useState("ETH");
  const [v3Token1, setV3Token1] = useState("USDm");
  const [v3FeeTier, setV3FeeTier] = useState(3000);
  const [v3Amount0, setV3Amount0] = useState("");
  const [v3Amount1, setV3Amount1] = useState("");
  const [v3MintUseEth0, setV3MintUseEth0] = useState(false);
  const [v3MintUseEth1, setV3MintUseEth1] = useState(false);
  const [v3RangeMode, setV3RangeMode] = useState("full");
  const [v3RangeLower, setV3RangeLower] = useState("");
  const [v3RangeUpper, setV3RangeUpper] = useState("");
  const [v3StartPrice, setV3StartPrice] = useState("");
  const [v3PoolInfo, setV3PoolInfo] = useState({
    address: "",
    token0: "",
    token1: "",
    tick: null,
    sqrtPriceX96: null,
    spacing: null,
  });
  const [v3PoolLoading, setV3PoolLoading] = useState(false);
  const [v3PoolError, setV3PoolError] = useState("");
  const [v3PoolMetrics, setV3PoolMetrics] = useState({});
  const [v3PoolTvlHistory, setV3PoolTvlHistory] = useState([]);
  const [v3TokenPriceHistory, setV3TokenPriceHistory] = useState([]);
  const [v3TokenPriceKey, setV3TokenPriceKey] = useState("");
  const v3TokenPriceCacheRef = useRef({
    key: "",
    sig: "0",
    len: 0,
    history: [],
  });
  const [v3CachedPrice, setV3CachedPrice] = useState(null);
  const [v3PoolTvlSnapshot, setV3PoolTvlSnapshot] = useState(null);
  const [v3PoolTvlLoading, setV3PoolTvlLoading] = useState(false);
  const [v3PoolTvlError, setV3PoolTvlError] = useState("");
  const [v3PoolHourStats, setV3PoolHourStats] = useState(null);
  const [v3PoolBalances, setV3PoolBalances] = useState({
    token0: null,
    token1: null,
  });
  const [v3PoolBalanceTick, setV3PoolBalanceTick] = useState(0);
  const [v3TvlRefreshTick, setV3TvlRefreshTick] = useState(0);
  const [v3MintError, setV3MintError] = useState("");
  const [v3MintLoading, setV3MintLoading] = useState(false);
  const [v3Positions, setV3Positions] = useState([]);
  const [v3PositionsLoading, setV3PositionsLoading] = useState(false);
  const [v3PositionsError, setV3PositionsError] = useState("");
  const [v3ShowClosedPositions, setV3ShowClosedPositions] = useState(false);
  const [v3AddMenuOpen, setV3AddMenuOpen] = useState(false);
  const [v3PositionMenuOpen, setV3PositionMenuOpen] = useState(false);
  const [v3PositionListMenuOpenId, setV3PositionListMenuOpenId] = useState(null);
  const [v3CopiedAddress, setV3CopiedAddress] = useState("");
  const [v2PositionMenuOpenId, setV2PositionMenuOpenId] = useState(null);
  const [v2DepositMenuOpen, setV2DepositMenuOpen] = useState(false);
  const [v3ActionModal, setV3ActionModal] = useState({
    open: false,
    type: null,
    position: null,
  });
  const [v3ActionAmount0, setV3ActionAmount0] = useState("");
  const [v3ActionAmount1, setV3ActionAmount1] = useState("");
  const [v3RemovePct, setV3RemovePct] = useState("100");
  const [v3ActionLoading, setV3ActionLoading] = useState(false);
  const [v3ActionError, setV3ActionError] = useState("");
  const [v3ActionLastEdited, setV3ActionLastEdited] = useState(null);
  const [v3ActionUseEth0, setV3ActionUseEth0] = useState(false);
  const [v3ActionUseEth1, setV3ActionUseEth1] = useState(false);
  const [selectedPositionId, setSelectedPositionId] = useState(null);
  const [liquidityView, setLiquidityView] = useState(() => {
    if (showV3 && !showV2) return "v3";
    return "v2";
  });
  const [nftMetaById, setNftMetaById] = useState({});
  const [nftMetaRefreshTick] = useState(0);
  const [showNftDebug, setShowNftDebug] = useState(false);
  const [v3RefreshTick, setV3RefreshTick] = useState(0);
  const [lpBalanceRaw, setLpBalanceRaw] = useState(null);
  const [lpDecimalsState, setLpDecimalsState] = useState(18);
  const DEFAULT_SLIPPAGE = "0.5";
  const [slippageInput, setSlippageInput] = useState(DEFAULT_SLIPPAGE);
  const [slippageMode, setSlippageMode] = useState("auto");
  const [slippageMenuOpen, setSlippageMenuOpen] = useState(false);
  const [actionStatus, setActionStatus] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [depositQuoteError, setDepositQuoteError] = useState("");
  const [lastEdited, setLastEdited] = useState("");
  const [lpBalance, setLpBalance] = useState(null);
  const [lpBalanceError, setLpBalanceError] = useState("");
  const [lpRefreshTick, setLpRefreshTick] = useState(0);
  const [pairLiveTick, setPairLiveTick] = useState(0);
  const livePairThrottle = useRef(0);
  const v3PoolLiveThrottle = useRef(0);
  const [tokenBalances, setTokenBalances] = useState(null);
  const [tokenBalanceError, setTokenBalanceError] = useState("");
  const [tokenBalanceLoading, setTokenBalanceLoading] = useState(false);
  const [showTokenList, setShowTokenList] = useState(false);
  const [tokenSearch, setTokenSearch] = useState("");
  const [tokenSelection, setTokenSelection] = useState(null); // { baseSymbol, pairSymbol }
  const [pairSelectorOpen, setPairSelectorOpen] = useState(false);
  const [v3Token0Open, setV3Token0Open] = useState(false);
  const [v3Token1Open, setV3Token1Open] = useState(false);
  const [v3Token0Search, setV3Token0Search] = useState("");
  const [v3Token1Search, setV3Token1Search] = useState("");
  const [selectionDepositPoolId, setSelectionDepositPoolId] = useState(null);
  const [v3DraggingHandle, setV3DraggingHandle] = useState(null);
  const [v3RangeInitialized, setV3RangeInitialized] = useState(false);
  const [v3ChartMode, setV3ChartMode] = useState("price-range");
  const [v3ChartMenuOpen, setV3ChartMenuOpen] = useState(false);
  const [v3ChartHover, setV3ChartHover] = useState(null);
  const [v3RangeTimeframe, setV3RangeTimeframe] = useState("1M");
  const v3RangeDays = useMemo(() => getV3RangeDays(v3RangeTimeframe), [v3RangeTimeframe]);
  const [v3StrategyId, setV3StrategyId] = useState("");
  const [customTokenAddError, setCustomTokenAddError] = useState("");
  const [customTokenAddLoading, setCustomTokenAddLoading] = useState(false);
  const [searchTokenMeta, setSearchTokenMeta] = useState(null);
  const [searchTokenMetaLoading, setSearchTokenMetaLoading] = useState(false);
  const [searchTokenMetaError, setSearchTokenMetaError] = useState("");
  const [v2LpPositions, setV2LpPositions] = useState([]);
  const [v2LpLoading, setV2LpLoading] = useState(false);
  const [v2LpError, setV2LpError] = useState("");
  const toastTimerRef = useRef(null);
  const lastPoolSelectionRef = useRef(null);
  const suppressSelectionResetRef = useRef(false);
  const v3PositionMenuRef = useRef(null);
  const v3CopyTimerRef = useRef(null);
  const v2DepositMenuRef = useRef(null);
  const nftMetaRef = useRef({});
  const v3Token0DropdownRef = useRef(null);
  const v3Token1DropdownRef = useRef(null);
  const v3RangeTrackRef = useRef(null);
  const v3DragRafRef = useRef(null);
  const v3DragTargetRef = useRef(null);
  const v3DragCurrentRef = useRef({ lower: null, upper: null });
  const v3DragValueRef = useRef({ lower: "", upper: "" });
  const v3DragTimeRef = useRef(null);
  const v3DragDirtyRef = useRef(false);
  const v3RangeLowerRef = useRef(null);
  const v3RangeUpperRef = useRef(null);
  const v3ChartRef = useRef(null);
  const v3ChartMenuRef = useRef(null);
  const v3HoverIndexRef = useRef({ source: null, idx: null });
  const v3AddMenuRef = useRef(null);
  const slippageMenuRef = useRef(null);
  const tokenRegistry = useMemo(() => {
    // Always include native ETH/WETH for convenience.
    const out = { ETH: TOKENS.ETH, WETH: TOKENS.WETH };

    // Include tokens discovered on-chain for the active network.
    Object.entries(onchainTokens).forEach(([sym, meta]) => {
      if (isLiquiditySymbolBlocked(sym) || isLiquidityTokenBlocked(meta)) return;
      out[sym] = meta;
    });

    // Include any statically defined token that has an address for the active network.
    Object.entries(TOKENS).forEach(([sym, meta]) => {
      if (sym === "ETH" || sym === "WETH") return;
      if (!meta?.address) return;
      if (isLiquiditySymbolBlocked(sym) || isLiquidityTokenBlocked(meta)) return;
      out[sym] = meta;
    });

    // Include user-added custom tokens.
    Object.entries(customTokens).forEach(([sym, meta]) => {
      if (isLiquiditySymbolBlocked(sym) || isLiquidityTokenBlocked(meta)) return;
      out[sym] = meta;
    });

    return out;
  }, [customTokens, onchainTokens]);
  const tokenDecimalsCache = useRef({});
  const slippageBps = useMemo(() => clampBps(slippageInput), [slippageInput]);
  const slippageDisplay = slippageInput?.trim?.() ? slippageInput : DEFAULT_SLIPPAGE;
  const slippagePresets = useMemo(
    () => [
      { id: "0.0", label: "0.0%", value: "0.0", mode: "custom" },
      { id: "auto", label: "AUTO", value: DEFAULT_SLIPPAGE, mode: "auto" },
      { id: "0.5", label: "0.5%", value: "0.5", mode: "custom" },
      { id: "0.3", label: "0.3%", value: "0.3", mode: "custom" },
    ],
    [DEFAULT_SLIPPAGE]
  );
  const hasExternalBalances = Boolean(balancesProp);
  const { balances: hookBalances, loading: hookBalancesLoading, refresh: hookBalancesRefresh } = useBalances(
    address,
    chainId,
    tokenRegistry
  );
  const walletBalances = useMemo(
    () =>
      hasExternalBalances
        ? { ...hookBalances, ...balancesProp }
        : hookBalances,
    [balancesProp, hasExternalBalances, hookBalances]
  );
  const walletBalancesLoading = hasExternalBalances ? hookBalancesLoading : hookBalancesLoading;
  const refreshBalances = useCallback(
    async () => {
      const tasks = [];
      if (typeof onBalancesRefresh === "function") {
        tasks.push(onBalancesRefresh(address, { silent: true }));
      }
      if (typeof hookBalancesRefresh === "function") {
        tasks.push(hookBalancesRefresh(address, { silent: true }));
      }
      if (!tasks.length) return;
      try {
        await Promise.allSettled(tasks);
      } catch {
        // ignore refresh errors
      }
    },
    [onBalancesRefresh, hookBalancesRefresh, address]
  );
  const hasBothLiquidityViews = showV2 && showV3;
  const activeLiquidityView = hasBothLiquidityViews
    ? liquidityView
    : showV3
      ? "v3"
      : "v2";
  const isV2View = showV2 && activeLiquidityView === "v2";
  const isV3View = showV3 && activeLiquidityView === "v3";
  const hasV3Liquidity =
    showV3 && Boolean(UNIV3_FACTORY_ADDRESS && UNIV3_POSITION_MANAGER_ADDRESS);
  const v3TokenOptions = useMemo(
    () =>
      Object.keys(tokenRegistry).filter((sym) => {
        const meta = tokenRegistry[sym];
        return meta && (meta.address || sym === "ETH" || sym === "WETH");
      }),
    [tokenRegistry]
  );

  useEffect(() => {
    if (showV2 && !showV3 && liquidityView !== "v2") {
      setLiquidityView("v2");
      return;
    }
    if (showV3 && !showV2 && liquidityView !== "v3") {
      setLiquidityView("v3");
      return;
    }
    if (showV2 && showV3) {
      if (liquidityView !== "v2" && liquidityView !== "v3") {
        setLiquidityView("v2");
      }
    }
  }, [showV2, showV3, liquidityView]);

  useEffect(() => {
    if (!isV3View) return;
    if (!v3TokenOptions.length) return;
    if (!v3TokenOptions.includes(v3Token0)) {
      setV3Token0(v3TokenOptions[0]);
    }
    if (!v3TokenOptions.includes(v3Token1)) {
      const next = v3TokenOptions.find((sym) => sym !== v3Token0) || v3TokenOptions[0];
      setV3Token1(next);
    }
    if (v3Token0 === v3Token1 && v3TokenOptions.length > 1) {
      const next = v3TokenOptions.find((sym) => sym !== v3Token0);
      if (next) setV3Token1(next);
    }
    const isEthLike = (sym) => sym === "ETH" || sym === "WETH";
    if (isEthLike(v3Token0) && isEthLike(v3Token1) && v3TokenOptions.length > 1) {
      const stableAlt = v3TokenOptions.find(
        (sym) => !isEthLike(sym) && isStableSymbol(sym)
      );
      const fallback = v3TokenOptions.find((sym) => !isEthLike(sym));
      const next = stableAlt || fallback;
      if (next && next !== v3Token1) {
        setV3Token1(next);
      }
    }
  }, [isV3View, v3Token0, v3Token1, v3TokenOptions]);
  useEffect(() => {
    if (v3Token0 === "ETH") {
      setV3MintUseEth0(true);
      return;
    }
    if (v3Token0 === "WETH") {
      setV3MintUseEth0(false);
      return;
    }
    setV3MintUseEth0(false);
  }, [v3Token0]);
  useEffect(() => {
    if (v3Token1 === "ETH") {
      setV3MintUseEth1(true);
      return;
    }
    if (v3Token1 === "WETH") {
      setV3MintUseEth1(false);
      return;
    }
    setV3MintUseEth1(false);
  }, [v3Token1]);

  useEffect(() => {
    if (!isV3View) return;
    setV3RangeMode("full");
    setV3RangeLower("");
    setV3RangeUpper("");
    setV3PoolError("");
    setV3StartPrice("");
    setV3RangeInitialized(false);
    setV3PoolInfo({
      address: "",
      token0: "",
      token1: "",
      tick: null,
      sqrtPriceX96: null,
      spacing: null,
    });
    setV3PoolTvlHistory([]);
    setV3PoolTvlSnapshot(null);
    setV3PoolTvlError("");
    setV3PoolHourStats(null);
    setV3TokenPriceHistory([]);
    setV3TokenPriceKey("");
    setV3PoolBalances({ token0: null, token1: null });
  }, [isV3View, v3Token0, v3Token1, v3FeeTier]);

  const v3Token0Meta = tokenRegistry[v3Token0];
  const v3Token1Meta = tokenRegistry[v3Token1];
  const v3SelectedToken0Address =
    v3Token0 === "ETH" ? WETH_ADDRESS : v3Token0Meta?.address;
  const v3SelectedToken1Address =
    v3Token1 === "ETH" ? WETH_ADDRESS : v3Token1Meta?.address;
  const v3PoolQueryKey = useMemo(() => {
    if (!isV3View || !hasV3Liquidity) return "";
    if (!v3SelectedToken0Address || !v3SelectedToken1Address) return "";
    const token0 = v3SelectedToken0Address.toLowerCase();
    const token1 = v3SelectedToken1Address.toLowerCase();
    if (token0 === token1) return "";
    return `${token0}|${token1}|${Number(v3FeeTier || 0)}`;
  }, [
    isV3View,
    hasV3Liquidity,
    v3SelectedToken0Address,
    v3SelectedToken1Address,
    v3FeeTier,
  ]);
  const v3PriceCacheKey = useMemo(() => {
    if (!chainId || !v3SelectedToken0Address || !v3SelectedToken1Address) return "";
    const key0 = v3SelectedToken0Address.toLowerCase();
    const key1 = v3SelectedToken1Address.toLowerCase();
    return `v3-price-${chainId}-${key0}-${key1}-${Number(v3FeeTier || 0)}`;
  }, [chainId, v3SelectedToken0Address, v3SelectedToken1Address, v3FeeTier]);

  useEffect(() => {
    if (!isV3View || !v3PriceCacheKey) {
      setV3CachedPrice(null);
      return;
    }
    try {
      const raw = localStorage.getItem(v3PriceCacheKey);
      if (!raw) {
        setV3CachedPrice(null);
        return;
      }
      const parsed = JSON.parse(raw);
      const price = Number(parsed?.price);
      setV3CachedPrice(Number.isFinite(price) && price > 0 ? price : null);
    } catch {
      setV3CachedPrice(null);
    }
  }, [isV3View, v3PriceCacheKey]);

  useEffect(() => {
    v3TokenPriceCacheRef.current = {
      key: v3TokenPriceKey,
      sig: buildHistorySignature(v3TokenPriceHistory),
      len: Array.isArray(v3TokenPriceHistory) ? v3TokenPriceHistory.length : 0,
      history: Array.isArray(v3TokenPriceHistory) ? v3TokenPriceHistory : [],
    };
  }, [v3TokenPriceKey, v3TokenPriceHistory, v3TokenPriceCacheRef]);
  const v3Token0PriceUsd = v3SelectedToken0Address
    ? tokenPrices[(v3SelectedToken0Address || "").toLowerCase()]
    : null;
  const v3Token1PriceUsd = v3SelectedToken1Address
    ? tokenPrices[(v3SelectedToken1Address || "").toLowerCase()]
    : null;

  const readDecimals = useCallback(
    async (provider, addr, meta) => {
      if (!addr) return meta?.decimals ?? 18;
      const key = addr.toLowerCase();
      if (tokenDecimalsCache.current[key] !== undefined) {
        return tokenDecimalsCache.current[key];
      }
      let dec = meta?.decimals;
      try {
        const erc = new Contract(addr, ERC20_ABI, provider);
        const onchain = await erc.decimals();
        dec = Number(onchain);
      } catch {
        // ignore and fallback
      }
      const final = Number.isFinite(dec) && dec > 0 ? dec : 18;
      tokenDecimalsCache.current[key] = final;
      return final;
    },
    []
  );

  const findTokenMetaByAddress = useCallback(
    (addr) => {
      if (!addr) return null;
      const lower = addr.toLowerCase();
      return Object.values(tokenRegistry).find(
        (t) => t?.address && t.address.toLowerCase() === lower
      );
    },
    [tokenRegistry]
  );
  const resolveWalletBalanceBySymbol = useCallback(
    (symbol) => {
      if (!symbol || !walletBalances) return null;
      const keys = Object.keys(walletBalances);
      if (!keys.length) return null;
      const normalized = String(symbol).trim();
      if (!normalized) return null;
      const candidates = [normalized];
      const upper = normalized.toUpperCase();
      if (upper !== normalized) candidates.push(upper);
      if (upper === "ETH") candidates.push("WETH");
      if (upper === "WETH") candidates.push("ETH");
      for (const candidate of candidates) {
        const lower = candidate.toLowerCase();
        const match = keys.find((k) => k.toLowerCase() === lower);
        if (match !== undefined) return walletBalances[match];
      }
      return null;
    },
    [walletBalances]
  );
  const resolveWalletBalanceExact = useCallback(
    (symbol) => {
      if (!symbol || !walletBalances) return null;
      const keys = Object.keys(walletBalances);
      if (!keys.length) return null;
      const normalized = String(symbol).trim();
      if (!normalized) return null;
      const lower = normalized.toLowerCase();
      const match = keys.find((k) => k.toLowerCase() === lower);
      if (match !== undefined) return walletBalances[match];
      return null;
    },
    [walletBalances]
  );
  const v3Token0IsWeth = Boolean(WETH_ADDRESS) &&
    v3SelectedToken0Address?.toLowerCase?.() === WETH_ADDRESS.toLowerCase();
  const v3Token1IsWeth = Boolean(WETH_ADDRESS) &&
    v3SelectedToken1Address?.toLowerCase?.() === WETH_ADDRESS.toLowerCase();
  const v3Token0SupportsEthToggle = v3Token0IsWeth;
  const v3Token1SupportsEthToggle = v3Token1IsWeth;
  const v3MintUseEth0Effective = v3Token0SupportsEthToggle
    ? v3MintUseEth0
    : v3Token0 === "ETH";
  const v3MintUseEth1Effective = v3Token1SupportsEthToggle
    ? v3MintUseEth1
    : v3Token1 === "ETH";
  const v3MintDisplayMeta0 = v3MintUseEth0Effective
    ? tokenRegistry.ETH
    : v3Token0IsWeth
    ? tokenRegistry.WETH
    : v3Token0Meta;
  const v3MintDisplayMeta1 = v3MintUseEth1Effective
    ? tokenRegistry.ETH
    : v3Token1IsWeth
    ? tokenRegistry.WETH
    : v3Token1Meta;
  const v3MintDisplaySymbol0 = v3MintUseEth0Effective
    ? "ETH"
    : v3Token0IsWeth
    ? "WETH"
    : v3Token0;
  const v3MintDisplaySymbol1 = v3MintUseEth1Effective
    ? "ETH"
    : v3Token1IsWeth
    ? "WETH"
    : v3Token1;
  const v3MintBalance0 = resolveWalletBalanceBySymbol(
    v3MintUseEth0Effective ? "ETH" : v3Token0IsWeth ? "WETH" : v3Token0
  );
  const v3MintBalance1 = resolveWalletBalanceBySymbol(
    v3MintUseEth1Effective ? "ETH" : v3Token1IsWeth ? "WETH" : v3Token1
  );
  const v3MintBalance0Num = safeNumber(v3MintBalance0);
  const v3MintBalance1Num = safeNumber(v3MintBalance1);

  const v3ActionRangeMath = useMemo(() => {
    const pos = v3ActionModal.position;
    if (!pos) return null;
    const meta0 = findTokenMetaByAddress(pos.token0);
    const meta1 = findTokenMetaByAddress(pos.token1);
    const dec0 = meta0?.decimals ?? 18;
    const dec1 = meta1?.decimals ?? 18;
    const sqrtLowerX96 = tickToSqrtPriceX96(pos.tickLower);
    const sqrtUpperX96 = tickToSqrtPriceX96(pos.tickUpper);
    const key = `${pos.token0?.toLowerCase?.() || ""}-${pos.token1?.toLowerCase?.() || ""}-${pos.fee}`;
    const metrics = v3PoolMetrics[key];
    let sqrtCurrentX96 = metrics?.sqrtPriceX96 ?? null;
    if (!sqrtCurrentX96 && metrics?.tick !== undefined && metrics?.tick !== null) {
      sqrtCurrentX96 = tickToSqrtPriceX96(metrics.tick);
    }
    if (!sqrtCurrentX96 || !sqrtLowerX96 || !sqrtUpperX96) return null;
    return {
      dec0,
      dec1,
      sqrtLowerX96,
      sqrtUpperX96,
      sqrtCurrentX96,
    };
  }, [v3ActionModal.position, v3PoolMetrics, findTokenMetaByAddress]);
  const v3ActionRangeSide = useMemo(() => {
    if (!v3ActionRangeMath) return "dual";
    if (v3ActionRangeMath.sqrtCurrentX96 <= v3ActionRangeMath.sqrtLowerX96) return "token0";
    if (v3ActionRangeMath.sqrtCurrentX96 >= v3ActionRangeMath.sqrtUpperX96) return "token1";
    return "dual";
  }, [v3ActionRangeMath]);

  const computeV3ActionFromAmount0 = useCallback(
    (value) => {
      if (!v3ActionRangeMath) return "";
      const num = safeNumber(value);
      if (!Number.isFinite(num) || num <= 0) return "";
      const amount0Raw = safeParseUnits(value, v3ActionRangeMath.dec0);
      if (!amount0Raw || amount0Raw <= 0n) return "";
      const liquidity = getLiquidityForAmount0(
        v3ActionRangeMath.sqrtCurrentX96,
        v3ActionRangeMath.sqrtLowerX96,
        v3ActionRangeMath.sqrtUpperX96,
        amount0Raw
      );
      if (!liquidity || liquidity <= 0n) return "0";
      const amounts = getAmountsForLiquidity(
        v3ActionRangeMath.sqrtCurrentX96,
        v3ActionRangeMath.sqrtLowerX96,
        v3ActionRangeMath.sqrtUpperX96,
        liquidity
      );
      const out1 = amounts?.amount1 ?? 0n;
      return formatAmountFromRaw(out1, v3ActionRangeMath.dec1);
    },
    [v3ActionRangeMath]
  );

  const computeV3ActionFromAmount1 = useCallback(
    (value) => {
      if (!v3ActionRangeMath) return "";
      const num = safeNumber(value);
      if (!Number.isFinite(num) || num <= 0) return "";
      const amount1Raw = safeParseUnits(value, v3ActionRangeMath.dec1);
      if (!amount1Raw || amount1Raw <= 0n) return "";
      const liquidity = getLiquidityForAmount1(
        v3ActionRangeMath.sqrtCurrentX96,
        v3ActionRangeMath.sqrtLowerX96,
        v3ActionRangeMath.sqrtUpperX96,
        amount1Raw
      );
      if (!liquidity || liquidity <= 0n) return "0";
      const amounts = getAmountsForLiquidity(
        v3ActionRangeMath.sqrtCurrentX96,
        v3ActionRangeMath.sqrtLowerX96,
        v3ActionRangeMath.sqrtUpperX96,
        liquidity
      );
      const out0 = amounts?.amount0 ?? 0n;
      return formatAmountFromRaw(out0, v3ActionRangeMath.dec0);
    },
    [v3ActionRangeMath]
  );

  useEffect(() => {
    if (!v3ActionRangeMath || !v3ActionLastEdited) return;
    if (v3ActionLastEdited === "token0") {
      if (!v3ActionAmount0) {
        if (v3ActionAmount1) setV3ActionAmount1("");
        return;
      }
      const next = computeV3ActionFromAmount0(v3ActionAmount0);
      if (next !== "" && next !== v3ActionAmount1) {
        setV3ActionAmount1(next);
      }
      if (next === "" && v3ActionAmount1) {
        setV3ActionAmount1("");
      }
    }
    if (v3ActionLastEdited === "token1") {
      if (!v3ActionAmount1) {
        if (v3ActionAmount0) setV3ActionAmount0("");
        return;
      }
      const next = computeV3ActionFromAmount1(v3ActionAmount1);
      if (next !== "" && next !== v3ActionAmount0) {
        setV3ActionAmount0(next);
      }
      if (next === "" && v3ActionAmount0) {
        setV3ActionAmount0("");
      }
    }
  }, [
    v3ActionRangeMath,
    v3ActionLastEdited,
    v3ActionAmount0,
    v3ActionAmount1,
    computeV3ActionFromAmount0,
    computeV3ActionFromAmount1,
  ]);
  useEffect(() => {
    if (v3ActionRangeSide === "token0") {
      if (v3ActionAmount1 && v3ActionAmount1 !== "0") setV3ActionAmount1("0");
      return;
    }
    if (v3ActionRangeSide === "token1") {
      if (v3ActionAmount0 && v3ActionAmount0 !== "0") setV3ActionAmount0("0");
    }
  }, [v3ActionRangeSide, v3ActionAmount0, v3ActionAmount1]);

  const v3PoolToken0Meta = useMemo(
    () => findTokenMetaByAddress(v3PoolInfo.token0),
    [findTokenMetaByAddress, v3PoolInfo.token0]
  );
  const v3PoolToken1Meta = useMemo(
    () => findTokenMetaByAddress(v3PoolInfo.token1),
    [findTokenMetaByAddress, v3PoolInfo.token1]
  );
  const v3PoolIsReversed = useMemo(() => {
    if (!v3PoolInfo.token0 || !v3SelectedToken0Address) return false;
    return v3PoolInfo.token0.toLowerCase() !== v3SelectedToken0Address.toLowerCase();
  }, [v3PoolInfo.token0, v3SelectedToken0Address]);
  const v3CurrentPrice = useMemo(() => {
    if (!v3PoolInfo.sqrtPriceX96 || v3PoolInfo.sqrtPriceX96 === 0n) return null;
    if (v3PoolInfo.tick === null || v3PoolInfo.tick === undefined) return null;
    const dec0 = v3PoolToken0Meta?.decimals ?? 18;
    const dec1 = v3PoolToken1Meta?.decimals ?? 18;
    const basePrice = tickToPrice(v3PoolInfo.tick, dec0, dec1);
    if (!basePrice) return null;
    return v3PoolIsReversed ? 1 / basePrice : basePrice;
  }, [
    v3PoolInfo.tick,
    v3PoolInfo.sqrtPriceX96,
    v3PoolIsReversed,
    v3PoolToken0Meta,
    v3PoolToken1Meta,
  ]);
  const v3StartPriceNum = safeNumber(v3StartPrice);
  const v3HasStartPrice = v3StartPriceNum !== null && v3StartPriceNum > 0;
  const v3PoolInitialized =
    Boolean(v3PoolInfo.address) &&
    v3PoolInfo.sqrtPriceX96 !== null &&
    v3PoolInfo.sqrtPriceX96 !== undefined &&
    v3PoolInfo.sqrtPriceX96 !== 0n;
  const v3PoolNeedsInit = Boolean(
    isV3View &&
      hasV3Liquidity &&
      v3SelectedToken0Address &&
      v3SelectedToken1Address &&
      v3SelectedToken0Address.toLowerCase() !== v3SelectedToken1Address.toLowerCase() &&
      Boolean(v3PoolInfo.address) &&
      !v3PoolInitialized
  );
  const v3PoolMissing = Boolean(
    isV3View &&
      hasV3Liquidity &&
      v3SelectedToken0Address &&
      v3SelectedToken1Address &&
      v3SelectedToken0Address.toLowerCase() !== v3SelectedToken1Address.toLowerCase() &&
      !v3PoolInfo.address &&
      (!v3PoolError || v3PoolError.toLowerCase().includes("not deployed"))
  );
  const v3PoolRequiresInit = v3PoolNeedsInit || v3PoolMissing;
  const v3DerivedPrice = useMemo(() => {
    const raw0 = safeNumber(v3Token0PriceUsd);
    const raw1 = safeNumber(v3Token1PriceUsd);
    const symbol0 = v3Token0Meta?.symbol || v3Token0;
    const symbol1 = v3Token1Meta?.symbol || v3Token1;
    const price0 = raw0 !== null && raw0 > 0 ? raw0 : isStableSymbol(symbol0) ? 1 : null;
    const price1 = raw1 !== null && raw1 > 0 ? raw1 : isStableSymbol(symbol1) ? 1 : null;
    if (price0 === null || price1 === null) return null;
    const derived = price0 / price1;
    return Number.isFinite(derived) && derived > 0 ? derived : null;
  }, [v3Token0PriceUsd, v3Token1PriceUsd, v3Token0Meta, v3Token1Meta, v3Token0, v3Token1]);
  const v3SubgraphCurrentPrice = useMemo(() => {
    const history = v3TokenPriceHistory.length
      ? v3TokenPriceHistory
      : Array.isArray(v3PoolTvlHistory)
      ? v3PoolTvlHistory
      : [];
    if (!history.length) return null;
    const latest = history[history.length - 1];
    const token0Price = toOptionalNumber(latest?.token0Price);
    const token1Price = toOptionalNumber(latest?.token1Price);
    let price = v3PoolIsReversed ? token0Price : token1Price;
    if (!Number.isFinite(price) || price <= 0) {
      const alt = v3PoolIsReversed ? token1Price : token0Price;
      if (Number.isFinite(alt) && alt > 0) {
        price = 1 / alt;
      }
    }
    return Number.isFinite(price) && price > 0 ? price : null;
  }, [v3PoolTvlHistory, v3TokenPriceHistory, v3PoolIsReversed]);
  const v3SuggestedStartPrice = useMemo(() => {
    if (v3DerivedPrice && Number.isFinite(v3DerivedPrice) && v3DerivedPrice > 0) {
      return v3DerivedPrice;
    }
    if (
      v3SubgraphCurrentPrice &&
      Number.isFinite(v3SubgraphCurrentPrice) &&
      v3SubgraphCurrentPrice > 0
    ) {
      return v3SubgraphCurrentPrice;
    }
    if (v3CachedPrice && Number.isFinite(v3CachedPrice) && v3CachedPrice > 0) {
      return v3CachedPrice;
    }
    if (v3CurrentPrice && Number.isFinite(v3CurrentPrice) && v3CurrentPrice > 0) {
      return v3CurrentPrice;
    }
    return null;
  }, [v3DerivedPrice, v3SubgraphCurrentPrice, v3CachedPrice, v3CurrentPrice]);
  const v3ReferencePrice = useMemo(() => {
    if (v3CurrentPrice && Number.isFinite(v3CurrentPrice) && v3CurrentPrice > 0) {
      return v3CurrentPrice;
    }
    if (v3PoolRequiresInit && v3HasStartPrice) {
      return v3StartPriceNum;
    }
    if (
      v3SubgraphCurrentPrice &&
      Number.isFinite(v3SubgraphCurrentPrice) &&
      v3SubgraphCurrentPrice > 0
    ) {
      return v3SubgraphCurrentPrice;
    }
    if (v3DerivedPrice && Number.isFinite(v3DerivedPrice) && v3DerivedPrice > 0) {
      return v3DerivedPrice;
    }
    if (v3CachedPrice && Number.isFinite(v3CachedPrice) && v3CachedPrice > 0) {
      return v3CachedPrice;
    }
    return null;
  }, [
    v3CurrentPrice,
    v3PoolRequiresInit,
    v3HasStartPrice,
    v3StartPriceNum,
    v3SubgraphCurrentPrice,
    v3DerivedPrice,
    v3CachedPrice,
  ]);
  const v3ReferencePriceUsd = useMemo(() => {
    if (!v3ReferencePrice || !Number.isFinite(v3ReferencePrice) || v3ReferencePrice <= 0) {
      return null;
    }
    const raw = safeNumber(v3Token1PriceUsd);
    const symbol1 = v3Token1Meta?.symbol || v3Token1;
    const token1Usd = raw !== null && raw > 0 ? raw : isStableSymbol(symbol1) ? 1 : null;
    if (token1Usd === null) return null;
    const usd = v3ReferencePrice * token1Usd;
    return Number.isFinite(usd) ? usd : null;
  }, [v3ReferencePrice, v3Token1PriceUsd, v3Token1Meta, v3Token1]);

  useEffect(() => {
    if (!v3PriceCacheKey || !v3ReferencePrice || !Number.isFinite(v3ReferencePrice)) return;
    try {
      localStorage.setItem(
        v3PriceCacheKey,
        JSON.stringify({ price: v3ReferencePrice, ts: Date.now() })
      );
    } catch {
      // ignore cache write errors
    }
  }, [v3PriceCacheKey, v3ReferencePrice]);
  const v3RangeLowerNum = safeNumber(v3RangeLower);
  const v3RangeUpperNum = safeNumber(v3RangeUpper);
  useEffect(() => {
    v3RangeLowerRef.current = v3RangeLowerNum;
    v3RangeUpperRef.current = v3RangeUpperNum;
  }, [v3RangeLowerNum, v3RangeUpperNum]);
  const v3HasCustomRange =
    v3RangeMode === "custom" &&
    v3RangeLowerNum !== null &&
    v3RangeUpperNum !== null &&
    v3RangeLowerNum > 0 &&
    v3RangeUpperNum > 0 &&
    v3RangeLowerNum < v3RangeUpperNum;
  const v3PriceStatus = useMemo(() => {
    if (v3PoolLoading) return "Loading...";
    if (v3ReferencePrice) {
      return `${formatPrice(v3ReferencePrice)} ${v3Token1}/${v3Token0}`;
    }
    if (v3PoolRequiresInit) {
      if (v3HasStartPrice) {
        return `${formatPrice(v3StartPriceNum)} ${v3Token1}/${v3Token0}`;
      }
      if (v3PoolMissing) {
        return "Pool not deployed yet. Set a starting price to create it.";
      }
      return v3PoolError || "Pool not initialized. Set a starting price.";
    }
    return v3PoolError || "Pool not deployed";
  }, [
    v3PoolLoading,
    v3ReferencePrice,
    v3Token1,
    v3Token0,
    v3PoolRequiresInit,
    v3HasStartPrice,
    v3StartPriceNum,
    v3PoolError,
    v3PoolMissing,
  ]);

  const v3RangeMath = useMemo(() => {
    const hasPoolSqrt =
      v3PoolInfo?.sqrtPriceX96 && v3PoolInfo.sqrtPriceX96 !== 0n;
    if (!v3ReferencePrice && !hasPoolSqrt) return null;
    const dec0 = v3Token0Meta?.decimals ?? 18;
    const dec1 = v3Token1Meta?.decimals ?? 18;
    let sqrtLowerX96 = null;
    let sqrtUpperX96 = null;
    if (v3RangeMode === "full") {
      const spacing = v3PoolInfo.spacing || getTickSpacingFromFee(v3FeeTier) || 1;
      const minTick = Math.ceil(V3_MIN_TICK / spacing) * spacing;
      const maxTick = Math.floor(V3_MAX_TICK / spacing) * spacing;
      sqrtLowerX96 = tickToSqrtPriceX96(minTick);
      sqrtUpperX96 = tickToSqrtPriceX96(maxTick);
    } else if (v3HasCustomRange) {
      const lowerScaled = safeParseUnits(v3RangeLower, 18);
      const upperScaled = safeParseUnits(v3RangeUpper, 18);
      if (!lowerScaled || !upperScaled) return null;
      sqrtLowerX96 = encodePriceSqrtFromPrice(lowerScaled, dec0, dec1);
      sqrtUpperX96 = encodePriceSqrtFromPrice(upperScaled, dec0, dec1);
    } else {
      return null;
    }
    let sqrtCurrentX96 =
      v3PoolInfo?.sqrtPriceX96 && v3PoolInfo.sqrtPriceX96 !== 0n
        ? v3PoolInfo.sqrtPriceX96
        : null;
    if (!sqrtCurrentX96) {
      const currentScaled = safeParseUnits(formatAutoAmount(v3ReferencePrice), 18);
      if (!currentScaled) return null;
      sqrtCurrentX96 = encodePriceSqrtFromPrice(currentScaled, dec0, dec1);
    }
    if (!sqrtLowerX96 || !sqrtUpperX96 || !sqrtCurrentX96) return null;
    if (!sqrtCurrentX96) return null;
    return {
      dec0,
      dec1,
      sqrtLowerX96,
      sqrtUpperX96,
      sqrtCurrentX96,
    };
  }, [
    v3ReferencePrice,
    v3RangeMode,
    v3HasCustomRange,
    v3RangeLower,
    v3RangeUpper,
    v3Token0Meta,
    v3Token1Meta,
    v3PoolInfo.sqrtPriceX96,
    v3PoolInfo.spacing,
    v3FeeTier,
  ]);
  const v3RangeSide = useMemo(() => {
    if (!v3RangeMath) return "dual";
    if (v3RangeMath.sqrtCurrentX96 <= v3RangeMath.sqrtLowerX96) return "token0";
    if (v3RangeMath.sqrtCurrentX96 >= v3RangeMath.sqrtUpperX96) return "token1";
    return "dual";
  }, [v3RangeMath]);
  const v3MintCanUseSide0 = v3RangeSide !== "token1";
  const v3MintCanUseSide1 = v3RangeSide !== "token0";
  const v3MintDimToken0 = !v3MintCanUseSide0;
  const v3MintDimToken1 = !v3MintCanUseSide1;
  const v3MintHasBalance0 = v3MintBalance0Num !== null && v3MintBalance0Num > 0;
  const v3MintHasBalance1 = v3MintBalance1Num !== null && v3MintBalance1Num > 0;

  const v3MintQuickButtons = useMemo(
    () => [
      { label: "25%", pct: 0.25 },
      { label: "50%", pct: 0.5 },
      { label: "Max", pct: 1 },
    ],
    []
  );

  const applyV3MintAmount0 = useCallback(
    (nextRaw) => {
      const baseDec =
        v3Token0 === "ETH" ? 18 : v3Token0Meta?.decimals ?? 18;
      const next = sanitizeAmountInput(nextRaw, v3RangeMath?.dec0 ?? baseDec);
      setV3Amount0(next);
      if (v3MintError) setV3MintError("");
      if (actionStatus) setActionStatus(null);
      const num = safeNumber(next);
      if (!Number.isFinite(num) || num <= 0) return;
      if (v3RangeMath) {
        const amount0Raw = safeParseUnits(next, v3RangeMath.dec0);
        if (!amount0Raw || amount0Raw <= 0n) return;
        const liquidity = getLiquidityForAmount0(
          v3RangeMath.sqrtCurrentX96,
          v3RangeMath.sqrtLowerX96,
          v3RangeMath.sqrtUpperX96,
          amount0Raw
        );
        if (!liquidity || liquidity <= 0n) {
          setV3Amount1("0");
          return;
        }
        const amounts = getAmountsForLiquidity(
          v3RangeMath.sqrtCurrentX96,
          v3RangeMath.sqrtLowerX96,
          v3RangeMath.sqrtUpperX96,
          liquidity
        );
        const out1 = amounts?.amount1 ?? 0n;
        setV3Amount1(formatAmountFromRaw(out1, v3RangeMath.dec1));
        return;
      }
      if (!v3ReferencePrice) return;
      const computed = num * v3ReferencePrice;
      const targetDec =
        v3Token1 === "ETH" ? 18 : v3Token1Meta?.decimals ?? 18;
      setV3Amount1(formatAutoAmount(computed, targetDec));
    },
    [
      actionStatus,
      v3MintError,
      v3RangeMath,
      v3ReferencePrice,
      v3Token0,
      v3Token0Meta,
    ]
  );

  const applyV3MintAmount1 = useCallback(
    (nextRaw) => {
      const baseDec =
        v3Token1 === "ETH" ? 18 : v3Token1Meta?.decimals ?? 18;
      const next = sanitizeAmountInput(nextRaw, v3RangeMath?.dec1 ?? baseDec);
      setV3Amount1(next);
      if (v3MintError) setV3MintError("");
      if (actionStatus) setActionStatus(null);
      const num = safeNumber(next);
      if (!Number.isFinite(num) || num <= 0) return;
      if (v3RangeMath) {
        const amount1Raw = safeParseUnits(next, v3RangeMath.dec1);
        if (!amount1Raw || amount1Raw <= 0n) return;
        const liquidity = getLiquidityForAmount1(
          v3RangeMath.sqrtCurrentX96,
          v3RangeMath.sqrtLowerX96,
          v3RangeMath.sqrtUpperX96,
          amount1Raw
        );
        if (!liquidity || liquidity <= 0n) {
          setV3Amount0("0");
          return;
        }
        const amounts = getAmountsForLiquidity(
          v3RangeMath.sqrtCurrentX96,
          v3RangeMath.sqrtLowerX96,
          v3RangeMath.sqrtUpperX96,
          liquidity
        );
        const out0 = amounts?.amount0 ?? 0n;
        setV3Amount0(formatAmountFromRaw(out0, v3RangeMath.dec0));
        return;
      }
      if (!v3ReferencePrice) return;
      const computed = num / v3ReferencePrice;
      const targetDec =
        v3Token0 === "ETH" ? 18 : v3Token0Meta?.decimals ?? 18;
      setV3Amount0(formatAutoAmount(computed, targetDec));
    },
    [
      actionStatus,
      v3MintError,
      v3RangeMath,
      v3ReferencePrice,
      v3Token1,
      v3Token1Meta,
    ]
  );

  const applyV3MintQuickFill = useCallback(
    (side, pct) => {
      if (walletBalancesLoading) return;
      if (side === 0 && !v3MintCanUseSide0) return;
      if (side === 1 && !v3MintCanUseSide1) return;
      const balance = side === 0 ? v3MintBalance0Num : v3MintBalance1Num;
      if (!Number.isFinite(balance) || balance <= 0) return;
      const next = formatAutoAmount(balance * pct);
      if (side === 0) {
        applyV3MintAmount0(next);
      } else {
        applyV3MintAmount1(next);
      }
    },
    [
      applyV3MintAmount0,
      applyV3MintAmount1,
      v3MintBalance0Num,
      v3MintBalance1Num,
      v3MintCanUseSide0,
      v3MintCanUseSide1,
      walletBalancesLoading,
    ]
  );

  const applyV3RangePreset = useCallback(
    (pct) => {
      if (!v3ReferencePrice) return;
      const lower = v3ReferencePrice * (1 - pct);
      const upper = v3ReferencePrice * (1 + pct);
      setV3RangeMode("custom");
      setV3RangeLower(lower.toFixed(6));
      setV3RangeUpper(upper.toFixed(6));
      setV3RangeInitialized(true);
    },
    [v3ReferencePrice]
  );
  const applyV3RangeAsymmetric = useCallback(
    (lowerPct, upperPct) => {
      if (!v3ReferencePrice) return;
      let lower = v3ReferencePrice * (1 + lowerPct);
      let upper = v3ReferencePrice * (1 + upperPct);
      if (upperPct === 0 && lowerPct < 0) {
        const bump = Math.max(v3ReferencePrice * 0.000001, 1e-6);
        upper += bump;
      }
      if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower <= 0 || upper <= 0) {
        return;
      }
      const sortedLower = Math.min(lower, upper);
      const sortedUpper = Math.max(lower, upper);
      setV3RangeMode("custom");
      setV3RangeLower(sortedLower.toFixed(6));
      setV3RangeUpper(sortedUpper.toFixed(6));
      setV3RangeInitialized(true);
    },
    [v3ReferencePrice]
  );
  const applyV3RangeTickPreset = useCallback(
    (tickCount) => {
      if (!v3ReferencePrice) return;
      const dec0 = v3Token0Meta?.decimals ?? 18;
      const dec1 = v3Token1Meta?.decimals ?? 18;
      const spacing = getTickSpacingFromFee(v3FeeTier) || 1;
      const currentTick = priceToTick(v3ReferencePrice, dec0, dec1);
      if (!Number.isFinite(currentTick)) return;
      const lowerTick = Math.floor((currentTick - tickCount * spacing) / spacing) * spacing;
      const upperTick = Math.ceil((currentTick + tickCount * spacing) / spacing) * spacing;
      const lower = tickToPrice(lowerTick, dec0, dec1);
      const upper = tickToPrice(upperTick, dec0, dec1);
      if (!Number.isFinite(lower) || !Number.isFinite(upper)) return;
      setV3RangeMode("custom");
      setV3RangeLower(lower.toFixed(6));
      setV3RangeUpper(upper.toFixed(6));
      setV3RangeInitialized(true);
    },
    [v3ReferencePrice, v3Token0Meta, v3Token1Meta, v3FeeTier]
  );
  useEffect(() => {
    if (v3RangeSide === "token0") {
      if (v3Amount1 && v3Amount1 !== "0") setV3Amount1("0");
      return;
    }
    if (v3RangeSide === "token1") {
      if (v3Amount0 && v3Amount0 !== "0") setV3Amount0("0");
    }
  }, [v3RangeSide, v3Amount0, v3Amount1]);

  useEffect(() => {
    if (!isV3View || v3RangeInitialized) return;
    if (!v3ReferencePrice || !Number.isFinite(v3ReferencePrice)) return;
    const span = v3ReferencePrice * 0.15;
    const lower = v3ReferencePrice - span;
    const upper = v3ReferencePrice + span;
    setV3RangeMode("custom");
    setV3RangeLower(lower.toFixed(6));
    setV3RangeUpper(upper.toFixed(6));
    setV3RangeInitialized(true);
  }, [isV3View, v3ReferencePrice, v3RangeInitialized]);

  const v3Chart = useMemo(() => {
    if (!v3ReferencePrice && !v3HasCustomRange) return null;
    let min;
    let max;
    if (v3HasCustomRange && v3ReferencePrice) {
      const lowerSpan = v3ReferencePrice - v3RangeLowerNum;
      const upperSpan = v3RangeUpperNum - v3ReferencePrice;
      const span = Math.max(lowerSpan, upperSpan, v3ReferencePrice * CHART_PADDING);
      const paddedSpan = span * (1 + CHART_PADDING);
      min = v3ReferencePrice - paddedSpan;
      max = v3ReferencePrice + paddedSpan;
    } else if (v3HasCustomRange) {
      min = v3RangeLowerNum * (1 - CHART_PADDING);
      max = v3RangeUpperNum * (1 + CHART_PADDING);
    } else {
      min = v3ReferencePrice * (1 - CHART_PADDING);
      max = v3ReferencePrice * (1 + CHART_PADDING);
    }

    const history = v3TokenPriceHistory.length
      ? v3TokenPriceHistory
      : Array.isArray(v3PoolTvlHistory)
      ? v3PoolTvlHistory
      : [];
    const cutoff =
      v3RangeTimeframe === "All" ? null : Date.now() - v3RangeDays * 86400000;
    let historyMin = null;
    let historyMax = null;
    for (const row of history) {
      const date = Number(row?.date || 0);
      if (!Number.isFinite(date) || date <= 0) continue;
      if (cutoff && date < cutoff) continue;
      const token0Price = toOptionalNumber(row?.token0Price);
      const token1Price = toOptionalNumber(row?.token1Price);
      let price = v3PoolIsReversed ? token0Price : token1Price;
      if (!Number.isFinite(price) || price <= 0) {
        const alt = v3PoolIsReversed ? token1Price : token0Price;
        if (Number.isFinite(alt) && alt > 0) {
          price = 1 / alt;
        }
      }
      if (!Number.isFinite(price) || price <= 0) continue;
      historyMin = historyMin === null ? price : Math.min(historyMin, price);
      historyMax = historyMax === null ? price : Math.max(historyMax, price);
    }
    const shouldExpand =
      historyMin !== null &&
      historyMax !== null &&
      (historyMin < min || historyMax > max);
    if (shouldExpand) {
      min = Math.min(min, historyMin);
      max = Math.max(max, historyMax);
      const span = max - min;
      const pad = span * (CHART_PADDING * 0.5);
      min -= pad;
      max += pad;
    }

    if (v3ChartMode === "price-range" && v3ReferencePrice) {
      const span = Math.max(v3ReferencePrice - min, max - v3ReferencePrice);
      min = v3ReferencePrice - span;
      max = v3ReferencePrice + span;
    }

    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      return null;
    }
    const clampPct = (value) => Math.min(100, Math.max(0, value));
    const currentPct = v3ReferencePrice
      ? clampPct(((v3ReferencePrice - min) / (max - min)) * 100)
      : null;
    const rangeStart = v3HasCustomRange
      ? clampPct(((v3RangeLowerNum - min) / (max - min)) * 100)
      : 0;
    const rangeEnd = v3HasCustomRange
      ? clampPct(((v3RangeUpperNum - min) / (max - min)) * 100)
      : 100;
    return {
      min,
      max,
      currentPct,
      rangeStart,
      rangeEnd,
    };
  }, [
    v3ReferencePrice,
    v3HasCustomRange,
    v3RangeLowerNum,
    v3RangeUpperNum,
    v3PoolIsReversed,
    v3PoolTvlHistory,
    v3TokenPriceHistory,
    v3RangeDays,
    v3RangeTimeframe,
    v3ChartMode,
  ]);
  useEffect(() => {
    v3ChartRef.current = v3Chart;
  }, [v3Chart]);

  const v3RangeStrategies = useMemo(
    () => [
      {
        id: "stable",
        title: "Stable",
        range: "± 3 ticks",
        description: "Good for stablecoins or low volatility pairs.",
        apply: () => applyV3RangeTickPreset(3),
      },
      {
        id: "wide",
        title: "Wide",
        range: "-50% → +100%",
        description: "Good for volatile pairs.",
        apply: () => applyV3RangeAsymmetric(-0.5, 1),
      },
      {
        id: "lower",
        title: "One-sided lower",
        range: "-50%",
        description: "Supply liquidity if price goes down.",
        apply: () => applyV3RangeAsymmetric(-0.5, 0),
      },
      {
        id: "upper",
        title: "One-sided upper",
        range: "+100%",
        description: "Supply liquidity if price goes up.",
        apply: () => applyV3RangeAsymmetric(0, 1),
      },
    ],
    [applyV3RangeTickPreset, applyV3RangeAsymmetric]
  );

  const v3PoolSeriesRaw = useMemo(() => {
    const history = Array.isArray(v3PoolTvlHistory) ? v3PoolTvlHistory : [];
    return history
      .map((row) => ({
        date: Number(row?.date || 0),
        tvlUsd: toOptionalNumber(row?.tvlUsd),
        volumeUsd: toOptionalNumber(row?.volumeUsd),
        feesUsd: toOptionalNumber(row?.feesUsd),
        token0Price: toOptionalNumber(row?.token0Price),
        token1Price: toOptionalNumber(row?.token1Price),
      }))
      .filter((row) => Number.isFinite(row.date) && row.date > 0)
      .sort((a, b) => a.date - b.date);
  }, [v3PoolTvlHistory]);

  const v3PoolSeries = useMemo(() => {
    if (!v3PoolSeriesRaw.length) return [];
    if (v3RangeTimeframe === "All") return v3PoolSeriesRaw;
    const cutoff = Date.now() - v3RangeDays * 86400000;
    return v3PoolSeriesRaw.filter((row) => row.date >= cutoff);
  }, [v3PoolSeriesRaw, v3RangeDays, v3RangeTimeframe]);
  const v3TokenPriceSeries = useMemo(() => {
    if (!v3TokenPriceHistory.length) return [];
    if (v3RangeTimeframe === "All") return v3TokenPriceHistory;
    const cutoff = Date.now() - v3RangeDays * 86400000;
    return v3TokenPriceHistory.filter((row) => row.date >= cutoff);
  }, [v3TokenPriceHistory, v3RangeDays, v3RangeTimeframe]);

  const v3PriceSeriesSource = useMemo(
    () => (v3TokenPriceSeries.length ? v3TokenPriceSeries : v3PoolSeries),
    [v3TokenPriceSeries, v3PoolSeries]
  );

  const v3TvlChart = useMemo(() => {
    const base = v3PoolSeries
      .map((row) => ({ date: row.date, value: row.tvlUsd }))
      .filter((row) => Number.isFinite(row.value));
    const snapshot = safeNumber(v3PoolTvlSnapshot);
    const merged = snapshot !== null ? mergeSeriesSnapshot(base, snapshot) : base;
    return buildSeriesChart(merged);
  }, [v3PoolSeries, v3PoolTvlSnapshot]);

  const v3VolumeChart = useMemo(() => {
    const base = v3PoolSeries
      .map((row) => ({ date: row.date, value: row.volumeUsd }))
      .filter((row) => Number.isFinite(row.value));
    return buildSeriesChart(base);
  }, [v3PoolSeries]);

  const v3FeesChart = useMemo(() => {
    const feeRate = Number(v3FeeTier) / 1_000_000;
    const base = v3PoolSeries
      .map((row) => {
        const fees =
          row.feesUsd !== null && row.feesUsd !== undefined
            ? row.feesUsd
            : row.volumeUsd !== null && Number.isFinite(row.volumeUsd) && feeRate
            ? row.volumeUsd * feeRate
            : null;
        return { date: row.date, value: fees };
      })
      .filter((row) => Number.isFinite(row.value));
    return buildSeriesChart(base);
  }, [v3PoolSeries, v3FeeTier]);

  const v3LatestPoolRow = useMemo(() => {
    if (!v3PoolSeriesRaw.length) return null;
    return v3PoolSeriesRaw[v3PoolSeriesRaw.length - 1];
  }, [v3PoolSeriesRaw]);

  const v3PoolDailyFeesUsd = useMemo(() => {
    const feeRate = Number(v3FeeTier) / 1_000_000;
    if (v3LatestPoolRow) {
      if (
        v3LatestPoolRow.feesUsd !== null &&
        v3LatestPoolRow.feesUsd !== undefined &&
        Number.isFinite(v3LatestPoolRow.feesUsd)
      ) {
        return Number(v3LatestPoolRow.feesUsd);
      }
      const volume = v3LatestPoolRow.volumeUsd;
      if (volume !== null && volume !== undefined && Number.isFinite(volume) && feeRate) {
        return volume * feeRate;
      }
    }
    if (v3PoolHourStats) {
      if (
        v3PoolHourStats.feesUsd !== null &&
        v3PoolHourStats.feesUsd !== undefined &&
        Number.isFinite(v3PoolHourStats.feesUsd)
      ) {
        return Number(v3PoolHourStats.feesUsd);
      }
      const volume = v3PoolHourStats.volumeUsd;
      if (volume !== null && volume !== undefined && Number.isFinite(volume) && feeRate) {
        return volume * feeRate;
      }
    }
    return null;
  }, [v3LatestPoolRow, v3PoolHourStats, v3FeeTier]);

  const v3PoolLatestTvlUsd = useMemo(() => {
    if (v3LatestPoolRow?.tvlUsd !== null && v3LatestPoolRow?.tvlUsd !== undefined) {
      const tvl = Number(v3LatestPoolRow.tvlUsd);
      if (Number.isFinite(tvl) && tvl > 0) return tvl;
    }
    const snapshot = safeNumber(v3PoolTvlSnapshot);
    if (snapshot !== null && snapshot > 0) return snapshot;
    if (
      v3PoolHourStats?.tvlUsd !== null &&
      v3PoolHourStats?.tvlUsd !== undefined &&
      Number.isFinite(v3PoolHourStats.tvlUsd) &&
      v3PoolHourStats.tvlUsd > 0
    ) {
      return Number(v3PoolHourStats.tvlUsd);
    }
    const balance0 = v3PoolIsReversed ? v3PoolBalances.token1 : v3PoolBalances.token0;
    const balance1 = v3PoolIsReversed ? v3PoolBalances.token0 : v3PoolBalances.token1;
    const balance0Num = safeNumber(balance0);
    const balance1Num = safeNumber(balance1);
    const symbol0 = v3Token0Meta?.symbol || v3Token0;
    const symbol1 = v3Token1Meta?.symbol || v3Token1;
    const price0 = safeNumber(v3Token0PriceUsd);
    const price1 = safeNumber(v3Token1PriceUsd);
    let usd0 =
      price0 !== null && price0 > 0 ? price0 : isStableSymbol(symbol0) ? 1 : null;
    let usd1 =
      price1 !== null && price1 > 0 ? price1 : isStableSymbol(symbol1) ? 1 : null;
    const refPrice = safeNumber(v3ReferencePrice);
    if (usd0 === null && usd1 !== null && refPrice !== null && refPrice > 0) {
      usd0 = usd1 * refPrice;
    }
    if (usd1 === null && usd0 !== null && refPrice !== null && refPrice > 0) {
      usd1 = usd0 / refPrice;
    }
    const tvl0 = balance0Num !== null && usd0 !== null ? balance0Num * usd0 : null;
    const tvl1 = balance1Num !== null && usd1 !== null ? balance1Num * usd1 : null;
    if (tvl0 !== null && tvl1 !== null) return tvl0 + tvl1;
    if (tvl0 !== null) return tvl0;
    if (tvl1 !== null) return tvl1;
    return null;
  }, [
    v3LatestPoolRow,
    v3PoolTvlSnapshot,
    v3PoolHourStats,
    v3PoolBalances,
    v3PoolIsReversed,
    v3Token0PriceUsd,
    v3Token1PriceUsd,
    v3Token0Meta,
    v3Token1Meta,
    v3Token0,
    v3Token1,
    v3ReferencePrice,
  ]);

  const v3BaseApr = useMemo(() => {
    if (
      v3PoolDailyFeesUsd === null ||
      v3PoolDailyFeesUsd === undefined ||
      v3PoolLatestTvlUsd === null ||
      v3PoolLatestTvlUsd === undefined ||
      v3PoolLatestTvlUsd <= 0
    ) {
      return null;
    }
    return (v3PoolDailyFeesUsd * 365 * 100) / v3PoolLatestTvlUsd;
  }, [v3PoolDailyFeesUsd, v3PoolLatestTvlUsd]);

  const v3RangeBoost = useMemo(() => {
    if (!v3HasCustomRange || !v3ReferencePrice) return 1;
    const width = v3RangeUpperNum - v3RangeLowerNum;
    if (!Number.isFinite(width) || width <= 0) return 1;
    const relativeWidth = width / v3ReferencePrice;
    if (!Number.isFinite(relativeWidth) || relativeWidth <= 0) return 1;
    const rawBoost = 1 / relativeWidth;
    return Math.min(25, Math.max(0.2, rawBoost));
  }, [v3HasCustomRange, v3RangeLowerNum, v3RangeUpperNum, v3ReferencePrice]);

  const v3EstimatedApr = useMemo(() => {
    if (v3BaseApr === null || v3BaseApr === undefined) return null;
    if (v3RangeSide !== "dual") return 0;
    const boost = v3HasCustomRange ? v3RangeBoost : 1;
    return v3BaseApr * boost;
  }, [v3BaseApr, v3RangeSide, v3HasCustomRange, v3RangeBoost]);

  const v3PriceChart = useMemo(() => {
    const base = v3PriceSeriesSource
      .map((row) => {
        let price = v3PoolIsReversed ? row.token0Price : row.token1Price;
        if (!Number.isFinite(price) || price <= 0) {
          const alt = v3PoolIsReversed ? row.token1Price : row.token0Price;
          if (Number.isFinite(alt) && alt > 0) {
            price = 1 / alt;
          }
        }
        return { date: row.date, value: price };
      })
      .filter((row) => Number.isFinite(row.value) && row.value > 0);
    const snapshot = safeNumber(
      v3CurrentPrice !== null && v3CurrentPrice !== undefined
        ? v3CurrentPrice
        : v3SubgraphCurrentPrice
    );
    const merged =
      snapshot !== null && snapshot > 0 ? mergeSeriesSnapshot(base, snapshot) : base;
    return buildSeriesChart(merged);
  }, [
    v3PriceSeriesSource,
    v3PoolIsReversed,
    v3CurrentPrice,
    v3SubgraphCurrentPrice,
  ]);

  const v3PriceSeriesFallback = useMemo(() => {
    if (v3PriceChart) return [];
    if (!v3ReferencePrice || !Number.isFinite(v3ReferencePrice)) return [];
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    return Array.from({ length: 6 }, (_, idx) => ({
      date: now - (5 - idx) * 7 * day,
      value: v3ReferencePrice,
    }));
  }, [v3PriceChart, v3ReferencePrice]);

  const v3PriceChartDisplay = useMemo(() => {
    if (v3PriceChart) return v3PriceChart;
    if (v3PriceSeriesFallback.length) {
      return buildSeriesChart(v3PriceSeriesFallback);
    }
    return null;
  }, [v3PriceChart, v3PriceSeriesFallback]);

  const v3PriceRangeChartDisplay = useMemo(() => {
    if (!v3PriceChartDisplay?.points?.length || !v3Chart) return v3PriceChartDisplay;
    const min = v3Chart.min;
    const max = v3Chart.max;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      return v3PriceChartDisplay;
    }
    const latest = safeNumber(v3PriceChartDisplay.latest);
    const current = safeNumber(
      v3CurrentPrice !== null && v3CurrentPrice !== undefined
        ? v3CurrentPrice
        : v3SubgraphCurrentPrice !== null && v3SubgraphCurrentPrice !== undefined
        ? v3SubgraphCurrentPrice
        : v3ReferencePrice
    );
    const scale =
      latest !== null && latest > 0 && current !== null && current > 0 ? current / latest : 1;
    const points = v3PriceChartDisplay.points.map((point) => {
      const value = Number.isFinite(point.value) ? point.value * scale : point.value;
      const rawY = 100 - ((value - min) / (max - min)) * 100;
      const y = clampPercent(rawY);
      return { ...point, value, y };
    });
    const line = points
      .map((point, idx) => `${idx === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ");
    return {
      ...v3PriceChartDisplay,
      latest: latest !== null ? latest * scale : v3PriceChartDisplay.latest,
      points,
      line,
      area: `${line} L 100 100 L 0 100 Z`,
    };
  }, [v3PriceChartDisplay, v3Chart, v3CurrentPrice, v3SubgraphCurrentPrice, v3ReferencePrice]);

  const v3PriceAxisTicks = useMemo(() => {
    const series = v3PriceSeriesFallback.length ? v3PriceSeriesFallback : v3PriceSeriesSource;
    if (!series.length) return [];
    const steps = [0, 0.33, 0.66, 1];
    return steps
      .map((ratio) => {
        const idx = Math.min(series.length - 1, Math.max(0, Math.round((series.length - 1) * ratio)));
        const item = series[idx];
        if (!item || !Number.isFinite(item.date)) return null;
        return {
          label: formatShortDate(item.date),
          pct: ratio * 100,
        };
      })
      .filter(Boolean);
  }, [v3PriceSeriesSource, v3PriceSeriesFallback]);

  const showV3PriceRangeChart = v3ChartMode === "price-range";
  const showV3TvlChart = v3ChartMode === "tvl";
  const showV3PriceChart = v3ChartMode === "price";
  const showV3VolumeChart = v3ChartMode === "volume";
  const showV3FeesChart = v3ChartMode === "fees";
  const showV3MetricChart =
    showV3TvlChart || showV3PriceChart || showV3VolumeChart || showV3FeesChart;

  const v3MetricChart = showV3TvlChart
    ? v3TvlChart
    : showV3PriceChart
    ? v3PriceChart
    : showV3VolumeChart
    ? v3VolumeChart
    : showV3FeesChart
    ? v3FeesChart
    : null;
  const v3MetricLabel = showV3TvlChart
    ? "TVL"
    : showV3PriceChart
    ? "Price"
    : showV3VolumeChart
    ? "Volume"
    : showV3FeesChart
    ? "Fees"
    : "";
  const v3MetricHasValue =
    v3MetricChart?.latest !== null && v3MetricChart?.latest !== undefined;
  const v3MetricValue = showV3PriceChart
    ? v3MetricHasValue
      ? formatPrice(v3MetricChart.latest)
      : "--"
    : v3MetricHasValue
    ? formatNumber(v3MetricChart.latest)
    : "--";
  const v3MetricSubLabel = showV3PriceChart ? `${v3Token1} per ${v3Token0}` : "";
  const v3MetricChange = v3MetricChart?.changePct ?? null;
  const v3MetricPalette = useMemo(() => {
    if (showV3PriceChart) {
      return {
        stroke: "#fbbf24",
        glow: "#f59e0b",
        from: "rgba(251,191,36,0.35)",
        to: "rgba(251,191,36,0.05)",
      };
    }
    if (showV3VolumeChart) {
      return {
        stroke: "#a855f7",
        glow: "#9333ea",
        from: "rgba(168,85,247,0.35)",
        to: "rgba(168,85,247,0.05)",
      };
    }
    if (showV3FeesChart) {
      return {
        stroke: "#34d399",
        glow: "#10b981",
        from: "rgba(52,211,153,0.35)",
        to: "rgba(52,211,153,0.05)",
      };
    }
    return {
      stroke: "#38bdf8",
      glow: "#0ea5e9",
      from: "rgba(56,189,248,0.35)",
      to: "rgba(14,165,233,0.05)",
    };
  }, [showV3FeesChart, showV3PriceChart, showV3VolumeChart]);

  const v3HoverValueLabel = useMemo(() => {
    if (!v3ChartHover || !Number.isFinite(v3ChartHover.value)) return "--";
    return v3ChartHover.isPrice
      ? formatPrice(v3ChartHover.value)
      : formatNumber(v3ChartHover.value);
  }, [v3ChartHover]);

  const v3HoverDateLabel = useMemo(() => {
    if (!v3ChartHover || !Number.isFinite(v3ChartHover.date)) return "";
    return formatShortDate(v3ChartHover.date);
  }, [v3ChartHover]);

  const renderV3HoverOverlay = useCallback(
    (source) => {
      if (!v3ChartHover || v3ChartHover.source !== source) return null;
      const isTodayLabel =
        Number.isFinite(v3ChartHover.date) &&
        formatShortDate(v3ChartHover.date) === formatShortDate(Date.now());
      const hidePriceDetails = Boolean(v3ChartHover.isPrice && isTodayLabel);
      const align =
        v3ChartHover.x <= 6 ? "left" : v3ChartHover.x >= 94 ? "right" : "center";
      const translate =
        align === "center"
          ? "-translate-x-1/2"
          : align === "right"
          ? "-translate-x-full"
          : "translate-x-0";
      const tooltipTop = Math.min(92, Math.max(6, v3ChartHover.y - 12));
      return (
        <div className="absolute inset-0 pointer-events-none z-30">
          <div
            className="absolute top-0 bottom-0 w-px bg-white/25"
            style={{ left: `${v3ChartHover.x}%` }}
          />
          <div
            className="absolute h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]"
            style={{
              left: `${v3ChartHover.x}%`,
              top: `${v3ChartHover.y}%`,
              transform: "translate(-50%, -50%)",
            }}
          />
          <div
            className={`absolute ${translate} rounded-lg border border-slate-700/80 bg-slate-950/95 px-2 py-1 text-[10px] text-slate-200 shadow-xl`}
            style={{ left: `${v3ChartHover.x}%`, top: `${tooltipTop}%` }}
          >
            {hidePriceDetails ? null : (
              <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">
                {v3ChartHover.label}
              </div>
            )}
            {hidePriceDetails ? null : (
              <div className="text-sm font-semibold text-slate-100">
                {v3HoverValueLabel}
              </div>
            )}
            {!hidePriceDetails && v3ChartHover.subLabel ? (
              <div className="text-[10px] text-slate-500">{v3ChartHover.subLabel}</div>
            ) : null}
            {v3HoverDateLabel ? (
              <div className="text-[10px] text-slate-500">{v3HoverDateLabel}</div>
            ) : null}
          </div>
        </div>
      );
    },
    [v3ChartHover, v3HoverValueLabel, v3HoverDateLabel]
  );

  const v3DepositRatio = useMemo(() => {
    const amount0Num = safeNumber(v3Amount0);
    const amount1Num = safeNumber(v3Amount1);
    if (!amount0Num && !amount1Num) return null;
    const v0 = amount0Num || 0;
    const v1 = amount1Num || 0;

    const refPrice = safeNumber(v3ReferencePrice);
    if (refPrice && refPrice > 0) {
      const value0 = v0 * refPrice;
      const total = value0 + v1;
      if (total > 0) {
        return {
          token0: value0 / total,
          token1: v1 / total,
        };
      }
    }

    const price0 = safeNumber(v3Token0PriceUsd);
    const price1 = safeNumber(v3Token1PriceUsd);
    if (price0 && price1) {
      const value0 = v0 * price0;
      const value1 = v1 * price1;
      const total = value0 + value1;
      if (total > 0) {
        return {
          token0: value0 / total,
          token1: value1 / total,
        };
      }
    }

    const total = v0 + v1;
    if (total <= 0) return null;
    return {
      token0: v0 / total,
      token1: v1 / total,
    };
  }, [v3Amount0, v3Amount1, v3ReferencePrice, v3Token0PriceUsd, v3Token1PriceUsd]);

  const v3TotalDeposit = useMemo(() => {
    const amount0Num = safeNumber(v3Amount0);
    const amount1Num = safeNumber(v3Amount1);
    if (!amount0Num && !amount1Num) return null;
    const v0 = amount0Num || 0;
    const v1 = amount1Num || 0;
    const refPrice = safeNumber(v3ReferencePrice);
    if (refPrice && refPrice > 0) {
      return { value: v0 * refPrice + v1, unit: v3Token1 };
    }
    const price0 = safeNumber(v3Token0PriceUsd);
    const price1 = safeNumber(v3Token1PriceUsd);
    if (price0 && price1) {
      return { value: v0 * price0 + v1 * price1, unit: "USD" };
    }
    return { value: v0 + v1, unit: v3Token1 };
  }, [v3Amount0, v3Amount1, v3ReferencePrice, v3Token0PriceUsd, v3Token1PriceUsd, v3Token1]);

  const adjustV3RangeValue = useCallback(
    (side, direction) => {
      if (!v3ReferencePrice || !Number.isFinite(v3ReferencePrice)) return;
      const step = v3ReferencePrice * 0.0001; // 0.01% step
      const lower = v3RangeLowerNum ?? v3ReferencePrice * (1 - 0.02);
      const upper = v3RangeUpperNum ?? v3ReferencePrice * (1 + 0.02);
      if (side === "lower") {
        const next = Math.max(0, lower + direction * step);
        const safeNext = upper ? Math.min(next, upper * 0.999) : next;
        setV3RangeMode("custom");
        setV3StrategyId("custom");
        setV3RangeLower(safeNext.toFixed(6));
      } else {
        const next = upper + direction * step;
        const safeNext = lower ? Math.max(next, lower * 1.001) : next;
        setV3RangeMode("custom");
        setV3StrategyId("custom");
        setV3RangeUpper(safeNext.toFixed(6));
      }
    },
    [v3ReferencePrice, v3RangeLowerNum, v3RangeUpperNum]
  );

  const zoomV3Range = useCallback(
    (direction) => {
      const order = ["1D", "1W", "1M", "1Y", "All"];
      const idx = order.indexOf(v3RangeTimeframe);
      if (idx === -1) return;
      const nextIdx =
        direction > 0 ? Math.max(0, idx - 1) : Math.min(order.length - 1, idx + 1);
      if (nextIdx === idx) return;
      setV3RangeTimeframe(order[nextIdx]);
    },
    [v3RangeTimeframe]
  );

  const fitV3RangeView = useCallback(() => {
    if (!v3ReferencePrice || !Number.isFinite(v3ReferencePrice)) return;
    const hasRange = v3HasCustomRange && v3RangeLowerNum && v3RangeUpperNum;
    const span = hasRange
      ? Math.max((v3RangeUpperNum - v3RangeLowerNum) / 2, v3ReferencePrice * 0.0005)
      : v3ReferencePrice * 0.05;
    let lower = v3ReferencePrice - span;
    let upper = v3ReferencePrice + span;
    if (lower <= 0) lower = v3ReferencePrice * 0.0005;
    if (upper <= lower) upper = lower * 1.01;
    setV3RangeMode("custom");
    setV3StrategyId("custom");
    setV3RangeInitialized(true);
    setV3RangeLower(lower.toFixed(6));
    setV3RangeUpper(upper.toFixed(6));
  }, [v3ReferencePrice, v3HasCustomRange, v3RangeLowerNum, v3RangeUpperNum]);

  const updateV3ChartHover = useCallback((event, chart, options) => {
    if (!chart?.points?.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const pctX = clampPercent(((event.clientX - rect.left) / rect.width) * 100);
    const idx = Math.round((pctX / 100) * (chart.points.length - 1));
    const point = chart.points[Math.min(chart.points.length - 1, Math.max(0, idx))];
    if (!point || !Number.isFinite(point.value)) return;
    if (options?.isPrice) {
      const isTodayLabel =
        Number.isFinite(point.date) &&
        formatShortDate(point.date) === formatShortDate(Date.now());
      if (isTodayLabel) {
        v3HoverIndexRef.current = { source: null, idx: null };
        setV3ChartHover(null);
        return;
      }
    }
    const prev = v3HoverIndexRef.current || {};
    if (prev.source === options.source && prev.idx === idx) return;
    v3HoverIndexRef.current = { source: options.source, idx };
    setV3ChartHover({
      source: options.source,
      x: point.x,
      y: point.y,
      value: point.value,
      date: point.date,
      label: options.label,
      subLabel: options.subLabel,
      isPrice: options.isPrice,
    });
  }, [setV3ChartHover, v3HoverIndexRef]);

  const clearV3ChartHover = useCallback(() => {
    v3HoverIndexRef.current = { source: null, idx: null };
    setV3ChartHover(null);
  }, [setV3ChartHover, v3HoverIndexRef]);

  useEffect(() => {
    clearV3ChartHover();
  }, [v3ChartMode, clearV3ChartHover]);

  const handleV3PriceRangeHover = useCallback(
    (event) => {
      if (!v3PriceRangeChartDisplay) return;
      updateV3ChartHover(event, v3PriceRangeChartDisplay, {
        source: "price-range",
        label: "Price",
        subLabel: `${v3Token1} per ${v3Token0}`,
        isPrice: true,
      });
    },
    [updateV3ChartHover, v3PriceRangeChartDisplay, v3Token0, v3Token1]
  );

  const handleV3MetricHover = useCallback(
    (event) => {
      if (!v3MetricChart) return;
      updateV3ChartHover(event, v3MetricChart, {
        source: "metric",
        label: v3MetricLabel,
        subLabel: showV3PriceChart ? `${v3Token1} per ${v3Token0}` : "",
        isPrice: showV3PriceChart,
      });
    },
    [
      updateV3ChartHover,
      v3MetricChart,
      v3MetricLabel,
      showV3PriceChart,
      v3Token0,
      v3Token1,
    ]
  );

  const v3Ratio0Pct = v3DepositRatio ? Math.round(v3DepositRatio.token0 * 100) : 0;
  const v3Ratio1Pct = v3DepositRatio ? Math.round(v3DepositRatio.token1 * 100) : 0;
  const v3HideChartControls = v3Token0Open || v3Token1Open;
  const v3PoolDataLoading = Boolean(
    isV3View && (v3PoolLoading || v3PoolTvlLoading)
  );
  const v3RangeTransition =
    v3DraggingHandle
      ? "transition-none"
      : "transition-[top,height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]";
  const v3RangeLineTransition =
    v3DraggingHandle
      ? "transition-none"
      : "transition-[top] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]";
  const v3PoolBalance0 = v3PoolIsReversed ? v3PoolBalances.token1 : v3PoolBalances.token0;
  const v3PoolBalance1 = v3PoolIsReversed ? v3PoolBalances.token0 : v3PoolBalances.token1;
  const v3PoolBalance0Num = safeNumber(v3PoolBalance0);
  const v3PoolBalance1Num = safeNumber(v3PoolBalance1);
  const v3PoolBalance0Usd =
    v3PoolBalance0Num !== null && v3Token0PriceUsd
      ? v3PoolBalance0Num * v3Token0PriceUsd
      : null;
  const v3PoolBalance1Usd =
    v3PoolBalance1Num !== null && v3Token1PriceUsd
      ? v3PoolBalance1Num * v3Token1PriceUsd
      : null;
  const v3PoolBalanceRatioBase0 =
    v3PoolBalance0Usd !== null && v3PoolBalance1Usd !== null
      ? v3PoolBalance0Usd
      : v3PoolBalance0Num;
  const v3PoolBalanceRatioBase1 =
    v3PoolBalance0Usd !== null && v3PoolBalance1Usd !== null
      ? v3PoolBalance1Usd
      : v3PoolBalance1Num;
  const v3PoolBalanceRatio0 =
    v3PoolBalanceRatioBase0 !== null &&
    v3PoolBalanceRatioBase1 !== null &&
    v3PoolBalanceRatioBase0 + v3PoolBalanceRatioBase1 > 0
      ? clampPercent(
          (v3PoolBalanceRatioBase0 /
            (v3PoolBalanceRatioBase0 + v3PoolBalanceRatioBase1)) *
            100
        )
      : 50;
  const v3PoolBalanceRatio1 = 100 - v3PoolBalanceRatio0;

  const getStatusStyle = (status) => {
    if (status === null) {
      return {
        label: "Loading",
        className: "bg-slate-700/40 text-slate-200 border-slate-600",
      };
    }
    if (status) {
      return {
        label: "Active",
        className:
          "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
      };
    }
    return {
      label: "Inactive",
      className: "bg-rose-500/10 text-rose-200 border-rose-500/25",
    };
  };

  useEffect(() => {
    if (!showV2) {
      setBasePools([]);
      setOnchainTokens({});
      return undefined;
    }
    if (!isV2View) return undefined;
    let cancelled = false;
    const loadBasePools = async () => {
      setPoolStatsReady(false);
      try {
        let provider = getReadOnlyProvider(false, true);
        let attempts = 0;
        while (attempts < 2) {
          try {
            // sanity check: ensure we're on the active chain
            const net = await provider.getNetwork();
            const activeChain = parseInt(getActiveNetworkConfig()?.chainIdHex || "0", 16);
            if (activeChain && Number(net?.chainId || 0) !== activeChain) {
              throw new Error("Wrong RPC chain");
            }
            break;
          } catch (err) {
            attempts += 1;
            rotateRpcProvider();
            provider = getReadOnlyProvider(true, true);
            if (attempts >= 2) throw err;
          }
        }
        const factory = new Contract(
          UNIV2_FACTORY_ADDRESS,
          UNIV2_FACTORY_ABI,
          provider
        );
        const registryForLookup = filterLiquidityRegistry({ ...TOKENS, ...customTokens });

        const lengthRaw = await factory.allPairsLength();
        const total = Number(lengthRaw || 0);
        const tokenMap = {};

        const matchRegistryToken = (addr) => {
          const lower = (addr || "").toLowerCase();
          const found = Object.values(registryForLookup).find(
            (t) => t.address && t.address.toLowerCase() === lower
          );
          return found || null;
        };

        const fetchTokenMeta = async (addr, idx, suffix) => {
          const known = matchRegistryToken(addr);
          if (known) return known;
          const erc = new Contract(addr, ERC20_ABI, provider);
          const [symbolRaw, nameRaw, decimalsRaw] = await Promise.all([
            erc.symbol().catch(() => `TOKEN-${idx}-${suffix}`),
            erc.name().catch(() => `Token-${idx}-${suffix}`),
            erc.decimals().catch(() => 18),
          ]);
          const symbol = (symbolRaw || `TOKEN-${idx}-${suffix}`).toUpperCase();
          return {
            symbol,
            name: nameRaw || symbol,
            address: addr,
            decimals: Number(decimalsRaw) || 18,
            logo: TOKENS.CRX.logo,
          };
        };

        const poolsFromChain = [];
        const indices = Array.from({ length: total }, (_, i) => i);
        await runWithConcurrency(indices, 6, async (i) => {
          try {
            const pairAddress = await factory.allPairs(i);
            const pair = new Contract(pairAddress, UNIV2_PAIR_ABI, provider);
            const [token0, token1] = await Promise.all([
              pair.token0(),
              pair.token1(),
            ]);
            const [meta0, meta1] = await Promise.all([
              fetchTokenMeta(token0, i, "a"),
              fetchTokenMeta(token1, i, "b"),
            ]);

            if (isLiquidityTokenBlocked(meta0) || isLiquidityTokenBlocked(meta1)) return;

            tokenMap[meta0.symbol] = tokenMap[meta0.symbol] || meta0;
            tokenMap[meta1.symbol] = tokenMap[meta1.symbol] || meta1;

            const id = `${meta0.symbol.toLowerCase()}-${meta1.symbol.toLowerCase()}`;
            poolsFromChain.push({
              id,
              token0Symbol: meta0.symbol,
              token1Symbol: meta1.symbol,
              poolType: "volatile",
              token0Address: meta0.address,
              token1Address: meta1.address,
              token0Decimals: meta0.decimals,
              token1Decimals: meta1.decimals,
              token0Logo: meta0.logo,
              token1Logo: meta1.logo,
            });
          } catch {
            // ignore per-pair errors
          }
        });

        const seen = new Set();
        const deduped = [];
        poolsFromChain.forEach((p) => {
          if (seen.has(p.id)) return;
          seen.add(p.id);
          deduped.push(p);
        });
        setBasePools((prev) => {
          const map = new Map((prev || []).map((p) => [p.id, p]));
          deduped.forEach((p) => {
            const existing = map.get(p.id) || {};
            map.set(p.id, { ...existing, ...p });
          });
          return Array.from(map.values());
        });
        setOnchainTokens((prev) => ({ ...(prev || {}), ...tokenMap }));
      } catch (err) {
        if (!cancelled) {
          // Keep the last known pools on transient RPC failures.
          console.warn("Failed to refresh V2 pools:", err?.message || err);
        }
      }
      if (!cancelled) setPoolStatsReady(true);
    };
    loadBasePools();
    return () => {
      cancelled = true;
    };
  }, [customTokens, lpRefreshTick, showV2, isV2View]);

  useEffect(() => {
    let cancelled = false;
    const loadV3Positions = async () => {
      if (!isV3View) return;
      if (!address || !hasV3Liquidity) {
        setV3Positions([]);
        setV3PositionsError("");
        return;
      }
      setV3PositionsLoading(true);
      setV3PositionsError("");
      try {
        const provider = getReadOnlyProvider(false, true);
        const manager = new Contract(
          UNIV3_POSITION_MANAGER_ADDRESS,
          UNIV3_POSITION_MANAGER_ABI,
          provider
        );
        const balanceRaw = await manager.balanceOf(address);
        const count = Math.min(Number(balanceRaw || 0), 50);
        if (!count) {
          if (!cancelled) setV3Positions([]);
          return;
        }
        const ids = await Promise.all(
          Array.from({ length: count }, (_, idx) =>
            manager.tokenOfOwnerByIndex(address, idx)
          )
        );
        const positions = await Promise.all(ids.map((id) => manager.positions(id)));
        const feesById = new Map();
        const collectParamsFor = (id) => ({
          tokenId: id,
          recipient: address,
          amount0Max: MAX_UINT128,
          amount1Max: MAX_UINT128,
        });
        const tryCollectStatic = async (mgr, id) => {
          try {
            const params = collectParamsFor(id);
            const res = await mgr.collect.staticCall(params, { from: address });
            const amount0 = res?.amount0 ?? res?.[0] ?? 0n;
            const amount1 = res?.amount1 ?? res?.[1] ?? 0n;
            return { amount0, amount1 };
          } catch {
            return null;
          }
        };
        let primaryManager = manager;
        try {
          const walletProvider = await getProvider();
          const signer = await walletProvider.getSigner();
          primaryManager = new Contract(
            UNIV3_POSITION_MANAGER_ADDRESS,
            UNIV3_POSITION_MANAGER_ABI,
            signer
          );
        } catch {
          // fallback to read-only manager
        }
        await runWithConcurrency(ids, 4, async (id) => {
          let collected = await tryCollectStatic(primaryManager, id);
          if (!collected && primaryManager !== manager) {
            collected = await tryCollectStatic(manager, id);
          }
          if (collected) {
            feesById.set(id?.toString?.() || String(id), {
              tokensOwed0: collected.amount0,
              tokensOwed1: collected.amount1,
            });
          }
        });
        if (cancelled) return;
        const mapped = positions.map((pos, idx) => {
          const token0 = pos?.token0;
          const token1 = pos?.token1;
          const meta0 = findTokenMetaByAddress(token0);
          const meta1 = findTokenMetaByAddress(token1);
          const idStr = ids[idx]?.toString?.() || String(ids[idx]);
          const feeSnapshot = feesById.get(idStr);
          return {
            tokenId: idStr,
            token0,
            token1,
            token0Symbol: meta0?.symbol || shortenAddress(token0),
            token1Symbol: meta1?.symbol || shortenAddress(token1),
            fee: Number(pos?.fee ?? 0),
            tickLower: Number(pos?.tickLower ?? 0),
            tickUpper: Number(pos?.tickUpper ?? 0),
            liquidity: pos?.liquidity ?? 0n,
            tokensOwed0: feeSnapshot?.tokensOwed0 ?? pos?.tokensOwed0 ?? 0n,
            tokensOwed1: feeSnapshot?.tokensOwed1 ?? pos?.tokensOwed1 ?? 0n,
          };
        });
        setV3Positions(mapped);
      } catch (err) {
        if (cancelled) return;
        setV3PositionsError(
          compactRpcMessage(err?.message || err, "Unable to load positions.")
        );
      } finally {
        if (!cancelled) setV3PositionsLoading(false);
      }
    };
    loadV3Positions();
    return () => {
      cancelled = true;
    };
  }, [isV3View, address, hasV3Liquidity, findTokenMetaByAddress, v3RefreshTick]);

  const selectedPosition = useMemo(() => {
    if (!selectedPositionId) return null;
    return (
      v3Positions.find((p) => String(p.tokenId) === String(selectedPositionId)) || null
    );
  }, [selectedPositionId, v3Positions]);
  const closedPositionsCount = useMemo(
    () => v3Positions.filter((p) => (p?.liquidity ?? 0n) <= 0n).length,
    [v3Positions]
  );
  const visibleV3Positions = useMemo(() => {
    if (v3ShowClosedPositions) return v3Positions;
    return v3Positions.filter((p) => (p?.liquidity ?? 0n) > 0n);
  }, [v3Positions, v3ShowClosedPositions]);

  useEffect(() => {
    if (v3ShowClosedPositions || !selectedPositionId) return;
    const selected = v3Positions.find(
      (p) => String(p.tokenId) === String(selectedPositionId)
    );
    if (selected && (selected?.liquidity ?? 0n) <= 0n) {
      setSelectedPositionId(null);
    }
  }, [v3ShowClosedPositions, selectedPositionId, v3Positions]);

  useEffect(() => {
    setShowNftDebug(false);
  }, [selectedPositionId]);

  useEffect(() => {
    nftMetaRef.current = nftMetaById;
  }, [nftMetaById]);

  useEffect(() => {
    if (!selectedPositionId) return;
    const exists = v3Positions.some(
      (p) => String(p.tokenId) === String(selectedPositionId)
    );
    if (!exists) setSelectedPositionId(null);
  }, [selectedPositionId, v3Positions]);

  useEffect(() => {
    let cancelled = false;
    const loadNftMeta = async () => {
      if (!selectedPositionId || !hasV3Liquidity) return;
      const cached = nftMetaRef.current[selectedPositionId];
      if (cached?.meta || cached?.loading) return;
      setNftMetaById((prev) => ({
        ...prev,
        [selectedPositionId]: {
          loading: true,
          error: "",
          meta: null,
          raw: "",
          metaUrl: "",
          image: "",
        },
      }));
      try {
        const provider = getReadOnlyProvider(false, true);
        const manager = new Contract(
          UNIV3_POSITION_MANAGER_ADDRESS,
          UNIV3_POSITION_MANAGER_ABI,
          provider
        );
        const raw = await withTimeout(
          manager.tokenURI(selectedPositionId),
          8000,
          "tokenURI"
        );
        if (cancelled) return;
        const rawTokenUri = typeof raw === "string" ? raw : "";
        let parsed = parseTokenUri(raw);
        let metaUrl = "";
        if (!parsed && raw) {
          const candidates = buildIpfsCandidates(raw);
          for (const url of candidates) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 8000);
              const res = await fetch(url, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (res.ok) {
                parsed = await res.json();
                metaUrl = url;
                break;
              }
            } catch {
              // ignore fetch errors
            }
          }
        }
        let image = resolveImageFromMeta(parsed);
        if (!image) {
          image = guessImageUri(raw);
        }
        const meta = parsed ? { ...parsed, image } : image ? { image } : null;
        setNftMetaById((prev) => ({
          ...prev,
          [selectedPositionId]: {
            loading: false,
            error: "",
            meta,
            raw: rawTokenUri,
            metaUrl,
            image,
          },
        }));
      } catch (err) {
        if (cancelled) return;
        setNftMetaById((prev) => ({
          ...prev,
          [selectedPositionId]: {
            loading: false,
            error: compactRpcMessage(err?.message || err, "Unable to load NFT metadata."),
            meta: null,
            raw: "",
            metaUrl: "",
            image: "",
          },
        }));
      }
    };
    loadNftMeta();
    return () => {
      cancelled = true;
    };
  }, [selectedPositionId, hasV3Liquidity, nftMetaRefreshTick]);

  const v3FeeTierLockedRef = useRef(false);

  useEffect(() => {
    v3FeeTierLockedRef.current = false;
  }, [v3Token0, v3Token1]);

  useEffect(() => {
    let cancelled = false;
    const loadV3PoolInfo = async () => {
      if (!v3PoolQueryKey) {
        if (!cancelled) {
          setV3PoolInfo({
            address: "",
            token0: "",
            token1: "",
            tick: null,
            sqrtPriceX96: null,
            spacing: null,
          });
          setV3PoolError("");
        }
        return;
      }
      const [token0Addr, token1Addr, feeRaw] = v3PoolQueryKey.split("|");
      const [sorted0, sorted1] = sortAddressPair(token0Addr, token1Addr);
      setV3PoolLoading(true);
      setV3PoolError("");
      try {
        const provider = getReadOnlyProvider(false, true);
        const factory = new Contract(UNIV3_FACTORY_ADDRESS, UNIV3_FACTORY_ABI, provider);
        const fee = Number(feeRaw || 0);
        const poolAddr = await factory.getPool(
          sorted0,
          sorted1,
          fee
        );
        if (!poolAddr || poolAddr === ZERO_ADDRESS) {
          if (!v3FeeTierLockedRef.current) {
            const fallbackFees = V3_FEE_OPTIONS.map((opt) => opt.fee).filter(
              (optFee) => optFee !== fee
            );
            for (const candidate of fallbackFees) {
              const candidateAddr = await factory.getPool(sorted0, sorted1, candidate);
              if (candidateAddr && candidateAddr !== ZERO_ADDRESS) {
                if (!cancelled) setV3FeeTier(candidate);
                return;
              }
            }
          }
          if (!cancelled) {
            setV3PoolInfo({
              address: "",
              token0: "",
              token1: "",
              tick: null,
              sqrtPriceX96: null,
              spacing: null,
            });
            setV3PoolError("Pool not deployed yet for this pair/tier.");
          }
          return;
        }
        const pool = new Contract(poolAddr, UNIV3_POOL_ABI, provider);
        const [slot0, token0, token1, spacing] = await Promise.all([
          pool.slot0(),
          pool.token0(),
          pool.token1(),
          pool.tickSpacing(),
        ]);
        if (cancelled) return;
        setV3PoolInfo({
          address: poolAddr,
          token0,
          token1,
          tick: Number(slot0?.tick ?? 0),
          sqrtPriceX96: slot0?.sqrtPriceX96 ?? null,
          spacing: Number(spacing ?? 0),
        });
      } catch (err) {
        if (!cancelled) {
          setV3PoolInfo({
            address: "",
            token0: "",
            token1: "",
            tick: null,
            sqrtPriceX96: null,
            spacing: null,
          });
          setV3PoolError(
            compactRpcMessage(err?.message || err, "Unable to load pool price.")
          );
        }
      } finally {
        if (!cancelled) setV3PoolLoading(false);
      }
    };
    loadV3PoolInfo();
    return () => {
      cancelled = true;
    };
  }, [v3PoolQueryKey]);

  useEffect(() => {
    if (!isV3View || !v3PoolInfo.address) return undefined;
    const id = setInterval(() => {
      setV3TvlRefreshTick((t) => t + 1);
    }, 25000);
    return () => clearInterval(id);
  }, [isV3View, v3PoolInfo.address]);

  useEffect(() => {
    let cancelled = false;
    const loadV3PoolTvl = async () => {
      if (!isV3View || !hasV3Liquidity || !v3PoolInfo.address) {
        if (!cancelled) {
          setV3PoolTvlHistory([]);
          setV3PoolTvlSnapshot(null);
          setV3PoolTvlError("");
          setV3PoolTvlLoading(false);
          setV3TokenPriceHistory([]);
          setV3TokenPriceKey("");
          setV3PoolHourStats(null);
        }
        return;
      }
      setV3PoolTvlLoading(true);
      setV3PoolTvlError("");
      try {
        const [history, snapshot, hourStats] = await Promise.all([
          fetchV3PoolHistory(v3PoolInfo.address, v3RangeDays),
          fetchV3PoolSnapshot(v3PoolInfo.address),
          fetchV3PoolHourStats(v3PoolInfo.address, 24).catch(() => null),
        ]);
        if (cancelled) return;
        const historyRows = Array.isArray(history) ? history : [];
        setV3PoolTvlHistory(historyRows);
        const nextSnapshot =
          snapshot && Number.isFinite(Number(snapshot.tvlUsd))
            ? Number(snapshot.tvlUsd)
            : null;
        setV3PoolTvlSnapshot(nextSnapshot);
        setV3PoolHourStats(hourStats || null);

        const stable0 = isStableSymbol(v3Token0Meta?.symbol || v3Token0);
        const stable1 = isStableSymbol(v3Token1Meta?.symbol || v3Token1);
        const stablePair = stable0 || stable1;
        const flatPrice = isFlatHistory(historyRows);
        const insufficientHistory =
          historyRows.length < Math.min(v3RangeDays * 0.5, 30);
        const hasPoolTokens = Boolean(v3PoolInfo.token0 && v3PoolInfo.token1);
        const fallbackNeeded = stablePair && (flatPrice || insufficientHistory) && hasPoolTokens;
        const poolToken0IsEthLike = isEthLikeAddress(v3PoolInfo.token0);
        const poolToken1IsEthLike = isEthLikeAddress(v3PoolInfo.token1);
        const chainlinkEligible =
          stablePair &&
          Boolean(CHAINLINK_ETH_USD_FEED_ADDRESS) &&
          ((poolToken0IsEthLike && stable1) || (poolToken1IsEthLike && stable0));
        const {
          key: cachedKey,
          sig: cachedSig,
          len: cachedLen,
          history: cachedHistory,
        } = v3TokenPriceCacheRef.current;

        let nextHistory = [];
        let nextKey = "";

        if (chainlinkEligible) {
          const chainlinkKey = `chainlink-${CHAINLINK_ETH_USD_FEED_ADDRESS}-${v3RangeDays}-${
            poolToken0IsEthLike ? "0" : "1"
          }`;
          if (cachedKey === chainlinkKey && cachedHistory.length) {
            nextHistory = cachedHistory;
            nextKey = chainlinkKey;
          } else {
            const provider = getChainlinkProvider();
            const chainlinkHistory = await fetchChainlinkEthUsdHistory({
              feed: CHAINLINK_ETH_USD_FEED_ADDRESS,
              days: v3RangeDays,
              provider,
              poolToken0IsEthLike,
            });
            if (chainlinkHistory.length) {
              nextHistory = chainlinkHistory;
              nextKey = chainlinkKey;
            }
          }
        }

        if (!nextKey && fallbackNeeded) {
          const tokenKey = `${v3PoolInfo.token0}-${v3PoolInfo.token1}-${v3RangeDays}`;
          let tokenHistory = [];
          if (cachedKey === tokenKey && cachedHistory.length) {
            tokenHistory = cachedHistory;
          } else {
            tokenHistory = await fetchV3TokenPairHistory(
              v3PoolInfo.token0,
              v3PoolInfo.token1,
              v3RangeDays
            );
          }
          if (tokenHistory.length) {
            nextHistory = tokenHistory;
            nextKey = tokenKey;
          }
        }

        if (!cancelled) {
          const nextSig = buildHistorySignature(nextHistory);
          if (nextKey) {
            const shouldUpdate = nextKey !== cachedKey || cachedSig !== nextSig;
            if (shouldUpdate) {
              setV3TokenPriceHistory(Array.isArray(nextHistory) ? nextHistory : []);
              setV3TokenPriceKey(nextKey);
            }
          } else if (cachedKey || cachedLen) {
            setV3TokenPriceHistory([]);
            setV3TokenPriceKey("");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setV3PoolTvlHistory([]);
          setV3PoolTvlSnapshot(null);
          setV3PoolTvlError(err?.message || "Failed to load TVL data.");
          setV3TokenPriceHistory([]);
          setV3TokenPriceKey("");
          setV3PoolHourStats(null);
        }
      } finally {
        if (!cancelled) setV3PoolTvlLoading(false);
      }
    };
    loadV3PoolTvl();
    return () => {
      cancelled = true;
    };
  }, [
    isV3View,
    hasV3Liquidity,
    v3PoolInfo.address,
    v3PoolInfo.token0,
    v3PoolInfo.token1,
    v3RangeDays,
    v3Token0Meta,
    v3Token1Meta,
    v3Token0,
    v3Token1,
    v3TokenPriceCacheRef,
    v3TvlRefreshTick,
    v3RefreshTick,
  ]);

  useEffect(() => {
    let cancelled = false;
    const loadV3PoolBalances = async () => {
      if (!isV3View || !hasV3Liquidity || !v3PoolInfo.address) {
        if (!cancelled) {
          setV3PoolBalances({ token0: null, token1: null });
        }
        return;
      }
      if (!v3PoolInfo.token0 || !v3PoolInfo.token1) {
        if (!cancelled) {
          setV3PoolBalances({ token0: null, token1: null });
        }
        return;
      }
      try {
        const provider = getReadOnlyProvider(false, true);
        if (!provider) throw new Error("Missing provider");
        const iface = new Interface(ERC20_ABI);
        const calls = [
          {
            target: v3PoolInfo.token0,
            callData: iface.encodeFunctionData("balanceOf", [v3PoolInfo.address]),
          },
          {
            target: v3PoolInfo.token1,
            callData: iface.encodeFunctionData("balanceOf", [v3PoolInfo.address]),
          },
        ];

        let results = [];
        if (await hasMulticall(provider).catch(() => false)) {
          results = await multicall(calls, provider);
        } else {
          results = await Promise.all(
            calls.map(async (call) => {
              try {
                const erc = new Contract(call.target, ERC20_ABI, provider);
                const bal = await erc.balanceOf(v3PoolInfo.address);
                return {
                  success: true,
                  returnData: iface.encodeFunctionResult("balanceOf", [bal]),
                };
              } catch {
                return { success: false, returnData: "0x" };
              }
            })
          );
        }

        const [dec0, dec1] = await Promise.all([
          readDecimals(provider, v3PoolInfo.token0, v3PoolToken0Meta),
          readDecimals(provider, v3PoolInfo.token1, v3PoolToken1Meta),
        ]);

        let balance0 = null;
        let balance1 = null;
        if (results?.[0]?.success) {
          try {
            const raw = iface.decodeFunctionResult("balanceOf", results[0].returnData)[0];
            balance0 = Number(formatUnits(raw, dec0));
          } catch {
            balance0 = null;
          }
        }
        if (results?.[1]?.success) {
          try {
            const raw = iface.decodeFunctionResult("balanceOf", results[1].returnData)[0];
            balance1 = Number(formatUnits(raw, dec1));
          } catch {
            balance1 = null;
          }
        }

        if (!cancelled) {
          setV3PoolBalances({ token0: balance0, token1: balance1 });
        }
      } catch {
        if (!cancelled) {
          setV3PoolBalances({ token0: null, token1: null });
        }
      }
    };
    loadV3PoolBalances();
    return () => {
      cancelled = true;
    };
  }, [
    isV3View,
    hasV3Liquidity,
    v3PoolInfo.address,
    v3PoolInfo.token0,
    v3PoolInfo.token1,
    v3PoolToken0Meta,
    v3PoolToken1Meta,
    readDecimals,
    v3RefreshTick,
    v3PoolBalanceTick,
  ]);

  useEffect(() => {
    let cancelled = false;
    const loadPoolMetrics = async () => {
      if (!isV3View) return;
      if (!hasV3Liquidity || !v3Positions.length) {
        if (!cancelled) setV3PoolMetrics({});
        return;
      }
      try {
        const provider = getReadOnlyProvider(false, true);
        const factory = new Contract(UNIV3_FACTORY_ADDRESS, UNIV3_FACTORY_ABI, provider);
        const uniqueKeys = Array.from(
          new Set(
            v3Positions.map(
              (pos) => `${pos.token0?.toLowerCase()}-${pos.token1?.toLowerCase()}-${pos.fee}`
            )
          )
        );
        const results = await runWithConcurrency(uniqueKeys, 3, async (key) => {
          const [token0, token1, feeRaw] = key.split("-");
          const fee = Number(feeRaw || 0);
          const poolAddr = await factory.getPool(token0, token1, fee);
          if (!poolAddr || poolAddr === ZERO_ADDRESS) return [key, null];
          const pool = new Contract(poolAddr, UNIV3_POOL_ABI, provider);
          const [slot0, spacing] = await Promise.all([pool.slot0(), pool.tickSpacing()]);
          return [
            key,
            {
              address: poolAddr,
              tick: Number(slot0?.tick ?? 0),
              sqrtPriceX96: slot0?.sqrtPriceX96 ?? null,
              spacing: Number(spacing ?? 0),
            },
          ];
        });
        if (cancelled) return;
        const next = {};
        results.forEach((entry) => {
          if (!entry) return;
          const [key, value] = entry;
          if (value) next[key] = value;
        });
        setV3PoolMetrics(next);
      } catch {
        if (!cancelled) setV3PoolMetrics({});
      }
    };
    loadPoolMetrics();
    return () => {
      cancelled = true;
    };
  }, [isV3View, hasV3Liquidity, v3Positions]);

  useEffect(() => {
    if (!basePools.length) return;
    setSelectedPoolId((prev) => {
      // Preserve any existing selection (including custom pairs not yet on-chain).
      if (prev) return prev;
      const first = basePools[0];
      return first ? first.id : prev;
    });
  }, [basePools]);

  useEffect(() => {
    let cancelled = false;
    const loadTokenPrices = async () => {
      const addrs = Object.values(tokenRegistry)
        .map((t) => t.address)
        .filter(Boolean);
      if (!addrs.length) {
        setTokenPrices({});
        return;
      }
      const cachedRegistryPrices =
        queryClient.getQueryData(["token-prices", "registry"]) || null;
      if (!cancelled && cachedRegistryPrices) {
        setTokenPrices(cachedRegistryPrices);
      }
      try {
        const prices = await fetchTokenPrices(addrs);
        if (!cancelled) {
          const merged = {
            ...(cachedRegistryPrices || {}),
            ...(prices || {}),
          };
          setTokenPrices(merged);
          queryClient.setQueryData(["token-prices", "registry"], merged);
        }
      } catch {
        if (!cancelled) {
          setTokenPrices(cachedRegistryPrices || {});
        }
      }
    };
    loadTokenPrices();
    return () => {
      cancelled = true;
    };
  }, [queryClient, tokenRegistry]);

  useEffect(() => {
    let cancelled = false;
    const loadTokenTvls = async () => {
      const addrs = Object.values(tokenRegistry)
        .map((t) => t.address)
        .filter(Boolean);
      if (!addrs.length) {
        setV3TokenTvls({});
        return;
      }
      const cachedRegistryTvls =
        queryClient.getQueryData(["token-tvls", "registry"]) || null;
      if (!cancelled && cachedRegistryTvls) {
        setV3TokenTvls(cachedRegistryTvls);
      }
      try {
        const tvls = await fetchV3TokenTvls(addrs);
        if (!cancelled) {
          const merged = {
            ...(cachedRegistryTvls || {}),
            ...(tvls || {}),
          };
          setV3TokenTvls(merged);
          queryClient.setQueryData(["token-tvls", "registry"], merged);
        }
      } catch {
        if (!cancelled) {
          setV3TokenTvls(cachedRegistryTvls || {});
        }
      }
    };
    loadTokenTvls();
    return () => {
      cancelled = true;
    };
  }, [queryClient, tokenRegistry]);

  const trackedPools = useMemo(() => {
    const list = [...basePools];
    const base = tokenSelection?.baseSymbol;
    const pair = tokenSelection?.pairSymbol;
    if (base && pair) {
      const matchesBase = basePools.some((p) => {
        const symbols = [p.token0Symbol, p.token1Symbol];
        return symbols.includes(base) && symbols.includes(pair);
      });
      if (!matchesBase) {
        list.push({
          id: `custom-${base}-${pair}`,
          token0Symbol: base,
          token1Symbol: pair,
          poolType: "volatile",
        });
      }
    }
    return list;
  }, [basePools, tokenSelection?.baseSymbol, tokenSelection?.pairSymbol]);

  useEffect(() => {
    setRegisteredCustomTokens(customTokens);
  }, [customTokens]);

  // Auto-hide liquidity toast (aligned with Swap UX)
  useEffect(() => {
    if (!actionStatus || !actionStatus.message) return undefined;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    const id = setTimeout(() => {
      setActionStatus(null);
      toastTimerRef.current = null;
    }, TOAST_DURATION_MS);
    toastTimerRef.current = id;
    return () => {
      clearTimeout(id);
      if (toastTimerRef.current === id) toastTimerRef.current = null;
    };
  }, [actionStatus]);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (v3CopyTimerRef.current) clearTimeout(v3CopyTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (showTokenList) {
      setCustomTokens(getRegisteredCustomTokens());
    }
  }, [showTokenList]);

  useEffect(() => {
    if (!v3Token0Open && !v3Token1Open) return undefined;
    const handleClick = (event) => {
      const target = event.target;
      if (
        v3Token0Open &&
        v3Token0DropdownRef.current &&
        !v3Token0DropdownRef.current.contains(target)
      ) {
        setV3Token0Open(false);
      }
      if (
        v3Token1Open &&
        v3Token1DropdownRef.current &&
        !v3Token1DropdownRef.current.contains(target)
      ) {
        setV3Token1Open(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [v3Token0Open, v3Token1Open]);

  useEffect(() => {
    if (!v3ChartMenuOpen) return undefined;
    const handleClick = (event) => {
      const target = event.target;
      if (
        v3ChartMenuRef.current &&
        !v3ChartMenuRef.current.contains(target)
      ) {
        setV3ChartMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [v3ChartMenuOpen]);
  useEffect(() => {
    if (v3Token0Open || v3Token1Open) {
      setV3ChartMenuOpen(false);
    }
  }, [v3Token0Open, v3Token1Open]);

  useEffect(() => {
    if (!slippageMenuOpen) return undefined;
    const handleClick = (event) => {
      const target = event.target;
      if (slippageMenuRef.current && !slippageMenuRef.current.contains(target)) {
        setSlippageMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [slippageMenuOpen]);

  useEffect(() => {
    if (!v3DraggingHandle) return undefined;
    const prevCursor = document.body.style.cursor;
    const useVerticalDrag = v3ChartMode === "price-range";
    document.body.style.cursor = useVerticalDrag ? "ns-resize" : "ew-resize";
    v3DragTimeRef.current = null;
    v3DragDirtyRef.current = false;
    const getRangeValue = (key) =>
      key === "lower" ? v3RangeLowerRef.current : v3RangeUpperRef.current;
    const formatDragValue = (value) =>
      Number.isFinite(value) ? value.toFixed(6) : "";
    v3DragCurrentRef.current = {
      ...v3DragCurrentRef.current,
      [v3DraggingHandle]: getRangeValue(v3DraggingHandle),
    };
    v3DragValueRef.current = {
      lower: formatDragValue(v3RangeLowerRef.current),
      upper: formatDragValue(v3RangeUpperRef.current),
    };
    const smoothStep = (current, target, dt, immediate) => {
      if (immediate) return target;
      const tau = 0.06;
      const alpha = 1 - Math.exp(-dt / tau);
      return current + (target - current) * alpha;
    };
    const flushDrag = (timestamp) => {
      const target = v3DragTargetRef.current;
      if (!Number.isFinite(target) || target <= 0) {
        v3DragRafRef.current = null;
        v3DragTimeRef.current = null;
        return;
      }
      const key = v3DraggingHandle;
      const current =
        v3DragCurrentRef.current[key] ??
        getRangeValue(key) ??
        target;
      const isFirstFrame = v3DragTimeRef.current === null;
      const lastTs = isFirstFrame ? timestamp : v3DragTimeRef.current;
      const dt = Math.min(0.05, Math.max(0.001, (timestamp - lastTs) / 1000));
      v3DragTimeRef.current = timestamp;
      const immediate = v3DragDirtyRef.current || isFirstFrame;
      v3DragDirtyRef.current = false;
      const next = smoothStep(current, target, dt, immediate);
      v3DragCurrentRef.current[key] = next;
      setV3RangeMode("custom");
      if (key === "lower") {
        const nextValue = formatDragValue(next);
        if (v3DragValueRef.current.lower !== nextValue) {
          v3DragValueRef.current.lower = nextValue;
          setV3RangeLower(nextValue);
        }
      } else {
        const nextValue = formatDragValue(next);
        if (v3DragValueRef.current.upper !== nextValue) {
          v3DragValueRef.current.upper = nextValue;
          setV3RangeUpper(nextValue);
        }
      }
      if (Math.abs(target - next) < Math.max(1e-6, Math.abs(target) * 0.00001)) {
        v3DragTargetRef.current = null;
        v3DragRafRef.current = null;
        v3DragTimeRef.current = null;
        return;
      }
      v3DragRafRef.current = window.requestAnimationFrame(flushDrag);
    };
    const handleMove = (event) => {
      const chart = v3ChartRef.current;
      if (!v3RangeTrackRef.current || !chart) return;
      const rect = v3RangeTrackRef.current.getBoundingClientRect();
      const pct = clampPercent(
        useVerticalDrag
          ? ((rect.bottom - event.clientY) / rect.height) * 100
          : ((event.clientX - rect.left) / rect.width) * 100
      );
      if (!Number.isFinite(pct)) return;
      const nextPrice = chart.min + ((chart.max - chart.min) * pct) / 100;
      if (!Number.isFinite(nextPrice) || nextPrice <= 0) return;
      let bounded = nextPrice;
      if (v3DraggingHandle === "lower") {
        const maxAllowed = v3RangeUpperRef.current
          ? v3RangeUpperRef.current * 0.999
          : bounded;
        bounded = Math.min(bounded, maxAllowed);
      } else {
        const minAllowed = v3RangeLowerRef.current
          ? v3RangeLowerRef.current * 1.001
          : bounded;
        bounded = Math.max(bounded, minAllowed);
      }
      v3DragTargetRef.current = bounded;
      v3DragDirtyRef.current = true;
      if (!v3DragRafRef.current) {
        v3DragRafRef.current = window.requestAnimationFrame(flushDrag);
      }
    };
    const handleUp = () => {
      if (v3DragTargetRef.current !== null) {
        v3DragRafRef.current = window.requestAnimationFrame(flushDrag);
      }
      setV3DraggingHandle(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.style.cursor = prevCursor;
      if (v3DragRafRef.current) {
        window.cancelAnimationFrame(v3DragRafRef.current);
        v3DragRafRef.current = null;
      }
      v3DragTargetRef.current = null;
      v3DragTimeRef.current = null;
      v3DragDirtyRef.current = false;
    };
  }, [v3DraggingHandle, v3ChartMode]);

  useEffect(() => {
    if (!v3PositionMenuOpen) return undefined;
    const handleClick = (event) => {
      const target = event.target;
      if (
        v3PositionMenuRef.current &&
        !v3PositionMenuRef.current.contains(target)
      ) {
        setV3PositionMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [v3PositionMenuOpen]);

  useEffect(() => {
    if (!v3AddMenuOpen) return undefined;
    const handleClick = (event) => {
      const target = event.target;
      if (v3AddMenuRef.current && v3AddMenuRef.current.contains(target)) {
        return;
      }
      setV3AddMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [v3AddMenuOpen]);

  useEffect(() => {
    if (!v3PositionListMenuOpenId) return undefined;
    const handleClick = (event) => {
      const target = event.target;
      if (target?.closest?.(".v3-position-list-menu")) return;
      setV3PositionListMenuOpenId(null);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [v3PositionListMenuOpenId]);

  useEffect(() => {
    if (!v2PositionMenuOpenId) return undefined;
    const handleClick = (event) => {
      const target = event.target;
      if (target?.closest?.(".v2-position-list-menu")) return;
      setV2PositionMenuOpenId(null);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [v2PositionMenuOpenId]);

  useEffect(() => {
    if (!v2DepositMenuOpen) return undefined;
    const handleClick = (event) => {
      const target = event.target;
      if (v2DepositMenuRef.current && v2DepositMenuRef.current.contains(target)) {
        return;
      }
      setV2DepositMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [v2DepositMenuOpen]);

  useEffect(() => {
    setV3PositionMenuOpen(false);
  }, [selectedPositionId]);

  // Auto refresh LP/tvl every 30s (V2 only)
  useEffect(() => {
    if (!isV2View) return undefined;
    const id = setInterval(() => setLpRefreshTick((t) => t + 1), 120000);
    return () => clearInterval(id);
  }, [isV2View]);

  // Shared helper: fetch a read-only RPC provider with rotation and chain guard.
  const getRpcProviderWithRetry = useCallback(async () => {
    let attempts = 0;
    let provider = getReadOnlyProvider(false, true);
    const targetChain = parseInt(getActiveNetworkConfig()?.chainIdHex || "0", 16);
    while (attempts < 4) {
      try {
        const net = await provider.getNetwork();
        if (targetChain && Number(net?.chainId || 0) !== targetChain) {
          throw new Error("Wrong RPC chain");
        }
        return provider;
      } catch (err) {
        attempts += 1;
        rotateRpcProvider();
        provider = getReadOnlyProvider(true, true);
        if (attempts >= 4) throw err;
      }
    }
    return provider;
  }, []);

  // Load live data for all pools (subgraph + on-chain TVL fallback)
  useEffect(() => {
    if (!isV2View) return undefined;
    let cancelled = false;
    const loadPools = async () => {
      setPoolStatsReady(false);
      const updates = {};
      setSubgraphError("");
      setTvlError("");

      await runWithConcurrency(trackedPools, 4, async (pool) => {
        const token0Addr =
          pool.token0Address ||
          resolveTokenAddress(pool.token0Symbol, tokenRegistry);
        const token1Addr =
          pool.token1Address ||
          resolveTokenAddress(pool.token1Symbol, tokenRegistry);
        if (!token0Addr || !token1Addr) return;
        if (!updates[pool.id]) updates[pool.id] = {};

        try {
          const live = await fetchV2PairData(token0Addr, token1Addr);
          if (!cancelled && live) {
            updates[pool.id] = {
              ...updates[pool.id],
              pairId: live.pairId,
              tvlUsd: live.tvlUsd,
              volume24hUsd: live.volume24hUsd,
              fees24hUsd:
                live.fees24hUsd ??
                (live.volume24hUsd ? live.volume24hUsd * 0.003 : undefined),
            };
          }
        } catch (err) {
          if (!cancelled && !subgraphError) {
            setSubgraphError(err.message || "Subgraph fetch failed");
          }
        }

        // On-chain TVL fallback (only if stable side present to avoid wrong USD calc)
        const pairIdOverride = updates[pool.id]?.pairId;
        try {
          const provider = await getRpcProviderWithRetry();
          const reserves = await getV2PairReserves(
            provider,
            token0Addr,
            token1Addr,
            pairIdOverride
          );
          if (!reserves) return;
          const { reserve0, reserve1, token0, pairAddress } = reserves;
          const token0IsA = token0.toLowerCase() === token0Addr.toLowerCase();
          const resA = token0IsA ? reserve0 : reserve1;
          const resB = token0IsA ? reserve1 : reserve0;
          const metaA = tokenRegistry[pool.token0Symbol];
          const metaB = tokenRegistry[pool.token1Symbol];
          const decimalsA = metaA?.decimals ?? 18;
          const decimalsB = metaB?.decimals ?? 18;
          const stableA = isStableSymbol(metaA?.symbol || pool.token0Symbol);
          const stableB = isStableSymbol(metaB?.symbol || pool.token1Symbol);
          let tvlUsd;
          let finalPairAddress = pairAddress;
          if (stableA) {
            const usd = Number(formatUnits(resA, decimalsA));
            tvlUsd = usd * 2;
          } else if (stableB) {
            const usd = Number(formatUnits(resB, decimalsB));
            tvlUsd = usd * 2;
          } else if (tokenPrices && Object.keys(tokenPrices).length) {
            const priceA = tokenPrices[(token0Addr || "").toLowerCase()];
            const priceB = tokenPrices[(token1Addr || "").toLowerCase()];
            const amountA = Number(formatUnits(resA, decimalsA));
            const amountB = Number(formatUnits(resB, decimalsB));
            const valA = priceA && Number.isFinite(priceA) ? amountA * priceA : null;
            const valB = priceB && Number.isFinite(priceB) ? amountB * priceB : null;
            if (valA !== null && valB !== null) {
              tvlUsd = valA + valB;
            } else if (valA !== null) {
              tvlUsd = valA * 2;
            } else if (valB !== null) {
              tvlUsd = valB * 2;
            }
          }
          if (!cancelled) {
            updates[pool.id] = {
              ...updates[pool.id],
              ...(tvlUsd !== undefined
                ? { tvlUsd: updates[pool.id]?.tvlUsd ?? tvlUsd }
                : {}),
              pairAddress: finalPairAddress || updates[pool.id]?.pairAddress,
            };
          }
        } catch (chainErr) {
          // ignore per-pool chain errors to avoid breaking the whole list
          const msg = chainErr?.message || "Failed to load TVL";
          const pairMissing =
            msg.toLowerCase().includes("pair not found on megaeth") ||
            msg.toLowerCase().includes("pair not found");
          if (!cancelled && !pairMissing) {
            // Optional: log silently without surfacing to UI; pool creation can happen on first addLiquidity
            console.warn("TVL fetch failed:", msg);
            setTvlError("");
          }
        }
      });

      if (!cancelled && Object.keys(updates).length) {
        setPoolStats((prev) => ({ ...prev, ...updates }));
      }
      if (!cancelled) setPoolStatsReady(true);
    };
    loadPools();
    return () => {
      cancelled = true;
    };
  }, [
    isV2View,
    lpRefreshTick,
    subgraphError,
    tokenRegistry,
    tokenPrices,
    trackedPools,
    tvlError,
    getRpcProviderWithRetry,
  ]);

  useEffect(() => {
    setDepositToken0("");
    setDepositToken1("");
    setWithdrawLp("");
    setDepositQuoteError("");
    setLastEdited("");
    setActionStatus(null);
    setPairError("");
    setPairNotDeployed(false);
    setPairInfo(null);
    setLpBalance(null);
    setLpBalanceError("");
    setTokenBalances(null);
    setTokenBalanceError("");
  }, [selectedPoolId]);

  const pools = useMemo(() => {
    return basePools.map((p) => {
      const stats = poolStats[p.id] || {};
      const token0Address =
        p.token0Address || resolveTokenAddress(p.token0Symbol, tokenRegistry);
      const token1Address =
        p.token1Address || resolveTokenAddress(p.token1Symbol, tokenRegistry);
      const hasAddresses =
        Boolean(token0Address && token1Address);
      return {
        ...p,
        ...stats,
        token0Address,
        token1Address,
        isActive: poolStatsReady ? derivePoolActivity(p, stats) : null,
        hasAddresses,
      };
    });
  }, [basePools, poolStats, poolStatsReady, tokenRegistry]);

  const tokenEntries = useMemo(() => {
    const tvlMap = {};
    pools.forEach((p) => {
      const share = Number(p.tvlUsd || 0) / 2;
      if (share > 0) {
        tvlMap[p.token0Symbol] = (tvlMap[p.token0Symbol] || 0) + share;
        tvlMap[p.token1Symbol] = (tvlMap[p.token1Symbol] || 0) + share;
      }
    });
    const v3TvlMap = {};
    Object.values(tokenRegistry).forEach((token) => {
      const addr = (token?.address || "").toLowerCase();
      if (!addr) return;
      const tvl = v3TokenTvls[addr];
      if (Number.isFinite(tvl) && tvl > 0) {
        v3TvlMap[token.symbol] = (v3TvlMap[token.symbol] || 0) + tvl;
      }
    });
    const ethLikeTvl =
      (tvlMap.ETH || 0) +
      (tvlMap.WETH || 0) +
      (v3TvlMap.ETH || 0) +
      (v3TvlMap.WETH || 0);

    return Object.values(tokenRegistry).map((t) => {
      const rawBalance = walletBalances?.[t.symbol];
      const walletBalance =
        address && Number.isFinite(Number(rawBalance))
          ? Number(rawBalance)
          : address
            ? 0
            : null;
      const v2Tvl =
        t.symbol === "ETH" || t.symbol === "WETH"
          ? (tvlMap.ETH || 0) + (tvlMap.WETH || 0)
          : tvlMap[t.symbol] || 0;
      const v3Tvl =
        t.symbol === "ETH" || t.symbol === "WETH"
          ? (v3TvlMap.ETH || 0) + (v3TvlMap.WETH || 0)
          : v3TvlMap[t.symbol] || 0;

      return {
        ...t,
        tvlUsd:
          t.symbol === "ETH" || t.symbol === "WETH"
            ? ethLikeTvl
            : v2Tvl + v3Tvl,
        priceUsd:
          tokenPrices[(t.address || "").toLowerCase()] ||
          (t.symbol === "ETH"
            ? tokenPrices[WETH_ADDRESS.toLowerCase()]
            : t.symbol === "WETH"
              ? tokenPrices[WETH_ADDRESS.toLowerCase()]
              : undefined),
        walletBalance,
      };
    });
  }, [address, pools, tokenPrices, tokenRegistry, v3TokenTvls, walletBalances]);

  const filteredTokens = useMemo(() => {
    const q = tokenSearch.trim().toLowerCase();
    if (!q) return tokenEntries;
    return tokenEntries.filter((t) => {
      const address = t.address || "";
      return (
        t.symbol.toLowerCase().includes(q) ||
        (t.name || "").toLowerCase().includes(q) ||
        address.toLowerCase().includes(q)
      );
    });
  }, [tokenEntries, tokenSearch]);
  const searchAddress = tokenSearch.trim();
  const searchIsAddress = isValidTokenAddress(searchAddress);
  const showQuickAdd = searchIsAddress && filteredTokens.length === 0;
  useEffect(() => {
    if (!showTokenList) {
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
          setSearchTokenMetaError(err?.message || "Unable to load token metadata");
        }
      } finally {
        if (!cancelled) setSearchTokenMetaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showTokenList, searchIsAddress, searchAddress, tokenRegistry]);

  const baseSelected = tokenSelection?.baseSymbol
    ? tokenRegistry[tokenSelection.baseSymbol]
    : null;
  const pairSelected = tokenSelection?.pairSymbol
    ? tokenRegistry[tokenSelection.pairSymbol]
    : null;
  const pairOptions = useMemo(() => {
    if (!tokenSelection?.baseSymbol) return [];
    return Object.values(tokenRegistry).filter(
      (t) => t.symbol !== tokenSelection.baseSymbol
    );
  }, [tokenSelection?.baseSymbol, tokenRegistry]);

  const selectionPools = useMemo(() => {
    const base = tokenSelection?.baseSymbol;
    const pair = tokenSelection?.pairSymbol;
    if (!base || !pair) return [];
    const matched = pools.filter((p) => {
      const symbols = [p.token0Symbol, p.token1Symbol];
      return symbols.includes(base) && symbols.includes(pair);
    });
    if (matched.length) return matched;
    const baseMeta = tokenRegistry[base];
    const pairMeta = tokenRegistry[pair];
    if (!baseMeta || !pairMeta) return [];
    const baseAddr = resolveTokenAddress(base, tokenRegistry);
    const pairAddr = resolveTokenAddress(pair, tokenRegistry);
    const hasAddresses = baseAddr && pairAddr;
    const poolId = `custom-${base}-${pair}`;
    const stats = poolStats[poolId] || {};
    return [
      {
        id: poolId,
        token0Symbol: base,
        token1Symbol: pair,
        poolType: "volatile",
        ...stats,
        token0Address: baseAddr,
        token1Address: pairAddr,
        isActive: derivePoolActivity(
          { token0Symbol: base, token1Symbol: pair, active: stats.active },
          stats
        ),
        hasAddresses: Boolean(hasAddresses),
      },
    ];
  }, [
    pools,
    poolStats,
    tokenSelection?.baseSymbol,
    tokenSelection?.pairSymbol,
    tokenRegistry,
  ]);

  const allPools = useMemo(() => {
    const extras = selectionPools.filter(
      (p) => !pools.find((base) => base.id === p.id)
    );
    return [...pools, ...extras];
  }, [pools, selectionPools]);


  const selectedPool = useMemo(() => {
    if (!allPools.length) return null;
    const found = allPools.find((p) => p.id === selectedPoolId);
    return found || allPools[0];
  }, [allPools, selectedPoolId]);

  const token0Meta = selectedPool
    ? tokenRegistry[selectedPool.token0Symbol]
    : null;
  const token1Meta = selectedPool
    ? tokenRegistry[selectedPool.token1Symbol]
    : null;
  const token0Address =
    selectedPool?.token0Address ||
    resolveTokenAddress(selectedPool?.token0Symbol, tokenRegistry);
  const token1Address =
    selectedPool?.token1Address ||
    resolveTokenAddress(selectedPool?.token1Symbol, tokenRegistry);
  const selectedToken0Symbol = selectedPool?.token0Symbol;
  const selectedToken1Symbol = selectedPool?.token1Symbol;
  const poolSupportsActions = Boolean(token0Address && token1Address);
  const usesNativeEth =
    selectedPool &&
    (selectedPool.token0Symbol === "ETH" || selectedPool.token1Symbol === "ETH");
  const pairIdOverride = selectedPool?.pairId;
  const hasPairInfo = Boolean(pairInfo && poolSupportsActions);
  const pairMissing =
    pairNotDeployed ||
    (pairError && pairError.toLowerCase().includes("pair not found"));

  // Listen for Sync events on the active pair to refresh reserves instantly
  useEffect(() => {
    const candidate =
      pairInfo?.pairAddress ||
      selectedPool?.pairAddress ||
      pairIdOverride;
    if (!candidate) return undefined;
    const target = candidate.toLowerCase();
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
          if (addr !== target) continue;
          const topic0 = (log?.topics?.[0] || "").toLowerCase();
          if (topic0 !== SYNC_TOPIC) continue;
          const now = Date.now();
          if (now - (livePairThrottle.current || 0) < 800) return;
          livePairThrottle.current = now;
          setPairLiveTick((t) => t + 1);
          return;
        }
      }
    };

    const unsubscribe = client.addMiniBlockListener(handleMini);
    return unsubscribe;
  }, [pairIdOverride, pairInfo?.pairAddress, selectedPool?.pairAddress]);

  // Listen for V3 pool logs to refresh balances instantly
  useEffect(() => {
    if (!isV3View || !v3PoolInfo.address) return undefined;
    const target = v3PoolInfo.address.toLowerCase();
    const token0Addr = (v3PoolInfo.token0 || "").toLowerCase();
    const token1Addr = (v3PoolInfo.token1 || "").toLowerCase();
    const client = getRealtimeClient();
    const transferTopic = (TRANSFER_TOPIC || "").toLowerCase();

    const handleMini = (mini) => {
      const receipts = mini?.receipts;
      if (!Array.isArray(receipts)) return;
      for (let i = 0; i < receipts.length; i += 1) {
        const logs = receipts[i]?.logs;
        if (!Array.isArray(logs)) continue;
        for (let j = 0; j < logs.length; j += 1) {
          const log = logs[j];
          const addr = (log?.address || "").toLowerCase();
          let shouldRefresh = false;
          if (addr === target) {
            shouldRefresh = true;
          } else if (addr && transferTopic && (addr === token0Addr || addr === token1Addr)) {
            const topic0 = (log?.topics?.[0] || "").toLowerCase();
            if (topic0 === transferTopic) {
              const from = topicToAddress(log?.topics?.[1]);
              const to = topicToAddress(log?.topics?.[2]);
              if (from === target || to === target) {
                shouldRefresh = true;
              }
            }
          }
          if (!shouldRefresh) continue;
          const now = Date.now();
          if (now - (v3PoolLiveThrottle.current || 0) < 500) return;
          v3PoolLiveThrottle.current = now;
          setV3PoolBalanceTick((t) => t + 1);
          return;
        }
      }
    };

    const unsubscribe = client.addMiniBlockListener(handleMini);
    return unsubscribe;
  }, [isV3View, v3PoolInfo.address, v3PoolInfo.token0, v3PoolInfo.token1]);
  const pairBlockingError = Boolean(pairError && !pairMissing);
  const hasLpBalance = lpBalance !== null && lpBalance > MIN_LP_THRESHOLD;

  useEffect(() => {
    if (suppressSelectionResetRef.current) {
      suppressSelectionResetRef.current = false;
      return;
    }
    setSelectionDepositPoolId(null);
  }, [tokenSelection?.baseSymbol, tokenSelection?.pairSymbol]);

  const fetchLpBalance = useCallback(async () => {
    if (!poolSupportsActions || !selectedPool || pairBlockingError) return;
    if (pairMissing) {
      setLpBalance(null);
      setLpBalanceError("");
      return;
    }
    try {
      setLpBalanceError("");
      let provider;
      try {
        provider = await getProvider();
      } catch {
        provider = await getRpcProviderWithRetry();
      }
      const user = address || null;
      if (!user) {
        setLpBalanceError("");
        return;
      }

      const resolved =
        pairInfo ||
        (await getV2PairReserves(provider, token0Address, token1Address, pairIdOverride));

      if (!resolved || !resolved.pairAddress) {
        setPairNotDeployed(true);
        setLpBalance(null);
        setLpBalanceError("");
        return;
      }

      const pairErc20 = new Contract(resolved.pairAddress, ERC20_ABI, provider);
      const decimals =
        typeof pairErc20.decimals === "function"
          ? await pairErc20.decimals().catch(() => 18)
          : 18;
      const balance = await pairErc20.balanceOf(user);
      setLpDecimalsState(Number(decimals) || 18);
      setLpBalanceRaw(balance);
      setLpBalance(Number(formatUnits(balance, decimals)));
    } catch (err) {
      console.warn("LP balance lookup failed:", err?.message || err);
      // Treat any failure as "not deployed yet" to allow first deposit
      setPairNotDeployed(true);
      setLpBalanceError("");
      setLpBalance(null);
    }
  }, [
    address,
    pairIdOverride,
    pairInfo,
    pairMissing,
    pairBlockingError,
    poolSupportsActions,
    selectedPool,
    token0Address,
    token1Address,
    getRpcProviderWithRetry,
  ]);

  useEffect(() => {
    fetchLpBalance();
  }, [fetchLpBalance, lpRefreshTick]);

  useEffect(() => {
    let cancelled = false;

    const loadV2Positions = async () => {
      if (!isV2View) {
        return;
      }
      if (!address) {
        setV2LpPositions([]);
        setV2LpError("");
        return;
      }

      const candidates = pools.filter((p) => p.hasAddresses);
      if (!candidates.length) {
        return;
      }

      setV2LpLoading(true);
      setV2LpError("");
      try {
        let provider;
        try {
          provider = await getProvider();
        } catch {
          provider = await getRpcProviderWithRetry();
        }

        const factory =
          UNIV2_FACTORY_ADDRESS && provider
            ? new Contract(UNIV2_FACTORY_ADDRESS, UNIV2_FACTORY_ABI, provider)
            : null;
        const iface = new Interface(ERC20_ABI);

        const resolved = await runWithConcurrency(candidates, 4, async (pool) => {
          const token0Addr =
            pool.token0Address ||
            resolveTokenAddress(pool.token0Symbol, tokenRegistry);
          const token1Addr =
            pool.token1Address ||
            resolveTokenAddress(pool.token1Symbol, tokenRegistry);
          if (!token0Addr || !token1Addr) return null;

          let pairAddress = pool.pairAddress || pool.pairId || null;
          if (!isAddressLike(pairAddress)) {
            pairAddress = null;
          }
          if (!pairAddress && factory) {
            try {
              pairAddress = await factory.getPair(token0Addr, token1Addr);
            } catch {
              pairAddress = null;
            }
          }
          if (!pairAddress || pairAddress === ZERO_ADDRESS) return null;

          return { pool, pairAddress };
        });

        const valid = resolved.filter(Boolean);
        if (!valid.length) {
          // keep previous positions on transient failures
          return;
        }

        const calls = [];
        valid.forEach(({ pairAddress }) => {
          calls.push({
            target: pairAddress,
            callData: iface.encodeFunctionData("balanceOf", [address]),
          });
          calls.push({
            target: pairAddress,
            callData: iface.encodeFunctionData("totalSupply", []),
          });
        });

        let results = [];
        if (await hasMulticall(provider).catch(() => false)) {
          results = await multicall(calls, provider);
        } else {
          results = await Promise.all(
            calls.map(async (call) => {
              try {
                const erc = new Contract(call.target, ERC20_ABI, provider);
                const data = call.callData;
                if (data.startsWith(iface.getFunction("balanceOf").selector)) {
                  const bal = await erc.balanceOf(address);
                  return {
                    success: true,
                    returnData: iface.encodeFunctionResult("balanceOf", [bal]),
                  };
                }
                const totalSupply = await erc.totalSupply();
                return {
                  success: true,
                  returnData: iface.encodeFunctionResult("totalSupply", [totalSupply]),
                };
              } catch {
                return { success: false, returnData: "0x" };
              }
            })
          );
        }

        const positions = [];
        let hadDecode = false;
        for (let i = 0; i < valid.length; i += 1) {
          const balanceRes = results[i * 2];
          const supplyRes = results[i * 2 + 1];
          if (!balanceRes?.success) continue;
          hadDecode = true;
          let balanceRaw = 0n;
          let totalSupplyRaw = null;
          try {
            balanceRaw = iface.decodeFunctionResult("balanceOf", balanceRes.returnData)[0];
          } catch {
            balanceRaw = 0n;
          }
          if (!balanceRaw || balanceRaw <= 0n) continue;
          if (supplyRes?.success) {
            try {
              totalSupplyRaw = iface.decodeFunctionResult("totalSupply", supplyRes.returnData)[0];
            } catch {
              totalSupplyRaw = null;
            }
          }
          const lpBalance = Number(formatUnits(balanceRaw, 18));
          const share =
            totalSupplyRaw && totalSupplyRaw > 0n
              ? Number(balanceRaw) / Number(totalSupplyRaw)
              : null;
          const tvlUsd = Number(valid[i].pool.tvlUsd || 0);
          const positionUsd =
            share !== null && Number.isFinite(tvlUsd) && tvlUsd > 0
              ? share * tvlUsd
              : null;

          positions.push({
            ...valid[i].pool,
            pairAddress: valid[i].pairAddress,
            lpBalance,
            lpBalanceRaw: balanceRaw,
            lpShare: share,
            positionUsd,
          });
        }

        if (!cancelled && hadDecode) {
          setV2LpPositions(positions);
        }
      } catch (err) {
        if (!cancelled) {
          setV2LpError(err?.message || "Failed to load V2 LP positions.");
        }
      } finally {
        if (!cancelled) setV2LpLoading(false);
      }
    };

    loadV2Positions();
    return () => {
      cancelled = true;
    };
  }, [address, isV2View, pools, tokenRegistry, lpRefreshTick, getRpcProviderWithRetry]);

  useEffect(() => {
    let cancelled = false;
    const loadPair = async () => {
      setPairInfo(null);
      setPairError("");
      setPairNotDeployed(false);

      if (!selectedPool) return;
      if (!poolSupportsActions) {
        setPairError(
          "Pool not configured on-chain (missing token address)."
        );
        return;
      }

      try {
        const activeChainId = (getActiveNetworkConfig()?.chainIdHex || "").toLowerCase();
        const walletChainId = (chainId || "").toLowerCase();
        const preferWallet = address && walletChainId && walletChainId === activeChainId;
        let provider;
        if (preferWallet) {
          try {
            provider = await getProvider();
          } catch {
            provider = getReadOnlyProvider();
          }
        } else {
          provider = getReadOnlyProvider(false, true);
        }
        const res = await getV2PairReserves(
          provider,
          token0Address,
          token1Address,
          pairIdOverride
        );
        if (cancelled) return;
        setPairInfo({
          ...res,
          token0Address,
          token1Address,
        });

        // Warm decimals cache for ratio calculations and balances
        try {
          await Promise.all([
            readDecimals(provider, token0Address, token0Meta),
            readDecimals(provider, token1Address, token1Meta),
          ]);
        } catch {
          // non-blocking
        }

        try {
          const activeChainId = (getActiveNetworkConfig()?.chainIdHex || "").toLowerCase();
          const walletChainId = (chainId || "").toLowerCase();
          const preferWallet = walletChainId && walletChainId === activeChainId;
          let balProvider;
          if (preferWallet) {
            try {
              balProvider = await getProvider();
            } catch {
              balProvider = getReadOnlyProvider();
            }
          } else {
            balProvider = getReadOnlyProvider(false, true);
          }
          const user = address || null;
          if (user) {
            const pairErc20 = new Contract(res.pairAddress, ERC20_ABI, balProvider);
            const decimals =
              typeof pairErc20.decimals === "function"
                ? await pairErc20.decimals().catch(() => 18)
                : 18;
            const balance = await pairErc20.balanceOf(user);
            if (!cancelled) setLpBalance(Number(formatUnits(balance, decimals)));
          }
        } catch (balanceErr) {
          if (!cancelled) {
            setLpBalance(null);
            setLpBalanceError(
              balanceErr.message || "Failed to load LP balance"
            );
          }
        }
      } catch (err) {
        console.warn("Pair discovery failed:", err?.message || err);
        if (!cancelled) {
          // Treat missing or unreadable pair as undeployed to allow first deposit
          setPairError("");
          setPairNotDeployed(true);
          setLpBalance(null);
          setLpBalanceError("");
        }
      }
    };

    loadPair();
    return () => {
      cancelled = true;
    };
  }, [
    pairIdOverride,
    selectedPool,
    selectedPoolId,
    poolSupportsActions,
    token0Address,
    token1Address,
    lpRefreshTick,
    pairLiveTick,
    address,
    chainId,
    readDecimals,
    token0Meta,
    token1Meta,
  ]);

  // Suggest balanced amount based on current reserves
  useEffect(() => {
    let cancelled = false;
    const fetchQuote = () => {
      setDepositQuoteError("");
      const amount0 = depositToken0 ? Number(depositToken0) : 0;
      const amount1 = depositToken1 ? Number(depositToken1) : 0;
      if (!amount0 && !amount1) return;
      if (!lastEdited) return;
      if (!pairInfo || !poolSupportsActions) return;

      try {
        const decimals0 = token0Meta?.decimals ?? 18;
        const decimals1 = token1Meta?.decimals ?? 18;
        const pairToken0Lower = safeLower(pairInfo?.token0);
        const inputToken0Lower = safeLower(token0Address || "");
        if (!pairToken0Lower || !inputToken0Lower) return;
        const reserveForToken0 =
          pairToken0Lower === inputToken0Lower
            ? pairInfo.reserve0
            : pairInfo.reserve1;
        const reserveForToken1 =
          pairToken0Lower === inputToken0Lower
            ? pairInfo.reserve1
            : pairInfo.reserve0;

        const reserve0Float = Number(
          formatUnits(reserveForToken0, decimals0)
        );
        const reserve1Float = Number(
          formatUnits(reserveForToken1, decimals1)
        );
        if (reserve0Float === 0 || reserve1Float === 0) return;

        const priceToken1Per0 = reserve1Float / reserve0Float;

        if (
          amount0 > 0 &&
          lastEdited === token0Meta?.symbol &&
          !Number.isNaN(priceToken1Per0)
        ) {
          const suggested1 = amount0 * priceToken1Per0;
          if (!cancelled) {
            setDepositToken1(suggested1.toFixed(4));
          }
        } else if (
          amount1 > 0 &&
          lastEdited === token1Meta?.symbol &&
          !Number.isNaN(priceToken1Per0)
        ) {
          const suggested0 = amount1 / priceToken1Per0;
          if (!cancelled) {
            setDepositToken0(suggested0.toFixed(4));
          }
        }
      } catch (err) {
        if (!cancelled)
          setDepositQuoteError(
            compactRpcMessage(err.message, "Quote balance failed")
          );
      }
    };
    fetchQuote();
    return () => {
      cancelled = true;
    };
  }, [
    depositToken0,
    depositToken1,
    lastEdited,
    pairInfo,
    poolSupportsActions,
    token0Address,
    token1Address,
    token0Meta?.symbol,
    token1Meta?.symbol,
    token0Meta?.decimals,
    token1Meta?.decimals,
  ]);

  const applyDepositRatio = (percentage) => {
    if (!tokenBalances && !walletBalances) return;
    if (actionStatus) setActionStatus(null);
    try {
      const symbol0 = token0Meta?.symbol || selectedPool?.token0Symbol;
      const symbol1 = token1Meta?.symbol || selectedPool?.token1Symbol;
      if (!symbol0 || !symbol1) return;

      const findWalletBalance = (sym) => {
        if (!sym || !walletBalances) return undefined;
        const lower = String(sym).toLowerCase();
        const matchKey = Object.keys(walletBalances).find(
          (k) => k.toLowerCase() === lower
        );
        if (matchKey !== undefined) return walletBalances[matchKey];
        return undefined;
      };

      const getAvailable = (which) => {
        const sym = which === 0 ? symbol0 : symbol1;
        const fromWallet = findWalletBalance(sym);
        const fromTokenBalances =
          which === 0 ? tokenBalances?.token0 : tokenBalances?.token1;

        const walletVal =
          fromWallet !== undefined && fromWallet !== null
            ? Number(fromWallet || 0)
            : null;
        const tokenVal =
          fromTokenBalances !== undefined && fromTokenBalances !== null
            ? Number(fromTokenBalances || 0)
            : null;

        if (walletVal !== null && tokenVal !== null) {
          return Math.min(walletVal, tokenVal);
        }
        if (walletVal !== null) return walletVal;
        if (tokenVal !== null) return tokenVal;
        return 0;
      };

      const available0 = getAvailable(0) * percentage;
      const available1 = getAvailable(1) * percentage;

      // Use on-chain reserves ratio only if we have decimals for both sides; otherwise fall back to simple percentages.
      const dec0 =
        (token0Address &&
          tokenDecimalsCache.current[
            (token0Address.toLowerCase ? token0Address.toLowerCase() : token0Address)
          ]) ??
        token0Meta?.decimals ??
        18;
      const dec1 =
        (token1Address &&
          tokenDecimalsCache.current[
            (token1Address.toLowerCase ? token1Address.toLowerCase() : token1Address)
          ]) ??
        token1Meta?.decimals ??
        18;

      if (hasPairInfo && Number.isFinite(dec0) && Number.isFinite(dec1)) {
        const pairToken0Lower = safeLower(pairInfo.token0);
        const inputToken0Lower = safeLower(token0Address || "");
        const reserveForToken0 =
          pairToken0Lower === inputToken0Lower ? pairInfo.reserve0 : pairInfo.reserve1;
        const reserveForToken1 =
          pairToken0Lower === inputToken0Lower ? pairInfo.reserve1 : pairInfo.reserve0;

        const reserve0Float = Number(formatUnits(reserveForToken0, dec0));
        const reserve1Float = Number(formatUnits(reserveForToken1, dec1));
        if (reserve0Float > 0 && reserve1Float > 0) {
          const priceToken1Per0 = reserve1Float / reserve0Float;
          if (Number.isFinite(priceToken1Per0) && priceToken1Per0 > 0) {
            const required1ForAvail0 = available0 * priceToken1Per0;

            let next0 = 0;
            let next1 = 0;
            if (available0 > 0 && required1ForAvail0 <= available1) {
              next0 = available0;
              next1 = required1ForAvail0;
            } else if (available1 > 0) {
              next1 = available1;
              next0 = next1 / priceToken1Per0;
            }

            if (next0 > 0 && next1 > 0) {
              setLastEdited(token0Meta?.symbol || selectedPool?.token0Symbol);
              setDepositToken0(next0.toFixed(4));
              setDepositToken1(next1.toFixed(4));
              return;
            }
          }
        }
      }

      // Fallback: simple percentage of wallet balances (no ratio adjustment)
      const token0Label = token0Meta?.symbol || selectedPool?.token0Symbol;
      if (available0 > 0) setDepositToken0(available0.toFixed(4));
      if (available1 > 0) setDepositToken1(available1.toFixed(4));
      if (token0Label) setLastEdited(token0Label);
    } catch (err) {
      setDepositQuoteError(
        compactRpcMessage(err.message, "Quote balance failed")
      );
    }
  };

  const applyWithdrawRatio = (percentage) => {
    if (!lpBalanceRaw || lpBalanceRaw <= 0n) return;
    const pct = Math.round(percentage * 10000);
    const targetRaw = (lpBalanceRaw * BigInt(pct)) / 10000n;
    if (targetRaw <= 0n) {
      setWithdrawLp("");
      return;
    }
    setWithdrawLp(formatUnits(targetRaw, lpDecimalsState || 18));
    if (actionStatus) setActionStatus(null);
  };

  const handleV3Mint = async () => {
    if (!address) {
      setV3MintError("Connect your wallet to add a position.");
      return;
    }
    if (!hasV3Liquidity) {
      setV3MintError("V3 contracts not configured for this network.");
      return;
    }
    if (!v3Token0 || !v3Token1 || v3Token0 === v3Token1) {
      setV3MintError("Select two different tokens.");
      return;
    }
    const metaA = v3Token0Meta;
    const metaB = v3Token1Meta;
    const addrA = v3Token0 === "ETH" ? WETH_ADDRESS : metaA?.address;
    const addrB = v3Token1 === "ETH" ? WETH_ADDRESS : metaB?.address;
    if (!addrA || !addrB) {
      setV3MintError("Token addresses missing for this selection.");
      return;
    }
    const amountAParsed = safeParseUnits(v3Amount0 || "0", v3Token0 === "ETH" ? 18 : metaA?.decimals || 18);
    const amountBParsed = safeParseUnits(v3Amount1 || "0", v3Token1 === "ETH" ? 18 : metaB?.decimals || 18);
    if ((v3Amount0 && amountAParsed === null) || (v3Amount1 && amountBParsed === null)) {
      setV3MintError("Enter valid amounts.");
      return;
    }
    const amountA = amountAParsed || 0n;
    const amountB = amountBParsed || 0n;
    if (v3RangeMath) {
      if (v3RangeSide === "dual") {
        if (amountA <= 0n || amountB <= 0n) {
          setV3MintError("Enter valid amounts for both tokens.");
          return;
        }
      } else if (v3RangeSide === "token0") {
        if (amountA <= 0n) {
          setV3MintError(`Enter an amount for ${v3Token0}.`);
          return;
        }
      } else if (v3RangeSide === "token1") {
        if (amountB <= 0n) {
          setV3MintError(`Enter an amount for ${v3Token1}.`);
          return;
        }
      }
    } else if (amountA <= 0n && amountB <= 0n) {
      setV3MintError("Enter an amount for at least one token.");
      return;
    }

    setV3MintError("");
    setV3MintLoading(true);
    try {
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const user = await signer.getAddress();
      const targetChain = parseInt(getActiveNetworkConfig()?.chainIdHex || "0", 16);
      if (targetChain) {
        const walletNet = await provider.getNetwork();
        if (Number(walletNet?.chainId || 0) !== targetChain) {
          throw new Error(
            "Wallet network differs from the selected network. Switch network to add a position."
          );
        }
      }
      const readProvider = getReadOnlyProvider(false, true) || provider;
      const factory = new Contract(UNIV3_FACTORY_ADDRESS, UNIV3_FACTORY_ABI, readProvider);
      let token0Addr = addrA;
      let token1Addr = addrB;
      let amount0Desired = amountA;
      let amount1Desired = amountB;
      let token0IsEth = v3MintUseEth0Effective;
      let token1IsEth = v3MintUseEth1Effective;
      const isReversed = addrA.toLowerCase() !== addrB.toLowerCase() &&
        addrA.toLowerCase() > addrB.toLowerCase();

      if (token0Addr.toLowerCase() > token1Addr.toLowerCase()) {
        [token0Addr, token1Addr] = [token1Addr, token0Addr];
        [amount0Desired, amount1Desired] = [amount1Desired, amount0Desired];
        [token0IsEth, token1IsEth] = [token1IsEth, token0IsEth];
      }

      const fee = Number(v3FeeTier);
      const spacingRaw = await factory.feeAmountTickSpacing(fee);
      const spacing = Number(spacingRaw || 0);
      if (!spacing) {
        throw new Error("Fee tier not enabled on this factory.");
      }
      let tickLower = Math.ceil(V3_MIN_TICK / spacing) * spacing;
      let tickUpper = Math.floor(V3_MAX_TICK / spacing) * spacing;
      if (v3RangeMode === "custom") {
        const lowerInput = safeNumber(v3RangeLower);
        const upperInput = safeNumber(v3RangeUpper);
        if (
          lowerInput === null ||
          upperInput === null ||
          lowerInput <= 0 ||
          upperInput <= 0 ||
          lowerInput >= upperInput
        ) {
          throw new Error("Enter a valid price range for your position.");
        }
        const meta0 = findTokenMetaByAddress(token0Addr);
        const meta1 = findTokenMetaByAddress(token1Addr);
        const dec0 = await readDecimals(readProvider, token0Addr, meta0);
        const dec1 = await readDecimals(readProvider, token1Addr, meta1);
        let lowerForPool = lowerInput;
        let upperForPool = upperInput;
        if (isReversed) {
          lowerForPool = 1 / upperInput;
          upperForPool = 1 / lowerInput;
        }
        const rawLower = priceToTick(lowerForPool, dec0, dec1);
        const rawUpper = priceToTick(upperForPool, dec0, dec1);
        if (rawLower === null || rawUpper === null) {
          throw new Error("Unable to derive ticks from the selected range.");
        }
        tickLower = Math.floor(rawLower / spacing) * spacing;
        tickUpper = Math.ceil(rawUpper / spacing) * spacing;
        const minTick = Math.ceil(V3_MIN_TICK / spacing) * spacing;
        const maxTick = Math.floor(V3_MAX_TICK / spacing) * spacing;
        tickLower = Math.max(tickLower, minTick);
        tickUpper = Math.min(tickUpper, maxTick);
        if (tickLower >= tickUpper) {
          throw new Error("Selected range is too narrow after tick rounding.");
        }
      }

      const amount0Min = applySlippage(amount0Desired, slippageBps);
      const amount1Min = applySlippage(amount1Desired, slippageBps);

      const manager = new Contract(
        UNIV3_POSITION_MANAGER_ADDRESS,
        UNIV3_POSITION_MANAGER_ABI,
        signer
      );

      let poolAddress = await factory.getPool(token0Addr, token1Addr, fee);
      let needsInit = !poolAddress || poolAddress === ZERO_ADDRESS;
      if (!needsInit) {
        try {
          const pool = new Contract(poolAddress, UNIV3_POOL_ABI, readProvider);
          const slot0 = await pool.slot0();
          if (!slot0?.sqrtPriceX96 || slot0.sqrtPriceX96 === 0n) {
            needsInit = true;
          }
        } catch {
          // If we cannot read slot0, skip init and let mint fail with a clearer error.
        }
      }
      if (needsInit) {
        const meta0 = findTokenMetaByAddress(token0Addr);
        const meta1 = findTokenMetaByAddress(token1Addr);
        const dec0 = await readDecimals(readProvider, token0Addr, meta0);
        const dec1 = await readDecimals(readProvider, token1Addr, meta1);
        const startPriceRaw = (v3StartPrice || "").trim();
        let sqrtPriceX96 = null;
        if (startPriceRaw) {
          let startPriceScaled = safeParseUnits(startPriceRaw, 18);
          if (!startPriceScaled || startPriceScaled <= 0n) {
            throw new Error("Enter a valid starting price to initialize the pool.");
          }
          if (isReversed) {
            startPriceScaled = invertPriceScaled(startPriceScaled);
            if (!startPriceScaled) {
              throw new Error("Starting price too small to initialize the pool.");
            }
          }
          sqrtPriceX96 = encodePriceSqrtFromPrice(startPriceScaled, dec0, dec1);
        }
        if (!sqrtPriceX96) {
          sqrtPriceX96 = encodePriceSqrt(amount1Desired, amount0Desired);
        }
        if (!sqrtPriceX96) {
          throw new Error("Set a valid starting price or deposit amounts to initialize the pool.");
        }
        const initTx = await manager.createAndInitializePoolIfNecessary(
          token0Addr,
          token1Addr,
          fee,
          sqrtPriceX96
        );
        await initTx.wait();
        poolAddress = await factory.getPool(token0Addr, token1Addr, fee);
      }

      if (!token0IsEth && amount0Desired > 0n) {
        const tokenRead = new Contract(token0Addr, ERC20_ABI, readProvider);
        const allowance = await tokenRead.allowance(user, UNIV3_POSITION_MANAGER_ADDRESS);
        if (allowance < amount0Desired) {
          const token = new Contract(token0Addr, ERC20_ABI, signer);
          const tx = await token.approve(UNIV3_POSITION_MANAGER_ADDRESS, MAX_UINT256);
          await tx.wait();
        }
      }
      if (!token1IsEth && amount1Desired > 0n) {
        const tokenRead = new Contract(token1Addr, ERC20_ABI, readProvider);
        const allowance = await tokenRead.allowance(user, UNIV3_POSITION_MANAGER_ADDRESS);
        if (allowance < amount1Desired) {
          const token = new Contract(token1Addr, ERC20_ABI, signer);
          const tx = await token.approve(UNIV3_POSITION_MANAGER_ADDRESS, MAX_UINT256);
          await tx.wait();
        }
      }

      const params = {
        token0: token0Addr,
        token1: token1Addr,
        fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min,
        amount1Min,
        recipient: user,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
      };
      const ethValue =
        (token0IsEth ? amount0Desired : 0n) + (token1IsEth ? amount1Desired : 0n);
      const tx = await manager.mint(params, ethValue > 0n ? { value: ethValue } : {});
      const receipt = await tx.wait();
      setActionStatus({
        variant: "success",
        hash: receipt?.hash,
        message: "Position created.",
      });
      setV3Amount0("");
      setV3Amount1("");
      setV3RefreshTick((t) => t + 1);
      void refreshBalances();
    } catch (err) {
      setV3MintError(friendlyActionError(err, "Position deposit"));
      setActionStatus({
        variant: "error",
        message: friendlyActionError(err, "Position deposit"),
      });
    } finally {
      setV3MintLoading(false);
    }
  };

  const openV3ActionModal = (type, position) => {
    if (!position) return;
    setV3ActionModal({ open: true, type, position });
    setV3ActionAmount0("");
    setV3ActionAmount1("");
    setV3RemovePct("100");
    setV3ActionError("");
    setV3ActionLastEdited(null);
    setV3ActionUseEth0(false);
    setV3ActionUseEth1(false);
  };

  const closeV3ActionModal = () => {
    setV3ActionModal({ open: false, type: null, position: null });
    setV3ActionError("");
    setV3ActionLoading(false);
  };

  const handleV3Collect = async (position) => {
    if (!position) return;
    if (!address) {
      setV3ActionError("Connect your wallet to claim fees.");
      return;
    }
    if (!hasV3Liquidity) {
      setV3ActionError("V3 contracts not configured on this network.");
      return;
    }
    setV3ActionLoading(true);
    setV3ActionError("");
    try {
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const user = await signer.getAddress();
      const manager = new Contract(
        UNIV3_POSITION_MANAGER_ADDRESS,
        UNIV3_POSITION_MANAGER_ABI,
        signer
      );
      const params = {
        tokenId: position.tokenId,
        recipient: user,
        amount0Max: MAX_UINT128,
        amount1Max: MAX_UINT128,
      };
      const tx = await manager.collect(params);
      const receipt = await tx.wait();
      setActionStatus({
        variant: "success",
        hash: receipt?.hash,
        message: "Fees claimed.",
      });
      setV3RefreshTick((t) => t + 1);
      void refreshBalances();
      closeV3ActionModal();
    } catch (err) {
      const msg = friendlyActionError(err, "Claim fees");
      setV3ActionError(msg);
      setActionStatus({ variant: "error", message: msg });
    } finally {
      setV3ActionLoading(false);
    }
  };

  const handleV3Increase = async () => {
    const position = v3ActionModal.position;
    if (!position) return;
    if (!address) {
      setV3ActionError("Connect your wallet to increase this position.");
      return;
    }
    if (!hasV3Liquidity) {
      setV3ActionError("V3 contracts not configured on this network.");
      return;
    }
    const meta0 = findTokenMetaByAddress(position.token0);
    const meta1 = findTokenMetaByAddress(position.token1);
    const dec0 = meta0?.decimals ?? 18;
    const dec1 = meta1?.decimals ?? 18;
    const amount0Parsed = safeParseUnits(v3ActionAmount0 || "0", dec0);
    const amount1Parsed = safeParseUnits(v3ActionAmount1 || "0", dec1);
    if (
      (v3ActionAmount0 && amount0Parsed === null) ||
      (v3ActionAmount1 && amount1Parsed === null)
    ) {
      setV3ActionError("Invalid amount format. Use dot for decimals.");
      return;
    }
    const amount0Desired = amount0Parsed || 0n;
    const amount1Desired = amount1Parsed || 0n;
    const token0IsWeth = Boolean(WETH_ADDRESS) &&
      position.token0?.toLowerCase?.() === WETH_ADDRESS.toLowerCase();
    const token1IsWeth = Boolean(WETH_ADDRESS) &&
      position.token1?.toLowerCase?.() === WETH_ADDRESS.toLowerCase();
    const useEth0 = token0IsWeth && v3ActionUseEth0;
    const useEth1 = token1IsWeth && v3ActionUseEth1;
    if (v3ActionRangeMath) {
      if (v3ActionRangeSide === "dual") {
        if (amount0Desired <= 0n || amount1Desired <= 0n) {
          setV3ActionError("Enter valid amounts for both tokens.");
          return;
        }
      } else if (v3ActionRangeSide === "token0") {
        if (amount0Desired <= 0n) {
          setV3ActionError(`Enter an amount for ${position.token0Symbol}.`);
          return;
        }
      } else if (v3ActionRangeSide === "token1") {
        if (amount1Desired <= 0n) {
          setV3ActionError(`Enter an amount for ${position.token1Symbol}.`);
          return;
        }
      }
    } else if (amount0Desired <= 0n && amount1Desired <= 0n) {
      setV3ActionError("Enter an amount for at least one token.");
      return;
    }
    const symbol0 = useEth0
      ? "ETH"
      : token0IsWeth
      ? "WETH"
      : (meta0?.symbol || position.token0Symbol);
    const symbol1 = useEth1
      ? "ETH"
      : token1IsWeth
      ? "WETH"
      : (meta1?.symbol || position.token1Symbol);
    const balance0Num = safeNumber(resolveWalletBalanceExact(symbol0));
    const balance1Num = safeNumber(resolveWalletBalanceExact(symbol1));
    const amount0Num = safeNumber(v3ActionAmount0) ?? 0;
    const amount1Num = safeNumber(v3ActionAmount1) ?? 0;
    const epsilon = 1e-9;
    const checkBalance = (amount, balance, symbol) => {
      if (!Number.isFinite(amount) || amount <= 0) return true;
      if (balance === null || balance === undefined) return true;
      if (!Number.isFinite(balance)) return true;
      if (amount - balance > epsilon) {
        if (symbol === "WETH") {
          setV3ActionError("Insufficient WETH. Switch to ETH or wrap ETH, then retry.");
        } else if (symbol === "ETH") {
          setV3ActionError("Insufficient ETH for this deposit.");
        } else {
          setV3ActionError(`Insufficient ${symbol} balance for this deposit.`);
        }
        return false;
      }
      return true;
    };
    if (amount0Desired > 0n && !checkBalance(amount0Num, balance0Num, symbol0)) {
      return;
    }
    if (amount1Desired > 0n && !checkBalance(amount1Num, balance1Num, symbol1)) {
      return;
    }
    setV3ActionLoading(true);
    setV3ActionError("");
    try {
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const user = await signer.getAddress();
      const readProvider = getReadOnlyProvider(false, true) || provider;
      const manager = new Contract(
        UNIV3_POSITION_MANAGER_ADDRESS,
        UNIV3_POSITION_MANAGER_ABI,
        signer
      );
      if (amount0Desired > 0n && !useEth0) {
        const tokenRead = new Contract(position.token0, ERC20_ABI, readProvider);
        const allowance = await tokenRead.allowance(user, UNIV3_POSITION_MANAGER_ADDRESS);
        if (allowance < amount0Desired) {
          const token = new Contract(position.token0, ERC20_ABI, signer);
          const tx = await token.approve(UNIV3_POSITION_MANAGER_ADDRESS, MAX_UINT256);
          await tx.wait();
        }
      }
      if (amount1Desired > 0n && !useEth1) {
        const tokenRead = new Contract(position.token1, ERC20_ABI, readProvider);
        const allowance = await tokenRead.allowance(user, UNIV3_POSITION_MANAGER_ADDRESS);
        if (allowance < amount1Desired) {
          const token = new Contract(position.token1, ERC20_ABI, signer);
          const tx = await token.approve(UNIV3_POSITION_MANAGER_ADDRESS, MAX_UINT256);
          await tx.wait();
        }
      }
      const params = {
        tokenId: position.tokenId,
        amount0Desired,
        amount1Desired,
        amount0Min: applySlippage(amount0Desired, slippageBps),
        amount1Min: applySlippage(amount1Desired, slippageBps),
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
      };
      const ethValue =
        (useEth0 ? amount0Desired : 0n) + (useEth1 ? amount1Desired : 0n);
      let tx;
      if (ethValue > 0n) {
        const iface = manager.interface;
        const data = [
          iface.encodeFunctionData("increaseLiquidity", [params]),
          iface.encodeFunctionData("refundETH", []),
        ];
        tx = await manager.multicall(data, { value: ethValue });
      } else {
        tx = await manager.increaseLiquidity(params);
      }
      const receipt = await tx.wait();
      setActionStatus({
        variant: "success",
        hash: receipt?.hash,
        message: "Position increased.",
      });
      setV3RefreshTick((t) => t + 1);
      void refreshBalances();
      closeV3ActionModal();
    } catch (err) {
      const msg = friendlyActionError(err, "Increase liquidity");
      setV3ActionError(msg);
      setActionStatus({ variant: "error", message: msg });
    } finally {
      setV3ActionLoading(false);
    }
  };

  const handleV3Remove = async () => {
    const position = v3ActionModal.position;
    if (!position) return;
    if (!address) {
      setV3ActionError("Connect your wallet to remove liquidity.");
      return;
    }
    if (!hasV3Liquidity) {
      setV3ActionError("V3 contracts not configured on this network.");
      return;
    }
    const pct = Math.max(0, Math.min(100, Number(v3RemovePct || 0)));
    const pctBps = Math.round(pct * 100);
    const liquidityToRemove = (position.liquidity * BigInt(pctBps)) / 10000n;
    if (!liquidityToRemove || liquidityToRemove <= 0n) {
      setV3ActionError("Select a valid percentage to remove.");
      return;
    }
    setV3ActionLoading(true);
    setV3ActionError("");
    try {
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const user = await signer.getAddress();
      const manager = new Contract(
        UNIV3_POSITION_MANAGER_ADDRESS,
        UNIV3_POSITION_MANAGER_ABI,
        signer
      );
      const params = {
        tokenId: position.tokenId,
        liquidity: liquidityToRemove,
        amount0Min: 0,
        amount1Min: 0,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
      };
      const tx = await manager.decreaseLiquidity(params);
      await tx.wait();
      const collectParams = {
        tokenId: position.tokenId,
        recipient: user,
        amount0Max: MAX_UINT128,
        amount1Max: MAX_UINT128,
      };
      const collectTx = await manager.collect(collectParams);
      const receipt = await collectTx.wait();
      setActionStatus({
        variant: "success",
        hash: receipt?.hash,
        message: "Liquidity removed and fees collected.",
      });
      setV3RefreshTick((t) => t + 1);
      void refreshBalances();
      closeV3ActionModal();
    } catch (err) {
      const msg = friendlyActionError(err, "Remove liquidity");
      setV3ActionError(msg);
      setActionStatus({ variant: "error", message: msg });
    } finally {
      setV3ActionLoading(false);
    }
  };

  const handleTokenPick = (token) => {
    if (!token?.symbol) return;
    setTokenSelection({ baseSymbol: token.symbol, pairSymbol: null });
    setShowTokenList(false);
    setPairSelectorOpen(false);
  };

  const handleSelectPoolFromPair = (poolId) => {
    if (!poolId) return;
    setSelectedPoolId(poolId);
    setPairSelectorOpen(false);
    setSelectionDepositPoolId(poolId);
    const target = document.getElementById("token-selection-deposit");
    if (target) target.scrollIntoView({ behavior: "smooth" });
  };

  const handleOpenPoolDepositFromRow = (pool) => {
    if (!pool) return;
    const poolId =
      pool.id ||
      (pool.token0Symbol && pool.token1Symbol
        ? `${String(pool.token0Symbol).toLowerCase()}-${String(pool.token1Symbol).toLowerCase()}`
        : null);
    if (!poolId) return;
    suppressSelectionResetRef.current = true;
    setTokenSelection({
      baseSymbol: pool.token0Symbol,
      pairSymbol: pool.token1Symbol,
    });
    setSelectedPoolId(poolId);
    setSelectionDepositPoolId(poolId);
    setPairSelectorOpen(false);
    const target = document.getElementById("token-selection-deposit");
    if (target) target.scrollIntoView({ behavior: "smooth" });
  };

  const copyAddress = useCallback(
    (address) => {
      if (!address) return;
      const done = () => {
        setV3CopiedAddress(address);
        if (v3CopyTimerRef.current) {
          clearTimeout(v3CopyTimerRef.current);
        }
        v3CopyTimerRef.current = setTimeout(() => {
          setV3CopiedAddress("");
          v3CopyTimerRef.current = null;
        }, 1000);
      };
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(address).then(done).catch(done);
      } else {
        done();
      }
    },
    [setV3CopiedAddress]
  );

  useEffect(() => {
    if (!poolSelection) return;
    const raw0 =
      poolSelection.token0Symbol ||
      poolSelection.baseSymbol ||
      poolSelection.token0;
    const raw1 =
      poolSelection.token1Symbol ||
      poolSelection.pairSymbol ||
      poolSelection.token1;
    if (!raw0 || !raw1) return;
    const resolveSymbol = (symbol) => {
      const trimmed = String(symbol || "").trim();
      if (!trimmed) return "";
      if (tokenRegistry[trimmed]) return trimmed;
      const found = Object.keys(tokenRegistry).find(
        (key) => key.toLowerCase() === trimmed.toLowerCase()
      );
      return found || trimmed;
    };
    const token0Symbol = resolveSymbol(raw0);
    const token1Symbol = resolveSymbol(raw1);
    if (!token0Symbol || !token1Symbol) return;
    const feeTierNum = Number(poolSelection.feeTier);
    const hasFeeTier = Number.isFinite(feeTierNum) && feeTierNum > 0;
    const typeRaw = String(poolSelection.type || "").toUpperCase();
    const preferV3 = typeRaw === "V3" || (!typeRaw && hasFeeTier);
    const preferV2 = typeRaw === "V2" || (!typeRaw && !hasFeeTier);
    const selectionKey = [
      typeRaw || (preferV3 ? "V3" : "V2"),
      token0Symbol,
      token1Symbol,
      hasFeeTier ? feeTierNum : "",
    ].join(":");
    if (lastPoolSelectionRef.current === selectionKey) return;

    let targetView = null;
    if (preferV3 && showV3) targetView = "v3";
    else if (preferV2 && showV2) targetView = "v2";
    else if (showV3) targetView = "v3";
    else if (showV2) targetView = "v2";

    if (targetView === "v3") {
      setLiquidityView("v3");
      setV3Token0(token0Symbol);
      setV3Token1(token1Symbol);
      if (hasFeeTier) setV3FeeTier(feeTierNum);
      window.requestAnimationFrame(() => {
        const target = document.getElementById("v3-add-liquidity");
        if (target) target.scrollIntoView({ behavior: "smooth" });
      });
      lastPoolSelectionRef.current = selectionKey;
      return;
    }

    if (targetView === "v2") {
      setLiquidityView("v2");
      suppressSelectionResetRef.current = true;
      setTokenSelection({
        baseSymbol: token0Symbol,
        pairSymbol: token1Symbol,
      });
      setPairSelectorOpen(false);
      const lower0 = token0Symbol.toLowerCase();
      const lower1 = token1Symbol.toLowerCase();
      const matched = allPools.find((p) => {
        const symA = (p.token0Symbol || "").toLowerCase();
        const symB = (p.token1Symbol || "").toLowerCase();
        return (
          (symA === lower0 && symB === lower1) ||
          (symA === lower1 && symB === lower0)
        );
      });
      const fallbackId = `custom-${token0Symbol}-${token1Symbol}`;
      const poolId = matched?.id || fallbackId;
      setSelectedPoolId(poolId);
      setSelectionDepositPoolId(poolId);
      window.requestAnimationFrame(() => {
        const target = document.getElementById("token-selection-deposit");
        if (target) target.scrollIntoView({ behavior: "smooth" });
      });
      lastPoolSelectionRef.current = selectionKey;
    }
  }, [poolSelection, tokenRegistry, allPools, showV2, showV3]);

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
        if (isLiquidityTokenBlocked({ symbol: tokenKey, address: addr })) {
          setCustomTokenAddError("Token not supported in liquidity yet.");
          return false;
        }
        const alreadySymbol = tokenRegistry[tokenKey];
        if (alreadySymbol) {
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
            logo: TOKENS.CRX.logo,
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

  useEffect(() => {
    let cancelled = false;
    const loadBalances = async () => {
      setTokenBalanceLoading(true);
      setTokenBalanceError("");
      setTokenBalances(null);
      if (!selectedPool) {
        setTokenBalanceLoading(false);
        return;
      }
      if (!poolSupportsActions) {
        setTokenBalanceLoading(false);
        return;
      }
      try {
        const activeChainId = (getActiveNetworkConfig()?.chainIdHex || "").toLowerCase();
        const walletChainId = (chainId || "").toLowerCase();
        const preferWallet = walletChainId && walletChainId === activeChainId;

        let provider;
        if (preferWallet) {
          try {
            provider = await getProvider();
          } catch {
            provider = getReadOnlyProvider();
          }
        } else {
          provider = getReadOnlyProvider(false, true);
        }
        const user = address || null;
        if (!user) {
          setTokenBalanceError("");
          return;
        }

        const fetchBalance = async (symbol, address, meta) => {
          if (symbol === "ETH") {
            const bal = await provider.getBalance(user);
            return Number(formatUnits(bal, 18));
          }
          if (!address) {
            const bal = await provider.getBalance(user);
            return Number(formatUnits(bal, 18));
          }
          const erc20 = new Contract(address, ERC20_ABI, provider);
          const decimals = await readDecimals(provider, address, meta);
          const bal = await erc20.balanceOf(user);
          return Number(formatUnits(bal, decimals));
        };

        const [bal0, bal1] = await Promise.all([
          fetchBalance(selectedToken0Symbol, token0Address, token0Meta),
          fetchBalance(selectedToken1Symbol, token1Address, token1Meta),
        ]);

        if (!cancelled) {
          setTokenBalances({
            token0: bal0,
            token1: bal1,
          });
        }
      } catch (err) {
        if (!cancelled) {
          const msg = compactRpcMessage(
            err.message,
            "Wallet balances not available. Open your wallet and retry."
          );
          setTokenBalanceError(msg);
        }
      } finally {
        if (!cancelled) setTokenBalanceLoading(false);
      }
    };
    loadBalances();
    return () => {
      cancelled = true;
    };
  }, [
    poolSupportsActions,
    pairMissing,
    selectedPoolId,
    selectedPool,
    lpRefreshTick,
    token0Address,
    token1Address,
    selectedToken0Symbol,
    selectedToken1Symbol,
    token0Meta,
    token0Meta?.decimals,
    token1Meta,
    token1Meta?.decimals,
    address,
    chainId,
    readDecimals,
  ]);

  const handleDeposit = async () => {
    let provider;
    try {
      setActionStatus(null);
      setActionLoading(true);

      if (!selectedPool) {
        throw new Error("Select a pool");
      }
      if (!poolSupportsActions) {
        throw new Error(
          "Unsupported pool: missing address for one of the tokens"
        );
      }

      const amount0 = depositToken0 ? Number(depositToken0) : 0;
      const amount1 = depositToken1 ? Number(depositToken1) : 0;
      if (amount0 <= 0 || amount1 <= 0) {
        throw new Error(
          `Enter amounts for ${selectedPool.token0Symbol} and ${selectedPool.token1Symbol}`
        );
      }
      const dec0 = requireDecimals(token0Meta, selectedPool.token0Symbol);
      const dec1 = requireDecimals(token1Meta, selectedPool.token1Symbol);

      const normalizeChainHex = (value) => {
        if (value === null || value === undefined) return null;
        const str = String(value).trim();
        if (str.startsWith("0x") || str.startsWith("0X")) return str.toLowerCase().replace(/^0x0+/, "0x");
        const num = Number(str);
        if (Number.isFinite(num)) return `0x${num.toString(16)}`;
        return str.toLowerCase();
      };
      const activeChainHex = normalizeChainHex(getActiveNetworkConfig()?.chainIdHex || "");
      const walletChainHex = normalizeChainHex(chainId);
      if (walletChainHex && activeChainHex && walletChainHex !== activeChainHex) {
        throw new Error("Wallet network differs from the selected network. Switch network to add liquidity.");
      }

      // Preflight balance guard to avoid on-chain reverts (common when selecting WETH without wrapping ETH first).
      const epsilon = 1e-9;
      const checkBalance = (amt, bal, sym) => {
        if (bal === null || bal === undefined) return;
        if (amt - bal > epsilon) {
          if (sym === "WETH") {
            throw new Error("Insufficient WETH. Wrap ETH to WETH, then retry.");
          }
          throw new Error(`Insufficient ${sym} balance for this deposit.`);
        }
      };
      checkBalance(amount0, tokenBalances?.token0, selectedPool.token0Symbol);
      checkBalance(amount1, tokenBalances?.token1, selectedPool.token1Symbol);

      try {
        provider = await getProvider();
      } catch {
        provider = getReadOnlyProvider();
      }
      const signer = await provider.getSigner();
      const user = await signer.getAddress();

      // Guard against wrong preset (router missing on the connected chain)
      const routerCode = await provider.getCode(UNIV2_ROUTER_ADDRESS);
      if (!routerCode || routerCode === "0x") {
        throw new Error(
          "Router contract not deployed on this chain. Switch the app preset to the matching network."
        );
      }

      const router = new Contract(UNIV2_ROUTER_ADDRESS, UNIV2_ROUTER_ABI, signer);
      const factory = new Contract(UNIV2_FACTORY_ADDRESS, UNIV2_FACTORY_ABI, signer);

      const parsed0 = safeParseUnits(
        amount0.toString().replace(",", "."),
        dec0
      );
      const parsed1 = safeParseUnits(
        amount1.toString().replace(",", "."),
        dec1
      );
      if (!parsed0 || !parsed1) {
        throw new Error("Invalid amount format. Use dot for decimals.");
      }
      const parsed0Min = applySlippage(parsed0, slippageBps);
      const parsed1Min = applySlippage(parsed1, slippageBps);

      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

      // Higher caps to cover first-time pair deployment gas.
      const safeGasLimitCreate = 120_000_000n;
      const safeGasLimit = 8_000_000n;

      // Ensure the pair is deployed before attempting addLiquidity; router sometimes forwards
      // limited gas when creating a new pair which can cause silent out-of-gas reverts.
      const zeroAddr = "0x0000000000000000000000000000000000000000";
      let pairAddr = await factory.getPair(token0Address, token1Address);
      if (!pairAddr || pairAddr === zeroAddr) {
        setActionStatus({ message: "Deploying pool...", variant: "pending" });
        try {
          const est = await factory
            .createPair.estimateGas(token0Address, token1Address)
            .catch(() => null);
          const gasLimitForCreate =
            est && typeof est === "bigint" ? est * 2n : safeGasLimitCreate;
          const txCreate = await factory.createPair(token0Address, token1Address, {
            gasLimit: gasLimitForCreate,
          });
          await txCreate.wait();
        } catch (err) {
          const msg = (err?.message || "").toLowerCase();
          if (!msg.includes("pair exists")) {
            // If we still OOG, bubble up with a clearer hint.
            throw new Error(
              `Pool deployment failed (gas cap ${safeGasLimitCreate.toString()}): ` +
              (err?.message || "unknown error")
            );
          }
        }
        pairAddr = await factory.getPair(token0Address, token1Address);
        setPairNotDeployed(false);
        setPairLiveTick((t) => t + 1);
      }

      if (usesNativeEth) {
        const ethIsToken0 = selectedPool.token0Symbol === "ETH";
        const ethValue = ethIsToken0 ? parsed0 : parsed1;
        const tokenAmount = ethIsToken0 ? parsed1 : parsed0;
        const tokenMin = ethIsToken0 ? parsed1Min : parsed0Min;
        const ethMin = ethIsToken0 ? parsed0Min : parsed1Min;
        const tokenAddress = ethIsToken0 ? token1Address : token0Address;
        const tokenContract = new Contract(tokenAddress, ERC20_ABI, signer);
        const allowances = await fetchAllowances(
          signer.provider || provider,
          user,
          UNIV2_ROUTER_ADDRESS,
          [tokenAddress]
        );
        const allowance = allowances[(tokenAddress || "").toLowerCase()] ?? 0n;
        if (allowance < tokenAmount) {
          await (
            await tokenContract.approve(UNIV2_ROUTER_ADDRESS, tokenAmount)
          ).wait();
        }

        const tx = await router.addLiquidityETH(
          tokenAddress,
          tokenAmount,
          tokenMin,
          ethMin,
          user,
          deadline,
          { value: ethValue, gasLimit: safeGasLimit }
        );
        const receipt = await tx.wait();
      setActionStatus({
        variant: "success",
        hash: receipt.hash,
        message: `Deposited ${getPoolLabel(selectedPool)}`,
      });
      } else {
        const token0Contract = new Contract(token0Address, ERC20_ABI, signer);
        const token1Contract = new Contract(token1Address, ERC20_ABI, signer);

        const allowances = await fetchAllowances(
          signer.provider || provider,
          user,
          UNIV2_ROUTER_ADDRESS,
          [token0Address, token1Address]
        );
        const allowance0 = allowances[(token0Address || "").toLowerCase()] ?? 0n;
        const allowance1 = allowances[(token1Address || "").toLowerCase()] ?? 0n;
        if (allowance0 < parsed0) {
          await (await token0Contract.approve(UNIV2_ROUTER_ADDRESS, parsed0)).wait();
        }
        if (allowance1 < parsed1) {
          await (await token1Contract.approve(UNIV2_ROUTER_ADDRESS, parsed1)).wait();
        }

        const tx = await router.addLiquidity(
          token0Address,
          token1Address,
          parsed0,
          parsed1,
          parsed0Min,
          parsed1Min,
          user,
          deadline,
          { gasLimit: safeGasLimit }
        );
        const receipt = await tx.wait();
        setActionStatus({
          variant: "success",
          hash: receipt.hash,
          message: `Deposited ${getPoolLabel(selectedPool)}`,
        });
      }

      setLpRefreshTick((t) => t + 1);
      void refreshBalances();
    } catch (e) {
      const txHash = extractTxHash(e);
      if (txHash) {
        const receipt = await tryFetchReceipt(txHash, provider);
        const status = receipt?.status;
        const normalized =
          typeof status === "bigint" ? Number(status) : status;
        const poolLabel = getPoolLabel(selectedPool);
        if (normalized === 1) {
          setActionStatus({
            variant: "success",
            hash: txHash,
            message: poolLabel ? `Deposited ${poolLabel}` : "Deposit confirmed",
          });
          setLpRefreshTick((t) => t + 1);
          void refreshBalances();
          return;
        }
        if (normalized === 0) {
          setActionStatus({
            variant: "error",
            hash: txHash,
            message: friendlyActionError(e, "Deposit"),
          });
          return;
        }
        setActionStatus({
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
      setActionStatus({
        variant: "error",
        message: userRejected
          ? "Transaction was rejected in wallet."
          : friendlyActionError(e, "Deposit"),
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleWithdraw = async () => {
    let provider;
    try {
      setActionStatus(null);
      setActionLoading(true);
      const lpAmount = withdrawLp ? Number(withdrawLp) : 0;
      if (lpAmount <= 0) throw new Error("Enter LP amount to withdraw");

      if (!selectedPool) {
        throw new Error("Select a pool");
      }
      if (!poolSupportsActions) {
        throw new Error(
          "Unsupported pool: missing address for one of the tokens"
        );
      }

      const normalizeChainHex = (value) => {
        if (value === null || value === undefined) return null;
        const str = String(value).trim();
        if (str.startsWith("0x") || str.startsWith("0X")) return str.toLowerCase().replace(/^0x0+/, "0x");
        const num = Number(str);
        if (Number.isFinite(num)) return `0x${num.toString(16)}`;
        return str.toLowerCase();
      };
      const activeChainHex = normalizeChainHex(getActiveNetworkConfig()?.chainIdHex || "");
      const walletChainHex = normalizeChainHex(chainId);
      if (walletChainHex && activeChainHex && walletChainHex !== activeChainHex) {
        throw new Error("Wallet network differs from the selected network. Switch network to withdraw.");
      }

      provider = await getProvider();
      const signer = await provider.getSigner();
      const user = await signer.getAddress();

      const resolvedPair =
        pairInfo ||
        (await getV2PairReserves(provider, token0Address, token1Address));

      const pairErc20 = new Contract(resolvedPair.pairAddress, ERC20_ABI, signer);
      const lpDecimals =
        lpDecimalsState ||
        (await pairErc20.decimals().catch(() => 18)) ||
        18;
      const normalized = lpAmount.toFixed(Math.min(lpDecimals, 18));
      const lpValue = parseUnits(normalized, lpDecimals);
      if (lpBalanceRaw && lpValue > lpBalanceRaw) {
        throw new Error("Amount exceeds LP balance");
      }

      // Approve router to spend LP
      const lpAllowances = await fetchAllowances(
        signer.provider || provider,
        user,
        UNIV2_ROUTER_ADDRESS,
        [resolvedPair.pairAddress]
      );
      const lpAllowance = lpAllowances[(resolvedPair.pairAddress || "").toLowerCase()] ?? 0n;
      if (lpAllowance < lpValue) {
        await (await pairErc20.approve(UNIV2_ROUTER_ADDRESS, lpValue)).wait();
      }

      const totalSupply = await pairErc20.totalSupply();
      const reserve0 = resolvedPair.reserve0 || 0n;
      const reserve1 = resolvedPair.reserve1 || 0n;
      const amount0Expected =
        totalSupply && totalSupply > 0n ? (lpValue * reserve0) / totalSupply : 0n;
      const amount1Expected =
        totalSupply && totalSupply > 0n ? (lpValue * reserve1) / totalSupply : 0n;
      const amount0Min = applySlippage(amount0Expected, slippageBps);
      const amount1Min = applySlippage(amount1Expected, slippageBps);

      const router = new Contract(
        UNIV2_ROUTER_ADDRESS,
        UNIV2_ROUTER_ABI,
        signer
      );
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

      let tx;
      if (usesNativeEth) {
        const tokenAddress =
          selectedPool.token0Symbol === "ETH" ? token1Address : token0Address;
        const tokenMin =
          (resolvedPair.token0?.toLowerCase?.() === tokenAddress.toLowerCase()
            ? amount0Min
            : amount1Min) || 0n;
        const ethMin =
          (resolvedPair.token0?.toLowerCase?.() === tokenAddress.toLowerCase()
            ? amount1Min
            : amount0Min) || 0n;
        tx = await router.removeLiquidityETH(
          tokenAddress,
          lpValue,
          tokenMin,
          ethMin,
          user,
          deadline
        );
      } else {
        const token0Lower = (token0Address || "").toLowerCase();
        const amountAMin =
          resolvedPair.token0?.toLowerCase?.() === token0Lower ? amount0Min : amount1Min;
        const amountBMin =
          resolvedPair.token0?.toLowerCase?.() === token0Lower ? amount1Min : amount0Min;
        tx = await router.removeLiquidity(
          token0Address,
          token1Address,
          lpValue,
          amountAMin,
          amountBMin,
          user,
          deadline
        );
      }

      const receipt = await tx.wait();
      setActionStatus({
        variant: "success",
        hash: receipt.hash,
        message: `Withdrew ${getPoolLabel(selectedPool)}`,
      });
      setLpRefreshTick((t) => t + 1);
      void refreshBalances();
    } catch (e) {
      const txHash = extractTxHash(e);
      if (txHash) {
        const receipt = await tryFetchReceipt(txHash, provider);
        const status = receipt?.status;
        const normalized =
          typeof status === "bigint" ? Number(status) : status;
        const poolLabel = getPoolLabel(selectedPool);
        if (normalized === 1) {
          setActionStatus({
            variant: "success",
            hash: txHash,
            message: poolLabel ? `Withdrew ${poolLabel}` : "Withdraw confirmed",
          });
          setLpRefreshTick((t) => t + 1);
          void refreshBalances();
          return;
        }
        if (normalized === 0) {
          setActionStatus({
            variant: "error",
            hash: txHash,
            message: friendlyActionError(e, "Withdraw"),
          });
          return;
        }
        setActionStatus({
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
      setActionStatus({
        variant: "error",
        message: userRejected
          ? "Transaction was rejected in wallet."
          : friendlyActionError(e, "Withdraw"),
      });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 pb-12 text-slate-100 mt-8">
      {/* dedicated token deposit flow */}
      {isV2View && tokenSelection ? (
        <div className="w-full flex justify-center px-4 sm:px-6 pb-10">
          <div className="w-full max-w-4xl rounded-3xl bg-[#0a1024] border border-slate-800 shadow-2xl shadow-black/50 p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="text-xl font-semibold text-slate-50">New deposit</div>
                <div className="text-sm text-slate-400">Choose your token and the pair to start providing liquidity.</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTokenSelection(null);
                  setPairSelectorOpen(false);
                }}
                className="px-3 py-1.5 rounded-full border border-slate-700 bg-slate-900 text-slate-200 text-xs hover:border-slate-500"
              >
                Back to pools
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-slate-900/80 border border-slate-800 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {baseSelected?.logo && (
                    <img
                      src={baseSelected.logo}
                      alt={`${baseSelected.symbol} logo`}
                      className="h-10 w-10 rounded-full border border-slate-800 bg-slate-900 object-contain"
                    />
                  )}
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-500">Token you want to deposit</span>
                    <span className="text-sm font-semibold text-slate-100">
                      {baseSelected?.symbol || tokenSelection.baseSymbol}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTokenList(true)}
                  className="h-9 w-9 flex items-center justify-center rounded-full border border-slate-800 text-slate-300 hover:border-slate-600"
                  aria-label="Change base token"
                >
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                  >
                    <path
                      d="M5 8a5 5 0 0 1 9-3.1M14 4.5V2.5m0 0h-2m2 0 2 2M15 12a5 5 0 0 1-9 3.1M6 15.5V17.5m0 0h2m-2 0-2-2"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPairSelectorOpen((v) => !v)}
                  className="w-full rounded-2xl bg-slate-900/80 border border-slate-800 text-slate-100 px-4 py-3 flex items-center justify-between shadow-lg shadow-black/40"
                >
                  <div className="flex items-center gap-3">
                    {pairSelected?.logo ? (
                      <img
                        src={pairSelected.logo}
                        alt={`${pairSelected.symbol} logo`}
                        className="h-10 w-10 rounded-full border border-slate-800 bg-slate-900 object-contain"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-full bg-slate-900 border border-slate-800" />
                    )}
                    <div className="flex flex-col text-left">
                      <span className="text-xs text-slate-400">Token you want to pair with</span>
                      <span className="text-sm font-semibold">
                        {pairSelected?.symbol || "Select token"}
                      </span>
                    </div>
                  </div>
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className={`h-4 w-4 text-slate-400 transition ${pairSelectorOpen ? "rotate-180" : ""}`}
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
                {pairSelectorOpen && (
                  <div className="absolute z-30 mt-2 w-full max-h-72 overflow-y-auto rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl shadow-black/40">
                    {pairOptions.map((opt) => (
                      <button
                        key={`pair-${opt.symbol}`}
                        type="button"
                        onClick={() => {
                          setTokenSelection((prev) => ({
                            ...prev,
                            pairSymbol: opt.symbol,
                          }));
                          setPairSelectorOpen(false);
                        }}
                        className="w-full px-4 py-3 flex items-center gap-3 text-sm text-slate-100 hover:bg-slate-800/70"
                      >
                        <img
                          src={opt.logo}
                          alt={`${opt.symbol} logo`}
                          className="h-8 w-8 rounded-full border border-slate-800 bg-slate-900 object-contain"
                        />
                        <div className="flex flex-col items-start">
                          <span className="font-semibold">{opt.symbol}</span>
                          <span className="text-[11px] text-slate-500">{opt.name}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {selectionPools.map((p) => (
                <div
                  key={`sel-${p.id}`}
                  className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 shadow-lg shadow-black/30"
                >
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {[tokenRegistry[p.token0Symbol], tokenRegistry[p.token1Symbol]].map((t, idx) => (
                        <img
                          key={idx}
                          src={t?.logo}
                          alt={`${t?.symbol} logo`}
                          className="h-10 w-10 rounded-full border border-slate-800 bg-slate-900 object-contain"
                        />
                      ))}
                    <div className="flex flex-col">
                      <div className="text-sm font-semibold text-slate-100">
                        {p.token0Symbol} / {p.token1Symbol}
                      </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2">
                      {p.poolType || "volatile"} pool
                      <span className="px-2 py-0.5 rounded-full text-[10px] border border-slate-700/60 bg-slate-800/40 text-slate-200">
                        V2
                      </span>
                      {(() => {
                        const { label, className } = getStatusStyle(p.isActive);
                        return (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] border ${className}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-slate-200">
                    <div className="text-right">
                        <div className="text-[11px] text-slate-500">APR</div>
                        <div>{p.feeApr ? `${p.feeApr.toFixed(2)}%` : "N/A"}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-slate-500">TVL</div>
                        <div>{formatNumber(p.tvlUsd)}</div>
                      </div>
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-full bg-sky-600 text-white text-xs font-semibold shadow-lg shadow-sky-500/30"
                        onClick={() => handleSelectPoolFromPair(p.id)}
                      >
                        New deposit
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {!selectionPools.length && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-4 text-sm text-slate-400">
                  No pools found for this pair yet.
                </div>
              )}
            </div>

            {selectionDepositPoolId && selectedPool && selectedPool.id === selectionDepositPoolId && (
              <div
                id="token-selection-deposit"
                className="mt-6 rounded-3xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-black/40 p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Pool status
                    </div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                      {getPoolLabel(selectedPool)}
                      {(() => {
                        const { label, className } = getStatusStyle(selectedPool?.isActive);
                        return (
                          <span className={`px-2 py-0.5 rounded-full text-[11px] border ${className}`}>
                            {label}
                          </span>
                        );
                      })()}
                    </div>
                    {!selectedPool?.isActive && (
                      <div className="text-[11px] text-amber-200 mt-1">
                        No live liquidity detected yet. Deposits here will seed the pool.
                      </div>
                    )}
                    {!poolSupportsActions && (
                      <div className="text-[11px] text-amber-200 mt-1">
                        Interaction disabled: missing on-chain address for at least one token.
                      </div>
                    )}
                    {pairError && (
                      <div className="text-[11px] text-amber-200 mt-1">
                        {pairError}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative" ref={v2DepositMenuRef}>
                      <button
                        type="button"
                        onClick={() => setV2DepositMenuOpen((prev) => !prev)}
                        className="h-8 w-8 rounded-full border border-slate-700 bg-slate-900/70 text-slate-200 hover:border-slate-500 inline-flex items-center justify-center"
                        aria-haspopup="menu"
                        aria-expanded={v2DepositMenuOpen}
                        aria-label="Open pool details"
                      >
                        <svg
                          viewBox="0 0 20 20"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4 text-slate-300"
                        >
                          <circle cx="4" cy="10" r="1.5" fill="currentColor" />
                          <circle cx="10" cy="10" r="1.5" fill="currentColor" />
                          <circle cx="16" cy="10" r="1.5" fill="currentColor" />
                        </svg>
                      </button>
                      {v2DepositMenuOpen && (
                        <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-slate-800 bg-slate-950/95 shadow-2xl shadow-black/40 p-2 z-20">
                          {[
                            {
                              id: "token0",
                              label: token0Meta?.symbol || selectedPool?.token0Symbol,
                              address: token0Address,
                            },
                            {
                              id: "token1",
                              label: token1Meta?.symbol || selectedPool?.token1Symbol,
                              address: token1Address,
                            },
                            {
                              id: "pool",
                              label: "Pool",
                              address:
                                pairInfo?.pairAddress ||
                                selectedPool?.pairAddress ||
                                pairIdOverride ||
                                "",
                            },
                          ].map((item) => {
                            const hasAddress = Boolean(item.address);
                            return (
                              <div
                                key={`v2-pool-${item.id}`}
                                className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 text-xs text-slate-200 hover:bg-slate-900/80"
                              >
                                <span className="font-semibold">{item.label || "--"}</span>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => copyAddress(item.address)}
                                    disabled={!hasAddress}
                                    className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:border-sky-500/60 hover:text-sky-100 disabled:opacity-40"
                                    aria-label={`Copy ${item.label} address`}
                                  >
                                    {v3CopiedAddress === item.address ? (
                                      <svg
                                        viewBox="0 0 20 20"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="h-3.5 w-3.5 text-emerald-300 mx-auto"
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
                                        className="h-3.5 w-3.5 mx-auto"
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
                                  {hasAddress ? (
                                    <a
                                      href={`${EXPLORER_BASE_URL}/address/${item.address}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:border-sky-500/60 hover:text-sky-100 inline-flex items-center justify-center"
                                      aria-label={`Open ${item.label} on explorer`}
                                    >
                                      <svg
                                        viewBox="0 0 20 20"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="h-3.5 w-3.5"
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
                                  ) : (
                                    <div className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-600 inline-flex items-center justify-center">
                                      <span className="text-[10px]">--</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {pairInfo?.pairAddress && (
                      <a
                        href={`${EXPLORER_BASE_URL}/address/${pairInfo.pairAddress}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-sky-400 hover:text-sky-300 underline"
                      >
                        View pair on {EXPLORER_LABEL}
                      </a>
                    )}
                  </div>
                </div>

                {poolSupportsActions && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    {[
                      {
                        symbol: token0Meta?.symbol || selectedPool?.token0Symbol,
                        balance: tokenBalances?.token0,
                        logo: token0Meta?.logo,
                      },
                      {
                        symbol: token1Meta?.symbol || selectedPool?.token1Symbol,
                        balance: tokenBalances?.token1,
                        logo: token1Meta?.logo,
                      },
                    ].map((t, idx) => (
                      <div
                        key={idx}
                        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-950 to-sky-900/40 border border-slate-800/80 px-4 py-3 flex items-center justify-between"
                      >
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-slate-500">
                            Balance
                          </div>
                          <div className="text-xl font-semibold text-slate-100 flex items-baseline gap-2">
                            <span>
                              {tokenBalanceLoading
                                ? "Loading..."
                                : formatTokenBalance(t.balance)}
                            </span>
                            <span className="text-sm text-slate-400">{t.symbol}</span>
                          </div>
                        </div>
                        {t.logo && (
                          <img
                            src={t.logo}
                            alt={`${t.symbol || "token"} logo`}
                            className="h-10 w-10 rounded-full border border-slate-800 bg-slate-900 object-contain shadow-lg shadow-black/30"
                          />
                        )}
                        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_20%,rgba(94,234,212,0.08),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(14,165,233,0.08),transparent_35%)]" />
                      </div>
                    ))}
                  </div>
                )}
                {tokenBalanceError && !pairMissing && (
                  <div className="text-[11px] text-amber-200 mb-3">
                    Balances unavailable. Open your wallet and try again.
                  </div>
                )}

                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input
                      name="v2-deposit-token0"
                      value={depositToken0}
                      onChange={(e) => {
                        setLastEdited(token0Meta?.symbol || selectedPool?.token0Symbol);
                        setDepositToken0(e.target.value);
                        if (actionStatus) setActionStatus(null);
                      }}
                      placeholder={`${token0Meta?.symbol || "Token A"} amount`}
                      className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100"
                    />
                    <input
                      name="v2-deposit-token1"
                      value={depositToken1}
                      onChange={(e) => {
                        setLastEdited(token1Meta?.symbol || selectedPool?.token1Symbol);
                        setDepositToken1(e.target.value);
                        if (actionStatus) setActionStatus(null);
                      }}
                      placeholder={`${token1Meta?.symbol || "Token B"} amount`}
                      className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100"
                    />
                    <button
                      disabled={actionLoading || !poolSupportsActions || pairBlockingError}
                      onClick={handleDeposit}
                      className="px-4 py-2.5 rounded-xl bg-sky-600 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 disabled:opacity-60 w-full md:w-auto"
                    >
                      {actionLoading
                        ? "Processing..."
                        : `Deposit ${getPoolLabel(selectedPool)}`}
                    </button>
                    <div className="md:col-span-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      {[0.25, 0.5, 0.75, 1].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          disabled={!tokenBalances && !walletBalances}
                          onClick={() => applyDepositRatio(pct)}
                          className="px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900 text-slate-100 disabled:opacity-50"
                        >
                          {Math.round(pct * 100)}%
                        </button>
                      ))}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500">Slippage %</span>
                        <input
                          name="v2-slippage"
                          value={slippageInput}
                          onChange={(e) => {
                            setSlippageInput(e.target.value);
                            setSlippageMode("custom");
                          }}
                          className="w-20 px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-100"
                          placeholder="0.5"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input
                      name="v2-withdraw-lp"
                      value={withdrawLp}
                      onChange={(e) => {
                        setWithdrawLp(e.target.value);
                        if (actionStatus) setActionStatus(null);
                      }}
                      disabled={!hasLpBalance}
                      placeholder={hasLpBalance ? "LP tokens" : "No LP to withdraw"}
                      className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 disabled:opacity-50"
                    />
                    {lpBalance !== null && (
                      <div className="text-xs text-slate-400 self-center">
                        LP balance: {lpBalance.toFixed(8)}{" "}
                        <button
                          type="button"
                          className="text-sky-400 hover:text-sky-300 underline ml-1 disabled:opacity-50"
                          onClick={() => setLpRefreshTick((t) => t + 1)}
                          disabled={actionLoading}
                        >
                          Refresh
                        </button>
                      </div>
                    )}
                    {pairMissing ? (
                      <div className="text-xs text-slate-400 self-center">
                        Pool not deployed yet. Your first deposit will create it.
                      </div>
                    ) : lpBalanceError ? (
                      <div className="text-xs text-rose-300 self-center">
                        {lpBalanceError}
                      </div>
                    ) : !hasLpBalance ? (
                      <div className="text-xs text-slate-400 self-center">
                        You need LP tokens in this pool before withdrawing.
                      </div>
                    ) : null}
                    <button
                      disabled={
                        actionLoading ||
                        !poolSupportsActions ||
                        pairBlockingError ||
                        !hasLpBalance
                      }
                      onClick={handleWithdraw}
                      className="px-4 py-2.5 rounded-xl bg-indigo-600 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 disabled:opacity-60 w-full md:w-auto"
                    >
                      {actionLoading
                        ? "Processing..."
                        : `Withdraw ${getPoolLabel(selectedPool)}`}
                    </button>
                    <div className="md:col-span-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      {[0.25, 0.5, 0.75, 1].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          disabled={!hasLpBalance}
                          onClick={() => applyWithdrawRatio(pct)}
                          className="px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900 text-slate-100 disabled:opacity-50"
                        >
                          {Math.round(pct * 100)}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3 text-xs text-slate-300">
                  {depositQuoteError && (
                    <div className="px-2 py-1.5 rounded border border-rose-500/30 bg-transparent text-rose-200">
                      {depositQuoteError}
                    </div>
                  )}
                  {subgraphError && (
                    <div className="px-2 py-1.5 rounded border border-slate-700/60 bg-transparent text-slate-200">
                      Live data unavailable right now. Please retry later.
                    </div>
                  )}
                  {tvlError && (
                    <div className="px-2 py-1.5 rounded border border-amber-500/30 bg-transparent text-amber-200">
                      On-chain TVL unavailable at the moment.
                    </div>
                  )}
                </div>
              </div>
            )}

            <div id="pool-actions" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {hasBothLiquidityViews && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <div className="text-sm font-semibold text-slate-100">Liquidity view</div>
              <div className="flex items-center gap-1 rounded-full bg-slate-950/70 border border-slate-800 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setLiquidityView("v2");
                    if (tokenSelection) {
                      setTokenSelection(null);
                      setSelectionDepositPoolId(null);
                      setPairSelectorOpen(false);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-full transition ${
                    isV2View
                      ? "bg-sky-500/20 text-sky-200"
                      : "text-slate-400 hover:text-slate-100"
                  }`}
                  aria-pressed={isV2View}
                >
                  V2 Liquidity
                </button>
                <button
                  type="button"
                  onClick={() => setLiquidityView("v3")}
                  className={`px-3 py-1.5 rounded-full transition ${
                    isV3View
                      ? "bg-emerald-500/20 text-emerald-200"
                      : "text-slate-400 hover:text-slate-100"
                  }`}
                  aria-pressed={isV3View}
                >
                  V3 Positions
                </button>
              </div>
            </div>
          )}
          {isV3View && (
            <div
              id="v3-add-liquidity"
              className="bg-[#050816] border border-slate-800/80 rounded-3xl shadow-xl shadow-black/40"
            >
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-800/70">
              <div>
                <div className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  Add Liquidity
                  <span className="px-2 py-0.5 rounded-full text-[10px] border border-emerald-400/40 bg-emerald-500/10 text-emerald-200">
                    V3
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  Create a concentrated position with custom price ranges.
                </div>
              </div>
              {!hasV3Liquidity && (
                <div className="text-xs text-amber-200">
                  V3 contracts not configured on this network.
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr),minmax(0,0.85fr)] gap-4 px-4 sm:px-6 py-4">
              <div className="flex flex-col gap-4 h-full">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    Add Position
                  </div>
                  <div className="relative" ref={v3AddMenuRef}>
                    <button
                      type="button"
                      onClick={() => setV3AddMenuOpen((v) => !v)}
                      className="h-7 w-7 rounded-full border border-slate-700 bg-slate-900/70 text-slate-200 hover:border-slate-500 inline-flex items-center justify-center"
                      aria-haspopup="menu"
                      aria-expanded={v3AddMenuOpen}
                      aria-label="Open add position details"
                    >
                      <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5 text-slate-300"
                      >
                        <circle cx="4" cy="10" r="1.5" fill="currentColor" />
                        <circle cx="10" cy="10" r="1.5" fill="currentColor" />
                        <circle cx="16" cy="10" r="1.5" fill="currentColor" />
                      </svg>
                    </button>
                    {v3AddMenuOpen && (
                      <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-slate-800 bg-slate-950/95 shadow-2xl shadow-black/40 p-2 z-20">
                        {[
                          {
                            id: "token0",
                            label: v3Token0,
                            address: v3Token0Meta?.address || "",
                          },
                          {
                            id: "token1",
                            label: v3Token1,
                            address: v3Token1Meta?.address || "",
                          },
                          {
                            id: "pool",
                            label: "Pool",
                            address: v3PoolInfo?.address || "",
                          },
                        ].map((item) => {
                          const hasAddress = Boolean(item.address);
                          return (
                            <div
                              key={`v3-add-${item.id}`}
                              className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 text-xs text-slate-200 hover:bg-slate-900/80"
                            >
                              <span className="font-semibold">{item.label}</span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => copyAddress(item.address)}
                                  disabled={!hasAddress}
                                  className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:border-sky-500/60 hover:text-sky-100 disabled:opacity-40"
                                  aria-label={`Copy ${item.label} address`}
                                >
                                  {v3CopiedAddress === item.address ? (
                                    <svg
                                      viewBox="0 0 20 20"
                                      fill="none"
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-3.5 w-3.5 text-emerald-300 mx-auto"
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
                                      className="h-3.5 w-3.5 mx-auto"
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
                                {hasAddress ? (
                                  <a
                                    href={`${EXPLORER_BASE_URL}/address/${item.address}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:border-sky-500/60 hover:text-sky-100 inline-flex items-center justify-center"
                                    aria-label={`Open ${item.label} on explorer`}
                                  >
                                    <svg
                                      viewBox="0 0 20 20"
                                      fill="none"
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-3.5 w-3.5"
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
                                ) : (
                                  <div className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-600 inline-flex items-center justify-center">
                                    <span className="text-[10px]">--</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-slate-400">Token A</span>
                    <div className="relative" ref={v3Token0DropdownRef}>
                      <button
                        type="button"
                        onClick={() => {
                          setV3Token0Open((v) => !v);
                          setV3Token1Open(false);
                          setV3Token0Search("");
                        }}
                        className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 flex items-center justify-between"
                        aria-haspopup="listbox"
                        aria-expanded={v3Token0Open}
                      >
                        <div className="flex items-center gap-2">
                          {v3Token0Meta?.logo ? (
                            <img
                              src={v3Token0Meta.logo}
                              alt={`${v3Token0} logo`}
                              className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 object-contain"
                            />
                          ) : (
                            <div className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 text-[9px] font-semibold text-slate-200 flex items-center justify-center">
                              {(v3Token0 || "?").slice(0, 3)}
                            </div>
                          )}
                          <span>{v3Token0}</span>
                        </div>
                        <svg
                          viewBox="0 0 20 20"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className={`h-4 w-4 text-slate-400 transition ${v3Token0Open ? "rotate-180" : ""}`}
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
                      {v3Token0Open && (
                        <div className="absolute z-20 mt-2 w-full max-h-64 overflow-y-auto rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl shadow-black/40">
                          <div className="sticky top-0 z-10 bg-slate-900/95 border-b border-slate-800 px-3 py-2">
                            <div className="flex items-center gap-2 bg-slate-950/70 border border-slate-800 rounded-full px-3 py-2 text-xs text-slate-300">
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
                                name="v3-token0-search"
                                value={v3Token0Search}
                                onChange={(e) => setV3Token0Search(e.target.value)}
                                placeholder="Search token..."
                                className="bg-transparent outline-none flex-1 text-slate-100 placeholder:text-slate-500 text-xs"
                              />
                            </div>
                          </div>
                          {v3TokenOptions
                            .filter((sym) => {
                              const meta = tokenRegistry[sym];
                              const q = v3Token0Search.trim().toLowerCase();
                              if (!q) return true;
                              const symbolMatch = sym.toLowerCase().includes(q);
                              const nameMatch = (meta?.name || "").toLowerCase().includes(q);
                              const addressMatch = (meta?.address || "").toLowerCase().includes(q);
                              return symbolMatch || nameMatch || addressMatch;
                            })
                            .map((sym) => {
                            const meta = tokenRegistry[sym];
                            const isSelected = sym === v3Token0;
                            return (
                              <button
                                key={`v3-a-${sym}`}
                                type="button"
                                onClick={() => {
                                  setV3Token0(sym);
                                  if (sym === v3Token1 && v3TokenOptions.length > 1) {
                                    const alt = v3TokenOptions.find((s) => s !== sym);
                                    if (alt) setV3Token1(alt);
                                  }
                                  setV3Token0Open(false);
                                }}
                                className={`w-full px-3 py-2 flex items-center gap-2 text-sm text-slate-100 hover:bg-slate-800/70 ${
                                  isSelected ? "bg-slate-800/80" : ""
                                }`}
                              >
                                {meta?.logo ? (
                                  <img
                                    src={meta.logo}
                                    alt={`${sym} logo`}
                                    className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 object-contain"
                                  />
                                ) : (
                                  <div className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 text-[9px] font-semibold text-slate-200 flex items-center justify-center">
                                    {(sym || "?").slice(0, 3)}
                                  </div>
                                )}
                                <span className="flex-1 text-left">{sym}</span>
                                {isSelected && (
                                  <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-4 w-4 text-emerald-300"
                                  >
                                    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-slate-400">Token B</span>
                    <div className="relative" ref={v3Token1DropdownRef}>
                      <button
                        type="button"
                        onClick={() => {
                          setV3Token1Open((v) => !v);
                          setV3Token0Open(false);
                          setV3Token1Search("");
                        }}
                        className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 flex items-center justify-between"
                        aria-haspopup="listbox"
                        aria-expanded={v3Token1Open}
                      >
                        <div className="flex items-center gap-2">
                          {v3Token1Meta?.logo ? (
                            <img
                              src={v3Token1Meta.logo}
                              alt={`${v3Token1} logo`}
                              className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 object-contain"
                            />
                          ) : (
                            <div className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 text-[9px] font-semibold text-slate-200 flex items-center justify-center">
                              {(v3Token1 || "?").slice(0, 3)}
                            </div>
                          )}
                          <span>{v3Token1}</span>
                        </div>
                        <svg
                          viewBox="0 0 20 20"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className={`h-4 w-4 text-slate-400 transition ${v3Token1Open ? "rotate-180" : ""}`}
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
                      {v3Token1Open && (
                        <div className="absolute z-20 mt-2 w-full max-h-64 overflow-y-auto rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl shadow-black/40">
                          <div className="sticky top-0 z-10 bg-slate-900/95 border-b border-slate-800 px-3 py-2">
                            <div className="flex items-center gap-2 bg-slate-950/70 border border-slate-800 rounded-full px-3 py-2 text-xs text-slate-300">
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
                                name="v3-token1-search"
                                value={v3Token1Search}
                                onChange={(e) => setV3Token1Search(e.target.value)}
                                placeholder="Search token..."
                                className="bg-transparent outline-none flex-1 text-slate-100 placeholder:text-slate-500 text-xs"
                              />
                            </div>
                          </div>
                          {v3TokenOptions
                            .filter((sym) => {
                              const meta = tokenRegistry[sym];
                              const q = v3Token1Search.trim().toLowerCase();
                              if (!q) return true;
                              const symbolMatch = sym.toLowerCase().includes(q);
                              const nameMatch = (meta?.name || "").toLowerCase().includes(q);
                              const addressMatch = (meta?.address || "").toLowerCase().includes(q);
                              return symbolMatch || nameMatch || addressMatch;
                            })
                            .map((sym) => {
                            const meta = tokenRegistry[sym];
                            const isSelected = sym === v3Token1;
                            return (
                              <button
                                key={`v3-b-${sym}`}
                                type="button"
                                onClick={() => {
                                  setV3Token1(sym);
                                  if (sym === v3Token0 && v3TokenOptions.length > 1) {
                                    const alt = v3TokenOptions.find((s) => s !== sym);
                                    if (alt) setV3Token0(alt);
                                  }
                                  setV3Token1Open(false);
                                }}
                                className={`w-full px-3 py-2 flex items-center gap-2 text-sm text-slate-100 hover:bg-slate-800/70 ${
                                  isSelected ? "bg-slate-800/80" : ""
                                }`}
                              >
                                {meta?.logo ? (
                                  <img
                                    src={meta.logo}
                                    alt={`${sym} logo`}
                                    className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 object-contain"
                                  />
                                ) : (
                                  <div className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 text-[9px] font-semibold text-slate-200 flex items-center justify-center">
                                    {(sym || "?").slice(0, 3)}
                                  </div>
                                )}
                                <span className="flex-1 text-left">{sym}</span>
                                {isSelected && (
                                  <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-4 w-4 text-emerald-300"
                                  >
                                    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-slate-400">Fee tier</span>
                    <select
                      name="v3-fee-tier"
                      value={v3FeeTier}
                      onChange={(e) => {
                        v3FeeTierLockedRef.current = true;
                        setV3FeeTier(Number(e.target.value));
                      }}
                      className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100"
                    >
                      {V3_FEE_OPTIONS.map((opt) => (
                        <option key={`fee-${opt.fee}`} value={opt.fee}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-slate-400">Set price range</span>
                    <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/70 p-1">
                      <button
                        type="button"
                        onClick={() => {
                          setV3RangeMode("full");
                          setV3RangeLower("");
                          setV3RangeUpper("");
                          setV3RangeInitialized(true);
                          setV3StrategyId("full");
                        }}
                        className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          v3RangeMode === "full"
                            ? "bg-slate-200 text-slate-900 shadow"
                            : "text-slate-300 hover:text-slate-100"
                        }`}
                      >
                        Full range
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setV3RangeMode("custom");
                          if (!v3HasCustomRange && v3ReferencePrice) {
                            applyV3RangePreset(0.1);
                          }
                        }}
                        className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          v3RangeMode === "custom"
                            ? "bg-slate-200 text-slate-900 shadow"
                            : "text-slate-300 hover:text-slate-100"
                        }`}
                      >
                        Custom range
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {v3RangeMode === "custom"
                        ? "Custom range allows you to concentrate your liquidity within specific price bounds, enhancing fee earnings but requiring active management."
                        : "Full range spreads liquidity across all prices for a hands-off position with lower capital efficiency."}
                    </div>
                  </div>
                </div>

                {v3PoolRequiresInit && (
                  <div className="mb-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-amber-200">
                      {v3PoolMissing ? "Pool creation required" : "Pool initialization required"}
                    </div>
                    <div className="mt-1 text-[11px] text-amber-200/80">
                      Set a starting price for the pool. If left empty, we will infer it
                      from your deposit amounts.
                    </div>
                    <div className="mt-3 flex flex-col gap-1">
                      <div className="flex items-center justify-between text-xs text-amber-200/80">
                        <span>Starting price</span>
                        <div className="flex items-center gap-2">
                          <span>{v3Token1} per {v3Token0}</span>
                          <button
                            type="button"
                            onClick={() => {
                              if (!v3SuggestedStartPrice) return;
                              setV3StartPrice(formatAutoAmount(v3SuggestedStartPrice));
                            }}
                            disabled={!v3SuggestedStartPrice}
                            className="px-2 py-0.5 rounded-full border border-amber-400/40 text-[10px] uppercase tracking-wide text-amber-200 hover:border-amber-300 hover:text-amber-100 disabled:opacity-50"
                          >
                            Use market price
                          </button>
                        </div>
                      </div>
                      <input
                        name="v3-start-price"
                        value={v3StartPrice}
                        onChange={(e) => setV3StartPrice(e.target.value)}
                        placeholder="0.0"
                        className="bg-slate-900 border border-amber-500/30 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-amber-200/40"
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>Min price</span>
                      <span>{v3Token1} per {v3Token0}</span>
                    </div>
                    <div className="relative">
                      <input
                        name="v3-range-lower"
                        value={v3RangeLower}
                        onChange={(e) => {
                          setV3RangeMode("custom");
                          setV3StrategyId("custom");
                          setV3RangeLower(e.target.value);
                        }}
                        disabled={v3RangeMode === "full"}
                        placeholder="0.0"
                        className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 pr-12 text-sm text-slate-100 disabled:opacity-60"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => adjustV3RangeValue("lower", 1)}
                          disabled={!v3ReferencePrice || v3RangeMode === "full"}
                          className="h-5 w-6 rounded-md border border-slate-700 bg-slate-950 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-50"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => adjustV3RangeValue("lower", -1)}
                          disabled={!v3ReferencePrice || v3RangeMode === "full"}
                          className="h-5 w-6 rounded-md border border-slate-700 bg-slate-950 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-50"
                        >
                          -
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>Max price</span>
                      <span>{v3Token1} per {v3Token0}</span>
                    </div>
                    <div className="relative">
                      <input
                        name="v3-range-upper"
                        value={v3RangeUpper}
                        onChange={(e) => {
                          setV3RangeMode("custom");
                          setV3StrategyId("custom");
                          setV3RangeUpper(e.target.value);
                        }}
                        disabled={v3RangeMode === "full"}
                        placeholder="0.0"
                        className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 pr-12 text-sm text-slate-100 disabled:opacity-60"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => adjustV3RangeValue("upper", 1)}
                          disabled={!v3ReferencePrice || v3RangeMode === "full"}
                          className="h-5 w-6 rounded-md border border-slate-700 bg-slate-950 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-50"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => adjustV3RangeValue("upper", -1)}
                          disabled={!v3ReferencePrice || v3RangeMode === "full"}
                          className="h-5 w-6 rounded-md border border-slate-700 bg-slate-950 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-50"
                        >
                          -
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-950/60 px-5 pt-5 pb-6 mb-6">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        Current price
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-100">
                        <span className="truncate">{v3PriceStatus}</span>
                        {v3ReferencePriceUsd !== null && (
                          <span className="text-sm text-slate-400">
                            ({formatUsdPrice(v3ReferencePriceUsd)})
                          </span>
                        )}
                      </div>
                      {!showV3PriceRangeChart && (
                        <div className="text-[11px] text-slate-500">
                          {v3PoolLoading
                            ? "Fetching live pool data"
                            : `Fee tier ${formatFeeTier(v3FeeTier)}`}
                        </div>
                      )}
                    </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center rounded-full border border-slate-700/60 bg-slate-900/80 p-1 text-[11px] text-slate-100 shadow-[0_8px_20px_rgba(0,0,0,0.45)]">
                          <div className="flex items-center gap-1 rounded-full bg-slate-800/90 px-2 py-1 text-[11px] font-semibold text-slate-100">
                            {v3Token1Meta?.logo ? (
                              <img
                              src={v3Token1Meta.logo}
                              alt={`${v3Token1} logo`}
                              className="h-4 w-4 rounded-full bg-slate-800 object-contain"
                            />
                          ) : (
                            <div className="h-4 w-4 rounded-full bg-slate-800 text-[8px] font-semibold text-slate-200 flex items-center justify-center">
                              {(v3Token1 || "?").slice(0, 2)}
                            </div>
                          )}
                          <span>{v3Token1}</span>
                        </div>
                        <div className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-slate-300">
                          {v3Token0Meta?.logo ? (
                            <img
                              src={v3Token0Meta.logo}
                              alt={`${v3Token0} logo`}
                              className="h-4 w-4 rounded-full bg-slate-800 object-contain"
                            />
                          ) : (
                            <div className="h-4 w-4 rounded-full bg-slate-800 text-[8px] font-semibold text-slate-200 flex items-center justify-center">
                              {(v3Token0 || "?").slice(0, 2)}
                            </div>
                          )}
                          <span>{v3Token0}</span>
                        </div>
                      </div>
                      {!v3HideChartControls && (
                        <div className="relative z-40" ref={v3ChartMenuRef}>
                          <button
                            type="button"
                            onClick={() => setV3ChartMenuOpen((v) => !v)}
                            className="flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-900/80 px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] text-slate-200 shadow-[0_10px_24px_rgba(0,0,0,0.45)]"
                          >
                            {v3ChartMode.replace("-", " ")}
                            <svg
                              viewBox="0 0 20 20"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                              className={`h-3.5 w-3.5 transition ${v3ChartMenuOpen ? "rotate-180" : ""}`}
                            >
                              <path
                                d="M6 8l4 4 4-4"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                          <div
                            className={`absolute top-full right-0 mt-2 w-32 max-h-28 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-1 text-[9px] text-slate-200 shadow-2xl shadow-black/60 transition-all duration-200 origin-top-right z-50 ${
                              v3ChartMenuOpen
                                ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
                                : "opacity-0 scale-95 -translate-y-1 pointer-events-none"
                            }`}
                          >
                            {[
                              { id: "price-range", label: "Price range" },
                              { id: "tvl", label: "TVL" },
                              { id: "price", label: "Price" },
                              { id: "volume", label: "Volume" },
                              { id: "fees", label: "Fees" },
                            ].map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  setV3ChartMode(opt.id);
                                  setV3ChartMenuOpen(false);
                                }}
                                className={`w-full rounded-md px-2 py-1 text-left uppercase tracking-[0.08em] ${
                                  v3ChartMode === opt.id
                                    ? "bg-sky-500/20 text-sky-100"
                                    : "hover:bg-slate-800/70"
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="relative">
                    <div
                      className={`relative h-64 rounded-3xl border border-slate-800 overflow-hidden ${
                        showV3MetricChart ? "bg-[#050b16]" : "bg-[#0f0707]"
                      }`}
                    >
                      {showV3PriceRangeChart ? (
                        <>
                          <div className="absolute inset-0 bg-[#1b1b1b]" />
                          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_0%,rgba(255,255,255,0.06),transparent_45%),radial-gradient(circle_at_85%_65%,rgba(255,255,255,0.04),transparent_55%)]" />
                          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_42%)]" />
                        </>
                      ) : showV3MetricChart ? (
                        <>
                          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.25),transparent_55%),radial-gradient(circle_at_80%_0%,rgba(16,185,129,0.18),transparent_50%)]" />
                          <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,rgba(15,23,42,0.9)_0px,rgba(15,23,42,0.9)_40px,rgba(56,189,248,0.12)_40px,rgba(56,189,248,0.12)_42px)] opacity-70" />
                          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/55" />
                        </>
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/40 via-slate-950/70 to-black/60" />
                      )}

                      {showV3PriceRangeChart ? (
                        v3Chart ? (
                          <>
                            <div
                              ref={v3RangeTrackRef}
                              className="absolute inset-5 overflow-visible cursor-pointer select-none touch-none"
                              onMouseMove={handleV3PriceRangeHover}
                              onMouseLeave={clearV3ChartHover}
                              onClick={(event) => {
                                if (!v3Chart) return;
                                const rect = event.currentTarget.getBoundingClientRect();
                                const pct = clampPercent(
                                  ((rect.bottom - event.clientY) / rect.height) * 100
                                );
                                if (!Number.isFinite(pct)) return;
                                const nextPrice =
                                  v3Chart.min + ((v3Chart.max - v3Chart.min) * pct) / 100;
                                if (!Number.isFinite(nextPrice) || nextPrice <= 0) return;
                                const distLower = Math.abs(pct - v3Chart.rangeStart);
                                const distUpper = Math.abs(pct - v3Chart.rangeEnd);
                                setV3RangeMode("custom");
                                setV3StrategyId("custom");
                                if (distLower <= distUpper) {
                                  const maxAllowed = v3RangeUpperNum
                                    ? v3RangeUpperNum * 0.999
                                    : nextPrice;
                                  setV3RangeLower(Math.min(nextPrice, maxAllowed).toFixed(6));
                                } else {
                                  const minAllowed = v3RangeLowerNum
                                    ? v3RangeLowerNum * 1.001
                                    : nextPrice;
                                  setV3RangeUpper(Math.max(nextPrice, minAllowed).toFixed(6));
                                }
                              }}
                            >
                              <div
                                className={`absolute left-0 right-5 rounded-md border border-sky-200/30 bg-[linear-gradient(180deg,rgba(14,165,233,0.35)_0%,rgba(30,64,175,0.65)_100%)] shadow-[0_0_24px_rgba(56,189,248,0.22)] ${v3RangeTransition} z-10`}
                                style={{
                                  top: `${100 - v3Chart.rangeEnd}%`,
                                  height: `${Math.max(6, v3Chart.rangeEnd - v3Chart.rangeStart)}%`,
                                }}
                              />
                              {renderV3HoverOverlay("price-range")}
                              {v3PriceRangeChartDisplay ? (
                                <svg
                                  viewBox="0 0 100 100"
                                  className="absolute inset-0 h-full w-full pointer-events-none z-20"
                                  preserveAspectRatio="none"
                                >
                                  <path
                                    d={v3PriceRangeChartDisplay.line}
                                    fill="none"
                                    stroke="rgba(226,232,240,0.65)"
                                    strokeWidth="0.7"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  {(() => {
                                    const points = v3PriceRangeChartDisplay.points || [];
                                    if (!points.length) return null;
                                    const start = Math.max(0, points.length - 8);
                                    const segment = points.slice(start);
                                    const highlight =
                                      segment.length >= 2
                                        ? segment
                                            .map((point, idx) =>
                                              `${idx === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
                                            )
                                            .join(" ")
                                        : null;
                                    const last = points[points.length - 1];
                                    return (
                                      <>
                                        {highlight ? (
                                          <path
                                            d={highlight}
                                            fill="none"
                                            stroke="#38bdf8"
                                            strokeWidth="1.4"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          />
                                        ) : null}
                                        {last ? (
                                          <circle
                                            cx={last.x}
                                            cy={last.y}
                                            r="2.4"
                                            fill="#38bdf8"
                                            stroke="#e0f2fe"
                                            strokeWidth="0.9"
                                          />
                                        ) : null}
                                      </>
                                    );
                                  })()}
                                </svg>
                              ) : null}
                              <div className="absolute right-1 top-3 bottom-3 w-3 rounded-full bg-slate-800/80 shadow-inner" />
                              <div
                                className="absolute right-1 w-3 rounded-full bg-[linear-gradient(180deg,#38bdf8_0%,#0ea5e9_55%,#1d4ed8_100%)] shadow-[0_0_18px_rgba(56,189,248,0.45)] z-30"
                                style={{
                                  top: `${100 - v3Chart.rangeEnd}%`,
                                  height: `${Math.max(6, v3Chart.rangeEnd - v3Chart.rangeStart)}%`,
                                }}
                              />
                              {v3Chart.currentPct !== null && (
                                <div
                                  className="absolute right-1 w-4 h-1.5 rounded-full bg-white/90 shadow-[0_0_8px_rgba(255,255,255,0.6)] z-40"
                                  style={{
                                    top: `${100 - v3Chart.currentPct}%`,
                                    transform: "translateY(-50%)",
                                  }}
                                />
                              )}
                              {v3Chart.currentPct !== null && (
                                <div
                                  className={`absolute left-0 right-5 h-px border-t border-dotted border-slate-200/50 ${v3RangeLineTransition} z-30`}
                                  style={{ top: `${100 - v3Chart.currentPct}%` }}
                                />
                              )}

                              <div
                                className={`absolute left-0 right-5 h-px bg-sky-200/70 ${v3RangeLineTransition} z-20`}
                                style={{ top: `${100 - v3Chart.rangeEnd}%` }}
                              />
                              <div
                                className={`absolute left-0 right-5 h-px bg-sky-200/70 ${v3RangeLineTransition} z-20`}
                                style={{ top: `${100 - v3Chart.rangeStart}%` }}
                              />

                              <button
                                type="button"
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                  event.preventDefault();
                                  setV3DraggingHandle("lower");
                                }}
                                className={`absolute right-1 h-4 w-4 -translate-y-1/2 rounded-full border border-white bg-white shadow-[0_0_10px_rgba(56,189,248,0.45)] touch-none cursor-ns-resize ${v3RangeLineTransition} z-40`}
                                style={{ top: `${100 - v3Chart.rangeStart}%` }}
                              >
                                <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500" />
                              </button>
                              <button
                                type="button"
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                  event.preventDefault();
                                  setV3DraggingHandle("upper");
                                }}
                                className={`absolute right-1 h-4 w-4 -translate-y-1/2 rounded-full border border-white bg-white shadow-[0_0_10px_rgba(56,189,248,0.45)] touch-none cursor-ns-resize ${v3RangeLineTransition} z-40`}
                                style={{ top: `${100 - v3Chart.rangeEnd}%` }}
                              >
                                <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500" />
                              </button>

                              {/* Prices moved to the card below */}
                            </div>
                            <div className="absolute left-5 right-5 bottom-7 h-px bg-slate-700/70 z-30" />
                            {v3PriceAxisTicks.length ? (
                              <div className="absolute left-5 right-5 bottom-3 text-[11px] leading-none text-slate-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] pointer-events-none z-30">
                                {v3PriceAxisTicks.map((tick) => {
                                  const align =
                                    tick.pct <= 3 ? "left" : tick.pct >= 97 ? "right" : "center";
                                  const translate =
                                    align === "center"
                                      ? "-translate-x-1/2"
                                      : align === "right"
                                      ? "-translate-x-full"
                                      : "translate-x-0";
                                  return (
                                    <span
                                      key={`${tick.label}-${tick.pct}`}
                                      className={`absolute ${translate} whitespace-nowrap`}
                                      style={{ left: `${tick.pct}%` }}
                                    >
                                      {tick.label}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">
                            No price data yet
                          </div>
                        )
                      ) : showV3MetricChart ? (
                        <div
                          className="absolute inset-5"
                          onMouseMove={handleV3MetricHover}
                          onMouseLeave={clearV3ChartHover}
                        >
                          {v3MetricChart ? (
                            <>
                              <svg
                                viewBox="0 0 100 100"
                                className="h-full w-full"
                                preserveAspectRatio="none"
                              >
                                <defs>
                                  <linearGradient id="v3-metric-area" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={v3MetricPalette.from} />
                                    <stop offset="100%" stopColor={v3MetricPalette.to} />
                                  </linearGradient>
                                </defs>
                                <path d={v3MetricChart.area} fill="url(#v3-metric-area)" />
                                <path
                                  d={v3MetricChart.line}
                                  fill="none"
                                  stroke={v3MetricPalette.stroke}
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                {v3MetricChart.points?.length ? (
                                  <circle
                                    cx={v3MetricChart.points[v3MetricChart.points.length - 1].x}
                                    cy={v3MetricChart.points[v3MetricChart.points.length - 1].y}
                                    r="2.2"
                                    fill={v3MetricPalette.stroke}
                                    stroke={v3MetricPalette.glow}
                                    strokeWidth="1.2"
                                  />
                                ) : null}
                              </svg>
                              <div className="absolute left-0 top-0">
                                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
                                  {v3MetricLabel}
                                </div>
                                <div className="text-sm font-semibold text-slate-100">
                                  {v3MetricValue}
                                </div>
                                {v3MetricSubLabel ? (
                                  <div className="text-[10px] text-slate-500">
                                    {v3MetricSubLabel}
                                  </div>
                                ) : null}
                              </div>
                              {v3MetricChange !== null && (
                                <div
                                  className={`absolute right-0 top-0 text-[10px] font-semibold ${
                                    v3MetricChange >= 0 ? "text-emerald-300" : "text-rose-300"
                                  }`}
                                >
                                  {v3MetricChange >= 0 ? "+" : ""}
                                  {v3MetricChange.toFixed(2)}%
                                </div>
                              )}
                              {renderV3HoverOverlay("metric")}
                            </>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">
                              {v3PoolTvlLoading
                                ? `Loading ${v3MetricLabel || "data"}...`
                                : v3PoolTvlError || `No ${v3MetricLabel || "data"} yet`}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-950/70 text-xs text-slate-300">
                          {v3ChartMode.replace("-", " ").toUpperCase()} view coming soon
                        </div>
                      )}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {[
                          { label: "1D", value: "1D" },
                          { label: "1W", value: "1W" },
                          { label: "1M", value: "1M" },
                          { label: "1Y", value: "1Y" },
                          { label: "All time", value: "All" },
                        ].map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => setV3RangeTimeframe(item.value)}
                            className={`rounded-full border px-3 py-1 text-[10px] font-semibold ${
                              v3RangeTimeframe === item.value
                                ? "border-sky-400/70 bg-sky-500/15 text-sky-100"
                                : "border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-600"
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => zoomV3Range(1)}
                          className="h-8 w-8 rounded-full border border-slate-700 bg-slate-950/70 text-slate-200 hover:border-slate-500"
                          aria-label="Zoom in"
                        >
                          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 mx-auto">
                            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <path d="M11 8v6M8 11h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={fitV3RangeView}
                          className="h-8 w-8 rounded-full border border-slate-700 bg-slate-950/70 text-slate-200 hover:border-slate-500"
                          aria-label="Fit view"
                        >
                          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 mx-auto">
                            <path
                              d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => zoomV3Range(-1)}
                          className="h-8 w-8 rounded-full border border-slate-700 bg-slate-950/70 text-slate-200 hover:border-slate-500"
                          aria-label="Zoom out"
                        >
                          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 mx-auto">
                            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <path d="M8 11h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setV3RangeMode("full");
                          setV3RangeLower("");
                          setV3RangeUpper("");
                          setV3RangeInitialized(true);
                          setV3StrategyId("full");
                        }}
                        className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-[10px] font-semibold text-slate-200 hover:border-slate-500"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4 mb-5">
                  <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-wide text-slate-500">
                    <span>Price strategies</span>
                    {v3PoolDataLoading ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 px-2 py-1 text-[10px] text-slate-300 normal-case">
                        <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
                        Loading pool data...
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {v3RangeStrategies.map((strategy) => {
                      const isActive = v3StrategyId === strategy.id;
                      return (
                        <button
                          key={strategy.id}
                          type="button"
                          disabled={!v3ReferencePrice}
                          onClick={() => {
                            if (!v3ReferencePrice) return;
                            strategy.apply();
                            setV3StrategyId(strategy.id);
                          }}
                          className={`rounded-2xl border px-4 py-3 text-left transition ${
                            isActive
                              ? "border-sky-400/60 bg-sky-500/10 text-sky-100"
                              : "border-slate-800 bg-slate-950/70 text-slate-200 hover:border-slate-600"
                          } disabled:opacity-50`}
                        >
                          <div className="text-sm font-semibold">{strategy.title}</div>
                          <div className="mt-1 text-xs text-slate-300">{strategy.range}</div>
                          <div className="mt-2 text-[11px] text-slate-500">
                            {strategy.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 mb-4">
                  <div className="relative rounded-2xl border border-slate-800 bg-[#0b0c1a] px-5 py-4">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Min</div>
                    <div className="mt-2 text-xl font-semibold text-slate-100">
                      {v3HasCustomRange ? formatPrice(v3RangeLowerNum) : "--"}
                    </div>
                    <div className="absolute right-3 top-10 flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => adjustV3RangeValue("lower", 1)}
                        disabled={!v3ReferencePrice || v3RangeMode === "full"}
                        className="h-6 w-6 rounded-md border border-slate-700 bg-slate-950 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-50"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustV3RangeValue("lower", -1)}
                        disabled={!v3ReferencePrice || v3RangeMode === "full"}
                        className="h-6 w-6 rounded-md border border-slate-700 bg-slate-950 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-50"
                      >
                        -
                      </button>
                    </div>
                  </div>
                  <div className="relative rounded-2xl border border-slate-800 bg-[#0b0c1a] px-5 py-4">
                    <div className="flex items-center justify-between pr-10">
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">Max</div>
                      <button
                        type="button"
                        onClick={() => {
                          setV3RangeMode("full");
                          setV3RangeLower("");
                          setV3RangeUpper("");
                          setV3RangeInitialized(true);
                        }}
                        className="px-2 py-0.5 rounded-full text-[10px] border border-slate-700/60 bg-slate-950/70 text-slate-300"
                      >
                        Full range
                      </button>
                    </div>
                    <div className="mt-2 text-xl font-semibold text-slate-100">
                      {v3HasCustomRange ? formatPrice(v3RangeUpperNum) : "--"}
                    </div>
                    <div className="absolute right-3 top-10 flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => adjustV3RangeValue("upper", 1)}
                        disabled={!v3ReferencePrice || v3RangeMode === "full"}
                        className="h-6 w-6 rounded-md border border-slate-700 bg-slate-950 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-50"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustV3RangeValue("upper", -1)}
                        disabled={!v3ReferencePrice || v3RangeMode === "full"}
                        className="h-6 w-6 rounded-md border border-slate-700 bg-slate-950 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-50"
                      >
                        -
                      </button>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-[#0b0c1a] px-5 py-4">
                    <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-500">
                      APR
                      <span className="text-[10px] text-slate-600">ⓘ</span>
                    </div>
                    <div className="mt-2 text-xl font-semibold text-slate-100">
                      {v3EstimatedApr !== null && Number.isFinite(v3EstimatedApr)
                        ? `${v3EstimatedApr.toFixed(2)}%`
                        : "--"}
                    </div>
                    <div
                      className={`text-[11px] ${
                        v3RangeSide !== "dual" ? "text-rose-400" : "text-slate-500"
                      }`}
                    >
                      {v3RangeSide !== "dual" ? "Out of range" : "Estimated"}
                    </div>
                  </div>
                </div>

                {/* Deposit inputs moved to the Add Liquidity panel */}
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 flex flex-col flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Position preview
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Click a position to open it here at full size.
                    </div>
                  </div>
                  {selectedPosition && (
                    <button
                      type="button"
                      onClick={() => setSelectedPositionId(null)}
                      className="px-2 py-1 rounded-full border border-slate-700 text-xs text-slate-300 hover:border-slate-500"
                    >
                      Close
                    </button>
                  )}
                </div>

                {!selectedPosition ? (
                  <div className="mt-5 flex-1 min-h-[260px] rounded-2xl border border-slate-800 bg-slate-950/60 px-6 py-8 text-center text-sm text-slate-400 flex items-center justify-center">
                    Select a position on the right to expand it here.
                  </div>
                ) : (
                  (() => {
                    const meta0 = findTokenMetaByAddress(selectedPosition.token0);
                    const meta1 = findTokenMetaByAddress(selectedPosition.token1);
                    const dec0 = meta0?.decimals ?? 18;
                    const dec1 = meta1?.decimals ?? 18;
                    const spacing = getTickSpacingFromFee(selectedPosition.fee) || 1;
                    const minTickForSpacing = Math.ceil(V3_MIN_TICK / spacing) * spacing;
                    const maxTickForSpacing = Math.floor(V3_MAX_TICK / spacing) * spacing;
                    const isFullRange =
                      selectedPosition.tickLower <= minTickForSpacing &&
                      selectedPosition.tickUpper >= maxTickForSpacing;
                    const lowerPrice = tickToPrice(
                      selectedPosition.tickLower,
                      dec0,
                      dec1
                    );
                    const upperPrice = tickToPrice(
                      selectedPosition.tickUpper,
                      dec0,
                      dec1
                    );
                    const rangeLabel = isFullRange
                      ? "Full range"
                      : `${formatPrice(lowerPrice)} - ${formatPrice(upperPrice)}`;
                    const positionTitle = formatPositionTitle(
                      selectedPosition,
                      isFullRange
                    );
                    const metaState = nftMetaById[selectedPosition.tokenId] || {};
                    const nftMeta = metaState.meta || {};
                    const nftImage = nftMeta?.image || "";
                    const hasImage = Boolean(nftImage);

                    return (
                      <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1.45fr,1fr] gap-5">
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                          {(() => {
                            const key = `${selectedPosition.token0?.toLowerCase?.() || ""}-${
                              selectedPosition.token1?.toLowerCase?.() || ""
                            }-${selectedPosition.fee}`;
                            const metrics = v3PoolMetrics[key];
                            const currentTick =
                              metrics?.tick !== undefined && metrics?.tick !== null
                                ? metrics.tick
                                : null;
                            const currentPrice = Number.isFinite(currentTick)
                              ? tickToPrice(currentTick, dec0, dec1)
                              : null;
                            const inRange =
                              currentTick !== null &&
                              currentTick >= selectedPosition.tickLower &&
                              currentTick <= selectedPosition.tickUpper;

                            const sqrtLowerX96 = tickToSqrtPriceX96(selectedPosition.tickLower);
                            const sqrtUpperX96 = tickToSqrtPriceX96(selectedPosition.tickUpper);
                            const sqrtCurrentX96 = metrics?.sqrtPriceX96 ?? null;
                            const liquidityAmounts =
                              sqrtCurrentX96 && sqrtLowerX96 && sqrtUpperX96
                                ? getAmountsForLiquidity(
                                    sqrtCurrentX96,
                                    sqrtLowerX96,
                                    sqrtUpperX96,
                                    selectedPosition.liquidity
                                  )
                                : null;
                            const amount0 = liquidityAmounts?.amount0 ?? null;
                            const amount1 = liquidityAmounts?.amount1 ?? null;
                            const amount0Display =
                              amount0 !== null ? formatAmount(amount0, dec0) : "--";
                            const amount1Display =
                              amount1 !== null ? formatAmount(amount1, dec1) : "--";

                            const rawPrice0 =
                              tokenPrices[(selectedPosition.token0 || "").toLowerCase?.() || ""];
                            const rawPrice1 =
                              tokenPrices[(selectedPosition.token1 || "").toLowerCase?.() || ""];
                            const isStableSymbol = (symbol) =>
                              symbol === "USDm" || symbol === "CUSD" || symbol === "USDT0";
                            const stable0 = isStableSymbol(meta0?.symbol || selectedPosition.token0Symbol);
                            const stable1 = isStableSymbol(meta1?.symbol || selectedPosition.token1Symbol);
                            let price0 =
                              rawPrice0 !== undefined && Number.isFinite(rawPrice0)
                                ? Number(rawPrice0)
                                : stable0
                                ? 1
                                : null;
                            let price1 =
                              rawPrice1 !== undefined && Number.isFinite(rawPrice1)
                                ? Number(rawPrice1)
                                : stable1
                                ? 1
                                : null;
                            const hasCurrentPrice =
                              currentPrice !== null &&
                              currentPrice !== undefined &&
                              Number.isFinite(currentPrice) &&
                              currentPrice > 0;
                            if (price0 === null && price1 !== null && hasCurrentPrice) {
                              price0 = price1 * Number(currentPrice);
                            }
                            if (price1 === null && price0 !== null && hasCurrentPrice) {
                              price1 = price0 / Number(currentPrice);
                            }
                            const amount0Num =
                              amount0 !== null ? Number(formatUnits(amount0, dec0)) : null;
                            const amount1Num =
                              amount1 !== null ? Number(formatUnits(amount1, dec1)) : null;
                            const value0 =
                              price0 !== null && amount0Num !== null && Number.isFinite(amount0Num)
                                ? amount0Num * price0
                                : null;
                            const value1 =
                              price1 !== null && amount1Num !== null && Number.isFinite(amount1Num)
                                ? amount1Num * price1
                                : null;
                            const liquidityUsd =
                              value0 !== null || value1 !== null
                                ? (value0 || 0) + (value1 || 0)
                                : null;
                            const share0 =
                              liquidityUsd && value0 !== null && value1 !== null
                                ? Math.round((value0 / liquidityUsd) * 100)
                                : liquidityUsd && value0 !== null && value1 === null
                                ? 100
                                : null;
                            const share1 =
                              liquidityUsd && value1 !== null && value0 !== null
                                ? Math.max(0, 100 - (share0 || 0))
                                : liquidityUsd && value1 !== null && value0 === null
                                ? 100
                                : null;

                            const fees0 = selectedPosition.tokensOwed0 ?? 0n;
                            const fees1 = selectedPosition.tokensOwed1 ?? 0n;
                            const fees0Display = formatAmount(fees0, dec0);
                            const fees1Display = formatAmount(fees1, dec1);
                            const fees0Num =
                              price0 !== null ? Number(formatUnits(fees0, dec0)) : null;
                            const fees1Num =
                              price1 !== null ? Number(formatUnits(fees1, dec1)) : null;
                            const feesValue0 =
                              price0 !== null && fees0Num !== null && Number.isFinite(fees0Num)
                                ? fees0Num * price0
                                : null;
                            const feesValue1 =
                              price1 !== null && fees1Num !== null && Number.isFinite(fees1Num)
                                ? fees1Num * price1
                                : null;
                            const feesUsd =
                              feesValue0 !== null || feesValue1 !== null
                                ? (feesValue0 || 0) + (feesValue1 || 0)
                                : fees0 === 0n && fees1 === 0n
                                ? 0
                                : null;

                            const minLabel = isFullRange ? "0" : formatPrice(lowerPrice);
                            const maxLabel = isFullRange ? "∞" : formatPrice(upperPrice);
                            const currentLabel =
                              currentPrice && Number.isFinite(currentPrice)
                                ? formatPrice(currentPrice)
                                : "--";
                            const menuItems = [
                              {
                                id: "token0",
                                label: selectedPosition.token0Symbol,
                                address: selectedPosition.token0,
                              },
                              {
                                id: "token1",
                                label: selectedPosition.token1Symbol,
                                address: selectedPosition.token1,
                              },
                              {
                                id: "pool",
                                label: "Pool",
                                address: metrics?.address || "",
                              },
                            ];
                            const handleCopy = copyAddress;

                            return (
                              <>
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                                      Position
                                    </div>
                                    <div className="mt-1 flex items-center gap-2">
                                      <div className="flex -space-x-2">
                                        {meta0?.logo ? (
                                          <img
                                            src={meta0.logo}
                                            alt={`${selectedPosition.token0Symbol} logo`}
                                            className="h-8 w-8 rounded-full border border-slate-800 bg-slate-900 object-contain"
                                          />
                                        ) : (
                                          <div className="h-8 w-8 rounded-full border border-slate-800 bg-slate-900 text-[10px] font-semibold text-slate-200 flex items-center justify-center">
                                            {(selectedPosition.token0Symbol || "?").slice(0, 3)}
                                          </div>
                                        )}
                                        {meta1?.logo ? (
                                          <img
                                            src={meta1.logo}
                                            alt={`${selectedPosition.token1Symbol} logo`}
                                            className="h-8 w-8 rounded-full border border-slate-800 bg-slate-900 object-contain"
                                          />
                                        ) : (
                                          <div className="h-8 w-8 rounded-full border border-slate-800 bg-slate-900 text-[10px] font-semibold text-slate-200 flex items-center justify-center">
                                            {(selectedPosition.token1Symbol || "?").slice(0, 3)}
                                          </div>
                                        )}
                                      </div>
                                      <div className="text-lg font-semibold text-slate-100 truncate">
                                        {selectedPosition.token0Symbol} / {selectedPosition.token1Symbol}
                                      </div>
                                    </div>
                                    <div className="text-[11px] text-slate-500">
                                      Position #{selectedPosition.tokenId} · Fee {formatFeeTier(selectedPosition.fee)}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded-full text-[10px] border border-slate-700 bg-slate-900/70 text-slate-200">
                                      {formatFeeTier(selectedPosition.fee)}
                                    </span>
                                    {metrics && (
                                      <span
                                        className={`px-2 py-0.5 rounded-full text-[10px] border ${
                                          inRange
                                            ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                                            : "border-rose-400/40 bg-rose-500/10 text-rose-200"
                                        }`}
                                      >
                                        {inRange ? "In range" : "Out of range"}
                                      </span>
                                    )}
                                  </div>
                                  <div className="relative" ref={v3PositionMenuRef}>
                                    <button
                                      type="button"
                                      onClick={() => setV3PositionMenuOpen((prev) => !prev)}
                                      className="h-8 w-8 rounded-full border border-slate-700 bg-slate-900/70 text-slate-200 hover:border-slate-500 inline-flex items-center justify-center"
                                      aria-haspopup="menu"
                                      aria-expanded={v3PositionMenuOpen}
                                      aria-label="Open position details"
                                    >
                                      <svg
                                        viewBox="0 0 20 20"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="h-4 w-4 text-slate-300"
                                      >
                                        <circle cx="4" cy="10" r="1.5" fill="currentColor" />
                                        <circle cx="10" cy="10" r="1.5" fill="currentColor" />
                                        <circle cx="16" cy="10" r="1.5" fill="currentColor" />
                                      </svg>
                                    </button>
                                    {v3PositionMenuOpen && (
                                      <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-slate-800 bg-slate-950/95 shadow-2xl shadow-black/40 p-2 z-20">
                                        {menuItems.map((item) => {
                                          const hasAddress = Boolean(item.address);
                                          return (
                                            <div
                                              key={item.id}
                                              className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 text-xs text-slate-200 hover:bg-slate-900/80"
                                            >
                                              <span className="font-semibold">{item.label}</span>
                                              <div className="flex items-center gap-2">
                                                <button
                                                  type="button"
                                                  onClick={() => handleCopy(item.address)}
                                                  disabled={!hasAddress}
                                                  className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:border-sky-500/60 hover:text-sky-100 disabled:opacity-40"
                                                  aria-label={`Copy ${item.label} address`}
                                                >
                                                  {v3CopiedAddress === item.address ? (
                                                    <svg
                                                      viewBox="0 0 20 20"
                                                      fill="none"
                                                      xmlns="http://www.w3.org/2000/svg"
                                                      className="h-3.5 w-3.5 text-emerald-300 mx-auto"
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
                                                      className="h-3.5 w-3.5 mx-auto"
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
                                                {hasAddress ? (
                                                  <a
                                                    href={`${EXPLORER_BASE_URL}/address/${item.address}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:border-sky-500/60 hover:text-sky-100 inline-flex items-center justify-center"
                                                    aria-label={`Open ${item.label} on explorer`}
                                                  >
                                                    <svg
                                                      viewBox="0 0 20 20"
                                                      fill="none"
                                                      xmlns="http://www.w3.org/2000/svg"
                                                      className="h-3.5 w-3.5"
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
                                                ) : (
                                                  <div className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-600 inline-flex items-center justify-center">
                                                    <span className="text-[10px]">--</span>
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => openV3ActionModal("increase", selectedPosition)}
                                    className="px-3 py-1 rounded-full border border-slate-700 bg-slate-900/70 text-xs text-slate-200 hover:border-sky-500/60"
                                  >
                                    Increase
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openV3ActionModal("remove", selectedPosition)}
                                    className="px-3 py-1 rounded-full border border-slate-700 bg-slate-900/70 text-xs text-slate-200 hover:border-rose-500/60"
                                  >
                                    Remove
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleV3Collect(selectedPosition)}
                                    className="px-3 py-1 rounded-full border border-slate-700 bg-slate-900/70 text-xs text-slate-200 hover:border-emerald-500/60"
                                  >
                                    Claim fees
                                  </button>
                                </div>

                                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                                      Liquidity
                                    </div>
                                    <div
                                      className="mt-2 text-3xl font-semibold text-slate-100 truncate"
                                      title={liquidityUsd !== null ? formatUsdValue(liquidityUsd) : "--"}
                                    >
                                      {liquidityUsd !== null ? formatUsdValue(liquidityUsd) : "--"}
                                    </div>
                                      <div className="mt-3 space-y-2 text-sm text-slate-200">
                                        <div className="flex items-start justify-between gap-1.5">
                                          <div className="flex items-center gap-2 min-w-0">
                                            {meta0?.logo ? (
                                              <img
                                                src={meta0.logo}
                                                alt={`${selectedPosition.token0Symbol} logo`}
                                                className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 object-contain"
                                              />
                                            ) : (
                                              <div className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 text-[9px] font-semibold text-slate-200 flex items-center justify-center">
                                                {(selectedPosition.token0Symbol || "?").slice(0, 2)}
                                              </div>
                                            )}
                                          </div>
                                          <div className="text-right min-w-0 max-w-[65%] flex flex-col items-end">
                                            <div className="flex items-baseline justify-end gap-1 w-full">
                                              <div
                                                className="text-base sm:text-lg font-semibold text-slate-100 truncate max-w-[70%]"
                                                title={amount0Display}
                                              >
                                                {amount0Display}
                                              </div>
                                              <div className="text-[11px] text-slate-500 whitespace-nowrap">
                                                {share0 !== null ? `${share0}%` : "--"}
                                              </div>
                                            </div>
                                        </div>
                                        </div>
                                        <div className="flex items-start justify-between gap-1.5">
                                          <div className="flex items-center gap-2 min-w-0">
                                            {meta1?.logo ? (
                                              <img
                                                src={meta1.logo}
                                                alt={`${selectedPosition.token1Symbol} logo`}
                                                className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 object-contain"
                                              />
                                            ) : (
                                              <div className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 text-[9px] font-semibold text-slate-200 flex items-center justify-center">
                                                {(selectedPosition.token1Symbol || "?").slice(0, 2)}
                                              </div>
                                            )}
                                          </div>
                                          <div className="text-right min-w-0 max-w-[65%] flex flex-col items-end">
                                            <div className="flex items-baseline justify-end gap-1 w-full">
                                              <div
                                                className="text-base sm:text-lg font-semibold text-slate-100 truncate max-w-[70%]"
                                                title={amount1Display}
                                              >
                                                {amount1Display}
                                              </div>
                                              <div className="text-[11px] text-slate-500 whitespace-nowrap">
                                                {share1 !== null ? `${share1}%` : "--"}
                                              </div>
                                            </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                                      Unclaimed fees
                                    </div>
                                    <div
                                      className="mt-2 text-3xl font-semibold text-slate-100 truncate"
                                      title={feesUsd !== null ? formatUsdValue(feesUsd) : "--"}
                                    >
                                      {feesUsd !== null ? formatUsdValue(feesUsd) : "--"}
                                    </div>
                                    <div className="mt-3 space-y-2 text-sm text-slate-200">
                                      <div className="flex items-center justify-between gap-1.5">
                                        <div className="flex items-center gap-2 min-w-0">
                                          {meta0?.logo ? (
                                            <img
                                              src={meta0.logo}
                                              alt={`${selectedPosition.token0Symbol} logo`}
                                              className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 object-contain"
                                            />
                                          ) : (
                                            <div className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 text-[9px] font-semibold text-slate-200 flex items-center justify-center">
                                              {(selectedPosition.token0Symbol || "?").slice(0, 2)}
                                            </div>
                                          )}
                                        </div>
                                        <div
                                          className="text-base sm:text-lg font-semibold text-slate-100 truncate min-w-0 max-w-[65%] text-right"
                                          title={fees0Display}
                                        >
                                          {fees0Display}
                                        </div>
                                      </div>
                                      <div className="flex items-center justify-between gap-1.5">
                                        <div className="flex items-center gap-2 min-w-0">
                                          {meta1?.logo ? (
                                            <img
                                              src={meta1.logo}
                                              alt={`${selectedPosition.token1Symbol} logo`}
                                              className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 object-contain"
                                            />
                                          ) : (
                                            <div className="h-6 w-6 rounded-full border border-slate-800 bg-slate-900 text-[9px] font-semibold text-slate-200 flex items-center justify-center">
                                              {(selectedPosition.token1Symbol || "?").slice(0, 2)}
                                            </div>
                                          )}
                                        </div>
                                        <div
                                          className="text-base sm:text-lg font-semibold text-slate-100 truncate min-w-0 max-w-[65%] text-right"
                                          title={fees1Display}
                                        >
                                          {fees1Display}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                                    <span>Price range</span>
                                    <span className={inRange ? "text-emerald-300" : "text-rose-300"}>
                                      {inRange ? "In range" : "Out of range"}
                                    </span>
                                  </div>
                                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                                      <div className="text-[10px] text-slate-500">Min price</div>
                                      <div
                                        className="text-base sm:text-lg font-semibold text-slate-100 leading-tight break-words"
                                        title={minLabel}
                                      >
                                        {minLabel}
                                      </div>
                                      <div className="text-[10px] text-slate-500">
                                        {selectedPosition.token1Symbol} per {selectedPosition.token0Symbol}
                                      </div>
                                    </div>
                                    <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                                      <div className="text-[10px] text-slate-500">Max price</div>
                                      <div
                                        className="text-base sm:text-lg font-semibold text-slate-100 leading-tight break-words"
                                        title={maxLabel}
                                      >
                                        {maxLabel}
                                      </div>
                                      <div className="text-[10px] text-slate-500">
                                        {selectedPosition.token1Symbol} per {selectedPosition.token0Symbol}
                                      </div>
                                    </div>
                                    <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                                      <div className="text-[10px] text-slate-500">Current price</div>
                                      <div
                                        className="text-base sm:text-lg font-semibold text-slate-100 leading-tight break-words"
                                        title={currentLabel}
                                      >
                                        {currentLabel}
                                      </div>
                                      <div className="text-[10px] text-slate-500">
                                        {selectedPosition.token1Symbol} per {selectedPosition.token0Symbol}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {metaState.loading && (
                                  <div className="mt-4 text-[11px] text-slate-500">Loading tokenURI...</div>
                                )}
                                {metaState.error && (
                                  <div className="mt-3 text-[11px] text-amber-200">
                                    {metaState.error}
                                  </div>
                                )}
                                {showNftDebug && (
                                  <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-[11px] text-slate-300">
                                    <div className="text-[10px] uppercase tracking-wide text-slate-500">
                                      tokenURI
                                    </div>
                                    <div className="mt-1 font-mono break-all text-slate-200">
                                      {metaState.raw || "--"}
                                    </div>
                                    <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">
                                      metadata URL
                                    </div>
                                    <div className="mt-1 font-mono break-all text-slate-200">
                                      {metaState.metaUrl || "--"}
                                    </div>
                                    <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">
                                      image
                                    </div>
                                    <div className="mt-1 font-mono break-all text-slate-200">
                                      {metaState.image || "--"}
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>

                        <div className="flex flex-col items-center justify-center gap-4">
                          <div
                            className={`relative w-full max-w-none aspect-[3/4] rounded-2xl overflow-hidden ${
                              hasImage ? "border border-transparent bg-transparent" : "border border-slate-800 bg-slate-950/70"
                            }`}
                          >
                            {metaState.loading && (
                              <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">
                                Loading NFT...
                              </div>
                            )}
                            {hasImage ? (
                              <div className="absolute inset-0">
                                <img
                                  src={nftImage}
                                  alt={nftMeta?.name || positionTitle}
                                  className="h-full w-full object-contain"
                                />
                              </div>
                            ) : (
                              <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900">
                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.25),transparent_60%)]" />
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
                                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                    CurrentX Positions NFT
                                  </div>
                                  <div className="text-lg font-semibold text-slate-100">
                                    {selectedPosition.token0Symbol}/{selectedPosition.token1Symbol}
                                  </div>
                                  <div className="text-sm text-slate-400">
                                    {formatFeeTier(selectedPosition.fee)}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="text-center">
                            <div className="text-[11px] text-slate-400">
                              Position #{selectedPosition.tokenId}
                            </div>
                            <div className="text-sm font-semibold text-slate-100">
                              {selectedPosition.token0Symbol}/{selectedPosition.token1Symbol}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {isFullRange ? "MIN<>MAX" : rangeLabel}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            </div>

              <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-950 to-sky-900/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">
                        Add liquidity
                      </div>
                      <div className="text-xs text-slate-400">
                        Deposit amounts to mint a new V3 position.
                      </div>
                    </div>
                    <div className="relative" ref={slippageMenuRef}>
                      <button
                        type="button"
                        onClick={() => setSlippageMenuOpen((open) => !open)}
                        className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-200 hover:border-slate-500"
                      >
                        <span>
                          {slippageMode === "auto" ? "AUTO" : `${slippageDisplay}%`}
                        </span>
                        <svg
                          viewBox="0 0 20 20"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-3.5 w-3.5"
                        >
                          <path
                            d="M10 7.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6ZM3.2 10l1.6-.9a4.9 4.9 0 0 1 .4-1l-1-1.5 1.7-1.7 1.5 1a4.9 4.9 0 0 1 1-.4l.9-1.6h2.4l.9 1.6c.35.08.68.2 1 .34l1.5-1 1.7 1.7-1 1.5c.14.32.26.65.34 1l1.6.9v2.4l-1.6.9a4.9 4.9 0 0 1-.34 1l1 1.5-1.7 1.7-1.5-1c-.32.14-.65.26-1 .34l-.9 1.6H9.1l-.9-1.6a4.9 4.9 0 0 1-1-.34l-1.5 1-1.7-1.7 1-1.5a4.9 4.9 0 0 1-.34-1L3.2 12.4V10Z"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <div
                        className={`absolute right-0 mt-2 w-56 rounded-xl border border-slate-800 bg-[#140b0b] p-3 text-xs text-rose-100/80 shadow-2xl shadow-black/60 transition-all duration-200 origin-top-right ${
                          slippageMenuOpen
                            ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
                            : "opacity-0 scale-95 -translate-y-1 pointer-events-none"
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-400">
                          <span>Slippage</span>
                          <span className="text-[10px] text-slate-600">i</span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {slippagePresets.map((preset) => {
                            const isAuto = preset.mode === "auto";
                            const isActive = isAuto
                              ? slippageMode === "auto"
                              : slippageMode !== "auto" && slippageDisplay === preset.value;
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() => {
                                  setSlippageInput(preset.value);
                                  setSlippageMode(preset.mode);
                                  setSlippageMenuOpen(false);
                                }}
                                className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wide ${
                                  isActive
                                    ? "border-rose-400/70 bg-rose-500/20 text-rose-100"
                                    : "border-slate-800 bg-slate-950/70 text-slate-200 hover:border-slate-500"
                                }`}
                              >
                                {preset.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {v3RangeMath && (
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-400">
                        {v3RangeMath.sqrtCurrentX96 <= v3RangeMath.sqrtLowerX96
                          ? "Price below range → single-sided deposit (token0)."
                          : v3RangeMath.sqrtCurrentX96 >= v3RangeMath.sqrtUpperX96
                          ? "Price above range → single-sided deposit (token1)."
                          : "Price in range → dual-sided deposit."}
                      </div>
                    )}
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Deposit</span>
                      </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <input
                            name="v3-deposit-0"
                            value={v3Amount0}
                            onChange={(e) => {
                            applyV3MintAmount0(e.target.value);
                          }}
                          placeholder="0.0"
                          disabled={v3RangeSide === "token1"}
                          className="w-full bg-transparent text-2xl font-semibold text-slate-100 outline-none placeholder:text-slate-600 disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                          <div className="flex h-8 items-center justify-center gap-2 rounded-full border border-slate-800 bg-slate-900/80 px-3 text-xs text-slate-100">
                            {v3MintDisplayMeta0?.logo ? (
                              <img
                                src={v3MintDisplayMeta0.logo}
                                alt={`${v3MintDisplaySymbol0} logo`}
                                className="h-5 w-5 rounded-full border border-slate-800 bg-slate-900 object-contain block"
                              />
                            ) : (
                              <div className="h-5 w-5 rounded-full border border-slate-800 bg-slate-900 text-[9px] font-semibold text-slate-200 flex items-center justify-center">
                                {(v3MintDisplaySymbol0 || "?").slice(0, 3)}
                              </div>
                            )}
                            <span className="leading-none">{v3MintDisplaySymbol0}</span>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span>
                            Balance{" "}
                            {walletBalancesLoading
                              ? "Loading..."
                              : v3MintBalance0Num !== null
                              ? `${formatTokenBalance(v3MintBalance0Num)} ${v3MintDisplaySymbol0}`
                              : "--"}
                          </span>
                          <div className="flex items-center gap-1">
                            {v3MintQuickButtons.map((btn) => (
                              <button
                                key={`mint-0-${btn.label}`}
                                type="button"
                                onClick={() => applyV3MintQuickFill(0, btn.pct)}
                                disabled={
                                  walletBalancesLoading || !v3MintHasBalance0 || !v3MintCanUseSide0
                                }
                                className="rounded-full border border-slate-800 bg-slate-900/70 px-2 py-0.5 text-[10px] font-semibold text-slate-200 hover:border-sky-400/60 disabled:opacity-50"
                              >
                                {btn.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {v3Token0SupportsEthToggle && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span>Pay with</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setV3MintUseEth0(false)}
                                disabled={!v3MintCanUseSide0}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                  !v3MintCanUseSide0
                                    ? "border-slate-800 bg-slate-900/70 text-slate-500"
                                    : !v3MintUseEth0
                                    ? "border-sky-400/70 bg-sky-500/20 text-sky-100"
                                    : "border-slate-800 bg-slate-950/70 text-slate-200 hover:border-slate-500"
                                }`}
                              >
                                WETH
                              </button>
                              <button
                                type="button"
                                onClick={() => setV3MintUseEth0(true)}
                                disabled={!v3MintCanUseSide0}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                  !v3MintCanUseSide0
                                    ? "border-slate-800 bg-slate-900/70 text-slate-500"
                                    : v3MintUseEth0
                                    ? "border-sky-400/70 bg-sky-500/20 text-sky-100"
                                    : "border-slate-800 bg-slate-950/70 text-slate-200 hover:border-slate-500"
                                }`}
                              >
                                ETH
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Deposit</span>
                      </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <input
                            name="v3-deposit-1"
                            value={v3Amount1}
                            onChange={(e) => {
                            applyV3MintAmount1(e.target.value);
                          }}
                          placeholder="0.0"
                          disabled={v3RangeSide === "token0"}
                          className="w-full bg-transparent text-2xl font-semibold text-slate-100 outline-none placeholder:text-slate-600 disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                          <div className="flex h-8 items-center justify-center gap-2 rounded-full border border-slate-800 bg-slate-900/80 px-3 text-xs text-slate-100">
                            {v3MintDisplayMeta1?.logo ? (
                              <img
                                src={v3MintDisplayMeta1.logo}
                                alt={`${v3MintDisplaySymbol1} logo`}
                                className="h-5 w-5 rounded-full border border-slate-800 bg-slate-900 object-contain block"
                              />
                            ) : (
                              <div className="h-5 w-5 rounded-full border border-slate-800 bg-slate-900 text-[9px] font-semibold text-slate-200 flex items-center justify-center">
                                {(v3MintDisplaySymbol1 || "?").slice(0, 3)}
                              </div>
                            )}
                            <span className="leading-none">{v3MintDisplaySymbol1}</span>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span>
                            Balance{" "}
                            {walletBalancesLoading
                              ? "Loading..."
                              : v3MintBalance1Num !== null
                              ? `${formatTokenBalance(v3MintBalance1Num)} ${v3MintDisplaySymbol1}`
                              : "--"}
                          </span>
                          <div className="flex items-center gap-1">
                            {v3MintQuickButtons.map((btn) => (
                              <button
                                key={`mint-1-${btn.label}`}
                                type="button"
                                onClick={() => applyV3MintQuickFill(1, btn.pct)}
                                disabled={
                                  walletBalancesLoading || !v3MintHasBalance1 || !v3MintCanUseSide1
                                }
                                className="rounded-full border border-slate-800 bg-slate-900/70 px-2 py-0.5 text-[10px] font-semibold text-slate-200 hover:border-sky-400/60 disabled:opacity-50"
                              >
                                {btn.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {v3Token1SupportsEthToggle && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span>Pay with</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setV3MintUseEth1(false)}
                                disabled={!v3MintCanUseSide1}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                  !v3MintCanUseSide1
                                    ? "border-slate-800 bg-slate-900/70 text-slate-500"
                                    : !v3MintUseEth1
                                    ? "border-sky-400/70 bg-sky-500/20 text-sky-100"
                                    : "border-slate-800 bg-slate-950/70 text-slate-200 hover:border-slate-500"
                                }`}
                              >
                                WETH
                              </button>
                              <button
                                type="button"
                                onClick={() => setV3MintUseEth1(true)}
                                disabled={!v3MintCanUseSide1}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                  !v3MintCanUseSide1
                                    ? "border-slate-800 bg-slate-900/70 text-slate-500"
                                    : v3MintUseEth1
                                    ? "border-sky-400/70 bg-sky-500/20 text-sky-100"
                                    : "border-slate-800 bg-slate-950/70 text-slate-200 hover:border-slate-500"
                                }`}
                              >
                                ETH
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleV3Mint}
                    disabled={v3MintLoading || !hasV3Liquidity}
                    className="mt-4 w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 disabled:opacity-60"
                  >
                    {v3MintLoading
                      ? "Creating position..."
                      : address
                      ? "Create position"
                      : "Connect Wallet"}
                  </button>

                  <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Total deposit</span>
                      <span className="text-sm font-semibold text-slate-100">
                        {v3TotalDeposit?.value !== null && v3TotalDeposit?.value !== undefined
                          ? `${formatPrice(v3TotalDeposit.value)} ${v3TotalDeposit.unit || v3Token1}`
                          : "--"}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Deposit ratio</span>
                      <div className="flex items-center gap-3 text-sm font-semibold text-slate-100">
                        <div className="flex items-center gap-1">
                          {v3Token0Meta?.logo ? (
                            <img
                              src={v3Token0Meta.logo}
                              alt={`${v3Token0} logo`}
                              className="h-4 w-4 rounded-full border border-slate-800 bg-slate-900 object-contain"
                            />
                          ) : (
                            <div className="h-4 w-4 rounded-full border border-slate-800 bg-slate-900 text-[7px] font-semibold text-slate-200 flex items-center justify-center">
                              {(v3Token0 || "?").slice(0, 2)}
                            </div>
                          )}
                          <span>{v3Ratio0Pct}%</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {v3Token1Meta?.logo ? (
                            <img
                              src={v3Token1Meta.logo}
                              alt={`${v3Token1} logo`}
                              className="h-4 w-4 rounded-full border border-slate-800 bg-slate-900 object-contain"
                            />
                          ) : (
                            <div className="h-4 w-4 rounded-full border border-slate-800 bg-slate-900 text-[7px] font-semibold text-slate-200 flex items-center justify-center">
                              {(v3Token1 || "?").slice(0, 2)}
                            </div>
                          )}
                          <span>{v3Ratio1Pct}%</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Fees</span>
                      <span className="text-sm font-semibold text-slate-100">
                        {formatFeeTier(v3FeeTier)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Slippage</span>
                      <span className="text-sm font-semibold text-slate-100">
                        {slippageDisplay}%
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Pool balances</span>
                      <span className="text-[10px] text-slate-600">i</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm font-semibold text-slate-100">
                      <span>
                        {v3PoolBalance0Num !== null
                          ? `${formatPrice(v3PoolBalance0Num)} ${v3Token0}`
                          : `-- ${v3Token0}`}
                      </span>
                      <span>
                        {v3PoolBalance1Num !== null
                          ? `${formatPrice(v3PoolBalance1Num)} ${v3Token1}`
                          : `-- ${v3Token1}`}
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-900/60 overflow-hidden flex">
                      <div
                        className="h-full bg-gradient-to-r from-violet-500/80 to-sky-500/80"
                        style={{ width: `${v3PoolBalanceRatio0}%` }}
                      />
                      <div
                        className="h-full bg-emerald-400/80"
                        style={{ width: `${v3PoolBalanceRatio1}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                      <span>{v3PoolBalance0Usd !== null ? formatUsdPrice(v3PoolBalance0Usd) : "--"}</span>
                      <span>{v3PoolBalance1Usd !== null ? formatUsdPrice(v3PoolBalance1Usd) : "--"}</span>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Pool stats
                    </div>
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">
                          Net APR
                        </div>
                        <div className="text-xl font-semibold text-emerald-400">
                          {v3PoolDataLoading
                            ? "Loading..."
                            : v3EstimatedApr !== null && Number.isFinite(v3EstimatedApr)
                            ? `${v3EstimatedApr.toFixed(2)}%`
                            : "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">
                          TVL
                        </div>
                        <div className="text-lg font-semibold text-slate-100">
                          {v3TvlChart?.latest !== null ? formatNumber(v3TvlChart.latest) : "--"}
                        </div>
                        <div
                          className={`text-[11px] ${
                            v3TvlChart?.changePct !== null
                              ? v3TvlChart.changePct >= 0
                                ? "text-emerald-400"
                                : "text-rose-400"
                              : "text-slate-500"
                          }`}
                        >
                          {v3TvlChart?.changePct !== null
                            ? `${v3TvlChart.changePct >= 0 ? "+" : ""}${v3TvlChart.changePct.toFixed(2)}%`
                            : "--"}
                        </div>
                      </div>
                    </div>
                  </div>

                  {v3MintError && (
                    <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                      {v3MintError}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Your Positions
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setV3ShowClosedPositions((prev) => !prev)}
                        className={`px-2 py-1 rounded-full border text-xs transition ${
                          v3ShowClosedPositions
                            ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
                            : "border-slate-700 text-slate-300 hover:border-slate-500"
                        }`}
                      >
                        {v3ShowClosedPositions ? "Hide closed" : "Show closed"}
                        {closedPositionsCount ? ` (${closedPositionsCount})` : ""}
                      </button>
                      <button
                        type="button"
                        onClick={() => setV3RefreshTick((t) => t + 1)}
                        className="px-2 py-1 rounded-full border border-slate-700 text-xs text-slate-300 hover:border-slate-500"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                  {v3PositionsLoading ? (
                    <div className="text-sm text-slate-400">Loading positions...</div>
                  ) : v3PositionsError ? (
                    <div className="text-sm text-amber-200">{v3PositionsError}</div>
                  ) : visibleV3Positions.length ? (
                    <div className="flex flex-col gap-3">
                      <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                      {visibleV3Positions.map((pos) => {
                      const key = `${pos.token0?.toLowerCase?.() || ""}-${pos.token1?.toLowerCase?.() || ""}-${pos.fee}`;
                      const metrics = v3PoolMetrics[key];
                      const meta0 = findTokenMetaByAddress(pos.token0);
                      const meta1 = findTokenMetaByAddress(pos.token1);
                      const dec0 = meta0?.decimals ?? 18;
                      const dec1 = meta1?.decimals ?? 18;
                      const lowerPrice = tickToPrice(pos.tickLower, dec0, dec1);
                      const upperPrice = tickToPrice(pos.tickUpper, dec0, dec1);
                      const currentPrice = metrics?.tick !== undefined && metrics?.tick !== null
                        ? tickToPrice(metrics.tick, dec0, dec1)
                        : null;
                      const spacing = metrics?.spacing || getTickSpacingFromFee(pos.fee) || 1;
                      const minTickForSpacing = Math.ceil(V3_MIN_TICK / spacing) * spacing;
                      const maxTickForSpacing = Math.floor(V3_MAX_TICK / spacing) * spacing;
                      const isFullRange =
                        pos.tickLower <= minTickForSpacing && pos.tickUpper >= maxTickForSpacing;
                      const hasRange =
                        !isFullRange &&
                        Number.isFinite(lowerPrice) &&
                        Number.isFinite(upperPrice) &&
                        lowerPrice > 0 &&
                        upperPrice > 0 &&
                        lowerPrice < upperPrice;
                      let rangeStart = 0;
                      let rangeEnd = 100;
                      let currentPct = null;
                      if (hasRange) {
                        const span = upperPrice - lowerPrice;
                        const pad = span * 0.35;
                        const padMin = Math.max(lowerPrice - pad, 0);
                        const padMax = upperPrice + pad;
                        const denom = padMax - padMin;
                        if (denom > 0) {
                          rangeStart = clampPercent(((lowerPrice - padMin) / denom) * 100);
                          rangeEnd = clampPercent(((upperPrice - padMin) / denom) * 100);
                          if (Number.isFinite(currentPrice)) {
                            currentPct = clampPercent(((currentPrice - padMin) / denom) * 100);
                          }
                        }
                      }
                      const rangeSummary = isFullRange
                        ? "Full range"
                        : hasRange
                        ? `${formatPrice(lowerPrice)} - ${formatPrice(upperPrice)}`
                        : "--";
                      const lowerLabel = isFullRange
                        ? "0"
                        : hasRange
                        ? formatPrice(lowerPrice)
                        : "--";
                      const upperLabel = isFullRange
                        ? "Unlimited"
                        : hasRange
                        ? formatPrice(upperPrice)
                        : "--";
                      const inRange =
                        metrics?.tick !== undefined &&
                        metrics?.tick !== null &&
                        metrics.tick >= pos.tickLower &&
                        metrics.tick <= pos.tickUpper;
                      const isSelected =
                        selectedPositionId &&
                        String(selectedPositionId) === String(pos.tokenId);
                      const listMenuOpen = v3PositionListMenuOpenId === pos.tokenId;
                      const listMenuItems = [
                        {
                          id: "token0",
                          label: pos.token0Symbol,
                          address: pos.token0,
                        },
                        {
                          id: "token1",
                          label: pos.token1Symbol,
                          address: pos.token1,
                        },
                        {
                          id: "pool",
                          label: "Pool",
                          address: metrics?.address || "",
                        },
                      ];
                      return (
                        <div
                          key={`cl-${pos.tokenId}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setV3PositionListMenuOpenId(null);
                            setSelectedPositionId(pos.tokenId);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setV3PositionListMenuOpenId(null);
                              setSelectedPositionId(pos.tokenId);
                            }
                          }}
                          className={`relative overflow-hidden rounded-2xl border px-4 py-3 shadow-[0_12px_40px_-28px_rgba(56,189,248,0.6)] transition ${
                            isSelected
                              ? "border-sky-500/60 bg-gradient-to-br from-slate-950 via-slate-900/90 to-slate-900/70 ring-1 ring-sky-500/40"
                              : "border-slate-800 bg-gradient-to-br from-slate-950 via-slate-950/70 to-slate-900/60 hover:border-slate-700"
                          }`}
                        >
                          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.16),transparent_55%)]" />
                          <div className="relative flex flex-wrap items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="flex -space-x-2">
                                {meta0?.logo ? (
                                  <img
                                    src={meta0.logo}
                                    alt={`${pos.token0Symbol} logo`}
                                    className="h-9 w-9 rounded-full border border-slate-800 bg-slate-900 object-contain"
                                  />
                                ) : (
                                  <div className="h-9 w-9 rounded-full border border-slate-800 bg-slate-900 text-[11px] font-semibold text-slate-200 flex items-center justify-center">
                                    {(pos.token0Symbol || "?").slice(0, 3)}
                                  </div>
                                )}
                                {meta1?.logo ? (
                                  <img
                                    src={meta1.logo}
                                    alt={`${pos.token1Symbol} logo`}
                                    className="h-9 w-9 rounded-full border border-slate-800 bg-slate-900 object-contain"
                                  />
                                ) : (
                                  <div className="h-9 w-9 rounded-full border border-slate-800 bg-slate-900 text-[11px] font-semibold text-slate-200 flex items-center justify-center">
                                    {(pos.token1Symbol || "?").slice(0, 3)}
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="text-sm font-semibold text-slate-100">
                                  {pos.token0Symbol} / {pos.token1Symbol}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  Position #{pos.tokenId}
                                </div>
                              </div>
                              <div
                                className="relative v3-position-list-menu"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setV3PositionListMenuOpenId(
                                      listMenuOpen ? null : pos.tokenId
                                    )
                                  }
                                  className="h-7 w-7 rounded-full border border-slate-700 bg-slate-900/70 text-slate-200 hover:border-slate-500 inline-flex items-center justify-center"
                                  aria-haspopup="menu"
                                  aria-expanded={listMenuOpen}
                                  aria-label="Open position details"
                                >
                                  <svg
                                    viewBox="0 0 20 20"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-3.5 w-3.5 text-slate-300"
                                  >
                                    <circle cx="4" cy="10" r="1.5" fill="currentColor" />
                                    <circle cx="10" cy="10" r="1.5" fill="currentColor" />
                                    <circle cx="16" cy="10" r="1.5" fill="currentColor" />
                                  </svg>
                                </button>
                                {listMenuOpen && (
                                  <div className="absolute left-0 mt-2 w-56 rounded-2xl border border-slate-800 bg-slate-950/95 shadow-2xl shadow-black/40 p-2 z-20">
                                    {listMenuItems.map((item) => {
                                      const hasAddress = Boolean(item.address);
                                      return (
                                        <div
                                          key={`${pos.tokenId}-${item.id}`}
                                          className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 text-xs text-slate-200 hover:bg-slate-900/80"
                                        >
                                          <span className="font-semibold">{item.label}</span>
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={() => copyAddress(item.address)}
                                              disabled={!hasAddress}
                                              className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:border-sky-500/60 hover:text-sky-100 disabled:opacity-40"
                                              aria-label={`Copy ${item.label} address`}
                                            >
                                              {v3CopiedAddress === item.address ? (
                                                <svg
                                                  viewBox="0 0 20 20"
                                                  fill="none"
                                                  xmlns="http://www.w3.org/2000/svg"
                                                  className="h-3.5 w-3.5 text-emerald-300 mx-auto"
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
                                                  className="h-3.5 w-3.5 mx-auto"
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
                                            {hasAddress ? (
                                              <a
                                                href={`${EXPLORER_BASE_URL}/address/${item.address}`}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:border-sky-500/60 hover:text-sky-100 inline-flex items-center justify-center"
                                                aria-label={`Open ${item.label} on explorer`}
                                              >
                                                <svg
                                                  viewBox="0 0 20 20"
                                                  fill="none"
                                                  xmlns="http://www.w3.org/2000/svg"
                                                  className="h-3.5 w-3.5"
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
                                            ) : (
                                              <div className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-600 inline-flex items-center justify-center">
                                                <span className="text-[10px]">--</span>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 rounded-full text-[10px] border border-slate-700 bg-slate-900/70 text-slate-200">
                                Fee {formatFeeTier(pos.fee)}
                              </span>
                              {metrics && (
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] border ${
                                    inRange
                                      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                                      : "border-rose-400/40 bg-rose-500/10 text-rose-200"
                                  }`}
                                >
                                  {inRange ? "In range" : "Out of range"}
                                </span>
                              )}
                              <span className="px-2 py-0.5 rounded-full text-[10px] border border-emerald-400/40 bg-emerald-500/10 text-emerald-200">
                                V3
                              </span>
                              <div className="flex items-center gap-2 ml-1">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openV3ActionModal("increase", pos);
                                  }}
                                  className="px-2 py-0.5 rounded-full text-[10px] border border-slate-700 bg-slate-900/70 text-slate-200 hover:border-sky-500/60"
                                >
                                  Increase
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openV3ActionModal("remove", pos);
                                  }}
                                  className="px-2 py-0.5 rounded-full text-[10px] border border-slate-700 bg-slate-900/70 text-slate-200 hover:border-rose-500/60"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="relative mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                              <div className="flex items-center justify-between text-[11px] text-slate-500">
                                <span>Range</span>
                                <span>
                                  {pos.token1Symbol} per {pos.token0Symbol}
                                </span>
                              </div>
                              <div className="mt-2 text-base font-semibold text-slate-100">
                                {rangeSummary}
                              </div>
                              <div className="relative mt-3 h-12 rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
                                <div className="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-2 rounded-full bg-slate-800">
                                  {isFullRange ? (
                                    <div className="absolute inset-0 rounded-full bg-gradient-to-r from-sky-500/40 via-emerald-500/40 to-sky-500/40" />
                                  ) : hasRange ? (
                                    <div
                                      className="absolute top-0 h-2 rounded-full bg-sky-500/60"
                                      style={{
                                        left: `${rangeStart}%`,
                                        width: `${Math.max(2, rangeEnd - rangeStart)}%`,
                                      }}
                                    />
                                  ) : null}
                                  {!isFullRange && currentPct !== null && (
                                    <div
                                      className="absolute -top-1 h-4 w-0.5 bg-amber-400"
                                      style={{ left: `${currentPct}%` }}
                                    />
                                  )}
                                </div>
                                {!hasRange && !isFullRange && (
                                  <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500">
                                    Range unavailable
                                  </div>
                                )}
                              </div>
                              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                                <span>{lowerLabel}</span>
                                <span>{upperLabel}</span>
                              </div>
                            </div>

                            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                              <div className="flex items-center justify-between text-[11px] text-slate-500">
                                <span>Current price</span>
                                <span>{metrics ? "Live" : "Latest"}</span>
                              </div>
                              <div
                                className="mt-2 text-2xl font-semibold text-slate-100 truncate"
                                title={Number.isFinite(currentPrice) ? formatPrice(currentPrice) : "--"}
                              >
                                {Number.isFinite(currentPrice) ? formatPrice(currentPrice) : "--"}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {pos.token1Symbol} per {pos.token0Symbol}
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-2">
                                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                                  <div className="text-[10px] text-slate-500">
                                    Fees {pos.token0Symbol}
                                  </div>
                                  <div
                                    className="text-sm font-semibold text-slate-100 truncate"
                                    title={`${formatAmount(pos.tokensOwed0, dec0)} ${pos.token0Symbol}`}
                                  >
                                    {formatAmount(pos.tokensOwed0, dec0)} {pos.token0Symbol}
                                  </div>
                                </div>
                                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                                  <div className="text-[10px] text-slate-500">
                                    Fees {pos.token1Symbol}
                                  </div>
                                  <div
                                    className="text-sm font-semibold text-slate-100 truncate"
                                    title={`${formatAmount(pos.tokensOwed1, dec1)} ${pos.token1Symbol}`}
                                  >
                                    {formatAmount(pos.tokensOwed1, dec1)} {pos.token1Symbol}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                </div>
                ) : (
                  <div className="text-sm text-slate-400">
                    {v3ShowClosedPositions
                      ? "No positions found."
                      : closedPositionsCount
                      ? "No open positions. Toggle \"Show closed\" to view closed positions."
                      : "No positions found."}
                  </div>
                )}
              </div>
            </div>
          </div>
          </div>
          )}

          {isV2View && (
            <>
              <div className="rounded-3xl bg-slate-900/60 border border-slate-800/80 shadow-xl shadow-black/40 p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">
                      V2 Liquidity
                    </div>
                    <div className="text-xs text-slate-500">
                      Create V2 positions and manage deposits/withdrawals.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowTokenList(true)}
                    className="px-4 py-2 rounded-full bg-sky-600 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 w-full sm:w-auto"
                  >
                    Start V2 position
                  </button>
                </div>
              </div>

              <div className="rounded-3xl bg-slate-900/60 border border-slate-800/80 shadow-xl shadow-black/40 p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">
                      Your V2 LP Positions
                    </div>
                    <div className="text-xs text-slate-500">
                      Wallet LP balances across available V2 pools.
                    </div>
                  </div>
                  {address && (
                    <button
                      type="button"
                      onClick={() => setLpRefreshTick((v) => v + 1)}
                      className="px-3 py-1.5 rounded-full border border-slate-700 bg-slate-900 text-xs text-slate-200 hover:border-slate-500"
                    >
                      Refresh
                    </button>
                  )}
                </div>

                {!address ? (
                  <div className="text-sm text-slate-400">
                    Connect your wallet to see V2 LP positions.
                  </div>
                ) : v2LpLoading && !v2LpPositions.length ? (
                  <div className="text-sm text-slate-400">Loading positions...</div>
                ) : v2LpError ? (
                  <div className="text-sm text-amber-200">{v2LpError}</div>
                ) : v2LpPositions.length ? (
                  <div className="space-y-3">
                    {v2LpLoading && (
                      <div className="text-[11px] text-slate-500">
                        Refreshing balances...
                      </div>
                    )}
                    {v2LpPositions.map((pos) => {
                      const token0 = tokenRegistry[pos.token0Symbol];
                      const token1 = tokenRegistry[pos.token1Symbol];
                      const sharePct =
                        pos.lpShare !== null && pos.lpShare !== undefined
                          ? (pos.lpShare * 100).toFixed(2)
                          : null;
                      const token0Address =
                        pos.token0Address ||
                        resolveTokenAddress(pos.token0Symbol, tokenRegistry);
                      const token1Address =
                        pos.token1Address ||
                        resolveTokenAddress(pos.token1Symbol, tokenRegistry);
                      const poolAddress = pos.pairAddress || pos.pairId || "";
                      const v2MenuId = poolAddress || pos.id;
                      const v2MenuOpen = v2PositionMenuOpenId === v2MenuId;
                      const v2MenuItems = [
                        {
                          id: "token0",
                          label: pos.token0Symbol,
                          address: token0Address,
                        },
                        {
                          id: "token1",
                          label: pos.token1Symbol,
                          address: token1Address,
                        },
                        {
                          id: "pool",
                          label: "Pool",
                          address: poolAddress,
                        },
                      ];
                      return (
                        <div
                          key={`${pos.id}-lp`}
                          className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex -space-x-2">
                              {[token0, token1].map((t, idx) => (
                                <img
                                  key={idx}
                                  src={t?.logo}
                                  alt={`${t?.symbol || "token"} logo`}
                                  className="h-9 w-9 rounded-full border border-slate-800 bg-slate-900 object-contain"
                                />
                              ))}
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-slate-100">
                                {pos.token0Symbol} / {pos.token1Symbol}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                LP balance: {pos.lpBalance ? pos.lpBalance.toFixed(6) : "--"}
                                {sharePct ? ` · Share ${sharePct}%` : ""}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-right">
                            <div className="text-sm text-slate-100">
                              {pos.positionUsd !== null && pos.positionUsd !== undefined
                                ? `$${formatNumber(pos.positionUsd)}`
                                : "--"}
                            </div>
                            <div className="flex items-center gap-2 justify-end">
                              <div
                                className="relative v2-position-list-menu"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setV2PositionMenuOpenId(v2MenuOpen ? null : v2MenuId)
                                  }
                                  className="h-7 w-7 rounded-full border border-slate-700 bg-slate-900/70 text-slate-200 hover:border-slate-500 inline-flex items-center justify-center"
                                  aria-haspopup="menu"
                                  aria-expanded={v2MenuOpen}
                                  aria-label="Open position details"
                                >
                                  <svg
                                    viewBox="0 0 20 20"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-3.5 w-3.5 text-slate-300"
                                  >
                                    <circle cx="4" cy="10" r="1.5" fill="currentColor" />
                                    <circle cx="10" cy="10" r="1.5" fill="currentColor" />
                                    <circle cx="16" cy="10" r="1.5" fill="currentColor" />
                                  </svg>
                                </button>
                                {v2MenuOpen && (
                                  <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-slate-800 bg-slate-950/95 shadow-2xl shadow-black/40 p-2 z-20">
                                    {v2MenuItems.map((item) => {
                                      const hasAddress = Boolean(item.address);
                                      return (
                                        <div
                                          key={`${pos.id}-${item.id}`}
                                          className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 text-xs text-slate-200 hover:bg-slate-900/80"
                                        >
                                          <span className="font-semibold">{item.label}</span>
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={() => copyAddress(item.address)}
                                              disabled={!hasAddress}
                                              className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:border-sky-500/60 hover:text-sky-100 disabled:opacity-40"
                                              aria-label={`Copy ${item.label} address`}
                                            >
                                              {v3CopiedAddress === item.address ? (
                                                <svg
                                                  viewBox="0 0 20 20"
                                                  fill="none"
                                                  xmlns="http://www.w3.org/2000/svg"
                                                  className="h-3.5 w-3.5 text-emerald-300 mx-auto"
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
                                                  className="h-3.5 w-3.5 mx-auto"
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
                                            {hasAddress ? (
                                              <a
                                                href={`${EXPLORER_BASE_URL}/address/${item.address}`}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:border-sky-500/60 hover:text-sky-100 inline-flex items-center justify-center"
                                                aria-label={`Open ${item.label} on explorer`}
                                              >
                                                <svg
                                                  viewBox="0 0 20 20"
                                                  fill="none"
                                                  xmlns="http://www.w3.org/2000/svg"
                                                  className="h-3.5 w-3.5"
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
                                            ) : (
                                              <div className="h-7 w-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-600 inline-flex items-center justify-center">
                                                <span className="text-[10px]">--</span>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setV2PositionMenuOpenId(null);
                                  handleOpenPoolDepositFromRow(pos);
                                }}
                                className="px-3 py-1.5 rounded-full bg-sky-600 text-white text-xs font-semibold shadow-lg shadow-sky-500/30"
                              >
                                Manage
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">
                    No V2 LP positions found for this wallet.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {showTokenList && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm px-4 py-8 overflow-y-auto">
          <div className="w-full max-w-5xl bg-[#060a1a] border border-slate-800 rounded-3xl shadow-2xl shadow-black/50 overflow-hidden">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-800">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  Tokens
                </div>
                <div className="text-lg font-semibold text-slate-50">
                  Available assets ({filteredTokens.length})
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTokenList(false)}
                className="h-9 w-9 rounded-full bg-slate-900 text-slate-200 flex items-center justify-center border border-slate-800 hover:border-slate-600"
                aria-label="Close token list"
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

            <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-800">
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-full px-3 py-2 text-xs text-slate-300 w-full">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 text-slate-500"
                >
                  <circle
                    cx="11"
                    cy="11"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M15.5 15.5 20 20"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  name="v2-token-search"
                  value={tokenSearch}
                  onChange={(e) => {
                    setTokenSearch(e.target.value);
                    if (customTokenAddError) setCustomTokenAddError("");
                    if (searchTokenMetaError) setSearchTokenMetaError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    if (!showQuickAdd) return;
                    e.preventDefault();
                    addCustomTokenByAddress(searchAddress, { clearSearch: true });
                  }}
                  placeholder="Symbol or address..."
                  className="bg-transparent outline-none flex-1 text-slate-200 placeholder:text-slate-600 text-sm"
                />
              </div>
            </div>

            <div className="hidden md:grid grid-cols-12 px-5 py-2 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
              <div className="col-span-5">Token</div>
              <div className="col-span-3 text-right">TVL</div>
              <div className="col-span-2 text-right">Onchain price</div>
              <div className="col-span-2 text-right">Balance</div>
            </div>

            {customTokenAddError && (
              <div className="px-5 pt-2 text-xs text-amber-200">
                {customTokenAddError}
              </div>
            )}

            <div className="divide-y divide-slate-800">
              {filteredTokens.map((t) => (
                <button
                  type="button"
                  onClick={() => handleTokenPick(t)}
                  key={t.symbol}
                  className="w-full grid grid-cols-12 items-center px-5 py-3 hover:bg-slate-900/40 transition text-left"
                >
                  <div className="col-span-12 md:col-span-5 flex items-center gap-3">
                    <img
                      src={t.logo}
                      alt={`${t.symbol} logo`}
                      className="h-10 w-10 rounded-full border border-slate-800 bg-slate-900 object-contain"
                    />
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                        {t.symbol}
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      </div>
                      <div className="text-[12px] text-slate-400">
                        {shortenAddress(t.address)}
                      </div>
                    </div>
                  </div>
                  <div className="col-span-6 md:col-span-3 text-right text-sm text-slate-100">
                    {formatNumber(t.tvlUsd)}
                    <div className="text-[11px] text-slate-500">TVL</div>
                  </div>
                  <div className="col-span-6 md:col-span-2 text-right text-sm text-slate-100">
                    {formatUsdPrice(t.priceUsd)}
                    <div className="text-[11px] text-slate-500">Onchain price</div>
                  </div>
                  <div className="col-span-12 md:col-span-2 text-right text-sm text-slate-100">
                    {address
                      ? walletBalancesLoading
                        ? "..."
                        : formatTokenBalance(t.walletBalance)
                      : "--"}
                    <div className="text-[11px] text-slate-500">Balance</div>
                  </div>
                </button>
              ))}
              {showQuickAdd ? (
                <div className="px-5 py-6 text-sm text-slate-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
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
                    {customTokenAddLoading ? "Adding..." : "Add token"}
                  </button>
                </div>
              ) : !filteredTokens.length ? (
                <div className="px-5 py-6 text-sm text-slate-400">
                  No tokens match this search.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {v3ActionModal.open && v3ActionModal.position && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={closeV3ActionModal}
          />
          <div className="relative w-full max-w-lg rounded-3xl border border-slate-800 bg-[#0a0f24] p-5 shadow-2xl">
            {(() => {
              const position = v3ActionModal.position;
              const meta0 = findTokenMetaByAddress(position.token0);
              const meta1 = findTokenMetaByAddress(position.token1);
              const token0IsWeth = Boolean(WETH_ADDRESS) &&
                position.token0?.toLowerCase?.() === WETH_ADDRESS.toLowerCase();
              const token1IsWeth = Boolean(WETH_ADDRESS) &&
                position.token1?.toLowerCase?.() === WETH_ADDRESS.toLowerCase();
              const useEth0 = token0IsWeth && v3ActionUseEth0;
              const useEth1 = token1IsWeth && v3ActionUseEth1;
              const displayMeta0 = useEth0
                ? tokenRegistry.ETH
                : token0IsWeth
                ? meta0 || tokenRegistry.WETH
                : meta0;
              const displayMeta1 = useEth1
                ? tokenRegistry.ETH
                : token1IsWeth
                ? meta1 || tokenRegistry.WETH
                : meta1;
              const displaySymbol0 = useEth0
                ? "ETH"
                : token0IsWeth
                ? "WETH"
                : (meta0?.symbol || position.token0Symbol);
              const displaySymbol1 = useEth1
                ? "ETH"
                : token1IsWeth
                ? "WETH"
                : (meta1?.symbol || position.token1Symbol);
              const balance0 = resolveWalletBalanceBySymbol(
                useEth0 ? "ETH" : token0IsWeth ? "WETH" : (meta0?.symbol || position.token0Symbol)
              );
              const balance1 = resolveWalletBalanceBySymbol(
                useEth1 ? "ETH" : token1IsWeth ? "WETH" : (meta1?.symbol || position.token1Symbol)
              );
              const balance0Num = safeNumber(balance0);
              const balance1Num = safeNumber(balance1);
              const hasBalance0 = balance0Num !== null && balance0Num > 0;
              const hasBalance1 = balance1Num !== null && balance1Num > 0;
              const quickButtons = [
                { label: "25%", pct: 0.25 },
                { label: "50%", pct: 0.5 },
                { label: "Max", pct: 1 },
              ];
              const rangeSide = v3ActionRangeSide;
              const canUseSide0 = rangeSide !== "token1";
              const canUseSide1 = rangeSide !== "token0";
              const applyQuickFill = (side, pct) => {
                if (walletBalancesLoading) return;
                if (side === 0 && !canUseSide0) return;
                if (side === 1 && !canUseSide1) return;
                const ethBalanceNum = safeNumber(resolveWalletBalanceExact("ETH"));
                let balance0Effective = balance0Num;
                let balance1Effective = balance1Num;
                if (token0IsWeth && !useEth0 && (!balance0Effective || balance0Effective <= 0)) {
                  if (ethBalanceNum !== null && ethBalanceNum > 0) {
                    balance0Effective = ethBalanceNum;
                    setV3ActionUseEth0(true);
                  }
                }
                if (token1IsWeth && !useEth1 && (!balance1Effective || balance1Effective <= 0)) {
                  if (ethBalanceNum !== null && ethBalanceNum > 0) {
                    balance1Effective = ethBalanceNum;
                    setV3ActionUseEth1(true);
                  }
                }
                const balance = side === 0 ? balance0Effective : balance1Effective;
                if (!Number.isFinite(balance) || balance <= 0) return;
                const sideDecimals =
                  side === 0 ? displayMeta0?.decimals ?? 18 : displayMeta1?.decimals ?? 18;
                const otherDecimals =
                  side === 0 ? displayMeta1?.decimals ?? 18 : displayMeta0?.decimals ?? 18;
                const base = balance * pct;
                const buffered = pct === 1 ? applyMaxBuffer(base, sideDecimals) : base;
                let nextRaw = formatAutoAmount(buffered, sideDecimals);
                let next = sanitizeAmountInput(nextRaw, sideDecimals);
                if (side === 0) {
                  setV3ActionAmount0(next);
                  if (v3ActionError) setV3ActionError("");
                  setV3ActionLastEdited("token0");
                  let computed = computeV3ActionFromAmount0(next);
                  const computedNum = safeNumber(computed);
                  if (
                    computedNum !== null &&
                    Number.isFinite(computedNum) &&
                    balance1Effective !== null &&
                    computedNum > balance1Effective
                  ) {
                    const nextNum = safeNumber(next);
                    if (nextNum !== null && nextNum > 0) {
                      const ratio = balance1Effective / computedNum;
                      const scaled = nextNum * ratio;
                      nextRaw = formatAutoAmount(scaled, sideDecimals);
                      next = sanitizeAmountInput(nextRaw, sideDecimals);
                      setV3ActionAmount0(next);
                      computed = computeV3ActionFromAmount0(next);
                    }
                  }
                  if (computed !== "" && computed !== v3ActionAmount1) {
                    setV3ActionAmount1(
                      sanitizeAmountInput(computed, otherDecimals)
                    );
                  }
                } else {
                  setV3ActionAmount1(next);
                  if (v3ActionError) setV3ActionError("");
                  setV3ActionLastEdited("token1");
                  let computed = computeV3ActionFromAmount1(next);
                  const computedNum = safeNumber(computed);
                  if (
                    computedNum !== null &&
                    Number.isFinite(computedNum) &&
                    balance0Effective !== null &&
                    computedNum > balance0Effective
                  ) {
                    const nextNum = safeNumber(next);
                    if (nextNum !== null && nextNum > 0) {
                      const ratio = balance0Effective / computedNum;
                      const scaled = nextNum * ratio;
                      nextRaw = formatAutoAmount(scaled, sideDecimals);
                      next = sanitizeAmountInput(nextRaw, sideDecimals);
                      setV3ActionAmount1(next);
                      computed = computeV3ActionFromAmount1(next);
                    }
                  }
                  if (computed !== "" && computed !== v3ActionAmount0) {
                    setV3ActionAmount0(
                      sanitizeAmountInput(computed, otherDecimals)
                    );
                  }
                }
              };
              return (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">
                        {v3ActionModal.type === "increase" ? "Increase Position" : "Remove Liquidity"}
                      </div>
                      <div className="text-lg font-semibold text-slate-100">
                        {position.token0Symbol} / {position.token1Symbol}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Position #{position.tokenId} · Fee {formatFeeTier(position.fee)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={closeV3ActionModal}
                      className="h-9 w-9 rounded-full border border-slate-700 text-slate-200 hover:border-slate-500"
                      aria-label="Close"
                    >
                      X
                    </button>
                  </div>

                  {v3ActionModal.type === "increase" ? (
                    <div className="mt-4 space-y-3">
                      <div
                        className={`rounded-2xl border border-slate-800 bg-slate-950/70 p-3 transition ${
                          v3MintDimToken0 ? "opacity-50 grayscale" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span>Deposit</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <input
                            name="v3-increase-0"
                            value={v3ActionAmount0}
                            onChange={(e) => {
                              const next = sanitizeAmountInput(
                                e.target.value,
                                displayMeta0?.decimals ?? 18
                              );
                              setV3ActionAmount0(next);
                              if (v3ActionError) setV3ActionError("");
                              setV3ActionLastEdited("token0");
                              const computed = computeV3ActionFromAmount0(next);
                              if (computed !== "" && computed !== v3ActionAmount1) {
                                setV3ActionAmount1(computed);
                              }
                            }}
                            placeholder="0.0"
                            disabled={!canUseSide0}
                            className="w-full bg-transparent text-2xl font-semibold text-slate-100 outline-none placeholder:text-slate-600 disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                          <div className="flex h-8 items-center justify-center gap-2 rounded-full border border-slate-800 bg-slate-900/80 px-3 text-xs text-slate-100">
                            {displayMeta0?.logo ? (
                              <img
                                src={displayMeta0.logo}
                                alt={`${displaySymbol0} logo`}
                                className="h-5 w-5 rounded-full border border-slate-800 bg-slate-900 object-contain block"
                              />
                            ) : (
                              <div className="h-5 w-5 rounded-full border border-slate-800 bg-slate-900 text-[9px] font-semibold text-slate-200 flex items-center justify-center">
                                {(displaySymbol0 || "?").slice(0, 3)}
                              </div>
                            )}
                            <span className="leading-none">{displaySymbol0}</span>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span>
                            Balance{" "}
                            {walletBalancesLoading
                              ? "Loading..."
                              : balance0Num !== null
                              ? `${formatTokenBalance(balance0Num)} ${displaySymbol0}`
                              : "--"}
                          </span>
                          <div className="flex items-center gap-1">
                            {quickButtons.map((btn) => (
                              <button
                                key={`increase-0-${btn.label}`}
                                type="button"
                                onClick={() => applyQuickFill(0, btn.pct)}
                                disabled={walletBalancesLoading || !hasBalance0 || !canUseSide0}
                                className="rounded-full border border-slate-800 bg-slate-900/70 px-2 py-0.5 text-[10px] font-semibold text-slate-200 hover:border-sky-400/60 disabled:opacity-50"
                              >
                                {btn.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {token0IsWeth && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span>Pay with</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setV3ActionUseEth0(false)}
                                disabled={!canUseSide0}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                  !canUseSide0
                                    ? "border-slate-800 bg-slate-900/70 text-slate-500"
                                    : !useEth0
                                    ? "border-sky-400/70 bg-sky-500/20 text-sky-100"
                                    : "border-slate-800 bg-slate-900/70 text-slate-200 hover:border-slate-500"
                                }`}
                              >
                                WETH
                              </button>
                              <button
                                type="button"
                                onClick={() => setV3ActionUseEth0(true)}
                                disabled={!canUseSide0}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                  !canUseSide0
                                    ? "border-slate-800 bg-slate-900/70 text-slate-500"
                                    : useEth0
                                    ? "border-sky-400/70 bg-sky-500/20 text-sky-100"
                                    : "border-slate-800 bg-slate-900/70 text-slate-200 hover:border-slate-500"
                                }`}
                              >
                                ETH
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                    <div
                      className={`rounded-2xl border border-slate-800 bg-slate-950/70 p-3 transition ${
                        v3MintDimToken1 ? "opacity-50 grayscale" : ""
                      }`}
                    >
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span>Deposit</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <input
                            name="v3-increase-1"
                            value={v3ActionAmount1}
                            onChange={(e) => {
                              const next = sanitizeAmountInput(
                                e.target.value,
                                displayMeta1?.decimals ?? 18
                              );
                              setV3ActionAmount1(next);
                              if (v3ActionError) setV3ActionError("");
                              setV3ActionLastEdited("token1");
                              const computed = computeV3ActionFromAmount1(next);
                              if (computed !== "" && computed !== v3ActionAmount0) {
                                setV3ActionAmount0(computed);
                              }
                            }}
                            placeholder="0.0"
                            disabled={!canUseSide1}
                            className="w-full bg-transparent text-2xl font-semibold text-slate-100 outline-none placeholder:text-slate-600 disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                          <div className="flex h-8 items-center justify-center gap-2 rounded-full border border-slate-800 bg-slate-900/80 px-3 text-xs text-slate-100">
                            {displayMeta1?.logo ? (
                              <img
                                src={displayMeta1.logo}
                                alt={`${displaySymbol1} logo`}
                                className="h-5 w-5 rounded-full border border-slate-800 bg-slate-900 object-contain block"
                              />
                            ) : (
                              <div className="h-5 w-5 rounded-full border border-slate-800 bg-slate-900 text-[9px] font-semibold text-slate-200 flex items-center justify-center">
                                {(displaySymbol1 || "?").slice(0, 3)}
                              </div>
                            )}
                            <span className="leading-none">{displaySymbol1}</span>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span>
                            Balance{" "}
                            {walletBalancesLoading
                              ? "Loading..."
                              : balance1Num !== null
                              ? `${formatTokenBalance(balance1Num)} ${displaySymbol1}`
                              : "--"}
                          </span>
                          <div className="flex items-center gap-1">
                            {quickButtons.map((btn) => (
                              <button
                                key={`increase-1-${btn.label}`}
                                type="button"
                                onClick={() => applyQuickFill(1, btn.pct)}
                                disabled={walletBalancesLoading || !hasBalance1 || !canUseSide1}
                                className="rounded-full border border-slate-800 bg-slate-900/70 px-2 py-0.5 text-[10px] font-semibold text-slate-200 hover:border-sky-400/60 disabled:opacity-50"
                              >
                                {btn.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {token1IsWeth && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span>Pay with</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setV3ActionUseEth1(false)}
                                disabled={!canUseSide1}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                  !canUseSide1
                                    ? "border-slate-800 bg-slate-900/70 text-slate-500"
                                    : !useEth1
                                    ? "border-sky-400/70 bg-sky-500/20 text-sky-100"
                                    : "border-slate-800 bg-slate-900/70 text-slate-200 hover:border-slate-500"
                                }`}
                              >
                                WETH
                              </button>
                              <button
                                type="button"
                                onClick={() => setV3ActionUseEth1(true)}
                                disabled={!canUseSide1}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                  !canUseSide1
                                    ? "border-slate-800 bg-slate-900/70 text-slate-500"
                                    : useEth1
                                    ? "border-sky-400/70 bg-sky-500/20 text-sky-100"
                                    : "border-slate-800 bg-slate-900/70 text-slate-200 hover:border-slate-500"
                                }`}
                              >
                                ETH
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span>Remove liquidity</span>
                          <span>{v3RemovePct || 0}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={Number(v3RemovePct || 0)}
                          onChange={(e) => setV3RemovePct(e.target.value)}
                          className="mt-3 w-full accent-rose-400"
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                          {[25, 50, 75, 100].map((pct) => (
                            <button
                              key={pct}
                              type="button"
                              onClick={() => setV3RemovePct(String(pct))}
                              className="px-3 py-1 rounded-full border border-slate-800 bg-slate-900/70 text-xs text-slate-200 hover:border-rose-500/60"
                            >
                              {pct}%
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {v3ActionError && (
                    <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                      {v3ActionError}
                    </div>
                  )}

                  <div className="mt-4 flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={() => handleV3Collect(position)}
                      disabled={v3ActionLoading}
                      className="flex-1 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-emerald-500/60 disabled:opacity-60"
                    >
                      Claim fees
                    </button>
                    <button
                      type="button"
                      onClick={v3ActionModal.type === "increase" ? handleV3Increase : handleV3Remove}
                      disabled={v3ActionLoading}
                      className="flex-1 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 disabled:opacity-60"
                    >
                      {v3ActionLoading
                        ? "Processing..."
                        : v3ActionModal.type === "increase"
                        ? "Increase"
                        : "Remove"}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {actionStatus && (
        <div className="fixed left-4 bottom-4 z-50 max-w-sm">
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              if (actionStatus?.hash) {
                window.open(
                  `${EXPLORER_BASE_URL}/tx/${actionStatus.hash}`,
                  "_blank",
                  "noopener,noreferrer"
                );
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (actionStatus?.hash) {
                  window.open(
                    `${EXPLORER_BASE_URL}/tx/${actionStatus.hash}`,
                    "_blank",
                    "noopener,noreferrer"
                  );
                }
              }
            }}
            className={`group relative flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-sm cursor-pointer transition ${
              actionStatus.variant === "success"
                ? "bg-emerald-900/80 border-emerald-500/50 text-emerald-50 hover:border-emerald-400/70"
                : actionStatus.variant === "pending"
                ? "bg-slate-900/80 border-slate-700/60 text-slate-100 hover:border-slate-500/70"
                : "bg-rose-900/80 border-rose-500/50 text-rose-50 hover:border-rose-400/70"
            }`}
          >
            <div
              className={`mt-0.5 h-8 w-8 rounded-xl flex items-center justify-center shadow-inner shadow-black/30 ${
                actionStatus.variant === "success"
                  ? "bg-emerald-600/50 text-emerald-100"
                  : actionStatus.variant === "pending"
                  ? "bg-slate-700/60 text-slate-200"
                  : "bg-rose-600/50 text-rose-100"
              }`}
            >
              {actionStatus.variant === "success" ? (
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : actionStatus.variant === "pending" ? (
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 animate-spin">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" strokeOpacity="0.35" />
                  <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                  <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              )}
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold">
                {actionStatus.variant === "success"
                  ? "Transaction confirmed"
                  : actionStatus.variant === "pending"
                  ? "Working..."
                  : "Transaction failed"}
              </div>
              <div className="text-xs text-slate-200/90 mt-0.5">
                {actionStatus.message}
              </div>
              {actionStatus.hash && (
                <div className="text-[11px] text-sky-200 underline mt-1">
                  Open on {EXPLORER_LABEL}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActionStatus(null);
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

