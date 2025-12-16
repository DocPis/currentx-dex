// src/components/Farms.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Contract, parseUnits } from "ethers";
import {
  ERC20_ABI,
  MASTER_CHEF_ADDRESS,
  MASTER_CHEF_ABI,
  fetchMasterChefFarms,
  fetchMasterChefUserData,
  getProvider,
  TOKENS,
} from "../config/web3";

function formatNumber(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

const formatTokenAmount = (v, decimals = 4) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "0";
  if (n >= 1) return n.toFixed(Math.min(4, decimals));
  return n.toFixed(Math.min(6, decimals + 2));
};

export default function Farms({ address, onConnect }) {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-10 py-8 text-slate-100">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Farms</h2>
          <p className="text-sm text-slate-400">
            Deposit you LP tokens and earn CRX.
          </p>
        </div>
      </div>

      <FarmsList address={address} onConnect={onConnect} />
    </div>
  );
}

function FarmsList({ address, onConnect }) {
  const [farms, setFarms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userData, setUserData] = useState({});
  const [action, setAction] = useState({}); // {pid, type, loading, error, hash}
  const [inputs, setInputs] = useState({});
  const [meta, setMeta] = useState({ totalAllocPoint: 0, emissionPerBlock: 0 });
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await fetchMasterChefFarms();
        if (cancelled) return;
        setFarms(data.pools || []);
        setMeta({
          totalAllocPoint: data.totalAllocPoint || 0,
          emissionPerBlock: data.emissionPerBlock || 0,
        });
      } catch (e) {
        if (!cancelled) setError(e?.message || "Unable to load farms");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadUser = async () => {
      if (!address || !farms.length) {
        setUserData({});
        return;
      }
      try {
        const data = await fetchMasterChefUserData(address, farms);
        if (!cancelled) setUserData(data);
      } catch (_err) {
        if (!cancelled) setUserData({});
      }
    };
    loadUser();
    const id = setInterval(loadUser, 20000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address, farms]);

  const isEmpty = !farms.length && !loading && !error;

  const filtered = useMemo(() => {
    if (!search) return farms;
    const q = search.toLowerCase();
    return farms.filter(
      (f) =>
        (f.pairLabel || "").toLowerCase().includes(q) ||
        (f.lpToken || "").toLowerCase().includes(q)
    );
  }, [farms, search]);

  const totalTvl = useMemo(
    () =>
      farms.reduce(
        (acc, f) => acc + (Number.isFinite(f.tvlUsd) ? Number(f.tvlUsd) : 0),
        0
      ),
    [farms]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-slate-900/80 border border-slate-800 shadow-lg shadow-black/30 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-sm text-slate-300">Stake liquidity pool (LP) tokens and earn CRX</div>
          <div className="text-xs text-slate-500">Live</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-400">TVL</div>
          <div className="text-lg font-semibold text-slate-100">{formatNumber(totalTvl)}</div>
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
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search farms"
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

        {isEmpty && !loading && !error && (
          <div className="p-4 text-sm text-slate-400">No farms available on-chain.</div>
        )}

        {!loading && !error && farms.length > 0 && filtered.length === 0 && (
          <div className="p-4 text-sm text-slate-400">No farms match your search.</div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <>
            <div className="hidden md:grid grid-cols-12 px-4 py-2 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-800/70">
              <div className="col-span-5">Pool</div>
              <div className="col-span-2 text-right">Earned</div>
              <div className="col-span-2 text-right">APR</div>
              <div className="col-span-2 text-right">Liquidity</div>
              <div className="col-span-1 text-right">Multiplier</div>
            </div>

            <div className="divide-y divide-slate-800/70">
              {filtered.map((farm) => {
                const isOpen = expanded === farm.pid;
                const pending = userData[farm.pid]?.pending || 0;
                const multiplier =
                  farm.allocPoint && meta.totalAllocPoint
                    ? `${(farm.allocPoint / 100).toFixed(2)}x`
                    : farm.allocPoint
                      ? `${farm.allocPoint}x`
                      : "N/A";

                return (
                  <div key={`${farm.lpToken}-${farm.pid}`} className="px-4 py-3">
                    <div className="flex flex-col md:grid md:grid-cols-12 md:items-center gap-3">
                      <div className="col-span-5 flex items-center gap-3">
                        <div className="flex -space-x-2">
                          {(farm.tokens || []).map((token) => (
                            <img
                              key={token.address || token.symbol}
                              src={token.logo || TOKENS.CRX.logo}
                              alt={token.symbol}
                              className="h-10 w-10 rounded-full border border-slate-800 bg-slate-900"
                            />
                          ))}
                        </div>
                        <div className="flex flex-col">
                          <div className="text-sm font-semibold text-slate-100">
                            {farm.pairLabel || farm.lpToken}
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-2">
                            PID {farm.pid}
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                              Active
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="col-span-2 text-right text-sm text-slate-200">
                        {formatTokenAmount(pending, 6)} {farm.rewardToken?.symbol || "CRX"}
                      </div>
                      <div className="col-span-2 text-right text-sm text-slate-200">
                        {farm.apr !== null && farm.apr !== undefined
                          ? `${farm.apr.toFixed(2)}%`
                          : "N/A"}
                      </div>
                      <div className="col-span-2 text-right text-sm text-slate-200">
                        {farm.tvlUsd !== null && farm.tvlUsd !== undefined
                          ? formatNumber(farm.tvlUsd)
                          : "N/A"}
                      </div>
                      <div className="col-span-1 text-right text-sm text-slate-200">
                        {multiplier}
                      </div>
                      <div className="md:hidden flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : farm.pid)}
                          className="text-xs text-sky-400"
                        >
                          {isOpen ? "Hide" : "Details"}
                        </button>
                      </div>
                      <div className="hidden md:flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : farm.pid)}
                          className="text-xs text-sky-400"
                        >
                          {isOpen ? "Hide" : "Details"}
                        </button>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                        <FarmActions
                          farm={farm}
                          address={address}
                          onConnect={onConnect}
                          userData={userData[farm.pid]}
                          inputs={inputs}
                          setInputs={setInputs}
                          action={action}
                          setAction={setAction}
                          refreshUser={async () => {
                            if (!address) return;
                            const data = await fetchMasterChefUserData(address, farms);
                            setUserData(data);
                          }}
                          farmMeta={meta}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FarmActions({
  farm,
  address,
  onConnect,
  userData,
  inputs,
  setInputs,
  action,
  setAction,
  refreshUser,
  farmMeta,
}) {
  const staked = userData?.staked || 0;
  const pending = userData?.pending || 0;
  const walletLp = userData?.lpBalance || 0;
  const amountIn = inputs[farm.pid]?.deposit || "";
  const amountOut = inputs[farm.pid]?.withdraw || "";
  const isActing = action.pid === farm.pid && action.loading;

  const setInput = (key, val) => {
    setInputs((prev) => ({
      ...prev,
      [farm.pid]: { ...(prev[farm.pid] || {}), [key]: val },
    }));
  };

  const quickFill = (key, value) => {
    setInput(key, value);
  };

  const multiplier =
    farm.allocPoint && farmMeta?.totalAllocPoint
      ? `${(farm.allocPoint / 100).toFixed(2)}x`
      : farm.allocPoint
        ? `${farm.allocPoint}x`
        : "N/A";
  const sharePct =
    farm.allocPoint && farmMeta?.totalAllocPoint
      ? `${((farm.allocPoint / farmMeta.totalAllocPoint) * 100).toFixed(2)}%`
      : null;

  const handleAction = async (type) => {
    if (!address) {
      if (onConnect) onConnect();
      return;
    }
    try {
      setAction({ pid: farm.pid, type, loading: true, error: "" });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const chef = new Contract(MASTER_CHEF_ADDRESS, MASTER_CHEF_ABI, signer);
      const lp = new Contract(farm.lpToken, ERC20_ABI, signer);
      const decimals = farm.lpDecimals || 18;

      if (type === "deposit") {
        const amt = amountIn;
        if (!amt || Number(amt) <= 0) throw new Error("Enter amount");
        const parsed = parseUnits(amt, decimals);
        const allowance = await lp.allowance(address, MASTER_CHEF_ADDRESS);
        if (allowance < parsed) {
          await (await lp.approve(MASTER_CHEF_ADDRESS, parsed)).wait();
        }
        const tx = await chef.deposit(farm.pid, parsed);
        const receipt = await tx.wait();
        setAction({ pid: farm.pid, type, loading: false, hash: receipt.hash });
        setInput("deposit", "");
      } else if (type === "withdraw") {
        const amt = amountOut;
        if (!amt || Number(amt) <= 0) throw new Error("Enter amount");
        const parsed = parseUnits(amt, decimals);
        const tx = await chef.withdraw(farm.pid, parsed);
        const receipt = await tx.wait();
        setAction({ pid: farm.pid, type, loading: false, hash: receipt.hash });
        setInput("withdraw", "");
      } else if (type === "claim") {
        const tx = await chef.deposit(farm.pid, 0);
        const receipt = await tx.wait();
        setAction({ pid: farm.pid, type, loading: false, hash: receipt.hash });
      }

      await refreshUser();
    } catch (e) {
      setAction({
        pid: farm.pid,
        type,
        loading: false,
        error:
          e?.code === 4001 || e?.code === "ACTION_REJECTED"
            ? "Rejected in wallet"
            : e?.message || "Failed",
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-400">
        Earn {farm.rewardToken?.symbol || "CRX"} with MasterChef rewards.
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <MetricCard label="APR" value={farm.apr !== null && farm.apr !== undefined ? `${farm.apr.toFixed(2)}%` : "N/A"} />
        <MetricCard label="Liquidity" value={farm.tvlUsd !== null && farm.tvlUsd !== undefined ? formatNumber(farm.tvlUsd) : "N/A"} />
        <MetricCard label="Multiplier" value={multiplier} />
        <MetricCard label="Pool share" value={sharePct || "N/A"} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Deposit</span>
            <span>Wallet: {formatTokenAmount(walletLp)}</span>
          </div>
          <input
            value={amountIn}
            onChange={(e) => setInput("deposit", e.target.value)}
            placeholder="0.0"
            className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-100"
          />
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <button
              type="button"
              onClick={() => quickFill("deposit", "0")}
              className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:border-sky-500/60"
            >
              Min
            </button>
            <button
              type="button"
              onClick={() => quickFill("deposit", walletLp.toString())}
              className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:border-sky-500/60"
            >
              Max
            </button>
          </div>
          <button
            type="button"
            disabled={!address || isActing}
            onClick={() => handleAction("deposit")}
            className="px-3 py-2 rounded-xl bg-sky-600 text-white text-sm font-semibold shadow-lg shadow-sky-500/30 disabled:opacity-60"
          >
            {address ? (isActing && action.type === "deposit" ? "Depositing..." : "Deposit LP") : "Connect"}
          </button>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Unstake</span>
            <span>Staked: {formatTokenAmount(staked)}</span>
          </div>
          <input
            value={amountOut}
            onChange={(e) => setInput("withdraw", e.target.value)}
            placeholder="0.0"
            className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-slate-100"
          />
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <button
              type="button"
              onClick={() => quickFill("withdraw", "0")}
              className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:border-sky-500/60"
            >
              Min
            </button>
            <button
              type="button"
              onClick={() => quickFill("withdraw", staked.toString())}
              className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:border-sky-500/60"
            >
              Max
            </button>
          </div>
          <button
            type="button"
            disabled={!address || isActing}
            onClick={() => handleAction("withdraw")}
            className="px-3 py-2 rounded-xl bg-slate-800 text-white text-sm font-semibold border border-slate-700 shadow-inner shadow-black/30 disabled:opacity-60"
          >
            {address ? (isActing && action.type === "withdraw" ? "Unstaking..." : "Unstake LP") : "Connect"}
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Pending</span>
          <span className="font-semibold">{formatTokenAmount(pending, 6)} CRX</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!address || pending <= 0 || isActing}
            onClick={() => handleAction("claim")}
            className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold shadow-lg shadow-emerald-500/30 disabled:opacity-60"
          >
            {address ? (isActing && action.type === "claim" ? "Claiming..." : "Claim CRX") : "Connect"}
          </button>
          {action.error && action.pid === farm.pid && (
            <span className="text-[11px] text-amber-300">{action.error}</span>
          )}
          {action.hash && action.pid === farm.pid && (
            <a
              href={`https://sepolia.etherscan.io/tx/${action.hash}`}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-sky-400 hover:text-sky-300 underline"
            >
              View tx
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="text-lg font-semibold text-slate-100">{value}</div>
    </div>
  );
}
