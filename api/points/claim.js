import { kv } from "@vercel/kv";
import { verifyMessage } from "ethers";
import { acquireKvLock, releaseKvLock } from "../../src/server/kvLock.js";
import {
  buildPointsClaimMessage,
  buildPointsSummary,
  computeLeaderboardClaimPayout,
  computeLeaderboardRewardsTable,
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

const parseAddressList = (...values) =>
  values
    .flatMap((value) => String(value || "").split(/[\s,;]+/))
    .map((value) => String(value || "").trim())
    .map((value) => value.replace(/^['"()[\]]+|['"()[\]]+$/g, ""))
    .map((value) => {
      const match = value.match(/0x[a-fA-F0-9]{40}/);
      return match ? match[0] : value;
    })
    .map((value) => normalizeAddress(value))
    .filter((value) => /^0x[a-f0-9]{40}$/.test(value))
    .filter(Boolean);

const getExcludedAddresses = () =>
  new Set(
    parseAddressList(
      process.env.POINTS_LEADERBOARD_EXCLUDED_ADDRESSES,
      process.env.POINTS_LEADERBOARD_EXCLUDED_ADDRESS,
      process.env.POINTS_EXCLUDED_ADDRESSES,
      process.env.POINTS_EXCLUDED_ADDRESS,
      process.env.VITE_POINTS_EXCLUDED_ADDRESSES
    )
  );

const computeTotalsFromEntries = (entries, excludedAddresses = new Set()) => {
  let walletCount = 0;
  let totalPoints = 0;
  for (let i = 0; i < entries.length; i += 2) {
    const address = normalizeAddress(entries[i]);
    const score = Number(entries[i + 1] || 0);
    if (!address || excludedAddresses.has(address)) continue;
    if (!Number.isFinite(score) || score <= 0) continue;
    walletCount += 1;
    totalPoints += score;
  }
  return { walletCount, totalPoints };
};

const getKeys = (seasonId, address) => {
  const base = `points:${seasonId}`;
  const wallet = normalizeAddress(address);
  return {
    leaderboard: `${base}:leaderboard`,
    summary: `${base}:summary`,
    user: wallet ? `${base}:user:${wallet}` : null,
    userByAddress: (candidate) =>
      `${base}:user:${normalizeAddress(candidate)}`,
    rewardUser: wallet ? `${base}:reward:user:${wallet}` : null,
  };
};

const buildSummaryFromLeaderboard = async ({
  keys,
  seasonId,
  config,
  sampleUserRow,
  nowMs,
  rows,
  excludedAddresses,
}) => {
  const entries = rows || (await kv.zrange(keys.leaderboard, 0, -1, { withScores: true }));
  const { walletCount, totalPoints } = computeTotalsFromEntries(entries, excludedAddresses);
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
  const excludedAddresses = getExcludedAddresses();
  if (excludedAddresses.has(address)) {
    res.status(403).json({ error: "Address excluded from leaderboard" });
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
    const lockKey = `points:${config.seasonId}:claim:lock:${address}`;
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
    const [userRow, summaryRow, rewardRow] = await Promise.all([
      kv.hgetall(keys.user),
      kv.hgetall(keys.summary),
      kv.hgetall(keys.rewardUser),
    ]);
    if (!userRow || !normalizeAddress(userRow?.address || address)) {
      res.status(404).json({ error: "Wallet not found in points season" });
      return;
    }

    const leaderboardEntries = await kv.zrange(keys.leaderboard, 0, -1, {
      rev: true,
      withScores: true,
    });

    let summary = parsePointsSummaryRow(summaryRow);
    if (!summary) {
      summary = await buildSummaryFromLeaderboard({
        keys,
        seasonId: config.seasonId,
        config,
        sampleUserRow: userRow,
        nowMs,
        rows: leaderboardEntries,
        excludedAddresses,
      });
    }

    const summarySeasonRewardCrx = toNumber(summary?.seasonRewardCrx, NaN);
    const configuredSeasonRewardCrx = toNumber(config?.seasonRewardCrx, 0);
    const seasonRewardCrx =
      Number.isFinite(summarySeasonRewardCrx) && summarySeasonRewardCrx > 0
        ? summarySeasonRewardCrx
        : configuredSeasonRewardCrx;
    const rankedEntries = [];
    for (let i = 0; i < leaderboardEntries.length; i += 2) {
      const wallet = normalizeAddress(leaderboardEntries[i]);
      const points = Number(leaderboardEntries[i + 1] || 0);
      if (!wallet || excludedAddresses.has(wallet)) continue;
      if (!Number.isFinite(points) || points <= 0) continue;
      rankedEntries.push({
        address: wallet,
        points,
        rank: rankedEntries.length + 1,
      });
    }
    const top100Addresses = rankedEntries.slice(0, 100).map((entry) => entry.address);
    const top100Rows = top100Addresses.length
      ? await (() => {
          const pipeline = kv.pipeline();
          top100Addresses.forEach((wallet) =>
            pipeline.hgetall(keys.userByAddress(wallet))
          );
          return pipeline.exec();
        })()
      : [];
    const userRowsByAddress = new Map(
      top100Addresses.map((wallet, idx) => [wallet, top100Rows?.[idx] || null])
    );
    const rewardsTable = computeLeaderboardRewardsTable({
      entries: rankedEntries,
      userRowsByAddress,
      seasonRewardCrx,
      config,
      nowMs,
      requireTop100Finalization: true,
    });
    const computedRewardCrx = toNumber(rewardsTable?.rewardsByAddress?.get(address), 0);
    const computedReward = {
      rewardCrx: computedRewardCrx,
      sharePct: seasonRewardCrx > 0
        ? round6((computedRewardCrx / seasonRewardCrx) * 100)
        : 0,
    };

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
    const nextClaimVersion = Math.max(
      0,
      Math.floor(toNumber(rewardRow?.claimVersion, claimRow?.claimCount || 0))
    ) + 1;

    await kv.hset(keys.rewardUser, {
      address,
      seasonId: config.seasonId,
      totalRewardSnapshotCrx: rewardSnapshotCrx,
      immediateClaimedCrx: payout.nextImmediateClaimedCrx,
      streamedClaimedCrx: payout.nextStreamedClaimedCrx,
      claimCount: nextClaimCount,
      claimVersion: nextClaimVersion,
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
    } finally {
      await releaseKvLock(kv, lockKey, lockToken);
    }
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
