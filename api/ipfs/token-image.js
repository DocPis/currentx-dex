import { Buffer } from "node:buffer";
import { kv } from "@vercel/kv";
import { getAddress, isAddress } from "ethers";

const IS_PROD = process.env.NODE_ENV === "production";
const KV_ENABLED = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const ALLOW_INMEMORY = !IS_PROD;

const TOKEN_IMAGE_KEY_PREFIX = "launchpad:token-image:v1";
const MAX_BODY_BYTES = 200_000;
const MAX_IMAGE_LENGTH = 4096;
const MAX_BATCH_TOKENS = 250;
const MAX_SOURCE_LENGTH = 64;
const MAX_TX_HASH_LENGTH = 100;

const inMemoryRegistry =
  globalThis.__cxTokenImageRegistry || (globalThis.__cxTokenImageRegistry = new Map());

const setCors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

const readJsonBodySize = (body) => {
  try {
    if (body == null) return 0;
    if (typeof body === "string") return Buffer.byteLength(body, "utf8");
    return Buffer.byteLength(JSON.stringify(body), "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
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

const sanitizeString = (value, maxLength = 256) =>
  String(value || "")
    .trim()
    .slice(0, maxLength);

const normalizeTokenAddress = (value) => {
  const raw = String(value || "").trim();
  if (!isAddress(raw)) return "";
  try {
    return getAddress(raw).toLowerCase();
  } catch {
    return "";
  }
};

const isImageLikeValue = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (/^ipfs:\/\//iu.test(raw)) return true;
  if (/^https?:\/\//iu.test(raw)) return true;
  if (/^data:image\//iu.test(raw)) return true;
  return false;
};

const normalizeImageValue = (value) => {
  const raw = sanitizeString(value, MAX_IMAGE_LENGTH);
  if (!isImageLikeValue(raw)) return "";
  return raw;
};

const getTokenImageKey = (tokenLower) => `${TOKEN_IMAGE_KEY_PREFIX}:${tokenLower}`;

const assertStoreAvailable = () => {
  if (KV_ENABLED) return;
  if (ALLOW_INMEMORY) return;
  throw new Error("KV not configured for token image registry.");
};

const readEntry = async (tokenLower) => {
  if (!tokenLower) return null;
  if (KV_ENABLED) return kv.get(getTokenImageKey(tokenLower));
  if (ALLOW_INMEMORY) return inMemoryRegistry.get(tokenLower) || null;
  return null;
};

const readEntries = async (tokenLowers) => {
  if (!Array.isArray(tokenLowers) || !tokenLowers.length) return [];
  if (KV_ENABLED) {
    const pipeline = kv.pipeline();
    tokenLowers.forEach((tokenLower) => pipeline.get(getTokenImageKey(tokenLower)));
    return pipeline.exec();
  }
  if (ALLOW_INMEMORY) {
    return tokenLowers.map((tokenLower) => inMemoryRegistry.get(tokenLower) || null);
  }
  return [];
};

const writeEntry = async (tokenLower, payload) => {
  if (!tokenLower || !payload) return;
  if (KV_ENABLED) {
    await kv.set(getTokenImageKey(tokenLower), payload);
    return;
  }
  if (ALLOW_INMEMORY) {
    inMemoryRegistry.set(tokenLower, payload);
  }
};

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    try {
      assertStoreAvailable();
      const tokenLower = normalizeTokenAddress(req.query?.tokenAddress || req.query?.token);
      if (!tokenLower) {
        res.status(400).json({ error: "Missing or invalid tokenAddress." });
        return;
      }
      const entry = await readEntry(tokenLower);
      const image = normalizeImageValue(entry?.image || "");
      if (!image) {
        res.status(404).json({ error: "Token image mapping not found." });
        return;
      }
      res.status(200).json({
        ok: true,
        tokenAddress: String(entry?.tokenAddress || getAddress(tokenLower)),
        image,
        source: String(entry?.source || ""),
        deployer: String(entry?.deployer || ""),
        txHash: String(entry?.txHash || ""),
        createdAt: Number(entry?.createdAt || 0),
        updatedAt: Number(entry?.updatedAt || 0),
      });
      return;
    } catch (error) {
      res.status(503).json({ error: error?.message || "Token image registry unavailable." });
      return;
    }
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    assertStoreAvailable();

    const rawBodySize = readJsonBodySize(req.body);
    if (rawBodySize > MAX_BODY_BYTES) {
      res.status(413).json({ error: "Payload too large" });
      return;
    }
    const body = parseJsonBody(req.body);

    if (Array.isArray(body?.tokens)) {
      const tokens = Array.from(
        new Set(
          body.tokens
            .map((value) => normalizeTokenAddress(value))
            .filter(Boolean)
        )
      ).slice(0, MAX_BATCH_TOKENS);
      const rows = await readEntries(tokens);
      const images = {};
      tokens.forEach((tokenLower, idx) => {
        const image = normalizeImageValue(rows?.[idx]?.image || "");
        if (image) images[tokenLower] = image;
      });
      res.status(200).json({ ok: true, images });
      return;
    }

    const tokenLower = normalizeTokenAddress(body?.tokenAddress || body?.token);
    if (!tokenLower) {
      res.status(400).json({ error: "Missing or invalid tokenAddress." });
      return;
    }
    const image = normalizeImageValue(body?.image || body?.ipfsUri || body?.gatewayUrl);
    if (!image) {
      res.status(400).json({ error: "Missing or invalid image URI." });
      return;
    }

    const source = sanitizeString(body?.source || "launchpad", MAX_SOURCE_LENGTH) || "launchpad";
    const deployer = normalizeTokenAddress(body?.deployer || body?.wallet || "");
    const txHash = sanitizeString(body?.txHash || "", MAX_TX_HASH_LENGTH);
    const overwrite = body?.overwrite === true;
    const now = Date.now();
    const existing = await readEntry(tokenLower);
    const existingImage = normalizeImageValue(existing?.image || "");

    if (existingImage && existingImage !== image && !overwrite) {
      res.status(409).json({
        error: "Token image mapping already exists and is immutable.",
        tokenAddress: String(existing?.tokenAddress || getAddress(tokenLower)),
        image: existingImage,
      });
      return;
    }

    const payload = {
      tokenAddress: String(existing?.tokenAddress || getAddress(tokenLower)),
      tokenAddressLower: tokenLower,
      image,
      source,
      deployer: String(deployer || existing?.deployer || ""),
      txHash: String(txHash || existing?.txHash || ""),
      createdAt: Number(existing?.createdAt || now),
      updatedAt: now,
    };
    await writeEntry(tokenLower, payload);

    res.status(existing ? 200 : 201).json({
      ok: true,
      tokenAddress: payload.tokenAddress,
      image: payload.image,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ error: error?.message || "Server error" });
  }
}
