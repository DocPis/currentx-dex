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
// Start protocol volume/fees from Feb 4, 2026 (UTC midnight).
const VOLUME_START_DATE = Date.UTC(2026, 1, 4);
const HISTORY_START_DATE = Math.min(TVL_START_DATE, VOLUME_START_DATE);

const getHistoryDays = () =>
  Math.min(
    1000,
    Math.max(30, Math.ceil((Date.now() - HISTORY_START_DATE) / 86400000) + 2)
  );

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
      return {
        stats: stats || null,
        tvlHistory: safeHistory,
        volumeHistory: safeHistory,
        topPairs: Array.isArray(topPairs) ? topPairs : [],
        tvlStartDate: TVL_START_DATE,
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
