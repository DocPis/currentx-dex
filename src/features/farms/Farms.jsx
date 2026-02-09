// src/features/farms/Farms.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AbiCoder, Contract, formatUnits } from "ethers";
import {
  EXPLORER_BASE_URL,
  NETWORK_NAME,
  TOKENS,
  V3_STAKER_ADDRESS,
  UNIV3_FACTORY_ADDRESS,
  UNIV3_POSITION_MANAGER_ADDRESS,
  getProvider,
  getReadOnlyProvider,
} from "../../shared/config/web3";
import {
  ERC20_ABI,
  UNIV3_FACTORY_ABI,
  UNIV3_POOL_ABI,
  UNIV3_POSITION_MANAGER_ABI,
  V3_STAKER_ABI,
} from "../../shared/config/abis";
import {
  V3_STAKER_DEPLOY_BLOCK,
  fetchV3StakerDepositsForUser,
  fetchV3StakerIncentives,
} from "../../shared/services/v3Staker";

const EXPLORER_LABEL = `${NETWORK_NAME} Explorer`;
const MAX_UINT256 = (1n << 256n) - 1n;
const INCENTIVE_KEY_TYPES = [
  "tuple(address rewardToken,address pool,uint256 startTime,uint256 endTime,address refundee)",
];

const formatNumber = (v) => {
  if (v === null || v === undefined) return "0";
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return `${n.toFixed(0)}`;
};

const formatTokenAmount = (raw, decimals = 18, digits = 6) => {
  if (raw === null || raw === undefined) return "0";
  try {
    const value = Number(formatUnits(raw, decimals));
    if (!Number.isFinite(value)) return "0";
    if (value >= 1) return value.toFixed(Math.min(6, digits));
    return value.toFixed(Math.min(8, digits + 2));
  } catch {
    return "0";
  }
};

const formatTimestamp = (ts) => {
  if (!ts) return "--";
  const date = new Date(ts * 1000);
  return date.toLocaleString();
};

const statusLabel = (now, start, end) => {
  if (now < start) return { label: "Upcoming", style: "border-sky-400/50 text-sky-200 bg-sky-500/10" };
  if (now > end) return { label: "Ended", style: "border-slate-600/50 text-slate-300 bg-slate-800/40" };
  return { label: "Active", style: "border-emerald-400/50 text-emerald-200 bg-emerald-500/10" };
};

const shorten = (addr) => (!addr ? "" : `${addr.slice(0, 6)}...${addr.slice(-4)}`);

export default function Farms({ address, onConnect }) {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 py-8 text-slate-100">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Farms</h2>
          <p className="text-sm text-slate-400">
            Stake V3 positions and earn incentives.
          </p>
        </div>
      </div>

      <V3StakerList address={address} onConnect={onConnect} />
    </div>
  );
}

