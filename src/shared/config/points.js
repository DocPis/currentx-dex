// src/shared/config/points.js

const env = typeof import.meta !== "undefined" ? import.meta.env || {} : {};

const parseTime = (value) => {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBool = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

export const SEASON_ID =
  String(env.VITE_POINTS_SEASON_ID || env.POINTS_SEASON_ID || "").trim();
export const SEASON_LABEL =
  String(env.VITE_POINTS_SEASON_LABEL || env.POINTS_SEASON_LABEL || SEASON_ID).trim();

export const SEASON_START_MS =
  parseTime(env.VITE_POINTS_SEASON_START) ?? null;
export const SEASON_END_MS = parseTime(env.VITE_POINTS_SEASON_END);
export const SEASON_ONGOING = Boolean(SEASON_START_MS) && !SEASON_END_MS;

export const LP_POOL_MULTIPLIERS = {
  SWAP: 1,
  CRX_ETH: 2,
  CRX_USDM: 3,
};

export const SHOW_LEADERBOARD = parseBool(env.VITE_POINTS_SHOW_LEADERBOARD);

export const POINTS_SEASON = {
  id: SEASON_ID,
  label: SEASON_LABEL,
  startTime: SEASON_START_MS,
  endTime: SEASON_END_MS,
  ongoing: SEASON_ONGOING,
};
