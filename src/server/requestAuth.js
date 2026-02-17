/* eslint-env node */

const normalizeSecret = (value) => String(value || "").trim();

const parseAuthorizationHeader = (req) => {
  const header = req?.headers?.authorization;
  const raw = Array.isArray(header) ? String(header[0] || "") : String(header || "");
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const bearerMatch = trimmed.match(/^Bearer\s+(.+)$/iu);
  if (bearerMatch) return normalizeSecret(bearerMatch[1]);
  return normalizeSecret(trimmed);
};

export const authorizeBearerRequest = (req, secrets) => {
  const activeSecrets = (Array.isArray(secrets) ? secrets : [secrets])
    .map((secret) => normalizeSecret(secret))
    .filter(Boolean);
  if (!activeSecrets.length) return true;
  const providedToken = parseAuthorizationHeader(req);
  if (!providedToken) return false;
  return activeSecrets.some((secret) => providedToken === secret);
};

