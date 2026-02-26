import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/kv", () => ({
  kv: {
    zrange: vi.fn(),
    hgetall: vi.fn(),
    hset: vi.fn(async () => 1),
    get: vi.fn(async () => null),
    pipeline: vi.fn(() => ({
      hgetall: vi.fn(),
      exec: vi.fn(async () => []),
    })),
    scan: vi.fn(async () => ["0", []]),
    keys: vi.fn(async () => []),
  },
}));

const ORIGINAL_ENV = { ...process.env };
const SEASON_ID = "season-1";
const ADDR_1 = "0x00000000000000000000000000000000000000a1";
const ADDR_2 = "0x00000000000000000000000000000000000000a2";
const ADDR_3 = "0x00000000000000000000000000000000000000a3";

const createReq = ({ method = "GET", query = {}, headers = {} } = {}) => ({
  method,
  query,
  headers,
  socket: { remoteAddress: "127.0.0.1" },
});

const createRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.setHeader = (key, value) => {
    res.headers[String(key)] = value;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  res.send = (payload) => {
    if (typeof payload === "string") {
      try {
        res.body = JSON.parse(payload);
      } catch {
        res.body = payload;
      }
    } else {
      res.body = payload;
    }
    return res;
  };
  res.end = () => res;
  return res;
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  process.env.POINTS_SEASON_ID = SEASON_ID;
  process.env.VITE_POINTS_SEASON_ID = SEASON_ID;
  process.env.POINTS_LEADERBOARD_EXCLUDED_ADDRESSES = "";
  process.env.POINTS_EXCLUDED_ADDRESSES = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("points leaderboard summary fallback", () => {
  it("rebuilds summary from full leaderboard when stored summary is missing", async () => {
    const { kv } = await import("@vercel/kv");
    const topEntries = [ADDR_1, "10", ADDR_2, "9"];
    const fullEntries = [ADDR_1, "10", ADDR_2, "9", ADDR_3, "8"];

    kv.zrange.mockImplementation(async (_key, start, end, opts) => {
      if (start === 0 && end === 999 && opts?.rev === true) return topEntries;
      if (start === 0 && end === -1 && opts?.withScores === true && !opts?.rev) {
        return fullEntries;
      }
      return [];
    });
    kv.hgetall.mockResolvedValue(null);

    const { default: handler } = await import("../../../api/points/leaderboard.js");
    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.summary?.walletCount).toBe(3);
    expect(res.body?.summary?.totalPoints).toBe(27);
    expect(kv.hset).toHaveBeenCalledTimes(1);
    expect(kv.zrange).toHaveBeenCalledWith(
      `points:${SEASON_ID}:leaderboard`,
      0,
      -1,
      { withScores: true }
    );
  });
});
