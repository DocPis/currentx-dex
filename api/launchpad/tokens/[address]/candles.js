import { getTokenCandles, parseError, requireGet, sendJson } from "../../_shared.js";

export default async function handler(req, res) {
  if (!requireGet(req, res)) return;
  try {
    const tokenAddress = String(req.query?.address || "").trim().toLowerCase();
    if (!tokenAddress) {
      sendJson(res, 400, { error: "Missing token address" });
      return;
    }
    const tf = String(req.query?.tf || "24h").trim().toLowerCase();
    const items = await getTokenCandles(tokenAddress, tf);
    sendJson(res, 200, { items });
  } catch (error) {
    sendJson(res, 500, { error: parseError(error) });
  }
}
