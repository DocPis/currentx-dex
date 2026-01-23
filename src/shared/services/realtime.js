// src/shared/services/realtime.js
// Lightweight MegaETH realtime client (stateChanges + miniBlocks) with auto-reconnect.
import { RPC_URL } from "../config/web3";
import { getActiveNetworkConfig } from "../config/networks";

const DEFAULT_WS_FALLBACK = "wss://mainnet.megaeth.com/ws";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const deriveWsCandidates = () => {
  const active = getActiveNetworkConfig();
  const list = [];
  const push = (v) => {
    if (v && !list.includes(v)) list.push(v);
  };

  // 1) Per-network wsUrls from preset
  (active?.wsUrls || []).forEach(push);

  // 2) Env overrides (legacy)
  const envWs =
    (typeof import.meta !== "undefined" &&
      import.meta.env &&
      (import.meta.env.VITE_REALTIME_RPC_WS ||
        import.meta.env.VITE_REALTIME_WS ||
        import.meta.env.VITE_MEGAETH_REALTIME_WS ||
        import.meta.env.VITE_TESTNET_WS_URL ||
        import.meta.env.VITE_TESTNET_WS_URLS ||
        import.meta.env.VITE_WS_URL ||
        import.meta.env.VITE_WS_URLS)) ||
    "";
  envWs
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach(push);

  // 3) Derive from current RPC_URL
  if (RPC_URL && typeof RPC_URL === "string") {
    const rpcWs = RPC_URL.replace(/^http/i, "ws");
    push(rpcWs);
    if (rpcWs.endsWith("/rpc")) {
      push(rpcWs.replace(/\/rpc$/, "/ws"));
    }
  }

  // 4) Fallback
  push(DEFAULT_WS_FALLBACK);
  return list;
};

const normalizeAddress = (addr) =>
  typeof addr === "string" ? addr.toLowerCase() : "";

class RealtimeClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this.backoffMs = 1200;
    this.reconnectTimer = null;

    this.nextId = 1;
    this.pendingSubRequests = new Map(); // id -> { type }
    this.subscriptionTypes = new Map(); // subId -> type

    this.stateChangeListeners = new Set();
    this.miniBlockListeners = new Set();
    this.statusListeners = new Set();

    this.addressRefCounts = new Map();
    this.stateChangeSubId = null;
    this.miniBlockSubId = null;
    this.stateChangeDirty = false;

    this.wsCandidates = deriveWsCandidates();
    this.wsIndex = 0;
  }

  getStatus() {
    if (this.connected) return "connected";
    if (this.connecting) return "connecting";
    return "disconnected";
  }

  emitStatus() {
    const status = this.getStatus();
    this.statusListeners.forEach((cb) => {
      try {
        cb(status);
      } catch {
        // ignore listener errors
      }
    });
  }

  getCurrentWsUrl() {
    if (!this.wsCandidates.length) return null;
    return this.wsCandidates[this.wsIndex % this.wsCandidates.length];
  }

  bumpWsCandidate() {
    this.wsIndex = (this.wsIndex + 1) % (this.wsCandidates.length || 1);
  }

  connect() {
    if (this.connected || this.connecting) return;
    if (typeof window === "undefined" || typeof WebSocket === "undefined") {
      return;
    }

    const url = this.getCurrentWsUrl();
    if (!url) {
      console.warn("[realtime] No websocket URL available");
      return;
    }

    this.connecting = true;
    this.emitStatus();
    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.warn("[realtime] WebSocket init failed", err?.message || err);
      this.connecting = false;
      this.scheduleReconnect(true);
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.connecting = false;
      this.backoffMs = 1200;
      this.stateChangeDirty = true;
      this.emitStatus();
      this.resubscribeAll();
    };

    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onerror = (err) => {
      console.warn("[realtime] socket error", err?.message || err);
      this.cleanupSocket();
      this.scheduleReconnect(true);
    };
    this.ws.onclose = () => {
      this.cleanupSocket();
      this.scheduleReconnect(true);
    };
  }

  cleanupSocket() {
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this.stateChangeSubId = null;
    this.miniBlockSubId = null;
    this.subscriptionTypes.clear();
    this.pendingSubRequests.clear();
    this.emitStatus();
  }

  scheduleReconnect(advanceUrl = false) {
    if (this.reconnectTimer) return;
    if (advanceUrl) this.bumpWsCandidate();
    const timeout = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.8, 20000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, timeout);
  }

  resubscribeAll() {
    if (!this.connected || !this.ws) return;
    // miniBlocks
    if (this.miniBlockListeners.size && !this.miniBlockSubId) {
      this.subscribe("miniBlocks");
    }
    // stateChanges
    this.syncStateChangeSubscription();
  }

  send(payload) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      console.warn("[realtime] send failed", err?.message || err);
      return false;
    }
  }

  subscribe(type, params = []) {
    if (!this.connected || !this.ws) {
      this.connect();
      return;
    }
    const id = this.nextId++;
    this.pendingSubRequests.set(id, { type });
    this.send({
      jsonrpc: "2.0",
      method: "eth_subscribe",
      params: [type, ...params],
      id,
    });
  }

  unsubscribe(subId) {
    if (!subId || !this.connected || !this.ws) return;
    const id = this.nextId++;
    this.send({
      jsonrpc: "2.0",
      method: "eth_unsubscribe",
      params: [subId],
      id,
    });
    this.subscriptionTypes.delete(subId);
  }

  syncStateChangeSubscription() {
    if (!this.connected || !this.ws) {
      this.stateChangeDirty = true;
      this.connect();
      return;
    }
    const addresses = Array.from(this.addressRefCounts.entries())
      .filter(([, count]) => count > 0)
      .map(([addr]) => addr);

    // If no addresses, drop subscription.
    if (!addresses.length) {
      if (this.stateChangeSubId) {
        this.unsubscribe(this.stateChangeSubId);
        this.stateChangeSubId = null;
      }
      return;
    }

    this.stateChangeDirty = false;
    if (this.stateChangeSubId) {
      this.unsubscribe(this.stateChangeSubId);
      this.stateChangeSubId = null;
    }
    const id = this.nextId++;
    this.pendingSubRequests.set(id, { type: "stateChanges" });
    this.send({
      jsonrpc: "2.0",
      method: "eth_subscribe",
      params: ["stateChanges", addresses],
      id,
    });
  }

  handleMessage(event) {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!data) return;

    // Subscription ack
    if (data.id && this.pendingSubRequests.has(data.id)) {
      const { type } = this.pendingSubRequests.get(data.id);
      this.pendingSubRequests.delete(data.id);
      if (data.result) {
        const subId = data.result;
        this.subscriptionTypes.set(subId, type);
        if (type === "stateChanges") this.stateChangeSubId = subId;
        if (type === "miniBlocks") this.miniBlockSubId = subId;
      } else if (data.error) {
        const msg = data.error?.message || data.error || "";
        const duplicate =
          typeof msg === "string" &&
          (msg.toLowerCase().includes("duplicate subscription") ||
            msg.toLowerCase().includes("already subscribed"));
        if (!duplicate) {
          console.warn(`[realtime] ${type} subscribe error`, msg);
        }
        if (type === "stateChanges") this.stateChangeDirty = true;
      }
      return;
    }

    // Notifications
    if (data.method === "eth_subscription" && data.params) {
      const subId = data.params.subscription;
      const type = this.subscriptionTypes.get(subId);
      const result = data.params.result;
      if (type === "stateChanges") {
        this.stateChangeListeners.forEach((cb) => {
          try {
            cb(result);
          } catch (err) {
            console.error("[realtime] stateChanges listener error", err);
          }
        });
      } else if (type === "miniBlocks") {
        this.miniBlockListeners.forEach((cb) => {
          try {
            cb(result);
          } catch (err) {
            console.error("[realtime] miniBlocks listener error", err);
          }
        });
      }
    }
  }

  addStateChangeListener(addresses, callback) {
    if (!callback || typeof callback !== "function") return () => {};
    const normalized = (addresses || [])
      .map(normalizeAddress)
      .filter(Boolean);
    normalized.forEach((addr) => {
      const prev = this.addressRefCounts.get(addr) || 0;
      this.addressRefCounts.set(addr, prev + 1);
    });
    this.stateChangeListeners.add(callback);
    this.stateChangeDirty = true;
    this.syncStateChangeSubscription();
    this.connect();
    return () => {
      this.stateChangeListeners.delete(callback);
      normalized.forEach((addr) => {
        const prev = this.addressRefCounts.get(addr) || 0;
        if (prev <= 1) {
          this.addressRefCounts.delete(addr);
        } else {
          this.addressRefCounts.set(addr, prev - 1);
        }
      });
      this.stateChangeDirty = true;
      this.syncStateChangeSubscription();
    };
  }

  addMiniBlockListener(callback) {
    if (!callback || typeof callback !== "function") return () => {};
    this.miniBlockListeners.add(callback);
    if (!this.miniBlockSubId && this.connected) {
      this.subscribe("miniBlocks");
    } else {
      this.connect();
    }
    return () => {
      this.miniBlockListeners.delete(callback);
      if (!this.miniBlockListeners.size && this.miniBlockSubId) {
        this.unsubscribe(this.miniBlockSubId);
        this.miniBlockSubId = null;
      }
    };
  }

  addStatusListener(callback) {
    if (!callback || typeof callback !== "function") return () => {};
    this.statusListeners.add(callback);
    try {
      callback(this.getStatus());
    } catch {
      // ignore
    }
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  addTxListener(txHash, callback) {
    if (!txHash || typeof callback !== "function") return () => {};
    const target = txHash.toLowerCase();
    const handler = (mini) => {
      const receipts = mini?.receipts;
      if (!Array.isArray(receipts)) return;
      for (let i = 0; i < receipts.length; i += 1) {
        const rcpt = receipts[i];
        if ((rcpt?.transactionHash || "").toLowerCase() !== target) continue;
        try {
          callback(rcpt);
        } catch {
          // ignore listener errors
        }
        break;
      }
    };
    const unsub = this.addMiniBlockListener(handler);
    return unsub;
  }
}

let singleton = null;
export function getRealtimeClient() {
  if (!singleton) singleton = new RealtimeClient();
  return singleton;
}

export { TRANSFER_TOPIC };
