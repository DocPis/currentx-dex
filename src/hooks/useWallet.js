// src/hooks/useWallet.js
import { useEffect, useState } from "react";
import {
  SEPOLIA_CHAIN_ID_HEX,
  getProvider,
  getInjectedEthereum,
} from "../config/web3";

export function useWallet() {
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);

  useEffect(() => {
    let removeListeners = null;
    let initTimeout;

    const initWithProvider = (eth) => {
      if (!eth) return;

      const handleAccountsChanged = (accounts) => {
        setAddress(accounts[0] || null);
      };

      const handleChainChanged = (chainIdHex) => {
        setChainId(chainIdHex);
      };

      eth
        .request({ method: "eth_accounts" })
        .then((accounts) => {
          if (accounts.length) setAddress(accounts[0]);
        })
        .catch(() => {});

      eth
        .request({ method: "eth_chainId" })
        .then(setChainId)
        .catch(() => {});

      eth.on("accountsChanged", handleAccountsChanged);
      eth.on("chainChanged", handleChainChanged);

      removeListeners = () => {
        eth.removeListener("accountsChanged", handleAccountsChanged);
        eth.removeListener("chainChanged", handleChainChanged);
      };
    };

    const attemptInit = () => {
      const eth = getInjectedEthereum();
      if (eth && !removeListeners) {
        initWithProvider(eth);
      }
    };

    attemptInit();

    if (!getInjectedEthereum()) {
      const handleEthereumInit = () => attemptInit();
      window.addEventListener(
        "ethereum#initialized",
        handleEthereumInit,
        { once: true }
      );
      initTimeout = setTimeout(attemptInit, 1200);

      return () => {
        clearTimeout(initTimeout);
        window.removeEventListener(
          "ethereum#initialized",
          handleEthereumInit
        );
        if (removeListeners) removeListeners();
      };
    }

    return () => {
      if (initTimeout) clearTimeout(initTimeout);
      if (removeListeners) removeListeners();
    };
  }, []);

  const connect = async () => {
    if (!window.ethereum) throw new Error("No wallet found");
    const provider = await getProvider();
    const accounts = await provider.send("eth_requestAccounts", []);
    const primaryAccount = accounts[0] || null;
    setAddress(primaryAccount);
    const cid = await provider.send("eth_chainId", []);
    setChainId(cid);
    return primaryAccount;
  };

  const isOnSepolia = chainId === SEPOLIA_CHAIN_ID_HEX;

  return { address, chainId, isOnSepolia, connect };
}
