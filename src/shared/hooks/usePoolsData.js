// src/shared/hooks/usePoolsData.js
import { useCallback, useMemo, useRef, useEffect } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  fetchV2PoolsPage,
  fetchV3PoolsPage,
  fetchV2PoolsHourData,
  fetchV3PoolsHourData,
} from "../config/subgraph";

const PAGE_SIZE = 50;
const REFRESH_MS = 5 * 60 * 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const POOLS_CACHE_KEY = "cx_pools_cache_v2";

const getNextPageParam = (lastPage, pages) =>
  lastPage && lastPage.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined;

const canUseStorage = () =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const readCache = (key) => {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const ts = Number(parsed.ts || 0);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCache = (key, payload) => {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
};

const buildPageParams = (pages = []) =>
  pages.map((_, idx) => idx * PAGE_SIZE);

const normalizePoolIds = (ids = []) =>
  Array.from(
    new Set(
      (ids || [])
        .map((id) => String(id || "").toLowerCase())
        .filter(Boolean)
    )
  );

const buildIdsKey = (ids = []) => ids.slice().sort().join(",");

const pickRollingEntries = (rollingMap = {}, ids = []) => {
  if (!rollingMap || typeof rollingMap !== "object") return {};
  if (!ids.length) return {};
  const out = {};
  ids.forEach((id) => {
    if (!id) return;
    const key = String(id).toLowerCase();
    if (rollingMap[key]) out[key] = rollingMap[key];
  });
  return out;
};

export function usePoolsData() {
  const cachedPools = useMemo(() => readCache(POOLS_CACHE_KEY), []);
  const poolsCacheRef = useRef(cachedPools);

  const v3Query = useInfiniteQuery({
    queryKey: ["pools", "v3"],
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      fetchV3PoolsPage({ limit: PAGE_SIZE, skip: pageParam }),
    getNextPageParam,
    initialData: cachedPools?.v3Pages?.length
      ? {
          pages: cachedPools.v3Pages,
          pageParams: buildPageParams(cachedPools.v3Pages),
        }
      : undefined,
    initialDataUpdatedAt: cachedPools?.ts,
    staleTime: 60 * 1000,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
  });

  const v2Query = useInfiniteQuery({
    queryKey: ["pools", "v2"],
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      fetchV2PoolsPage({ limit: PAGE_SIZE, skip: pageParam }),
    getNextPageParam,
    initialData: cachedPools?.v2Pages?.length
      ? {
          pages: cachedPools.v2Pages,
          pageParams: buildPageParams(cachedPools.v2Pages),
        }
      : undefined,
    initialDataUpdatedAt: cachedPools?.ts,
    staleTime: 60 * 1000,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
  });

  const v2Pools = useMemo(() => {
    return v2Query.data?.pages?.flat() || [];
  }, [v2Query.data]);
  const v3Pools = useMemo(
    () => v3Query.data?.pages?.flat() || [],
    [v3Query.data]
  );
  const v2PoolCount = v2Pools.length;
  const v3PoolCount = v3Pools.length;

  const v2Ids = useMemo(() => normalizePoolIds(v2Pools.map((p) => p.id)), [v2Pools]);
  const v3Ids = useMemo(() => normalizePoolIds(v3Pools.map((p) => p.id)), [v3Pools]);
  const v2IdsKey = useMemo(() => buildIdsKey(v2Ids), [v2Ids]);
  const v3IdsKey = useMemo(() => buildIdsKey(v3Ids), [v3Ids]);
  const cachedV2Rolling = useMemo(
    () => pickRollingEntries(cachedPools?.v2RollingData, v2Ids),
    [cachedPools, v2Ids]
  );
  const cachedV3Rolling = useMemo(
    () => pickRollingEntries(cachedPools?.v3RollingData, v3Ids),
    [cachedPools, v3Ids]
  );
  const hasCachedV2Rolling = useMemo(
    () => Object.keys(cachedV2Rolling).length > 0,
    [cachedV2Rolling]
  );
  const hasCachedV3Rolling = useMemo(
    () => Object.keys(cachedV3Rolling).length > 0,
    [cachedV3Rolling]
  );

  const v2RollingQuery = useQuery({
    queryKey: ["pools", "v2-roll-24h", v2IdsKey],
    queryFn: () => fetchV2PoolsHourData(v2Ids, 24),
    enabled: v2Ids.length > 0,
    initialData: hasCachedV2Rolling ? cachedV2Rolling : undefined,
    initialDataUpdatedAt: hasCachedV2Rolling ? cachedPools?.ts : undefined,
    refetchOnMount: false,
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
  });

  const v3RollingQuery = useQuery({
    queryKey: ["pools", "v3-roll-24h", v3IdsKey],
    queryFn: () => fetchV3PoolsHourData(v3Ids, 24),
    enabled: v3Ids.length > 0,
    initialData: hasCachedV3Rolling ? cachedV3Rolling : undefined,
    initialDataUpdatedAt: hasCachedV3Rolling ? cachedPools?.ts : undefined,
    refetchOnMount: false,
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const v2Pages = v2Query.data?.pages;
    const v3Pages = v3Query.data?.pages;
    const v2RollingData = v2RollingQuery.data || {};
    const v3RollingData = v3RollingQuery.data || {};
    if (!v2Pages && !v3Pages && !Object.keys(v2RollingData).length && !Object.keys(v3RollingData).length) {
      return;
    }
    const next = {
      ts: Date.now(),
      v2Pages: v2Pages ?? poolsCacheRef.current?.v2Pages ?? [],
      v3Pages: v3Pages ?? poolsCacheRef.current?.v3Pages ?? [],
      v2RollingData: {
        ...(poolsCacheRef.current?.v2RollingData || {}),
        ...v2RollingData,
      },
      v3RollingData: {
        ...(poolsCacheRef.current?.v3RollingData || {}),
        ...v3RollingData,
      },
    };
    poolsCacheRef.current = next;
    writeCache(POOLS_CACHE_KEY, next);
  }, [v2Query.data, v3Query.data, v2RollingQuery.data, v3RollingQuery.data]);

  const refetchAll = useCallback(async () => {
    await Promise.all([
      v3Query.refetch(),
      v2Query.refetch(),
      v3RollingQuery.refetch(),
      v2RollingQuery.refetch(),
    ]);
  }, [v2Query, v3Query, v2RollingQuery, v3RollingQuery]);

  return {
    v2Pools,
    v3Pools,
    v2PoolCount,
    v3PoolCount,
    v2RollingData: v2RollingQuery.data || {},
    v3RollingData: v3RollingQuery.data || {},
    v2RollingFresh: v2RollingQuery.isFetchedAfterMount,
    v3RollingFresh: v3RollingQuery.isFetchedAfterMount,
    v2Error: v2Query.error,
    v3Error: v3Query.error,
    v2IsLoading: v2Query.isLoading,
    v3IsLoading: v3Query.isLoading,
    v2IsFetchingNextPage: v2Query.isFetchingNextPage,
    v3IsFetchingNextPage: v3Query.isFetchingNextPage,
    v2HasNextPage: v2Query.hasNextPage,
    v3HasNextPage: v3Query.hasNextPage,
    fetchNextV2: v2Query.fetchNextPage,
    fetchNextV3: v3Query.fetchNextPage,
    refetchAll,
  };
}
