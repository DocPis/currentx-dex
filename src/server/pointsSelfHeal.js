/* eslint-env node */

const DEFAULT_SELF_HEAL_STALE_MS = 8 * 60 * 1000;
const DEFAULT_SELF_HEAL_COOLDOWN_MS = 3 * 60 * 1000;
const DEFAULT_SELF_HEAL_TIMEOUT_MS = 3000;

const clamp = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
};

const getSelfHealStaleMs = () =>
  clamp(
    process.env.POINTS_SELF_HEAL_STALE_MS,
    60_000,
    24 * 60 * 60 * 1000,
    DEFAULT_SELF_HEAL_STALE_MS
  );

const getSelfHealCooldownMs = () =>
  clamp(
    process.env.POINTS_SELF_HEAL_COOLDOWN_MS,
    30_000,
    24 * 60 * 60 * 1000,
    DEFAULT_SELF_HEAL_COOLDOWN_MS
  );

const getSelfHealTimeoutMs = () =>
  clamp(
    process.env.POINTS_SELF_HEAL_TIMEOUT_MS,
    1000,
    30_000,
    DEFAULT_SELF_HEAL_TIMEOUT_MS
  );

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/+$/u, "");

const resolveBaseUrl = (req) => {
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req?.headers?.["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || String(req?.headers?.host || process.env.VERCEL_URL || "").trim();
  if (host) {
    if (/^https?:\/\//iu.test(host)) return normalizeBaseUrl(host);
    const proto = forwardedProto || (host.includes("localhost") ? "http" : "https");
    return normalizeBaseUrl(`${proto}://${host}`);
  }
  return normalizeBaseUrl(process.env.POINTS_API_BASE || process.env.API_BASE_URL || "");
};

const getInternalToken = () =>
  String(process.env.POINTS_INGEST_TOKEN || process.env.CRON_SECRET || "").trim();

const toNumberSafe = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export const maybeTriggerPointsSelfHeal = async ({
  kv,
  req,
  seasonId,
  updatedAtMs,
  staleMs = null,
  includeWhitelist = false,
  reason = "",
} = {}) => {
  if (!kv || typeof kv.set !== "function" || !seasonId) {
    return { triggered: false, skipped: "invalid_input" };
  }

  const token = getInternalToken();
  if (!token) return { triggered: false, skipped: "missing_token" };
  const baseUrl = resolveBaseUrl(req);
  if (!baseUrl) return { triggered: false, skipped: "missing_base_url" };

  const now = Date.now();
  const staleLimitMs =
    Number.isFinite(Number(staleMs)) && Number(staleMs) > 0
      ? Math.floor(Number(staleMs))
      : getSelfHealStaleMs();
  const updatedAt = toNumberSafe(updatedAtMs, 0);
  const isStale = !updatedAt || now - updatedAt >= staleLimitMs;
  if (!isStale) return { triggered: false, skipped: "fresh" };

  const cooldownMs = getSelfHealCooldownMs();
  const cooldownSec = Math.max(30, Math.ceil(cooldownMs / 1000));
  const cooldownKey = `points:${seasonId}:selfheal:cooldown`;
  const lockResult = await kv.set(cooldownKey, String(now), { nx: true, ex: cooldownSec });
  if (!lockResult) return { triggered: false, skipped: "cooldown" };

  const timeoutMs = getSelfHealTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/cron/points-jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        seasonId,
        includeWhitelist: parseBool(includeWhitelist, false),
        reason: String(reason || "").slice(0, 120),
      }),
      signal: controller.signal,
    });

    return {
      triggered: res.ok,
      status: Number(res.status || 0),
      skipped: res.ok ? null : `http_${Number(res.status || 0) || "error"}`,
    };
  } catch (error) {
    return {
      triggered: false,
      skipped: error?.name === "AbortError" ? "timeout" : "request_error",
    };
  } finally {
    clearTimeout(timeout);
  }
};

