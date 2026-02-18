import { kv } from "@vercel/kv";
import { acquireKvLock, releaseKvLock } from "../../src/server/kvLock.js";
import {
  normalizeTimestampMs,
  shouldRunPeriodicTask,
  summarizeLpFallback,
} from "../../src/server/pointsJobsGuardrails.js";
import { authorizeBearerRequest } from "../../src/server/requestAuth.js";

const LOCK_TTL_SECONDS = 8 * 60;
const LOCK_RETRIES = 2;
const LOCK_RETRY_DELAY_MS = 250;
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 3;
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_MAX_INGEST_ROUNDS = 6;
const DEFAULT_MAX_RECALC_ROUNDS = 4;
const DEFAULT_RECALC_LIMIT = 40;
const DEFAULT_FAST_LP_TIMEOUT_MS = 10_000;
const DEFAULT_DEEP_RECALC_ENABLED = true;
const DEFAULT_DEEP_RECALC_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_DEEP_RECALC_ROUNDS = 1;
const DEFAULT_DEEP_RECALC_LIMIT = 12;
const DEFAULT_DEEP_LP_TIMEOUT_MS = 15_000;
const DEFAULT_LP_FALLBACK_WARN_RATIO = 0.35;
const DEFAULT_LP_FALLBACK_WARN_MIN_PROCESSED = 10;
const DEFAULT_MAX_RUNTIME_MS = 50_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parsePositiveInt = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
};

const parseNonNegativeInt = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
};

const parseRatio = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(1, Math.max(0, num));
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

const getMaxRecalcRounds = () =>
  Math.max(
    1,
    Math.min(48, parsePositiveInt(process.env.POINTS_JOBS_MAX_RECALC_ROUNDS, DEFAULT_MAX_RECALC_ROUNDS))
  );

const getRecalcLimit = () =>
  Math.max(
    1,
    Math.min(1000, parsePositiveInt(process.env.POINTS_JOBS_RECALC_LIMIT, DEFAULT_RECALC_LIMIT))
  );

const getFastLpTimeoutMs = () =>
  Math.max(
    1000,
    Math.min(
      60_000,
      parsePositiveInt(process.env.POINTS_JOBS_FAST_LP_TIMEOUT_MS, DEFAULT_FAST_LP_TIMEOUT_MS)
    )
  );

const getDeepRecalcEnabled = () =>
  parseBool(process.env.POINTS_JOBS_DEEP_RECALC, DEFAULT_DEEP_RECALC_ENABLED);

const getDeepRecalcIntervalMs = () =>
  Math.max(
    0,
    Math.min(
      24 * 60 * 60 * 1000,
      parseNonNegativeInt(
        process.env.POINTS_JOBS_DEEP_RECALC_INTERVAL_MS,
        DEFAULT_DEEP_RECALC_INTERVAL_MS
      )
    )
  );

const getDeepRecalcRounds = () =>
  Math.max(
    1,
    Math.min(12, parsePositiveInt(process.env.POINTS_JOBS_DEEP_RECALC_ROUNDS, DEFAULT_DEEP_RECALC_ROUNDS))
  );

const getDeepRecalcLimit = () =>
  Math.max(
    1,
    Math.min(250, parsePositiveInt(process.env.POINTS_JOBS_DEEP_RECALC_LIMIT, DEFAULT_DEEP_RECALC_LIMIT))
  );

const getDeepLpTimeoutMs = () =>
  Math.max(
    1000,
    Math.min(
      60_000,
      parsePositiveInt(process.env.POINTS_JOBS_DEEP_LP_TIMEOUT_MS, DEFAULT_DEEP_LP_TIMEOUT_MS)
    )
  );

const getLpFallbackWarnRatio = () =>
  parseRatio(process.env.POINTS_LP_FALLBACK_WARN_RATIO, DEFAULT_LP_FALLBACK_WARN_RATIO);

const getLpFallbackWarnMinProcessed = () =>
  Math.max(
    1,
    Math.min(
      1000,
      parsePositiveInt(
        process.env.POINTS_LP_FALLBACK_WARN_MIN_PROCESSED,
        DEFAULT_LP_FALLBACK_WARN_MIN_PROCESSED
      )
    )
  );

