import { kv } from "@vercel/kv";

const DELETE_BATCH_SIZE = 200;
const SCAN_BATCH_SIZE = 1000;
const MAX_SCAN_ROUNDS = 2000;

const parseTime = (value) => {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBlock = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num);
};

const pickEnvValue = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
};

const getSeasonConfig = () => {
  const seasonId = pickEnvValue(
    process.env.POINTS_SEASON_ID,
    process.env.VITE_POINTS_SEASON_ID
  );
  const startMs =
    parseTime(process.env.POINTS_SEASON_START) ||
    parseTime(process.env.VITE_POINTS_SEASON_START);
  const startBlock =
    parseBlock(process.env.POINTS_SEASON_START_BLOCK) ||
    parseBlock(process.env.VITE_POINTS_SEASON_START_BLOCK);
  const endMs =
    parseTime(process.env.POINTS_SEASON_END) ||
    parseTime(process.env.VITE_POINTS_SEASON_END);
  const missing = [];
  if (!seasonId) missing.push("POINTS_SEASON_ID");
  if (!Number.isFinite(startMs)) missing.push("POINTS_SEASON_START");
  if (!Number.isFinite(startBlock)) missing.push("POINTS_SEASON_START_BLOCK");
  return {
    seasonId,
    startMs,
    startBlock,
    endMs: Number.isFinite(endMs) ? endMs : null,
    missing,
  };
};

const getSecrets = () =>
  [process.env.POINTS_INGEST_TOKEN, process.env.CRON_SECRET]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

const authorizeRequest = (req, secrets) => {
  const list = Array.isArray(secrets) ? secrets : [secrets];
  const active = list.filter(Boolean);
  if (!active.length) return true;
  const authHeader = req.headers?.authorization || "";
  const token = req.query?.token || "";
  return active.some(
    (secret) =>
      authHeader === `Bearer ${secret}` ||
      authHeader === secret ||
      token === secret
  );
};

const normalizeScanResult = (result) => {
  if (Array.isArray(result)) {
    const [cursor, keys] = result;
    return {
      cursor: String(cursor ?? "0"),
      keys: Array.isArray(keys) ? keys : [],
    };
  }
  if (result && typeof result === "object") {
    const cursor = result.cursor ?? result.nextCursor ?? result[0] ?? "0";
    const keys = result.keys ?? result.result ?? result[1] ?? [];
    return {
      cursor: String(cursor ?? "0"),
      keys: Array.isArray(keys) ? keys : [],
    };
  }
  return { cursor: "0", keys: [] };
};

const scanKeysByPrefix = async (prefix) => {
  if (typeof kv.scan !== "function") {
    if (typeof kv.keys === "function") {
      const keys = await kv.keys(`${prefix}*`);
      return Array.isArray(keys) ? keys : [];
    }
    return [];
  }

  let cursor = "0";
  const seen = new Set();
  const keys = [];

  for (let i = 0; i < MAX_SCAN_ROUNDS; i += 1) {
    const raw = await kv.scan(cursor, {
      match: `${prefix}*`,
      count: SCAN_BATCH_SIZE,
    });
    const parsed = normalizeScanResult(raw);
    (parsed.keys || []).forEach((key) => {
      if (typeof key !== "string") return;
      if (seen.has(key)) return;
      seen.add(key);
      keys.push(key);
    });
    if (parsed.cursor === "0" || parsed.cursor === cursor) {
      break;
    }
    cursor = parsed.cursor;
  }

  return keys;
};

const deleteInBatches = async (keys) => {
  let deleted = 0;
  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
    if (!batch.length) continue;
    await kv.del(...batch);
    deleted += batch.length;
  }
  return deleted;
};

export default async function handler(req, res) {
  const secrets = getSecrets();
  if (!secrets.length) {
    res.status(503).json({
      error: "Missing required env: set POINTS_INGEST_TOKEN or CRON_SECRET",
    });
    return;
  }
  if (!authorizeRequest(req, secrets)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { seasonId, missing: missingSeasonEnv } = getSeasonConfig();
  const targetSeason = req.query?.seasonId || seasonId;
  if (!targetSeason || missingSeasonEnv?.length) {
    res.status(503).json({
      error: `Missing required env: ${missingSeasonEnv?.join(", ") || "POINTS_SEASON_ID"}`,
    });
    return;
  }
  const prefix = `points:${targetSeason}:`;

  try {
    const keys = await scanKeysByPrefix(prefix);
    if (!keys.length) {
      res.status(200).json({
        ok: true,
        seasonId: targetSeason,
        deleted: 0,
        prefix,
      });
      return;
    }

    const deleted = await deleteInBatches(keys);
    res.status(200).json({
      ok: true,
      seasonId: targetSeason,
      deleted,
      prefix,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
