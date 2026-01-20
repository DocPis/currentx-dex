// src/shared/hooks/useBalances.js
import { useCallback, useEffect, useRef, useState } from "react";
import {
  TOKENS,
  getProvider,
  getErc20,
} from "../config/web3";
import { formatUnits } from "ethers";
import { getRealtimeClient, TRANSFER_TOPIC } from "../services/realtime";

export function useBalances(address) {
  const tokenKeys = useMemo(() => {
    return Object.keys(TOKENS).filter((k) => k === "ETH" || TOKENS[k]?.address);
  }, []);
  const makeZeroBalances = useCallback(
    () =>
      tokenKeys.reduce((acc, key) => {
        acc[key] = 0;
        return acc;
      }, {}),
    [tokenKeys]
  );

  const [balances, setBalances] = useState(() => makeZeroBalances());
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

        // Helper to read ERC20 balances only when we have an address
        const getErc20Balance = async (tokenKey) => {
          const token = TOKENS[tokenKey];
          if (!token?.address) return 0;
          try {
            const contract = await getErc20(token.address, provider);
            const raw = await contract.balanceOf(walletAddress);
            return Number(formatUnits(raw, token.decimals));
          } catch (err) {
            console.warn(
              `Balance lookup failed for ${tokenKey} at ${token.address}:`,
              err?.message || err
            );
            return 0;
          }
        };

        const next = { ...makeZeroBalances(), ETH: eth };
        await Promise.all(
          tokenKeys
            .filter((k) => k !== "ETH")
            .map(async (key) => {
              next[key] = await getErc20Balance(key);
            })
        );
        setBalances(next);
      } catch (e) {
        console.error("Error loading balances:", e?.message || e);
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
      setBalances(makeZeroBalances());
    }
  }, [address, refresh, makeZeroBalances]);

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

  // Native ETH realtime via stateChanges
  useEffect(() => {
    if (!address) return undefined;
    const client = getRealtimeClient();
    const lower = address.toLowerCase();

    const unsubscribe = client.addStateChangeListener([lower], (change) => {
      const changedAddr = (change?.address || "").toLowerCase();
      if (!change || changedAddr !== lower) return;
      if (!change.balance) return;
      try {
        const eth = Number(formatUnits(change.balance, TOKENS.ETH.decimals));
        setBalances((prev) => ({ ...prev, ETH: Number.isFinite(eth) ? eth : prev.ETH }));
      } catch {
        // ignore malformed payloads
      }
    });

    return unsubscribe;
  }, [address]);

  // Token deltas in near-real time via miniBlocks (Transfer events)
  useEffect(() => {
    if (!address) return undefined;
    const client = getRealtimeClient();
    const lowerAddress = address.toLowerCase();
    const tokenMap = Object.values(TOKENS).reduce((acc, token) => {
      if (token.address) {
        acc[token.address.toLowerCase()] = token;
      }
      return acc;
    }, {});

    const topicToAddress = (topic) => {
      if (typeof topic !== "string" || topic.length < 42) return "";
      return `0x${topic.slice(-40)}`.toLowerCase();
    };

    const handleMiniBlock = (mini) => {
      const receipts = mini?.receipts;
      if (!Array.isArray(receipts) || !receipts.length) return;

      const deltas = {};

      receipts.forEach((rcpt) => {
        if (!Array.isArray(rcpt.logs)) return;
        rcpt.logs.forEach((log) => {
          const tokenMeta = tokenMap[(log?.address || "").toLowerCase()];
          if (!tokenMeta) return;
          const topics = log.topics || [];
          if (!topics.length || topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return;

          const from = topicToAddress(topics[1]);
          const to = topicToAddress(topics[2]);
          if (from !== lowerAddress && to !== lowerAddress) return;

          try {
            const value = BigInt(log.data || "0x0");
            if (value === 0n) return;
            const key = tokenMeta.symbol;
            if (!deltas[key]) deltas[key] = 0n;
            if (from === lowerAddress) deltas[key] -= value;
            if (to === lowerAddress) deltas[key] += value;
          } catch {
            // ignore malformed value
          }
        });
      });

      if (!Object.keys(deltas).length) return;

      setBalances((prev) => {
        const next = { ...prev };
        Object.entries(deltas).forEach(([symbol, deltaRaw]) => {
          const token = TOKENS[symbol];
          if (!token) return;
          const negative = deltaRaw < 0n;
          const magnitude = negative ? -deltaRaw : deltaRaw;
          const deltaNum =
            Number(formatUnits(magnitude, token.decimals)) * (negative ? -1 : 1);
          if (!Number.isFinite(deltaNum) || deltaNum === 0) return;
          const current = typeof prev[symbol] === "number" ? prev[symbol] : 0;
          const updated = current + deltaNum;
          next[symbol] = updated < 0 ? 0 : updated;
        });
        return next;
      });
    };

    const unsubscribe = client.addMiniBlockListener(handleMiniBlock);
    return unsubscribe;
  }, [address]);

  return { balances, loading, refresh };
}
