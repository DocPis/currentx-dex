const trimTrailingZeros = (value) => {
  if (typeof value !== "string" || !value.includes(".")) return value;
  return value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
};

const formatAutoAmount = (value, maxDecimals = null) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  if (num === 0) return "0";
  const abs = Math.abs(num);
  let decimals = 6;
  if (abs < 0.0001) decimals = 10;
  else if (abs < 0.01) decimals = 8;
  if (Number.isFinite(maxDecimals)) {
    decimals = Math.min(decimals, Math.max(0, maxDecimals));
  }
  return trimTrailingZeros(num.toFixed(decimals));
};

const sanitizeAmountInput = (raw, decimals) => {
  if (raw === null || raw === undefined) return "";
  const value = String(raw).replace(/,/g, ".");
  if (!value) return "";
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return "";
  const hasTrailingDot = cleaned.endsWith(".");
  const parts = cleaned.split(".");
  const intPart = parts[0] ?? "";
  let fracPart = parts.slice(1).join("");
  const maxDecimals = Number.isFinite(decimals) ? Math.max(0, decimals) : null;
  if (maxDecimals !== null) {
    fracPart = fracPart.slice(0, maxDecimals);
  }
  const safeInt = intPart === "" ? "0" : intPart;
  if (maxDecimals === 0) return safeInt;
  if (fracPart.length) return `${safeInt}.${fracPart}`;
  return hasTrailingDot ? `${safeInt}.` : safeInt;
};

export const applyMaxBuffer = (value, decimals) => {
  if (!Number.isFinite(value)) return 0;
  const dec = Number.isFinite(decimals) ? Math.max(0, decimals) : 18;
  const step = Math.pow(10, -Math.min(6, dec));
  const buffered = value - step;
  if (buffered > 0) return buffered;
  return Math.max(0, value);
};

export const computeV3QuickFillAmount = (balance, pct, decimals) => {
  if (!Number.isFinite(balance) || balance <= 0) return "";
  if (!Number.isFinite(pct) || pct <= 0) return "";
  const base = balance * pct;
  const buffered = pct === 1 ? applyMaxBuffer(base, decimals) : base;
  const formatted = formatAutoAmount(buffered, decimals);
  return sanitizeAmountInput(formatted, decimals);
};

