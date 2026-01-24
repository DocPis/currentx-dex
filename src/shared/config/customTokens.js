// src/config/customTokens.js
const CUSTOM_TOKEN_STORE_KEY = "__CX_CUSTOM_TOKENS__";

const readLocalStorage = () => {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(CUSTOM_TOKEN_STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // ignore storage/parse errors
  }
  return null;
};

const writeLocalStorage = (tokens) => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      CUSTOM_TOKEN_STORE_KEY,
      JSON.stringify(tokens || {})
    );
  } catch {
    // ignore storage errors
  }
};

export function getRegisteredCustomTokens() {
  const fromStorage = readLocalStorage();
  if (fromStorage) {
    if (typeof globalThis !== "undefined") {
      globalThis[CUSTOM_TOKEN_STORE_KEY] = fromStorage;
    }
    return fromStorage;
  }
  if (typeof globalThis === "undefined") return {};
  return globalThis[CUSTOM_TOKEN_STORE_KEY] || {};
}

export function setRegisteredCustomTokens(tokens) {
  if (typeof globalThis !== "undefined") {
    globalThis[CUSTOM_TOKEN_STORE_KEY] = tokens || {};
  }
  writeLocalStorage(tokens);
}

export { CUSTOM_TOKEN_STORE_KEY };
