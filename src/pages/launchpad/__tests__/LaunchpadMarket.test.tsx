import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LaunchpadTokenCard } from "../../../services/launchpad/types";
import LaunchpadMarket from "../LaunchpadMarket";

const TOKENS: LaunchpadTokenCard[] = [
  {
    address: "0x00000000000000000000000000000000000000a1",
    name: "Alpha Token",
    symbol: "ALPHA",
    decimals: 18,
    logoUrl: "https://example.com/alpha.png",
    createdAt: new Date().toISOString(),
    creator: "0x0000000000000000000000000000000000000011",
    tags: ["meme"],
    buysPerMinute: 12,
    sparkline: [1, 2, 1.8],
    market: {
      priceUSD: 0.2,
      mcapUSD: 500000,
      liquidityUSD: 100000,
      volume24hUSD: 200000,
      change1h: 2,
      change24h: 8,
      updatedAt: new Date().toISOString(),
    },
  },
  {
    address: "0x00000000000000000000000000000000000000a2",
    name: "Beta Token",
    symbol: "BETA",
    decimals: 18,
    logoUrl: "https://example.com/beta.png",
    createdAt: new Date().toISOString(),
    creator: "0x0000000000000000000000000000000000000012",
    tags: ["gaming"],
    buysPerMinute: 7,
    sparkline: [1, 0.9, 1.1],
    market: {
      priceUSD: 0.1,
      mcapUSD: 300000,
      liquidityUSD: 90000,
      volume24hUSD: 150000,
      change1h: -1,
      change24h: 4,
      updatedAt: new Date().toISOString(),
    },
  },
];

vi.mock("../../../services/launchpad/hooks", () => ({
  useLaunchpadTokens: ({ q = "", filters = [] }: { q?: string; filters?: string[] }) => {
    const query = String(q || "").toLowerCase();
    let filtered = TOKENS.filter((token) => {
      if (!query) return true;
      return `${token.name} ${token.symbol} ${token.address}`.toLowerCase().includes(query);
    });

    filters.forEach((raw) => {
      const f = String(raw || "").toLowerCase();
      if (!f) return;
      filtered = filtered.filter((token) =>
        (token.tags || []).map((tag) => String(tag).toLowerCase()).includes(f)
      );
    });

    return {
      items: filtered,
      total: filtered.length,
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
      isFetching: false,
      isMocked: true,
    };
  },
  useLiveBuys: () => ({ items: [], isLoading: false, mode: "polling" }),
  useHasLaunchpadBackend: () => false,
}));

describe("LaunchpadMarket", () => {
  it("renders list and updates when a tag filter is toggled", () => {
    render(<LaunchpadMarket onOpenToken={vi.fn()} />);

    expect(screen.getByText("Alpha Token")).toBeInTheDocument();
    expect(screen.getByText("Beta Token")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /meme/i }));

    expect(screen.getByText("Alpha Token")).toBeInTheDocument();
    expect(screen.queryByText("Beta Token")).not.toBeInTheDocument();
  });

  it("updates results from search input", () => {
    render(<LaunchpadMarket onOpenToken={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Search name, symbol, or token address"), {
      target: { value: "beta" },
    });

    expect(screen.getByText("Beta Token")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Token")).not.toBeInTheDocument();
  });
});
