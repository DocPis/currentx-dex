import type {
  LaunchpadActivityQuery,
  LaunchpadActivityResponse,
  LaunchpadCandle,
  LaunchpadFilter,
  LaunchpadSort,
  LaunchpadTokenCard,
  LaunchpadTokensQuery,
  LaunchpadTokensResponse,
  LaunchpadTrade,
} from "./types";
import { filterTokens, paginateTokens, sortTokens } from "./utils";

const NAMESPACE = "currentx-launchpad-mock";
const BUYER_ADDRESSES = [
  "0x3f9be0f832b8d9c20f94ff96d4f82ea7d8a2f101",
  "0x99f6494ed390153f32877b8dbf03f0f76a5a20af",
  "0x4cbf5a38a4f47fa1d6dedf4f6bd40f5d2809b5e2",
  "0xe2ed8603f74f74db8ba6a6f5f2a8f8d7d6fe2d24",
  "0x53f12add9fcf8ce9a2f6529b0ff7d53ec0f91ee6",
  "0x0fbe8dc8f4ef9756db4fc2fb2b69f6df3e3445a3",
  "0x2b0346aa5b4f2439fdc0a6977a143796ff996344",
  "0xe7bfa52349ab86de2db8f93ecf809631f0f9fc6d",
];

const LOGOS = [
  "https://avatars.githubusercontent.com/u/1?v=4",
  "https://avatars.githubusercontent.com/u/2?v=4",
  "https://avatars.githubusercontent.com/u/3?v=4",
  "https://avatars.githubusercontent.com/u/4?v=4",
  "https://avatars.githubusercontent.com/u/5?v=4",
  "https://avatars.githubusercontent.com/u/6?v=4",
  "https://avatars.githubusercontent.com/u/7?v=4",
  "https://avatars.githubusercontent.com/u/8?v=4",
  "https://avatars.githubusercontent.com/u/9?v=4",
  "https://avatars.githubusercontent.com/u/10?v=4",
];

const TOKEN_BLUEPRINTS: Array<
  Pick<
    LaunchpadTokenCard,
    "name" | "symbol" | "tags" | "description" | "website" | "socials" | "lpLocked"
  > & {
    volatility: number;
    liquidityUSD: number;
    volume24hUSD: number;
    mcapUSD: number;
    priceUSD: number;
    change24h: number;
    change1h: number;
    buysPerMinute: number;
  }
