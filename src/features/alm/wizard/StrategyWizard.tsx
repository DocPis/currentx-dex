import React, { useEffect, useMemo, useState } from "react";
import {
  ALM_ALLOWED_FEES,
  MAX_SWAP_IN_PRESETS,
  ORACLE_PRESET_META,
  applyWizardPreset,
  buildWizardSummary,
  computeRangePreview,
  makeDefaultWizardValues,
  toWizardSubmitPayload,
  validateWizardOnChain,
  validateWizardSync,
  type OraclePresetId,
  type WizardFormValues,
  type WizardIssue,
  type WizardNftSeed,
  type WizardPresetId,
  type WizardStrategySeed,
  type WizardSubmitPayload,
} from "./strategyWizardSchema";

interface StrategyWizardProps {
  readProvider: any;
  selectedStrategy: WizardStrategySeed | null;
  selectedNft: WizardNftSeed | null;
  selectedToken1Stable: boolean | null;
  crossDexDefaults?: {
    routerAddress: string;
    quoterAddress: string;
    factoryAddress: string;
  } | null;
  canEditRegistry: boolean;
  canEditAlm: boolean;
  saving: boolean;
  maxSwapInBpsCurrent: number | null;
  onSubmit: (payload: WizardSubmitPayload) => Promise<void> | void;
}

type WizardStep = 1 | 2 | 3;

const tooltipClass =
  "cursor-help rounded-full border border-slate-700/70 bg-slate-900/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300";

const FieldLabel = ({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) => (
  <label className="text-xs text-slate-300">
    <span className="flex items-center gap-2">
      <span>{title}</span>
      {hint ? (
        <span title={hint} className={tooltipClass}>
          ?
        </span>
      ) : null}
      {children}
    </span>
  </label>
);

const StepBadge = ({
  index,
  current,
  title,
  onClick,
}: {
  index: WizardStep;
  current: WizardStep;
  title: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
      current === index
        ? "border-cyan-300/70 bg-cyan-500/10 text-cyan-100"
        : "border-slate-700/70 bg-slate-900/60 text-slate-300 hover:border-slate-500/80"
    }`}
  >
    <div className="text-[10px] uppercase tracking-wide text-slate-400">Step {index}</div>
      <div className="mt-0.5 font-semibold">{title}</div>
    </button>
);

const PresetButton = ({
  id,
  active,
  onClick,
}: {
  id: WizardPresetId;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
      active
        ? "border-cyan-300/70 bg-cyan-500/10 text-cyan-100"
        : "border-slate-700/70 bg-slate-900/70 text-slate-200 hover:border-slate-500"
    }`}
  >
    {id[0].toUpperCase()}
    {id.slice(1)}
  </button>
);

