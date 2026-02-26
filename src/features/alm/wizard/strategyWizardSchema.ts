import { Contract, formatUnits, getAddress, parseUnits } from "ethers";

export const ALM_ALLOWED_FEES = [100, 500, 3000, 10000] as const;
export const MAX_SWAP_IN_PRESETS = [10, 25, 50] as const;

export type WizardPresetId = "safe" | "balanced" | "aggressive";
export type WizardMode = "basic" | "advanced";
export type OraclePresetId = "safe" | "balanced" | "aggressive" | "custom";
export type WizardIssueLevel = "error" | "warning";

export interface WizardIssue {
  code: string;
  message: string;
  level: WizardIssueLevel;
}

export interface WizardStrategySeed {
  id: number;
  widthBps: number;
  recenterBps: number;
  minRebalanceInterval: number;
  maxSwapSlippageBps: number;
  mintSlippageBps: number;
  allowSwap: boolean;
  route: "DIRECT_ONLY" | "DIRECT_OR_WETH";
  minCardinality: number;
  oracleParamsHex: string;
  wethHopFee: number;
  targetRatioBps0: number;
  minCompoundValueToken1: bigint;
  ratioDeadbandBps: number;
  minSwapValueToken1: bigint;
  allowedFeeTiers: number[];
}

export interface WizardNftSeed {
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  token1Decimals: number;
  fee: number;
}

export interface WizardFormValues {
  strategyId: number;
  mode: WizardMode;
  pairSource: "selected_nft" | "custom";
  token0Address: string;
  token1Address: string;
  token0Symbol: string;
  token1Symbol: string;
  token1Decimals: number;
  lpFeeTier: number;
  rangeUpPct: string;
  rangeDownPct: string;
  targetPct0: string;
  recenterTriggerPct: string;
  minRebalanceIntervalSec: number;
  maxSwapSlippagePct: string;
  mintSlippagePct: string;
  ratioDeadbandPct: string;
  maxSwapInPct: number;
  useExternalDex: boolean;
  routerAddress: string;
  quoterAddress: string;
  factoryAddress: string;
  swapFeeOverride: number;
  oracleEnabled: boolean;
  oraclePreset: OraclePresetId;
  oracleParamsHex: string;
  minCompoundInput: string;
  minSwapInput: string;
}

export interface WizardSubmitPayload {
  strategyId: number;
  widthBps: number;
  recenterBps: number;
  minRebalanceInterval: number;
  maxSwapSlippageBps: number;
  mintSlippageBps: number;
  ratioDeadbandBps: number;
  targetRatioBps0: number;
  minCompoundInput: string;
  minSwapInput: string;
  token1Decimals: number;
  allowSwap: boolean;
  routeCode: number;
  minCardinality: number;
  lpFeeTier: number;
  oracleParamsHex: string;
  wethHopFee: number;
  maxSwapInBps: number;
  useExternalDex: boolean;
  routerAddress: string;
  quoterAddress: string;
  factoryAddress: string;
  swapFeeOverride: number;
  token0Address: string;
  token1Address: string;
}

export const ORACLE_PRESET_META: Record<
  Exclude<OraclePresetId, "custom">,
  { label: string; description: string; fallbackHex: string }
> = {
  safe: {
    label: "Safe",
    description: "Reduces sensitivity to spikes and prioritizes stability.",
    fallbackHex: "0x01",
  },
  balanced: {
    label: "Balanced",
    description: "Balances responsiveness with noise protection.",
    fallbackHex: "0x02",
  },
  aggressive: {
    label: "Aggressive",
    description: "More reactive to movement, with higher activity frequency.",
    fallbackHex: "0x03",
  },
};