function V3StakerList({ address, onConnect }) {
  const [incentives, setIncentives] = useState([]);
  const [positions, setPositions] = useState([]);
  const [depositInfo, setDepositInfo] = useState({});
  const [stakeInfo, setStakeInfo] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [action, setAction] = useState({ loading: false, key: "", error: "", hash: "" });
  const tokenMetaCache = useRef({});
  const poolMetaCache = useRef({});

  const loadTokenMeta = async (provider, addr) => {
    const lower = (addr || "").toLowerCase();
    if (!lower) return null;
    if (tokenMetaCache.current[lower]) return tokenMetaCache.current[lower];
    const known = Object.values(TOKENS).find(
      (t) => t?.address && t.address.toLowerCase() === lower
    );
    if (known) {
      tokenMetaCache.current[lower] = known;
      return known;
    }
    try {
      const erc = new Contract(addr, ERC20_ABI, provider);
      const [symbol, decimals] = await Promise.all([
        erc.symbol().catch(() => "TOKEN"),
        erc.decimals().catch(() => 18),
      ]);
      const meta = {
        symbol: String(symbol || "TOKEN"),
        name: String(symbol || "TOKEN"),
        address: addr,
        decimals: Number(decimals) || 18,
        logo: TOKENS.CRX?.logo,
      };
      tokenMetaCache.current[lower] = meta;
      return meta;
    } catch {
      return null;
    }
  };

  const loadPoolMeta = async (provider, poolAddress) => {
    const lower = (poolAddress || "").toLowerCase();
    if (!lower) return null;
    if (poolMetaCache.current[lower]) return poolMetaCache.current[lower];
    try {
      const pool = new Contract(poolAddress, UNIV3_POOL_ABI, provider);
      const [token0, token1, fee] = await Promise.all([
        pool.token0(),
        pool.token1(),
        pool.fee(),
      ]);
      const meta0 = await loadTokenMeta(provider, token0);
      const meta1 = await loadTokenMeta(provider, token1);
      const meta = {
        token0,
        token1,
        fee: Number(fee || 0),
        token0Meta: meta0,
        token1Meta: meta1,
      };
      poolMetaCache.current[lower] = meta;
      return meta;
    } catch {
      return null;
    }
  };

  const loadIncentives = async () => {
    const provider = getReadOnlyProvider(false, true);
    const raw = await fetchV3StakerIncentives(provider, {
      fromBlock: V3_STAKER_DEPLOY_BLOCK,
    });
    const enriched = [];
    for (const incentive of raw) {
      const rewardMeta = await loadTokenMeta(provider, incentive.rewardToken);
      const poolMeta = await loadPoolMeta(provider, incentive.pool);
      enriched.push({
        ...incentive,
        rewardMeta,
        poolMeta,
      });
    }
    setIncentives(enriched);
  };

  const loadPositions = async () => {
    if (!address) {
      setPositions([]);
      setDepositInfo({});
      return;
    }
    const provider = getReadOnlyProvider(false, true);
    const positionManager = new Contract(
      UNIV3_POSITION_MANAGER_ADDRESS,
      UNIV3_POSITION_MANAGER_ABI,
      provider
    );
    const factory = new Contract(UNIV3_FACTORY_ADDRESS, UNIV3_FACTORY_ABI, provider);
    const balance = await positionManager.balanceOf(address);
    const count = Number(balance || 0);
    const walletIds = [];
    for (let i = 0; i < count; i += 1) {
      try {
        const tokenId = await positionManager.tokenOfOwnerByIndex(address, i);
        if (tokenId !== undefined && tokenId !== null) walletIds.push(String(tokenId));
      } catch {
        // ignore
      }
    }
    const depositIds = await fetchV3StakerDepositsForUser(provider, address, {
      fromBlock: V3_STAKER_DEPLOY_BLOCK,
    });
    const allIds = Array.from(new Set([...walletIds, ...depositIds]));
    const staker = new Contract(V3_STAKER_ADDRESS, V3_STAKER_ABI, provider);
    const nextDeposits = {};
    const nextPositions = [];

    for (const tokenId of allIds) {
      try {
        const pos = await positionManager.positions(tokenId);
        const token0 = pos?.token0;
        const token1 = pos?.token1;
        const fee = Number(pos?.fee || 0);
        const pool = await factory.getPool(token0, token1, fee);
        const token0Meta = await loadTokenMeta(provider, token0);
        const token1Meta = await loadTokenMeta(provider, token1);
        const isWallet = walletIds.includes(tokenId);
        const ownerType = isWallet ? "wallet" : "staker";
        if (ownerType === "staker") {
          try {
            const deposit = await staker.deposits(tokenId);
            nextDeposits[tokenId] = {
              owner: deposit?.owner || "",
              numberOfStakes: Number(deposit?.numberOfStakes || 0),
              tickLower: Number(deposit?.tickLower || 0),
              tickUpper: Number(deposit?.tickUpper || 0),
            };
          } catch {
            nextDeposits[tokenId] = { owner: "", numberOfStakes: 0, tickLower: 0, tickUpper: 0 };
          }
        }
        nextPositions.push({
          tokenId,
          token0,
          token1,
          fee,
          tickLower: Number(pos?.tickLower || 0),
          tickUpper: Number(pos?.tickUpper || 0),
          liquidity: pos?.liquidity || 0n,
          pool,
          token0Meta,
          token1Meta,
          ownerType,
        });
      } catch {
        // ignore broken positions
      }
    }

    setDepositInfo(nextDeposits);
    setPositions(nextPositions);
  };

  const refreshAll = async () => {
    try {
      setLoading(true);
      setError("");
      await loadIncentives();
      await loadPositions();
    } catch (e) {
      setError(e?.message || "Unable to load incentives");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (cancelled) return;
      await refreshAll();
    };
    load();
    const id = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    const loadStakeInfo = async () => {
      if (!expanded) return;
      const incentive = incentives.find((i) => i.id === expanded);
      if (!incentive) return;
      const provider = getReadOnlyProvider(false, true);
      const staker = new Contract(V3_STAKER_ADDRESS, V3_STAKER_ABI, provider);
      const eligible = positions.filter(
        (pos) => pos.ownerType === "staker" && pos.pool?.toLowerCase() === incentive.pool.toLowerCase()
      );
      const updates = {};
      for (const pos of eligible) {
        try {
          const stake = await staker.stakes(pos.tokenId, incentive.id);
          const rewardInfo = await staker.getRewardInfo(
            {
              rewardToken: incentive.rewardToken,
              pool: incentive.pool,
              startTime: incentive.startTime,
              endTime: incentive.endTime,
              refundee: incentive.refundee,
            },
            pos.tokenId
          );
          updates[`${incentive.id}:${pos.tokenId}`] = {
            liquidity: stake?.liquidity || 0n,
            reward: rewardInfo?.reward || 0n,
          };
        } catch {
          updates[`${incentive.id}:${pos.tokenId}`] = { liquidity: 0n, reward: 0n };
        }
      }
      if (!cancelled) {
        setStakeInfo((prev) => ({ ...prev, ...updates }));
      }
    };
    loadStakeInfo();
    return () => {
      cancelled = true;
    };
  }, [expanded, incentives, positions]);

  const filteredIncentives = useMemo(() => {
    if (!search) return incentives;
    const q = search.toLowerCase();
    return incentives.filter((inc) => {
      const poolLabel = inc.poolMeta
        ? `${inc.poolMeta.token0Meta?.symbol || "Token0"} / ${
            inc.poolMeta.token1Meta?.symbol || "Token1"
          }`
        : inc.pool;
      const rewardSymbol = inc.rewardMeta?.symbol || "";
      return poolLabel.toLowerCase().includes(q) || rewardSymbol.toLowerCase().includes(q);
    });
  }, [incentives, search]);

  const now = Math.floor(Date.now() / 1000);
  const activeCount = useMemo(
    () => incentives.filter((inc) => now >= inc.startTime && now <= inc.endTime).length,
    [incentives, now]
  );

  const buildIncentiveKey = (incentive) => {
    const coder = AbiCoder.defaultAbiCoder();
    return coder.encode(INCENTIVE_KEY_TYPES, [
      {
        rewardToken: incentive.rewardToken,
        pool: incentive.pool,
        startTime: incentive.startTime,
        endTime: incentive.endTime,
        refundee: incentive.refundee,
      },
    ]);
  };

  const handleStake = async (incentive, pos) => {
    if (!address) {
      if (onConnect) onConnect();
      return;
    }
    try {
      setAction({ loading: true, key: `stake-${incentive.id}-${pos.tokenId}`, error: "", hash: "" });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const manager = new Contract(
        UNIV3_POSITION_MANAGER_ADDRESS,
        UNIV3_POSITION_MANAGER_ABI,
        signer
      );
      const data = buildIncentiveKey(incentive);
      const tx = await manager.safeTransferFrom(address, V3_STAKER_ADDRESS, pos.tokenId, data);
      const receipt = await tx.wait();
      setAction({
        loading: false,
        key: `stake-${incentive.id}-${pos.tokenId}`,
        error: "",
        hash: receipt?.hash || tx.hash,
      });
      await refreshAll();
    } catch (e) {
      setAction({
        loading: false,
        key: `stake-${incentive.id}-${pos.tokenId}`,
        error: e?.message || "Stake failed",
        hash: "",
      });
    }
  };

  const handleStakeDeposited = async (incentive, pos) => {
    if (!address) {
      if (onConnect) onConnect();
      return;
    }
    try {
      setAction({ loading: true, key: `stake-deposit-${incentive.id}-${pos.tokenId}`, error: "", hash: "" });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const staker = new Contract(V3_STAKER_ADDRESS, V3_STAKER_ABI, signer);
      const key = {
        rewardToken: incentive.rewardToken,
        pool: incentive.pool,
        startTime: incentive.startTime,
        endTime: incentive.endTime,
        refundee: incentive.refundee,
      };
      const tx = await staker.stakeToken(key, pos.tokenId);
      const receipt = await tx.wait();
      setAction({
        loading: false,
        key: `stake-deposit-${incentive.id}-${pos.tokenId}`,
        error: "",
        hash: receipt?.hash || tx.hash,
      });
      await refreshAll();
    } catch (e) {
      setAction({
        loading: false,
        key: `stake-deposit-${incentive.id}-${pos.tokenId}`,
        error: e?.message || "Stake failed",
        hash: "",
      });
    }
  };

  const handleUnstake = async (incentive, pos) => {
    try {
      setAction({ loading: true, key: `unstake-${incentive.id}-${pos.tokenId}`, error: "", hash: "" });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const staker = new Contract(V3_STAKER_ADDRESS, V3_STAKER_ABI, signer);
      const key = {
        rewardToken: incentive.rewardToken,
        pool: incentive.pool,
        startTime: incentive.startTime,
        endTime: incentive.endTime,
        refundee: incentive.refundee,
      };
      const tx = await staker.unstakeToken(key, pos.tokenId);
      const receipt = await tx.wait();
      setAction({
        loading: false,
        key: `unstake-${incentive.id}-${pos.tokenId}`,
        error: "",
        hash: receipt?.hash || tx.hash,
      });
      await refreshAll();
    } catch (e) {
      setAction({
        loading: false,
        key: `unstake-${incentive.id}-${pos.tokenId}`,
        error: e?.message || "Unstake failed",
        hash: "",
      });
    }
  };

  const handleClaim = async (incentive) => {
    try {
      setAction({ loading: true, key: `claim-${incentive.id}`, error: "", hash: "" });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const staker = new Contract(V3_STAKER_ADDRESS, V3_STAKER_ABI, signer);
      const tx = await staker.claimReward(incentive.rewardToken, address, MAX_UINT256);
      const receipt = await tx.wait();
      setAction({
        loading: false,
        key: `claim-${incentive.id}`,
        error: "",
        hash: receipt?.hash || tx.hash,
      });
      await refreshAll();
    } catch (e) {
      setAction({
        loading: false,
        key: `claim-${incentive.id}`,
        error: e?.message || "Claim failed",
        hash: "",
      });
    }
  };

  const handleWithdraw = async (pos) => {
    try {
      setAction({ loading: true, key: `withdraw-${pos.tokenId}`, error: "", hash: "" });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const staker = new Contract(V3_STAKER_ADDRESS, V3_STAKER_ABI, signer);
      const tx = await staker.withdrawToken(pos.tokenId, address, "0x");
      const receipt = await tx.wait();
      setAction({
        loading: false,
        key: `withdraw-${pos.tokenId}`,
        error: "",
        hash: receipt?.hash || tx.hash,
      });
      await refreshAll();
    } catch (e) {
      setAction({
        loading: false,
        key: `withdraw-${pos.tokenId}`,
        error: e?.message || "Withdraw failed",
        hash: "",
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-slate-900/80 border border-slate-800 shadow-lg shadow-black/30 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-sm text-slate-300">
            Incentives for V3 positions (on-chain via V3Staker)
          </div>
          <div className="text-xs text-slate-500">Live</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="text-xs text-slate-400">Incentives</div>
            <div className="text-lg font-semibold text-slate-100">
              {formatNumber(incentives.length)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-slate-400">Active</div>
            <div className="text-lg font-semibold text-slate-100">
              {formatNumber(activeCount)}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl bg-slate-950/70 border border-slate-800 shadow-lg shadow-black/30">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 px-4 py-3 border-b border-slate-800/70">
          <div className="flex items-center gap-2 text-sm text-slate-200">
            <button
              type="button"
              className="px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-xs"
            >
              Live
            </button>
          </div>
          <div className="flex-1 flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-full px-3 py-2 text-sm text-slate-200 max-w-xl">
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
              name="farm-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search incentives"
              className="bg-transparent outline-none flex-1 text-slate-100 placeholder:text-slate-600"
            />
          </div>
        </div>

        {loading && (
          <div className="p-4 space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 bg-slate-900/60 border border-slate-800 rounded-2xl animate-pulse" />
            ))}
          </div>
        )}

        {error && !loading && (
          <div className="p-4 text-sm text-amber-100 bg-amber-500/10 border border-amber-500/30 rounded-2xl">
            {error}
          </div>
        )}

        {!loading && !error && filteredIncentives.length === 0 && (
          <div className="p-4 text-sm text-slate-400">No incentives found.</div>
        )}

        {!loading && !error && filteredIncentives.length > 0 && (
          <div className="divide-y divide-slate-800/70">
            {filteredIncentives.map((inc) => {
              const poolLabel = inc.poolMeta
                ? `${inc.poolMeta.token0Meta?.symbol || "Token0"} / ${
                    inc.poolMeta.token1Meta?.symbol || "Token1"
                  }`
                : shorten(inc.pool);
              const rewardSymbol = inc.rewardMeta?.symbol || "TOKEN";
              const rewardAmount = formatTokenAmount(
                inc.reward,
                inc.rewardMeta?.decimals || 18,
                6
              );
              const status = statusLabel(now, inc.startTime, inc.endTime);
              const isOpen = expanded === inc.id;
              const eligibleWallet = positions.filter(
                (pos) => pos.ownerType === "wallet" && pos.pool?.toLowerCase() === inc.pool.toLowerCase()
              );
              const eligibleDeposits = positions.filter(
                (pos) => pos.ownerType === "staker" && pos.pool?.toLowerCase() === inc.pool.toLowerCase()
              );
              const actionKey = action.key;

              return (
                <div key={inc.id} className="px-4 py-3">
                  <div className="flex flex-col md:grid md:grid-cols-12 md:items-center gap-3">
                    <div className="col-span-5 flex items-center gap-3">
                      <div className="flex -space-x-2">
                        {[inc.poolMeta?.token0Meta, inc.poolMeta?.token1Meta].map((token, idx) => (
                          <img
                            key={`${inc.id}-${idx}`}
                            src={token?.logo || TOKENS.CRX?.logo}
                            alt={token?.symbol || "token"}
                            className="h-10 w-10 rounded-full border border-slate-800 bg-slate-900"
                          />
                        ))}
                      </div>
                      <div className="flex flex-col">
                        <div className="text-sm font-semibold text-slate-100">
                          {poolLabel}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-full border ${status.style}`}
                          >
                            {status.label}
                          </span>
                          <span className="text-slate-400">
                            Fee {inc.poolMeta?.fee ? `${(inc.poolMeta.fee / 10000).toFixed(2)}%` : "--"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-3 text-right text-sm text-slate-200">
                      {rewardAmount} {rewardSymbol}
                    </div>
                    <div className="col-span-3 text-right text-xs text-slate-400">
                      {formatTimestamp(inc.startTime)} → {formatTimestamp(inc.endTime)}
                    </div>
                    <div className="col-span-1 text-right">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : inc.id)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-full border border-sky-500/60 text-sky-100 bg-sky-500/10 hover:bg-sky-500/20 hover:border-sky-300 transition-colors shadow-sm shadow-sky-500/30"
                      >
                        {isOpen ? "Hide" : "Details"}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
                      <div className="text-sm text-slate-300">
                        Incentive ID: <span className="text-slate-100">{inc.id}</span>
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs uppercase tracking-wide text-slate-500">
                          Wallet positions (eligible)
                        </div>
                        {eligibleWallet.length ? (
                          eligibleWallet.map((pos) => (
                            <div
                              key={`wallet-${pos.tokenId}`}
                              className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2"
                            >
                              <div className="text-sm text-slate-100">
                                #{pos.tokenId} · {pos.token0Meta?.symbol || "Token0"} /{" "}
                                {pos.token1Meta?.symbol || "Token1"} · Fee{" "}
                                {(pos.fee / 10000).toFixed(2)}%
                              </div>
                              <button
                                type="button"
                                disabled={!address || action.loading}
                                onClick={() => handleStake(inc, pos)}
                                className="px-3 py-1.5 rounded-full text-xs border border-emerald-500/60 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60"
                              >
                                {action.loading && actionKey === `stake-${inc.id}-${pos.tokenId}`
                                  ? "Staking..."
                                  : "Stake"}
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="text-xs text-slate-500">No eligible wallet positions.</div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs uppercase tracking-wide text-slate-500">
                          Deposited positions
                        </div>
                        {eligibleDeposits.length ? (
                          eligibleDeposits.map((pos) => {
                            const stakeKey = `${inc.id}:${pos.tokenId}`;
                            const stake = stakeInfo[stakeKey];
                            const isStaked = stake?.liquidity && stake.liquidity > 0n;
                            const reward = stake?.reward || 0n;
                            const deposit = depositInfo[pos.tokenId];
                            const canWithdraw = !deposit?.numberOfStakes;
                            return (
                              <div
                                key={`staker-${pos.tokenId}`}
                                className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2"
                              >
                                <div className="text-sm text-slate-100">
                                  #{pos.tokenId} · {pos.token0Meta?.symbol || "Token0"} /{" "}
                                  {pos.token1Meta?.symbol || "Token1"} · Fee{" "}
                                  {(pos.fee / 10000).toFixed(2)}%
                                  <span className="ml-2 text-xs text-slate-400">
                                    {isStaked ? "Staked" : "Not staked"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="text-xs text-slate-400">
                                    Reward: {formatTokenAmount(reward, inc.rewardMeta?.decimals || 18, 6)}{" "}
                                    {inc.rewardMeta?.symbol || "TOKEN"}
                                  </div>
                                  {isStaked ? (
                                    <button
                                      type="button"
                                      disabled={action.loading}
                                      onClick={() => handleUnstake(inc, pos)}
                                      className="px-3 py-1.5 rounded-full text-xs border border-amber-500/60 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 disabled:opacity-60"
                                    >
                                      {action.loading && actionKey === `unstake-${inc.id}-${pos.tokenId}`
                                        ? "Unstaking..."
                                        : "Unstake"}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={action.loading}
                                      onClick={() => handleStakeDeposited(inc, pos)}
                                      className="px-3 py-1.5 rounded-full text-xs border border-emerald-500/60 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60"
                                    >
                                      {action.loading && actionKey === `stake-deposit-${inc.id}-${pos.tokenId}`
                                        ? "Staking..."
                                        : "Stake"}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={action.loading}
                                    onClick={() => handleClaim(inc)}
                                    className="px-3 py-1.5 rounded-full text-xs border border-sky-500/60 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20 disabled:opacity-60"
                                  >
                                    {action.loading && actionKey === `claim-${inc.id}` ? "Claiming..." : "Claim"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={action.loading || !canWithdraw}
                                    onClick={() => handleWithdraw(pos)}
                                    className="px-3 py-1.5 rounded-full text-xs border border-slate-600/60 bg-slate-800/60 text-slate-200 hover:bg-slate-800 disabled:opacity-60"
                                  >
                                    {action.loading && actionKey === `withdraw-${pos.tokenId}`
                                      ? "Withdrawing..."
                                      : "Withdraw"}
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-xs text-slate-500">No deposited positions.</div>
                        )}
                      </div>

                      {action.error && (
                        <div className="text-xs text-amber-300">{action.error}</div>
                      )}
                      {action.hash && (
                        <a
                          href={`${EXPLORER_BASE_URL}/tx/${action.hash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-sky-400 hover:text-sky-300 underline"
                        >
                          View tx on {EXPLORER_LABEL}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
