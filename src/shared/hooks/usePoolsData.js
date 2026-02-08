// src/shared/hooks/usePoolsData.js
import { useCallback, useMemo, useRef, useEffect } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  fetchV2PoolsPage,
  fetchV3PoolsPage,
  fetchV2PoolsDayData,
  fetchV3PoolsDayData,
} from "../config/subgraph";

const PAGE_SIZE = 50;
const REFRESH_MS = 5 * 60 * 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const POOLS_CACHE_KEY = "cx_pools_cache_v1";
const POOLS_DAY_CACHE_KEY = "cx_pools_day_cache_v1";

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

export function usePoolsData() {
  const cachedPools = useMemo(() => readCache(POOLS_CACHE_KEY), []);
  const cachedDay = useMemo(() => readCache(POOLS_DAY_CACHE_KEY), []);
  const poolsCacheRef = useRef(cachedPools);
  const dayCacheRef = useRef(cachedDay);

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
  });

  const v2Pools = useMemo(() => {
    return v2Query.data?.pages?.flat() || [];
  }, [v2Query.data]);
  const v3Pools = useMemo(
    () => v3Query.data?.pages?.flat() || [],
    [v3Query.data]
  );

  const v2Ids = useMemo(
    () => v2Pools.map((p) => p.id).filter(Boolean),
    [v2Pools]
  );
  const v3Ids = useMemo(
    () => v3Pools.map((p) => p.id).filter(Boolean),
    [v3Pools]
  );

  const v2DayQuery = useQuery({
    queryKey: ["pools", "v2-day", v2Ids],
    queryFn: () => fetchV2PoolsDayData(v2Ids),
    enabled: v2Ids.length > 0,
    initialData: cachedDay?.v2DayData || undefined,
    initialDataUpdatedAt: cachedDay?.ts,
    refetchOnMount: "always",
    staleTime: 0,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  const v3DayQuery = useQuery({
    queryKey: ["pools", "v3-day", v3Ids],
    queryFn: () => fetchV3PoolsDayData(v3Ids),
    enabled: v3Ids.length > 0,
    initialData: cachedDay?.v3DayData || undefined,
    initialDataUpdatedAt: cachedDay?.ts,
    refetchOnMount: "always",
    staleTime: 0,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    const v2Pages = v2Query.data?.pages;
    const v3Pages = v3Query.data?.pages;
    if (!v2Pages && !v3Pages) return;
    const next = {
      ts: Date.now(),
      v2Pages: v2Pages ?? poolsCacheRef.current?.v2Pages ?? [],
      v3Pages: v3Pages ?? poolsCacheRef.current?.v3Pages ?? [],
    };
    poolsCacheRef.current = next;
    writeCache(POOLS_CACHE_KEY, next);
  }, [v2Query.data, v3Query.data]);

  useEffect(() => {
    const v2DayData = v2DayQuery.data;
    const v3DayData = v3DayQuery.data;
    if (!v2DayData && !v3DayData) return;
    const next = {
      ts: Date.now(),
      v2DayData: v2DayData ?? dayCacheRef.current?.v2DayData ?? {},
      v3DayData: v3DayData ?? dayCacheRef.current?.v3DayData ?? {},
    };
    dayCacheRef.current = next;
    writeCache(POOLS_DAY_CACHE_KEY, next);
  }, [v2DayQuery.data, v3DayQuery.data]);

  const refetchAll = useCallback(async () => {
    await Promise.all([
      v3Query.refetch(),
      v2Query.refetch(),
      v3DayQuery.refetch(),
      v2DayQuery.refetch(),
    ]);
  }, [v2Query, v3Query, v2DayQuery, v3DayQuery]);

  return {
    v2Pools,
    v3Pools,
    v2DayData: v2DayQuery.data || {},
    v3DayData: v3DayQuery.data || {},
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
