import { useEffect, useState } from "react";
import { BrowserProvider, Contract, MaxUint256, parseUnits } from "ethers";
import { ERC20_ABI, UNISWAP_V2_ROUTER } from "../config/uniswapSepolia";

export function useTokenAllowance({ address, token, amount }) {
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [hasAllowance, setHasAllowance] = useState(true);
  const [error, setError] = useState(null);

  async function check() {
    if (!address || !token || !token.address) {
      setHasAllowance(true);
      return;
    }

    // ETH non richiede approve
    if (token.symbol === "ETH") {
      setHasAllowance(true);
      return;
    }

    try {
      setLoading(true);
      const provider = new BrowserProvider(window.ethereum);
      const erc20 = new Contract(token.address, ERC20_ABI, provider);

      const allowance = await erc20.allowance(address, UNISWAP_V2_ROUTER);

      const amountUnits = parseUnits(amount || "0", token.decimals || 18);

      setHasAllowance(allowance >= amountUnits);
    } catch (err) {
      console.error("Allowance check failed:", err);
      setHasAllowance(false);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function approve() {
    if (!address || !token || !token.address) return false;

    try {
      setApproving(true);
      setError(null);

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const erc20 = new Contract(token.address, ERC20_ABI, signer);

      const tx = await erc20.approve(UNISWAP_V2_ROUTER, MaxUint256);

      await tx.wait();

      // dopo approvazione → allowance completa
      setHasAllowance(true);
      return true;
    } catch (err) {
      console.error("Approve failed:", err);
      setError(err.message);
      return false;
    } finally {
      setApproving(false);
    }
  }

  useEffect(() => {
    check();
  }, [address, token?.address, amount]);

  return {
    hasAllowance,
    loading,
    approving,
    error,
    approve,
    check,
  };
}
