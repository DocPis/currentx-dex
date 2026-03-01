import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, JsonRpcProvider, formatUnits, getAddress } from "ethers";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Search } from "lucide-react";
import { EXPLORER_BASE_URL } from "../shared/config/addresses";
import { ALM_ADDRESSES, ALM_CHAIN_ID, ALM_RPC_URL } from "../shared/config/almConfig";
import { ALM_ABI, ERC20_METADATA_ABI, NFPM_ABI, POOL_SLOT0_ABI } from "../shared/config/almAbis";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_USER_POSITIONS_SCAN = 64;

const normalizeAddress = (value) => {
  try {
    return getAddress(String(value || ""));
  } catch {
    return String(value || "");
  }
};

const isZeroAddress = (value) => normalizeAddress(value).toLowerCase() === ZERO_ADDRESS.toLowerCase();

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

const tickToPrice = (tick) => {
  if (!Number.isFinite(tick)) return null;
  const value = Math.exp(Number(tick) * Math.log(1.0001));
  return Number.isFinite(value) && value > 0 ? value : null;
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
  positionId: "",
  owner: "",
  strategyId: 0,
  pool: "",
  token0: "",
  token1: "",
  token0Symbol: "token0",
  token1Symbol: "token1",
  token0Decimals: 18,
  token1Decimals: 18,
  fee: 0,
  tickSpacing: 0,
  currentTokenId: "0",
  active: false,
  tickLower: null,
  tickUpper: null,
  currentTick: null,
  minPrice: null,
  maxPrice: null,
  marketPrice: null,
  inRange: null,
  liquidity: 0n,
  dust0Raw: 0n,
  dust1Raw: 0n,
  fees0Raw: 0n,
  fees1Raw: 0n,
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

  const loadPositionIds = useCallback(async () => {
    if (!address) {
      setPositionIds([]);
      return;
    }
    setPositionIdsLoading(true);
    try {
      const alm = new Contract(ALM_ADDRESSES.ALM, ALM_ABI, readProvider);
      const user = normalizeAddress(address);
      const ids = [];
      for (let index = 0; index < MAX_USER_POSITIONS_SCAN; index += 1) {
        try {
          const idRaw = await alm.userPositions(user, BigInt(index));
          const parsed = BigInt(idRaw || 0n).toString();
          if (parsed === "0" && index > 0) break;
          if (parsed !== "0") ids.push(parsed);
        } catch {
          break;
        }
      }
      const unique = Array.from(new Set(ids)).sort((a, b) => (BigInt(a) < BigInt(b) ? 1 : -1));
      setPositionIds(unique);
    } catch {
      setPositionIds([]);
    } finally {
      setPositionIdsLoading(false);
    }
  }, [address, readProvider]);

  useEffect(() => {
    void loadPositionIds();
  }, [loadPositionIds]);

  const loadPositionDetail = useCallback(
    async (positionId) => {
      if (!positionId) {
        setDetail(initialDetail);
        setDetailError("");
        return;
      }
      setDetailLoading(true);
      setDetailError("");
      try {
        const alm = new Contract(ALM_ADDRESSES.ALM, ALM_ABI, readProvider);
        const nfpm = new Contract(ALM_ADDRESSES.NFPM, NFPM_ABI, readProvider);

        const tuple = await alm.positionsById(BigInt(positionId));
        const owner = normalizeAddress(String(tuple?.[0] || ZERO_ADDRESS));
        if (!owner || isZeroAddress(owner)) {
          throw new Error("Position not found on ALM contract.");
        }

        const strategyId = Number(tuple?.[1] || 0n);
        const pool = normalizeAddress(String(tuple?.[2] || ZERO_ADDRESS));
        const token0 = normalizeAddress(String(tuple?.[3] || ZERO_ADDRESS));
        const token1 = normalizeAddress(String(tuple?.[4] || ZERO_ADDRESS));
        const fee = Number(tuple?.[5] || 0n);
        const tickSpacing = Number(tuple?.[6] || 0n);
        const currentTokenId = BigInt(tuple?.[7] || 0n).toString();
        const active = Boolean(tuple?.[9]);

        const [dust0Raw, dust1Raw, token0Meta, token1Meta] = await Promise.all([
          alm.dust0(BigInt(positionId)).catch(() => 0n),
          alm.dust1(BigInt(positionId)).catch(() => 0n),
          resolveTokenMeta(token0),
          resolveTokenMeta(token1),
        ]);

        let tickLower = null;
        let tickUpper = null;
        let liquidity = 0n;
        let fees0Raw = 0n;
        let fees1Raw = 0n;
        if (currentTokenId !== "0") {
          try {
            const nftData = await nfpm.positions(BigInt(currentTokenId));
            tickLower = Number(nftData?.tickLower);
            tickUpper = Number(nftData?.tickUpper);
            liquidity = BigInt(nftData?.liquidity || 0n);
            fees0Raw = BigInt(nftData?.tokensOwed0 || 0n);
            fees1Raw = BigInt(nftData?.tokensOwed1 || 0n);
          } catch {
            // keep defaults
          }
        }

        let currentTick = null;
        if (pool && !isZeroAddress(pool)) {
          try {
            const poolContract = new Contract(pool, POOL_SLOT0_ABI, readProvider);
            const slot0 = await poolContract.slot0();
            currentTick = Number(slot0?.tick);
          } catch {
            currentTick = null;
          }
        }

        const minPrice = Number.isFinite(tickLower) ? tickToPrice(tickLower) : null;
        const maxPrice = Number.isFinite(tickUpper) ? tickToPrice(tickUpper) : null;
        const marketPrice = Number.isFinite(currentTick) ? tickToPrice(currentTick) : null;

        const inRange =
          Number.isFinite(currentTick) && Number.isFinite(tickLower) && Number.isFinite(tickUpper)
            ? currentTick >= tickLower && currentTick <= tickUpper
            : null;

        const dust0Amount = parseTokenAmount(dust0Raw, token0Meta.decimals);
        const dust1Amount = parseTokenAmount(dust1Raw, token1Meta.decimals);
        const fees0Amount = parseTokenAmount(fees0Raw, token0Meta.decimals);
        const fees1Amount = parseTokenAmount(fees1Raw, token1Meta.decimals);
        const price = Number.isFinite(marketPrice) ? marketPrice : 0;
        const token0Value = dust0Amount * price;
        const token1Value = dust1Amount;
        const fee0Value = fees0Amount * price;
        const fee1Value = fees1Amount;
        const positionValueToken1 = token0Value + token1Value;
        const feesValueToken1 = fee0Value + fee1Value;
        const valueDenominator = positionValueToken1 > 0 ? positionValueToken1 : 1;
        const feesDenominator = feesValueToken1 > 0 ? feesValueToken1 : 1;
        const token0ValuePct = (token0Value / valueDenominator) * 100;
        const token1ValuePct = (token1Value / valueDenominator) * 100;
        const fee0ValuePct = (fee0Value / feesDenominator) * 100;
        const fee1ValuePct = (fee1Value / feesDenominator) * 100;

        const chartSeries = buildSeries(positionId, marketPrice || minPrice || maxPrice || 1);

        setDetail({
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
          active,
          tickLower,
          tickUpper,
          currentTick,
          minPrice,
          maxPrice,
          marketPrice,
          inRange,
          liquidity,
          dust0Raw: BigInt(dust0Raw || 0n),
          dust1Raw: BigInt(dust1Raw || 0n),
          fees0Raw,
          fees1Raw,
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
        setDetailError(String(error?.message || "Unable to load this position."));
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
    return `${formatNumber(detail.positionValueToken1, 4)} ${detail.token1Symbol}`;
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
              <h1 className="mt-1 font-display text-2xl font-semibold text-slate-100">Positions Explorer</h1>
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
                placeholder="Search position ID (example: 235)"
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
              <div className="text-xs text-slate-500">Your ALM positions</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {positionIdsLoading && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading
                  </span>
                )}
                {!positionIdsLoading && positionIds.length === 0 && (
                  <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
                    No positions found
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
            Enter a position ID to open a detailed, chart-based view.
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

        {!detailLoading && !detailError && detail.positionId && (
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
                <span>Position #{detail.positionId}</span>
                <span>Strategy #{detail.strategyId}</span>
                <span>{detail.active ? "Active" : "Inactive"}</span>
                <a
                  href={`${EXPLORER_BASE_URL}/address/${detail.pool}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sky-200 underline decoration-dotted underline-offset-2"
                >
                  Pool <ExternalLink className="h-3 w-3" />
                </a>
                <a
                  href={`${EXPLORER_BASE_URL}/address/${ALM_ADDRESSES.ALM}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sky-200 underline decoration-dotted underline-offset-2"
                >
                  ALM <ExternalLink className="h-3 w-3" />
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
                    <div className="h-full bg-emerald-400" style={{ width: `${Math.max(0, Math.min(100, detail.token0ValuePct))}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                    <span>{detail.token0Symbol}: {formatPercent(detail.token0ValuePct)}</span>
                    <span>{detail.token1Symbol}: {formatPercent(detail.token1ValuePct)}</span>
                  </div>

                  <div className="mt-4 space-y-2 text-sm text-slate-200">
                    <div className="flex items-center justify-between">
                      <span>
                        {formatNumber(parseTokenAmount(detail.dust0Raw, detail.token0Decimals), 6)} {detail.token0Symbol}
                      </span>
                      <span className="text-slate-400">dust0</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>
                        {formatNumber(parseTokenAmount(detail.dust1Raw, detail.token1Decimals), 6)} {detail.token1Symbol}
                      </span>
                      <span className="text-slate-400">dust1</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="text-sm text-slate-400">Fees earned</div>
                  <div className="mt-1 text-5xl font-semibold text-slate-100">{feesValueLabel}</div>

                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full bg-cyan-400" style={{ width: `${Math.max(0, Math.min(100, detail.fee0ValuePct))}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                    <span>{detail.token0Symbol}: {formatPercent(detail.fee0ValuePct)}</span>
                    <span>{detail.token1Symbol}: {formatPercent(detail.fee1ValuePct)}</span>
                  </div>

                  <div className="mt-4 space-y-2 text-sm text-slate-200">
                    <div className="flex items-center justify-between">
                      <span>
                        {formatNumber(parseTokenAmount(detail.fees0Raw, detail.token0Decimals), 6)} {detail.token0Symbol}
                      </span>
                      <span className="text-slate-400">fees0</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>
                        {formatNumber(parseTokenAmount(detail.fees1Raw, detail.token1Decimals), 6)} {detail.token1Symbol}
                      </span>
                      <span className="text-slate-400">fees1</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-400">
                  <div>Owner: {detail.owner || "--"}</div>
                  <div className="mt-1">Tick spacing: {detail.tickSpacing || "--"}</div>
                  <div className="mt-1">Current NFT tokenId: {detail.currentTokenId || "--"}</div>
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
