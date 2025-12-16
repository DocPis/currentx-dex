// src/components/Farms.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Contract, formatUnits, parseUnits } from "ethers";
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
            Deposit your LP tokens and earn our native token (CRX).
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

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await fetchMasterChefFarms();
        if (cancelled) return;
        setFarms(data.pools || []);
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
      } catch (e) {
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

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-3xl bg-slate-900/70 border border-slate-800 p-5 animate-pulse space-y-3">
            <div className="h-5 bg-slate-800/80 rounded w-1/3" />
            <div className="h-4 bg-slate-800/70 rounded w-1/2" />
            <div className="h-20 bg-slate-800/60 rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
        {error}
      </div>
    );
  }

  if (!farms.length) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
        No farms available on-chain.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {farms.map((farm) => (
        <div
          key={`${farm.lpToken}-${farm.pid}`}
          className="rounded-3xl bg-slate-900/70 border border-slate-800 shadow-xl shadow-black/30 p-5 flex flex-col gap-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
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
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-2 w-2 rounded-full bg-sky-400" />
              {farm.rewardToken?.symbol} emissions
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-slate-900 border border-slate-800 px-3 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                APR
              </div>
              <div className="text-xl font-semibold">
                {farm.apr !== null && farm.apr !== undefined
                  ? `${farm.apr.toFixed(2)}%`
                  : "N/A"}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-900 border border-slate-800 px-3 py-3 text-right">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                TVL
              </div>
              <div className="text-xl font-semibold">
                {farm.tvlUsd !== null && farm.tvlUsd !== undefined
                  ? formatNumber(farm.tvlUsd)
                  : "N/A"}
              </div>
            </div>
          </div>

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
          />
        </div>
      ))}
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
