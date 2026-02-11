export const normalizeAddress = (value) =>
  value ? String(value).trim().toLowerCase() : "";

export const round6 = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1e6) / 1e6;
};

export const parseSeasonIndex = (seasonId) => {
  const raw = String(seasonId || "").trim();
  if (!raw) return null;
  const match = raw.match(/(\d+)/);
  if (!match) return null;
  const idx = Number(match[1]);
  if (!Number.isFinite(idx) || idx <= 0) return null;
  return Math.floor(idx);
};

export const computeProRataReward = ({
  userPoints,
  totalPoints,
  seasonRewardCrx,
}) => {
  const user = Math.max(0, Number(userPoints || 0));
  const total = Math.max(0, Number(totalPoints || 0));
  const season = Math.max(0, Number(seasonRewardCrx || 0));
  if (!user || !total || !season) {
    return { rewardCrx: 0, sharePct: 0 };
  }
  const share = user / total;
  return {
    rewardCrx: round6(season * share),
    sharePct: round6(share * 100),
  };
};

export const computeVestingState = ({
  totalRewardCrx,
  immediatePct,
  streamDays,
  claimOpensAtMs,
  streamStartAtMs,
  immediateClaimedCrx = 0,
  streamedClaimedCrx = 0,
  nowMs = Date.now(),
}) => {
  const totalReward = Math.max(0, Number(totalRewardCrx || 0));
  const immediateShare = Math.min(1, Math.max(0, Number(immediatePct || 0)));
  const days = Math.max(1, Number(streamDays || 1));
  const immediateTotalCrx = round6(totalReward * immediateShare);
  const streamedTotalCrx = round6(Math.max(0, totalReward - immediateTotalCrx));

  const claimOpensAt = Number.isFinite(Number(claimOpensAtMs))
    ? Number(claimOpensAtMs)
    : null;
  const claimOpen = Number.isFinite(claimOpensAt) ? nowMs >= claimOpensAt : false;
  const streamStart = Number.isFinite(Number(streamStartAtMs))
    ? Number(streamStartAtMs)
    : claimOpensAt;
  const streamDurationMs = Math.floor(days * 86400 * 1000);
  const streamEndsAt = Number.isFinite(streamStart)
    ? streamStart + streamDurationMs
    : null;

  const progress =
    Number.isFinite(streamStart) && streamDurationMs > 0
      ? Math.max(0, Math.min(1, (nowMs - streamStart) / streamDurationMs))
      : 0;
  const vestedStreamedCrx = round6(streamedTotalCrx * progress);

  const immediateClaimed = Math.max(0, Number(immediateClaimedCrx || 0));
  const streamedClaimed = Math.max(0, Number(streamedClaimedCrx || 0));
  const immediateRemainingCrx = round6(Math.max(0, immediateTotalCrx - immediateClaimed));
  const streamedRemainingCrx = round6(Math.max(0, vestedStreamedCrx - streamedClaimed));
  const claimableNowCrx = claimOpen
    ? round6(immediateRemainingCrx + streamedRemainingCrx)
    : 0;

  return {
    totalRewardCrx: round6(totalReward),
    immediatePct: round6(immediateShare),
    streamDays: Math.max(1, Math.floor(days)),
    claimOpen,
    claimOpensAt,
    streamStartAt: streamStart,
    streamEndsAt,
    streamDurationMs,
    streamProgress: round6(progress),
    immediateTotalCrx,
    streamedTotalCrx,
    vestedStreamedCrx,
    immediateClaimedCrx: round6(immediateClaimed),
    streamedClaimedCrx: round6(streamedClaimed),
    immediateRemainingCrx,
    streamedRemainingCrx,
    claimableNowCrx,
    totalClaimedCrx: round6(immediateClaimed + streamedClaimed),
  };
};

export const buildPointsClaimMessage = ({
  address,
  seasonId,
  issuedAt,
}) => {
  const normalizedAddress = normalizeAddress(address);
  const normalizedSeason = String(seasonId || "");
  const issued = Number(issuedAt);
  return [
    "CurrentX Leaderboard Rewards Claim",
    `Season: ${normalizedSeason}`,
    `Address: ${normalizedAddress}`,
    `IssuedAt: ${issued}`,
    "Action: claim",
  ].join("\n");
};
