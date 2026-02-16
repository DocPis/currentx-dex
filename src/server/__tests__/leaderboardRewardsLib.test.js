import { describe, expect, it } from "vitest";
import { computeLeaderboardRewardsTable } from "../leaderboardRewardsLib.js";

const makeAddress = (seed) => `0x${seed.toString(16).padStart(40, "0")}`;

const buildEntries = (count, basePoints = 1000) =>
  Array.from({ length: count }, (_, idx) => ({
    address: makeAddress(idx + 1),
    points: Math.max(1, basePoints - idx),
    rank: idx + 1,
  }));

const buildUserRowsMap = (entries) =>
  new Map(
    entries.map((entry) => [
      entry.address,
      {
        volumeUsd: 100,
        washFlag: 0,
      },
    ])
  );

const sumRewards = (rewardsByAddress) =>
  Number(
    Array.from(rewardsByAddress.values())
      .reduce((acc, value) => acc + Number(value || 0), 0)
      .toFixed(6)
  );

describe("computeLeaderboardRewardsTable top100-only", () => {
  it("distributes rewards only to top100 when top100Only=true", () => {
    const entries = buildEntries(102, 200);
    const userRowsByAddress = buildUserRowsMap(entries.slice(0, 100));
    const result = computeLeaderboardRewardsTable({
      entries,
      userRowsByAddress,
      seasonRewardCrx: 1000,
      config: {
        top100Only: true,
        top100PoolPct: 0.5,
        top100MinVolumeUsd: 1,
        top100RequireFinalization: false,
      },
      requireTop100Finalization: false,
      nowMs: Date.now(),
    });

    expect(result.top100PoolCrx).toBe(1000);
    expect(result.baseOthersPoolCrx).toBe(0);
    expect(result.effectiveOthersPoolCrx).toBe(0);
    expect(result.top100UnassignedCrx).toBe(0);
    expect(result.rewardsByAddress.size).toBe(100);
    expect(result.rewardsByAddress.get(entries[100].address) || 0).toBe(0);
    expect(result.rewardsByAddress.get(entries[101].address) || 0).toBe(0);
    expect(sumRewards(result.rewardsByAddress)).toBeCloseTo(1000, 4);
  });

  it("recycles unassigned top100 quota back to eligible top100 wallets", () => {
    const entries = buildEntries(3, 300);
    const userRowsByAddress = buildUserRowsMap(entries);
    const result = computeLeaderboardRewardsTable({
      entries,
      userRowsByAddress,
      seasonRewardCrx: 100,
      config: {
        top100Only: true,
        top100PoolPct: 0.5,
        top100MinVolumeUsd: 1,
        top100RequireFinalization: false,
      },
      requireTop100Finalization: false,
      nowMs: Date.now(),
    });

    const reward1 = Number(result.rewardsByAddress.get(entries[0].address) || 0);
    const reward2 = Number(result.rewardsByAddress.get(entries[1].address) || 0);
    const reward3 = Number(result.rewardsByAddress.get(entries[2].address) || 0);

    expect(result.baseOthersPoolCrx).toBe(0);
    expect(result.effectiveOthersPoolCrx).toBe(0);
    expect(result.top100UnassignedCrx).toBe(0);
    expect(result.rewardsByAddress.size).toBe(3);
    expect(sumRewards(result.rewardsByAddress)).toBeCloseTo(100, 4);
    expect(reward1).toBeGreaterThan(reward2);
    expect(reward2).toBeGreaterThan(reward3);
  });

  it("allows no-swap wallets when top100MinVolumeUsd is zero", () => {
    const entries = buildEntries(2, 500);
    const userRowsByAddress = new Map(
      entries.map((entry) => [
        entry.address,
        {
          volumeUsd: 0,
          washFlag: 0,
        },
      ])
    );
    const result = computeLeaderboardRewardsTable({
      entries,
      userRowsByAddress,
      seasonRewardCrx: 100,
      config: {
        top100Only: true,
        top100PoolPct: 0.5,
        top100MinVolumeUsd: 0,
        top100RequireFinalization: false,
      },
      requireTop100Finalization: false,
      nowMs: Date.now(),
    });

    const reward1 = Number(result.rewardsByAddress.get(entries[0].address) || 0);
    const reward2 = Number(result.rewardsByAddress.get(entries[1].address) || 0);

    expect(result.rewardsByAddress.size).toBe(2);
    expect(reward1).toBeGreaterThan(0);
    expect(reward2).toBeGreaterThan(0);
    expect(reward1).toBeGreaterThan(reward2);
    expect(sumRewards(result.rewardsByAddress)).toBeCloseTo(100, 4);
  });
});
