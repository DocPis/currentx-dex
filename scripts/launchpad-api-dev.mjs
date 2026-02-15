import http from "node:http";
import { URL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import tokensHandler from "../api/launchpad/tokens.js";
import activityHandler from "../api/launchpad/activity.js";
import tokenDetailHandler from "../api/launchpad/tokens/[address].js";
import tokenCandlesHandler from "../api/launchpad/tokens/[address]/candles.js";
import tokenActivityHandler from "../api/launchpad/tokens/[address]/activity.js";

const PORT = Number(process.env.LAUNCHPAD_API_PORT || 3000);
const HOST = process.env.LAUNCHPAD_API_HOST || "127.0.0.1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const parseEnvLine = (line) => {
  const clean = String(line || "").trim();
  if (!clean || clean.startsWith("#")) return null;
  const eq = clean.indexOf("=");
  if (eq <= 0) return null;
  const key = clean.slice(0, eq).trim();
  if (!key) return null;
  let value = clean.slice(eq + 1).trim();
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
};

const loadEnvFile = (filename) => {
  const full = path.join(ROOT_DIR, filename);
  if (!fs.existsSync(full)) return;
  const content = fs.readFileSync(full, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed) return;
    if (process.env[parsed.key] !== undefined) return;
    process.env[parsed.key] = parsed.value;
  });
};

loadEnvFile(".env");
loadEnvFile(".env.local");

const parseRoute = (pathname = "") => {
  if (pathname === "/api/launchpad/tokens") return { type: "tokens" };
  if (pathname === "/api/launchpad/activity") return { type: "activity" };
  if (pathname === "/api/launchpad/ws") return { type: "ws" };

  const parts = String(pathname || "")
    .split("/")
    .filter(Boolean);
  if (parts.length === 4 && parts[0] === "api" && parts[1] === "launchpad" && parts[2] === "tokens") {
    return { type: "token-detail", address: parts[3] };
  }
  if (parts.length === 5 && parts[0] === "api" && parts[1] === "launchpad" && parts[2] === "tokens") {
    if (parts[4] === "candles") return { type: "token-candles", address: parts[3] };
    if (parts[4] === "activity") return { type: "token-activity", address: parts[3] };
  }
  return null;
};

const createResShim = (nodeRes) => {
  let statusCode = 200;
  const headers = {};
  let sent = false;

  const flush = (payload = "") => {
    if (sent) return;
    sent = true;
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
    nodeRes.writeHead(statusCode, headers);
    nodeRes.end(body);
  };

  return {
    status(code) {
      statusCode = Number(code) || 200;
      return this;
    },
    setHeader(key, value) {
      headers[String(key)] = value;
      return this;
    },
    send(payload) {
      flush(payload);
      return this;
    },
    json(payload) {
      headers["Content-Type"] = "application/json";
      flush(JSON.stringify(payload));
      return this;
    },
    end(payload = "") {
      if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "text/plain; charset=utf-8";
      }
      flush(typeof payload === "string" ? payload : String(payload || ""));
      return this;
    },
  };
};

const createReqShim = (nodeReq, query) => ({
  method: nodeReq.method,
  headers: nodeReq.headers || {},
  query,
  socket: nodeReq.socket,
});

const dispatch = async (route, req, res) => {
  if (!route) {
    res.status(404).setHeader("Content-Type", "application/json").send({ error: "Not found" });
    return;
  }
  if (route.type === "ws") {
    res.status(501).setHeader("Content-Type", "application/json").send({
      error: "WebSocket endpoint is not available in local dev server.",
    });
    return;
  }
  if (route.type === "tokens") {
    await tokensHandler(req, res);
    return;
  }
  if (route.type === "activity") {
    await activityHandler(req, res);
    return;
  }
  if (route.type === "token-detail") {
    req.query.address = route.address;
    await tokenDetailHandler(req, res);
    return;
  }
  if (route.type === "token-candles") {
    req.query.address = route.address;
    await tokenCandlesHandler(req, res);
    return;
  }
  if (route.type === "token-activity") {
    req.query.address = route.address;
    await tokenActivityHandler(req, res);
    return;
  }

  res.status(404).setHeader("Content-Type", "application/json").send({ error: "Not found" });
};

const server = http.createServer(async (nodeReq, nodeRes) => {
  try {
    const requestUrl = new URL(nodeReq.url || "/", `http://${nodeReq.headers.host || `${HOST}:${PORT}`}`);
    const query = Object.fromEntries(requestUrl.searchParams.entries());
    const route = parseRoute(requestUrl.pathname);
    const req = createReqShim(nodeReq, query);
    const res = createResShim(nodeRes);
    await dispatch(route, req, res);
  } catch (error) {
    nodeRes.writeHead(500, { "Content-Type": "application/json" });
    nodeRes.end(JSON.stringify({ error: String(error?.message || "Server error") }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[launchpad-api-dev] listening on http://${HOST}:${PORT}`);
});
