import { kv } from "@vercel/kv";
import { acquireKvLock, releaseKvLock } from "../../src/server/kvLock.js";
import { authorizeBearerRequest } from "../../src/server/requestAuth.js";

const LOCK_TTL_SECONDS = 8 * 60;
const LOCK_RETRIES = 2;
const LOCK_RETRY_DELAY_MS = 250;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 3;
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_MAX_INGEST_ROUNDS = 6;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parsePositiveInt = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
};

const parseBool = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const getMaxIngestRounds = () =>
  Math.max(
    1,
    Math.min(48, parsePositiveInt(process.env.POINTS_JOBS_MAX_INGEST_ROUNDS, DEFAULT_MAX_INGEST_ROUNDS))
  );

const getSecrets = () =>
  [process.env.POINTS_INGEST_TOKEN, process.env.CRON_SECRET]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

const getInternalToken = () =>
  String(process.env.POINTS_INGEST_TOKEN || process.env.CRON_SECRET || "").trim();

const parseBody = (req) => {
  if (!req?.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  if (typeof req.body === "object") return req.body;
  return {};
};

const resolveBaseUrl = (req) => {
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req?.headers?.["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || String(req?.headers?.host || process.env.VERCEL_URL || "").trim();
  if (!host) return "";
  if (/^https?:\/\//iu.test(host)) return host.replace(/\/+$/u, "");
  const proto = forwardedProto || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`.replace(/\/+$/u, "");
};

const postJsonWithRetry = async ({ name, url, token, body }) => {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });
      const raw = await res.text();
      let payload = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = { raw };
      }
      if (res.ok) {
        return {
          ok: true,
          status: res.status,
          payload,
        };
      }
      const detail = payload?.error || payload?.message || raw || `HTTP ${res.status}`;
      const error = new Error(`${name} failed (${res.status}): ${detail}`);
      error.httpStatus = Number(res.status || 0);
      error.payload = payload;
      lastError = error;
      if (!RETRY_STATUSES.has(error.httpStatus) || attempt >= MAX_ATTEMPTS) {
        throw error;
      }
    } catch (err) {
      lastError = err;
      const status = Number(err?.httpStatus || 0);
      const retriable = !status || RETRY_STATUSES.has(status);
      if (!retriable || attempt >= MAX_ATTEMPTS) {
        throw err;
      }
      await sleep(800 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("Request failed");
};

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secrets = getSecrets();
  if (!secrets.length) {
    res.status(503).json({
      error: "Missing required env: set POINTS_INGEST_TOKEN or CRON_SECRET",
    });
    return;
  }
  if (!authorizeBearerRequest(req, secrets)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = parseBody(req);
  const seasonId = String(body?.seasonId ?? req.query?.seasonId ?? "").trim();
  const includeWhitelist = parseBool(
    body?.includeWhitelist ?? req.query?.includeWhitelist,
    true
  );

  const token = getInternalToken();
  const baseUrl = resolveBaseUrl(req);
  if (!token || !baseUrl) {
    res.status(500).json({
      error: "Unable to resolve internal API credentials or base URL",
    });
    return;
  }

  const lockKey = `points:cron:jobs:lock:${seasonId || "default"}`;
  let lockToken = "";
  let lockUnavailable = false;
  try {
    lockToken = await acquireKvLock(kv, lockKey, {
      ttlSeconds: LOCK_TTL_SECONDS,
      retries: LOCK_RETRIES,
      retryDelayMs: LOCK_RETRY_DELAY_MS,
    });
  } catch {
    lockUnavailable = true;
  }

  if (!lockUnavailable && !lockToken) {
    res.status(202).json({
      ok: true,
      skipped: true,
      reason: "Points jobs already in progress",
      seasonId: seasonId || null,
    });
    return;
  }

  const calls = [];
  const ingestBody = seasonId ? { seasonId } : {};
  const recalcBody = seasonId ? { seasonId, fast: true, limit: 500 } : { fast: true, limit: 500 };
  const whitelistBody = seasonId ? { seasonId } : {};
  const maxIngestRounds = getMaxIngestRounds();

  const runEndpoint = async ({ name, path, body, required }) => {
    const startedAt = Date.now();
    try {
      const result = await postJsonWithRetry({
        name,
        url: `${baseUrl}${path}`,
        token,
        body,
      });
      const entry = {
        name,
        ok: true,
        status: result.status,
        durationMs: Date.now() - startedAt,
        payload: result.payload,
      };
      calls.push(entry);
      return entry;
    } catch (error) {
      const entry = {
        name,
        ok: false,
        status: Number(error?.httpStatus || 0) || null,
        durationMs: Date.now() - startedAt,
        error: error?.message || "Request failed",
        payload: error?.payload || null,
      };
      calls.push(entry);
      if (required) {
        const status = Number(error?.httpStatus || 0);
        res.status(status >= 400 && status < 600 ? status : 502).json({
          ok: false,
          seasonId: seasonId || null,
          lockUnavailable,
          calls,
        });
      }
      return entry;
    }
  };

  try {
    for (let round = 1; round <= maxIngestRounds; round += 1) {
      const ingestResult = await runEndpoint({
        name: `points-ingest#${round}`,
        path: "/api/points/ingest",
        body: ingestBody,
        required: true,
      });
      if (!ingestResult?.ok) return;
      const ingestedWallets = Number(ingestResult?.payload?.ingestedWallets || 0);
      const cursorUpdates = Number(ingestResult?.payload?.cursorUpdates || 0);
      if (ingestedWallets <= 0 && cursorUpdates <= 0) break;
    }

    const recalcResult = await runEndpoint({
      name: "points-recalc",
      path: "/api/points/recalc",
      body: recalcBody,
      required: true,
    });
    if (!recalcResult?.ok) return;

    if (includeWhitelist) {
      await runEndpoint({
        name: "whitelist-recalc",
        path: "/api/whitelist-rewards/recalc",
        body: whitelistBody,
        required: false,
      });
    }

    res.status(200).json({
      ok: true,
      seasonId: seasonId || null,
      lockUnavailable,
      maxIngestRounds,
      calls,
      executedAt: Date.now(),
    });
  } finally {
    if (lockToken) {
      await releaseKvLock(kv, lockKey, lockToken);
    }
  }
}
