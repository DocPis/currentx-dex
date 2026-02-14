import { getActivity, parseError, requireGet, sendJson } from "../../_shared.js";

export default async function handler(req, res) {
  if (!requireGet(req, res)) return;
  try {
    const tokenAddress = String(req.query?.address || "").trim().toLowerCase();
    if (!tokenAddress) {
      sendJson(res, 400, { error: "Missing token address" });
      return;
    }
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 40));
    const type = String(req.query?.type || "trades").trim().toLowerCase();
    const payload = await getActivity({ tokenAddress, type, limit });
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, { error: parseError(error) });
  }
}
