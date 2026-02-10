import { kv } from "@vercel/kv";

const DEFAULT_SEASON_ID = "season-1";
const DEFAULT_START_MS = Date.UTC(2026, 1, 4, 0, 0, 0);
const PAGE_LIMIT = 1000;

const parseTime = (value) => {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const getSeasonConfig = () => {
  const seasonId = process.env.POINTS_SEASON_ID || DEFAULT_SEASON_ID;
  const startMs =
    parseTime(process.env.POINTS_SEASON_START) ||
    parseTime(process.env.VITE_POINTS_SEASON_START) ||
    DEFAULT_START_MS;
  const endMs =
    parseTime(process.env.POINTS_SEASON_END) ||
    parseTime(process.env.VITE_POINTS_SEASON_END) ||
    null;
  return {
    seasonId,
    startMs,
    endMs,
  };
};

const getSubgraphConfig = () => ({
  v2Url:
    process.env.UNIV2_SUBGRAPH_URL ||
    process.env.VITE_UNIV2_SUBGRAPH ||
    "",
  v2Key:
    process.env.UNIV2_SUBGRAPH_API_KEY ||
    process.env.VITE_UNIV2_SUBGRAPH_API_KEY ||
    "",
  v3Url:
    process.env.UNIV3_SUBGRAPH_URL ||
    process.env.VITE_UNIV3_SUBGRAPH ||
    "",
  v3Key:
    process.env.UNIV3_SUBGRAPH_API_KEY ||
    process.env.VITE_UNIV3_SUBGRAPH_API_KEY ||
    "",
});

const buildHeaders = (apiKey) => {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
};

const postGraph = async (url, apiKey, query, variables) => {
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Subgraph HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || "Subgraph error");
  }
  return json.data;
};

const normalizeAddress = (addr) => (addr ? String(addr).toLowerCase() : "");

const resolveWallet = (swap, isV3) => {
  if (!swap) return "";
  if (isV3) {
    return (
      normalizeAddress(swap.origin) ||
      normalizeAddress(swap.sender) ||
      normalizeAddress(swap.recipient)
    );
  }
  return normalizeAddress(swap.sender) || normalizeAddress(swap.to);
};

const fetchSwapsPage = async ({ url, apiKey, start, end, isV3 }) => {
  const query = `
    query Swaps($start: Int!, $end: Int!, $first: Int!) {
      swaps(
        first: $first
        orderBy: timestamp
        orderDirection: asc
        where: { timestamp_gte: $start, timestamp_lte: $end }
      ) {
        id
        timestamp
        amountUSD
        ${isV3 ? "origin sender recipient" : "sender to"}
      }
    }
  `;

  const data = await postGraph(url, apiKey, query, {
    start,
    end,
    first: PAGE_LIMIT,
  });
  return data?.swaps || [];
};

const getKeys = (seasonId, source) => {
  const base = `points:${seasonId}`;
  return {
    leaderboard: `${base}:leaderboard`,
    updatedAt: `${base}:updatedAt`,
    cursor: source ? `${base}:cursor:${source}` : null,
    user: (address) => `${base}:user:${address}`,
  };
};

const ingestSource = async ({
  source,
  url,
  apiKey,
  startSec,
  endSec,
  keys,
}) => {
  const totals = new Map();
  let cursor = startSec;
  let done = false;
  let iterations = 0;

  while (!done && iterations < 50) {
    iterations += 1;
    const swaps = await fetchSwapsPage({
      url,
      apiKey,
      start: cursor,
      end: endSec,
      isV3: source === "v3",
    });
    if (!swaps.length) break;

    let lastTs = cursor;
    swaps.forEach((swap) => {
      const wallet = resolveWallet(swap, source === "v3");
      if (!wallet) return;
      const amount = Math.abs(Number(swap.amountUSD || 0));
      if (!Number.isFinite(amount) || amount <= 0) return;
      totals.set(wallet, (totals.get(wallet) || 0) + amount);
      const ts = Number(swap.timestamp || 0);
      if (Number.isFinite(ts) && ts > lastTs) lastTs = ts;
    });

    if (lastTs <= cursor) {
      done = true;
    } else {
      cursor = lastTs + 1; // move past the last timestamp
    }

    if (swaps.length < PAGE_LIMIT) {
      done = true;
    }
  }

  if (cursor > startSec) {
    await kv.set(keys.cursor, cursor);
  }

  return totals;
};

export default async function handler(req, res) {
  const secret = process.env.POINTS_INGEST_TOKEN || "";
  const authHeader = req.headers?.authorization || "";
  const token = req.query?.token || "";

  if (secret) {
    const matches =
      authHeader === `Bearer ${secret}` ||
      authHeader === secret ||
      token === secret;
    if (!matches) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { seasonId, startMs, endMs } = getSeasonConfig();
  const { v2Url, v2Key, v3Url, v3Key } = getSubgraphConfig();
  if (!v2Url && !v3Url) {
    res.status(503).json({ error: "Subgraph URLs not configured" });
    return;
  }

  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor((endMs || Date.now()) / 1000);
  const keys = getKeys(seasonId);

  try {
    const sources = [];
    if (v2Url) sources.push({ source: "v2", url: v2Url, apiKey: v2Key });
    if (v3Url) sources.push({ source: "v3", url: v3Url, apiKey: v3Key });

    const aggregated = new Map();

    for (const src of sources) {
      const cursorKey = getKeys(seasonId, src.source).cursor;
      const storedCursor = await kv.get(cursorKey);
      const cursor =
        Number(storedCursor || 0) > startSec
          ? Number(storedCursor)
          : startSec;

      const totals = await ingestSource({
        source: src.source,
        url: src.url,
        apiKey: src.apiKey,
        startSec: cursor,
        endSec,
        keys: getKeys(seasonId, src.source),
      });

      totals.forEach((amount, wallet) => {
        aggregated.set(wallet, (aggregated.get(wallet) || 0) + amount);
      });
    }

    const now = Date.now();
    const pipeline = kv.pipeline();
    aggregated.forEach((amount, wallet) => {
      const userKey = keys.user(wallet);
      pipeline.zincrby(keys.leaderboard, amount, wallet);
      pipeline.hincrbyfloat(userKey, "volumeUsd", amount);
      pipeline.hincrbyfloat(userKey, "points", amount);
      pipeline.hset(userKey, {
        address: wallet,
        multiplier: 1,
        lpUsd: 0,
        boostedVolumeUsd: 0,
        updatedAt: now,
      });
    });
    pipeline.set(keys.updatedAt, now);
    await pipeline.exec();

    res.status(200).json({
      ok: true,
      seasonId,
      updatedAt: now,
      ingestedWallets: aggregated.size,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
