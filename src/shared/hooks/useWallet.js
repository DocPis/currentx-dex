// src/shared/hooks/useWallet.js
import { useEffect, useState } from "react";
import { BrowserProvider } from "ethers";
import {
  SEPOLIA_CHAIN_ID_HEX,
  getInjectedEthereum,
  getInjectedProviderByType,
  setActiveInjectedProvider,
} from "../config/web3";

const SESSION_KEY = "cx_session_connected";
const NORMALIZED_SEPOLIA_CHAIN_ID = SEPOLIA_CHAIN_ID_HEX.toLowerCase();

const normalizeChainId = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return `0x${value.toString(16)}`.toLowerCase();
  const str = String(value).trim();
  if (str.startsWith("0x") || str.startsWith("0X")) return str.toLowerCase();
  const asNumber = Number(str);
  if (Number.isFinite(asNumber)) {
    return `0x${asNumber.toString(16)}`.toLowerCase();
  }
  return str.toLowerCase();
};

export function useWallet() {
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [sessionConnected, setSessionConnected] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let removeListeners = null;
    let initTimeout;

    const initWithProvider = (eth) => {
      if (!eth) return;
      setActiveInjectedProvider(eth);

      const handleAccountsChanged = (accounts) => {
        setAddress(accounts[0] || null);
      };

      const handleChainChanged = (chainIdHex) => {
        setChainId(normalizeChainId(chainIdHex));
      };

      eth
        .request({ method: "eth_accounts" })
        .then((accounts) => {
          if (accounts.length) setAddress(accounts[0]);
        })
        .catch(() => {});

      eth
        .request({ method: "eth_chainId" })
        .then((cid) => setChainId(normalizeChainId(cid)))
        .catch(() => {});

      eth.on("accountsChanged", handleAccountsChanged);
      eth.on("chainChanged", handleChainChanged);

      removeListeners = () => {
        eth.removeListener("accountsChanged", handleAccountsChanged);
        eth.removeListener("chainChanged", handleChainChanged);
      };
    };

    const attemptInit = () => {
      if (!sessionConnected) return;
      const eth = getInjectedEthereum();
      if (eth && !removeListeners) {
        initWithProvider(eth);
      }
    };

    attemptInit();

    if (!getInjectedEthereum() && sessionConnected) {
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
  }, [sessionConnected]);

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
    let accounts;
    try {
      accounts = await (requester.request
        ? requester.request({ method: "eth_requestAccounts", params: [] })
        : provider.send("eth_requestAccounts", []));
    } catch (err) {
      const rpcCode =
        err?.info?.error?.code ??
        err?.error?.code ??
        err?.code ??
        err?.data?.code;
      if (rpcCode === -32002) {
        throw new Error(
          "A connection request is already pending in your wallet. Open your wallet, finish/cancel it, then try again."
        );
      }
      if (rpcCode === 4001 || err?.code === "ACTION_REJECTED") {
        throw new Error("Connection request was rejected in the wallet.");
      }
      throw err;
    }
    if (!accounts || !accounts.length) {
      throw new Error(
        "No account returned. Please unlock the selected wallet and approve the connection."
      );
    }
    const primaryAccount = accounts[0] || null;
    setAddress(primaryAccount);
    const cid = await provider.send("eth_chainId", []);
    setChainId(normalizeChainId(cid));
    setActiveInjectedProvider(injected);
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
      setSessionConnected(true);
    } catch {
      // ignore
    }
    return primaryAccount;
  };

  const disconnect = () => {
    setAddress(null);
    setChainId(null);
    setActiveInjectedProvider(null);
    try {
      sessionStorage.removeItem(SESSION_KEY);
      setSessionConnected(false);
    } catch {
      // ignore
    }
  };

  const isOnSepolia = chainId === NORMALIZED_SEPOLIA_CHAIN_ID;

  return { address, chainId, isOnSepolia, connect, disconnect };
}
