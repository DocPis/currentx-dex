// src/shared/hooks/useDashboardData.js
import { useQuery } from "@tanstack/react-query";
import {
  fetchDashboardStatsCombined,
  fetchProtocolHistoryCombined,
  fetchTopPairsBreakdownCombined,
} from "../config/subgraph";

const DASHBOARD_REFETCH_MS = 5 * 60 * 1000;

// Fallback start for protocol TVL when whitelist-origin history is not available.
const TVL_START_DATE = Date.UTC(2026, 1, 6);
// Start protocol volume/fees from Feb 4, 2026 (UTC midnight).
const VOLUME_START_DATE = Date.UTC(2026, 1, 4);
const HISTORY_START_DATE = Math.min(TVL_START_DATE, VOLUME_START_DATE);

const getHistoryDays = () =>
  Math.min(
    1000,
    Math.max(30, Math.ceil((Date.now() - HISTORY_START_DATE) / 86400000) + 2)
  );

const toPositiveDate = (entry) => {
  const tvl = Number(entry?.tvlUsd);
  const date = Number(entry?.date);
  if (!Number.isFinite(tvl) || tvl <= 0) return null;
  if (!Number.isFinite(date) || date <= 0) return null;
  return date;
};

export function useDashboardData() {
  const query = useQuery({
    queryKey: ["dashboard", "combined"],
    queryFn: async () => {
      const historyDays = getHistoryDays();
      const [stats, history, topPairs] = await Promise.all([
        fetchDashboardStatsCombined(),
        fetchProtocolHistoryCombined(historyDays),
        fetchTopPairsBreakdownCombined(4),
      ]);
      const safeHistory = Array.isArray(history) ? history : [];
      const tvlOriginDate =
        safeHistory
          .map(toPositiveDate)
          .filter((value) => value !== null)
          .sort((a, b) => a - b)[0] || TVL_START_DATE;
      return {
        stats: stats || null,
        tvlHistory: safeHistory,
        volumeHistory: safeHistory,
        topPairs: Array.isArray(topPairs) ? topPairs : [],
        tvlStartDate: tvlOriginDate,
        volumeStartDate: VOLUME_START_DATE,
      };
    },
    staleTime: 60 * 1000,
    refetchInterval: DASHBOARD_REFETCH_MS,
    refetchIntervalInBackground: true,
  });

  return {
    ...query,
    data: query.data || {
      stats: null,
      tvlHistory: [],
      volumeHistory: [],
      topPairs: [],
      tvlStartDate: TVL_START_DATE,
      volumeStartDate: VOLUME_START_DATE,
    },
  };
}
