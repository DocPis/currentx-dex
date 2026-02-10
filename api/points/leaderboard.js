import { kv } from "@vercel/kv";

const DEFAULT_SEASON_ID = "season-1";
const DEFAULT_START_MS = Date.UTC(2026, 1, 12, 0, 0, 0);

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

const getKeys = (seasonId) => {
  const base = `points:${seasonId}`;
  return {
    leaderboard: `${base}:leaderboard`,
    updatedAt: `${base}:updatedAt`,
    user: (address) => `${base}:user:${address}`,
  };
};

const normalizeAddress = (addr) => (addr ? String(addr).toLowerCase() : "");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { seasonId: seasonParam } = req.query || {};
  const { seasonId } = getSeasonConfig();
  const targetSeason = seasonParam || seasonId;

  const keys = getKeys(targetSeason);
  try {
    const entries = await kv.zrange(keys.leaderboard, 0, 99, {
      rev: true,
      withScores: true,
    });

    const items = [];
    const addresses = [];
    for (let i = 0; i < entries.length; i += 2) {
      const address = normalizeAddress(entries[i]);
      const score = Number(entries[i + 1] || 0);
      if (!address) continue;
      addresses.push({ address, score });
    }

    const pipeline = kv.pipeline();
    addresses.forEach(({ address }) => pipeline.hgetall(keys.user(address)));
    const userRows = await pipeline.exec();

    addresses.forEach(({ address, score }, idx) => {
      const row = userRows?.[idx] || {};
      const points = Number(row?.points ?? score ?? 0);
      const multiplier = Number(row?.multiplier ?? 1);
      const lpUsd = Number(row?.lpUsd ?? 0);
      const rank = Number(row?.rank);
      items.push({
        address,
        points: Number.isFinite(points) ? points : score,
        multiplier: Number.isFinite(multiplier) ? multiplier : 1,
        lpUsd: Number.isFinite(lpUsd) ? lpUsd : 0,
        rank: Number.isFinite(rank) ? rank : null,
      });
    });

    const updatedAt = await kv.get(keys.updatedAt);
    res.status(200).json({
      seasonId: targetSeason,
      updatedAt: updatedAt || null,
      leaderboard: items,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