const getMaxRuntimeMs = () =>
  Math.max(
    15_000,
    Math.min(
      5 * 60 * 1000,
      parsePositiveInt(process.env.POINTS_JOBS_MAX_RUNTIME_MS, DEFAULT_MAX_RUNTIME_MS)
    )
  );

const getRequestTimeoutMs = () =>
  Math.max(
    10_000,
    Math.min(
      5 * 60 * 1000,
      parsePositiveInt(process.env.POINTS_JOBS_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS)
    )
  );

const normalizeCursor = (value) => {
  let cursor = Number(value);
  if (!Number.isFinite(cursor) || cursor < 0) return 0;
  // Safety guard in case a millis timestamp is accidentally written.
  if (cursor > 1e12) cursor = Math.floor(cursor / 1000);
  return Math.max(0, Math.floor(cursor));
};

const resolveSeasonStateId = (seasonId) => {
  const fallback = String(
    process.env.POINTS_SEASON_ID || process.env.VITE_POINTS_SEASON_ID || "default"
  ).trim();
  const normalized = String(seasonId || "").trim();
  return normalized || fallback || "default";
};

const getJobStateKeys = (seasonId) => {
  const stateSeasonId = resolveSeasonStateId(seasonId);
  const base = `points:${stateSeasonId}:jobs`;
  return {
    stateSeasonId,
    recalcCursor: `${base}:recalc:cursor`,
    deepRecalcCursor: `${base}:recalc:deep:cursor`,
    deepRecalcLastRunAt: `${base}:recalc:deep:last-run-at`,
    lpFallbackAlert: `${base}:recalc:lp-fallback-alert`,
  };
};

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
  const requestTimeoutMs = getRequestTimeoutMs();
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
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
  const stateKeys = getJobStateKeys(seasonId);

  const token = getInternalToken();
  const baseUrl = resolveBaseUrl(req);
  if (!token || !baseUrl) {
    res.status(500).json({
      error: "Unable to resolve internal API credentials or base URL",
    });
    return;
  }

  const lockKey = `points:cron:jobs:lock:${stateKeys.stateSeasonId}`;
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
  const whitelistBody = seasonId ? { seasonId } : {};
  const maxIngestRounds = getMaxIngestRounds();
  const maxRecalcRounds = getMaxRecalcRounds();
  const recalcLimit = getRecalcLimit();
  const fastLpTimeoutMs = getFastLpTimeoutMs();
  const deepRecalcEnabled = getDeepRecalcEnabled();
  const deepRecalcIntervalMs = getDeepRecalcIntervalMs();
  const deepRecalcRounds = getDeepRecalcRounds();
  const deepRecalcLimit = getDeepRecalcLimit();
  const deepLpTimeoutMs = getDeepLpTimeoutMs();
  const lpFallbackWarnRatio = getLpFallbackWarnRatio();
  const lpFallbackWarnMinProcessed = getLpFallbackWarnMinProcessed();
  const maxRuntimeMs = getMaxRuntimeMs();
  const jobStartedAt = Date.now();
  const runtimeExceeded = () => Date.now() - jobStartedAt >= maxRuntimeMs;
  const alerts = [];

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

  const trackLpFallbackAlert = ({ recalcResult, mode, round, cursorStart }) => {
    const payload = recalcResult?.payload || {};
    const summary = summarizeLpFallback({
      processed: payload?.processed,
      fallbackCount: payload?.lpFallbackCount,
      warnRatio: lpFallbackWarnRatio,
      minProcessed: lpFallbackWarnMinProcessed,
    });
    if (!summary.warning) return;
    const alert = {
      kind: "lp_fallback_ratio",
      mode,
      round,
      cursorStart: normalizeCursor(cursorStart),
      processed: summary.processed,
      fallbackCount: summary.fallbackCount,
      fallbackRate: Number(summary.fallbackRate.toFixed(6)),
      thresholdRatio: summary.warnRatio,
      minProcessed: summary.minProcessed,
      emittedAt: Date.now(),
    };
    alerts.push(alert);
    console.warn(
      `[points-jobs] LP fallback warning mode=${mode} round=${round} cursor=${alert.cursorStart} processed=${alert.processed} fallbacks=${alert.fallbackCount} rate=${alert.fallbackRate}`
    );
  };

  try {
    let ingestRoundsExecuted = 0;
    let ingestStoppedReason = "complete";
    for (let round = 1; round <= maxIngestRounds; round += 1) {
      if (runtimeExceeded()) {
        ingestStoppedReason = "runtime_budget";
        break;
      }
      const ingestResult = await runEndpoint({
        name: `points-ingest#${round}`,
        path: "/api/points/ingest",
        body: ingestBody,
        required: true,
      });
      if (!ingestResult?.ok) return;
      ingestRoundsExecuted = round;
      const ingestedWallets = Number(ingestResult?.payload?.ingestedWallets || 0);
      const cursorUpdates = Number(ingestResult?.payload?.cursorUpdates || 0);
      if (ingestedWallets <= 0 && cursorUpdates <= 0) {
        ingestStoppedReason = "source_idle";
        break;
      }
    }

    const storedCursorRaw = await kv.get(stateKeys.recalcCursor);
    let recalcCursor = normalizeCursor(storedCursorRaw);
    const recalcCursorStart = recalcCursor;
    let recalcRoundsExecuted = 0;
    let recalcDone = false;
    let recalcStoppedReason = "max_rounds";

    const deepLastRunRaw = await kv.get(stateKeys.deepRecalcLastRunAt);
    const deepLastRunAt = normalizeTimestampMs(deepLastRunRaw);
    const deepRecalcDue = shouldRunPeriodicTask({
      enabled: deepRecalcEnabled,
      nowMs: Date.now(),
      lastRunAtMs: deepLastRunAt,
      intervalMs: deepRecalcIntervalMs,
    });
    let deepRecalcRan = false;
    let deepRecalcCursorStart = 0;
    let deepRecalcCursorNext = 0;
    let deepRecalcRoundsExecuted = 0;
    let deepRecalcDone = false;
    let deepRecalcStoppedReason = deepRecalcEnabled ? "interval_not_elapsed" : "disabled";

    if (deepRecalcDue) {
      deepRecalcStoppedReason = "max_rounds";
      const deepStoredCursorRaw = await kv.get(stateKeys.deepRecalcCursor);
      let deepCursor = normalizeCursor(deepStoredCursorRaw);
      deepRecalcCursorStart = deepCursor;
      deepRecalcCursorNext = deepCursor;

      for (let round = 1; round <= deepRecalcRounds; round += 1) {
        if (runtimeExceeded()) {
          deepRecalcStoppedReason = "runtime_budget";
          break;
        }

        const deepBody = seasonId
          ? {
              seasonId,
              fast: false,
              limit: deepRecalcLimit,
              cursor: deepCursor,
              lpTimeoutMs: deepLpTimeoutMs,
            }
          : {
              fast: false,
              limit: deepRecalcLimit,
              cursor: deepCursor,
              lpTimeoutMs: deepLpTimeoutMs,
            };

        const deepResult = await runEndpoint({
          name: `points-recalc-deep#${round}`,
          path: "/api/points/recalc",
          body: deepBody,
          required: true,
        });
        if (!deepResult?.ok) return;

        deepRecalcRan = true;
        deepRecalcRoundsExecuted = round;
        trackLpFallbackAlert({
          recalcResult: deepResult,
          mode: "deep",
          round,
          cursorStart: deepCursor,
        });

        const payload = deepResult?.payload || {};
        const processed = Number(payload?.processed || 0);
        const done = Boolean(payload?.done);
        const nextCursorRaw = payload?.nextCursor;
        const nextCursor = normalizeCursor(nextCursorRaw);
        const hasNextCursor =
          nextCursorRaw !== null &&
          nextCursorRaw !== undefined &&
          nextCursorRaw !== "" &&
          Number.isFinite(Number(nextCursorRaw));

        if (done || !hasNextCursor) {
          deepRecalcDone = true;
          deepCursor = 0;
          deepRecalcCursorNext = 0;
          await kv.set(stateKeys.deepRecalcCursor, 0);
          deepRecalcStoppedReason = done ? "sweep_complete" : "missing_next_cursor";
          break;
        }

        if (nextCursor <= deepCursor) {
          deepCursor = 0;
          deepRecalcCursorNext = 0;
          await kv.set(stateKeys.deepRecalcCursor, 0);
          deepRecalcStoppedReason = "cursor_stall";
          break;
        }

        deepCursor = nextCursor;
        deepRecalcCursorNext = deepCursor;
        await kv.set(stateKeys.deepRecalcCursor, deepCursor);

        if (processed <= 0) {
          deepRecalcStoppedReason = "no_progress";
          break;
        }
      }

      if (deepRecalcRan) {
        await kv.set(stateKeys.deepRecalcLastRunAt, Date.now());
      }
    }

    for (let round = 1; round <= maxRecalcRounds; round += 1) {
      if (runtimeExceeded()) {
        recalcStoppedReason = "runtime_budget";
        break;
      }
      const recalcBody = seasonId
        ? { seasonId, fast: true, limit: recalcLimit, cursor: recalcCursor, lpTimeoutMs: fastLpTimeoutMs }
        : { fast: true, limit: recalcLimit, cursor: recalcCursor, lpTimeoutMs: fastLpTimeoutMs };
      const recalcResult = await runEndpoint({
        name: `points-recalc#${round}`,
        path: "/api/points/recalc",
        body: recalcBody,
        required: true,
      });
      if (!recalcResult?.ok) return;
      recalcRoundsExecuted = round;
      trackLpFallbackAlert({
        recalcResult,
        mode: "fast",
        round,
        cursorStart: recalcCursor,
      });

      const payload = recalcResult?.payload || {};
      const processed = Number(payload?.processed || 0);
      const done = Boolean(payload?.done);
      const nextCursorRaw = payload?.nextCursor;
      const nextCursor = normalizeCursor(nextCursorRaw);
      const hasNextCursor =
        nextCursorRaw !== null &&
        nextCursorRaw !== undefined &&
        nextCursorRaw !== "" &&
        Number.isFinite(Number(nextCursorRaw));

      if (done || !hasNextCursor) {
        recalcDone = true;
        recalcCursor = 0;
        await kv.set(stateKeys.recalcCursor, 0);
        recalcStoppedReason = done ? "sweep_complete" : "missing_next_cursor";
        break;
      }

      if (nextCursor <= recalcCursor) {
        recalcCursor = 0;
        await kv.set(stateKeys.recalcCursor, 0);
        recalcStoppedReason = "cursor_stall";
        break;
      }

      recalcCursor = nextCursor;
      await kv.set(stateKeys.recalcCursor, recalcCursor);

      if (processed <= 0) {
        recalcStoppedReason = "no_progress";
        break;
      }
    }

    if (alerts.length) {
      await kv.set(stateKeys.lpFallbackAlert, JSON.stringify(alerts[alerts.length - 1]), {
        ex: 24 * 60 * 60,
      });
    }

    if (includeWhitelist) {
      if (!runtimeExceeded()) {
        await runEndpoint({
          name: "whitelist-recalc",
          path: "/api/whitelist-rewards/recalc",
          body: whitelistBody,
          required: false,
        });
      } else {
        calls.push({
          name: "whitelist-recalc",
          ok: true,
          skipped: true,
          reason: "runtime_budget",
        });
      }
    }

    res.status(200).json({
      ok: true,
      seasonId: seasonId || null,
      stateSeasonId: stateKeys.stateSeasonId,
      lockUnavailable,
      maxIngestRounds,
      maxRecalcRounds,
      recalcLimit,
      fastLpTimeoutMs,
      deepRecalcEnabled,
      deepRecalcIntervalMs,
      deepRecalcRounds,
      deepRecalcLimit,
      deepLpTimeoutMs,
      maxRuntimeMs,
      ingestRoundsExecuted,
      ingestStoppedReason,
      recalcRoundsExecuted,
      recalcDone,
      recalcStoppedReason,
      recalcCursorStart,
      recalcCursorNext: recalcCursor,
      deepRecalcRan,
      deepRecalcRoundsExecuted,
      deepRecalcDone,
      deepRecalcStoppedReason,
      deepRecalcCursorStart,
      deepRecalcCursorNext,
      lpFallbackWarnRatio,
      lpFallbackWarnMinProcessed,
      alerts,
      calls,
      executedAt: Date.now(),
    });
  } finally {
    if (lockToken) {
      await releaseKvLock(kv, lockKey, lockToken);
    }
  }
}
