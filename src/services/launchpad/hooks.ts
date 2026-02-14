import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  fetchLaunchpadActivity,
  fetchLaunchpadTokenActivity,
  fetchLaunchpadTokenCandles,
  fetchLaunchpadTokenDetail,
  fetchLaunchpadTokens,
  getLaunchpadWsUrl,
  isLaunchpadUsingMock,
} from "./launchpadApi";
import type {
  LaunchpadActivityQuery,
  LaunchpadCandle,
  LaunchpadFilter,
  LaunchpadSort,
  LaunchpadTokenCard,
  LaunchpadTrade,
  LaunchpadTokensResponse,
  UseLiveStreamResult,
} from "./types";

const DEFAULT_PAGE_SIZE = 24;
const LIVE_POLL_MS = 4500;

const normalizeHash = (value: string) => String(value || "").toLowerCase();

const mergeTrades = (
  current: LaunchpadTrade[],
  incoming: LaunchpadTrade[],
  maxItems: number
): LaunchpadTrade[] => {
  const map = new Map<string, LaunchpadTrade>();
  [...incoming, ...current].forEach((item) => {
    const key = normalizeHash(item.txHash);
    if (!key || map.has(key)) return;
    map.set(key, item);
  });
  return Array.from(map.values())
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, maxItems);
};

const extractTradesFromPayload = (payload: unknown): LaunchpadTrade[] => {
  if (!payload || typeof payload !== "object") return [];
  const typed = payload as Record<string, unknown>;
  if (Array.isArray(typed.items)) return typed.items as LaunchpadTrade[];
  if (typed.trade && typeof typed.trade === "object") {
    return [typed.trade as LaunchpadTrade];
  }
  if (typed.data && typeof typed.data === "object") {
    const data = typed.data as Record<string, unknown>;
    if (Array.isArray(data.items)) return data.items as LaunchpadTrade[];
    if (data.trade && typeof data.trade === "object") {
      return [data.trade as LaunchpadTrade];
    }
  }
  return [];
};

interface UseLiveStreamOptions {
  enabled?: boolean;
  wsUrl?: string;
  wsParams?: Record<string, string | number | boolean | undefined>;
  pollMs?: number;
  onMessage?: (payload: unknown) => void;
  onPoll?: () => Promise<void>;
}

const buildWsUrl = (url: string, params: UseLiveStreamOptions["wsParams"]) => {
  if (!url) return "";
  if (!params || !Object.keys(params).length) return url;
  const ws = new URL(url, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    ws.searchParams.set(key, String(value));
  });
  return ws.toString();
};

export const useLiveStream = ({
  enabled = true,
  wsUrl = "",
  wsParams,
  pollMs = LIVE_POLL_MS,
  onMessage,
  onPoll,
}: UseLiveStreamOptions): UseLiveStreamResult => {
  const [mode, setMode] = useState<UseLiveStreamResult["mode"]>("idle");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const stopRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setMode("idle");
      return;
    }
    stopRef.current = false;

    const clearPolling = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const runPolling = () => {
      clearPolling();
      let delay = Math.max(2000, Number(pollMs) || LIVE_POLL_MS);
      setMode("polling");

      const tick = async () => {
        if (stopRef.current) return;
        try {
          await onPoll?.();
          setLastUpdatedAt(Date.now());
          delay = Math.max(2000, Number(pollMs) || LIVE_POLL_MS);
        } catch {
          delay = Math.min(Math.floor(delay * 1.7), 30000);
        } finally {
          if (!stopRef.current) {
            timerRef.current = window.setTimeout(tick, delay);
          }
        }
      };

      void tick();
    };

    const canUseWs = Boolean(wsUrl) && typeof window !== "undefined" && typeof WebSocket !== "undefined";
    if (!canUseWs) {
      runPolling();
      return () => {
        stopRef.current = true;
        clearPolling();
      };
    }

    try {
      const connection = new WebSocket(buildWsUrl(wsUrl, wsParams));
      wsRef.current = connection;

      connection.onopen = () => {
        if (stopRef.current) return;
        clearPolling();
        setMode("ws");
      };

      connection.onmessage = (event) => {
        if (stopRef.current) return;
        try {
          const payload = JSON.parse(String(event.data || "{}"));
          onMessage?.(payload);
          setLastUpdatedAt(Date.now());
        } catch {
          // ignore malformed payloads
        }
      };

      connection.onerror = () => {
        if (stopRef.current) return;
        runPolling();
      };

      connection.onclose = () => {
        if (stopRef.current) return;
        runPolling();
      };
    } catch {
      runPolling();
    }

    return () => {
      stopRef.current = true;
      clearPolling();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
      }
      wsRef.current = null;
    };
  }, [enabled, onMessage, onPoll, pollMs, wsParams, wsUrl]);

  return {
    mode,
    isLive: enabled && mode !== "idle",
    lastUpdatedAt,
  };
};

