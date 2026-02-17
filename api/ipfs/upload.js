import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { kv } from "@vercel/kv";
import { verifyMessage } from "ethers";

const MAX_IMAGE_BYTES = 1024 * 1024; // 1 MB
const MAX_IMAGE_LABEL = "1 MB";
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const MAX_BODY_BYTES = MAX_BASE64_CHARS + 40_000; // base64 payload + JSON envelope guardrail
const JSON_ACTION_MAX_BODY_BYTES = 16 * 1024;
const RATE_WINDOW_SECONDS = 10 * 60;
const MAX_UPLOADS_PER_IP = 20;
const MAX_UPLOADS_PER_ADDRESS = 12;
const MAX_CHALLENGES_PER_IP = 30;
const MAX_CHALLENGES_PER_ADDRESS = 12;
const CHALLENGE_TTL_SECONDS = 5 * 60;
const MAX_CHALLENGE_USES = 4;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
const DEFAULT_IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";
const RATE_PREFIX = "ipfs:rate:";
const CHALLENGE_PREFIX = "ipfs:challenge:";
const DEFAULT_ALLOWED_ORIGINS = process.env.IPFS_UPLOAD_ALLOWED_ORIGINS || "";

const fallbackRateBuckets =
  globalThis.__cxIpfsRateBucketsDistributed ||
  (globalThis.__cxIpfsRateBucketsDistributed = new Map());
const fallbackChallenges =
  globalThis.__cxIpfsChallengesFallback || (globalThis.__cxIpfsChallengesFallback = new Map());

const normalizeAddress = (value) => String(value || "").trim().toLowerCase();
const isAddress = (value) => /^0x[a-f0-9]{40}$/u.test(normalizeAddress(value));

const sanitizeFileName = (value) => {
  const base = String(value || "token-image")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!base) return "token-image.png";
  return base.endsWith(".png") ? base : `${base}.png`;
};

const readJsonBodySize = (body) => {
  try {
    if (body == null) return 0;
    if (typeof body === "string") return Buffer.byteLength(body, "utf8");
    if (Buffer.isBuffer(body)) return body.length;
    return Buffer.byteLength(JSON.stringify(body), "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

const toBufferFromUnknown = (value) => {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "binary");
  return null;
};

const parseJsonBody = (body) => {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (typeof body === "object") return body;
  return {};
};

const parseCsv = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const allowedOrigins = (() => {
  const list = parseCsv(DEFAULT_ALLOWED_ORIGINS);
  return list.length ? list : ["*"];
})();

const readRawBodyFromStream = async (req, maxBytes) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += part.length;
      if (total > maxBytes) {
        reject(new Error("RAW_BODY_TOO_LARGE"));
        return;
      }
      chunks.push(part);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (error) => reject(error));
  });

const getClientIp = (req) => {
  const xfwd = req.headers["x-forwarded-for"];
  if (typeof xfwd === "string" && xfwd.length) return xfwd.split(",")[0].trim();
  if (Array.isArray(xfwd) && xfwd.length) return xfwd[0].split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
};

const getHeaderValue = (req, name) => {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
};

const normalizeOrigin = (origin) => {
  const raw = String(origin || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
};

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes("*")) return true;
  return allowedOrigins.some((allowed) => normalizeOrigin(allowed) === normalizeOrigin(origin));
};

const setCors = (req, res) => {
  const origin = String(req.headers?.origin || "").trim();
  if (!origin || allowedOrigins.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    [
      "Content-Type",
      "Authorization",
      "X-File-Name",
      "X-Upload-Challenge-Id",
      "X-Upload-Challenge-Address",
      "X-Upload-Challenge-Signature",
    ].join(", ")
  );
};

const isPngBuffer = (buffer) =>
  Buffer.isBuffer(buffer) &&
  buffer.length >= PNG_SIGNATURE.length &&
  buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);

