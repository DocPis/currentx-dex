import { kv } from "@vercel/kv";
import {
  applyBudgetCap,
  authorizeRequest,
  buildSummary,
  evaluateWallet,
  getPresaleKey,
  getWhitelistKeys,
  getWhitelistRewardsConfig,
  scanWhitelistWallets,
} from "../../src/server/whitelistRewardsLib.js";

export default async function handler(req, res) {
  const secret =
    process.env.WHITELIST_REWARDS_TOKEN || process.env.POINTS_INGEST_TOKEN || "";
  if (!authorizeRequest(req, secret)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const config = getWhitelistRewardsConfig(req.query?.seasonId);
  const keys = getWhitelistKeys(config.seasonId);
  const nowMs = Date.now();

  try {
    const wallets = await scanWhitelistWallets(kv);
    if (!wallets.length) {
      const summary = buildSummary([], config, nowMs);
      const writePipeline = kv.pipeline();
      writePipeline.del(keys.leaderboard);
      writePipeline.hset(keys.summary, summary);
      writePipeline.set(keys.updatedAt, nowMs);
      await writePipeline.exec();
      res.status(200).json({
        ok: true,
        seasonId: config.seasonId,
        processed: 0,
        walletCount: 0,
        activatedCount: 0,
        totalAllocatedCrx: 0,
        budgetCapCrx: config.budgetCapCrx,
        updatedAt: nowMs,
      });
      return;
    }

    const readPipeline = kv.pipeline();
    wallets.forEach((wallet) => {
      readPipeline.get(getPresaleKey(wallet));
      readPipeline.hgetall(keys.user(wallet));
      readPipeline.hgetall(keys.pointsUser(wallet));
    });
    const readRows = await readPipeline.exec();

    const evaluated = wallets.map((wallet, idx) => {
      const offset = idx * 3;
      const presaleRow = readRows?.[offset] || null;
      const existingRewardRow = readRows?.[offset + 1] || null;
      const pointsRow = readRows?.[offset + 2] || null;
      return evaluateWallet({
        wallet,
        presaleRow,
        pointsRow,
        existingRewardRow,
        config,
        nowMs,
      });
    });

    const capped = applyBudgetCap(evaluated, config);
    const summary = buildSummary(capped, config, nowMs);

    const writePipeline = kv.pipeline();
    writePipeline.del(keys.leaderboard);
    capped.forEach((row) => {
      writePipeline.zadd(keys.leaderboard, {
        score: row.totalRewardCrx,
        member: row.wallet,
      });
      writePipeline.hset(keys.user(row.wallet), {
        address: row.wallet,
        seasonId: config.seasonId,
        whitelisted: 1,
        whitelistedAt: row.whitelistedAt,
        activationWindowDays: config.activationWindowDays,
        windowEndsAt: row.windowEndsAt,
        withinWindow: row.withinWindow ? 1 : 0,
        activationQualified: row.activationQualified ? 1 : 0,
        activatedAt: row.activatedAt ?? "",
        hasSwap: row.hasSwap ? 1 : 0,
        metVolumeThreshold: row.metVolumeThreshold ? 1 : 0,
        metMicroLp: row.metMicroLp ? 1 : 0,
        volumeUsd: row.volumeUsd,
        lpUsd: row.lpUsd,
        volumeThresholdUsd: config.volumeThresholdUsd,
        microLpUsd: config.microLpUsd,
        baseRewardCrx: row.baseRewardCrx,
        activationBonusCrx: row.activationBonusCrx,
        totalRewardCrx: row.totalRewardCrx,
        immediateClaimableCrx: row.immediateClaimableCrx,
        streamedCrx: row.streamedCrx,
        immediatePct: config.immediatePct,
        streamDays: config.streamDays,
        streamStartAt: row.streamStartAt,
        immediateClaimedCrx: row.existingImmediateClaimedCrx || 0,
        streamedClaimedCrx: row.existingStreamedClaimedCrx || 0,
        lastClaimAt: row.existingLastClaimAt ?? "",
        claimCount: row.existingClaimCount || 0,
        budgetBaseScale: row.baseScale,
        budgetBonusScale: row.bonusScale,
        pending: 0,
        updatedAt: nowMs,
      });
    });
    writePipeline.hset(keys.summary, summary);
    writePipeline.set(keys.updatedAt, nowMs);
    await writePipeline.exec();

    res.status(200).json({
      ok: true,
      seasonId: config.seasonId,
      processed: wallets.length,
      walletCount: summary.walletCount,
      activatedCount: summary.activatedCount,
      totalAllocatedCrx: summary.totalAllocatedCrx,
      budgetCapCrx: summary.budgetCapCrx,
      updatedAt: nowMs,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
