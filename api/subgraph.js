const ALLOWED_HOST_SUFFIXES = [
  ".thegraph.com",
  ".goldsky.com",
];

const MAX_BODY_BYTES = 200_000;

const isAllowedHost = (hostname) =>
  ALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));

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

  const targetRaw = req.query?.url;
  if (!targetRaw) {
    res.status(400).json({ error: "Missing url query param" });
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(decodeURIComponent(String(targetRaw)));
  } catch {
    res.status(400).json({ error: "Invalid url" });
    return;
  }

  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    res.status(400).json({ error: "Invalid url protocol" });
    return;
  }

  if (!isAllowedHost(targetUrl.hostname)) {
    res.status(403).json({ error: "Host not allowed" });
    return;
  }

  const bodySize = Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
  if (bodySize > MAX_BODY_BYTES) {
    res.status(413).json({ error: "Payload too large" });
    return;
  }

  try {
    const upstream = await fetch(targetUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body || {}),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", "application/json");
    res.send(text);
  } catch (err) {
    res.status(502).json({ error: err?.message || "Upstream error" });
  }
}
