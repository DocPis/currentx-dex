// src/shared/config/points.js

const env = typeof import.meta !== "undefined" ? import.meta.env || {} : {};

const parseTime = (value) => {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

export const SEASON_ID = "season-1";
export const SEASON_LABEL = "Season 1";

export const SEASON_START_MS =
  parseTime(env.VITE_POINTS_SEASON_START) ?? Date.UTC(2026, 1, 12, 0, 0, 0);
export const SEASON_END_MS = parseTime(env.VITE_POINTS_SEASON_END);
export const SEASON_ONGOING = !SEASON_END_MS;

export const LP_POOL_MULTIPLIERS = {
  SWAP: 1,
  CRX_ETH: 2,
  CRX_USDM: 3,
};

export const SHOW_LEADERBOARD = false;

export const POINTS_SEASON = {
  id: SEASON_ID,
  label: SEASON_LABEL,
  startTime: SEASON_START_MS,
  endTime: SEASON_END_MS,
  ongoing: SEASON_ONGOING,
};
