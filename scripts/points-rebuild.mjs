const env = process.env || {};

const baseUrl = String(
  env.POINTS_API_BASE || env.VITE_API_BASE || env.NEXT_PUBLIC_API_BASE || ""
).trim();
const token = String(env.POINTS_INGEST_TOKEN || env.CRON_SECRET || "").trim();
const seasonId = String(env.POINTS_SEASON_ID || env.VITE_POINTS_SEASON_ID || "").trim();
const recalcLimit = Number.isFinite(Number(env.POINTS_RECALC_LIMIT))
  ? Math.max(1, Math.floor(Number(env.POINTS_RECALC_LIMIT)))
  : 500;
const maxIngestRounds = Number.isFinite(Number(env.POINTS_MAX_INGEST_ROUNDS))
  ? Math.max(1, Math.floor(Number(env.POINTS_MAX_INGEST_ROUNDS)))
  : 240;
const maxCallRetries = Number.isFinite(Number(env.POINTS_CALL_MAX_RETRIES))
  ? Math.max(0, Math.floor(Number(env.POINTS_CALL_MAX_RETRIES)))
  : 8;
const ingestWindowSeconds = Number.isFinite(Number(env.POINTS_INGEST_WINDOW_SECONDS))
  ? Math.max(60, Math.floor(Number(env.POINTS_INGEST_WINDOW_SECONDS)))
  : null;
const callTimeoutMs = Number.isFinite(Number(env.POINTS_CALL_TIMEOUT_MS))
  ? Math.max(1000, Math.floor(Number(env.POINTS_CALL_TIMEOUT_MS)))
  : 45000;
const retryBaseDelayMs = Number.isFinite(Number(env.POINTS_CALL_RETRY_BASE_MS))
  ? Math.max(100, Math.floor(Number(env.POINTS_CALL_RETRY_BASE_MS)))
  : 3000;
const ingestRoundDelayMs = Number.isFinite(Number(env.POINTS_INGEST_ROUND_DELAY_MS))
  ? Math.max(0, Math.floor(Number(env.POINTS_INGEST_ROUND_DELAY_MS)))
  : 1200;
const skipReset =
  String(env.POINTS_SKIP_RESET || "")
    .trim()
    .toLowerCase() === "1" ||
  String(env.POINTS_SKIP_RESET || "")
    .trim()
    .toLowerCase() === "true";
const skipIngest =
  String(env.POINTS_SKIP_INGEST || "")
    .trim()
    .toLowerCase() === "1" ||
  String(env.POINTS_SKIP_INGEST || "")
    .trim()
    .toLowerCase() === "true";
const recalcFast =
  String(env.POINTS_RECALC_FAST || "")
    .trim()
    .toLowerCase() === "1" ||
  String(env.POINTS_RECALC_FAST || "")
    .trim()
    .toLowerCase() === "true";

if (!baseUrl) {
  console.error("Missing POINTS_API_BASE (example: https://your-app.vercel.app).");
  process.exit(1);
}
if (!token) {
  console.error("Missing POINTS_INGEST_TOKEN (or CRON_SECRET).");
  process.exit(1);
}

const normalizeBase = (value) => String(value || "").replace(/\/+$/u, "");
const root = normalizeBase(baseUrl);

