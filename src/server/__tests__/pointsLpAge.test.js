import { beforeEach, describe, expect, it, vi } from "vitest";

const FACTORY_ADDRESS = "0x09cf8a0b9e8c89bff6d1acbe1467e8e335bdd03e";
const POSITION_MANAGER_ADDRESS = "0xa02e90a5f5ef73c434f5a7e6a77e6508f009cb9d";
const POOL_ADDRESS = "0x9999999999999999999999999999999999999999";
const WALLET = "0x1111111111111111111111111111111111111111";
const CRX = "0xbd5e387fa453cebf03b1a6a9dfe2a828b93aa95b";
const USDM = "0xfafddbb3fc7688494971a79cc65dca3ef82079e7";
const WETH = "0x4200000000000000000000000000000000000006";

vi.mock("ethers", () => {
  class MockJsonRpcProvider {
    async getBlockNumber() {
      return 100;
    }

    async getLogs(params) {
      const address = String(params?.address || "").toLowerCase();
      if (address === POSITION_MANAGER_ADDRESS) {
        return [{ blockNumber: 25 }];
      }
      return [];
    }

    async getBlock() {
      return { timestamp: Math.floor(Date.now() / 1000) - 7200 };
    }
  }

  class MockContract {
    constructor(address) {
      this.address = String(address || "").toLowerCase();
    }

    async balanceOf() {
      if (this.address === POSITION_MANAGER_ADDRESS) return 1n;
      return 0n;
    }

    async tokenOfOwnerByIndex() {
      return 1n;
    }

    async positions() {
      return {
        token0: CRX,
        token1: USDM,
        tickLower: -60,
        tickUpper: 60,
        liquidity: 1_000_000_000_000_000_000n,
        fee: 3000,
      };
    }

    async getPool() {
      if (this.address === FACTORY_ADDRESS) return POOL_ADDRESS;
      return "0x0000000000000000000000000000000000000000";
    }

    async slot0() {
      if (this.address === POOL_ADDRESS) {
        return {
          sqrtPriceX96: 79_228_162_514_264_337_593_543_950_336n,
          tick: 0,
        };
      }
      return null;
    }

    async decimals() {
      return 18;
    }
  }

  return {
    Contract: MockContract,
    JsonRpcProvider: MockJsonRpcProvider,
    id: (value) => `topic:${value}`,
    toBeHex: (value) => `0x${BigInt(value).toString(16)}`,
    zeroPadValue: (value) => String(value),
  };
});

describe("computeLpData lpAgeSeconds", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("keeps on-chain lpAgeSeconds when on-chain fallback is used", async () => {
    const { computeLpData } = await import("../pointsLib.js");

    const out = await computeLpData({
      url: "",
      apiKey: "",
      wallet: WALLET,
      addr: { crx: CRX, usdm: USDM, weth: WETH },
      priceMap: {
        [CRX]: 1,
        [USDM]: 1,
      },
      startBlock: 1,
      allowOnchain: true,
      allowStakerScan: false,
    });

    expect(out.lpAgeSeconds).not.toBeNull();
    expect(Number(out.lpAgeSeconds)).toBeGreaterThan(0);
  });
});
