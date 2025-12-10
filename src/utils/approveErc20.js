import { Contract, MaxUint256 } from "ethers";
import { ERC20_ABI, UNISWAP_V2_ROUTER } from "../config/uniswapSepolia";

export async function approveIfNeeded({
  signer,
  tokenAddress,
  owner,
  amountInUnits,
  setSwapState,
}) {
  try {
    const token = new Contract(tokenAddress, ERC20_ABI, signer);

    // --- 1. Check current allowance
    const currentAllowance = await token.allowance(owner, UNISWAP_V2_ROUTER);

    // Se è già sufficiente → non serve approve
    if (currentAllowance >= amountInUnits) {
      return true;
    }

    setSwapState({ status: "pending", txHash: null, error: null });

    // --- 2. Do unlimited approval (recommended UX)
    const tx = await token.approve(UNISWAP_V2_ROUTER, MaxUint256);

    setSwapState((prev) => ({ ...prev, txHash: tx.hash }));
    await tx.wait();

    return true;
  } catch (err) {
    console.error("Approve error:", err);
    let msg = "Approval failed.";
    if (err?.info?.error?.message) msg = err.info.error.message;
    else if (err?.message) msg = err.message;

    setSwapState({ status: "error", txHash: null, error: msg });
    return false;
  }
}
