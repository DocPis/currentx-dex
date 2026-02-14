import type { LaunchpadFilter, LaunchpadSort, LaunchpadTokenCard } from "./types";

export const LAUNCHPAD_FILTER_OPTIONS: Array<{ id: LaunchpadFilter; label: string }> = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "top-mcap", label: "Top Market Cap" },
  { id: "top-volume", label: "Top Volume 24h" },
  { id: "top-gainers", label: "Top Gainers" },
  { id: "verified", label: "Verified only" },
];

export const LAUNCHPAD_SORT_OPTIONS: Array<{ id: LaunchpadSort; label: string }> = [
  { id: "mcap", label: "Market Cap" },
  { id: "volume24h", label: "Volume 24h" },
  { id: "buysPerMinute", label: "Buys/min" },
  { id: "change1h", label: "Price change (1h)" },
  { id: "change24h", label: "Price change (24h)" },
  { id: "newest", label: "Newest" },
];

export const trimTrailingZeros = (value: string): string => {
  if (typeof value !== "string" || !value.includes(".")) return value;
  return value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
};

export const formatCompactNumber = (value: number | null | undefined): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  const abs = Math.abs(num);
  const units = [
    { value: 1e12, suffix: "T" },
    { value: 1e9, suffix: "B" },
    { value: 1e6, suffix: "M" },
    { value: 1e3, suffix: "K" },
  ];
  for (const unit of units) {
    if (abs >= unit.value) {
      const scaled = num / unit.value;
      const decimals = scaled >= 100 ? 1 : scaled >= 10 ? 2 : 3;
      return `${trimTrailingZeros(scaled.toFixed(decimals))}${unit.suffix}`;
    }
  }
  if (abs >= 1) return trimTrailingZeros(num.toFixed(4));
  if (abs >= 0.01) return trimTrailingZeros(num.toFixed(6));
  if (abs === 0) return "0";
  return "<0.01";
};

export const formatUsd = (value: number | null | undefined): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return `$${formatCompactNumber(num)}`;
};

export const formatPercent = (value: number | null | undefined): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  const sign = num > 0 ? "+" : "";
  return `${sign}${trimTrailingZeros(num.toFixed(2))}%`;
};

export const shortAddress = (value: string): string => {
  if (!value || value.length < 10) return value || "";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

export const formatTokenAmount = (value: string | number | null | undefined): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return formatCompactNumber(num);
};

export const toTimeAgo = (value: string | number): string => {
  const timestamp = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(timestamp)) return "--";
  const elapsed = Math.max(0, Date.now() - timestamp);
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const quantileThreshold = (
  items: LaunchpadTokenCard[],
  pick: (item: LaunchpadTokenCard) => number,
  quantile = 0.7
): number => {
  if (!items.length) return Number.POSITIVE_INFINITY;
  const sorted = items
    .map((item) => Number(pick(item) || 0))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) return Number.POSITIVE_INFINITY;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * quantile)));
  return sorted[index] ?? Number.POSITIVE_INFINITY;
};

const isNewToken = (item: LaunchpadTokenCard): boolean => {
  const createdAt = Date.parse(item.createdAt || "");
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt <= 72 * 60 * 60 * 1000;
};

const matchesSearch = (item: LaunchpadTokenCard, q: string): boolean => {
  if (!q) return true;
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const hay = [
    item.name,
    item.symbol,
    item.address,
    ...(item.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(query);
};

export const filterTokens = (
  items: LaunchpadTokenCard[],
  query = "",
  filters: LaunchpadFilter[] = []
): LaunchpadTokenCard[] => {
  if (!items.length) return [];
  if (!filters.length && !query.trim()) return items;

  const mcapThreshold = quantileThreshold(items, (item) => item.market?.mcapUSD || 0, 0.7);
  const volumeThreshold = quantileThreshold(items, (item) => item.market?.volume24hUSD || 0, 0.7);
  const gainersThreshold = quantileThreshold(items, (item) => item.market?.change24h || 0, 0.7);
  const buysThreshold = quantileThreshold(items, (item) => item.buysPerMinute || 0, 0.7);

  return items.filter((item) => {
    if (!matchesSearch(item, query)) return false;

    for (const rawFilter of filters) {
      const filter = String(rawFilter || "").toLowerCase();
      if (filter === "verified" && !item.verified) return false;
      if (filter === "new" && !isNewToken(item)) return false;
      if (filter === "trending" && (item.buysPerMinute || 0) < buysThreshold) return false;
      if (filter === "top-mcap" && (item.market?.mcapUSD || 0) < mcapThreshold) return false;
      if (filter === "top-volume" && (item.market?.volume24hUSD || 0) < volumeThreshold) return false;
      if (filter === "top-gainers" && (item.market?.change24h || 0) < gainersThreshold) return false;
      if (
        !["verified", "new", "trending", "top-mcap", "top-volume", "top-gainers"].includes(filter) &&
        !(item.tags || []).map((tag) => String(tag).toLowerCase()).includes(filter)
      ) {
        return false;
      }
    }

    return true;
  });
};

export const sortTokens = (items: LaunchpadTokenCard[], sort: LaunchpadSort = "mcap") => {
  const list = [...(items || [])];
  list.sort((a, b) => {
    if (sort === "newest") {
      return Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "");
    }
    if (sort === "volume24h") {
      return (b.market?.volume24hUSD || 0) - (a.market?.volume24hUSD || 0);
    }
    if (sort === "buysPerMinute") {
      return (b.buysPerMinute || 0) - (a.buysPerMinute || 0);
    }
    if (sort === "change1h") {
      return (b.market?.change1h || 0) - (a.market?.change1h || 0);
    }
    if (sort === "change24h") {
      return (b.market?.change24h || 0) - (a.market?.change24h || 0);
    }
    return (b.market?.mcapUSD || 0) - (a.market?.mcapUSD || 0);
  });
  return list;
};

export const paginateTokens = (
  items: LaunchpadTokenCard[],
  page = 1,
  pageSize = 24
): { pageItems: LaunchpadTokenCard[]; total: number; hasMore: boolean } => {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Number(pageSize) || 24);
  const offset = (safePage - 1) * safePageSize;
  const pageItems = items.slice(offset, offset + safePageSize);
  return {
    pageItems,
    total: items.length,
    hasMore: offset + safePageSize < items.length,
  };
};
