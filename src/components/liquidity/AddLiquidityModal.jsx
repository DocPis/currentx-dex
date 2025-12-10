// src/components/liquidity/AddLiquidityModal.jsx

import { useEffect, useState } from "react";
import { BrowserProvider, Contract, parseUnits } from "ethers";

import {
  UNISWAP_V2_ROUTER,
  UNISWAP_V2_ROUTER_ABI,
  UNISWAP_V2_PAIR_ABI,
  ERC20_ABI,
  SEPOLIA_CHAIN_ID_HEX,
} from "../../config/uniswapSepolia";

import { TOKENS } from "../../config/tokenRegistry";

function classNames(...cls) {
  return cls.filter(Boolean).join(" ");
}

export default function AddLiquidityModal({
  isOpen,
  onClose,
  pool,
  address,
  chainId,
  onAfterAction,
}) {
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [ratioAB, setRatioAB] = useState(null); // tokenB per tokenA

  const [loadingReserves, setLoadingReserves] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  if (!isOpen || !pool) return null;

  const [symA, symB] = pool.tokens || [];
  const tokenA = TOKENS[symA];
  const tokenB = TOKENS[symB];

  const isConnected = !!address;
  const isOnSepolia =
    !chainId || chainId === SEPOLIA_CHAIN_ID_HEX;

  /* ---------------- LOAD RESERVES (RATIO) ---------------- */

  useEffect(() => {
    let cancelled = false;

    async function loadReserves() {
      if (!pool.pairAddress) return;
      if (typeof window === "undefined" || !window.ethereum) return;

      try {
        setLoadingReserves(true);
        setError(null);

        const provider = new BrowserProvider(window.ethereum);
        const pair = new Contract(
          pool.pairAddress,
          UNISWAP_V2_PAIR_ABI,
          provider
        );

        const token0 = (await pair.token0()).toLowerCase();
        const [reserve0, reserve1] = await pair.getReserves();

        const addrA = tokenA.address.toLowerCase();
        const addrB = tokenB.address.toLowerCase();

        let rA, rB;
        const decA = tokenA.decimals || 18;
        const decB = tokenB.decimals || 18;

        if (token0 === addrA) {
          rA = reserve0;
          rB = reserve1;
        } else if (token0 === addrB) {
          rA = reserve1;
          rB = reserve0;
        } else {
          rA = reserve0;
          rB = reserve1;
        }

        const numA = Number(rA) / Math.pow(10, decA);
        const numB = Number(rB) / Math.pow(10, decB);

        if (!cancelled && numA > 0) {
          setRatioAB(numB / numA); // tokenB per 1 tokenA
        }
      } catch (e) {
        console.warn("Failed to load reserves for addLiquidity:", e);
        if (!cancelled) {
          setRatioAB(null);
        }
      } finally {
        if (!cancelled) setLoadingReserves(false);
      }
    }

    loadReserves();
    return () => {
      cancelled = true;
    };
  }, [pool.pairAddress, tokenA?.address, tokenB?.address]);

  /* ---------------- HANDLE INPUTS ---------------- */

  const handleAmountAChange = (value) => {
    setAmountA(value);
    if (ratioAB && value && !Number.isNaN(Number(value))) {
      const nextB = Number(value) * ratioAB;
      setAmountB(nextB.toFixed(6));
    } else if (!value) {
      setAmountB("");
    }
  };

  /* ---------------- APPROVE + ADD LIQUIDITY ---------------- */

  async function ensureAllowance(
    signer,
    tokenAddress,
    owner,
    spender,
    needed
  ) {
    const erc20 = new Contract(tokenAddress, ERC20_ABI, signer);
    const allowance = await erc20.allowance(owner, spender);
    if (allowance >= needed) return;

    const tx = await erc20.approve(spender, needed);
    await tx.wait();
  }

  const handleSupply = async () => {
    if (!window.ethereum) {
      alert("No wallet detected.");
      return;
    }

    if (!isConnected) {
      alert("Connect your wallet from the top-right first.");
      return;
    }

    if (!isOnSepolia) {
      alert("Switch your wallet to Sepolia to add liquidity.");
      return;
    }

    if (!tokenA?.address || !tokenB?.address) {
      alert("Invalid token configuration for this pool.");
      return;
    }

    const valA = parseFloat(amountA || "0");
    const valB = parseFloat(amountB || "0");

    if (!(valA > 0) || !(valB > 0)) {
      alert("Enter a valid amount for both tokens.");
      return;
    }

    try {
      setTxPending(true);
      setTxHash(null);
      setError(null);

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const decA = tokenA.decimals || 18;
      const decB = tokenB.decimals || 18;

      const amtA = parseUnits(amountA, decA);
      const amtB = parseUnits(amountB, decB);

      // 1% slippage sulla liquidity
      const minA = (amtA * 99n) / 100n;
      const minB = (amtB * 99n) / 100n;

      const router = new Contract(
        UNISWAP_V2_ROUTER,
        UNISWAP_V2_ROUTER_ABI,
        signer
      );

      // Approve se necessario
      await ensureAllowance(
        signer,
        tokenA.address,
        address,
        UNISWAP_V2_ROUTER,
        amtA
      );
      await ensureAllowance(
        signer,
        tokenB.address,
        address,
        UNISWAP_V2_ROUTER,
        amtB
      );

      const deadline =
        Math.floor(Date.now() / 1000) + 60 * 10;

      const tx = await router.addLiquidity(
        tokenA.address,
        tokenB.address,
        amtA,
        amtB,
        minA,
        minB,
        address,
        deadline
      );

      setTxHash(tx.hash);
      await tx.wait();

      setTxPending(false);
      setAmountA("");
      setAmountB("");

      if (typeof onAfterAction === "function") {
        onAfterAction();
      }

      onClose();
    } catch (e) {
      console.error("addLiquidity error:", e);
      let msg = "Add liquidity failed.";
      if (e?.info?.error?.message) msg = e.info.error.message;
      else if (e?.message) msg = e.message;
      setError(msg);
      setTxPending(false);
    }
  };

  /* ---------------- RENDER ---------------- */

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950/95 shadow-2xl shadow-black/70 px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-sky-400/80">
              Add liquidity
            </p>
            <h2 className="text-sm sm:text-base font-semibold text-slate-50">
              {pool.pair}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-slate-800/80 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        {!isConnected && (
          <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
            Connect your wallet from the top-right button to add
            liquidity.
          </div>
        )}

        {isConnected && !isOnSepolia && (
          <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
            You are on a different network. Switch your wallet to{" "}
            <span className="font-semibold">Sepolia</span> to add
            liquidity.
          </div>
        )}

        <div className="space-y-3">
          {/* Token A */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2.5">
            <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
              <span>{symA}</span>
              {loadingReserves ? (
                <span>Loading reserves...</span>
              ) : ratioAB != null ? (
                <span className="text-slate-300">
                  Pool ratio: 1 {symA} ≈{" "}
                  {ratioAB.toFixed(4)} {symB}
                </span>
              ) : (
                <span className="text-slate-500">
                  Ratio not available
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full bg-slate-800 px-2 py-1 text-[11px] text-slate-200">
                {symA}
              </span>
              <input
                type="number"
                min="0"
                value={amountA}
                onChange={(e) =>
                  handleAmountAChange(e.target.value)
                }
                placeholder="0.0"
                className="flex-1 bg-transparent text-right text-lg font-semibold text-slate-50 outline-none placeholder:text-slate-600"
              />
            </div>
          </div>

          {/* Token B */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2.5">
            <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
              <span>{symB}</span>
              <span className="text-slate-500">
                Auto-filled from pool ratio
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full bg-slate-800 px-2 py-1 text-[11px] text-slate-200">
                {symB}
              </span>
              <input
                type="number"
                min="0"
                value={amountB}
                onChange={(e) => setAmountB(e.target.value)}
                placeholder="0.0"
                className="flex-1 bg-transparent text-right text-lg font-semibold text-slate-50 outline-none placeholder:text-slate-600"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100">
            {error}
          </div>
        )}

        {txHash && (
          <div className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
            Tx sent:{" "}
            <a
              href={`https://sepolia.etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {txHash.slice(0, 10)}...
              {txHash.slice(-8)}
            </a>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full border border-slate-600/70 px-3 py-1.5 text-[11px] text-slate-200 hover:border-slate-300/80 hover:bg-slate-900/70 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSupply}
            disabled={
              txPending ||
              !isConnected ||
              !isOnSepolia ||
              !pool.hasOnChainPool
            }
            className={classNames(
              "rounded-full px-4 py-1.5 text-[11px] font-semibold shadow-lg",
              txPending ||
                !isConnected ||
                !isOnSepolia ||
                !pool.hasOnChainPool
                ? "bg-slate-700 text-slate-400 cursor-not-allowed shadow-none"
                : "bg-gradient-to-r from-sky-500 to-indigo-500 text-slate-50 shadow-indigo-600/40"
            )}
          >
            {txPending ? "Confirm in wallet..." : "Supply liquidity"}
          </button>
        </div>
      </div>
    </div>
  );
}

