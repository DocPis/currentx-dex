// src/components/LiquiditySection.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Contract, formatUnits, parseUnits } from "ethers";
import {
  TOKENS,
  getProvider,
  getV2PairReserves,
  WETH_ADDRESS,
  USDC_ADDRESS,
  ERC20_ABI,
  UNIV2_ROUTER_ABI,
  UNIV2_ROUTER_ADDRESS,
} from "../config/web3";
import { fetchV2PairData } from "../config/subgraph";

const basePools = [
  {
    id: "crx-weth",
    token0Symbol: "CRX",
    token1Symbol: "WETH",
    poolType: "volatile",
  },
  {
    id: "weth-usdc",
    token0Symbol: "WETH",
    token1Symbol: "USDC",
    poolType: "volatile",
  },
  {
    id: "weth-dai",
    token0Symbol: "WETH",
    token1Symbol: "DAI",
    poolType: "volatile",
  },
  {
    id: "weth-usdt",
    token0Symbol: "WETH",
    token1Symbol: "USDT",
    poolType: "volatile",
  },
  {
    id: "wbtc-usdc",
    token0Symbol: "WBTC",
    token1Symbol: "USDC",
    poolType: "volatile",
  },
  {
    id: "dai-usdc",
    token0Symbol: "DAI",
    token1Symbol: "USDC",
    poolType: "stable",
  },
  {
    id: "usdt-usdc",
    token0Symbol: "USDT",
    token1Symbol: "USDC",
    poolType: "stable",
  },
  {
    id: "eth-usdc",
    token0Symbol: "ETH",
    token1Symbol: "USDC",
    poolType: "volatile",
  },
];

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
  if (!Number.isFinite(num)) return "--";
  if (Math.abs(num) >= 1_000_000) {
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (Math.abs(num) >= 1) {
    return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return num.toFixed(6);
};

const resolveTokenAddress = (symbol) => {
  if (!symbol) return null;
  if (symbol === "ETH") return WETH_ADDRESS;
  const token = TOKENS[symbol];
  return token?.address || null;
};

const getPoolLabel = (pool) =>
  pool ? `${pool.token0Symbol} / ${pool.token1Symbol}` : "";

const shortenAddress = (addr) => {
  if (!addr) return "Native asset";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
};

export default function LiquiditySection() {
  const [tvlError, setTvlError] = useState("");
  const [subgraphError, setSubgraphError] = useState("");
  const [poolStats, setPoolStats] = useState({});
  const [selectedPoolId, setSelectedPoolId] = useState(basePools[0].id);
  const [searchTerm, setSearchTerm] = useState("");
  const [pairInfo, setPairInfo] = useState(null);
  const [pairError, setPairError] = useState("");
  const [depositToken0, setDepositToken0] = useState("");
  const [depositToken1, setDepositToken1] = useState("");
  const [withdrawLp, setWithdrawLp] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [depositQuoteError, setDepositQuoteError] = useState("");
  const [lastEdited, setLastEdited] = useState("");
  const [lpBalance, setLpBalance] = useState(null);
  const [lpBalanceError, setLpBalanceError] = useState("");
  const [lpRefreshTick, setLpRefreshTick] = useState(0);
  const [tokenBalances, setTokenBalances] = useState(null);
  const [tokenBalanceError, setTokenBalanceError] = useState("");
  const [tokenBalanceLoading, setTokenBalanceLoading] = useState(false);
  const [showTokenList, setShowTokenList] = useState(false);
  const [tokenSearch, setTokenSearch] = useState("");

  // Auto refresh LP/tvl every 30s
  useEffect(() => {
    const id = setInterval(() => setLpRefreshTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Load live data for all pools (subgraph + on-chain TVL fallback)
  useEffect(() => {
    let cancelled = false;
    const loadPools = async () => {
      const updates = {};
      setSubgraphError("");
      setTvlError("");
      for (const pool of basePools) {
        const token0Addr = resolveTokenAddress(pool.token0Symbol);
        const token1Addr = resolveTokenAddress(pool.token1Symbol);
        if (!token0Addr || !token1Addr) continue;

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
        try {
          const provider = await getProvider();
          const pairIdOverride = updates[pool.id]?.pairId;
          const { reserve0, reserve1, token0 } = await getV2PairReserves(
            provider,
            token0Addr,
            token1Addr,
            pairIdOverride
          );
          const token0IsA = token0.toLowerCase() === token0Addr.toLowerCase();
          const resA = token0IsA ? reserve0 : reserve1;
          const resB = token0IsA ? reserve1 : reserve0;
          const metaA = TOKENS[pool.token0Symbol];
          const metaB = TOKENS[pool.token1Symbol];
          const stableA =
            metaA?.symbol === "USDC" ||
            metaA?.symbol === "USDT" ||
            metaA?.symbol === "DAI";
          const stableB =
            metaB?.symbol === "USDC" ||
            metaB?.symbol === "USDT" ||
            metaB?.symbol === "DAI";
          let tvlUsd;
          if (stableA) {
            const usd = Number(formatUnits(resA, metaA.decimals));
            tvlUsd = usd * 2;
          } else if (stableB) {
            const usd = Number(formatUnits(resB, metaB.decimals));
            tvlUsd = usd * 2;
          }
          if (!cancelled && tvlUsd !== undefined) {
            updates[pool.id] = {
              ...updates[pool.id],
              tvlUsd: updates[pool.id]?.tvlUsd ?? tvlUsd,
            };
          }
        } catch (chainErr) {
          // ignore per-pool chain errors to avoid breaking the whole list
          const msg = chainErr?.message || "Failed to load TVL";
          const pairMissing =
            msg.toLowerCase().includes("pair not found on sepolia") &&
            Boolean(pairIdOverride);
          if (!cancelled && !tvlError && !pairMissing) {
            setTvlError(msg);
          }
        }
      }

      if (!cancelled && Object.keys(updates).length) {
        setPoolStats((prev) => ({ ...prev, ...updates }));
      }
    };
    loadPools();
    return () => {
      cancelled = true;
    };
  }, [lpRefreshTick]);

  useEffect(() => {
    setDepositToken0("");
    setDepositToken1("");
    setWithdrawLp("");
    setDepositQuoteError("");
    setLastEdited("");
    setActionStatus("");
    setPairError("");
    setPairInfo(null);
    setLpBalance(null);
    setLpBalanceError("");
    setTokenBalances(null);
    setTokenBalanceError("");
  }, [selectedPoolId]);

  const pools = useMemo(() => {
    return basePools.map((p) => ({
      ...p,
      ...(poolStats[p.id] || {}),
    }));
  }, [poolStats]);

  const selectedPool = useMemo(() => {
    const found = pools.find((p) => p.id === selectedPoolId);
    return found || pools[0];
  }, [pools, selectedPoolId]);

  const token0Meta = selectedPool ? TOKENS[selectedPool.token0Symbol] : null;
  const token1Meta = selectedPool ? TOKENS[selectedPool.token1Symbol] : null;
  const token0Address = resolveTokenAddress(selectedPool?.token0Symbol);
  const token1Address = resolveTokenAddress(selectedPool?.token1Symbol);
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

    return Object.values(TOKENS).map((t) => ({
      ...t,
      tvlUsd: tvlMap[t.symbol] || 0,
    }));
  }, [pools]);

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

  const totalVolume = pools.reduce((a, p) => a + Number(p.volume24hUsd || 0), 0);
  const totalFees = pools.reduce((a, p) => a + Number(p.fees24hUsd || 0), 0);
  const totalTvl = pools.reduce((a, p) => a + Number(p.tvlUsd || 0), 0);

  useEffect(() => {
    let cancelled = false;
    const loadPair = async () => {
      setPairInfo(null);
      setPairError("");

      if (!selectedPool) return;
      if (!poolSupportsActions) {
        setPairError(
          "Pool not configured on-chain (missing token address)."
        );
        return;
      }

      try {
        const provider = await getProvider();
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

        try {
          const signer = await provider.getSigner();
          const user = await signer.getAddress();
          const pairErc20 = new Contract(res.pairAddress, ERC20_ABI, signer);
          const decimals = await pairErc20.decimals();
          const balance = await pairErc20.balanceOf(user);
          if (!cancelled) setLpBalance(Number(formatUnits(balance, decimals)));
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
          const message = err?.message || "Failed to load pool data";
          const pairMissing = message.toLowerCase().includes("pair not found on sepolia");
          if (pairMissing && pairIdOverride) {
            setPairError("");
          } else if (pairMissing) {
            setPairError("Pair not found on Sepolia for this token combination.");
          } else {
            setPairError(message);
          }
          setLpBalanceError(err.message || "Failed to load LP balance");
        }
      }
    };

    loadPair();
    return () => {
      cancelled = true;
    };
  }, [
    selectedPoolId,
    poolSupportsActions,
    token0Address,
    token1Address,
    lpRefreshTick,
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
          setDepositQuoteError(err.message || "Quote balance failed");
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
  ]);

  const applyDepositRatio = (percentage) => {
    if (!hasPairInfo || !tokenBalances) return;
    try {
      const decimals0 = token0Meta?.decimals ?? 18;
      const decimals1 = token1Meta?.decimals ?? 18;
      const pairToken0Lower = pairInfo.token0.toLowerCase();
      const inputToken0Lower = (token0Address || "").toLowerCase();
      const reserveForToken0 =
        pairToken0Lower === inputToken0Lower ? pairInfo.reserve0 : pairInfo.reserve1;
      const reserveForToken1 =
        pairToken0Lower === inputToken0Lower ? pairInfo.reserve1 : pairInfo.reserve0;

      const reserve0Float = Number(formatUnits(reserveForToken0, decimals0));
      const reserve1Float = Number(formatUnits(reserveForToken1, decimals1));
      if (reserve0Float === 0 || reserve1Float === 0) return;

      const priceToken1Per0 = reserve1Float / reserve0Float;
      if (!Number.isFinite(priceToken1Per0) || priceToken1Per0 <= 0) return;

      const available0 = Number(tokenBalances.token0 || 0) * percentage;
      const available1 = Number(tokenBalances.token1 || 0) * percentage;
      const required1ForAvail0 = available0 * priceToken1Per0;

      let next0 = 0;
      let next1 = 0;
      if (available0 > 0 && required1ForAvail0 <= available1) {
        next0 = available0;
        next1 = required1ForAvail0;
      } else if (available1 > 0) {
        next1 = available1;
        next0 = next1 / priceToken1Per0;
      } else {
        return;
      }

      if (next0 <= 0 || next1 <= 0) return;

      setLastEdited(token0Meta?.symbol || selectedPool?.token0Symbol);
      setDepositToken0(next0.toFixed(4));
      setDepositToken1(next1.toFixed(4));
    } catch (err) {
      setDepositQuoteError(err.message || "Quote balance failed");
    }
  };

  const applyWithdrawRatio = (percentage) => {
    const base = lpBalance ?? 0;
    if (base <= 0) return;
    const target = base * percentage;
    setWithdrawLp(target.toFixed(4));
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
        const provider = await getProvider();
        const signer = await provider.getSigner();
        const user = await signer.getAddress();

        const fetchBalance = async (symbol, address, meta) => {
          if (symbol === "ETH") {
            const bal = await provider.getBalance(user);
            return Number(formatUnits(bal, 18));
          }
          const erc20 = new Contract(address, ERC20_ABI, provider);
          const decimals = meta?.decimals ?? (await erc20.decimals());
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
          setTokenBalanceError(err.message || "Failed to load token balances");
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
    selectedPoolId,
    lpRefreshTick,
    token0Address,
    token1Address,
    selectedPool?.token0Symbol,
    selectedPool?.token1Symbol,
    token0Meta?.decimals,
    token1Meta?.decimals,
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

      const provider = await getProvider();
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
          : e.message || "Deposit failed",
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
      const lpDecimals = await pairErc20.decimals();
      const lpValue = parseUnits(lpAmount.toString(), lpDecimals);

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
          : e.message || "Withdraw failed",
      });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-10 pb-12 text-slate-100 mt-8">
      {/* hero / stats */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        <div className="xl:col-span-2 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-900/60 border border-slate-800/80 shadow-2xl shadow-black/40 overflow-hidden">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 p-6">
            <div className="flex items-start gap-3">
              <div className="h-11 w-11 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-300">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                >
                  <path
                    d="M5 6h14M5 12h14M5 18h14"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm text-slate-300/90">
                  Provide liquidity to enable low-slippage swaps and earn
                  emissions.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs px-2 py-1 rounded-full bg-slate-800/70 border border-slate-700 text-slate-200">
                    Live data
                  </span>
                  <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                    Sepolia V2
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 min-w-[280px] text-right">
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
              Autopilot Mode
            </div>
            <p className="text-sm text-white/80 mb-4 max-w-sm">
              Deploy liquidity with a balanced ETH/USDC mix and track live TVL
              from the subgraph.
            </p>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/15 text-sm font-semibold text-white border border-white/30 w-fit shadow-lg shadow-black/30">
              Start providing
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
            </div>
          </div>
        </div>
      </div>

      {/* controls */}
      <div className="bg-[#050816] border border-slate-800/80 rounded-3xl shadow-xl shadow-black/40 mb-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 px-4 sm:px-6 py-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-slate-200">
              Pools
            </span>
            <button
              type="button"
              onClick={() => setShowTokenList(true)}
              className="px-3 py-1.5 rounded-full bg-slate-900/70 border border-slate-800 text-slate-300 hover:border-sky-600/60 hover:text-slate-100"
            >
              Tokens
            </button>
            <span className="hidden sm:inline text-slate-500 text-xs">
              Sorted by TVL | Live (subgraph + on-chain fallback)
            </span>
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
            <button className="hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-full bg-sky-600 text-sm font-semibold text-white shadow-lg shadow-sky-500/30">
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
            <div className="col-span-1 text-right">Fee APR</div>
            <div className="col-span-1 text-right">Emission APR</div>
          </div>
        </div>

        <div className="px-2 sm:px-4 pb-3">
          {filteredPools.map((p) => {
            const token0 = TOKENS[p.token0Symbol];
            const token1 = TOKENS[p.token1Symbol];
            const isSelected = selectedPoolId === p.id;
            const rowSupports =
              resolveTokenAddress(p.token0Symbol) &&
              resolveTokenAddress(p.token1Symbol);

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
                      {isSelected && (
                        <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-200 border border-sky-500/30">
                          Active
                        </span>
                      )}
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
                    <span>Fee APR</span>
                    <span className="text-slate-100">
                      {p.feeApr ? `${p.feeApr.toFixed(2)}%` : "N/A"}
                    </span>
                  </div>
                  <div className="flex justify-between w-full">
                    <span>Emission APR</span>
                    <span className="text-slate-100">
                      {p.emissionApr !== undefined
                        ? `${p.emissionApr.toFixed(2)}%`
                        : "N/A"}
                    </span>
                  </div>
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
                  {p.feeApr ? `${p.feeApr.toFixed(2)}%` : "N/A"}
                </div>
                <div className="hidden md:block md:col-span-1 text-right text-xs sm:text-sm">
                  {p.emissionApr !== undefined
                    ? `${p.emissionApr.toFixed(2)}%`
                    : "N/A"}
                </div>
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="px-4 pb-4 border-t border-slate-800/70 pt-4 bg-slate-900/40 rounded-b-3xl">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Active pool
              </div>
              <div className="text-sm font-semibold text-slate-100">
                {getPoolLabel(selectedPool)}
              </div>
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
                href={`https://sepolia.etherscan.io/address/${pairInfo.pairAddress}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-sky-400 hover:text-sky-300 underline"
              >
                View pair on SepoliaScan
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
          {tokenBalanceError && (
            <div className="text-[11px] text-amber-200 mb-3">
              Token balances: {tokenBalanceError}
            </div>
          )}
          <div className="flex flex-col lg:flex-row lg:items-center gap-4">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                value={depositToken0}
                onChange={(e) => {
                  setLastEdited(token0Meta?.symbol || selectedPool?.token0Symbol);
                  setDepositToken0(e.target.value);
                }}
                placeholder={`${token0Meta?.symbol || "Token A"} amount`}
                className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100"
              />
              <input
                value={depositToken1}
                onChange={(e) => {
                  setLastEdited(token1Meta?.symbol || selectedPool?.token1Symbol);
                  setDepositToken1(e.target.value);
                }}
                placeholder={`${token1Meta?.symbol || "Token B"} amount`}
                className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100"
              />
              <button
                disabled={actionLoading || !poolSupportsActions || !!pairError}
                onClick={handleDeposit}
                className="px-4 py-2.5 rounded-xl bg-sky-600 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 disabled:opacity-60 w-full md:w-auto"
              >
                {actionLoading
                  ? "Processing..."
                  : `Deposit ${getPoolLabel(selectedPool)}`}
              </button>
              <div className="md:col-span-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>Ratio quick-fill:</span>
                <button
                  type="button"
                  disabled={!hasPairInfo || !tokenBalances}
                  onClick={() => applyDepositRatio(0.25)}
                  className="px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900 text-slate-100 disabled:opacity-50"
                >
                  25%
                </button>
                <button
                  type="button"
                  disabled={!hasPairInfo || !tokenBalances}
                  onClick={() => applyDepositRatio(0.5)}
                  className="px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900 text-slate-100 disabled:opacity-50"
                >
                  50%
                </button>
                <button
                  type="button"
                  disabled={!hasPairInfo || !tokenBalances}
                  onClick={() => applyDepositRatio(0.75)}
                  className="px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900 text-slate-100 disabled:opacity-50"
                >
                  75%
                </button>
                <button
                  type="button"
                  disabled={!hasPairInfo || !tokenBalances}
                  onClick={() => applyDepositRatio(1)}
                  className="px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900 text-slate-100 disabled:opacity-50"
                >
                  100%
                </button>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                value={withdrawLp}
                onChange={(e) => setWithdrawLp(e.target.value)}
                placeholder="LP tokens"
                className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100"
              />
              {lpBalance !== null && (
                <div className="text-xs text-slate-400 self-center">
                  LP balance: {lpBalance.toFixed(4)}{" "}
                  <button
                    type="button"
                    className="text-sky-400 hover:text-sky-300 underline ml-1"
                    onClick={() => setLpRefreshTick((t) => t + 1)}
                  >
                    Refresh
                  </button>
                </div>
              )}
              {lpBalanceError && (
                <div className="text-xs text-rose-300 self-center">
                  {lpBalanceError}
                </div>
              )}
              <button
                disabled={actionLoading || !poolSupportsActions || !!pairError}
                onClick={handleWithdraw}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 disabled:opacity-60 w-full md:w-auto"
              >
                {actionLoading
                  ? "Processing..."
                  : `Withdraw ${getPoolLabel(selectedPool)}`}
              </button>
              <div className="md:col-span-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>Withdraw:</span>
                <button
                  type="button"
                  disabled={lpBalance === null || lpBalance <= 0}
                  onClick={() => applyWithdrawRatio(0.5)}
                  className="px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900 text-slate-100 disabled:opacity-50"
                >
                  50%
                </button>
                <button
                  type="button"
                  disabled={lpBalance === null || lpBalance <= 0}
                  onClick={() => applyWithdrawRatio(0.75)}
                  className="px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900 text-slate-100 disabled:opacity-50"
                >
                  75%
                </button>
                <button
                  type="button"
                  disabled={lpBalance === null || lpBalance <= 0}
                  onClick={() => applyWithdrawRatio(1)}
                  className="px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900 text-slate-100 disabled:opacity-50"
                >
                  100%
                </button>
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
                    href={`https://sepolia.etherscan.io/tx/${actionStatus.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-400 hover:text-sky-300 underline"
                  >
                    View on SepoliaScan
                  </a>
                )}
              </div>
            )}
            {subgraphError && (
              <div className="px-2 py-1.5 rounded border border-slate-700/60 bg-transparent text-slate-200">
                Subgraph: {subgraphError}
              </div>
            )}
            {tvlError && (
              <div className="px-2 py-1.5 rounded border border-amber-500/30 bg-transparent text-amber-200">
                On-chain TVL: {tvlError}
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
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
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500">
                <span className="px-2 py-1 rounded-full bg-slate-900 border border-slate-800">
                  Filters
                </span>
                <span className="text-slate-400">Default</span>
              </div>
            </div>

            <div className="hidden md:grid grid-cols-12 px-5 py-2 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
              <div className="col-span-5">Token</div>
              <div className="col-span-3 text-right">TVL</div>
              <div className="col-span-2 text-right">Onchain price</div>
              <div className="col-span-2 text-right">Balance</div>
            </div>

            <div className="divide-y divide-slate-800">
              {filteredTokens.map((t) => (
                <div
                  key={t.symbol}
                  className="grid grid-cols-12 items-center px-5 py-3 hover:bg-slate-900/40 transition"
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
                    --
                    <div className="text-[11px] text-slate-500">Onchain price</div>
                  </div>
                  <div className="col-span-12 md:col-span-2 text-right text-sm text-slate-100">
                    --
                    <div className="text-[11px] text-slate-500">Balance</div>
                  </div>
                </div>
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
    </>
  );
}
