import { getActivity, parseError, requireGet, sendJson } from "./_shared.js";

export default async function handler(req, res) {
  if (!requireGet(req, res)) return;
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 20));
    const type = String(req.query?.type || "buys").trim().toLowerCase();
    const tokenAddress = String(req.query?.tokenAddress || req.query?.token || "")
      .trim()
      .toLowerCase();
    const payload = await getActivity({ tokenAddress, type, limit });
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, { error: parseError(error) });
  }
}
