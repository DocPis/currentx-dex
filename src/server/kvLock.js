/* eslint-env node */
import { randomUUID } from "node:crypto";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createLockToken = () => {
  if (typeof randomUUID === "function") return randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
};

export const acquireKvLock = async (
  kv,
  key,
  {
    ttlSeconds = 20,
    retries = 3,
    retryDelayMs = 120,
  } = {}
) => {
  if (!kv || typeof kv.set !== "function") {
    throw new Error("KV lock unavailable");
  }
  const safeTtl = Math.max(1, Math.floor(Number(ttlSeconds) || 20));
  const maxAttempts = Math.max(1, Math.floor(Number(retries) || 0) + 1);
  const delayMs = Math.max(0, Math.floor(Number(retryDelayMs) || 0));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const token = createLockToken();
    const setResult = await kv.set(key, token, { nx: true, ex: safeTtl });
    if (setResult) {
      return token;
    }
    if (attempt < maxAttempts - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }
  return "";
};

export const releaseKvLock = async (kv, key, token) => {
  if (!kv || !key || !token) return false;
  try {
    if (typeof kv.eval === "function") {
      const script = `
        local current = redis.call("GET", KEYS[1])
        if not current then return 0 end
        if current ~= ARGV[1] then return 0 end
        return redis.call("DEL", KEYS[1])
      `;
      const released = Number(await kv.eval(script, [key], [String(token)]));
      return released > 0;
    }
    // Avoid non-atomic compare+delete fallback: prefer TTL expiry over unsafe unlock.
    return false;
  } catch {
    return false;
  }
};