const FACTORY_GETTER_ABI = [
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const V3_FACTORY_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const toNumeric = (value: string | number) => {
  const text = typeof value === "number" ? String(value) : String(value || "").trim().replace(",", ".");
  if (!text) return Number.NaN;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const toBpsFromPct = (value: string | number) => Math.round(toNumeric(value) * 100);

const sanitizeAddress = (value: string) => {
  try {
    return getAddress(String(value || "").trim());
  } catch {
    return String(value || "").trim();
  }
};

const isAddress = (value: string) => {
  try {
    getAddress(String(value || "").trim());
    return true;
  } catch {
    return false;
  }
};

const isHex = (value: string) => /^0x[0-9a-fA-F]*$/u.test(String(value || ""));

const isZeroAddress = (value: string) =>
  sanitizeAddress(value).toLowerCase() === ZERO_ADDRESS.toLowerCase();

const asPercentString = (bps: number, digits = 2) =>
  (Math.max(0, Number(bps || 0)) / 100).toFixed(digits).replace(/\.?0+$/u, "");

export const makeDefaultWizardValues = (
  strategy: WizardStrategySeed | null,
  nft: WizardNftSeed | null
): WizardFormValues => {
  const lpFeeTier = nft?.fee || strategy?.allowedFeeTiers?.[0] || 500;
  const oracleParams = strategy?.oracleParamsHex && strategy.oracleParamsHex !== "0x" ? strategy.oracleParamsHex : "0x";
  return {
    strategyId: strategy?.id || 0,
    mode: "basic",
    pairSource: nft ? "selected_nft" : "custom",
    token0Address: nft?.token0 || "",
    token1Address: nft?.token1 || "",
    token0Symbol: nft?.token0Symbol || "token0",
    token1Symbol: nft?.token1Symbol || "token1",
    token1Decimals: nft?.token1Decimals || 18,
    lpFeeTier,
    rangeUpPct: asPercentString(strategy?.widthBps || 100, 2) || "1",
    rangeDownPct: asPercentString(strategy?.widthBps || 100, 2) || "1",
    targetPct0: asPercentString(strategy?.targetRatioBps0 || 5000, 2),
    recenterTriggerPct: asPercentString(strategy?.recenterBps || 50, 2),
    minRebalanceIntervalSec: Math.max(30, Number(strategy?.minRebalanceInterval || 3600)),
    maxSwapSlippagePct: asPercentString(strategy?.maxSwapSlippageBps || 50, 2),
    mintSlippagePct: asPercentString(strategy?.mintSlippageBps || 50, 2),
    ratioDeadbandPct: asPercentString(strategy?.ratioDeadbandBps || 25, 2),
    maxSwapInPct: 25,
    useExternalDex: false,
    routerAddress: "",
    quoterAddress: "",
    factoryAddress: "",
    swapFeeOverride: ALM_ALLOWED_FEES.includes(Number(strategy?.wethHopFee || 0) as any)
      ? Number(strategy?.wethHopFee || 3000)
      : 3000,
    oracleEnabled: oracleParams !== "0x",
    oraclePreset: "custom",
    oracleParamsHex: oracleParams,
    minCompoundInput: strategy ? formatUnits(strategy.minCompoundValueToken1, nft?.token1Decimals || 18) : "2",
    minSwapInput: strategy ? formatUnits(strategy.minSwapValueToken1, nft?.token1Decimals || 18) : "2",
  };
};

export const applyWizardPreset = (
  values: WizardFormValues,
  preset: WizardPresetId
): WizardFormValues => {
  if (preset === "safe") {
    return {
      ...values,
      rangeUpPct: "0.8",
      rangeDownPct: "0.8",
      recenterTriggerPct: "0.4",
      minRebalanceIntervalSec: 4 * 3600,
      maxSwapSlippagePct: "0.30",
      mintSlippagePct: "0.30",
      ratioDeadbandPct: "0.25",
      maxSwapInPct: 10,
      oracleEnabled: true,
      oraclePreset: "safe",
      oracleParamsHex:
        values.oracleParamsHex && values.oracleParamsHex !== "0x"
          ? values.oracleParamsHex
          : ORACLE_PRESET_META.safe.fallbackHex,
    };
  }
  if (preset === "aggressive") {
    return {
      ...values,
      rangeUpPct: "2.0",
      rangeDownPct: "2.0",
      recenterTriggerPct: "1.0",
      minRebalanceIntervalSec: 30 * 60,
      maxSwapSlippagePct: "1.00",
      mintSlippagePct: "1.00",
      ratioDeadbandPct: "0.10",
      maxSwapInPct: 50,
      oracleEnabled: true,
      oraclePreset: "aggressive",
      oracleParamsHex:
        values.oracleParamsHex && values.oracleParamsHex !== "0x"
          ? values.oracleParamsHex
          : ORACLE_PRESET_META.aggressive.fallbackHex,
    };
  }
  return {
    ...values,
    rangeUpPct: "1.2",
    rangeDownPct: "1.2",
    recenterTriggerPct: "0.6",
    minRebalanceIntervalSec: 90 * 60,
    maxSwapSlippagePct: "0.50",
    mintSlippagePct: "0.50",
    ratioDeadbandPct: "0.20",
    maxSwapInPct: 25,
    oracleEnabled: true,
    oraclePreset: "balanced",
    oracleParamsHex:
      values.oracleParamsHex && values.oracleParamsHex !== "0x"
        ? values.oracleParamsHex
        : ORACLE_PRESET_META.balanced.fallbackHex,
  };
};

export const computeRangePreview = (values: WizardFormValues) => {
  const upPct = toNumeric(values.rangeUpPct);
  const downPct = toNumeric(values.rangeDownPct);
  const upBps = Number.isFinite(upPct) ? Math.round(upPct * 100) : 0;
  const downBps = Number.isFinite(downPct) ? Math.round(downPct * 100) : 0;
  const encodedWidthBps = Math.max(1, Math.round((Math.max(0, upBps) + Math.max(0, downBps)) / 2));
  return {
    upBps,
    downBps,
    encodedWidthBps,
    isAsymmetric: upBps !== downBps,
  };
};

export const validateWizardSync = (values: WizardFormValues) => {
  const issues: WizardIssue[] = [];
  const addError = (code: string, message: string) => issues.push({ code, message, level: "error" });
  const addWarning = (code: string, message: string) => issues.push({ code, message, level: "warning" });

  if (!Number.isFinite(values.strategyId) || values.strategyId <= 0) {
    addError("alm.strategy.required", "Select a valid strategy before saving.");
  }

  if (!ALM_ALLOWED_FEES.includes(values.lpFeeTier as any)) {
    addError("alm.fee.invalid", "Invalid LP fee tier. Use 100 / 500 / 3000 / 10000.");
  }
  if (!ALM_ALLOWED_FEES.includes(values.swapFeeOverride as any)) {
    addError("alm.swap_fee.invalid", "Invalid swap fee override. Use 100 / 500 / 3000 / 10000.");
  }

  const rangeUp = toNumeric(values.rangeUpPct);
  const rangeDown = toNumeric(values.rangeDownPct);
  if (!Number.isFinite(rangeUp) || rangeUp <= 0 || !Number.isFinite(rangeDown) || rangeDown <= 0) {
    addError("alm.range.invalid", "Range up/down must be greater than 0.");
  }
  const rangePreview = computeRangePreview(values);
  if (rangePreview.isAsymmetric) {
    addWarning(
      "alm.range.asymmetric",
      "Asymmetric range: contract stores one width in bps (average of up/down)."
    );
  }

  const targetPct0 = toNumeric(values.targetPct0);
  if (!Number.isFinite(targetPct0) || targetPct0 < 0 || targetPct0 > 100) {
    addError("alm.target.invalid", "Target token0 must be between 0% and 100%.");
  }

  const recenterPct = toNumeric(values.recenterTriggerPct);
  if (!Number.isFinite(recenterPct) || recenterPct <= 0) {
    addError("alm.recenter.invalid", "Recenter trigger must be > 0.");
  }

  const maxSwapSlippagePct = toNumeric(values.maxSwapSlippagePct);
  if (!Number.isFinite(maxSwapSlippagePct) || maxSwapSlippagePct <= 0 || maxSwapSlippagePct > 10) {
    addError("alm.swap_slippage.invalid", "Swap slippage must be between 0 and 10%.");
  }

  const mintSlippagePct = toNumeric(values.mintSlippagePct);
  if (!Number.isFinite(mintSlippagePct) || mintSlippagePct <= 0 || mintSlippagePct > 10) {
    addError("alm.mint_slippage.invalid", "Mint slippage must be between 0 and 10%.");
  }

  const deadbandPct = toNumeric(values.ratioDeadbandPct);
  if (!Number.isFinite(deadbandPct) || deadbandPct < 0 || deadbandPct > 10) {
    addError("alm.deadband.invalid", "Ratio deadband must be between 0 and 10%.");
  }

  if (!Number.isFinite(values.minRebalanceIntervalSec) || values.minRebalanceIntervalSec < 30) {
    addError("alm.interval.invalid", "minRebalanceInterval must be at least 30 seconds.");
  }

  if (!Number.isFinite(values.maxSwapInPct) || values.maxSwapInPct <= 0 || values.maxSwapInPct > 100) {
    addError("alm.max_swap_in.invalid", "maxSwapIn must be between 0 and 100%.");
  } else if (values.maxSwapInPct >= 50) {
    addWarning("alm.max_swap_in.high", "maxSwapIn >= 50% increases the risk of very large swaps.");
  }

  if (parseUnitsSafe(values.minCompoundInput, values.token1Decimals) === null) {
    addError("alm.min_compound.invalid", "minCompoundValue is not a valid number.");
  }
  if (parseUnitsSafe(values.minSwapInput, values.token1Decimals) === null) {
    addError("alm.min_swap.invalid", "minSwapValue is not a valid number.");
  }

  if (values.oracleEnabled) {
    const hex = String(values.oracleParamsHex || "").trim();
    if (!isHex(hex) || hex.length % 2 !== 0) {
      addError("alm.oracle.invalid_format", "Oracle params must be valid hex bytes (0x...).");
    } else if (hex === "0x") {
      addWarning("alm.oracle.empty", "Oracle is enabled but params are empty: verify before submit.");
    }
  }

  if (values.useExternalDex) {
    if (!isAddress(values.routerAddress)) {
      addError("alm.crossdex.router_required", "Router is required when cross-DEX is enabled.");
    }
    if (!isAddress(values.quoterAddress)) {
      addError("alm.crossdex.quoter_required", "Quoter is required when cross-DEX is enabled.");
    }
    if (!isAddress(values.factoryAddress)) {
      addError("alm.crossdex.factory_required", "Factory is required when cross-DEX is enabled.");
    }
  }

  const token0 = sanitizeAddress(values.token0Address);
  const token1 = sanitizeAddress(values.token1Address);
  if (!isAddress(token0) || isZeroAddress(token0) || !isAddress(token1) || isZeroAddress(token1)) {
    addError("alm.pair.invalid", "Invalid token0/token1 pair.");
  } else if (token0.toLowerCase() === token1.toLowerCase()) {
    addError("alm.pair.same_token", "token0 and token1 must be different.");
  }

  return {
    errors: issues.filter((issue) => issue.level === "error"),
    warnings: issues.filter((issue) => issue.level === "warning"),
    all: issues,
  };
};

const parseUnitsSafe = (value: string, decimals: number): bigint | null => {
  try {
    const normalized = String(value || "").trim().replace(",", ".");
    if (!normalized) return null;
    return BigInt(parseUnits(normalized, decimals));
  } catch {
    return null;
  }
};

const readFactoryFrom = async (address: string, provider: any): Promise<string | null> => {
  try {
    const c = new Contract(address, FACTORY_GETTER_ABI as any, provider);
    const raw = await c.factory();
    const normalized = sanitizeAddress(String(raw || ""));
    return isAddress(normalized) ? normalized : null;
  } catch {
    return null;
  }
};

export const validateWizardOnChain = async (values: WizardFormValues, provider: any) => {
  const issues: WizardIssue[] = [];
  if (!values.useExternalDex) {
    return {
      errors: issues,
      warnings: [] as WizardIssue[],
      all: issues,
    };
  }

  if (!isAddress(values.routerAddress) || !isAddress(values.quoterAddress) || !isAddress(values.factoryAddress)) {
    return {
      errors: issues,
      warnings: [] as WizardIssue[],
      all: issues,
    };
  }

  const router = sanitizeAddress(values.routerAddress);
  const quoter = sanitizeAddress(values.quoterAddress);
  const factory = sanitizeAddress(values.factoryAddress);
  const token0 = sanitizeAddress(values.token0Address);
  const token1 = sanitizeAddress(values.token1Address);

  const [routerFactory, quoterFactory] = await Promise.all([
    readFactoryFrom(router, provider),
    readFactoryFrom(quoter, provider),
  ]);

  if (routerFactory && routerFactory.toLowerCase() !== factory.toLowerCase()) {
    issues.push({
      level: "error",
      code: "alm.crossdex.router_factory_mismatch",
      message: "Router and factory are not consistent.",
    });
  }
  if (quoterFactory && quoterFactory.toLowerCase() !== factory.toLowerCase()) {
    issues.push({
      level: "error",
      code: "alm.crossdex.quoter_factory_mismatch",
      message: "Quoter and factory are not consistent.",
    });
  }
  if (!routerFactory) {
    issues.push({
      level: "warning",
      code: "alm.crossdex.router_factory_unverified",
      message: "Unable to verify router factory (ABI/function not available).",
    });
  }
  if (!quoterFactory) {
    issues.push({
      level: "warning",
      code: "alm.crossdex.quoter_factory_unverified",
      message: "Unable to verify quoter factory (ABI/function not available).",
    });
  }

  try {
    const factoryContract = new Contract(factory, V3_FACTORY_ABI as any, provider);
    const pool = sanitizeAddress(String(await factoryContract.getPool(token0, token1, values.swapFeeOverride)));
    if (!pool || isZeroAddress(pool)) {
      issues.push({
        level: "error",
        code: "alm.crossdex.pool_missing",
        message: `Swap pool ${(values.swapFeeOverride / 10000).toFixed(2)} does not exist on this factory.`,
      });
    }
  } catch {
    issues.push({
      level: "error",
      code: "alm.crossdex.pool_check_failed",
      message: "Unable to verify swap pool existence on this factory.",
    });
  }

  return {
    errors: issues.filter((issue) => issue.level === "error"),
    warnings: issues.filter((issue) => issue.level === "warning"),
    all: issues,
  };
};

export const buildWizardSummary = (values: WizardFormValues) => {
  const range = computeRangePreview(values);
  const targetPct0 = Math.max(0, Math.min(100, toNumeric(values.targetPct0)));
  const targetPct1 = Number.isFinite(targetPct0) ? 100 - targetPct0 : 0;
  const routeText = values.useExternalDex ? "Cross-DEX swaps enabled" : "Swaps on primary DEX";
  const oracleText = values.oracleEnabled
    ? `Oracle ON (${values.oraclePreset === "custom" ? "custom" : ORACLE_PRESET_META[values.oraclePreset].label})`
    : "Oracle OFF";
  return [
    `LP fee ${values.lpFeeTier / 10000}% on pair ${values.token0Symbol}/${values.token1Symbol}`,
    `Range +${values.rangeUpPct}% / -${values.rangeDownPct}% (width on-chain ${range.encodedWidthBps} bps)`,
    `Target ${targetPct0.toFixed(2)}% token0 / ${targetPct1.toFixed(2)}% token1`,
    `Rebalance min interval ${values.minRebalanceIntervalSec}s, deadband ${values.ratioDeadbandPct}%`,
    `Swap slippage ${values.maxSwapSlippagePct}% | mint slippage ${values.mintSlippagePct}%`,
    `maxSwapIn ${values.maxSwapInPct}% | swap fee override ${values.swapFeeOverride / 10000}%`,
    routeText,
    oracleText,
    `Min compound ${values.minCompoundInput} ${values.token1Symbol}`,
  ];
};

export const toWizardSubmitPayload = (
  values: WizardFormValues,
  strategy: WizardStrategySeed
): WizardSubmitPayload => {
  const range = computeRangePreview(values);
  const routeCode = values.useExternalDex ? 1 : strategy.route === "DIRECT_ONLY" ? 0 : 1;
  return {
    strategyId: strategy.id,
    widthBps: range.encodedWidthBps,
    recenterBps: Math.max(1, toBpsFromPct(values.recenterTriggerPct)),
    minRebalanceInterval: Math.max(30, Math.round(values.minRebalanceIntervalSec)),
    maxSwapSlippageBps: Math.max(1, toBpsFromPct(values.maxSwapSlippagePct)),
    mintSlippageBps: Math.max(1, toBpsFromPct(values.mintSlippagePct)),
    ratioDeadbandBps: Math.max(0, toBpsFromPct(values.ratioDeadbandPct)),
    targetRatioBps0: Math.max(0, Math.min(10_000, toBpsFromPct(values.targetPct0))),
    minCompoundInput: values.minCompoundInput,
    minSwapInput: values.minSwapInput,
    token1Decimals: values.token1Decimals,
    allowSwap: strategy.allowSwap,
    routeCode,
    minCardinality: strategy.minCardinality,
    lpFeeTier: values.lpFeeTier,
    oracleParamsHex: values.oracleEnabled ? values.oracleParamsHex : "0x",
    wethHopFee: values.swapFeeOverride,
    maxSwapInBps: Math.max(1, toBpsFromPct(values.maxSwapInPct)),
    useExternalDex: values.useExternalDex,
    routerAddress: sanitizeAddress(values.routerAddress),
    quoterAddress: sanitizeAddress(values.quoterAddress),
    factoryAddress: sanitizeAddress(values.factoryAddress),
    swapFeeOverride: values.swapFeeOverride,
    token0Address: sanitizeAddress(values.token0Address),
    token1Address: sanitizeAddress(values.token1Address),
  };
};
