import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, JsonRpcProvider, formatUnits, getAddress } from "ethers";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Search } from "lucide-react";
import { EXPLORER_BASE_URL } from "../shared/config/addresses";
import { ALM_ADDRESSES, ALM_CHAIN_ID, ALM_RPC_URL } from "../shared/config/almConfig";
import { ERC20_METADATA_ABI, NFPM_ABI, POOL_SLOT0_ABI, V3_FACTORY_MIN_ABI } from "../shared/config/almAbis";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_USER_NFT_SCAN = 60;
const POOL_META_ABI = [
  {
    type: "function",
    name: "tickSpacing",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "int24" }],
  },
];

const normalizeAddress = (value) => {
  try {
    return getAddress(String(value || ""));
  } catch {
    return String(value || "");
  }
};

const isZeroAddress = (value) => normalizeAddress(value).toLowerCase() === ZERO_ADDRESS.toLowerCase();

const shortenAddress = (value, start = 6, end = 4) => {
  const raw = String(value || "");
  if (!raw) return "--";
  if (raw.length <= start + end) return raw;
  return `${raw.slice(0, start)}...${raw.slice(-end)}`;
};

const normalizePath = (path = "") => {
  const cleaned = String(path || "").toLowerCase().replace(/\/+$/u, "");
  return cleaned || "/";
};

const formatFeeTier = (feeTier) => `${(Number(feeTier || 0) / 10_000).toFixed(2)}%`;

const formatNumber = (value, digits = 2) => {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
};

