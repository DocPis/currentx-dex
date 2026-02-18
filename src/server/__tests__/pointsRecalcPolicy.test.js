import { describe, expect, it } from "vitest";
import {
  getLpPriorityTimeoutMs,
  resolveLpRecalcPolicy,
} from "../pointsRecalcPolicy.js";

describe("resolveLpRecalcPolicy", () => {
  it("refreshes top-ranked wallets in fast mode even without lpCandidate", () => {
    const policy = resolveLpRecalcPolicy({
      row: { rank: 16, lpCandidate: "", lpUsd: 0, lpUsdCrxEth: 0, lpUsdCrxUsdm: 0 },
      fastMode: true,
      priorityRankLimit: 100,
    });

    expect(policy.isPriorityRank).toBe(true);
    expect(policy.lpCandidate).toBe(false);
    expect(policy.shouldRefreshLp).toBe(true);
    expect(policy.allowOnchain).toBe(true);
  });

  it("does not refresh non-priority non-candidate wallets in fast mode", () => {
    const policy = resolveLpRecalcPolicy({
      row: { rank: 190, lpCandidate: "", lpUsd: 0, lpUsdCrxEth: 0, lpUsdCrxUsdm: 0 },
      fastMode: true,
      priorityRankLimit: 100,
    });

    expect(policy.isPriorityRank).toBe(false);
    expect(policy.lpCandidate).toBe(false);
    expect(policy.shouldRefreshLp).toBe(false);
    expect(policy.allowOnchain).toBe(false);
  });

  it("treats stored non-boost LP as lpCandidate for future refreshes", () => {
    const policy = resolveLpRecalcPolicy({
      row: { rank: 210, lpCandidate: "", lpUsd: 1888.33, lpUsdCrxEth: 0, lpUsdCrxUsdm: 0 },
      fastMode: true,
      priorityRankLimit: 100,
    });

    expect(policy.lpCandidate).toBe(true);
    expect(policy.shouldRefreshLp).toBe(true);
    expect(policy.allowOnchain).toBe(true);
  });
});

describe("getLpPriorityTimeoutMs", () => {
  it("raises timeout for priority wallets but respects max", () => {
    expect(getLpPriorityTimeoutMs(10_000, 60_000)).toBe(20_000);
    expect(getLpPriorityTimeoutMs(50_000, 60_000)).toBe(50_000);
  });
});