> = [
  {
    name: "CurrentX Pepe",
    symbol: "CPEPE",
    tags: ["meme", "animal"],
    volatility: 0.08,
    liquidityUSD: 410000,
    volume24hUSD: 1120000,
    mcapUSD: 7600000,
    priceUSD: 0.0062,
    change24h: 42.8,
    change1h: 3.6,
    buysPerMinute: 18,
    description: "Meme-native token launched on CurrentX with community rewards.",
    website: "https://currentx.app",
    socials: {
      x: "https://x.com/currentxdex",
      telegram: "https://t.me/currentxdex",
    },
  },
  {
    name: "ZeroLatency Dog",
    symbol: "ZDOG",
    tags: ["meme", "dog"],
    volatility: 0.11,
    liquidityUSD: 95000,
    volume24hUSD: 320000,
    mcapUSD: 1800000,
    priceUSD: 0.00081,
    change24h: 18.2,
    change1h: 1.4,
    buysPerMinute: 9,
    description: "Dog coin focused on fast launch cycles and social momentum.",
    website: "https://example.com/zdog",
  },
  {
    name: "Mega Shark",
    symbol: "MSHARK",
    tags: ["gaming", "nft"],
    volatility: 0.04,
    liquidityUSD: 720000,
    volume24hUSD: 890000,
    mcapUSD: 12800000,
    priceUSD: 0.091,
    change24h: 7.1,
    change1h: 0.5,
    buysPerMinute: 12,
    description: "Gaming utility token with in-game staking perks.",
    website: "https://example.com/mshark",
  },
  {
    name: "Turbo Chad",
    symbol: "TCHAD",
    tags: ["meme", "culture"],
    volatility: 0.13,
    liquidityUSD: 62000,
    volume24hUSD: 270000,
    mcapUSD: 950000,
    priceUSD: 0.00034,
    change24h: -12.6,
    change1h: -1.2,
    buysPerMinute: 5,
    description: "High-volatility social token. Extreme swings are common.",
    website: "https://example.com/tchad",
  },
  {
    name: "Stable Orbit",
    symbol: "SORB",
    tags: ["defi", "stable"],
    volatility: 0.01,
    liquidityUSD: 1480000,
    volume24hUSD: 2560000,
    mcapUSD: 31200000,
    priceUSD: 1.02,
    change24h: 0.7,
    change1h: 0.08,
    buysPerMinute: 15,
    description: "Stable-leaning DeFi token designed for low slippage routing.",
    website: "https://example.com/sorb",
  },
  {
    name: "Vault Rune",
    symbol: "VRUNE",
    tags: ["defi", "vault"],
    volatility: 0.03,
    liquidityUSD: 530000,
    volume24hUSD: 620000,
    mcapUSD: 8700000,
    priceUSD: 0.41,
    change24h: 5.6,
    change1h: 0.7,
    buysPerMinute: 10,
    description: "Token tied to auto-managed vault allocations.",
    website: "https://example.com/vrune",
  },
  {
    name: "Bridge Fox",
    symbol: "BFOX",
    tags: ["bridge", "community"],
    volatility: 0.09,
    liquidityUSD: 86000,
    volume24hUSD: 190000,
    mcapUSD: 1200000,
    priceUSD: 0.0027,
    change24h: 11.4,
    change1h: 0.9,
    buysPerMinute: 7,
    description: "Community token promoted by bridge-heavy users.",
    website: "https://example.com/bfox",
  },
  {
    name: "Yield Ember",
    symbol: "YEMB",
    tags: ["yield", "farms"],
    volatility: 0.02,
    liquidityUSD: 930000,
    volume24hUSD: 710000,
    mcapUSD: 15400000,
    priceUSD: 0.74,
    change24h: 3.8,
    change1h: 0.4,
    buysPerMinute: 11,
    description: "Yield-centered utility token for farm multipliers.",
    website: "https://example.com/yemb",
  },
  {
    name: "Luna Coder",
    symbol: "LCODE",
    tags: ["ai", "community"],
    volatility: 0.12,
    liquidityUSD: 45000,
    volume24hUSD: 210000,
    mcapUSD: 780000,
    priceUSD: 0.00018,
    change24h: 27.3,
    change1h: 2.2,
    buysPerMinute: 8,
    description: "Experimental token launched by dev communities.",
    website: "https://example.com/lcode",
  },
  {
    name: "Neon Wasp",
    symbol: "NWSP",
    tags: ["meme", "new"],
    volatility: 0.14,
    liquidityUSD: 38000,
    volume24hUSD: 168000,
    mcapUSD: 540000,
    priceUSD: 0.00009,
    change24h: 51.2,
    change1h: 5.1,
    buysPerMinute: 16,
    description: "Hyper-volatile newly launched meme asset.",
    website: "https://example.com/nwsp",
  },
  {
    name: "Order Sigma",
    symbol: "OSIG",
    tags: ["defi", "infrastructure"],
    volatility: 0.015,
    liquidityUSD: 1650000,
    volume24hUSD: 2210000,
    mcapUSD: 44800000,
    priceUSD: 2.38,
    change24h: 1.9,
    change1h: 0.2,
    buysPerMinute: 14,
    description: "Infrastructure asset optimized for routing depth.",
    website: "https://example.com/osig",
  },
  {
    name: "Pulse Golem",
    symbol: "PGOL",
    tags: ["gaming", "meme"],
    volatility: 0.1,
    liquidityUSD: 57000,
    volume24hUSD: 149000,
    mcapUSD: 690000,
    priceUSD: 0.00023,
    change24h: -4.6,
    change1h: -0.4,
    buysPerMinute: 4,
    description: "Game meme token with episodic volume spikes.",
    website: "https://example.com/pgol",
  },
];

const hashNumber = (input: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
};

const toAddress = (seed: string) => {
  const hash = hashNumber(seed).toString(16).padStart(8, "0");
  return `0x${hash}${hash}${hash}${hash}${hash.slice(0, 8)}`.slice(0, 42);
};

const buildSparkline = (base: number, volatility: number, points = 24): number[] => {
  let current = base;
  const out: number[] = [];
  for (let i = 0; i < points; i += 1) {
    const wave = Math.sin((i / points) * Math.PI * 2);
    const drift = 1 + wave * volatility * 0.6 + (i % 3 === 0 ? volatility * 0.12 : -volatility * 0.08);
    current = Math.max(0.0000001, current * drift);
    out.push(Number(current.toFixed(10)));
  }
  return out;
};

const now = Date.now();

