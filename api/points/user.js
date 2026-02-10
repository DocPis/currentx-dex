import { kv } from "@vercel/kv";

const DEFAULT_SEASON_ID = "season-1";
const DEFAULT_START_MS = Date.UTC(2026, 1, 10, 0, 0, 0);

const parseTime = (value) => {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const getSeasonConfig = () => {
  const seasonId = process.env.POINTS_SEASON_ID || DEFAULT_SEASON_ID;
  const startMs =
    parseTime(process.env.POINTS_SEASON_START) ||
    parseTime(process.env.VITE_POINTS_SEASON_START) ||
    DEFAULT_START_MS;
  const endMs =
    parseTime(process.env.POINTS_SEASON_END) ||
    parseTime(process.env.VITE_POINTS_SEASON_END) ||
    null;
  return {
    seasonId,
    startMs,
    endMs,
  };
};

const getKeys = (seasonId, address) => {
  const base = `points:${seasonId}`;
  return {
    leaderboard: `${base}:leaderboard`,
    updatedAt: `${base}:updatedAt`,
    user: address ? `${base}:user:${address}` : null,
  };
};

const normalizeAddress = (addr) => (addr ? String(addr).toLowerCase() : "");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { seasonId: seasonParam, address } = req.query || {};
  const { seasonId } = getSeasonConfig();
  const targetSeason = seasonParam || seasonId;
  const normalized = normalizeAddress(address);
  if (!normalized) {
    res.status(400).json({ error: "Missing address" });
    return;
  }

  const keys = getKeys(targetSeason, normalized);
  try {
    const data = await kv.hgetall(keys.user);
    if (!data) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.status(200).json({
      seasonId: targetSeason,
      address: normalized,
      user: data,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