const buildUrl = (path, params = {}) => {
  const url = new URL(`${root}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetriableStatus = (status) => {
  const code = Number(status);
  return code === 429 || (code >= 500 && code <= 599);
};

const callJsonOnce = async (path, params = {}) => {
  const url = buildUrl(path, params);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), callTimeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        `${path} -> request timeout after ${callTimeoutMs}ms`
      );
      timeoutError.httpStatus = 0;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  const bodyText = await res.text();
  let payload = {};
  try {
    payload = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    payload = { raw: bodyText };
  }
  if (!res.ok) {
    const detail = payload?.error || payload?.message || bodyText || `HTTP ${res.status}`;
    const error = new Error(`${path} -> ${res.status}: ${detail}`);
    error.httpStatus = Number(res.status || 0);
    throw error;
  }
  return payload;
};

const callJson = async (path, params = {}) => {
  let attempt = 0;
  while (true) {
    try {
      return await callJsonOnce(path, params);
    } catch (error) {
      attempt += 1;
      const status = Number(error?.httpStatus || 0);
      const retriable = isRetriableStatus(status) || !status;
      if (!retriable || attempt > maxCallRetries) throw error;
      const delayMs = retryBaseDelayMs * Math.min(16, 2 ** (attempt - 1));
      console.log(
        `[points-rebuild] retry ${attempt}/${maxCallRetries} for ${path} after ${delayMs}ms (status=${status || "n/a"})`
      );
      await sleep(delayMs);
    }
  }
};

const run = async () => {
  console.log(`[points-rebuild] base=${root}`);
  if (seasonId) {
    console.log(`[points-rebuild] season=${seasonId}`);
  }
  console.log(`[points-rebuild] callTimeoutMs=${callTimeoutMs}`);
  if (Number.isFinite(ingestWindowSeconds)) {
    console.log(`[points-rebuild] ingestWindowSeconds=${ingestWindowSeconds}`);
  }

  if (skipReset) {
    console.log("[points-rebuild] reset skipped (POINTS_SKIP_RESET=1).");
  } else {
    console.log("[points-rebuild] reset...");
    const reset = await callJson("/api/points/reset", { seasonId });
    console.log(
      `[points-rebuild] reset ok: deleted=${Number(reset?.deleted || 0)} season=${reset?.seasonId || seasonId || "auto"}`
    );
  }

  if (skipIngest) {
    console.log("[points-rebuild] ingest skipped (POINTS_SKIP_INGEST=1).");
  } else {
    console.log("[points-rebuild] ingest loop...");
    for (let round = 1; round <= maxIngestRounds; round += 1) {
      const ingestParams = { seasonId };
      if (Number.isFinite(ingestWindowSeconds)) {
        ingestParams.ingestWindowSeconds = ingestWindowSeconds;
      }
      const ingest = await callJson("/api/points/ingest", ingestParams);
      const ingestedWallets = Number(ingest?.ingestedWallets || 0);
      const cursorUpdates = Number(ingest?.cursorUpdates || 0);
      const updatedAt = Number(ingest?.updatedAt || 0);
      const updatedLabel = Number.isFinite(updatedAt) && updatedAt > 0
        ? new Date(updatedAt).toISOString()
        : "n/a";
      console.log(
        `[points-rebuild] ingest #${round}: wallets=${ingestedWallets} cursorUpdates=${cursorUpdates} updatedAt=${updatedLabel}`
      );
      if (ingestedWallets <= 0 && cursorUpdates <= 0) break;
      if (ingestRoundDelayMs > 0) {
        await sleep(ingestRoundDelayMs);
      }
    }
  }

  console.log("[points-rebuild] recalc loop...");
  let cursor = 0;
  let rounds = 0;
  while (true) {
    rounds += 1;
    const recalc = await callJson("/api/points/recalc", {
      seasonId,
      cursor,
      limit: recalcLimit,
      fast: recalcFast ? 1 : "",
    });
    const processed = Number(recalc?.processed || 0);
    const nextCursorRaw = recalc?.nextCursor;
    const done = Boolean(recalc?.done);
    console.log(
      `[points-rebuild] recalc #${rounds}: processed=${processed} cursor=${cursor} next=${nextCursorRaw ?? "null"} done=${done}`
    );
    if (done || nextCursorRaw === null || nextCursorRaw === undefined || nextCursorRaw === "") {
      break;
    }
    const nextCursor = Number(nextCursorRaw);
    if (!Number.isFinite(nextCursor) || nextCursor <= cursor) {
      break;
    }
    cursor = nextCursor;
  }

  console.log("[points-rebuild] done.");
};

run().catch((error) => {
  console.error(`[points-rebuild] failed: ${error?.message || error}`);
  process.exit(1);
});