export default function StrategyWizard({
  readProvider,
  selectedStrategy,
  selectedNft,
  selectedToken1Stable,
  crossDexDefaults,
  canEditRegistry,
  canEditAlm,
  saving,
  maxSwapInBpsCurrent,
  onSubmit,
}: StrategyWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [values, setValues] = useState<WizardFormValues>(() =>
    makeDefaultWizardValues(selectedStrategy, selectedNft)
  );
  const [selectedPreset, setSelectedPreset] = useState<WizardPresetId | null>(null);
  const [asyncIssues, setAsyncIssues] = useState<WizardIssue[]>([]);
  const [validatingAsync, setValidatingAsync] = useState(false);

  useEffect(() => {
    setValues(makeDefaultWizardValues(selectedStrategy, selectedNft));
    setSelectedPreset(null);
    setAsyncIssues([]);
    setStep(1);
  }, [selectedStrategy, selectedNft]);

  useEffect(() => {
    if (!crossDexDefaults) return;
    const routerAddress = String(crossDexDefaults.routerAddress || "").trim();
    const quoterAddress = String(crossDexDefaults.quoterAddress || "").trim();
    const factoryAddress = String(crossDexDefaults.factoryAddress || "").trim();
    const useExternalDex = Boolean(routerAddress && quoterAddress && factoryAddress);
    setValues((current) => ({
      ...current,
      useExternalDex,
      routerAddress,
      quoterAddress,
      factoryAddress,
    }));
  }, [crossDexDefaults]);

  const syncValidation = useMemo(() => validateWizardSync(values), [values]);
  const rangePreview = useMemo(() => computeRangePreview(values), [values]);
  const summary = useMemo(() => buildWizardSummary(values), [values]);

  const mergedWarnings = useMemo(() => {
    const list = [...syncValidation.warnings, ...asyncIssues.filter((issue) => issue.level === "warning")];
    if (values.useExternalDex && !canEditAlm) {
      list.push({
        level: "warning",
        code: "alm.crossdex.owner_required",
        message: "Cross-DEX requires ALM owner permissions to apply router/quoter/factory on-chain.",
      });
    }
    return list;
  }, [asyncIssues, canEditAlm, syncValidation.warnings, values.useExternalDex]);

  const mergedErrors = useMemo(() => {
    const list = [...syncValidation.errors, ...asyncIssues.filter((issue) => issue.level === "error")];
    if (values.useExternalDex && !canEditAlm) {
      list.push({
        level: "error",
        code: "alm.crossdex.owner_required",
        message: "Enable cross-DEX only with the ALM owner wallet.",
      });
    }
    const nextMaxSwapInBps = Math.round(values.maxSwapInPct * 100);
    if (Number.isFinite(maxSwapInBpsCurrent || 0) && maxSwapInBpsCurrent !== null && nextMaxSwapInBps !== maxSwapInBpsCurrent && !canEditAlm) {
      list.push({
        level: "error",
        code: "alm.max_swap_in.owner_required",
        message: "Updating maxSwapInBps requires ALM owner permissions.",
      });
    }
    if (!canEditRegistry) {
      list.push({
        level: "error",
        code: "alm.registry.owner_required",
        message: "Only the StrategyRegistry owner can save this strategy.",
      });
    }
    return list;
  }, [asyncIssues, canEditAlm, canEditRegistry, maxSwapInBpsCurrent, syncValidation.errors, values.maxSwapInPct, values.useExternalDex]);

  const updateValues = <K extends keyof WizardFormValues>(key: K, next: WizardFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: next }));

  const applyPreset = (preset: WizardPresetId) => {
    setValues((current) => applyWizardPreset(current, preset));
    setSelectedPreset(preset);
  };

  const handleOraclePreset = (preset: Exclude<OraclePresetId, "custom">) => {
    const fallbackHex = ORACLE_PRESET_META[preset].fallbackHex;
    setValues((current) => ({
      ...current,
      oracleEnabled: true,
      oraclePreset: preset,
      oracleParamsHex: current.oracleParamsHex && current.oracleParamsHex !== "0x" ? current.oracleParamsHex : fallbackHex,
    }));
  };

  const onConfirm = async () => {
    if (!selectedStrategy) return;
    setAsyncIssues([]);
    if (syncValidation.errors.length > 0) return;
    setValidatingAsync(true);
    try {
      const asyncValidation = await validateWizardOnChain(values, readProvider);
      setAsyncIssues(asyncValidation.all);
      if (asyncValidation.errors.length > 0) return;
      const payload = toWizardSubmitPayload(values, selectedStrategy);
      await onSubmit(payload);
    } finally {
      setValidatingAsync(false);
    }
  };

  const canContinue = mergedErrors.length === 0 && !saving && !validatingAsync;

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-100">Strategy Wizard</h2>
          <p className="mt-1 text-xs text-slate-400">
            Configure strategy in 3 steps: simple by default, advanced for power users.
          </p>
        </div>
        <div className="inline-flex items-center rounded-full border border-slate-700/70 bg-slate-900/70 p-1 text-xs">
          <button
            type="button"
            onClick={() => updateValues("mode", "basic")}
            className={`rounded-full px-3 py-1 ${values.mode === "basic" ? "bg-cyan-500/15 text-cyan-100" : "text-slate-300"}`}
          >
            Basic
          </button>
          <button
            type="button"
            onClick={() => updateValues("mode", "advanced")}
            className={`rounded-full px-3 py-1 ${
              values.mode === "advanced" ? "bg-cyan-500/15 text-cyan-100" : "text-slate-300"
            }`}
          >
            Advanced
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {(["safe", "balanced", "aggressive"] as WizardPresetId[]).map((presetId) => (
          <PresetButton
            key={presetId}
            id={presetId}
            active={selectedPreset === presetId}
            onClick={() => applyPreset(presetId)}
          />
        ))}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <StepBadge index={1} current={step} title="Pool & Range" onClick={() => setStep(1)} />
        <StepBadge index={2} current={step} title="Rebalance & Risk" onClick={() => setStep(2)} />
        <StepBadge index={3} current={step} title="Cross-DEX & Oracle" onClick={() => setStep(3)} />
      </div>

      {step === 1 && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 p-3">
              <FieldLabel
                title="Pair source"
                hint="Select pair from current NFT or enter a custom token pair."
              />
              <select
                value={values.pairSource}
                onChange={(event) => {
                  const nextSource = event.target.value as WizardFormValues["pairSource"];
                  updateValues("pairSource", nextSource);
                  if (nextSource === "selected_nft" && selectedNft) {
                    setValues((current) => ({
                      ...current,
                      pairSource: "selected_nft",
                      token0Address: selectedNft.token0,
                      token1Address: selectedNft.token1,
                      token0Symbol: selectedNft.token0Symbol,
                      token1Symbol: selectedNft.token1Symbol,
                      token1Decimals: selectedNft.token1Decimals,
                      lpFeeTier: selectedNft.fee,
                    }));
                  }
                }}
                className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              >
                {selectedNft ? (
                  <option value="selected_nft">
                    Selected NFT ({selectedNft.token0Symbol}/{selectedNft.token1Symbol})
                  </option>
                ) : null}
                <option value="custom">Custom token pair</option>
              </select>
            </div>
            <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 p-3">
              <FieldLabel title="LP fee tier" hint="Primary LP pool fee tier (DEX A)." />
              <select
                value={values.lpFeeTier}
                onChange={(event) => updateValues("lpFeeTier", Number(event.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              >
                {ALM_ALLOWED_FEES.map((fee) => (
                  <option key={fee} value={fee}>
                    {(fee / 10_000).toFixed(2)}%
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel title="Token0 address" hint="Required to validate cross-DEX swap pool." />
              <input
                value={values.token0Address}
                onChange={(event) => updateValues("token0Address", event.target.value.trim())}
                disabled={values.pairSource === "selected_nft"}
                className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-xs text-slate-100 disabled:opacity-60"
              />
            </div>
            <div>
              <FieldLabel title="Token1 address" hint="Required to validate cross-DEX swap pool." />
              <input
                value={values.token1Address}
                onChange={(event) => updateValues("token1Address", event.target.value.trim())}
                disabled={values.pairSource === "selected_nft"}
                className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-xs text-slate-100 disabled:opacity-60"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <FieldLabel title="Range up (%)" hint="Range width above current price." />
              <input
                value={values.rangeUpPct}
                onChange={(event) => updateValues("rangeUpPct", event.target.value.replace(",", "."))}
                className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <FieldLabel title="Range down (%)" hint="Range width below current price." />
              <input
                value={values.rangeDownPct}
                onChange={(event) => updateValues("rangeDownPct", event.target.value.replace(",", "."))}
                className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <FieldLabel title="Target token0 (%)" hint="Target value allocation for rebalancing." />
              <input
                value={values.targetPct0}
                onChange={(event) => updateValues("targetPct0", event.target.value.replace(",", "."))}
                className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </div>

          <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-100">
            Preview range: +{rangePreview.upBps} bps / -{rangePreview.downBps} bps | width on-chain:{" "}
            {rangePreview.encodedWidthBps} bps
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 p-3">
            <FieldLabel
              title="minRebalanceInterval (sec)"
              hint="Minimum time between two keeper rebalances."
            />
            <input
              type="range"
              min={30}
              max={86400}
              step={30}
              value={values.minRebalanceIntervalSec}
              onChange={(event) => updateValues("minRebalanceIntervalSec", Number(event.target.value))}
              className="mt-2 w-full accent-cyan-400"
            />
            <input
              value={values.minRebalanceIntervalSec}
              onChange={(event) => updateValues("minRebalanceIntervalSec", Number(event.target.value || 0))}
              className="mt-2 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel title="Recenter trigger (%)" hint="Threshold to mark position as 'needs rebalance'." />
              <input
                value={values.recenterTriggerPct}
                onChange={(event) => updateValues("recenterTriggerPct", event.target.value.replace(",", "."))}
                className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <FieldLabel title="Ratio deadband (%)" hint="Neutral zone before performing rebalance swaps." />
              <input
                value={values.ratioDeadbandPct}
                onChange={(event) => updateValues("ratioDeadbandPct", event.target.value.replace(",", "."))}
                className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <FieldLabel title="maxSwapSlippage (%)" hint="Maximum allowed slippage for swaps." />
              <input
                value={values.maxSwapSlippagePct}
                onChange={(event) => updateValues("maxSwapSlippagePct", event.target.value.replace(",", "."))}
                className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <FieldLabel title="mintSlippage (%)" hint="Maximum allowed slippage when minting LP." />
              <input
                value={values.mintSlippagePct}
                onChange={(event) => updateValues("mintSlippagePct", event.target.value.replace(",", "."))}
                className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 p-3">
            <FieldLabel title="maxSwapIn (%)" hint="Caps swap size during rebalance/compound." />
            <div className="mt-2 flex flex-wrap gap-2">
              {MAX_SWAP_IN_PRESETS.map((presetPct) => (
                <button
                  key={presetPct}
                  type="button"
                  onClick={() => updateValues("maxSwapInPct", presetPct)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    values.maxSwapInPct === presetPct
                      ? "border-cyan-300/70 bg-cyan-500/10 text-cyan-100"
                      : "border-slate-700/70 bg-slate-900/70 text-slate-200"
                  }`}
                >
                  {presetPct}%
                </button>
              ))}
            </div>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={values.maxSwapInPct}
              onChange={(event) => updateValues("maxSwapInPct", Number(event.target.value))}
              className="mt-2 w-full accent-cyan-400"
            />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 p-3">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel
                title="Use external DEX for swaps"
                hint="LP on primary factory, swaps on external factory."
              />
              <button
                type="button"
                onClick={() => updateValues("useExternalDex", !values.useExternalDex)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  values.useExternalDex
                    ? "border-cyan-300/70 bg-cyan-500/10 text-cyan-100"
                    : "border-slate-700/70 bg-slate-900/70 text-slate-200"
                }`}
              >
                {values.useExternalDex ? "ON" : "OFF"}
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel title="Router address" hint="Swap router for the external DEX." />
                <input
                  value={values.routerAddress}
                  onChange={(event) => updateValues("routerAddress", event.target.value.trim())}
                  disabled={!values.useExternalDex}
                  className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-xs text-slate-100 disabled:opacity-60"
                />
              </div>
              <div>
                <FieldLabel title="Quoter address" hint="Quoter used to estimate minOut." />
                <input
                  value={values.quoterAddress}
                  onChange={(event) => updateValues("quoterAddress", event.target.value.trim())}
                  disabled={!values.useExternalDex}
                  className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-xs text-slate-100 disabled:opacity-60"
                />
              </div>
              <div>
                <FieldLabel title="Factory address" hint="V3 factory used to validate swap pool existence." />
                <input
                  value={values.factoryAddress}
                  onChange={(event) => updateValues("factoryAddress", event.target.value.trim())}
                  disabled={!values.useExternalDex}
                  className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-xs text-slate-100 disabled:opacity-60"
                />
              </div>
              <div>
                <FieldLabel title="Swap fee override" hint="Swap pool fee (wethHopFee): 100/500/3000/10000." />
                <select
                  value={values.swapFeeOverride}
                  onChange={(event) => updateValues("swapFeeOverride", Number(event.target.value))}
                  className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                >
                  {ALM_ALLOWED_FEES.map((fee) => (
                    <option key={fee} value={fee}>
                      {(fee / 10_000).toFixed(2)}%
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 p-3">
            <div className="flex items-center justify-between">
              <FieldLabel title="Oracle" hint="Enable oracle guardrails to reduce manipulation risk." />
              <button
                type="button"
                onClick={() => updateValues("oracleEnabled", !values.oracleEnabled)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  values.oracleEnabled
                    ? "border-cyan-300/70 bg-cyan-500/10 text-cyan-100"
                    : "border-slate-700/70 bg-slate-900/70 text-slate-200"
                }`}
              >
                {values.oracleEnabled ? "ON" : "OFF"}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(ORACLE_PRESET_META) as Exclude<OraclePresetId, "custom">[]).map((presetId) => (
                <button
                  key={presetId}
                  type="button"
                  onClick={() => handleOraclePreset(presetId)}
                  title={ORACLE_PRESET_META[presetId].description}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    values.oraclePreset === presetId
                      ? "border-cyan-300/70 bg-cyan-500/10 text-cyan-100"
                      : "border-slate-700/70 bg-slate-900/70 text-slate-200"
                  }`}
                >
                  {ORACLE_PRESET_META[presetId].label}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <FieldLabel title="Oracle params hex" hint="oracleParams bytes sent to the registry." />
              <input
                value={values.oracleParamsHex}
                onChange={(event) => {
                  updateValues("oraclePreset", "custom");
                  updateValues("oracleParamsHex", event.target.value.trim());
                }}
                disabled={!values.oracleEnabled}
                className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 font-mono text-xs text-slate-100 disabled:opacity-60"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel
                title={`minCompoundValue (${values.token1Symbol})`}
                hint="Minimum value (in token1 units) required for compound."
              />
              <input
                value={values.minCompoundInput}
                onChange={(event) => updateValues("minCompoundInput", event.target.value.replace(",", "."))}
                className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              />
              {selectedToken1Stable ? (
                <div className="mt-1 text-[11px] text-slate-400">
                  Interpreted as near-USD value when token1 is stable.
                </div>
              ) : null}
            </div>
            <div>
              <FieldLabel
                title={`minSwapValue (${values.token1Symbol})`}
                hint="Minimum value required to allow swaps during rebalance."
              />
              <input
                value={values.minSwapInput}
                onChange={(event) => updateValues("minSwapInput", event.target.value.replace(",", "."))}
                className="mt-1 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-900/45 p-3">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">Summary pre-submit</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-200">
          {summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      {mergedErrors.length > 0 && (
        <div className="mt-3 space-y-1 rounded-xl border border-rose-400/35 bg-rose-500/10 px-3 py-2">
          {mergedErrors.map((issue) => (
            <div key={`${issue.code}-${issue.message}`} className="text-xs text-rose-100">
              {issue.message}
            </div>
          ))}
        </div>
      )}

      {mergedWarnings.length > 0 && (
        <div className="mt-3 space-y-1 rounded-xl border border-amber-400/35 bg-amber-500/10 px-3 py-2">
          {mergedWarnings.map((issue) => (
            <div key={`${issue.code}-${issue.message}`} className="text-xs text-amber-100">
              {issue.message}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((current) => (Math.max(1, current - 1) as WizardStep))}
            className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="button"
            disabled={step === 3}
            onClick={() => setStep((current) => (Math.min(3, current + 1) as WizardStep))}
            className="rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
          >
            Next
          </button>
        </div>

        <button
          type="button"
          onClick={onConfirm}
          disabled={!canContinue || !selectedStrategy}
          className="rounded-xl border border-cyan-400/45 bg-cyan-500/10 px-4 py-1.5 text-xs font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving..." : validatingAsync ? "Validating..." : "Save Strategy"}
        </button>
      </div>
    </div>
  );
}