const TOKENS: LaunchpadTokenCard[] = TOKEN_BLUEPRINTS.map((blueprint, index) => {
  const address = toAddress(`${NAMESPACE}:${blueprint.symbol}:${index}`);
  const createdAt = new Date(now - (index + 1) * 5 * 60 * 60 * 1000).toISOString();
  return {
    address,
    name: blueprint.name,
    symbol: blueprint.symbol,
    decimals: 18,
    logoUrl: LOGOS[index % LOGOS.length],
    createdAt,
    creator: BUYER_ADDRESSES[index % BUYER_ADDRESSES.length],
    tags: blueprint.tags,
    description: blueprint.description,
    website: blueprint.website,
    socials: blueprint.socials,
    launchParams: {
      initialMcapUSD: Number((blueprint.mcapUSD * 0.27).toFixed(0)),
      poolFeeBps: 30,
      creatorAllocationPct: 3 + (index % 6),
    },
    lpLocked: blueprint.lpLocked ?? index % 2 === 0,
    buysPerMinute: blueprint.buysPerMinute,
    sparkline: buildSparkline(blueprint.priceUSD, blueprint.volatility),
    market: {
      priceUSD: blueprint.priceUSD,
      mcapUSD: blueprint.mcapUSD,
      liquidityUSD: blueprint.liquidityUSD,
      volume24hUSD: blueprint.volume24hUSD,
      change1h: blueprint.change1h,
      change24h: blueprint.change24h,
      updatedAt: new Date(now - index * 30_000).toISOString(),
    },
  };
});

let seq = 0;
let lastGeneratedAt = Date.now();
const tradesByToken = new Map<string, LaunchpadTrade[]>();
const globalTrades: LaunchpadTrade[] = [];

const createTrade = (token: LaunchpadTokenCard, side: "BUY" | "SELL", timestamp: number): LaunchpadTrade => {
  seq += 1;
  const amountUSD = Math.max(22, Number((token.market.priceUSD * (1200 + (seq % 15) * 140)).toFixed(2)));
  const amountOut = Number((amountUSD / Math.max(token.market.priceUSD, 0.0000001)).toFixed(6));
  const txHash = `0x${hashNumber(`${token.address}:${timestamp}:${seq}`).toString(16).padStart(64, "0")}`;
  return {
    eventId: `${txHash}:0`,
    txHash,
    tokenAddress: token.address,
    side,
    amountIn: amountUSD.toFixed(2),
    amountOut: amountOut.toFixed(6),
    amountUSD,
    buyer: BUYER_ADDRESSES[(seq + timestamp) % BUYER_ADDRESSES.length],
    timestamp: new Date(timestamp).toISOString(),
    blockNumber: 5_000_000 + seq,
  };
};

const seedTrades = () => {
  TOKENS.forEach((token, index) => {
    const bucket: LaunchpadTrade[] = [];
    for (let i = 0; i < 18; i += 1) {
      const ts = now - (index * 13 + i * 3) * 60_000;
      const trade = createTrade(token, i % 4 === 0 ? "SELL" : "BUY", ts);
      bucket.push(trade);
      globalTrades.push(trade);
    }
    tradesByToken.set(token.address.toLowerCase(), bucket);
  });
  globalTrades.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
};

seedTrades();

const simulateMarketTick = () => {
  const elapsed = Date.now() - lastGeneratedAt;
  if (elapsed < 2500) return;
  const ticks = Math.max(1, Math.floor(elapsed / 2500));
  lastGeneratedAt = Date.now();

  for (let i = 0; i < ticks; i += 1) {
    const token = TOKENS[(seq + i) % TOKENS.length];
    const isBuy = (seq + i) % 5 !== 0;
    const drift = isBuy ? 1 + 0.002 + (i % 3) * 0.0009 : 1 - 0.0028;
    token.market.priceUSD = Math.max(0.0000001, Number((token.market.priceUSD * drift).toFixed(10)));
    token.market.change1h = Number((token.market.change1h * 0.82 + (isBuy ? 0.21 : -0.29)).toFixed(2));
    token.market.change24h = Number((token.market.change24h * 0.97 + (isBuy ? 0.28 : -0.33)).toFixed(2));
    token.market.volume24hUSD = Number((token.market.volume24hUSD + 640 + (i % 7) * 57).toFixed(2));
    token.market.updatedAt = new Date().toISOString();
    token.sparkline = [...token.sparkline.slice(-35), token.market.priceUSD];
    token.buysPerMinute = Math.max(0, Number((token.buysPerMinute * 0.85 + (isBuy ? 2.1 : 0.4)).toFixed(2)));

    const trade = createTrade(token, isBuy ? "BUY" : "SELL", Date.now() - i * 700);
    const key = token.address.toLowerCase();
    const list = tradesByToken.get(key) || [];
    tradesByToken.set(key, [trade, ...list].slice(0, 160));
    globalTrades.unshift(trade);
  }

  if (globalTrades.length > 500) {
    globalTrades.length = 500;
  }
};

const normalizeFilters = (filters: LaunchpadFilter[] = []) =>
  filters
    .map((filter) => String(filter || "").trim().toLowerCase())
    .filter(Boolean);

