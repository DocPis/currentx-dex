const env = typeof import.meta !== "undefined" ? import.meta.env || {} : {};
const rawFlag = env.VITE_SHOW_GECKOTERMINAL_ATTRIBUTION;
const FLAG_OFF_VALUES = new Set(["0", "false", "off", "no"]);

export const GECKOTERMINAL_URL = "https://www.geckoterminal.com/";
export const SHOW_GECKOTERMINAL_ATTRIBUTION =
  rawFlag === undefined || rawFlag === null || rawFlag === ""
    ? true
    : !FLAG_OFF_VALUES.has(String(rawFlag).toLowerCase());
