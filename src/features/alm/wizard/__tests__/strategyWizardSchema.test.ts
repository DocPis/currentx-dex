import { describe, expect, it } from "vitest";
import {
  applyWizardPreset,
  computeRangePreview,
  makeDefaultWizardValues,
  toWizardSubmitPayload,
  validateWizardSync,
} from "../strategyWizardSchema";

const STRATEGY_SEED = {
  id: 1,
  widthBps: 100,
  recenterBps: 60,
  minRebalanceInterval: 3600,
  maxSwapSlippageBps: 50,
  mintSlippageBps: 50,
  allowSwap: true,
  route: "DIRECT_OR_WETH" as const,
  minCardinality: 0,
  oracleParamsHex: "0x01",
  wethHopFee: 3000,
  targetRatioBps0: 5000,
  minCompoundValueToken1: 2000000n,
  ratioDeadbandBps: 25,
  minSwapValueToken1: 1000000n,
  allowedFeeTiers: [500, 3000],
};

const NFT_SEED = {
  token0: "0x4200000000000000000000000000000000000006",
  token1: "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
  token0Symbol: "WETH",
  token1Symbol: "USDM",
  token1Decimals: 6,
  fee: 500,
};

describe("strategyWizardSchema", () => {
  it("creates valid defaults from strategy+nft", () => {
    const values = makeDefaultWizardValues(STRATEGY_SEED, NFT_SEED);
    const result = validateWizardSync(values);

    expect(result.errors).toHaveLength(0);
    expect(values.lpFeeTier).toBe(500);
    expect(values.strategyId).toBe(1);
  });

  it("flags invalid range and missing cross-dex fields", () => {
    const values = makeDefaultWizardValues(STRATEGY_SEED, NFT_SEED);
    values.rangeUpPct = "0";
    values.useExternalDex = true;
    values.routerAddress = "";
    values.quoterAddress = "";
    values.factoryAddress = "";

    const result = validateWizardSync(values);
    const codes = result.errors.map((entry) => entry.code);

    expect(codes).toContain("alm.range.invalid");
    expect(codes).toContain("alm.crossdex.router_required");
    expect(codes).toContain("alm.crossdex.quoter_required");
    expect(codes).toContain("alm.crossdex.factory_required");
  });

  it("applies aggressive preset and updates risk parameters", () => {
    const values = makeDefaultWizardValues(STRATEGY_SEED, NFT_SEED);
    const next = applyWizardPreset(values, "aggressive");

    expect(next.maxSwapInPct).toBe(50);
    expect(next.minRebalanceIntervalSec).toBe(1800);
    expect(next.oracleEnabled).toBe(true);
  });

  it("computes range preview and payload encoding", () => {
    const values = makeDefaultWizardValues(STRATEGY_SEED, NFT_SEED);
    values.rangeUpPct = "1.5";
    values.rangeDownPct = "0.5";
    values.maxSwapInPct = 25;
    const preview = computeRangePreview(values);
    const payload = toWizardSubmitPayload(values, STRATEGY_SEED);

    expect(preview.upBps).toBe(150);
    expect(preview.downBps).toBe(50);
    expect(payload.widthBps).toBe(100);
    expect(payload.maxSwapInBps).toBe(2500);
  });
});

