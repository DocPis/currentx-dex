/* eslint-env node */

const toFiniteNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const clampInt = (value, min, max, fallback) => {
  const num = Math.floor(toFiniteNumber(value, fallback));
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

const clampRatio = (value, fallback) => {
  const num = toFiniteNumber(value, fallback);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(1, Math.max(0, num));
};

export const normalizeTimestampMs = (value) => {
  const num = toFiniteNumber(value, 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.floor(num);
};

export const shouldRunPeriodicTask = ({
  enabled = true,
  nowMs = Date.now(),
  lastRunAtMs = 0,
  intervalMs = 0,
} = {}) => {
  if (!enabled) return false;
  const safeNow = normalizeTimestampMs(nowMs);
  const safeLast = normalizeTimestampMs(lastRunAtMs);
  const safeInterval = clampInt(intervalMs, 0, 24 * 60 * 60 * 1000, 0);
  if (safeInterval <= 0) return true;
  if (!safeLast || safeLast > safeNow) return true;
  return safeNow - safeLast >= safeInterval;
};

export const summarizeLpFallback = ({
  processed = 0,
  fallbackCount = 0,
  warnRatio = 0.35,
  minProcessed = 10,
} = {}) => {
  const safeProcessed = clampInt(processed, 0, 1_000_000, 0);
  const safeFallback = clampInt(fallbackCount, 0, 1_000_000, 0);
  const safeWarnRatio = clampRatio(warnRatio, 0.35);
  const safeMinProcessed = clampInt(minProcessed, 1, 1_000_000, 10);

  const boundedFallback = Math.min(safeFallback, safeProcessed || safeFallback);
  const fallbackRate =
    safeProcessed > 0 ? boundedFallback / safeProcessed : boundedFallback > 0 ? 1 : 0;
  const warning = safeProcessed >= safeMinProcessed && fallbackRate >= safeWarnRatio;

  return {
    processed: safeProcessed,
    fallbackCount: boundedFallback,
    fallbackRate,
    warning,
    warnRatio: safeWarnRatio,
    minProcessed: safeMinProcessed,
  };
};
