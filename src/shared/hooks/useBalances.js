// src/shared/hooks/useBalances.js
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TOKENS,
  getErc20,
  getReadOnlyProvider,
  getProvider,
} from "../config/web3";
import { Interface, formatUnits } from "ethers";
import { getRealtimeClient, TRANSFER_TOPIC } from "../services/realtime";
import { MULTICALL3_ADDRESS } from "../config/addresses";
import { MULTICALL3_ABI, ERC20_ABI } from "../config/abis";
import { multicall, hasMulticall } from "../services/multicall";

import { getActiveNetworkConfig } from "../config/networks";

export function useBalances(address, chainId, tokenRegistry = TOKENS) {
  const activeNetworkId = (getActiveNetworkConfig()?.id || "mainnet").toLowerCase();
  const activeChainHex = (getActiveNetworkConfig()?.chainIdHex || "").toLowerCase();
  const normalizeChainHex = (value) => {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    if (str.startsWith("0x") || str.startsWith("0X")) return str.toLowerCase().replace(/^0x0+/, "0x");
    const num = Number(str);
    if (Number.isFinite(num)) return `0x${num.toString(16)}`;
    return str.toLowerCase();
  };
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
        // Prefer the wallet provider when available, even if preset and wallet mismatch,
        // to avoid missing balances when the app preset lags the wallet chain.
        const preferWallet = Boolean(walletChainId);
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

        const next = { ...makeZeroBalances(), ETH: eth };
        // Batch ERC20 decimals + balances via Multicall3 when available
        const erc20Keys = tokenKeys.filter((k) => k !== "ETH");
        const useMc = await hasMulticall(provider).catch(() => false);
        if (useMc && erc20Keys.length) {
          const iface = new Interface(ERC20_ABI);
          const callMeta = [];
          erc20Keys.forEach((key) => {
            const token = tokenRegistry[key];
            if (!token?.address) return;
            const addr = token.address;
            const lower = addr.toLowerCase();
            if (decimalsCache.current[lower] === undefined) {
              callMeta.push({
                type: "decimals",
                tokenKey: key,
                target: addr,
                callData: iface.encodeFunctionData("decimals", []),
              });
            }
            callMeta.push({
              type: "balance",
              tokenKey: key,
              target: addr,
              callData: iface.encodeFunctionData("balanceOf", [walletAddress]),
            });
          });

          try {
            const results = await withRpcRetry((prov) =>
              multicall(callMeta.map((c) => ({ target: c.target, callData: c.callData })), prov)
            );
            results.forEach((res, idx) => {
              const meta = callMeta[idx];
              if (!res.success) return;
              try {
                if (meta.type === "decimals") {
                  const dec = Number(iface.decodeFunctionResult("decimals", res.returnData)[0]);
                  const lower = meta.target.toLowerCase();
                  decimalsCache.current[lower] = Number.isFinite(dec) ? dec : tokenRegistry[meta.tokenKey]?.decimals;
                } else if (meta.type === "balance") {
                  const raw = iface.decodeFunctionResult("balanceOf", res.returnData)[0];
                  const token = tokenRegistry[meta.tokenKey];
                  const lower = meta.target.toLowerCase();
                  const dec =
                    decimalsCache.current[lower] !== undefined
                      ? decimalsCache.current[lower]
                      : token?.decimals;
                  const num = Number(formatUnits(raw, dec || 18));
                  if (Number.isFinite(num)) next[meta.tokenKey] = num;
                }
              } catch {
                // ignore malformed decode
              }
            });
          } catch (err) {
            console.warn("Multicall balances failed, falling back:", err?.message || err);
          }
        }

        // Fallback or fill missing tokens with direct RPC
        await Promise.all(
          erc20Keys.map(async (key) => {
            if (typeof next[key] === "number" && next[key] !== undefined) return;
            const token = tokenRegistry[key];
            if (!token?.address) return;
            try {
              const doRead = async (prov) => {
                const contract = await getErc20(token.address, prov);
                const cacheKey = token.address.toLowerCase();
                let decimals = decimalsCache.current[cacheKey];
                if (decimals === undefined) {
                  try {
                    decimals = Number(await contract.decimals());
                  } catch {
                    decimals = token.decimals;
                  }
                  decimalsCache.current[cacheKey] = decimals;
                }
                const raw = await contract.balanceOf(walletAddress);
                return Number(formatUnits(raw, decimals || token.decimals || 18));
              };
              next[key] = await withRpcRetry(doRead);
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
                  `Balance lookup failed for ${key} at ${token.address}:`,
                  msg || err
                );
              }
              next[key] = next[key] || 0;
            }
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
    [address, chainId, tokenRegistry, makeZeroBalances, tokenKeys, activeChainHex]
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
    let visibilityHandler;

    const handleBlock = () => refresh(address);

    const setupListener = async () => {
      try {
        provider = getReadOnlyProvider();
        provider.on("block", handleBlock);

        visibilityHandler = () => {
          if (document.hidden) {
            provider.off("block", handleBlock);
          } else {
            provider.off("block", handleBlock);
            provider.on("block", handleBlock);
            refresh(address); // immediate refresh on focus
          }
        };
        if (typeof document !== "undefined") {
          document.addEventListener("visibilitychange", visibilityHandler);
        }
        if (typeof window !== "undefined") {
          window.addEventListener("focus", visibilityHandler);
        }
      } catch (e) {
        console.error("Error starting balance watcher:", e);
      }
    };

    setupListener();

    return () => {
      if (provider) provider.off("block", handleBlock);
      if (typeof document !== "undefined" && visibilityHandler) {
        document.removeEventListener("visibilitychange", visibilityHandler);
      }
      if (typeof window !== "undefined" && visibilityHandler) {
        window.removeEventListener("focus", visibilityHandler);
      }
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
