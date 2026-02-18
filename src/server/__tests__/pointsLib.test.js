import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTokenPrices } from "../pointsLib.js";

const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const asJsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });

describe("fetchTokenPrices", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the next endpoint when the first has no usable bundle price", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("primary")) {
        return asJsonResponse({
          data: {
            tokens: [{ id: TOKEN_A, derivedETH: "0.001" }],
            bundles: [],
          },
        });
      }
      return asJsonResponse({
        data: {
          tokens: [{ id: TOKEN_A, derivedETH: "0.001" }],
          bundles: [{ ethPriceUSD: "2000" }],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const prices = await fetchTokenPrices({
      url: "https://primary.example,https://fallback.example",
      apiKey: "",
      tokenIds: [TOKEN_A],
    });

    expect(Object.keys(prices)).toHaveLength(1);
    expect(prices[TOKEN_A]).toBeCloseTo(2, 9);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the best partial map when no endpoint can price every token", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("one")) {
        return asJsonResponse({
          data: {
            tokens: [{ id: TOKEN_A, derivedETH: "0.001" }],
            bundles: [{ ethPriceUSD: "2000" }],
          },
        });
      }
      return asJsonResponse({
        data: {
          tokens: [{ id: TOKEN_B, derivedETH: "0.002" }],
          bundles: [{ ethPriceUSD: "1000" }],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const prices = await fetchTokenPrices({
      url: "https://one.example,https://two.example",
      apiKey: "",
      tokenIds: [TOKEN_A, TOKEN_B],
    });

    expect(Object.keys(prices)).toHaveLength(1);
    expect(prices[TOKEN_A]).toBeCloseTo(2, 9);
    expect(prices[TOKEN_B]).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
