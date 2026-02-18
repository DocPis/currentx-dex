import { describe, expect, it } from "vitest";
import {
  shouldRunPeriodicTask,
  summarizeLpFallback,
} from "../pointsJobsGuardrails.js";

describe("shouldRunPeriodicTask", () => {
  it("runs when enabled and no prior run", () => {
    const shouldRun = shouldRunPeriodicTask({
      enabled: true,
      nowMs: 1_000_000,
      lastRunAtMs: 0,
      intervalMs: 60_000,
    });
    expect(shouldRun).toBe(true);
  });

  it("skips when interval has not elapsed", () => {
    const shouldRun = shouldRunPeriodicTask({
      enabled: true,
      nowMs: 1_000_000,
      lastRunAtMs: 980_000,
      intervalMs: 60_000,
    });
    expect(shouldRun).toBe(false);
  });

  it("runs once interval elapsed", () => {
    const shouldRun = shouldRunPeriodicTask({
      enabled: true,
      nowMs: 1_040_000,
      lastRunAtMs: 980_000,
      intervalMs: 60_000,
    });
    expect(shouldRun).toBe(true);
  });
});

describe("summarizeLpFallback", () => {
  it("emits warning when fallback ratio crosses threshold", () => {
    const summary = summarizeLpFallback({
      processed: 20,
      fallbackCount: 9,
      warnRatio: 0.4,
      minProcessed: 10,
    });

    expect(summary.fallbackRate).toBeCloseTo(0.45, 6);
    expect(summary.warning).toBe(true);
  });

  it("does not warn below minimum processed count", () => {
    const summary = summarizeLpFallback({
      processed: 6,
      fallbackCount: 5,
      warnRatio: 0.4,
      minProcessed: 10,
    });

    expect(summary.fallbackRate).toBeCloseTo(5 / 6, 6);
    expect(summary.warning).toBe(false);
  });

  it("bounds invalid inputs to safe defaults", () => {
    const summary = summarizeLpFallback({
      processed: "abc",
      fallbackCount: 999,
      warnRatio: 2,
      minProcessed: -10,
    });

    expect(summary.processed).toBe(0);
    expect(summary.fallbackCount).toBe(999);
    expect(summary.fallbackRate).toBe(1);
    expect(summary.warning).toBe(false);
    expect(summary.warnRatio).toBe(1);
    expect(summary.minProcessed).toBe(1);
  });
});
