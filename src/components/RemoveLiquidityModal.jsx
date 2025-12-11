// src/components/RemoveLiquidityModal.jsx

import React, { useState } from "react";
import { BrowserProvider, Contract, formatUnits } from "ethers";
import {
  UNISWAP_V2_ROUTER,
  UNISWAP_V2_ROUTER_ABI,
} from "../config/uniswapSepolia";

export default function RemoveLiquidityModal({
  isOpen,
  onClose,
  pool,
  onRemoved,
}) {
  if (!isOpen || !pool) return null;

  const {
    token0Symbol,
    token1Symbol,
    userLp,
    totalSupply,
    reserve0,
    reserve1,
    userLpRaw,
    token0Address,
    token1Address,
    dec0,
    dec1,
  } = pool;

  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [txError, setTxError] = useState(null);

  const sharePct =
    totalSupply > 0 ? ((userLp / totalSupply) * 100).toFixed(4) : "0.0000";

  const disabled = submitting || !userLpRaw || userLpRaw === 0n;

  async function handleRemove() {
    if (!window.ethereum) {
      setTxError("No wallet detected.");
      return;
    }

    try {
      setSubmitting(true);
      setTxError(null);
      setTxHash(null);

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const router = new Contract(
        UNISWAP_V2_ROUTER,
        UNISWAP_V2_ROUTER_ABI,
        signer
      );

      const account = await signer.getAddress();

      // amount di LP da rimuovere: 100% della posizione utente
      const liquidity = userLpRaw;

      if (!liquidity || liquidity === 0n) {
        setTxError("You have no LP to remove.");
        setSubmitting(false);
        return;
      }

      // Per ora min amount = 0 (nessuna protezione slippage)
      const amountAMin = 0n;
      const amountBMin = 0n;

      const deadline = BigInt(
        Math.floor(Date.now() / 1000) + 60 * 20 // 20 minuti
      );

      console.log("removeLiquidity params", {
        tokenA: token0Address,
        tokenB: token1Address,
        liquidity: liquidity.toString(),
        amountAMin: amountAMin.toString(),
        amountBMin: amountBMin.toString(),
        to: account,
        deadline: deadline.toString(),
      });

      const tx = await router.removeLiquidity(
        token0Address,
        token1Address,
        liquidity,
        amountAMin,
        amountBMin,
        account,
        deadline
      );

      setTxHash(tx.hash);

      const receipt = await tx.wait();

      if (receipt.status === 1n || receipt.status === 1) {
        // tx ok
        if (onRemoved) onRemoved();
        onClose();
      } else {
        setTxError("Transaction failed.");
      }
    } catch (err) {
      console.error("removeLiquidity error:", err);
      setTxError(err?.shortMessage || err?.message || "Transaction failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-slate-950/95 p-6 shadow-2xl shadow-black/60">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-50">
            Remove liquidity
          </h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 space-y-2 text-xs text-slate-400">
          <p className="text-slate-300">
            {token0Symbol} / {token1Symbol}
          </p>
          <p>
            Your LP:{" "}
            <span className="text-teal-300">{userLp.toFixed(12)} LP</span>
          </p>
          <p>
            Your share of pool:{" "}
            <span className="text-slate-200">{sharePct}%</span>
          </p>
          <p className="pt-2">
            Pool reserves:
            <br />
            <span className="text-slate-200">
              {reserve0} {token0Symbol}
            </span>{" "}
            ·{" "}
            <span className="text-slate-200">
              {reserve1} {token1Symbol}
            </span>
          </p>
        </div>

        <div className="mb-4 rounded-xl bg-slate-900/70 px-3 py-3 text-xs text-slate-400">
          <p className="mb-1 font-semibold text-slate-200">
            Amount to remove: <span className="text-teal-300">100%</span> of
            your LP
          </p>
          <p>
            In questa prima versione rimuoviamo il 100% della tua posizione
            nella pool. In seguito possiamo aggiungere slider e slippage
            personalizzato.
          </p>
        </div>

        {txError && (
          <div className="mb-3 rounded-md bg-red-900/50 px-3 py-2 text-xs text-red-100">
            {txError}
          </div>
        )}

        {txHash && (
          <div className="mb-3 rounded-md bg-emerald-900/40 px-3 py-2 text-xs text-emerald-100">
            Tx sent:{" "}
            <span className="font-mono">
              {txHash.slice(0, 10)}…{txHash.slice(-6)}
            </span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-full border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={handleRemove}
            disabled={disabled}
            className="rounded-full bg-rose-500 px-4 py-2 text-xs font-semibold text-slate-50 shadow-md shadow-rose-900/40 transition hover:bg-rose-400 hover:shadow-rose-800/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Removing…" : "Confirm remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
