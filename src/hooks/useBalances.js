// src/hooks/useBalances.js
import { useCallback, useEffect, useRef, useState } from "react";
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
  const isRefreshing = useRef(false);
  const pendingAddress = useRef(null);

  const refresh = useCallback(
    async (walletAddress = address) => {
      if (!walletAddress || !window.ethereum) return;
      if (isRefreshing.current) {
        pendingAddress.current = walletAddress;
        return;
      }

      isRefreshing.current = true;
      try {
        setLoading(true);
        const provider = await getProvider();

        // ETH
        const ethBalance = await provider.getBalance(walletAddress);
        const eth = Number(formatUnits(ethBalance, TOKENS.ETH.decimals));

        // WETH
        const wethContract = await getErc20(
          TOKENS.WETH.address,
          provider
        );
        const wethRaw = await wethContract.balanceOf(walletAddress);
        const weth = Number(
          formatUnits(wethRaw, TOKENS.WETH.decimals)
        );

        // USDC
        const usdcContract = await getErc20(
          TOKENS.USDC.address,
          provider
        );
        const usdcRaw = await usdcContract.balanceOf(walletAddress);
        const usdc = Number(
          formatUnits(usdcRaw, TOKENS.USDC.decimals)
        );

        setBalances({ ETH: eth, WETH: weth, USDC: usdc });
      } catch (e) {
        console.error("Error loading balances:", e);
      } finally {
        setLoading(false);
        isRefreshing.current = false;
        if (pendingAddress.current) {
          const nextAddress = pendingAddress.current;
          pendingAddress.current = null;
          refresh(nextAddress);
        }
      }
    },
    [address]
  );

  useEffect(() => {
    if (address) {
      refresh(address);
    } else {
      setBalances({ ETH: 0, WETH: 0, USDC: 0 });
    }
  }, [address, refresh]);

  useEffect(() => {
    if (!address) return undefined;

    let provider;
    const handleBlock = () => refresh(address);

    const setupListener = async () => {
      try {
        provider = await getProvider();
        provider.on("block", handleBlock);
      } catch (e) {
        console.error("Error starting balance watcher:", e);
      }
    };

    setupListener();

    return () => {
      if (provider) provider.off("block", handleBlock);
    };
  }, [address, refresh]);

  return { balances, loading, refresh };
}
