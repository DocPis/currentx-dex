// src/config/customTokens.js
const CUSTOM_TOKEN_STORE_KEY = "__CX_CUSTOM_TOKENS__";

export function getRegisteredCustomTokens() {
  if (typeof globalThis === "undefined") return {};
  return globalThis[CUSTOM_TOKEN_STORE_KEY] || {};
}

export function setRegisteredCustomTokens(tokens) {
  if (typeof globalThis === "undefined") return;
  globalThis[CUSTOM_TOKEN_STORE_KEY] = tokens || {};
}

export { CUSTOM_TOKEN_STORE_KEY };
