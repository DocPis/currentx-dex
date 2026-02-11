import { kv } from "@vercel/kv";
import {
  evaluateWallet,
  getWhitelistClaimState,
  getPresaleKey,
  getWhitelistKeys,
  getWhitelistRewardsConfig,
  normalizeAddress,
  parseStoredRewardRow,
} from "../../src/server/whitelistRewardsLib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const address = normalizeAddress(req.query?.address || "");
  if (!address) {
    res.status(400).json({ error: "Missing address" });
    return;
  }

  const config = getWhitelistRewardsConfig(req.query?.seasonId);
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
  const keys = getWhitelistKeys(config.seasonId);
  const nowMs = Date.now();

  try {
    const stored = await kv.hgetall(keys.user(address));
    const parsed = parseStoredRewardRow(stored);
    if (parsed && parsed.address) {
      const claimState = getWhitelistClaimState(parsed, config, nowMs);
      res.status(200).json({
        seasonId: config.seasonId,
        user: {
          ...parsed,
          ...claimState,
        },
      });
      return;
    }

    const presaleRow = await kv.get(getPresaleKey(address));
    if (!presaleRow) {
      res.status(404).json({ error: "Wallet not whitelisted" });
      return;
    }

    const pointsRow = await kv.hgetall(keys.pointsUser(address));
    const preview = evaluateWallet({
      wallet: address,
      presaleRow,
      pointsRow,
      existingRewardRow: null,
      config,
      nowMs,
    });

    const totalPreview = preview.baseRewardRaw + preview.bonusRewardRaw;
    const immediatePreview = totalPreview * config.immediatePct;
    const streamedPreview = Math.max(0, totalPreview - immediatePreview);

    const previewUser = {
      address,
      seasonId: config.seasonId,
      whitelisted: true,
      whitelistedAt: preview.whitelistedAt,
      activationWindowDays: config.activationWindowDays,
      windowEndsAt: preview.windowEndsAt,
      withinWindow: preview.withinWindow,
      activationQualified: preview.activationQualified,
      activatedAt: preview.activatedAt,
      hasSwap: preview.hasSwap,
      metVolumeThreshold: preview.metVolumeThreshold,
      metMicroLp: preview.metMicroLp,
      volumeUsd: preview.volumeUsd,
      lpUsd: preview.lpUsd,
      volumeThresholdUsd: config.volumeThresholdUsd,
      microLpUsd: config.microLpUsd,
      baseRewardCrx: preview.baseRewardRaw,
      activationBonusCrx: preview.bonusRewardRaw,
      totalRewardCrx: totalPreview,
      immediateClaimableCrx: immediatePreview,
      streamedCrx: streamedPreview,
      immediatePct: config.immediatePct,
      streamDays: config.streamDays,
      streamStartAt: preview.activatedAt || preview.whitelistedAt,
      immediateClaimedCrx: 0,
      streamedClaimedCrx: 0,
      lastClaimAt: null,
      claimCount: 0,
      budgetBaseScale: 1,
      budgetBonusScale: 1,
      pending: true,
      updatedAt: nowMs,
    };
    const claimState = getWhitelistClaimState(previewUser, config, nowMs);

    res.status(200).json({
      seasonId: config.seasonId,
      user: {
        ...previewUser,
        ...claimState,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
