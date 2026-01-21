// src/shared/hooks/useBalances.js
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TOKENS,
  getErc20,
  getReadOnlyProvider,
  getProvider,
} from "../config/web3";
import { formatUnits } from "ethers";
import { getRealtimeClient, TRANSFER_TOPIC } from "../services/realtime";

import { getActiveNetworkConfig } from "../config/networks";

export function useBalances(address, chainId, tokenRegistry = TOKENS) {
  const activeNetworkId = (getActiveNetworkConfig()?.id || "mainnet").toLowerCase();
  const tokenKeys = useMemo(() => {
    return Object.keys(tokenRegistry).filter((k) => k === "ETH" || tokenRegistry[k]?.address);
  }, [tokenRegistry]);
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
  const decimalsCache = useRef({});

  const refresh = useCallback(
    async (walletAddress = address) => {
      if (!walletAddress) return;
      if (isRefreshing.current) {
        pendingAddress.current = walletAddress;
        return;
      }

      isRefreshing.current = true;
      try {
        setLoading(true);
        const activeChainId = (getActiveNetworkConfig()?.chainIdHex || "").toLowerCase();
        const walletChainId = (chainId || "").toLowerCase();
        const preferWallet = walletChainId && walletChainId === activeChainId;
        let provider;
        let rotated = false;
        const shouldRotate = (err) => {
          const code =
            err?.code ??
            err?.error?.code ??
            err?.data?.code ??
            err?.info?.error?.code ??
            null;
          const httpStatus = err?.data?.httpStatus ?? err?.error?.data?.httpStatus;
          const msg = (err?.message || "").toLowerCase();
          return (
            code === -32005 ||
            httpStatus === 429 ||
            msg.includes("rate limit") ||
            msg.includes("coalesce") ||
            msg.includes("limit") ||
            msg.includes("too many")
          );
        };
        const swapProviderOnError = () => {
          rotated = true;
          return getReadOnlyProvider(true, true);
        };
        if (preferWallet) {
          try {
            provider = await getProvider();
          } catch {
            provider = getReadOnlyProvider();
          }
        } else {
          provider = getReadOnlyProvider(false, true);
        }

        const withRpcRetry = async (fn) => {
          try {
            return await fn(provider);
          } catch (err) {
            if (shouldRotate(err) && !rotated) {
              provider = swapProviderOnError();
              return fn(provider);
            }
            throw err;
          }
        };

        // ETH
        let eth = 0;
        try {
          const ethBalance = await withRpcRetry((prov) => prov.getBalance(walletAddress));
          eth = Number(formatUnits(ethBalance, TOKENS.ETH.decimals));
        } catch (err) {
          console.warn("ETH balance lookup failed:", err?.message || err);
        }

        // Helper to read ERC20 balances only when we have an address
        const getErc20Balance = async (tokenKey) => {
          const token = tokenRegistry[tokenKey];
          if (!token?.address) return 0;
          try {
            const doRead = async (prov) => {
              const contract = await getErc20(token.address, prov);
              const key = token.address.toLowerCase();
              let decimals = decimalsCache.current[key];
              if (decimals === undefined) {
                try {
                  decimals = Number(await contract.decimals());
                } catch {
                  decimals = token.decimals;
                }
                decimalsCache.current[key] = decimals;
              }
              const raw = await contract.balanceOf(walletAddress);
              return Number(formatUnits(raw, decimals || token.decimals || 18));
            };
            return withRpcRetry(doRead);
          } catch (err) {
            const msg = err?.message || "";
            const silent =
              msg.toLowerCase().includes("missing revert data") ||
              msg.toLowerCase().includes("call_exception") ||
              msg.toLowerCase().includes("could not") ||
              msg.toLowerCase().includes("rate") ||
              msg.toLowerCase().includes("limit");
            if (!silent) {
              console.warn(
                `Balance lookup failed for ${tokenKey} at ${token.address}:`,
                msg || err
              );
            }
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
        const msg = e?.message || "";
        const silent =
          msg.toLowerCase().includes("missing revert data") ||
          msg.toLowerCase().includes("call_exception") ||
          msg.toLowerCase().includes("could not") ||
          msg.toLowerCase().includes("limit") ||
          msg.toLowerCase().includes("rate");
        if (!silent) {
          console.error("Error loading balances:", msg || e);
        }
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
    [address, chainId, tokenRegistry, makeZeroBalances, tokenKeys]
  );

  useEffect(() => {
    if (address) {
      refresh(address);
    } else {
      setBalances(makeZeroBalances());
    }
  }, [address, chainId, refresh, makeZeroBalances]);

  useEffect(() => {
    if (!address) return undefined;

    let provider;
    const handleBlock = () => refresh(address);

    const setupListener = async () => {
      try {
        provider = getReadOnlyProvider();
        provider.on("block", handleBlock);
      } catch (e) {
        console.error("Error starting balance watcher:", e);
      }
    };

    setupListener();

    return () => {
      if (provider) provider.off("block", handleBlock);
    };
  }, [address, chainId, refresh]);

  // Native ETH realtime via stateChanges
  useEffect(() => {
    if (!address) return undefined;
    if (activeNetworkId !== "mainnet") return undefined; // realtime feed is mainnet-only
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
  }, [activeNetworkId, address]);

  // Token deltas in near-real time via miniBlocks (Transfer events)
  useEffect(() => {
    if (!address) return undefined;
    if (activeNetworkId !== "mainnet") return undefined; // realtime feed is mainnet-only
    const client = getRealtimeClient();
    const lowerAddress = address.toLowerCase();
    const tokenMap = Object.values(tokenRegistry).reduce((acc, token) => {
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
  }, [activeNetworkId, address, tokenRegistry]);

  return { balances, loading, refresh };
}
