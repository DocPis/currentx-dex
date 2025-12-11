// src/hooks/useBalances.js
import { useEffect, useState } from "react";
import {
  TOKENS,
  getProvider,
  getErc20,
} from "../config/web3";
import { formatUnits } from "ethers";

export function useBalances(address) {
  const [balances, setBalances] = useState({
    ETH: 0,
    WETH: 0,
    USDC: 0,
  });
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!address || !window.ethereum) return;
    try {
      setLoading(true);
      const provider = await getProvider();

      // ETH
      const ethBalance = await provider.getBalance(address);
      const eth = Number(formatUnits(ethBalance, TOKENS.ETH.decimals));

      // WETH
      const wethContract = await getErc20(
        TOKENS.WETH.address,
        provider
      );
      const wethRaw = await wethContract.balanceOf(address);
      const weth = Number(
        formatUnits(wethRaw, TOKENS.WETH.decimals)
      );

      // USDC
      const usdcContract = await getErc20(
        TOKENS.USDC.address,
        provider
      );
      const usdcRaw = await usdcContract.balanceOf(address);
      const usdc = Number(
        formatUnits(usdcRaw, TOKENS.USDC.decimals)
      );

      setBalances({ ETH: eth, WETH: weth, USDC: usdc });
    } catch (e) {
      console.error("Error loading balances:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (address) {
      refresh();
    } else {
      setBalances({ ETH: 0, WETH: 0, USDC: 0 });
    }
  }, [address]);

  return { balances, loading, refresh };
}
