// src/shared/hooks/useDashboardData.js
import { useQuery } from "@tanstack/react-query";
import {
  fetchDashboardStatsCombined,
  fetchProtocolHistoryCombined,
  fetchTopPairsBreakdownCombined,
} from "../config/subgraph";

const DASHBOARD_REFETCH_MS = 5 * 60 * 1000;

// Start the protocol TVL counter from Feb 6, 2026 (UTC midnight) and keep counting forward.
const TVL_START_DATE = Date.UTC(2026, 1, 6);

const getTvlDays = () =>
  Math.min(
    1000,
    Math.max(30, Math.ceil((Date.now() - TVL_START_DATE) / 86400000) + 2)
  );

export function useDashboardData() {
  const query = useQuery({
    queryKey: ["dashboard", "combined"],
    queryFn: async () => {
      const tvlDays = getTvlDays();
      const [stats, tvlHistory, volumeHistory, topPairs] = await Promise.all([
        fetchDashboardStatsCombined(),
        fetchProtocolHistoryCombined(tvlDays),
        fetchProtocolHistoryCombined(7),
        fetchTopPairsBreakdownCombined(4),
      ]);
      return {
        stats: stats || null,
        tvlHistory: Array.isArray(tvlHistory) ? tvlHistory : [],
        volumeHistory: Array.isArray(volumeHistory) ? volumeHistory : [],
        topPairs: Array.isArray(topPairs) ? topPairs : [],
        tvlStartDate: TVL_START_DATE,
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
    },
  };
}
