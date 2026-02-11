import { kv } from "@vercel/kv";
import {
  getWhitelistKeys,
  getWhitelistRewardsConfig,
  parseStoredSummaryRow,
} from "../../src/server/whitelistRewardsLib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
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

  try {
    const row = await kv.hgetall(keys.summary);
    const summary = parseStoredSummaryRow(row);
    const updatedAt = await kv.get(keys.updatedAt);
    if (!summary) {
      res.status(200).json({
        seasonId: config.seasonId,
        summary: {
          seasonId: config.seasonId,
          walletCount: 0,
          activatedCount: 0,
          budgetCapCrx: config.budgetCapCrx,
          baseAllocatedCrx: 0,
          bonusAllocatedCrx: 0,
          totalAllocatedCrx: 0,
          totalImmediateCrx: 0,
          totalStreamedCrx: 0,
          immediatePct: config.immediatePct,
          streamDays: config.streamDays,
          claimOpensAt: config.claimOpensAtMs,
          claimOpen: Number.isFinite(config.claimOpensAtMs)
            ? Date.now() >= config.claimOpensAtMs
            : false,
          updatedAt: updatedAt ? Number(updatedAt) : null,
        },
      });
      return;
    }
    res.status(200).json({
      seasonId: config.seasonId,
      summary: {
        ...summary,
        budgetCapCrx: config.budgetCapCrx,
        claimOpensAt: config.claimOpensAtMs,
        claimOpen: Number.isFinite(config.claimOpensAtMs)
          ? Date.now() >= config.claimOpensAtMs
          : false,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
