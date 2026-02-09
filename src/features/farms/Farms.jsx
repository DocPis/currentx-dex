// src/features/farms/Farms.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AbiCoder, Contract, formatUnits, isAddress, parseUnits } from "ethers";
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
  getIncentiveId,
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
const parseDateToSec = (value) => {
  if (!value) return 0;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return 0;
  return Math.floor(ts / 1000);
};
const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
};
const formatLocalInput = (date) => {
  if (!date) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

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
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createForm, setCreateForm] = useState({
    rewardToken: TOKENS.CRX?.address || "",
    rewardAmount: "",
    pool: "",
    startTime: "",
    endTime: "",
    refundee: "",
  });
  const [createMeta, setCreateMeta] = useState({
    rewardTokenMeta: null,
    poolMeta: null,
    stakerLimits: null,
  });
  const tokenMetaCache = useRef({});
  const poolMetaCache = useRef({});

  const loadTokenMeta = useCallback(async (provider, addr) => {
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
  }, []);

  const loadPoolMeta = useCallback(async (provider, poolAddress) => {
    const lower = (poolAddress || "").toLowerCase();
    if (!lower) return null;
    if (poolMetaCache.current[lower]) return poolMetaCache.current[lower];
    try {
      const pool = new Contract(poolAddress, UNIV3_POOL_ABI, provider);
      const [token0, token1, fee] = await Promise.all([pool.token0(), pool.token1(), pool.fee()]);
      const [meta0, meta1] = await Promise.all([
        loadTokenMeta(provider, token0),
        loadTokenMeta(provider, token1),
      ]);
      const feeNum = Number(fee || 0);
      let isValid = false;
      try {
        const factory = new Contract(UNIV3_FACTORY_ADDRESS, UNIV3_FACTORY_ABI, provider);
        const expected = await factory.getPool(token0, token1, feeNum);
        if (expected && expected.toLowerCase() === lower) isValid = true;
      } catch {
        // ignore factory validation failures
      }
      const meta = {
        token0,
        token1,
        fee: feeNum,
        token0Meta: meta0,
        token1Meta: meta1,
        isValid,
      };
      poolMetaCache.current[lower] = meta;
      return meta;
    } catch {
      return null;
    }
  }, [loadTokenMeta]);

  const loadIncentives = useCallback(async () => {
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
  }, [loadPoolMeta, loadTokenMeta]);

  const loadPositions = useCallback(async () => {
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
  }, [address, loadTokenMeta]);

  const refreshAll = useCallback(async () => {
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
  }, [loadIncentives, loadPositions]);

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
  }, [refreshAll]);

  useEffect(() => {
    setCreateForm((prev) => ({
      ...prev,
      refundee: prev.refundee || address || "",
    }));
  }, [address]);

  useEffect(() => {
    if (createError) setCreateError("");
  }, [createForm, createError]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const provider = getReadOnlyProvider(false, true);
      const rewardToken = createForm.rewardToken;
      const poolAddr = createForm.pool;
      let rewardTokenMeta = null;
      let poolMeta = null;
      if (isAddress(rewardToken)) {
        rewardTokenMeta = await loadTokenMeta(provider, rewardToken);
      }
      if (isAddress(poolAddr)) {
        poolMeta = await loadPoolMeta(provider, poolAddr);
      }
      if (!cancelled) {
        setCreateMeta((prev) => ({
          ...prev,
          rewardTokenMeta,
          poolMeta,
        }));
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [createForm.rewardToken, createForm.pool, loadPoolMeta, loadTokenMeta]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const provider = getReadOnlyProvider(false, true);
        const staker = new Contract(V3_STAKER_ADDRESS, V3_STAKER_ABI, provider);
        const [maxLead, maxDuration] = await Promise.all([
          staker.maxIncentiveStartLeadTime(),
          staker.maxIncentiveDuration(),
        ]);
        if (!cancelled) {
          setCreateMeta((prev) => ({
            ...prev,
            stakerLimits: {
              maxLeadTime: Number(maxLead || 0),
              maxDuration: Number(maxDuration || 0),
            },
          }));
        }
      } catch {
        if (!cancelled) {
          setCreateMeta((prev) => ({
            ...prev,
            stakerLimits: null,
          }));
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const createKey = useMemo(() => {
    const rewardToken = createForm.rewardToken;
    const pool = createForm.pool;
    const refundee = createForm.refundee;
    const startTime = parseDateToSec(createForm.startTime);
    const endTime = parseDateToSec(createForm.endTime);
    if (!isAddress(rewardToken) || !isAddress(pool) || !isAddress(refundee)) return null;
    if (!startTime || !endTime || endTime <= startTime) return null;
    return { rewardToken, pool, startTime, endTime, refundee };
  }, [createForm]);

  const createIncentiveId = useMemo(() => {
    if (!createKey) return "";
    try {
      return getIncentiveId(createKey);
    } catch {
      return "";
    }
  }, [createKey]);

  const createDuration = useMemo(() => {
    const start = parseDateToSec(createForm.startTime);
    const end = parseDateToSec(createForm.endTime);
    if (!start || !end || end <= start) return 0;
    return end - start;
  }, [createForm.startTime, createForm.endTime]);

  const nowSec = Math.floor(Date.now() / 1000);
  const createValidation = useMemo(() => {
    const errors = [];
    const rewardToken = createForm.rewardToken;
    const pool = createForm.pool;
    const refundee = createForm.refundee;
    const rewardAmount = Number(createForm.rewardAmount || 0);
    const rewardMeta = createMeta.rewardTokenMeta;
    const poolMeta = createMeta.poolMeta;
    const startTime = parseDateToSec(createForm.startTime);
    const endTime = parseDateToSec(createForm.endTime);
    const maxLead = createMeta.stakerLimits?.maxLeadTime || 0;
    const maxDuration = createMeta.stakerLimits?.maxDuration || 0;

    if (!isAddress(rewardToken)) errors.push("Reward token address is invalid.");
    if (!rewardMeta) errors.push("Reward token metadata not found.");
    if (!(rewardAmount > 0)) errors.push("Reward amount must be greater than 0.");
    if (!isAddress(pool)) errors.push("Pool address is invalid.");
    if (!poolMeta) errors.push("Pool not found.");
    if (poolMeta && poolMeta.isValid === false) {
      errors.push("Pool is not a valid V3 pool for this factory.");
    }
    if (!isAddress(refundee)) errors.push("Refundee address is invalid.");
    if (!startTime || !endTime) errors.push("Start and end time are required.");
    if (startTime && startTime < nowSec) {
      errors.push("Start time must be in the future.");
    }
    if (startTime && endTime && endTime <= startTime) {
      errors.push("End time must be after start time.");
    }
    if (startTime && maxLead && startTime - nowSec > maxLead) {
      errors.push(`Start time exceeds max lead time (${formatDuration(maxLead)}).`);
    }
    if (startTime && endTime && maxDuration && endTime - startTime > maxDuration) {
      errors.push(`Duration exceeds max (${formatDuration(maxDuration)}).`);
    }

    return { valid: errors.length === 0, errors };
  }, [createForm, createMeta, nowSec]);

  const startMin = useMemo(() => formatLocalInput(new Date(nowSec * 1000)), [nowSec]);
  const startMax = useMemo(() => {
    const maxLead = createMeta.stakerLimits?.maxLeadTime || 0;
    if (!maxLead) return "";
    return formatLocalInput(new Date((nowSec + maxLead) * 1000));
  }, [createMeta.stakerLimits, nowSec]);
  const endMin = useMemo(() => {
    const start = parseDateToSec(createForm.startTime);
    const base = start || nowSec;
    return formatLocalInput(new Date(base * 1000));
  }, [createForm.startTime, nowSec]);
  const endMax = useMemo(() => {
    const maxDuration = createMeta.stakerLimits?.maxDuration || 0;
    if (!maxDuration) return "";
    const start = parseDateToSec(createForm.startTime);
    const base = start || nowSec;
    return formatLocalInput(new Date((base + maxDuration) * 1000));
  }, [createForm.startTime, createMeta.stakerLimits, nowSec]);

  const handleCreate = async () => {
    if (!address) {
      if (onConnect) onConnect();
      return;
    }
    if (!createKey || !createValidation.valid) {
      setCreateError(
        createValidation.errors?.[0] || "Fill all fields with valid addresses and times."
      );
      return;
    }
    const rewardMeta = createMeta.rewardTokenMeta;
    if (!rewardMeta?.decimals && rewardMeta?.decimals !== 0) {
      setCreateError("Reward token decimals not available.");
      return;
    }
    const rewardAmount = createForm.rewardAmount;
    if (!rewardAmount || Number(rewardAmount) <= 0) {
      setCreateError("Enter a reward amount.");
      return;
    }
    try {
      setCreateLoading(true);
      setCreateError("");
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const rewardWei = parseUnits(rewardAmount, rewardMeta.decimals || 18);
      const rewardToken = new Contract(createKey.rewardToken, ERC20_ABI, signer);
      const allowance = await rewardToken.allowance(address, V3_STAKER_ADDRESS);
      if (allowance < rewardWei) {
        const tx = await rewardToken.approve(V3_STAKER_ADDRESS, rewardWei);
        await tx.wait();
      }
      const staker = new Contract(V3_STAKER_ADDRESS, V3_STAKER_ABI, signer);
      const tx = await staker.createIncentive(createKey, rewardWei);
      const receipt = await tx.wait();
      setAction({
        loading: false,
        key: "create-incentive",
        error: "",
        hash: receipt?.hash || tx.hash,
      });
      setCreateOpen(false);
      setCreateForm((prev) => ({
        ...prev,
        rewardAmount: "",
        pool: "",
        startTime: "",
        endTime: "",
      }));
      await refreshAll();
    } catch (e) {
      setCreateError(e?.message || "Create incentive failed");
    } finally {
      setCreateLoading(false);
    }
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
      const tx = await manager["safeTransferFrom(address,address,uint256,bytes)"](
        address,
        V3_STAKER_ADDRESS,
        pos.tokenId,
        data
      );
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
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-[28px] border border-white/5 bg-gradient-to-br from-slate-950/90 via-slate-900/70 to-emerald-900/20 p-5 shadow-2xl shadow-black/40">
        <div className="absolute -top-24 -right-20 h-52 w-52 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute -bottom-24 -left-20 h-60 w-60 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </div>
            <div className="text-sm text-slate-200">
              Incentives for V3 positions, on-chain via V3 Staker.
            </div>
            <div className="text-xs text-slate-500">
              Stake, earn, and manage NFT positions without leaving the chain.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Incentives
              </div>
              <div className="text-lg font-semibold text-slate-100">
                {formatNumber(incentives.length)}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Active</div>
              <div className="text-lg font-semibold text-slate-100">
                {formatNumber(activeCount)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="px-4 py-2.5 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 text-xs font-semibold text-slate-950 shadow-lg shadow-emerald-500/30 hover:from-emerald-300 hover:to-emerald-500 transition"
            >
              Create Incentive
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-[26px] border border-white/5 bg-slate-950/60 backdrop-blur-xl shadow-2xl shadow-black/30">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2 text-sm text-slate-200">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </div>
          </div>
          <div className="flex-1 flex items-center gap-2 bg-slate-900/70 border border-slate-800/80 rounded-full px-4 py-2 text-sm text-slate-200 max-w-xl">
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
          <div className="p-5 space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-16 rounded-2xl border border-white/5 bg-slate-900/50 animate-pulse"
              />
            ))}
          </div>
        )}

        {error && !loading && (
          <div className="p-5 text-sm text-amber-100 bg-amber-500/10 border border-amber-500/30 rounded-2xl mx-4 my-4">
            {error}
          </div>
        )}

        {!loading && !error && filteredIncentives.length === 0 && (
          <div className="p-5 text-sm text-slate-400">No incentives found.</div>
        )}

        {!loading && !error && filteredIncentives.length > 0 && (
          <div className="p-3 space-y-3">
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
                <div
                  key={inc.id}
                  className={`rounded-2xl border px-4 py-4 transition-colors ${
                    isOpen
                      ? "border-slate-700/60 bg-slate-900/60"
                      : "border-white/5 bg-slate-950/50 hover:bg-slate-900/40"
                  }`}
                >
                  <div className="flex flex-col md:grid md:grid-cols-12 md:items-center gap-4">
                    <div className="col-span-5 flex items-center gap-3">
                      <div className="flex -space-x-2">
                        {[inc.poolMeta?.token0Meta, inc.poolMeta?.token1Meta].map((token, idx) => (
                          <img
                            key={`${inc.id}-${idx}`}
                            src={token?.logo || TOKENS.CRX?.logo}
                            alt={token?.symbol || "token"}
                            className="h-11 w-11 rounded-full border border-slate-800 bg-slate-900"
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
                    <div className="col-span-3 md:text-right">
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">
                        Total Reward
                      </div>
                      <div className="text-sm font-semibold text-slate-100">
                        {rewardAmount} {rewardSymbol}
                      </div>
                    </div>
                    <div className="col-span-3 md:text-right">
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">
                        Window
                      </div>
                      <div className="text-xs text-slate-400">
                        {formatTimestamp(inc.startTime)} {"->"} {formatTimestamp(inc.endTime)}
                      </div>
                    </div>
                    <div className="col-span-1 md:text-right">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : inc.id)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-full border border-slate-700/70 text-slate-200 bg-slate-900/70 hover:bg-slate-800/80 transition-colors"
                      >
                        {isOpen ? "Hide" : "Details"}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-4 rounded-2xl border border-white/5 bg-slate-950/70 p-4 shadow-inner shadow-black/40 space-y-4">
                      <div className="space-y-1">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">
                          Incentive ID
                        </div>
                        <div className="text-sm font-mono text-slate-200 break-all">
                          {inc.id}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs uppercase tracking-wide text-slate-500">
                          Wallet Positions
                        </div>
                        {eligibleWallet.length ? (
                          eligibleWallet.map((pos) => (
                            <div
                              key={`wallet-${pos.tokenId}`}
                              className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2"
                            >
                              <div className="text-sm text-slate-100">
                                NFT ID [{pos.tokenId}] - {pos.token0Meta?.symbol || "Token0"} /{" "}
                                {pos.token1Meta?.symbol || "Token1"} - Fee{" "}
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
                          <div className="text-xs text-slate-500">No eligible wallet positions found.</div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs uppercase tracking-wide text-slate-500">
                          Deposited Positions
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
                                className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2"
                              >
                                <div className="text-sm text-slate-100">
                                  NFT ID [{pos.tokenId}] - {pos.token0Meta?.symbol || "Token0"} /{" "}
                                  {pos.token1Meta?.symbol || "Token1"} - Fee{" "}
                                  {(pos.fee / 10000).toFixed(2)}%
                                  <span
                                    className={`ml-2 px-2 py-0.5 rounded-full text-[10px] border ${
                                      isStaked
                                        ? "border-emerald-400/40 text-emerald-200 bg-emerald-500/10"
                                        : "border-slate-600/60 text-slate-300 bg-slate-800/40"
                                    }`}
                                  >
                                    {isStaked ? "Staked" : "Not staked"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="text-xs text-slate-400">
                                    Reward {formatTokenAmount(reward, inc.rewardMeta?.decimals || 18, 6)}{" "}
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
                          <div className="text-xs text-slate-500">No deposited positions found.</div>
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

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setCreateOpen(false)}
          />
          <div className="relative w-full max-w-xl rounded-3xl border border-slate-800 bg-[#0a0f24] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-100">
                  Create Incentive
                </h3>
                <p className="text-xs text-slate-400">
                  On-chain creation of V3 incentives.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-2 py-1 text-xs rounded-full border border-slate-700 text-slate-300"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Reward token</label>
                  <input
                    value={createForm.rewardToken}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, rewardToken: e.target.value }))
                    }
                    placeholder="0x..."
                    className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-100"
                  />
                  <div className="text-[11px] text-slate-500">
                    {createMeta.rewardTokenMeta?.symbol || "Token"} -{" "}
                    {createMeta.rewardTokenMeta?.decimals ?? "--"} decimals
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Reward amount</label>
                  <input
                    value={createForm.rewardAmount}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, rewardAmount: e.target.value }))
                    }
                    placeholder="0.0"
                    className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-100"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-400">Pool address</label>
                <input
                  value={createForm.pool}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, pool: e.target.value }))}
                  placeholder="0x..."
                  className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-100"
                />
                <div className="text-[11px] text-slate-500">
                  {createMeta.poolMeta
                    ? `${createMeta.poolMeta.token0Meta?.symbol || "Token0"} / ${
                        createMeta.poolMeta.token1Meta?.symbol || "Token1"
                      } - Fee ${((createMeta.poolMeta.fee || 0) / 10000).toFixed(2)}%`
                    : "Pool details will appear here"}
                  {createMeta.poolMeta && (
                    <span
                      className={`ml-2 ${
                        createMeta.poolMeta.isValid ? "text-emerald-400" : "text-amber-300"
                      }`}
                    >
                      {createMeta.poolMeta.isValid
                        ? "Pool verified"
                        : "Pool not found in factory"}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Start time</label>
                  <input
                    type="datetime-local"
                    value={createForm.startTime}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, startTime: e.target.value }))
                    }
                    min={startMin || undefined}
                    max={startMax || undefined}
                    className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">End time</label>
                  <input
                    type="datetime-local"
                    value={createForm.endTime}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, endTime: e.target.value }))
                    }
                    min={endMin || undefined}
                    max={endMax || undefined}
                    className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-100"
                  />
                </div>
              </div>

              <div className="text-[11px] text-slate-500">
                {createMeta.stakerLimits
                  ? `Max lead time: ${formatDuration(
                      createMeta.stakerLimits.maxLeadTime
                    )} | Max duration: ${formatDuration(
                      createMeta.stakerLimits.maxDuration
                    )}`
                  : "Incentive limits not available"}
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-400">Refundee</label>
                <div className="flex flex-col md:flex-row gap-2">
                  <input
                    value={createForm.refundee}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, refundee: e.target.value }))
                    }
                    placeholder="0x..."
                    className="flex-1 rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setCreateForm((prev) => ({ ...prev, refundee: address || "" }))
                    }
                    className="px-3 py-2 rounded-xl border border-slate-700 text-xs text-slate-200"
                  >
                    Use my address
                  </button>
                </div>
              </div>

              {!createValidation.valid && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  {createValidation.errors.map((err) => (
                    <div key={err}>- {err}</div>
                  ))}
                </div>
              )}


              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                Disclaimer: incentive creation is reserved for protocols. By proceeding you confirm you are authorized.
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-3 text-xs text-slate-300">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">
                  Details
                </div>
                <div className="flex flex-col gap-1">
                  <div>Reward token: {createForm.rewardToken || "--"}</div>
                  <div>Pool: {createForm.pool || "--"}</div>
                  <div>Refundee: {createForm.refundee || "--"}</div>
                  <div>
                    Start: {createForm.startTime ? formatTimestamp(parseDateToSec(createForm.startTime)) : "--"}
                  </div>
                  <div>
                    End: {createForm.endTime ? formatTimestamp(parseDateToSec(createForm.endTime)) : "--"}
                  </div>
                  <div>Duration: {formatDuration(createDuration)}</div>
                  <div>Reward amount: {createForm.rewardAmount || "0"}</div>
                  <div>Incentive ID: {createIncentiveId || "--"}</div>
                </div>
              </div>

              {createError && (
                <div className="text-xs text-amber-300">{createError}</div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-3 py-2 rounded-xl border border-slate-700 text-xs text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={createLoading || (address && !createValidation.valid)}
                  onClick={handleCreate}
                  className="px-3 py-2 rounded-xl bg-emerald-600 text-xs font-semibold text-white shadow-lg shadow-emerald-500/30 disabled:opacity-60"
                >
                  {createLoading ? "Creating..." : "Create Incentive"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}