export const useLaunchpadTokens = ({
  q = "",
  sort = "mcap" as LaunchpadSort,
  filters = [] as LaunchpadFilter[],
  pageSize = DEFAULT_PAGE_SIZE,
  enabled = true,
}: {
  q?: string;
  sort?: LaunchpadSort;
  filters?: LaunchpadFilter[];
  pageSize?: number;
  enabled?: boolean;
} = {}) => {
  const normalizedFilters = useMemo(
    () =>
      Array.from(new Set((filters || []).map((value) => String(value || "").trim().toLowerCase()))).filter(Boolean),
    [filters]
  );

  const query = useInfiniteQuery({
    queryKey: ["launchpad", "tokens", q, sort, normalizedFilters.join(","), pageSize],
    initialPageParam: 1,
    enabled,
    queryFn: ({ pageParam = 1, signal }) =>
      fetchLaunchpadTokens(
        {
          page: Number(pageParam) || 1,
          pageSize,
          q,
          sort,
          filters: normalizedFilters,
        },
        signal
      ),
    getNextPageParam: (lastPage: LaunchpadTokensResponse) =>
      lastPage?.hasMore ? lastPage.page + 1 : undefined,
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const items = useMemo(
    () => (query.data?.pages || []).flatMap((page) => page.items || []),
    [query.data]
  );

  const total = query.data?.pages?.[0]?.total || 0;

  return {
    ...query,
    items,
    total,
    isMocked: isLaunchpadUsingMock(),
  };
};

export const useTokenDetail = (tokenAddress?: string) =>
  useQuery({
    queryKey: ["launchpad", "token", String(tokenAddress || "").toLowerCase()],
    enabled: Boolean(tokenAddress),
    queryFn: ({ signal }) => fetchLaunchpadTokenDetail(String(tokenAddress || ""), signal),
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

export const useTokenCandles = (tokenAddress?: string, timeframe = "24h") =>
  useQuery({
    queryKey: ["launchpad", "candles", String(tokenAddress || "").toLowerCase(), timeframe],
    enabled: Boolean(tokenAddress),
    queryFn: ({ signal }) => fetchLaunchpadTokenCandles(String(tokenAddress || ""), timeframe, signal),
    staleTime: 20_000,
    refetchOnWindowFocus: false,
  });

export const useLiveBuys = ({ limit = 18, enabled = true }: { limit?: number; enabled?: boolean } = {}) => {
  const [items, setItems] = useState<LaunchpadTrade[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string>(new Date().toISOString());
  const wsUrl = getLaunchpadWsUrl();

  const initialQuery = useQuery({
    queryKey: ["launchpad", "live-buys", limit],
    enabled,
    queryFn: ({ signal }) => fetchLaunchpadActivity({ type: "buys", limit }, signal),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!initialQuery.data?.items) return;
    setItems(initialQuery.data.items.slice(0, limit));
    setUpdatedAt(initialQuery.data.updatedAt || new Date().toISOString());
  }, [initialQuery.data, limit]);

  const refreshSnapshot = useCallback(async () => {
    const snapshot = await fetchLaunchpadActivity({ type: "buys", limit });
    setItems(snapshot.items.slice(0, limit));
    setUpdatedAt(snapshot.updatedAt || new Date().toISOString());
  }, [limit]);

  const live = useLiveStream({
    enabled,
    wsUrl,
    wsParams: { channel: "buys", limit },
    pollMs: LIVE_POLL_MS,
    onPoll: refreshSnapshot,
    onMessage: (payload) => {
      const incoming = extractTradesFromPayload(payload).filter((trade) => trade.side === "BUY");
      if (!incoming.length) return;
      setItems((prev) => mergeTrades(prev, incoming, limit));
      setUpdatedAt(new Date().toISOString());
    },
  });

  return {
    items,
    updatedAt,
    isLoading: initialQuery.isLoading && !items.length,
    isFetching: initialQuery.isFetching,
    refresh: refreshSnapshot,
    ...live,
  };
};

export const useTokenActivity = ({
  tokenAddress,
  limit = 40,
  type = "trades",
  enabled = true,
}: {
  tokenAddress?: string;
  limit?: number;
  type?: LaunchpadActivityQuery["type"];
  enabled?: boolean;
}) => {
  const [items, setItems] = useState<LaunchpadTrade[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string>(new Date().toISOString());
  const wsUrl = getLaunchpadWsUrl();
  const normalizedAddress = String(tokenAddress || "").trim().toLowerCase();

  const initialQuery = useQuery({
    queryKey: ["launchpad", "token-activity", normalizedAddress, type, limit],
    enabled: enabled && Boolean(normalizedAddress),
    queryFn: ({ signal }) =>
      fetchLaunchpadTokenActivity(normalizedAddress, { type, limit }, signal),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!initialQuery.data?.items) return;
    setItems(initialQuery.data.items.slice(0, limit));
    setUpdatedAt(initialQuery.data.updatedAt || new Date().toISOString());
  }, [initialQuery.data, limit]);

  const refreshSnapshot = useCallback(async () => {
    if (!normalizedAddress) return;
    const snapshot = await fetchLaunchpadTokenActivity(normalizedAddress, { type, limit });
    setItems(snapshot.items.slice(0, limit));
    setUpdatedAt(snapshot.updatedAt || new Date().toISOString());
  }, [limit, normalizedAddress, type]);

  const live = useLiveStream({
    enabled: enabled && Boolean(normalizedAddress),
    wsUrl,
    wsParams: { channel: "token-activity", tokenAddress: normalizedAddress, type, limit },
    pollMs: LIVE_POLL_MS,
    onPoll: refreshSnapshot,
    onMessage: (payload) => {
      const incoming = extractTradesFromPayload(payload).filter(
        (trade) => normalizeHash(trade.tokenAddress) === normalizedAddress
      );
      if (!incoming.length) return;
      setItems((prev) => mergeTrades(prev, incoming, limit));
      setUpdatedAt(new Date().toISOString());
    },
  });

  return {
    items,
    updatedAt,
    isLoading: initialQuery.isLoading && !items.length,
    isFetching: initialQuery.isFetching,
    refresh: refreshSnapshot,
    ...live,
  };
};

export const useLaunchpadRiskFlag = (token?: LaunchpadTokenCard | null) => {
  if (!token) return { needsWarning: false, warningText: "" };
  if (token.verified) return { needsWarning: false, warningText: "" };
  return {
    needsWarning: true,
    warningText: "Unverified token. Extra confirmation is required before buying.",
  };
};

export const useHasLaunchpadBackend = () => !isLaunchpadUsingMock();

export type { LaunchpadCandle, LaunchpadTokenCard };
