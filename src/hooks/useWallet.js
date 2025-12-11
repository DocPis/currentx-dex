// src/hooks/useWallet.js
import { useEffect, useState } from "react";
import { SEPOLIA_CHAIN_ID_HEX, getProvider } from "../config/web3";

export function useWallet() {
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);

  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts) => {
      setAddress(accounts[0] || null);
    };

    const handleChainChanged = (chainIdHex) => {
      setChainId(chainIdHex);
    };

    window.ethereum
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        if (accounts.length) setAddress(accounts[0]);
      })
      .catch(() => {});

    window.ethereum
      .request({ method: "eth_chainId" })
      .then(setChainId)
      .catch(() => {});

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum.removeListener(
        "accountsChanged",
        handleAccountsChanged
      );
      window.ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, []);

  const connect = async () => {
    if (!window.ethereum) throw new Error("No wallet found");
    const provider = await getProvider();
    const accounts = await provider.send("eth_requestAccounts", []);
    setAddress(accounts[0] || null);
    const cid = await provider.send("eth_chainId", []);
    setChainId(cid);
  };

  const isOnSepolia = chainId === SEPOLIA_CHAIN_ID_HEX;

  return { address, chainId, isOnSepolia, connect };
}
