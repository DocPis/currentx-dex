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
    DAI: 0,
    WBTC: 0,
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

        // Helper per leggere i token ERC20 solo se abbiamo l'indirizzo
        const getErc20Balance = async (tokenKey) => {
          const token = TOKENS[tokenKey];
          if (!token?.address) return 0;
          const contract = await getErc20(token.address, provider);
          const raw = await contract.balanceOf(walletAddress);
          return Number(formatUnits(raw, token.decimals));
        };

        const weth = await getErc20Balance("WETH");
        const usdc = await getErc20Balance("USDC");
        const dai = await getErc20Balance("DAI");
        const wbtc = await getErc20Balance("WBTC");

        setBalances({
          ETH: eth,
          WETH: weth,
          USDC: usdc,
          DAI: dai,
          WBTC: wbtc,
        });
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
      setBalances({ ETH: 0, WETH: 0, USDC: 0, DAI: 0, WBTC: 0 });
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
