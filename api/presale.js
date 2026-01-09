const submittedWallets =
  globalThis.__cxSubmittedWallets || (globalThis.__cxSubmittedWallets = new Set());

const normalizeWallet = (wallet) =>
  (wallet || "").toString().trim().toLowerCase();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { wallet, discord, telegram, source, ts } = req.body || {};
    const normalizedWallet = normalizeWallet(wallet);
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL || "";
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN || "";
    const telegramChatId =
      process.env.TELEGRAM_WHITELIST_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "";

    if (!normalizedWallet) {
      res.status(400).json({ error: "Missing wallet" });
      return;
    }
    if (!discord && !telegram) {
      res.status(400).json({ error: "Need at least Discord or Telegram" });
      return;
    }

    if (submittedWallets.has(normalizedWallet)) {
      res
        .status(409)
        .json({ error: "This wallet is already registered for the presale." });
      return;
    }
    submittedWallets.add(normalizedWallet);

    console.log("Presale lead", {
      wallet: normalizedWallet,
      discord: discord || null,
      telegram: telegram || null,
      source: source || "currentx-presale",
      ts: ts || Date.now(),
    });

    // Optional: forward to Discord webhook if configured
    if (webhookUrl) {
      try {
        const content = [
          "**New CurrentX presale lead**",
          `Wallet: ${normalizedWallet}`,
          discord ? `Discord: ${discord}` : "Discord: (none)",
          telegram ? `Telegram: ${telegram}` : "Telegram: (none)",
          `Source: ${source || "currentx-presale"}`,
          `Timestamp: ${new Date(ts || Date.now()).toISOString()}`,
        ].join("\n");
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
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
        discord ? `Discord: ${discord}` : "Discord: (none)",
        telegram ? `Telegram: ${telegram}` : "Telegram: (none)",
        `Source: ${source || "currentx-presale"}`,
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
