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

const serializeWsParams = (params?: Record<string, string | number | boolean | undefined>) =>
  JSON.stringify(
    Object.entries(params || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .sort(([a], [b]) => a.localeCompare(b))
  );

const parseWsParams = (key = ""): Record<string, string | number | boolean> => {
  if (!key) return {};
  try {
    const entries = JSON.parse(key) as Array<[string, string | number | boolean]>;
    if (!Array.isArray(entries)) return {};
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
};

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

const normalizeTrades = (items: LaunchpadTrade[], maxItems: number) =>
  mergeTrades([], items || [], maxItems);

const areTradesEqual = (a: LaunchpadTrade[], b: LaunchpadTrade[]) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      normalizeHash(left?.txHash) !== normalizeHash(right?.txHash) ||
      normalizeHash(left?.tokenAddress) !== normalizeHash(right?.tokenAddress) ||
      String(left?.side || "") !== String(right?.side || "") ||
      String(left?.timestamp || "") !== String(right?.timestamp || "") ||
      Number(left?.amountUSD || 0) !== Number(right?.amountUSD || 0)
    ) {
      return false;
    }
  }
  return true;
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
  const onMessageRef = useRef<UseLiveStreamOptions["onMessage"]>(onMessage);
  const onPollRef = useRef<UseLiveStreamOptions["onPoll"]>(onPoll);
  const wsParamsKey = useMemo(() => serializeWsParams(wsParams), [wsParams]);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onPollRef.current = onPoll;
  }, [onPoll]);

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
          await onPollRef.current?.();
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
      const parsedParams = parseWsParams(wsParamsKey);
      const connection = new WebSocket(buildWsUrl(wsUrl, parsedParams));
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
          onMessageRef.current?.(payload);
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
  }, [enabled, pollMs, wsParamsKey, wsUrl]);

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
  const itemsRef = useRef<LaunchpadTrade[]>([]);

  const applyItems = useCallback(
    (incoming: LaunchpadTrade[], stamp?: string) => {
      const normalized = normalizeTrades(incoming || [], limit);
      if (areTradesEqual(itemsRef.current, normalized)) return false;
      itemsRef.current = normalized;
      setItems(normalized);
      setUpdatedAt(stamp || new Date().toISOString());
      return true;
    },
    [limit]
  );

  const initialQuery = useQuery({
    queryKey: ["launchpad", "live-buys", limit],
    enabled,
    queryFn: ({ signal }) => fetchLaunchpadActivity({ type: "buys", limit }, signal),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!initialQuery.data?.items) return;
    applyItems(initialQuery.data.items, initialQuery.data.updatedAt || new Date().toISOString());
  }, [applyItems, initialQuery.data]);

  const refreshSnapshot = useCallback(async () => {
    const snapshot = await fetchLaunchpadActivity({ type: "buys", limit });
    applyItems(snapshot.items, snapshot.updatedAt || new Date().toISOString());
  }, [applyItems, limit]);

  const wsParams = useMemo(() => ({ channel: "buys", limit }), [limit]);

  const live = useLiveStream({
    enabled,
    wsUrl,
    wsParams,
    pollMs: LIVE_POLL_MS,
    onPoll: refreshSnapshot,
    onMessage: (payload) => {
      const incoming = extractTradesFromPayload(payload).filter((trade) => trade.side === "BUY");
      if (!incoming.length) return;
      const merged = mergeTrades(itemsRef.current, incoming, limit);
      applyItems(merged, new Date().toISOString());
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
  const itemsRef = useRef<LaunchpadTrade[]>([]);

  const applyItems = useCallback(
    (incoming: LaunchpadTrade[], stamp?: string) => {
      const normalized = normalizeTrades(incoming || [], limit);
      if (areTradesEqual(itemsRef.current, normalized)) return false;
      itemsRef.current = normalized;
      setItems(normalized);
      setUpdatedAt(stamp || new Date().toISOString());
      return true;
    },
    [limit]
  );

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
    applyItems(initialQuery.data.items, initialQuery.data.updatedAt || new Date().toISOString());
  }, [applyItems, initialQuery.data]);

  const refreshSnapshot = useCallback(async () => {
    if (!normalizedAddress) return;
    const snapshot = await fetchLaunchpadTokenActivity(normalizedAddress, { type, limit });
    applyItems(snapshot.items, snapshot.updatedAt || new Date().toISOString());
  }, [applyItems, limit, normalizedAddress, type]);

  const wsParams = useMemo(
    () => ({ channel: "token-activity", tokenAddress: normalizedAddress, type, limit }),
    [limit, normalizedAddress, type]
  );

  const live = useLiveStream({
    enabled: enabled && Boolean(normalizedAddress),
    wsUrl,
    wsParams,
    pollMs: LIVE_POLL_MS,
    onPoll: refreshSnapshot,
    onMessage: (payload) => {
      const incoming = extractTradesFromPayload(payload).filter(
        (trade) => normalizeHash(trade.tokenAddress) === normalizedAddress
      );
      if (!incoming.length) return;
      const merged = mergeTrades(itemsRef.current, incoming, limit);
      applyItems(merged, new Date().toISOString());
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

export const useHasLaunchpadBackend = () => !isLaunchpadUsingMock();

export type { LaunchpadCandle, LaunchpadTokenCard };
