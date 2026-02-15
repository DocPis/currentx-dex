import {
  asArray,
  filterTokens,
  getTokenDetail,
  getTokensSnapshot,
  hydrateTokenLogos,
  paginateTokens,
  parseError,
  requireGet,
  sendJson,
  sortTokens,
} from "./_shared.js";

export default async function handler(req, res) {
  if (!requireGet(req, res)) return;
  try {
    const tokenAddress = String(req.query?.address || "").trim().toLowerCase();
    if (tokenAddress) {
      const token = await getTokenDetail(tokenAddress);
      if (!token) {
        sendJson(res, 404, { error: "Token not found" });
        return;
      }
      sendJson(res, 200, token);
      return;
    }

    const page = Math.max(1, Number(req.query?.page) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(req.query?.pageSize) || 24));
    const q = String(req.query?.q || "").trim();
    const sort = String(req.query?.sort || "mcap").trim();
    const filters = asArray(req.query?.filters);

    const snapshot = await getTokensSnapshot();
    const filtered = filterTokens(snapshot.tokens || [], q, filters);
    const sorted = sortTokens(filtered, sort);
    const { pageItems, total, hasMore } = paginateTokens(sorted, page, pageSize);
    const hydratedItems = await hydrateTokenLogos(pageItems);

    sendJson(res, 200, {
      items: hydratedItems,
      page,
      pageSize,
      total,
      hasMore,
    });
  } catch (error) {
    sendJson(res, 500, { error: parseError(error) });
  }
}
