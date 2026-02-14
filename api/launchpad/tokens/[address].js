import { getTokenDetail, parseError, requireGet, sendJson } from "../_shared.js";

export default async function handler(req, res) {
  if (!requireGet(req, res)) return;
  try {
    const tokenAddress = String(req.query?.address || "").trim().toLowerCase();
    if (!tokenAddress) {
      sendJson(res, 400, { error: "Missing token address" });
      return;
    }

    const token = await getTokenDetail(tokenAddress);
    if (!token) {
      sendJson(res, 404, { error: "Token not found" });
      return;
    }

    sendJson(res, 200, token);
  } catch (error) {
    sendJson(res, 500, { error: parseError(error) });
  }
}
