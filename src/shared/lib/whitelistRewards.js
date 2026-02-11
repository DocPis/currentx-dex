export const normalizeAddress = (value) =>
  value ? String(value).trim().toLowerCase() : "";

export const buildWhitelistClaimMessage = ({
  address,
  seasonId,
  issuedAt,
}) => {
  const normalizedAddress = normalizeAddress(address);
  const normalizedSeason = String(seasonId || "");
  const issued = Number(issuedAt);
  return [
    "CurrentX Whitelist Rewards Claim",
    `Season: ${normalizedSeason}`,
    `Address: ${normalizedAddress}`,
    `IssuedAt: ${issued}`,
    "Action: claim",
  ].join("\n");
};

