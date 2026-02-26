import { kv } from "@vercel/kv";
import { verifyMessage } from "ethers";
import { acquireKvLock, releaseKvLock } from "../../src/server/kvLock.js";
import { buildWhitelistClaimMessage } from "../../src/shared/lib/whitelistRewards.js";
import {
  computeClaimPayout,
  getWhitelistClaimState,
  getWhitelistKeys,
  getWhitelistRewardsConfig,
  normalizeAddress,
  parseStoredRewardRow,
} from "../../src/server/whitelistRewardsLib.js";

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

const getIssuedAt = (input) => {
  const num = Number(input);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num);
};

const DEFAULT_MAX_FUTURE_SKEW_MS = 60 * 1000;
const MAX_ALLOWED_FUTURE_SKEW_MS = 10 * 60 * 1000;

const getMaxFutureSkewMs = (ttlMs) => {
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl <= 0) return DEFAULT_MAX_FUTURE_SKEW_MS;
  const configured = Number(
    process.env.WHITELIST_CLAIM_MAX_FUTURE_SKEW_MS ??
      process.env.CLAIM_SIGNATURE_MAX_FUTURE_SKEW_MS
  );
  if (!Number.isFinite(configured) || configured < 0) {
    return Math.min(DEFAULT_MAX_FUTURE_SKEW_MS, Math.floor(ttl));
  }
  return Math.min(
    Math.floor(ttl),
    Math.floor(MAX_ALLOWED_FUTURE_SKEW_MS),
    Math.floor(configured)
  );
};

const isSignatureExpired = ({ nowMs, issuedAt, ttlMs }) => {
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl <= 0) return true;
  const maxFutureSkewMs = getMaxFutureSkewMs(ttl);
  if (issuedAt > nowMs + maxFutureSkewMs) return true;
  return nowMs - issuedAt > ttl;
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = parseBody(req);
  const address = normalizeAddress(body?.address || req.query?.address || "");
  const signature = String(body?.signature || req.query?.signature || "");
  const issuedAt = getIssuedAt(body?.issuedAt || req.query?.issuedAt);
  const config = getWhitelistRewardsConfig(body?.seasonId || req.query?.seasonId);
  const nowMs = Date.now();

  if (!address) {
    res.status(400).json({ error: "Missing address" });
    return;
  }
  if (!signature) {
    res.status(400).json({ error: "Missing signature" });
    return;
  }
  if (!issuedAt) {
    res.status(400).json({ error: "Missing issuedAt" });
    return;
  }
  if (!config?.seasonId) {
    res.status(503).json({ error: "Missing required env: POINTS_SEASON_ID" });
    return;
  }
  if (!Number.isFinite(config?.claimOpensAtMs)) {
    res.status(503).json({
      error:
        "Missing required env: set POINTS_SEASON_END (+ POINTS_FINALIZATION_WINDOW_HOURS) or WHITELIST_CLAIM_OPENS_AT",
    });
    return;
  }
  if (isSignatureExpired({ nowMs, issuedAt, ttlMs: config.claimSignatureTtlMs })) {
    res.status(400).json({
      error: "Signature expired",
      ttlMs: config.claimSignatureTtlMs,
    });
    return;
  }
  if (nowMs < config.claimOpensAtMs) {
    res.status(403).json({
      error: "Claim is not open yet",
      claimOpensAt: config.claimOpensAtMs,
      claimOpen: false,
    });
    return;
  }

  const keys = getWhitelistKeys(config.seasonId);
  const message = buildWhitelistClaimMessage({
    address,
    seasonId: config.seasonId,
    issuedAt,
  });

  let recoveredAddress = "";
  try {
    recoveredAddress = normalizeAddress(verifyMessage(message, signature));
  } catch {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }
  if (!recoveredAddress || recoveredAddress !== address) {
    res.status(401).json({ error: "Signature does not match address" });
    return;
  }

  try {
    const lockKey = `whitelist:${config.seasonId}:claim:lock:${address}`;
    let lockToken = "";
    try {
      lockToken = await acquireKvLock(kv, lockKey, {
        ttlSeconds: 20,
        retries: 2,
        retryDelayMs: 100,
      });
    } catch {
      res.status(503).json({ error: "Claim lock unavailable. Retry in a few seconds." });
      return;
    }
    if (!lockToken) {
      res.status(409).json({
        error: "Claim already in progress for this wallet. Retry in a few seconds.",
        seasonId: config.seasonId,
        address,
      });
      return;
    }

    try {
      const stored = await kv.hgetall(keys.user(address));
      const user = parseStoredRewardRow(stored);
      if (!user || !user.address || !user.whitelisted) {
        res.status(404).json({ error: "Wallet not found in whitelist rewards" });
        return;
      }

      const payout = computeClaimPayout(user, config, nowMs);
      if (payout.claimTotalCrx <= 0) {
        res.status(409).json({
          error: "Nothing claimable now",
          seasonId: config.seasonId,
          address,
          claimState: payout,
        });
        return;
      }

      const nextClaimCount = Number.isFinite(user.claimCount)
        ? user.claimCount + 1
        : 1;
      const nextClaimVersion = Math.max(
        0,
        Math.floor(Number(stored?.claimVersion || user.claimCount || 0))
      ) + 1;

      await kv.hset(keys.user(address), {
        immediateClaimedCrx: payout.nextImmediateClaimedCrx,
        streamedClaimedCrx: payout.nextStreamedClaimedCrx,
        lastClaimAt: nowMs,
        claimCount: nextClaimCount,
        claimVersion: nextClaimVersion,
        updatedAt: nowMs,
      });

      const updatedUser = {
        ...user,
        immediateClaimedCrx: payout.nextImmediateClaimedCrx,
        streamedClaimedCrx: payout.nextStreamedClaimedCrx,
        lastClaimAt: nowMs,
        claimCount: nextClaimCount,
        claimVersion: nextClaimVersion,
        updatedAt: nowMs,
      };
      const claimState = getWhitelistClaimState(updatedUser, config, nowMs);

      res.status(200).json({
        ok: true,
        seasonId: config.seasonId,
        address,
        claim: {
          amountCrx: payout.claimTotalCrx,
          immediateCrx: payout.claimImmediateCrx,
          streamedCrx: payout.claimStreamedCrx,
          claimedAt: nowMs,
        },
        claimState,
        user: updatedUser,
      });
    } finally {
      await releaseKvLock(kv, lockKey, lockToken);
    }
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