export const getMockLaunchpadTokens = async ({
  page = 1,
  pageSize = 24,
  q = "",
  sort = "mcap",
  filters = [],
}: LaunchpadTokensQuery = {}): Promise<LaunchpadTokensResponse> => {
  simulateMarketTick();
  const filtered = filterTokens(TOKENS, q, normalizeFilters(filters));
  const sorted = sortTokens(filtered, sort as LaunchpadSort);
  const { pageItems, total, hasMore } = paginateTokens(sorted, page, pageSize);
  return {
    items: pageItems,
    page,
    pageSize,
    total,
    hasMore,
  };
};

export const getMockLaunchpadTokenDetail = async (address: string): Promise<LaunchpadTokenCard | null> => {
  simulateMarketTick();
  if (!address) return null;
  const token = TOKENS.find((item) => item.address.toLowerCase() === address.toLowerCase());
  return token || null;
};

const TF_TO_SPAN: Record<string, { points: number; stepMs: number }> = {
  "1h": { points: 60, stepMs: 60_000 },
  "24h": { points: 96, stepMs: 15 * 60_000 },
  "7d": { points: 84, stepMs: 2 * 60 * 60_000 },
  "30d": { points: 120, stepMs: 6 * 60 * 60_000 },
  all: { points: 180, stepMs: 12 * 60 * 60_000 },
};

export const getMockLaunchpadCandles = async (
  address: string,
  tf = "24h"
): Promise<LaunchpadCandle[]> => {
  simulateMarketTick();
  const token = await getMockLaunchpadTokenDetail(address);
  if (!token) return [];
  const profile = TF_TO_SPAN[tf] || TF_TO_SPAN["24h"];
  const candles: LaunchpadCandle[] = [];
  let close = token.market.priceUSD;

  for (let i = profile.points - 1; i >= 0; i -= 1) {
    const timestamp = Date.now() - i * profile.stepMs;
    const wave = Math.sin(i / 5) * 0.018;
    const randomish = ((hashNumber(`${token.address}:${tf}:${i}`) % 100) / 1000) * 0.02;
    const drift = 1 + wave + randomish - token.market.change24h / 10000;
    const nextClose = Math.max(0.0000001, close / drift);
    const high = Math.max(close, nextClose) * (1 + 0.004 + randomish * 0.3);
    const low = Math.min(close, nextClose) * (1 - 0.004 - randomish * 0.3);
    const volumeUSD = Math.max(100, token.market.volume24hUSD / profile.points + randomish * 1200);
    candles.push({
      timestamp,
      open: Number(nextClose.toFixed(10)),
      high: Number(high.toFixed(10)),
      low: Number(low.toFixed(10)),
      close: Number(close.toFixed(10)),
      volumeUSD: Number(volumeUSD.toFixed(2)),
    });
    close = nextClose;
  }

  return candles;
};

const selectTradesByType = (items: LaunchpadTrade[], type = "buys") => {
  if (type === "trades") return items;
  if (type === "sells") return items.filter((trade) => trade.side === "SELL");
  if (type === "liquidity") return [];
  return items.filter((trade) => trade.side === "BUY");
};

export const getMockLaunchpadActivity = async ({
  limit = 20,
  type = "buys",
}: LaunchpadActivityQuery = {}): Promise<LaunchpadActivityResponse> => {
  simulateMarketTick();
  const rows = selectTradesByType(globalTrades, type).slice(0, Math.max(1, Number(limit) || 20));
  return {
    items: rows,
    updatedAt: new Date().toISOString(),
  };
};

export const getMockLaunchpadTokenActivity = async (
  address: string,
  { limit = 30, type = "trades" }: LaunchpadActivityQuery = {}
): Promise<LaunchpadActivityResponse> => {
  simulateMarketTick();
  const key = (address || "").toLowerCase();
  const rows = tradesByToken.get(key) || [];
  const filtered = selectTradesByType(rows, type).slice(0, Math.max(1, Number(limit) || 30));
  return {
    items: filtered,
    updatedAt: new Date().toISOString(),
  };
};

export const subscribeMockLiveBuys = (
  callback: (trade: LaunchpadTrade) => void,
  tokenAddress?: string
): (() => void) => {
  if (typeof callback !== "function") {
    return () => {};
  }
  const timer = window.setInterval(() => {
    simulateMarketTick();
    const source = tokenAddress
      ? (tradesByToken.get(tokenAddress.toLowerCase()) || [])[0]
      : globalTrades[0];
    if (!source) return;
    callback(source);
  }, 4000);

  return () => {
    window.clearInterval(timer);
  };
};
