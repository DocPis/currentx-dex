import { describe, expect, it } from "vitest";
import { applyMaxBuffer, computeV3QuickFillAmount } from "../v3QuickFillUtils";

describe("v3QuickFillUtils", () => {
  it("applies a small safety buffer when pct is 100%", () => {
    const balance = 233.897625123;
    const next = computeV3QuickFillAmount(balance, 1, 18);
    const nextNum = Number(next);

    expect(Number.isFinite(nextNum)).toBe(true);
    expect(nextNum).toBeLessThan(balance);
    expect(next).toBe("233.897624");
  });

  it("does not apply buffer when pct is below 100%", () => {
    const balance = 233.897625;
    const next = computeV3QuickFillAmount(balance, 0.5, 18);

    expect(next).toBe("116.948813");
  });

  it("never returns a negative buffered value", () => {
    expect(applyMaxBuffer(0, 18)).toBe(0);
    expect(applyMaxBuffer(0.0000001, 18)).toBeGreaterThanOrEqual(0);
  });
});
