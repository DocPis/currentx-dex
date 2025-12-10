// src/components/liquidity/RemoveLiquidityModal.jsx

import { useEffect, useState } from "react";
import { BrowserProvider, Contract } from "ethers";

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

export default function RemoveLiquidityModal({
  isOpen,
  onClose,
  pool,
  address,
  chainId,
  onAfterAction,
}) {
  const [loadingData, setLoadingData] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  const [lpBalanceRaw, setLpBalanceRaw] = useState(0n);
  const [totalSupplyRaw, setTotalSupplyRaw] = useState(0n);
  const [reserveARaw, setReserveARaw] = useState(0n);
  const [reserveBRaw, setReserveBRaw] = useState(0n);
  const [decA, setDecA] = useState(18);
  const [decB, setDecB] = useState(18);

  const [percent, setPercent] = useState(50);

  const [amountLpToRemoveRaw, setAmountLpToRemoveRaw] = useState(0n);
  const [amountARawToRemove, setAmountARawToRemove] = useState(0n);
  const [amountBRawToRemove, setAmountBRawToRemove] = useState(0n);

  const [previewLp, setPreviewLp] = useState("0.0");
  const [previewA, setPreviewA] = useState("0.0");
  const [previewB, setPreviewB] = useState("0.0");

  if (!isOpen || !pool) return null;

  const [symA, symB] = pool.tokens || [];
  const tokenA = TOKENS[symA];
  const tokenB = TOKENS[symB];

  const isConnected = !!address;
  const isOnSepolia =
    !chainId || chainId === SEPOLIA_CHAIN_ID_HEX;

  /* ---------------- LOAD RESERVES + LP BALANCE ---------------- */

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      if (!pool.pairAddress) return;
      if (typeof window === "undefined" || !window.ethereum) return;

      try {
        setLoadingData(true);
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

        let rA = reserve0;
        let rB = reserve1;
        const decimalsA = tokenA.decimals || 18;
        const decimalsB = tokenB.decimals || 18;

        if (token0 === addrA) {
          rA = reserve0;
          rB = reserve1;
        } else if (token0 === addrB) {
          rA = reserve1;
          rB = reserve0;
        }

        const totalSupply = await pair.totalSupply();
        let userLp = 0n;
        if (address) {
          userLp = await pair.balanceOf(address);
        }

        if (cancelled) return;

        setReserveARaw(rA);
        setReserveBRaw(rB);
        setDecA(decimalsA);
        setDecB(decimalsB);
        setTotalSupplyRaw(totalSupply);
        setLpBalanceRaw(userLp);
      } catch (e) {
        console.error("load RemoveLiquidity data error:", e);
        if (!cancelled) {
          setError(
            e?.message ||
              "Failed to load LP/reserves data for this pool."
          );
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [pool.pairAddress, tokenA?.address, tokenB?.address, address]);

  /* ---------------- RECOMPUTE PREVIEW WHEN % OR DATA CHANGE ---------------- */

  useEffect(() => {
    try {
      if (
        lpBalanceRaw === 0n ||
        totalSupplyRaw === 0n ||
        reserveARaw === 0n ||
        reserveBRaw === 0n
      ) {
        setAmountLpToRemoveRaw(0n);
        setAmountARawToRemove(0n);
        setAmountBRawToRemove(0n);
        setPreviewLp("0.0");
        setPreviewA("0.0");
        setPreviewB("0.0");
        return;
      }

      const pct = Math.min(Math.max(percent, 0), 100);
      const lpToRemove =
        (lpBalanceRaw * BigInt(pct)) / 100n;

      const amountARaw =
        (lpToRemove * reserveARaw) / totalSupplyRaw;
      const amountBRaw =
        (lpToRemove * reserveBRaw) / totalSupplyRaw;

      const lpBalanceFloat =
        Number(lpBalanceRaw) / 1e18;
      const lpRemoveFloat = Number(lpToRemove) / 1e18;
      const outA =
        Number(amountARaw) / Math.pow(10, decA);
      const outB =
        Number(amountBRaw) / Math.pow(10, decB);

      setAmountLpToRemoveRaw(lpToRemove);
      setAmountARawToRemove(amountARaw);
      setAmountBRawToRemove(amountBRaw);

      setPreviewLp(
        `${lpRemoveFloat.toFixed(6)} / ${lpBalanceFloat.toFixed(
          6
        )} LP`
      );
      setPreviewA(outA.toFixed(6));
      setPreviewB(outB.toFixed(6));
    } catch (e) {
      console.warn("preview compute error:", e);
      setPreviewLp("0.0");
      setPreviewA("0.0");
      setPreviewB("0.0");
    }
  }, [
    percent,
    lpBalanceRaw,
    totalSupplyRaw,
    reserveARaw,
    reserveBRaw,
    decA,
    decB,
  ]);

  const handlePercentClick = (value) => {
    setPercent(value);
  };

  /* ---------------- APPROVE LP + REMOVE LIQUIDITY ---------------- */

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

  const handleWithdraw = async () => {
    if (!window.ethereum) {
      alert("No wallet detected.");
      return;
    }

    if (!isConnected) {
      alert("Connect your wallet from the top-right first.");
      return;
    }

    if (!isOnSepolia) {
      alert(
        "Switch your wallet to Sepolia to remove liquidity."
      );
      return;
    }

    if (!pool.pairAddress || !pool.hasOnChainPool) {
      alert("This pool has no on-chain Uniswap V2 pair.");
      return;
    }

    if (!tokenA?.address || !tokenB?.address) {
      alert("Invalid token configuration for this pool.");
      return;
    }

    if (lpBalanceRaw === 0n) {
      alert("You have no LP tokens to withdraw from this pool.");
      return;
    }

    if (amountLpToRemoveRaw === 0n) {
      alert("Select a percentage greater than 0%.");
      return;
    }

    try {
      setTxPending(true);
      setTxHash(null);
      setError(null);

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // 1% slippage sui token in uscita
      const minARaw =
        (amountARawToRemove * 99n) / 100n;
      const minBRaw =
        (amountBRawToRemove * 99n) / 100n;

      const router = new Contract(
        UNISWAP_V2_ROUTER,
        UNISWAP_V2_ROUTER_ABI,
        signer
      );

      // approve LP token (pairAddress) verso router
      await ensureAllowance(
        signer,
        pool.pairAddress,
        address,
        UNISWAP_V2_ROUTER,
        amountLpToRemoveRaw
      );

      const deadline =
        Math.floor(Date.now() / 1000) + 60 * 10;

      const tx = await router.removeLiquidity(
        tokenA.address,
        tokenB.address,
        amountLpToRemoveRaw,
        minARaw,
        minBRaw,
        address,
        deadline
      );

      setTxHash(tx.hash);
      await tx.wait();
      setTxPending(false);

      if (typeof onAfterAction === "function") {
        onAfterAction();
      }

      onClose();
    } catch (e) {
      console.error("removeLiquidity error:", e);
      let msg = "Remove liquidity failed.";
      if (e?.info?.error?.message) msg = e.info.error.message;
      else if (e?.message) msg = e.message;
      setError(msg);
      setTxPending(false);
    }
  };

  /* ---------------- RENDER ---------------- */

  const lpHasBalance = lpBalanceRaw > 0n;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950/95 shadow-2xl shadow-black/70 px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-rose-400/80">
              Remove liquidity
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
            Connect your wallet from the top-right button to manage
            your liquidity.
          </div>
        )}

        {isConnected && !isOnSepolia && (
          <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
            You are on a different network. Switch your wallet to{" "}
            <span className="font-semibold">Sepolia</span> to remove
            liquidity.
          </div>
        )}

        {loadingData && (
          <div className="mb-3 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-[11px] text-slate-200">
            Loading your LP balance and pool reserves...
          </div>
        )}

        {!loadingData && !lpHasBalance && (
          <div className="mb-3 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-[11px] text-slate-300">
            You don&apos;t have LP tokens in this pool yet.
          </div>
        )}

        {/* Slider percentuale */}
        <div className="mt-2 space-y-3">
          <div className="flex items-center justify-between text-[11px] text-slate-300">
            <span>Amount to withdraw</span>
            <span>{percent}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
            className="w-full accent-rose-500"
          />
          <div className="flex justify-between text-[11px] text-slate-400">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handlePercentClick(p)}
                className={classNames(
                  "px-2 py-0.5 rounded-full border text-[11px]",
                  percent === p
                    ? "border-rose-400 bg-rose-500/15 text-rose-200"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                )}
              >
                {p}%
              </button>
            ))}
          </div>
        </div>

        {/* Preview LP + token out */}
        <div className="mt-4 space-y-2 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2.5 text-[11px] text-slate-300">
          <div className="flex items-center justify-between">
            <span>Your LP</span>
            <span className="text-slate-100">{previewLp}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Estimated out ({symA})</span>
            <span className="text-slate-100">
              {previewA} {symA}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Estimated out ({symB})</span>
            <span className="text-slate-100">
              {previewB} {symB}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            You will receive at least 99% of the estimated amounts
            (1% slippage tolerance on withdrawal).
          </p>
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
            onClick={handleWithdraw}
            disabled={
              txPending ||
              !isConnected ||
              !isOnSepolia ||
              !pool.hasOnChainPool ||
              !lpHasBalance
            }
            className={classNames(
              "rounded-full px-4 py-1.5 text-[11px] font-semibold shadow-lg",
              txPending ||
                !isConnected ||
                !isOnSepolia ||
                !pool.hasOnChainPool ||
                !lpHasBalance
                ? "bg-slate-700 text-slate-400 cursor-not-allowed shadow-none"
                : "bg-gradient-to-r from-rose-500 to-red-500 text-slate-50 shadow-rose-600/40"
            )}
          >
            {txPending ? "Confirm in wallet..." : "Withdraw liquidity"}
          </button>
        </div>
      </div>
    </div>
  );
}