const formatPercent = (value) => {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(2).replace(/\.?0+$/u, "")}%`;
};

const parseTokenAmount = (raw, decimals) => {
  try {
    const asNum = Number(formatUnits(BigInt(raw || 0n), Number(decimals || 18)));
    return Number.isFinite(asNum) ? asNum : 0;
  } catch {
    return 0;
  }
};

const stableHints = ["USDC", "USDT", "DAI", "USD", "USDE", "FDUSD", "TUSD", "USDM", "WUSD", "STCUSD"];
const isStableLike = (symbol) => {
  const text = String(symbol || "").toUpperCase();
  return stableHints.some((hint) => text.includes(hint));
};

const tickToPrice = (tick, token0Decimals, token1Decimals) => {
  if (!Number.isFinite(tick)) return null;
  const rawRatio = Math.exp(Number(tick) * Math.log(1.0001));
  const decimalsAdjust = Math.pow(10, Number(token0Decimals || 18) - Number(token1Decimals || 18));
  const humanRatio = rawRatio * decimalsAdjust;
  return Number.isFinite(humanRatio) && humanRatio > 0 ? humanRatio : null;
};

const estimatePositionTokenAmounts = ({
  liquidityRaw,
  tickLower,
  tickUpper,
  currentTick,
  token0Decimals,
  token1Decimals,
}) => {
  const liquidity = Number(liquidityRaw || 0n);
  if (!Number.isFinite(liquidity) || liquidity <= 0) {
    return { amount0: 0, amount1: 0 };
  }
  if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper) || tickLower >= tickUpper) {
    return { amount0: 0, amount1: 0 };
  }

  const sqrtLower = Math.exp((Number(tickLower) * Math.log(1.0001)) / 2);
  const sqrtUpper = Math.exp((Number(tickUpper) * Math.log(1.0001)) / 2);
  const sqrtCurrent = Number.isFinite(currentTick)
    ? Math.exp((Number(currentTick) * Math.log(1.0001)) / 2)
    : sqrtLower;

  if (
    !Number.isFinite(sqrtLower) ||
    !Number.isFinite(sqrtUpper) ||
    !Number.isFinite(sqrtCurrent) ||
    sqrtLower <= 0 ||
    sqrtUpper <= 0
  ) {
    return { amount0: 0, amount1: 0 };
  }

  let amount0Raw = 0;
  let amount1Raw = 0;

  if (sqrtCurrent <= sqrtLower) {
    amount0Raw = (liquidity * (sqrtUpper - sqrtLower)) / (sqrtLower * sqrtUpper);
    amount1Raw = 0;
  } else if (sqrtCurrent < sqrtUpper) {
    amount0Raw = (liquidity * (sqrtUpper - sqrtCurrent)) / (sqrtCurrent * sqrtUpper);
    amount1Raw = liquidity * (sqrtCurrent - sqrtLower);
  } else {
    amount0Raw = 0;
    amount1Raw = liquidity * (sqrtUpper - sqrtLower);
  }

  const amount0 = Math.max(0, amount0Raw) / Math.pow(10, Number(token0Decimals || 18));
  const amount1 = Math.max(0, amount1Raw) / Math.pow(10, Number(token1Decimals || 18));
  return {
    amount0: Number.isFinite(amount0) ? amount0 : 0,
    amount1: Number.isFinite(amount1) ? amount1 : 0,
  };
};

const buildSeries = (seedRaw, currentPrice) => {
  const count = 84;
  const seedBase = Number.parseInt(String(seedRaw || "1"), 10) || 1;
  let seed = Math.abs(seedBase % 2147483647) || 1;
  const base = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : 1;
  const points = [];
  let value = base * 1.08;
  for (let i = 0; i < count; i += 1) {
    seed = (seed * 48271) % 2147483647;
    const rand = seed / 2147483647;
    const drift = i < count * 0.7 ? -0.004 : 0.0015;
    const noise = (rand - 0.5) * 0.07;
    value = Math.max(0.0000001, value * (1 + drift + noise));
    points.push(value);
  }
  const last = points[points.length - 1] || 1;
  if (Number.isFinite(currentPrice) && currentPrice > 0 && Number.isFinite(last) && last > 0) {
    const ratio = currentPrice / last;
    return points.map((point, index) => {
      const factor = Math.pow(ratio, index / (points.length - 1));
      return point * factor;
    });
  }
  return points;
};

const buildPathFromSeries = (series, width, height, minY, maxY) => {
  if (!series.length) return "";
  const span = Math.max(maxY - minY, 0.0000001);
  const points = series.map((value, index) => {
    const x = (index / Math.max(series.length - 1, 1)) * width;
    const y = height - ((value - minY) / span) * height;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return points.join(" ");
};

function PriceChart({ series, minPrice, maxPrice, marketPrice }) {
  const width = 860;
  const height = 440;

  if (!series.length) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/60 text-sm text-slate-400">
        Not enough data for chart preview.
      </div>
    );
  }

  const merged = [...series];
  if (Number.isFinite(minPrice)) merged.push(minPrice);
  if (Number.isFinite(maxPrice)) merged.push(maxPrice);
  if (Number.isFinite(marketPrice)) merged.push(marketPrice);
  const minY = Math.min(...merged) * 0.985;
  const maxY = Math.max(...merged) * 1.015;
  const linePath = buildPathFromSeries(series, width, height, minY, maxY);
  const yFor = (value) => {
    const span = Math.max(maxY - minY, 0.0000001);
    return height - ((value - minY) / span) * height;
  };
  const rangeTop =
    Number.isFinite(minPrice) && Number.isFinite(maxPrice) ? Math.min(yFor(minPrice), yFor(maxPrice)) : null;
  const rangeBottom =
    Number.isFinite(minPrice) && Number.isFinite(maxPrice) ? Math.max(yFor(minPrice), yFor(maxPrice)) : null;
  const marketY = Number.isFinite(marketPrice) ? yFor(marketPrice) : null;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[420px] w-full">
        <defs>
          <linearGradient id="cx-line-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(34,197,94,0.95)" />
            <stop offset="100%" stopColor="rgba(34,197,94,0.35)" />
          </linearGradient>
        </defs>

        {Number.isFinite(rangeTop) && Number.isFinite(rangeBottom) && (
          <rect
            x="0"
            y={rangeTop.toFixed(2)}
            width={width}
            height={Math.max(1, rangeBottom - rangeTop).toFixed(2)}
            fill="rgba(148,163,184,0.20)"
          />
        )}

        {[0.2, 0.4, 0.6, 0.8].map((fraction) => (
          <line
            key={fraction}
            x1="0"
            x2={width}
            y1={(height * fraction).toFixed(2)}
            y2={(height * fraction).toFixed(2)}
            stroke="rgba(100,116,139,0.28)"
            strokeWidth="1"
          />
        ))}

        <path d={linePath} fill="none" stroke="url(#cx-line-fade)" strokeWidth="4" strokeLinecap="round" />

        {Number.isFinite(marketY) && (
          <line
            x1="0"
            x2={width}
            y1={marketY.toFixed(2)}
            y2={marketY.toFixed(2)}
            stroke="rgba(34,197,94,0.70)"
            strokeWidth="1.5"
            strokeDasharray="4 6"
          />
        )}
      </svg>
    </div>
  );
}
const initialDetail = {
  tokenId: "",
  owner: "",
  pool: "",
  token0: "",
  token1: "",
  token0Symbol: "token0",
  token1Symbol: "token1",
  token0Decimals: 18,
  token1Decimals: 18,
  fee: 0,
  tickLower: null,
  tickUpper: null,
  tickSpacing: null,
  currentTick: null,
  minPrice: null,
  maxPrice: null,
  marketPrice: null,
  inRange: null,
  liquidity: 0n,
  principal0: 0,
  principal1: 0,
  fees0: 0,
  fees1: 0,
  positionValueToken1: 0,
  feesValueToken1: 0,
  token0ValuePct: 0,
  token1ValuePct: 0,
  fee0ValuePct: 0,
  fee1ValuePct: 0,
  chartSeries: [],
};

export default function Positions({ address, onConnect, routePath = "/positions", onNavigate }) {
  const [positionInput, setPositionInput] = useState("");
  const [positionIds, setPositionIds] = useState([]);
  const [positionIdsLoading, setPositionIdsLoading] = useState(false);
  const [detail, setDetail] = useState(initialDetail);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const readProvider = useMemo(
    () =>
      new JsonRpcProvider(ALM_RPC_URL, {
        chainId: ALM_CHAIN_ID,
        name: "MegaETH",
      }),
    []
  );

  const pathInfo = useMemo(() => {
    const cleaned = normalizePath(routePath);
    const match = /^\/positions(?:\/(\d+))?$/u.exec(cleaned);
    return {
      path: cleaned,
      selectedPositionId: match?.[1] || "",
    };
  }, [routePath]);

  useEffect(() => {
    setPositionInput(pathInfo.selectedPositionId);
  }, [pathInfo.selectedPositionId]);

  const resolveTokenMeta = useCallback(
    async (tokenAddress) => {
      const normalized = normalizeAddress(tokenAddress);
      if (!normalized || isZeroAddress(normalized)) {
        return { symbol: "--", decimals: 18 };
      }
      try {
        const erc20 = new Contract(normalized, ERC20_METADATA_ABI, readProvider);
        const [symbolRaw, decimalsRaw] = await Promise.all([
          erc20.symbol().catch(() => ""),
          erc20.decimals().catch(() => 18),
        ]);
        return {
          symbol: String(symbolRaw || normalized.slice(0, 6)).trim() || normalized.slice(0, 6),
          decimals: Number(decimalsRaw || 18),
        };
      } catch {
        return {
          symbol: normalized.slice(0, 6),
          decimals: 18,
        };
      }
    },
    [readProvider]
  );

  const loadOwnedTokenIds = useCallback(async () => {
    if (!address) {
      setPositionIds([]);
      return;
    }
    setPositionIdsLoading(true);
    try {
      const nfpm = new Contract(ALM_ADDRESSES.NFPM, NFPM_ABI, readProvider);
      const user = normalizeAddress(address);
      const balanceRaw = await nfpm.balanceOf(user);
      const balance = Number(balanceRaw || 0n);
      const cap = Math.min(Math.max(0, balance), MAX_USER_NFT_SCAN);
      const ids = [];
      for (let index = 0; index < cap; index += 1) {
        const tokenIdRaw = await nfpm.tokenOfOwnerByIndex(user, BigInt(index));
        const tokenId = BigInt(tokenIdRaw || 0n).toString();
        if (tokenId !== "0") ids.push(tokenId);
      }
      ids.sort((a, b) => (BigInt(a) < BigInt(b) ? 1 : -1));
      setPositionIds(ids);
    } catch {
      setPositionIds([]);
    } finally {
      setPositionIdsLoading(false);
    }
  }, [address, readProvider]);

  useEffect(() => {
    void loadOwnedTokenIds();
  }, [loadOwnedTokenIds]);

  const loadPositionDetail = useCallback(
    async (tokenId) => {
      if (!tokenId) {
        setDetail(initialDetail);
        setDetailError("");
        return;
      }
      setDetailLoading(true);
      setDetailError("");
      try {
        const nfpm = new Contract(ALM_ADDRESSES.NFPM, NFPM_ABI, readProvider);
        const tokenIdBig = BigInt(tokenId);

        const [ownerRaw, positionRaw, factoryRaw] = await Promise.all([
          nfpm.ownerOf(tokenIdBig),
          nfpm.positions(tokenIdBig),
          nfpm.factory(),
        ]);
        const owner = normalizeAddress(String(ownerRaw || ZERO_ADDRESS));
        if (!owner || isZeroAddress(owner)) {
          throw new Error("Position NFT not found.");
        }

        const token0 = normalizeAddress(positionRaw?.token0 || ZERO_ADDRESS);
        const token1 = normalizeAddress(positionRaw?.token1 || ZERO_ADDRESS);
        const fee = Number(positionRaw?.fee || 0);
        const tickLower = Number(positionRaw?.tickLower);
        const tickUpper = Number(positionRaw?.tickUpper);
        const liquidityRaw = BigInt(positionRaw?.liquidity || 0n);
        const tokensOwed0Raw = BigInt(positionRaw?.tokensOwed0 || 0n);
        const tokensOwed1Raw = BigInt(positionRaw?.tokensOwed1 || 0n);

        const [token0Meta, token1Meta] = await Promise.all([resolveTokenMeta(token0), resolveTokenMeta(token1)]);

        const factory = new Contract(normalizeAddress(factoryRaw), V3_FACTORY_MIN_ABI, readProvider);
        const pool = normalizeAddress(String(await factory.getPool(token0, token1, fee)));
        if (!pool || isZeroAddress(pool)) {
          throw new Error("Uniswap pool not found for this NFT.");
        }

        const [slot0, tickSpacingRaw] = await Promise.all([
          new Contract(pool, POOL_SLOT0_ABI, readProvider).slot0(),
          new Contract(pool, POOL_META_ABI, readProvider).tickSpacing().catch(() => null),
        ]);

        const currentTick = Number(slot0?.tick);
        const tickSpacing = tickSpacingRaw === null ? null : Number(tickSpacingRaw);
        const minPrice = tickToPrice(tickLower, token0Meta.decimals, token1Meta.decimals);
        const maxPrice = tickToPrice(tickUpper, token0Meta.decimals, token1Meta.decimals);
        const marketPrice = tickToPrice(currentTick, token0Meta.decimals, token1Meta.decimals);
        const inRange =
          Number.isFinite(currentTick) && Number.isFinite(tickLower) && Number.isFinite(tickUpper)
            ? currentTick >= tickLower && currentTick <= tickUpper
            : null;

        const { amount0: principal0, amount1: principal1 } = estimatePositionTokenAmounts({
          liquidityRaw,
          tickLower,
          tickUpper,
          currentTick,
          token0Decimals: token0Meta.decimals,
          token1Decimals: token1Meta.decimals,
        });
        const fees0 = parseTokenAmount(tokensOwed0Raw, token0Meta.decimals);
        const fees1 = parseTokenAmount(tokensOwed1Raw, token1Meta.decimals);
        const safePrice = Number.isFinite(marketPrice) ? marketPrice : 0;
        const token0Value = principal0 * safePrice;
        const token1Value = principal1;
        const fee0Value = fees0 * safePrice;
        const fee1Value = fees1;
        const positionValueToken1 = token0Value + token1Value;
        const feesValueToken1 = fee0Value + fee1Value;
        const positionDenominator = positionValueToken1 > 0 ? positionValueToken1 : 1;
        const feesDenominator = feesValueToken1 > 0 ? feesValueToken1 : 1;
        const token0ValuePct = (token0Value / positionDenominator) * 100;
        const token1ValuePct = (token1Value / positionDenominator) * 100;
        const fee0ValuePct = (fee0Value / feesDenominator) * 100;
        const fee1ValuePct = (fee1Value / feesDenominator) * 100;
        const chartSeries = buildSeries(tokenId, marketPrice || minPrice || maxPrice || 1);

        setDetail({
          tokenId,
          owner,
          pool,
          token0,
          token1,
          token0Symbol: token0Meta.symbol,
          token1Symbol: token1Meta.symbol,
          token0Decimals: token0Meta.decimals,
          token1Decimals: token1Meta.decimals,
          fee,
          tickLower,
          tickUpper,
          tickSpacing,
          currentTick,
          minPrice,
          maxPrice,
          marketPrice,
          inRange,
          liquidity: liquidityRaw,
          principal0,
          principal1,
          fees0,
          fees1,
          positionValueToken1,
          feesValueToken1,
          token0ValuePct,
          token1ValuePct,
          fee0ValuePct,
          fee1ValuePct,
          chartSeries,
        });
      } catch (error) {
        setDetail(initialDetail);
        setDetailError(String(error?.message || "Unable to load this NFT position."));
      } finally {
        setDetailLoading(false);
      }
    },
    [readProvider, resolveTokenMeta]
  );

  useEffect(() => {
    void loadPositionDetail(pathInfo.selectedPositionId);
  }, [loadPositionDetail, pathInfo.selectedPositionId]);

  const handleSearchSubmit = useCallback(
    (event) => {
      event.preventDefault();
      const value = String(positionInput || "").trim();
      if (!/^\d+$/u.test(value)) return;
      onNavigate?.(`/positions/${value}`);
    },
    [onNavigate, positionInput]
  );

  const positionValueLabel = useMemo(() => {
    const stable = isStableLike(detail.token1Symbol);
    if (stable) return `$${formatNumber(detail.positionValueToken1, 2)}`;
    return `${formatNumber(detail.positionValueToken1, 5)} ${detail.token1Symbol}`;
  }, [detail.positionValueToken1, detail.token1Symbol]);

  const feesValueLabel = useMemo(() => {
    const stable = isStableLike(detail.token1Symbol);
    if (stable) return `$${formatNumber(detail.feesValueToken1, 4)}`;
    return `${formatNumber(detail.feesValueToken1, 6)} ${detail.token1Symbol}`;
  }, [detail.feesValueToken1, detail.token1Symbol]);

  return (
    <section className="px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-[1320px] space-y-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Hidden Route</div>
              <h1 className="mt-1 font-display text-2xl font-semibold text-slate-100">NFT Position Explorer</h1>
              <p className="mt-1 text-sm text-slate-400">
                Open this page directly with URL path: <span className="font-mono text-slate-300">/positions/:id</span>
              </p>
            </div>
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

          <form onSubmit={handleSearchSubmit} className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-700/80 bg-slate-900/65 px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={positionInput}
                inputMode="numeric"
                onChange={(event) => setPositionInput(event.target.value.replace(/[^\d]/gu, ""))}
                placeholder="Search NFT position ID (example: 235)"
                className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
              />
            </label>
            <button
              type="submit"
              disabled={!/^\d+$/u.test(String(positionInput || "").trim())}
              className="rounded-2xl border border-sky-300/55 bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Open Position
            </button>
          </form>

          {address && (
            <div className="mt-3">
              <div className="text-xs text-slate-500">Your LP NFTs</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {positionIdsLoading && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading
                  </span>
                )}
                {!positionIdsLoading && positionIds.length === 0 && (
                  <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
                    No NFT positions found
                  </span>
                )}
                {positionIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onNavigate?.(`/positions/${id}`)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      id === pathInfo.selectedPositionId
                        ? "border-sky-400/65 bg-sky-500/10 text-sky-100"
                        : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    #{id}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {!pathInfo.selectedPositionId && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/55 px-4 py-6 text-sm text-slate-300">
            Enter an NFT position ID to open its detailed view.
          </div>
        )}

        {detailLoading && pathInfo.selectedPositionId && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/55 px-4 py-6 text-sm text-slate-300">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading position #{pathInfo.selectedPositionId}...
            </span>
          </div>
        )}

        {!!detailError && pathInfo.selectedPositionId && !detailLoading && (
          <div className="rounded-2xl border border-rose-500/45 bg-rose-900/15 px-4 py-4 text-sm text-rose-100">
            <div className="inline-flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              Unable to load position #{pathInfo.selectedPositionId}
            </div>
            <div className="mt-1 text-rose-100/90">{detailError}</div>
          </div>
        )}

        {!detailLoading && !detailError && detail.tokenId && (
          <>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
              <button
                type="button"
                onClick={() => onNavigate?.("/positions")}
                className="text-xs text-slate-400 transition hover:text-slate-200"
              >
                &larr; Your positions
              </button>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <div className="font-display text-2xl font-semibold text-slate-100">
                  {detail.token0Symbol} / {detail.token1Symbol}
                </div>
                <span className="rounded-md border border-slate-700/70 bg-slate-900 px-2 py-0.5 text-xs text-slate-300">
                  V3
                </span>
                <span className="rounded-md border border-slate-700/70 bg-slate-900 px-2 py-0.5 text-xs text-slate-300">
                  {formatFeeTier(detail.fee)}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${
                    detail.inRange === true
                      ? "border-emerald-400/45 bg-emerald-500/12 text-emerald-100"
                      : detail.inRange === false
                      ? "border-amber-400/45 bg-amber-500/12 text-amber-100"
                      : "border-slate-700/70 bg-slate-900 text-slate-300"
                  }`}
                >
                  {detail.inRange === true && <CheckCircle2 className="h-3.5 w-3.5" />}
                  {detail.inRange === true ? "In range" : detail.inRange === false ? "Out of range" : "Range unknown"}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                <span>NFT #{detail.tokenId}</span>
                <span>Owner {shortenAddress(detail.owner, 8, 6)}</span>
                <span>Tick spacing {detail.tickSpacing ?? "--"}</span>
                <a
                  href={`${EXPLORER_BASE_URL}/token/${ALM_ADDRESSES.NFPM}?a=${detail.tokenId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sky-200 underline decoration-dotted underline-offset-2"
                >
                  NFT <ExternalLink className="h-3 w-3" />
                </a>
                <a
                  href={`${EXPLORER_BASE_URL}/address/${detail.pool}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sky-200 underline decoration-dotted underline-offset-2"
                >
                  Pool <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,1fr)]">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
                <div className="text-3xl font-semibold text-slate-100">
                  {Number.isFinite(detail.marketPrice) ? formatNumber(detail.marketPrice, 6) : "--"} {detail.token1Symbol} =
                  1 {detail.token0Symbol}
                </div>

                <div className="mt-4">
                  <PriceChart
                    series={detail.chartSeries}
                    minPrice={detail.minPrice}
                    maxPrice={detail.maxPrice}
                    marketPrice={detail.marketPrice}
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {["1D", "1W", "1M", "1Y", "All time"].map((range) => (
                    <button
                      key={range}
                      type="button"
                      className={`rounded-full border px-3 py-1 text-xs ${
                        range === "1M"
                          ? "border-slate-500 bg-slate-800 text-slate-100"
                          : "border-slate-700 bg-slate-900/60 text-slate-300"
                      }`}
                    >
                      {range}
                    </button>
                  ))}
                </div>

                <div className="mt-6">
                  <h3 className="font-display text-2xl font-semibold text-slate-100">Price Range</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/55 p-3">
                      <div className="text-xs text-slate-500">Min price</div>
                      <div className="mt-1 text-2xl text-slate-100">
                        {Number.isFinite(detail.minPrice) ? formatNumber(detail.minPrice, 6) : "--"}
                      </div>
                      <div className="text-xs text-slate-400">
                        {detail.token1Symbol} per 1 {detail.token0Symbol}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/55 p-3">
                      <div className="text-xs text-slate-500">Max price</div>
                      <div className="mt-1 text-2xl text-slate-100">
                        {Number.isFinite(detail.maxPrice) ? formatNumber(detail.maxPrice, 6) : "--"}
                      </div>
                      <div className="text-xs text-slate-400">
                        {detail.token1Symbol} per 1 {detail.token0Symbol}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/55 p-3">
                      <div className="text-xs text-slate-500">Market price</div>
                      <div className="mt-1 text-2xl text-slate-100">
                        {Number.isFinite(detail.marketPrice) ? formatNumber(detail.marketPrice, 6) : "--"}
                      </div>
                      <div className="text-xs text-slate-400">
                        {detail.token1Symbol} per 1 {detail.token0Symbol}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="text-sm text-slate-400">Position</div>
                  <div className="mt-1 text-5xl font-semibold text-slate-100">{positionValueLabel}</div>

                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-emerald-400"
                      style={{ width: `${Math.max(0, Math.min(100, detail.token0ValuePct))}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                    <span>
                      {detail.token0Symbol}: {formatPercent(detail.token0ValuePct)}
                    </span>
                    <span>
                      {detail.token1Symbol}: {formatPercent(detail.token1ValuePct)}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2 text-sm text-slate-200">
                    <div className="flex items-center justify-between">
                      <span>
                        {formatNumber(detail.principal0, 6)} {detail.token0Symbol}
                      </span>
                      <span className="text-slate-400">in position</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>
                        {formatNumber(detail.principal1, 6)} {detail.token1Symbol}
                      </span>
                      <span className="text-slate-400">in position</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="text-sm text-slate-400">Fees earned</div>
                  <div className="mt-1 text-5xl font-semibold text-slate-100">{feesValueLabel}</div>

                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-cyan-400"
                      style={{ width: `${Math.max(0, Math.min(100, detail.fee0ValuePct))}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                    <span>
                      {detail.token0Symbol}: {formatPercent(detail.fee0ValuePct)}
                    </span>
                    <span>
                      {detail.token1Symbol}: {formatPercent(detail.fee1ValuePct)}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2 text-sm text-slate-200">
                    <div className="flex items-center justify-between">
                      <span>
                        {formatNumber(detail.fees0, 6)} {detail.token0Symbol}
                      </span>
                      <span className="text-slate-400">uncollected</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>
                        {formatNumber(detail.fees1, 6)} {detail.token1Symbol}
                      </span>
                      <span className="text-slate-400">uncollected</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-400">
                  <div>Owner: {detail.owner || "--"}</div>
                  <div className="mt-1">Tick lower/upper: {detail.tickLower ?? "--"} / {detail.tickUpper ?? "--"}</div>
                  <div className="mt-1">Current tick: {detail.currentTick ?? "--"}</div>
                  <div className="mt-1">Liquidity units: {String(detail.liquidity || 0n)}</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
