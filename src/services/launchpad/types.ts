export type LaunchpadTradeSide = "BUY" | "SELL";

export interface LaunchpadToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoUrl: string;
  createdAt: string;
  creator: string;
  verified: boolean;
  tags: string[];
}

export interface LaunchpadMarket {
  priceUSD: number;
  mcapUSD: number;
  liquidityUSD: number;
  volume24hUSD: number;
  change1h: number;
  change24h: number;
  updatedAt: string;
}

export interface LaunchpadTokenCard extends LaunchpadToken {
  market: LaunchpadMarket;
  buysPerMinute: number;
  sparkline: number[];
  description?: string;
  website?: string;
  socials?: {
    x?: string;
    telegram?: string;
    discord?: string;
  };
  launchParams?: {
    initialMcapUSD?: number;
    poolFeeBps?: number;
    creatorAllocationPct?: number;
  };
}

export interface LaunchpadTrade {
  txHash: string;
  tokenAddress: string;
  side: LaunchpadTradeSide;
  amountIn: string;
  amountOut: string;
  amountUSD: number;
  buyer: string;
  timestamp: string;
  blockNumber: number;
}

export interface LaunchpadCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUSD: number;
}

export type LaunchpadFilter =
  | "trending"
  | "new"
  | "top-mcap"
  | "top-volume"
  | "top-gainers"
  | "verified"
  | string;

export type LaunchpadSort =
  | "mcap"
  | "volume24h"
  | "buysPerMinute"
  | "change1h"
  | "change24h"
  | "newest";

export interface LaunchpadTokensQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: LaunchpadSort;
  filters?: LaunchpadFilter[];
}

export interface LaunchpadTokensResponse {
  items: LaunchpadTokenCard[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface LaunchpadActivityQuery {
  limit?: number;
  type?: "trades" | "buys" | "sells" | "liquidity";
}

export interface LaunchpadActivityResponse {
  items: LaunchpadTrade[];
  updatedAt: string;
}

export interface UseLiveStreamResult {
  mode: "idle" | "ws" | "polling";
  isLive: boolean;
  lastUpdatedAt: number | null;
}