const buildMultipartBody = ({ fileName, fileBuffer, network = "public" }) => {
  const safeFileName = String(fileName || "token-image.png").replace(/"/g, "");
  const boundary = `----currentx-${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;

  const headFile = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${safeFileName}"\r\n` +
      "Content-Type: image/png\r\n\r\n",
    "utf8"
  );
  const tailFile = Buffer.from("\r\n", "utf8");

  const headNetwork = Buffer.from(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="network"\r\n\r\n' +
      `${network}\r\n`,
    "utf8"
  );

  const headName = Buffer.from(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="name"\r\n\r\n' +
      `${safeFileName}\r\n`,
    "utf8"
  );

  const end = Buffer.from(`--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([headFile, fileBuffer, tailFile, headNetwork, headName, end]);

  return {
    boundary,
    body,
  };
};

const normalizePinataJwt = (value) => {
  let token = String(value || "").trim();
  if (!token) return "";
  token = token.replace(/^bearer\s+/iu, "").trim();
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }
  token = token.replace(/\s+/gu, "");
  return token;
};

const isLikelyJwt = (value) =>
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(String(value || ""));

const buildPinataAuthHeaders = () => {
  const rawJwt = String(
    process.env.PINATA_JWT ||
      process.env.PINATA_JWT_SECRET ||
      process.env.PINATA_API_JWT ||
      ""
  ).trim();
  const jwt = normalizePinataJwt(rawJwt);

  if (!jwt) {
    return {
      headers: null,
      error:
        "IPFS upload is not configured. Set PINATA_JWT with org:files:write scope (Pinata: Files -> Write).",
    };
  }
  if (!isLikelyJwt(jwt)) {
    return {
      headers: null,
      error:
        "PINATA_JWT format looks invalid. Use raw JWT token (no quotes/newlines, no 'Bearer ' prefix).",
    };
  }

  return {
    headers: { Authorization: `Bearer ${jwt}` },
    error: "",
  };
};

const createChallengeId = () => {
  if (typeof randomUUID === "function") return randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
};

const toChallengeKey = (challengeId) => `${CHALLENGE_PREFIX}${challengeId}`;

const parseChallengeRecord = (raw, challengeId) => {
  if (!raw || typeof raw !== "object") return null;
  const issuedAt = Number(raw.issuedAt || 0);
  const expiresAt = Number(raw.expiresAt || 0);
  const uses = Number(raw.uses || 0);
  const record = {
    challengeId: String(challengeId || raw.challengeId || "").trim(),
    address: normalizeAddress(raw.address),
    ip: String(raw.ip || "").trim(),
    origin: String(raw.origin || "").trim(),
    issuedAt: Number.isFinite(issuedAt) && issuedAt > 0 ? issuedAt : 0,
    expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : 0,
    uses: Number.isFinite(uses) && uses >= 0 ? uses : 0,
  };
  if (!record.challengeId || !record.address || !record.issuedAt || !record.expiresAt) {
    return null;
  }
  return record;
};

const pruneFallbackChallenges = () => {
  if (!fallbackChallenges.size) return;
  const now = Date.now();
  for (const [id, record] of fallbackChallenges.entries()) {
    if (!record || Number(record.expiresAt || 0) <= now) {
      fallbackChallenges.delete(id);
    }
  }
};

const saveChallengeRecord = async (record) => {
  const key = toChallengeKey(record.challengeId);
  const payload = {
    challengeId: record.challengeId,
    address: record.address,
    ip: record.ip,
    origin: record.origin,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    uses: 0,
  };
  try {
    await kv.hset(key, payload);
    if (typeof kv.expire === "function") {
      await kv.expire(key, CHALLENGE_TTL_SECONDS + 10);
    }
    return "kv";
  } catch {
    pruneFallbackChallenges();
    fallbackChallenges.set(record.challengeId, payload);
    return "memory";
  }
};

const loadChallengeRecord = async (challengeId) => {
  const key = toChallengeKey(challengeId);
  try {
    const raw = await kv.hgetall(key);
    const parsed = parseChallengeRecord(raw, challengeId);
    if (parsed) return { record: parsed, storage: "kv" };
  } catch {
    // fall back to in-memory store
  }
  pruneFallbackChallenges();
  const fallback = parseChallengeRecord(fallbackChallenges.get(challengeId), challengeId);
  if (!fallback) return { record: null, storage: "none" };
  return { record: fallback, storage: "memory" };
};

const incrementChallengeUsage = async ({ challengeId, storage, record }) => {
  const key = toChallengeKey(challengeId);
  if (storage === "kv") {
    try {
      if (typeof kv.hincrby === "function") {
        const next = Number(await kv.hincrby(key, "uses", 1));
        return Number.isFinite(next) ? next : record.uses + 1;
      }
      const next = record.uses + 1;
      await kv.hset(key, { uses: next });
      return next;
    } catch {
      // fallback to memory increment below
    }
  }

  pruneFallbackChallenges();
  const current = parseChallengeRecord(
    fallbackChallenges.get(challengeId) || record,
    challengeId
  );
  const next = (current?.uses || 0) + 1;
  fallbackChallenges.set(challengeId, {
    ...(current || record),
    uses: next,
  });
  return next;
};

const buildUploadChallengeMessage = ({
  address,
  challengeId,
  issuedAt,
  expiresAt,
  origin,
}) =>
  [
    "CurrentX IPFS Upload Authorization",
    `Address: ${normalizeAddress(address)}`,
    `Challenge ID: ${challengeId}`,
    `Issued At (ms): ${issuedAt}`,
    `Expires At (ms): ${expiresAt}`,
    `Origin: ${String(origin || "unknown").trim() || "unknown"}`,
  ].join("\n");

const getBucketKey = ({ scope, identifier, nowMs = Date.now() }) => {
  const bucket = Math.floor(nowMs / (RATE_WINDOW_SECONDS * 1000));
  return `${scope}:${bucket}:${String(identifier || "unknown").slice(0, 160)}`;
};

const incrementFallbackRate = (bucketKey) => {
  if (fallbackRateBuckets.size > 8000) {
    const stalePrefixes = new Set(
      Array.from(fallbackRateBuckets.keys())
        .filter((key) => !key.includes(`:${Math.floor(Date.now() / (RATE_WINDOW_SECONDS * 1000))}:`))
        .slice(0, 2000)
    );
    stalePrefixes.forEach((key) => fallbackRateBuckets.delete(key));
  }
  const next = Number(fallbackRateBuckets.get(bucketKey) || 0) + 1;
  fallbackRateBuckets.set(bucketKey, next);
  return next;
};

const incrementDistributedRate = async (bucketKey) => {
  const fullKey = `${RATE_PREFIX}${bucketKey}`;
  const count = Number(await kv.incr(fullKey));
  if (count === 1 && typeof kv.expire === "function") {
    await kv.expire(fullKey, RATE_WINDOW_SECONDS + 20);
  }
  return count;
};

const isRateLimited = async ({ scope, identifier, maxRequests, nowMs = Date.now() }) => {
  const bucketKey = getBucketKey({ scope, identifier, nowMs });
  let current = 0;
  try {
    current = await incrementDistributedRate(bucketKey);
  } catch {
    current = incrementFallbackRate(bucketKey);
  }
  return Number.isFinite(current) && current > maxRequests;
};

const extractChallengePayload = (req, body) => ({
  challengeId: String(
    getHeaderValue(req, "x-upload-challenge-id") ||
      body?.challengeId ||
      body?.challenge?.id ||
      ""
  ).trim(),
  challengeAddress: normalizeAddress(
    getHeaderValue(req, "x-upload-challenge-address") ||
      body?.challengeAddress ||
      body?.challenge?.address ||
      ""
  ),
  challengeSignature: String(
    getHeaderValue(req, "x-upload-challenge-signature") ||
      body?.challengeSignature ||
      body?.challenge?.signature ||
      ""
  ).trim(),
});

const verifyUploadChallenge = async ({
  challengeId,
  challengeAddress,
  challengeSignature,
  requestIp,
}) => {
  if (!challengeId || !challengeAddress || !challengeSignature) {
    return {
      ok: false,
      status: 401,
      error: "Missing upload challenge. Request a challenge and sign it with your wallet.",
    };
  }
  if (!isAddress(challengeAddress)) {
    return { ok: false, status: 400, error: "Invalid challenge wallet address." };
  }
  if (challengeId.length > 200) {
    return { ok: false, status: 400, error: "Invalid challenge ID." };
  }

  const loaded = await loadChallengeRecord(challengeId);
  const challenge = loaded.record;
  if (!challenge) {
    return {
      ok: false,
      status: 401,
      error: "Upload challenge not found or expired. Request a new challenge.",
    };
  }

  const now = Date.now();
  if (challenge.expiresAt <= now) {
    return {
      ok: false,
      status: 401,
      error: "Upload challenge expired. Request a new challenge.",
    };
  }
  if (challenge.address !== challengeAddress) {
    return {
      ok: false,
      status: 401,
      error: "Challenge address mismatch. Request a new challenge.",
    };
  }
  if (challenge.ip && requestIp && challenge.ip !== requestIp) {
    return {
      ok: false,
      status: 401,
      error: "Challenge is bound to a different client IP. Request a new challenge.",
    };
  }
  if (challenge.uses >= MAX_CHALLENGE_USES) {
    return {
      ok: false,
      status: 429,
      error: "Challenge usage exceeded. Request a new challenge.",
    };
  }

  const message = buildUploadChallengeMessage(challenge);
  let recovered = "";
  try {
    recovered = normalizeAddress(verifyMessage(message, challengeSignature));
  } catch {
    return { ok: false, status: 401, error: "Invalid challenge signature." };
  }
  if (!recovered || recovered !== challenge.address) {
    return { ok: false, status: 401, error: "Challenge signature does not match address." };
  }

  const nextUses = await incrementChallengeUsage({
    challengeId,
    storage: loaded.storage,
    record: challenge,
  });
  if (nextUses > MAX_CHALLENGE_USES) {
    return {
      ok: false,
      status: 429,
      error: "Challenge usage exceeded. Request a new challenge.",
    };
  }

  return {
    ok: true,
    address: challenge.address,
  };
};

const handleChallengeRequest = async ({ req, res, body, ip }) => {
  const address = normalizeAddress(body?.address || body?.wallet || "");
  if (!isAddress(address)) {
    res.status(400).json({ error: "Missing or invalid wallet address for upload challenge." });
    return;
  }

  const challengeIpLimited = await isRateLimited({
    scope: "challenge-ip",
    identifier: ip,
    maxRequests: MAX_CHALLENGES_PER_IP,
  });
  if (challengeIpLimited) {
    res.status(429).json({ error: "Challenge rate limit exceeded. Retry later." });
    return;
  }
  const challengeAddressLimited = await isRateLimited({
    scope: "challenge-address",
    identifier: address,
    maxRequests: MAX_CHALLENGES_PER_ADDRESS,
  });
  if (challengeAddressLimited) {
    res.status(429).json({ error: "Address challenge rate limit exceeded. Retry later." });
    return;
  }

  const issuedAt = Date.now();
  const expiresAt = issuedAt + CHALLENGE_TTL_SECONDS * 1000;
  const challengeId = createChallengeId();
  const origin = normalizeOrigin(req.headers?.origin || "") || "unknown";

  const record = {
    challengeId,
    address,
    ip,
    origin,
    issuedAt,
    expiresAt,
    uses: 0,
  };
  const storage = await saveChallengeRecord(record);

  res.status(200).json({
    ok: true,
    challengeId,
    address,
    issuedAt,
    expiresAt,
    ttlSeconds: CHALLENGE_TTL_SECONDS,
    storage,
    message: buildUploadChallengeMessage(record),
  });
};

export default async function handler(req, res) {
  try {
    setCors(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const requestOrigin = String(req.headers?.origin || "").trim();
    if (requestOrigin && !isOriginAllowed(requestOrigin)) {
      res.status(403).json({ error: "Origin not allowed for IPFS upload." });
      return;
    }

    const authConfig = buildPinataAuthHeaders();
    if (!authConfig.headers) {
      res.status(503).json({ error: authConfig.error });
      return;
    }
    const authHeaders = authConfig.headers;

    const requestContentType = String(req.headers["content-type"] || "").toLowerCase();
    const isDirectPngUpload = requestContentType.startsWith("image/png");
    const parsedBody = isDirectPngUpload ? {} : parseJsonBody(req.body);

    const action = String(parsedBody?.action || "").trim().toLowerCase();
    if (action === "challenge") {
      const challengeBodySize = readJsonBodySize(req.body);
      if (challengeBodySize > JSON_ACTION_MAX_BODY_BYTES) {
        res.status(413).json({ error: "Challenge payload too large." });
        return;
      }
      const ip = getClientIp(req);
      await handleChallengeRequest({ req, res, body: parsedBody, ip });
      return;
    }

    const ip = getClientIp(req);
    const challengePayload = extractChallengePayload(req, parsedBody);
    const challengeCheck = await verifyUploadChallenge({
      ...challengePayload,
      requestIp: ip,
    });
    if (!challengeCheck.ok) {
      res.status(challengeCheck.status).json({ error: challengeCheck.error });
      return;
    }

    const ipRateLimited = await isRateLimited({
      scope: "upload-ip",
      identifier: ip,
      maxRequests: MAX_UPLOADS_PER_IP,
    });
    if (ipRateLimited) {
      res.status(429).json({ error: "Upload rate limit exceeded. Please retry later." });
      return;
    }
    const walletRateLimited = await isRateLimited({
      scope: "upload-address",
      identifier: challengeCheck.address,
      maxRequests: MAX_UPLOADS_PER_ADDRESS,
    });
    if (walletRateLimited) {
      res.status(429).json({ error: "Wallet upload quota exceeded. Please retry later." });
      return;
    }

    let imageBuffer = null;
    let fileName = "token-image.png";

    if (isDirectPngUpload) {
      fileName = sanitizeFileName(req.headers["x-file-name"] || "token-image.png");
      imageBuffer = toBufferFromUnknown(req.body);
      if (!imageBuffer) {
        if (typeof req.on !== "function") {
          res.status(400).json({ error: "Missing binary PNG payload." });
          return;
        }
        try {
          imageBuffer = await readRawBodyFromStream(req, MAX_IMAGE_BYTES + 1);
        } catch (error) {
          if (String(error?.message || "") === "RAW_BODY_TOO_LARGE") {
            res.status(413).json({ error: `PNG file is too large. Max size is ${MAX_IMAGE_LABEL}.` });
            return;
          }
          throw error;
        }
      }
    } else {
      const rawBodySize = readJsonBodySize(req.body);
      if (rawBodySize > MAX_BODY_BYTES) {
        res.status(413).json({ error: "Payload too large" });
        return;
      }

      const dataBase64 = String(parsedBody?.dataBase64 || "").trim();
      fileName = sanitizeFileName(parsedBody?.fileName || "token-image.png");
      const contentType = String(parsedBody?.contentType || "").trim().toLowerCase();

      if (!dataBase64) {
        res.status(400).json({ error: "Missing dataBase64" });
        return;
      }
      if (dataBase64.length > MAX_BASE64_CHARS) {
        res.status(413).json({ error: `PNG file is too large. Max size is ${MAX_IMAGE_LABEL}.` });
        return;
      }
      if (contentType && contentType !== "image/png") {
        res.status(400).json({ error: "Only image/png is supported." });
        return;
      }
      if (!/^[a-zA-Z0-9+/=]+$/u.test(dataBase64)) {
        res.status(400).json({ error: "Invalid base64 payload." });
        return;
      }

      try {
        imageBuffer = Buffer.from(dataBase64, "base64");
      } catch {
        res.status(400).json({ error: "Invalid base64 payload." });
        return;
      }
    }

    if (!imageBuffer?.length) {
      res.status(400).json({ error: "Empty image payload." });
      return;
    }
    if (imageBuffer.length > MAX_IMAGE_BYTES) {
      res.status(413).json({ error: `PNG file is too large. Max size is ${MAX_IMAGE_LABEL}.` });
      return;
    }
    if (!isPngBuffer(imageBuffer)) {
      res.status(400).json({ error: "Only PNG files are supported." });
      return;
    }

    const multipart = buildMultipartBody({
      fileName,
      fileBuffer: imageBuffer,
      network: "public",
    });

    const upstream = await fetch(PINATA_UPLOAD_URL, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": `multipart/form-data; boundary=${multipart.boundary}`,
      },
      body: multipart.body,
    });

    const text = await upstream.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }

    if (!upstream.ok) {
      const upstreamError =
        json?.error?.reason ||
        json?.error?.message ||
        json?.error?.details ||
        json?.error ||
        json?.message ||
        "IPFS upstream error.";
      const normalizedError = String(upstreamError || "").trim();
      if (normalizedError.includes("NO_SCOPES_FOUND")) {
        res.status(502).json({
          error:
            "Pinata JWT missing required scope. Enable Files -> Write (org:files:write) for this API key.",
          status: upstream.status,
          upstream: normalizedError,
        });
        return;
      }
      res.status(502).json({
        error: normalizedError || "IPFS upstream error.",
        status: upstream.status,
      });
      return;
    }

    const cid = String(json?.data?.cid || json?.IpfsHash || "").trim();
    if (!cid) {
      res.status(502).json({ error: "Invalid IPFS response." });
      return;
    }

    const ipfsUri = `ipfs://${cid}`;
    const gatewayUrl = `${DEFAULT_IPFS_GATEWAY}${cid}`;
    res.status(200).json({
      ok: true,
      cid,
      ipfsUri,
      gatewayUrl,
      fileName,
      size: imageBuffer.length,
      uploader: challengeCheck.address,
    });
  } catch (error) {
    const message = String(error?.message || "").trim();
    const lower = message.toLowerCase();
    if (lower.includes("fetch failed") || lower.includes("network") || lower.includes("timeout")) {
      res.status(502).json({ error: `Cannot reach Pinata upload service. ${message || ""}`.trim() });
      return;
    }
    if (
      lower.includes("invalid header") ||
      lower.includes("headers.append") ||
      lower.includes("invalid header value")
    ) {
      res.status(503).json({
        error:
          "PINATA_JWT is malformed. Use raw JWT (no quotes/newlines, no 'Bearer ' prefix).",
      });
      return;
    }
    res.status(500).json({
      error: message || "IPFS upload failed.",
      hint: "Check PINATA_JWT scope org:files:write and Vercel function logs.",
    });
  }
}

