// src/hooks/useWallet.js
import { useEffect, useState } from "react";
import { BrowserProvider } from "ethers";
import {
  SEPOLIA_CHAIN_ID_HEX,
  getProvider,
  getInjectedEthereum,
  getInjectedProviderByType,
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

  const connect = async (walletType) => {
    const injected = walletType
      ? getInjectedProviderByType(walletType)
      : getInjectedEthereum();
    if (!injected) {
      throw new Error(
        "Selected wallet not detected. Please install/open the chosen wallet and retry."
      );
    }
    const provider = new BrowserProvider(injected);
    const requester = injected.request ? injected : provider;
    const accounts = await (requester.request
      ? requester.request({ method: "eth_requestAccounts", params: [] })
      : provider.send("eth_requestAccounts", []));
    if (!accounts || !accounts.length) {
      throw new Error(
        "No account returned. Please unlock the selected wallet and approve the connection."
      );
    }
    const primaryAccount = accounts[0] || null;
    setAddress(primaryAccount);
    const cid = await provider.send("eth_chainId", []);
    setChainId(cid);
    return primaryAccount;
  };

  const disconnect = () => {
    setAddress(null);
    setChainId(null);
  };

  const isOnSepolia = chainId === SEPOLIA_CHAIN_ID_HEX;

  return { address, chainId, isOnSepolia, connect, disconnect };
}
