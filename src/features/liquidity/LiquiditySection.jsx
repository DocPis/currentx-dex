// src/features/liquidity/LiquiditySection.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Contract, formatUnits, parseUnits } from "ethers";
import {
  TOKENS,
  getProvider,
  getReadOnlyProvider,
  getV2PairReserves,
  WETH_ADDRESS,
  USDC_ADDRESS,
  UNIV2_ROUTER_ADDRESS,
  UNIV2_FACTORY_ADDRESS,
  getRegisteredCustomTokens,
  setRegisteredCustomTokens,
  fetchMasterChefFarms,
  EXPLORER_BASE_URL,
  NETWORK_NAME,
} from "../../shared/config/web3";
import {
  ERC20_ABI,
  UNIV2_FACTORY_ABI,
  UNIV2_PAIR_ABI,
  UNIV2_ROUTER_ABI,
} from "../../shared/config/abis";
import { fetchV2PairData, fetchTokenPrices } from "../../shared/config/subgraph";
import { getRealtimeClient } from "../../shared/services/realtime";
import { getActiveNetworkConfig } from "../../shared/config/networks";
import { useBalances } from "../../shared/hooks/useBalances";

const EXPLORER_LABEL = `${NETWORK_NAME} Explorer`;
const SYNC_TOPIC =
  "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";

