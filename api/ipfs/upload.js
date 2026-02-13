const MAX_IMAGE_BYTES = 256 * 1024; // 256 KB
const MAX_BODY_BYTES = 420_000; // base64 payload guardrail
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_IP = 20;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PINATA_UPLOAD_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const DEFAULT_IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";

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

const getClientIp = (req) => {
  const xfwd = req.headers["x-forwarded-for"];
  if (typeof xfwd === "string" && xfwd.length) return xfwd.split(",")[0].trim();
  if (Array.isArray(xfwd) && xfwd.length) return xfwd[0].split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
};

const rateBuckets =
  globalThis.__cxIpfsRateBuckets || (globalThis.__cxIpfsRateBuckets = new Map());

const isRateLimited = (ip) => {
  if (!ip) return false;
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_IP;
};

const isPngBuffer = (buffer) =>
  Buffer.isBuffer(buffer) &&
  buffer.length >= PNG_SIGNATURE.length &&
  buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);

const buildPinataAuthHeaders = () => {
  const jwt = String(process.env.PINATA_JWT || "").trim();
  if (jwt) return { Authorization: `Bearer ${jwt}` };

  const key = String(process.env.PINATA_API_KEY || "").trim();
  const secret = String(process.env.PINATA_SECRET_API_KEY || "").trim();
  if (key && secret) {
    return {
      pinata_api_key: key,
      pinata_secret_api_key: secret,
    };
  }
  return null;
};

const setCors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Rate limit exceeded. Please retry later." });
    return;
  }

  const authHeaders = buildPinataAuthHeaders();
  if (!authHeaders) {
    res.status(503).json({ error: "IPFS upload is not configured. Set PINATA_JWT (or PINATA_API_KEY + PINATA_SECRET_API_KEY)." });
    return;
  }

  const rawBodySize = Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
  if (rawBodySize > MAX_BODY_BYTES) {
    res.status(413).json({ error: "Payload too large" });
    return;
  }

  const body = parseJsonBody(req.body);
  const dataBase64 = String(body?.dataBase64 || "").trim();
  const fileName = sanitizeFileName(body?.fileName || "token-image.png");
  const contentType = String(body?.contentType || "").trim().toLowerCase();

  if (!dataBase64) {
    res.status(400).json({ error: "Missing dataBase64" });
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

  let imageBuffer;
  try {
    imageBuffer = Buffer.from(dataBase64, "base64");
  } catch {
    res.status(400).json({ error: "Invalid base64 payload." });
    return;
  }

  if (!imageBuffer?.length) {
    res.status(400).json({ error: "Empty image payload." });
    return;
  }
  if (imageBuffer.length > MAX_IMAGE_BYTES) {
    res.status(413).json({ error: "PNG file is too large. Max size is 256 KB." });
    return;
  }
  if (!isPngBuffer(imageBuffer)) {
    res.status(400).json({ error: "Only PNG files are supported." });
    return;
  }

  try {
    const form = new FormData();
    const blob = new Blob([imageBuffer], { type: "image/png" });
    form.append("file", blob, fileName);
    form.append(
      "pinataMetadata",
      JSON.stringify({
        name: fileName,
        keyvalues: {
          app: "currentx-launchpad",
        },
      })
    );
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

    const upstream = await fetch(PINATA_UPLOAD_URL, {
      method: "POST",
      headers: {
        ...authHeaders,
      },
      body: form,
    });

    const text = await upstream.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }

    if (!upstream.ok) {
      res.status(502).json({
        error: json?.error?.reason || json?.error || "IPFS upstream error.",
        status: upstream.status,
      });
      return;
    }

    const cid = String(json?.IpfsHash || "").trim();
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
    });
  } catch (error) {
    res.status(500).json({ error: error?.message || "IPFS upload failed." });
  }
}
