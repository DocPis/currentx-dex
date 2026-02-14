import { describe, expect, it } from "vitest";
import {
  filterTokens,
  formatCompactNumber,
  formatPercent,
  formatUsd,
  sortTokens,
  trimTrailingZeros,
} from "../utils";
import type { LaunchpadTokenCard } from "../types";

const BASE_TOKEN = (overrides: Partial<LaunchpadTokenCard>): LaunchpadTokenCard => ({
  address: "0x0000000000000000000000000000000000000001",
  name: "Alpha",
  symbol: "ALP",
  decimals: 18,
  logoUrl: "https://example.com/logo.png",
  createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  creator: "0x0000000000000000000000000000000000000002",
  verified: false,
  tags: ["utility"],
  buysPerMinute: 2,
  sparkline: [1, 2, 3],
  market: {
    priceUSD: 0.25,
    mcapUSD: 100000,
    liquidityUSD: 50000,
    volume24hUSD: 20000,
    change1h: 2,
    change24h: 5,
    updatedAt: new Date().toISOString(),
  },
  ...overrides,
});

describe("launchpad utils formatting", () => {
  it("formats compact numbers and USD", () => {
    expect(formatCompactNumber(1532000)).toBe("1.532M");
    expect(formatUsd(1532000)).toBe("$1.532M");
  });

  it("formats percents and trims zeros", () => {
    expect(trimTrailingZeros("12.3400")).toBe("12.34");
    expect(formatPercent(4.5)).toBe("+4.5%");
    expect(formatPercent(-3)).toBe("-3%");
  });
});

describe("launchpad token filtering/sorting", () => {
  const tokens: LaunchpadTokenCard[] = [
    BASE_TOKEN({
      address: "0x0000000000000000000000000000000000000003",
      name: "Verified One",
      symbol: "VER1",
      verified: true,
      tags: ["meme", "verified"],
      buysPerMinute: 20,
      market: {
        priceUSD: 1,
        mcapUSD: 900000,
        liquidityUSD: 600000,
        volume24hUSD: 800000,
        change1h: 7,
        change24h: 15,
        updatedAt: new Date().toISOString(),
      },
    }),
    BASE_TOKEN({
      address: "0x0000000000000000000000000000000000000004",
      name: "Meme Rocket",
      symbol: "MEME",
      tags: ["meme", "rocket"],
      createdAt: new Date().toISOString(),
      buysPerMinute: 14,
      market: {
        priceUSD: 0.02,
        mcapUSD: 400000,
        liquidityUSD: 150000,
        volume24hUSD: 440000,
        change1h: 10,
        change24h: 44,
        updatedAt: new Date().toISOString(),
      },
    }),
    BASE_TOKEN({
      address: "0x0000000000000000000000000000000000000005",
      name: "Quiet Token",
      symbol: "QUIET",
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      buysPerMinute: 1,
      market: {
        priceUSD: 0.1,
        mcapUSD: 120000,
        liquidityUSD: 10000,
        volume24hUSD: 5000,
        change1h: -1,
        change24h: -12,
        updatedAt: new Date().toISOString(),
      },
    }),
  ];

  it("filters by search and verified flag", () => {
    const bySearch = filterTokens(tokens, "rocket", []);
    expect(bySearch).toHaveLength(1);
    expect(bySearch[0].symbol).toBe("MEME");

    const verifiedOnly = filterTokens(tokens, "", ["verified"]);
    expect(verifiedOnly).toHaveLength(1);
    expect(verifiedOnly[0].symbol).toBe("VER1");
  });

  it("filters by tags and sorts by market cap", () => {
    const memeOnly = filterTokens(tokens, "", ["meme"]);
    expect(memeOnly).toHaveLength(2);

    const sorted = sortTokens(memeOnly, "mcap");
    expect(sorted[0].symbol).toBe("VER1");
  });
});
