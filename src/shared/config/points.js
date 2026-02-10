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

export const BOOST_CAP_MULTIPLIER = 10;
export const OUT_OF_RANGE_FACTOR = 0.5;

export const MULTIPLIER_TIERS = [
  { minSeconds: 0, multiplier: 1.2, label: "<24h" },
  { minSeconds: 24 * 60 * 60, multiplier: 1.5, label: ">=24h" },
  { minSeconds: 72 * 60 * 60, multiplier: 2.0, label: ">=72h" },
  { minSeconds: 7 * 24 * 60 * 60, multiplier: 2.5, label: ">=7d" },
  { minSeconds: 30 * 24 * 60 * 60, multiplier: 3.0, label: ">=30d" },
];

export const POINTS_SEASON = {
  id: SEASON_ID,
  label: SEASON_LABEL,
  startTime: SEASON_START_MS,
  endTime: SEASON_END_MS,
  ongoing: SEASON_ONGOING,
};
