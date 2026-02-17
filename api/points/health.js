import { kv } from "@vercel/kv";
import { getKeys, getSeasonConfig } from "../../src/server/pointsLib.js";
import { maybeTriggerPointsSelfHeal } from "../../src/server/pointsSelfHeal.js";

const DEFAULT_MAX_STALE_MS = 20 * 60 * 1000;

const clamp = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
};

const getMaxStaleMs = () =>
  clamp(
    process.env.POINTS_HEALTH_MAX_STALE_MS,
    60_000,
    24 * 60 * 60 * 1000,
    DEFAULT_MAX_STALE_MS
  );

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const seasonInput = String(req.query?.seasonId || "").trim();
  const { seasonId: configuredSeasonId, missing } = getSeasonConfig();
  const seasonId = seasonInput || configuredSeasonId;
  if (!seasonId) {
    res.status(503).json({
      ok: false,
      healthy: false,
      error: `Missing required env: ${missing?.join(", ") || "POINTS_SEASON_ID"}`,
    });
    return;
  }

  const keys = getKeys(seasonId);
  const maxStaleMs = getMaxStaleMs();
  const now = Date.now();

  try {
    const [updatedAtRaw, summaryRaw] = await Promise.all([
      kv.get(keys.updatedAt),
      kv.hgetall(keys.summary),
    ]);
    const updatedAt = Number(updatedAtRaw || summaryRaw?.updatedAt || 0);
    const hasUpdatedAt = Number.isFinite(updatedAt) && updatedAt > 0;
    const ageMs = hasUpdatedAt ? Math.max(0, now - updatedAt) : null;
    const healthy = Boolean(hasUpdatedAt && ageMs !== null && ageMs <= maxStaleMs);
    const selfHeal = healthy
      ? null
      : await maybeTriggerPointsSelfHeal({
          kv,
          req,
          seasonId,
          updatedAtMs: updatedAt,
          staleMs: maxStaleMs,
          reason: "health_stale",
          includeWhitelist: false,
        });

    res.status(healthy ? 200 : 503).json({
      ok: healthy,
      healthy,
      seasonId,
      updatedAt: hasUpdatedAt ? updatedAt : null,
      ageMs,
      maxStaleMs,
      checkedAt: now,
      reason: healthy ? "fresh" : "stale_or_missing_updated_at",
      selfHealTriggered: Boolean(selfHeal?.triggered),
      selfHealStatus: selfHeal?.status ?? null,
      selfHealSkipReason: selfHeal?.skipped ?? null,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      healthy: false,
      seasonId,
      error: err?.message || "Server error",
    });
  }
}
