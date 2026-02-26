import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    hgetall: vi.fn(),
    hset: vi.fn(),
    zrange: vi.fn(),
    zcard: vi.fn(),
    zrevrank: vi.fn(),
    pipeline: vi.fn(() => ({
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      hgetall: vi.fn(),
      hset: vi.fn(),
      zadd: vi.fn(),
      zrange: vi.fn(),
      zrevrank: vi.fn(),
      exec: vi.fn(async () => []),
    })),
    scan: vi.fn(async () => ["0", []]),
    keys: vi.fn(async () => []),
    expire: vi.fn(async () => 1),
    incr: vi.fn(async () => 1),
  },
}));

const ORIGINAL_ENV = { ...process.env };
const AUTH_TOKEN = "test-ingest-token";
const SEASON_ID = "season-1";

const ADDRESS_CRX = "0xbd5e387fa453cebf03b1a6a9dfe2a828b93aa95b";
const ADDRESS_WETH = "0x4200000000000000000000000000000000000006";
const ADDRESS_USDM = "0xfafddbb3fc7688494971a79cc65dca3ef82079e7";
const TEST_WALLET = "0x1111111111111111111111111111111111111111";

const createReq = ({
  method = "POST",
  headers = {},
  query = {},
  body = {},
} = {}) => ({
  method,
  headers,
  query,
  body,
  socket: { remoteAddress: "127.0.0.1" },
});

const createRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
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
  res.end = () => {
    res.ended = true;
    return res;
  };
  return res;
};

const applyBasePointsEnv = () => {
  process.env.POINTS_INGEST_TOKEN = AUTH_TOKEN;
  process.env.CRON_SECRET = "";
  process.env.POINTS_SEASON_ID = SEASON_ID;
  process.env.VITE_POINTS_SEASON_ID = SEASON_ID;
  process.env.POINTS_SEASON_START = "2026-01-01T00:00:00.000Z";
  process.env.POINTS_SEASON_START_BLOCK = "1";
  process.env.POINTS_SEASON_END = "2026-12-31T00:00:00.000Z";
  process.env.POINTS_CRX_ADDRESS = ADDRESS_CRX;
  process.env.POINTS_WETH_ADDRESS = ADDRESS_WETH;
  process.env.POINTS_USDM_ADDRESS = ADDRESS_USDM;
  process.env.POINTS_REWARDS_CLAIM_OPENS_AT = "2025-01-01T00:00:00.000Z";
  process.env.WHITELIST_CLAIM_OPENS_AT = "2025-01-01T00:00:00.000Z";
  process.env.POINTS_REWARD_CLAIM_SIGNATURE_TTL_MS = "600000";
  process.env.WHITELIST_CLAIM_SIGNATURE_TTL_MS = "600000";
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  applyBasePointsEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("points endpoint season guards", () => {
  it("rejects season mismatch on /api/points/ingest", async () => {
    const { default: handler } = await import("../../../api/points/ingest.js");
    const req = createReq({
      method: "POST",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      body: { seasonId: "season-2" },
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body?.error || "").toContain("seasonId mismatch");
  });

  it("rejects season mismatch on /api/points/recalc", async () => {
    const { default: handler } = await import("../../../api/points/recalc.js");
    const req = createReq({
      method: "POST",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      body: { seasonId: "season-2" },
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body?.error || "").toContain("seasonId mismatch");
  });

  it("rejects season mismatch on /api/points/reset", async () => {
    const { default: handler } = await import("../../../api/points/reset.js");
    const req = createReq({
      method: "POST",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      body: { seasonId: "season-2" },
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body?.error || "").toContain("seasonId mismatch");
  });

  it("rejects season mismatch on /api/cron/points-jobs", async () => {
    const { default: handler } = await import("../../../api/cron/points-jobs.js");
    const req = createReq({
      method: "POST",
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
      body: { seasonId: "season-2" },
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body?.error || "").toContain("seasonId mismatch");
  });
});

describe("claim TTL guards", () => {
  it("rejects too-old points claim signatures", async () => {
    const { default: handler } = await import("../../../api/points/claim.js");
    const now = Date.now();
    const req = createReq({
      method: "POST",
      body: {
        address: TEST_WALLET,
        signature: "0xdeadbeef",
        issuedAt: now - 600001,
      },
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toBe("Signature expired");
  });

  it("rejects points claim signatures too far in the future", async () => {
    const { default: handler } = await import("../../../api/points/claim.js");
    const now = Date.now();
    const req = createReq({
      method: "POST",
      body: {
        address: TEST_WALLET,
        signature: "0xdeadbeef",
        issuedAt: now + 61000,
      },
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toBe("Signature expired");
  });

  it("rejects too-old whitelist claim signatures", async () => {
    const { default: handler } = await import(
      "../../../api/whitelist-rewards/claim.js"
    );
    const now = Date.now();
    const req = createReq({
      method: "POST",
      body: {
        address: TEST_WALLET,
        signature: "0xdeadbeef",
        issuedAt: now - 600001,
      },
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toBe("Signature expired");
  });

  it("rejects whitelist claim signatures too far in the future", async () => {
    const { default: handler } = await import(
      "../../../api/whitelist-rewards/claim.js"
    );
    const now = Date.now();
    const req = createReq({
      method: "POST",
      body: {
        address: TEST_WALLET,
        signature: "0xdeadbeef",
        issuedAt: now + 61000,
      },
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toBe("Signature expired");
  });
});