const formatNumber = (v) => {
  const num = Number(v || 0);
  if (!Number.isFinite(num)) return "~$0.00";
  const val = Math.max(0, num);
  if (val >= 1_000_000_000) return `~$${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `~$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `~$${(val / 1_000).toFixed(2)}K`;
  return `~$${val.toFixed(2)}`;
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

const resolveTokenAddress = (symbol, registry = TOKENS) => {
  if (!symbol) return null;
  if (symbol === "ETH") return WETH_ADDRESS;
  const token = registry[symbol];
  return token?.address || null;
};

const getPoolLabel = (pool) =>
  pool ? `${pool.token0Symbol} / ${pool.token1Symbol}` : "";
const MIN_LP_THRESHOLD = 1e-12;

const formatUsdPrice = (v) => {
  const num = Number(v);
  if (!Number.isFinite(num) || num <= 0) return "--";
  if (num >= 1_000) return `~$${num.toFixed(0)}`;
  if (num >= 1) return `$${num.toFixed(2)}`;
  if (num >= 0.01) return `$${num.toFixed(4)}`;
  return `$${num.toFixed(6)}`;
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
  const stripped = raw
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
  const lower = raw.toLowerCase();
  if (lower.includes("missing revert data") || lower.includes("estimategas")) {
    return `${actionLabel} simulation failed. Try a smaller amount, refresh balances, or wait for liquidity.`;
  }
  if (lower.includes("user denied") || lower.includes("rejected")) {
    return `${actionLabel} was rejected in your wallet. Please approve to continue.`;
  }
  return compactRpcMessage(
    raw,
    `${actionLabel} could not be completed. Please retry.`
  );
};

const shortenAddress = (addr) => {
  if (!addr) return "Native asset";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
};

export default function LiquiditySection({ address, chainId, balances: balancesProp }) {
  const [basePools, setBasePools] = useState([]);
  const [onchainTokens, setOnchainTokens] = useState({});
  const [customTokens, setCustomTokens] = useState(() => getRegisteredCustomTokens());
  const [tokenPrices, setTokenPrices] = useState({});
  const [tvlError, setTvlError] = useState("");
  const [subgraphError, setSubgraphError] = useState("");
  const [poolStats, setPoolStats] = useState({});
  const [poolStatsReady, setPoolStatsReady] = useState(false);
  const [selectedPoolId, setSelectedPoolId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [pairInfo, setPairInfo] = useState(null);
  const [pairError, setPairError] = useState("");
  const [pairNotDeployed, setPairNotDeployed] = useState(false);
  const [depositToken0, setDepositToken0] = useState("");
  const [depositToken1, setDepositToken1] = useState("");
  const [withdrawLp, setWithdrawLp] = useState("");
  const [lpBalanceRaw, setLpBalanceRaw] = useState(null);
  const [lpDecimalsState, setLpDecimalsState] = useState(18);
  const [actionStatus, setActionStatus] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [depositQuoteError, setDepositQuoteError] = useState("");
  const [lastEdited, setLastEdited] = useState("");
  const [lpBalance, setLpBalance] = useState(null);
  const [lpBalanceError, setLpBalanceError] = useState("");
  const [lpRefreshTick, setLpRefreshTick] = useState(0);
  const [pairLiveTick, setPairLiveTick] = useState(0);
  const livePairThrottle = useRef(0);
  const [tokenBalances, setTokenBalances] = useState(null);
  const [tokenBalanceError, setTokenBalanceError] = useState("");
  const [tokenBalanceLoading, setTokenBalanceLoading] = useState(false);
  const [showTokenList, setShowTokenList] = useState(false);
  const [tokenSearch, setTokenSearch] = useState("");
  const [tokenSelection, setTokenSelection] = useState(null); // { baseSymbol, pairSymbol }
  const [pairSelectorOpen, setPairSelectorOpen] = useState(false);
  const [selectionDepositPoolId, setSelectionDepositPoolId] = useState(null);
  const [customTokenAddress, setCustomTokenAddress] = useState("");
  const [customTokenAddError, setCustomTokenAddError] = useState("");
  const [customTokenAddLoading, setCustomTokenAddLoading] = useState(false);
  const tokenRegistry = useMemo(() => {
    // Always include native ETH/WETH for convenience.
    const out = { ETH: TOKENS.ETH, WETH: TOKENS.WETH };

    // Include tokens discovered on-chain for the active network.
    Object.assign(out, onchainTokens);

    // Include any statically defined token that has an address for the active network.
    Object.entries(TOKENS).forEach(([sym, meta]) => {
      if (sym === "ETH" || sym === "WETH") return;
      if (meta?.address) out[sym] = meta;
    });

    // Include user-added custom tokens.
    Object.assign(out, customTokens);

    return out;
  }, [customTokens, onchainTokens]);
  const tokenDecimalsCache = useRef({});
  const hasExternalBalances = Boolean(balancesProp);
  const { balances: hookBalances, loading: hookBalancesLoading } = useBalances(
    address,
    chainId,
    tokenRegistry
  );
  const walletBalances = hasExternalBalances
    ? { ...hookBalances, ...balancesProp }
    : hookBalances;
  const walletBalancesLoading = hasExternalBalances ? hookBalancesLoading : hookBalancesLoading;

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
    let cancelled = false;
    const loadBasePools = async () => {
      setPoolStatsReady(false);
      try {
        const provider = getReadOnlyProvider();
        const factory = new Contract(
          UNIV2_FACTORY_ADDRESS,
          UNIV2_FACTORY_ABI,
          provider
        );
        const registryForLookup = { ...TOKENS, ...customTokens };

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
        for (let i = 0; i < total; i += 1) {
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
        }

        const seen = new Set();
        const deduped = [];
        poolsFromChain.forEach((p) => {
          if (seen.has(p.id)) return;
          seen.add(p.id);
          deduped.push(p);
        });
        setBasePools(deduped);
        setOnchainTokens(tokenMap);
      } catch {
        if (!cancelled) {
          setBasePools([]);
          setOnchainTokens({});
        }
      }
      if (!cancelled) setPoolStatsReady(true);
    };
    loadBasePools();
    return () => {
      cancelled = true;
    };
  }, [customTokens, lpRefreshTick]);

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
      try {
        const prices = await fetchTokenPrices(addrs);
        if (!cancelled) setTokenPrices(prices || {});
      } catch {
        if (!cancelled) setTokenPrices({});
      }
    };
    loadTokenPrices();
    return () => {
      cancelled = true;
    };
  }, [tokenRegistry]);

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

  useEffect(() => {
    if (showTokenList) {
      setCustomTokens(getRegisteredCustomTokens());
    }
  }, [showTokenList]);

  // Auto refresh LP/tvl every 30s
  useEffect(() => {
    const id = setInterval(() => setLpRefreshTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Load live data for all pools (subgraph + on-chain TVL fallback)
  useEffect(() => {
    let cancelled = false;
    const loadPools = async () => {
      setPoolStatsReady(false);
      const updates = {};
      setSubgraphError("");
      setTvlError("");

      // Map farm emissions by pair (normalized symbol key)
      const farmAprMap = {};
      const farmAprByLp = {};
      try {
        const farms = await fetchMasterChefFarms();
        (farms?.pools || []).forEach((farm) => {
          const lpAddr = (farm.lpToken || "").toLowerCase();
          if (lpAddr && farm.apr !== null && farm.apr !== undefined) {
            farmAprByLp[lpAddr] = farm.apr;
          }
          const symbols = (farm.tokens || [])
            .map((t) => (t?.symbol || "").toUpperCase())
            .filter(Boolean)
            .map((s) => (s === "ETH" ? "WETH" : s));
          if (symbols.length !== 2) return;
          const key = symbols.sort().join("-");
          if (farm.apr !== null && farm.apr !== undefined) {
            farmAprMap[key] = farm.apr;
          }
        });
      } catch {
        // silently ignore farm fetch errors to avoid blocking pool stats
      }

      for (const pool of trackedPools) {
        const token0Addr =
          pool.token0Address ||
          resolveTokenAddress(pool.token0Symbol, tokenRegistry);
        const token1Addr =
          pool.token1Address ||
          resolveTokenAddress(pool.token1Symbol, tokenRegistry);
        if (!token0Addr || !token1Addr) continue;
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
          const provider = await getProvider();
          const { reserve0, reserve1, token0, pairAddress } = await getV2PairReserves(
            provider,
            token0Addr,
            token1Addr,
            pairIdOverride
          );
          const token0IsA = token0.toLowerCase() === token0Addr.toLowerCase();
          const resA = token0IsA ? reserve0 : reserve1;
          const resB = token0IsA ? reserve1 : reserve0;
          const metaA = tokenRegistry[pool.token0Symbol];
          const metaB = tokenRegistry[pool.token1Symbol];
          const stableA =
            metaA?.symbol === "USDC" || metaA?.symbol === "USDm" || metaA?.symbol === "CUSD";
          const stableB =
            metaB?.symbol === "USDC" || metaB?.symbol === "USDm" || metaB?.symbol === "CUSD";
          let tvlUsd;
          let finalPairAddress = pairAddress;
          if (stableA) {
            const usd = Number(formatUnits(resA, metaA.decimals));
            tvlUsd = usd * 2;
          } else if (stableB) {
            const usd = Number(formatUnits(resB, metaB.decimals));
            tvlUsd = usd * 2;
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
      }

      if (!cancelled && Object.keys(updates).length) {
        // attach farm emission APR if available
        Object.entries(updates).forEach(([id, data]) => {
          const pool = trackedPools.find((p) => p.id === id);
          if (!pool) return;
          const normA = pool.token0Symbol === "ETH" ? "WETH" : pool.token0Symbol;
          const normB = pool.token1Symbol === "ETH" ? "WETH" : pool.token1Symbol;
          const key = [normA, normB].sort().join("-");
          const lpKey = (data?.pairAddress || data?.pairId || "").toLowerCase();
          const emissionApr =
            (lpKey && farmAprByLp[lpKey] !== undefined
              ? farmAprByLp[lpKey]
              : farmAprMap[key]);
          if (emissionApr !== undefined) {
            updates[id] = { ...data, emissionApr };
          }
        });
        setPoolStats((prev) => ({ ...prev, ...updates }));
      }
      if (!cancelled) setPoolStatsReady(true);
    };
    loadPools();
    return () => {
      cancelled = true;
    };
  }, [lpRefreshTick, subgraphError, tokenRegistry, trackedPools, tvlError]);

  useEffect(() => {
    setDepositToken0("");
    setDepositToken1("");
    setWithdrawLp("");
    setDepositQuoteError("");
    setLastEdited("");
    setActionStatus("");
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

  const filteredPools = useMemo(() => {
    if (!searchTerm) return pools;
    const q = searchTerm.toLowerCase();
    return pools.filter((p) => {
      return (
        p.id.toLowerCase().includes(q) ||
        p.token0Symbol.toLowerCase().includes(q) ||
        p.token1Symbol.toLowerCase().includes(q)
      );
    });
  }, [pools, searchTerm]);

  const tokenEntries = useMemo(() => {
    const tvlMap = {};
    pools.forEach((p) => {
      const share = Number(p.tvlUsd || 0) / 2;
      if (share > 0) {
        tvlMap[p.token0Symbol] = (tvlMap[p.token0Symbol] || 0) + share;
        tvlMap[p.token1Symbol] = (tvlMap[p.token1Symbol] || 0) + share;
      }
    });
    const ethLikeTvl =
      (tvlMap.ETH || 0) + (tvlMap.WETH || 0);

    return Object.values(tokenRegistry).map((t) => {
      const rawBalance = walletBalances?.[t.symbol];
      const walletBalance =
        address && Number.isFinite(Number(rawBalance))
          ? Number(rawBalance)
          : address
            ? 0
            : null;

      return {
        ...t,
        tvlUsd:
          t.symbol === "ETH" || t.symbol === "WETH"
            ? ethLikeTvl
            : tvlMap[t.symbol] || 0,
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
  }, [address, pools, tokenPrices, tokenRegistry, walletBalances]);

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

  const poolsCount = pools.length;
  const tokensCount = tokenEntries.length;
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
  const poolSupportsActions = Boolean(token0Address && token1Address);
  const usesNativeEth =
    selectedPool &&
    (selectedPool.token0Symbol === "ETH" || selectedPool.token1Symbol === "ETH");
  const usesWethWithToken =
    selectedPool &&
    !usesNativeEth &&
    (selectedPool.token0Symbol === "WETH" || selectedPool.token1Symbol === "WETH");
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
  const pairBlockingError = Boolean(pairError && !pairMissing);
  const hasLpBalance = lpBalance !== null && lpBalance > MIN_LP_THRESHOLD;

  useEffect(() => {
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
        provider = getReadOnlyProvider(false, true);
      }
      const user = address || null;
      if (!user) {
        setLpBalanceError("");
        return;
      }

      const resolved =
        pairInfo ||
        (await getV2PairReserves(provider, token0Address, token1Address, pairIdOverride));

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
      // Treat any failure as "not deployed yet" to allow first deposit
      setPairNotDeployed(true);
      setLpBalanceError("");
      setLpBalance(null);
    }
  }, [
    address,
    chainId,
    pairIdOverride,
    pairInfo,
    pairMissing,
    pairBlockingError,
    poolSupportsActions,
    selectedPool,
    token0Address,
    token1Address,
  ]);

  useEffect(() => {
    fetchLpBalance();
  }, [fetchLpBalance, lpRefreshTick]);

  const totalVolume = pools.reduce((a, p) => a + Number(p.volume24hUsd || 0), 0);
  const totalFees = pools.reduce((a, p) => a + Number(p.fees24hUsd || 0), 0);
  const totalTvl = pools.reduce((a, p) => a + Number(p.tvlUsd || 0), 0);
  const autopilotPool =
    pools.find((p) => p.id === "crx-weth" && p.isActive !== false && p.hasAddresses) ||
    pools.find((p) => p.isActive && p.hasAddresses) ||
    pools.find((p) => p.hasAddresses) ||
    null;

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
        let provider;
        try {
          provider = await getProvider();
        } catch {
          provider = getReadOnlyProvider();
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
        const pairToken0Lower = pairInfo.token0.toLowerCase();
        const inputToken0Lower = (token0Address || "").toLowerCase();
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
    if (actionStatus) setActionStatus("");
    try {
      const symbol0 = token0Meta?.symbol || selectedPool?.token0Symbol;
      const symbol1 = token1Meta?.symbol || selectedPool?.token1Symbol;

      const findWalletBalance = (sym) => {
        if (!sym || !walletBalances) return undefined;
        const lower = sym.toLowerCase();
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
        (token0Address && tokenDecimalsCache.current[token0Address.toLowerCase()]) ??
        token0Meta?.decimals ??
        18;
      const dec1 =
        (token1Address && tokenDecimalsCache.current[token1Address.toLowerCase()]) ??
        token1Meta?.decimals ??
        18;

      if (hasPairInfo && Number.isFinite(dec0) && Number.isFinite(dec1)) {
        const pairToken0Lower = pairInfo.token0.toLowerCase();
        const inputToken0Lower = (token0Address || "").toLowerCase();
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
    if (actionStatus) setActionStatus("");
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
    setTokenSelection({
      baseSymbol: pool.token0Symbol,
      pairSymbol: pool.token1Symbol,
    });
    setSelectedPoolId(pool.id);
    setSelectionDepositPoolId(pool.id);
    setPairSelectorOpen(false);
    const target = document.getElementById("token-selection-deposit");
    if (target) target.scrollIntoView({ behavior: "smooth" });
  };

  const handleAddCustomToken = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    const addr = (customTokenAddress || "").trim();
    setCustomTokenAddError("");
    if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setCustomTokenAddError("Enter a valid token contract address (0x...)");
      return;
    }
    const lower = addr.toLowerCase();
    const exists = Object.values(tokenRegistry).find(
      (t) => (t.address || "").toLowerCase() === lower
    );
    if (exists) {
      setCustomTokenAddError("Token already listed.");
      return;
    }
    setCustomTokenAddLoading(true);
    try {
      const provider = await getProvider();
      const erc20 = new Contract(addr, ERC20_ABI, provider);
      const [symbolRaw, nameRaw, decimalsRaw] = await Promise.all([
        erc20.symbol().catch(() => "TOKEN"),
        erc20.name().catch(() => "Custom Token"),
        erc20.decimals().catch(() => 18),
      ]);
      const symbol = (symbolRaw || "TOKEN").toString().toUpperCase();
      const name = nameRaw || symbol;
      const decimals = Number(decimalsRaw) || 18;
      const tokenKey = symbol;
      const alreadySymbol = tokenRegistry[tokenKey];
      if (alreadySymbol) {
        setCustomTokenAddError("Symbol already in use. Try another token.");
        return;
      }
      const next = {
        ...customTokens,
        [tokenKey]: {
          symbol: tokenKey,
          name,
          address: addr,
          decimals,
          logo: TOKENS.CRX.logo,
        },
      };
      setCustomTokens(next);
      setRegisteredCustomTokens(next);
      setCustomTokenAddress("");
    } catch (err) {
      setCustomTokenAddError(
        compactRpcMessage(err?.message, "Unable to load token metadata")
      );
    } finally {
      setCustomTokenAddLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadBalances = async () => {
      setTokenBalanceLoading(true);
      setTokenBalanceError("");
      setTokenBalances(null);
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
          fetchBalance(selectedPool.token0Symbol, token0Address, token0Meta),
          fetchBalance(selectedPool.token1Symbol, token1Address, token1Meta),
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
    lpRefreshTick,
    token0Address,
    token1Address,
    selectedPool?.token0Symbol,
    selectedPool?.token1Symbol,
    token0Meta,
    token0Meta?.decimals,
    token1Meta,
    token1Meta?.decimals,
    address,
    chainId,
  ]);

  const handleDeposit = async () => {
    try {
      setActionStatus("");
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

        let provider;
        try {
          provider = await getProvider();
        } catch {
          provider = getReadOnlyProvider();
        }
        const signer = await provider.getSigner();
        const user = await signer.getAddress();

      const router = new Contract(
        UNIV2_ROUTER_ADDRESS,
        UNIV2_ROUTER_ABI,
        signer
      );

      const parsed0 = parseUnits(
        amount0.toString(),
        token0Meta?.decimals ?? 18
      );
      const parsed1 = parseUnits(
        amount1.toString(),
        token1Meta?.decimals ?? 18
      );

      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

      if (usesNativeEth) {
        const ethIsToken0 = selectedPool.token0Symbol === "ETH";
        const ethValue = ethIsToken0 ? parsed0 : parsed1;
        const tokenAmount = ethIsToken0 ? parsed1 : parsed0;
        const tokenAddress = ethIsToken0 ? token1Address : token0Address;
        const tokenContract = new Contract(tokenAddress, ERC20_ABI, signer);
        const allowance = await tokenContract.allowance(
          user,
          UNIV2_ROUTER_ADDRESS
        );
        if (allowance < tokenAmount) {
          await (
            await tokenContract.approve(UNIV2_ROUTER_ADDRESS, tokenAmount)
          ).wait();
        }

        const tx = await router.addLiquidityETH(
          tokenAddress,
          tokenAmount,
          0, // amountTokenMin
          0, // amountETHMin
          user,
          deadline,
          { value: ethValue }
        );
        const receipt = await tx.wait();
        setActionStatus({
          variant: "success",
          hash: receipt.hash,
          message: `Deposited ${getPoolLabel(selectedPool)}`,
        });
      } else if (usesWethWithToken) {
        const wethIsToken0 = selectedPool.token0Symbol === "WETH";
        const ethValue = wethIsToken0 ? parsed0 : parsed1;
        const tokenAmount = wethIsToken0 ? parsed1 : parsed0;
        const tokenAddress = wethIsToken0 ? token1Address : token0Address;

        const tokenContract = new Contract(tokenAddress, ERC20_ABI, signer);
        const allowance = await tokenContract.allowance(
          user,
          UNIV2_ROUTER_ADDRESS
        );
        if (allowance < tokenAmount) {
          await (
            await tokenContract.approve(UNIV2_ROUTER_ADDRESS, tokenAmount)
          ).wait();
        }

        const tx = await router.addLiquidityETH(
          tokenAddress,
          tokenAmount,
          0, // amountTokenMin
          0, // amountETHMin
          user,
          deadline,
          { value: ethValue }
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

        const allowance0 = await token0Contract.allowance(
          user,
          UNIV2_ROUTER_ADDRESS
        );
        if (allowance0 < parsed0) {
          await (
            await token0Contract.approve(UNIV2_ROUTER_ADDRESS, parsed0)
          ).wait();
        }

        const allowance1 = await token1Contract.allowance(
          user,
          UNIV2_ROUTER_ADDRESS
        );
        if (allowance1 < parsed1) {
          await (
            await token1Contract.approve(UNIV2_ROUTER_ADDRESS, parsed1)
          ).wait();
        }

        const tx = await router.addLiquidity(
          token0Address,
          token1Address,
          parsed0,
          parsed1,
          0, // amountAMin
          0, // amountBMin
          user,
          deadline
        );
        const receipt = await tx.wait();
        setActionStatus({
          variant: "success",
          hash: receipt.hash,
          message: `Deposited ${getPoolLabel(selectedPool)}`,
        });
      }

      setLpRefreshTick((t) => t + 1);
    } catch (e) {
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
    try {
      setActionStatus("");
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

      const provider = await getProvider();
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
      const lpAllowance = await pairErc20.allowance(
        user,
        UNIV2_ROUTER_ADDRESS
      );
      if (lpAllowance < lpValue) {
        await (
          await pairErc20.approve(UNIV2_ROUTER_ADDRESS, lpValue)
        ).wait();
      }

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
        tx = await router.removeLiquidityETH(
          tokenAddress,
          lpValue,
          0, // amountTokenMin
          0, // amountETHMin
          user,
          deadline
        );
      } else {
        tx = await router.removeLiquidity(
          token0Address,
          token1Address,
          lpValue,
          0, // amountAMin
          0, // amountBMin
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
    } catch (e) {
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
      {/* hero / stats */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        <div className="xl:col-span-2 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-900/60 border border-slate-800/80 shadow-2xl shadow-black/40 overflow-hidden">
          <div className="flex flex-col items-center justify-center gap-6 p-8 text-center">
            <div className="flex flex-col items-center gap-3 max-w-3xl">
              <p className="text-base sm:text-lg text-slate-200">
                Provide liquidity to enable low-slippage swaps and earn emissions.
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <span className="text-xs px-2 py-1 rounded-full bg-slate-800/70 border border-slate-700 text-slate-200">
                  Live data
                </span>
                <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                  MegaETH
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 w-full max-w-4xl text-center">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                  Volume 24h
                </div>
                <div className="text-xl font-semibold">
                  {formatNumber(totalVolume)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                  Fees 24h
                </div>
                <div className="text-xl font-semibold">
                  {formatNumber(totalFees)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                  TVL
                </div>
                <div className="text-xl font-semibold">
                  {formatNumber(totalTvl)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl bg-gradient-to-br from-indigo-700 via-sky-600 to-cyan-400 border border-white/10 shadow-2xl shadow-indigo-900/40 p-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.12),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(255,255,255,0.18),transparent_40%)]" />
          <div className="relative h-full flex flex-col justify-between">
            <div className="text-xs font-semibold tracking-[0.2em] text-white/80 mb-3">
              CURRENTX LIQUIDITY
            </div>
            <div className="text-3xl font-bold leading-tight mb-2 drop-shadow">
              Quickstart CRX/WETH
            </div>
            <p className="text-sm text-white/80 mb-4 max-w-sm">
              Fast-track into the CRX/WETH (V2) pool with a single click so you can provide liquidity immediately.
            </p>
            <button
              type="button"
              disabled={!autopilotPool}
              onClick={() => autopilotPool && handleOpenPoolDepositFromRow(autopilotPool)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/15 text-sm font-semibold text-white border border-white/30 w-fit shadow-lg shadow-black/30 disabled:opacity-60"
            >
              Start quick deposit
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
            </button>
          </div>
        </div>
      </div>

      {/* dedicated token deposit flow */}
      {tokenSelection ? (
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
                      value={depositToken0}
                      onChange={(e) => {
                        setLastEdited(token0Meta?.symbol || selectedPool?.token0Symbol);
                        setDepositToken0(e.target.value);
                        if (actionStatus) setActionStatus("");
                      }}
                      placeholder={`${token0Meta?.symbol || "Token A"} amount`}
                      className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100"
                    />
                    <input
                      value={depositToken1}
                      onChange={(e) => {
                        setLastEdited(token1Meta?.symbol || selectedPool?.token1Symbol);
                        setDepositToken1(e.target.value);
                        if (actionStatus) setActionStatus("");
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
                    </div>
                  </div>
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input
                      value={withdrawLp}
                      onChange={(e) => {
                        setWithdrawLp(e.target.value);
                        if (actionStatus) setActionStatus("");
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
                  {actionStatus && (
                    <div
                      className={`px-2 py-1.5 rounded border bg-transparent ${
                        actionStatus.variant === "success"
                          ? "border-slate-700/60 text-slate-200"
                          : "border-rose-500/30 text-rose-200"
                      }`}
                    >
                      <div>{actionStatus.message}</div>
                      {actionStatus.hash && (
                        <a
                          href={`${EXPLORER_BASE_URL}/tx/${actionStatus.hash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-400 hover:text-sky-300 underline"
                        >
                          View on {EXPLORER_LABEL}
                        </a>
                      )}
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
        <div className="bg-[#050816] border border-slate-800/80 rounded-3xl shadow-xl shadow-black/40 mb-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 px-4 sm:px-6 py-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-slate-200">
                Pools ({poolsCount})
              </span>
              <button
                type="button"
                onClick={() => setShowTokenList(true)}
                className="px-3 py-1.5 rounded-full bg-slate-900/70 border border-slate-800 text-slate-300 hover:border-sky-600/60 hover:text-slate-100"
              >
                Tokens ({tokensCount})
              </button>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
              <div className="flex items-center gap-2 bg-slate-900/70 border border-slate-800 rounded-full px-3 py-2 text-xs text-slate-300 w-full lg:w-72">
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
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search pools..."
                  className="bg-transparent outline-none flex-1 text-slate-200 placeholder:text-slate-600 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setTokenSelection((prev) => prev || { baseSymbol: null, pairSymbol: null });
                  setShowTokenList(true);
                }}
                className="hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-full bg-sky-600 text-sm font-semibold text-white shadow-lg shadow-sky-500/30"
              >
                Launch pool
              </button>
            </div>
          </div>
        <div className="hidden md:block px-4 sm:px-6 pb-2 text-[11px] sm:text-xs text-slate-500 border-t border-slate-800/70">
          <div className="grid grid-cols-12 py-2">
            <div className="col-span-4">Pools</div>
            <div className="col-span-2 text-right">Volume</div>
            <div className="col-span-2 text-right">Fees</div>
            <div className="col-span-2 text-right">TVL</div>
            <div className="col-span-1 text-right">Emission APR</div>
            <div className="col-span-1 text-right">Action</div>
          </div>
        </div>

        <div className="px-2 sm:px-4 pb-3">
          {filteredPools.map((p) => {
            const token0 = tokenRegistry[p.token0Symbol];
            const token1 = tokenRegistry[p.token1Symbol];
            const isSelected = selectedPoolId === p.id;
            const rowSupports =
              p.hasAddresses ??
              (resolveTokenAddress(p.token0Symbol, tokenRegistry) &&
                resolveTokenAddress(p.token1Symbol, tokenRegistry));

            return (
              <button
                type="button"
                key={p.id}
                onClick={() => setSelectedPoolId(p.id)}
                className={`w-full text-left flex flex-col gap-3 md:grid md:grid-cols-12 md:items-center px-2 sm:px-4 py-3 rounded-2xl transition border ${
                  isSelected
                    ? "bg-slate-900/90 border-sky-700/60 shadow-[0_10px_30px_-18px_rgba(56,189,248,0.6)]"
                    : "border-transparent hover:border-slate-800 hover:bg-slate-900/70"
                }`}
              >
                <div className="md:col-span-4 flex items-center gap-3">
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
                  <div className="flex flex-col">
                    <div className="text-sm font-semibold">
                      {p.token0Symbol} / {p.token1Symbol}
                    </div>
                    <div className="text-[11px] text-slate-500 capitalize flex items-center gap-2">
                      {p.poolType || "volatile"} pool
                      {(() => {
                        const { label, className } = getStatusStyle(p.isActive);
                        return (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] border ${className}`}>
                            {label}
                          </span>
                        );
                      })()}
                      {!rowSupports && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-200 border border-amber-500/30">
                          Data only
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 w-full text-xs text-slate-400 md:hidden">
                  <div className="flex justify-between w-full">
                    <span>Status</span>
                    <span
                      className={`text-slate-100 ${
                        p.isActive === null
                          ? "text-slate-300"
                          : p.isActive
                            ? "text-emerald-300"
                            : "text-rose-300"
                      }`}
                    >
                      {p.isActive === null
                        ? "Loading"
                        : p.isActive
                          ? "Active"
                          : "Inactive"}
                    </span>
                  </div>
                  <div className="flex justify-between w-full">
                    <span>Volume</span>
                    <span className="text-slate-100">
                      {formatNumber(p.volume24hUsd)}
                    </span>
                  </div>
                  <div className="flex justify-between w-full">
                    <span>Fees</span>
                    <span className="text-slate-100">
                      {formatNumber(p.fees24hUsd)}
                    </span>
                  </div>
                  <div className="flex justify-between w-full">
                    <span>TVL</span>
                    <span className="text-slate-100">
                      {formatNumber(p.tvlUsd)}
                    </span>
                  </div>
                  <div className="flex justify-between w-full">
                    <span>Emission APR</span>
                    <span className="text-slate-100">
                      {p.emissionApr !== undefined
                        ? `${p.emissionApr.toFixed(2)}%`
                        : p.feeApr
                          ? `${p.feeApr.toFixed(2)}%`
                          : "N/A"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="mt-1 px-3 py-1.5 rounded-full bg-sky-600 text-white text-xs font-semibold shadow-lg shadow-sky-500/30"
                    onClick={() => handleOpenPoolDepositFromRow(p)}
                  >
                    Deposit / Withdraw
                  </button>
                </div>

                <div className="hidden md:block md:col-span-2 text-right text-xs sm:text-sm">
                  {formatNumber(p.volume24hUsd)}
                </div>
                <div className="hidden md:block md:col-span-2 text-right text-xs sm:text-sm">
                  {formatNumber(p.fees24hUsd)}
                </div>
                <div className="hidden md:block md:col-span-2 text-right text-xs sm:text-sm">
                  {formatNumber(p.tvlUsd)}
                </div>
                <div className="hidden md:block md:col-span-1 text-right text-xs sm:text-sm">
                  {p.emissionApr !== undefined
                    ? `${p.emissionApr.toFixed(2)}%`
                    : p.feeApr
                      ? `${p.feeApr.toFixed(2)}%`
                      : "N/A"}
                </div>
                <div className="hidden md:block md:col-span-1 text-right text-xs sm:text-sm">
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-full bg-sky-600 text-white text-xs font-semibold shadow-lg shadow-sky-500/30"
                    onClick={() => handleOpenPoolDepositFromRow(p)}
                  >
                    Deposit
                  </button>
                </div>
              </button>
            );
          })}
        </div>

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

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-5 py-3 border-b border-slate-800">
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-full px-3 py-2 text-xs text-slate-300 w-full md:w-80">
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
                  value={tokenSearch}
                  onChange={(e) => setTokenSearch(e.target.value)}
                  placeholder="Symbol or address..."
                  className="bg-transparent outline-none flex-1 text-slate-200 placeholder:text-slate-600 text-sm"
                />
              </div>
              <form
                onSubmit={handleAddCustomToken}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto"
              >
                <input
                  value={customTokenAddress}
                  onChange={(e) => {
                    setCustomTokenAddress(e.target.value);
                    if (customTokenAddError) setCustomTokenAddError("");
                  }}
                  placeholder="Add custom token (contract address)"
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-full px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600"
                />
                <button
                  type="submit"
                  disabled={customTokenAddLoading}
                  className="px-4 py-2 rounded-full bg-emerald-600 text-xs font-semibold text-white shadow-lg shadow-emerald-500/30 disabled:opacity-60"
                >
                  {customTokenAddLoading ? "Adding..." : "Add token"}
                </button>
              </form>
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
              {!filteredTokens.length && (
                <div className="px-5 py-6 text-sm text-slate-400">
                  No tokens match this search.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
