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

  const v3Ready = v3Query.isFetched || v3Query.isError;

  const v2Query = useInfiniteQuery({
    queryKey: ["pools", "v2"],
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      fetchV2PoolsPage({ limit: PAGE_SIZE, skip: pageParam }),
    getNextPageParam,
    enabled: v3Ready,
    staleTime: 60 * 1000,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  const v2Pools = useMemo(() => {
    if (!v3Ready) return [];
    return v2Query.data?.pages?.flat() || [];
  }, [v2Query.data, v3Ready]);
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
    enabled: v3Ready && v2Ids.length > 0,
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
    await v3Query.refetch();
    await v3DayQuery.refetch();
    if (v3Ready) {
      await v2Query.refetch();
      await v2DayQuery.refetch();
    }
  }, [v2Query, v3Query, v2DayQuery, v3DayQuery, v3Ready]);

  const safeFetchNextV2 = useCallback(() => {
    if (!v3Ready) return Promise.resolve();
    return v2Query.fetchNextPage();
  }, [v2Query, v3Ready]);

  return {
    v2Pools,
    v3Pools,
    v2DayData: v3Ready ? v2DayQuery.data || {} : {},
    v3DayData: v3DayQuery.data || {},
    v2Error: v3Ready ? v2Query.error : null,
    v3Error: v3Query.error,
    v2IsLoading: v3Ready ? v2Query.isLoading : false,
    v3IsLoading: v3Query.isLoading,
    v2IsFetchingNextPage: v3Ready ? v2Query.isFetchingNextPage : false,
    v3IsFetchingNextPage: v3Query.isFetchingNextPage,
    v2HasNextPage: v3Ready ? v2Query.hasNextPage : false,
    v3HasNextPage: v3Query.hasNextPage,
    fetchNextV2: safeFetchNextV2,
    fetchNextV3: v3Query.fetchNextPage,
    refetchAll,
  };
}
