import { kv } from "@vercel/kv";
// In-memory deduplication fallback (KV temporarily disabled)
const submittedWallets =
  globalThis.__cxSubmittedWallets || (globalThis.__cxSubmittedWallets = new Set());

const normalizeWallet = (wallet) =>
  (wallet || "").toString().trim().toLowerCase();

const MAX_BODY_BYTES = 20_000; // guardrail against oversized payloads
const MAX_FIELD_LENGTH = 256;
const MAX_WALLET_LENGTH = 120;
const RATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_REQUESTS_PER_IP = 30;
const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;

// KV opt-in: use if creds are present; fallback to in-memory on error.
const kvEnabled = Boolean(
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
);
let kvAvailable = kvEnabled;

const sanitizeString = (val, max) => {
  if (typeof val !== "string") return "";
  return val.trim().slice(0, max);
};

const isDuplicateWallet = async (wallet) => {
  if (!wallet) return false;
  if (kvAvailable) {
    try {
      const existing = await kv.get(wallet);
      if (existing) return true;
    } catch (e) {
      const msg = (e?.message || "").toLowerCase();
      if (msg.includes("payment required")) kvAvailable = false;
      console.error("KV get error", e?.message || e);
    }
  }
  return submittedWallets.has(wallet);
};

const storeWallet = async ({ wallet }) => {
  if (!wallet) return { duplicate: false };
  if (kvAvailable) {
    try {
      const result = await kv.set(
        wallet,
        { wallet, ts: Date.now() },
        { nx: true }
      );
      if (result === null) return { duplicate: true };
      return { duplicate: false };
    } catch (e) {
      const msg = (e?.message || "").toLowerCase();
      if (msg.includes("payment required")) kvAvailable = false;
      console.error("KV set error", e?.message || e);
    }
  }
  submittedWallets.add(wallet);
  return { duplicate: false };
};

const rateBuckets =
  globalThis.__cxRateBuckets || (globalThis.__cxRateBuckets = new Map());

const getClientIp = (req) => {
  const xfwd = req.headers["x-forwarded-for"];
  if (typeof xfwd === "string" && xfwd.length) {
    return xfwd.split(",")[0].trim();
  }
  if (Array.isArray(xfwd) && xfwd.length) {
    return xfwd[0].split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
};

const isRateLimited = (ip) => {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS_PER_IP) return true;
  return false;
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Rate limit exceeded. Please retry later." });
    return;
  }

  try {
    const rawSize = Buffer.byteLength(
      JSON.stringify(req.body || {}),
      "utf8"
    );
    if (rawSize > MAX_BODY_BYTES) {
      res.status(413).json({ error: "Payload too large" });
      return;
    }

    const { wallet, discord, telegram, source, ts } = req.body || {};
    const rawWallet = (wallet || "").toString().trim();
    const normalizedWallet = normalizeWallet(rawWallet).slice(0, MAX_WALLET_LENGTH);
    const safeDiscord = sanitizeString(discord, MAX_FIELD_LENGTH);
    const safeTelegram = sanitizeString(telegram, MAX_FIELD_LENGTH);
    const safeSource = sanitizeString(source, MAX_FIELD_LENGTH);

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL || "";
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN || "";
    const telegramChatId =
      process.env.TELEGRAM_WHITELIST_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "";

    if (!rawWallet) {
      res.status(400).json({ error: "Missing wallet" });
      return;
    }
    if (!WALLET_REGEX.test(rawWallet)) {
      res.status(400).json({ error: "Invalid wallet address" });
      return;
    }
    if (!safeDiscord && !safeTelegram) {
      res.status(400).json({ error: "Need at least Discord or Telegram" });
      return;
    }

    const alreadySubmitted = await isDuplicateWallet(normalizedWallet);
    if (alreadySubmitted) {
      res
        .status(409)
        .json({ error: "This wallet is already registered for the presale." });
      return;
    }

    const storeResult = await storeWallet({
      wallet: normalizedWallet,
      discord: safeDiscord,
      telegram: safeTelegram,
      source: safeSource,
      ts,
    });
    if (storeResult?.duplicate) {
      res
        .status(409)
        .json({ error: "This wallet is already registered for the presale." });
      return;
    }

    console.log("Presale lead", {
      wallet: normalizedWallet,
      discord: safeDiscord || null,
      telegram: safeTelegram || null,
      source: safeSource || "currentx-presale",
      ts: ts || Date.now(),
    });

    // Optional: forward to Discord webhook if configured
    if (webhookUrl) {
      try {
        const content = [
          "**New CurrentX presale lead**",
          `Wallet: ${normalizedWallet}`,
          safeDiscord ? `Discord: ${safeDiscord}` : "Discord: (none)",
          safeTelegram ? `Telegram: ${safeTelegram}` : "Telegram: (none)",
          `Source: ${safeSource || "currentx-presale"}`,
          `Timestamp: ${new Date(ts || Date.now()).toISOString()}`,
        ].join("\n");
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            allowed_mentions: { parse: [] },
          }),
        });
      } catch (e) {
        console.error("Discord webhook error", e);
      }
    }

    // Optional: forward to Telegram if configured
    if (telegramToken && telegramChatId) {
      const tgContent = [
        "New CurrentX whitelist submission",
        `Wallet: ${normalizedWallet}`,
        safeDiscord ? `Discord: ${safeDiscord}` : "Discord: (none)",
        safeTelegram ? `Telegram: ${safeTelegram}` : "Telegram: (none)",
        `Source: ${safeSource || "currentx-presale"}`,
        `Timestamp: ${new Date(ts || Date.now()).toISOString()}`,
      ].join("\n");
      try {
        await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: telegramChatId,
            text: tgContent,
            disable_web_page_preview: true,
          }),
        });
      } catch (e) {
        console.error("Telegram webhook error", e);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
