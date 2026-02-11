import { kv } from "@vercel/kv";
import { verifyMessage } from "ethers";
import {
  buildPointsClaimMessage,
  buildPointsSummary,
  computeLeaderboardClaimPayout,
  computeLeaderboardReward,
  getLeaderboardClaimState,
  getLeaderboardRewardsConfig,
  normalizeAddress,
  parsePointsSummaryRow,
  parseRewardClaimRow,
  round6,
} from "../../src/server/leaderboardRewardsLib.js";

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

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const getKeys = (seasonId, address) => {
  const base = `points:${seasonId}`;
  const wallet = normalizeAddress(address);
  return {
    leaderboard: `${base}:leaderboard`,
    summary: `${base}:summary`,
    user: wallet ? `${base}:user:${wallet}` : null,
    rewardUser: wallet ? `${base}:reward:user:${wallet}` : null,
  };
};

const buildSummaryFromLeaderboard = async ({
  keys,
  seasonId,
  config,
  sampleUserRow,
  nowMs,
}) => {
  const rows = await kv.zrange(keys.leaderboard, 0, -1, { withScores: true });
  let walletCount = 0;
  let totalPoints = 0;
  for (let i = 0; i < rows.length; i += 2) {
    const score = Number(rows[i + 1] || 0);
    if (!Number.isFinite(score) || score <= 0) continue;
    walletCount += 1;
    totalPoints += score;
  }
  const summary = buildPointsSummary({
    seasonId,
    walletCount,
    totalPoints,
    scoringMode: sampleUserRow?.scoringMode || "",
    scoringFeeBps: sampleUserRow?.scoringFeeBps || 0,
    volumeCapUsd: sampleUserRow?.volumeCapUsd || 0,
    diminishingFactor: sampleUserRow?.diminishingFactor || 0,
    config,
    nowMs,
  });
  await kv.hset(keys.summary, summary);
  return parsePointsSummaryRow(summary);
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
  const config = getLeaderboardRewardsConfig(body?.seasonId || req.query?.seasonId);
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
        "Missing required env: set POINTS_SEASON_END (+ POINTS_FINALIZATION_WINDOW_HOURS) or POINTS_REWARDS_CLAIM_OPENS_AT",
    });
    return;
  }
  if (Math.abs(nowMs - issuedAt) > config.claimSignatureTtlMs) {
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

  const keys = getKeys(config.seasonId, address);
  const message = buildPointsClaimMessage({
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
    const [userRow, summaryRow, rewardRow] = await Promise.all([
      kv.hgetall(keys.user),
      kv.hgetall(keys.summary),
      kv.hgetall(keys.rewardUser),
    ]);
    if (!userRow || !normalizeAddress(userRow?.address || address)) {
      res.status(404).json({ error: "Wallet not found in points season" });
      return;
    }

    let summary = parsePointsSummaryRow(summaryRow);
    if (!summary) {
      summary = await buildSummaryFromLeaderboard({
        keys,
        seasonId: config.seasonId,
        config,
        sampleUserRow: userRow,
        nowMs,
      });
    }

    const userPoints = toNumber(userRow?.points, 0);
    const totalPoints = toNumber(summary?.totalPoints, 0);
    const seasonRewardCrx = toNumber(summary?.seasonRewardCrx, config.seasonRewardCrx);
    const computedReward = computeLeaderboardReward({
      userPoints,
      totalPoints,
      seasonRewardCrx,
    });

    const claimRow = parseRewardClaimRow(rewardRow);
    const rewardSnapshotCrx =
      claimRow?.totalRewardSnapshotCrx > 0
        ? claimRow.totalRewardSnapshotCrx
        : computedReward.rewardCrx;

    const payout = computeLeaderboardClaimPayout({
      totalRewardCrx: rewardSnapshotCrx,
      claimRow,
      config,
      nowMs,
    });
    if (payout.claimTotalCrx <= 0) {
      res.status(409).json({
        error: "Nothing claimable now",
        seasonId: config.seasonId,
        address,
        claimState: payout,
      });
      return;
    }

    const nextClaimCount = Number.isFinite(claimRow?.claimCount)
      ? claimRow.claimCount + 1
      : 1;

    await kv.hset(keys.rewardUser, {
      address,
      seasonId: config.seasonId,
      totalRewardSnapshotCrx: rewardSnapshotCrx,
      immediateClaimedCrx: payout.nextImmediateClaimedCrx,
      streamedClaimedCrx: payout.nextStreamedClaimedCrx,
      claimCount: nextClaimCount,
      lastClaimAt: nowMs,
      updatedAt: nowMs,
    });

    const claimState = getLeaderboardClaimState({
      totalRewardCrx: rewardSnapshotCrx,
      claimRow: {
        immediateClaimedCrx: payout.nextImmediateClaimedCrx,
        streamedClaimedCrx: payout.nextStreamedClaimedCrx,
      },
      config,
      nowMs,
    });

    res.status(200).json({
      ok: true,
      seasonId: config.seasonId,
      address,
      claim: {
        amountCrx: round6(payout.claimTotalCrx),
        immediateCrx: round6(payout.claimImmediateCrx),
        streamedCrx: round6(payout.claimStreamedCrx),
        claimedAt: nowMs,
      },
      claimState,
      rewardSnapshotCrx,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
