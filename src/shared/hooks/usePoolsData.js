// src/shared/hooks/usePoolsData.js
import { useCallback, useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  fetchV2PoolsPage,
  fetchV3PoolsPage,
  fetchV2PoolsDayData,
  fetchV3PoolsDayData,
} from "../config/subgraph";

const PAGE_SIZE = 50;
const REFRESH_MS = 5 * 60 * 1000;

const getNextPageParam = (lastPage, pages) =>
  lastPage && lastPage.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined;

export function usePoolsData() {
  const v3Query = useInfiniteQuery({
    queryKey: ["pools", "v3"],
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      fetchV3PoolsPage({ limit: PAGE_SIZE, skip: pageParam }),
    getNextPageParam,
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
    staleTime: 60 * 1000,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  const v3DayQuery = useQuery({
    queryKey: ["pools", "v3-day", v3Ids],
    queryFn: () => fetchV3PoolsDayData(v3Ids),
    enabled: v3Ids.length > 0,
    staleTime: 60 * 1000,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
  });

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
