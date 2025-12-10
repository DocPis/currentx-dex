// src/utils/wrapUnwrap.js
import { BrowserProvider, Contract, parseEther } from "ethers";
import {
  SEPOLIA_CHAIN_ID_HEX,
  WETH_ADDRESS,
  WETH_ABI,
} from "../config/uniswapSepolia";

/**
 * Wrap ETH -> WETH (1:1)
 */
export async function wrapEthToWeth({
  amountInStr,
  address,
  chainId,
  onRefreshBalances,
  setSwapState,
}) {
  if (!window.ethereum) {
    alert("No wallet detected");
    return;
  }
  if (!address || chainId !== SEPOLIA_CHAIN_ID_HEX) {
    alert("Connect wallet on Sepolia first.");
    return;
  }

  try {
    const amountNum = parseFloat(amountInStr);
    if (!amountNum || amountNum <= 0) {
      alert("Invalid amount.");
      return;
    }

    setSwapState({ status: "pending", txHash: null, error: null });

    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const weth = new Contract(WETH_ADDRESS, WETH_ABI, signer);

    const value = parseEther(amountInStr);
    const tx = await weth.deposit({ value });

    setSwapState((prev) => ({ ...prev, txHash: tx.hash }));
    await tx.wait();
    setSwapState((prev) => ({ ...prev, status: "done" }));

    if (onRefreshBalances) await onRefreshBalances();
  } catch (err) {
    console.error("Wrap error:", err);
    let msg = "Wrap failed.";
    if (err?.info?.error?.message) msg = err.info.error.message;
    else if (err?.message) msg = err.message;
    setSwapState({ status: "error", txHash: null, error: msg });
  } finally {
    setTimeout(() => {
      setSwapState((prev) =>
        prev.status === "pending" ? { ...prev, status: "idle" } : prev
      );
    }, 3000);
  }
}

/**
 * Unwrap WETH -> ETH (1:1)
 */
export async function unwrapWethToEth({
  amountInStr,
  address,
  chainId,
  getBalanceFor,       // funzione dal componente
  onRefreshBalances,
  setSwapState,
}) {
  if (!window.ethereum) {
    alert("No wallet detected");
    return;
  }
  if (!address || chainId !== SEPOLIA_CHAIN_ID_HEX) {
    alert("Connect wallet on Sepolia first.");
    return;
  }

  try {
    const amountNum = parseFloat(amountInStr);
    if (!amountNum || amountNum <= 0) {
      alert("Invalid amount.");
      return;
    }

    const wethBal = getBalanceFor("WETH");
    if (wethBal != null && amountNum > wethBal + 1e-12) {
      alert("Insufficient WETH balance to unwrap.");
      return;
    }

    setSwapState({ status: "pending", txHash: null, error: null });

    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const weth = new Contract(WETH_ADDRESS, WETH_ABI, signer);

    const amountUnits = parseEther(amountInStr);
    const tx = await weth.withdraw(amountUnits);

    setSwapState((prev) => ({ ...prev, txHash: tx.hash }));
    await tx.wait();
    setSwapState((prev) => ({ ...prev, status: "done" }));

    if (onRefreshBalances) await onRefreshBalances();
  } catch (err) {
    console.error("Unwrap error:", err);
    let msg = "Unwrap failed.";
    if (err?.info?.error?.message) msg = err.info.error.message;
    else if (err?.message) msg = err.message;
    setSwapState({ status: "error", txHash: null, error: msg });
  } finally {
    setTimeout(() => {
      setSwapState((prev) =>
        prev.status === "pending" ? { ...prev, status: "idle" } : prev
      );
    }, 3000);
  }
}
