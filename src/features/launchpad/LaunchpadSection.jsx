import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Contract, Interface, formatUnits, id, isAddress, parseEther } from "ethers";
import {
  CURRENTX_ADDRESS,
  CURRENTX_VAULT_ADDRESS,
  EXPLORER_BASE_URL,
  LP_LOCKER_V2_ADDRESS,
  MEGAETH_CHAIN_ID_HEX,
  NETWORK_NAME,
  TOKENS,
  UNIV3_POSITION_MANAGER_ADDRESS,
  WETH_ADDRESS,
  getProvider,
  getReadOnlyProvider,
} from "../../shared/config/web3";
import {
  CURRENTX_ABI,
  CURRENTX_VAULT_ABI,
  ERC20_ABI,
  LP_LOCKER_V2_ABI,
  UNIV3_POSITION_MANAGER_ABI,
} from "../../shared/config/abis";

const EXPLORER_LABEL = `${NETWORK_NAME} Explorer`;
const DAY = 86400;
const FIXED_STARTING_MARKET_CAP_ETH = "10";
const MAX_IMAGE_UPLOAD_BYTES = 1024 * 1024;
const MAX_IMAGE_UPLOAD_LABEL = "1 MB";
const launchpadUiMemory = {
  summaryAdvanced: false,
  formAdvanced: false,
};
const defaultChainId = (() => {
  const parsed = Number.parseInt(String(MEGAETH_CHAIN_ID_HEX || "0x10e6"), 16);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4326;
})();

const shorten = (value) =>
  value && value.length > 10 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value || "";

const parseUint = (value, field, fallback = "0") => {
  const raw = String(value ?? "").trim() || fallback;
  if (!/^\d+$/u.test(raw)) throw new Error(`${field} must be an unsigned integer.`);
  return raw;
};

const parseEthAmount = (value) => {
  const raw = String(value ?? "0")
    .replace(/,/gu, ".")
    .trim() || "0";
  if (!/^\d+(\.\d+)?$/u.test(raw)) throw new Error("Invalid ETH value.");
  return parseEther(raw);
};

const parsePositiveDecimal = (value, field) => {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`${field} is required.`);
  if (!/^\d+(\.\d+)?$/u.test(raw)) throw new Error(`${field} must be a number.`);
  const out = Number(raw);
  if (!Number.isFinite(out) || out <= 0) throw new Error(`${field} must be greater than 0.`);
  return out;
};

const getMissingBasicFields = (form) => {
  const missing = [];
  if (!String(form?.name || "").trim()) missing.push("Name");
  if (!String(form?.symbol || "").trim()) missing.push("Symbol");
  if (!String(form?.image || "").trim()) missing.push("Image");
  return missing;
};

const parseOptionalHttpUrl = (value, label) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
    return parsed.toString();
  } catch {
    throw new Error(`${label} must be a valid http(s) URL.`);
  }
};

const parseTokenImageValue = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Token image is required.");

  if (/^ipfs:\/\//iu.test(raw)) {
    const trimmed = raw.replace(/^ipfs:\/\//iu, "");
    const clean = trimmed.startsWith("ipfs/") ? trimmed.slice(5) : trimmed;
    if (!clean) throw new Error("Invalid IPFS image URI.");
    return `ipfs://${clean}`;
  }

  if (/^data:image\/png;base64,/iu.test(raw)) {
    const payload = String(raw.split(",")[1] || "").trim();
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
    const byteLength = payload ? Math.floor((payload.length * 3) / 4) - padding : 0;
    if (byteLength > MAX_IMAGE_UPLOAD_BYTES) {
      throw new Error(`Uploaded PNG is too large. Max size is ${MAX_IMAGE_UPLOAD_LABEL}.`);
    }
    return raw;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
    return parsed.toString();
  } catch {
    throw new Error("Image must be a valid http(s) URL, ipfs:// URI, or an uploaded PNG.");
  }
};

const extractPngBase64FromDataUrl = (value) => {
  const raw = String(value ?? "").trim();
  if (!/^data:image\/png;base64,/iu.test(raw)) return "";
  const payload = String(raw.split(",")[1] || "").trim();
  if (!payload) return "";
  return payload;
};

const base64ToBytes = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return new Uint8Array();
  if (typeof atob !== "function") {
    throw new Error("Browser base64 decoder is unavailable.");
  }
  const binary = atob(raw);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
};

const bytesToBase64 = (bytes) => {
  if (!(bytes instanceof Uint8Array) || !bytes.length) return "";
  if (typeof btoa !== "function") {
    throw new Error("Browser base64 encoder is unavailable.");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const clampInt24 = (value) => Math.max(-8388608, Math.min(8388607, value));

const computeTickFromMarketCapEth = ({ marketCapEth, tokenSupplyRaw, tickSpacing = 0 }) => {
  const marketCap = parsePositiveDecimal(marketCapEth, "Starting market cap in ETH");
  const tokenSupply = Number(formatUnits(tokenSupplyRaw ?? 0n, 18));
  if (!Number.isFinite(tokenSupply) || tokenSupply <= 0) {
    throw new Error("TOKEN_SUPPLY is unavailable. Set a manual starting tick.");
  }
  const priceEthPerToken = marketCap / tokenSupply;
  if (!Number.isFinite(priceEthPerToken) || priceEthPerToken <= 0) {
    throw new Error("Unable to derive starting tick from market cap.");
  }
  let tick = Math.floor(Math.log(priceEthPerToken) / Math.log(1.0001));
  if (!Number.isFinite(tick)) {
    throw new Error("Unable to derive starting tick from market cap.");
  }
  if (tickSpacing > 0) {
    tick = Math.floor(tick / tickSpacing) * tickSpacing;
  }
  return clampInt24(tick);
};

const REWARD_TYPES = ["both", "currentx", "paired"];
const REWARD_TYPE_OPTIONS = [
  { value: "paired", label: "WETH" },
  { value: "currentx", label: "your token" },
  { value: "both", label: "Both" },
];
const VAULT_PERCENT_PRESETS = ["5", "15", "30"];
const VAULT_LOCK_DAY_PRESETS = ["30", "90", "180"];
const LOCKUP_DAY_PRESETS = ["30", "90", "180"];
const VESTING_DAY_PRESETS = ["30", "90", "180"];
const CREATOR_BUY_ETH_PRESETS = ["0.1", "0.5", "1"];
const PROTOCOL_WALLET_ADDRESS = "0xF1aEC27981FA7645902026f038F69552Ae4e0e8F";
const ENV = typeof import.meta !== "undefined" ? import.meta.env || {} : {};
const LAUNCHPAD_DEBUG_LOGS =
  Boolean(ENV.DEV) || String(ENV.VITE_LAUNCHPAD_DEBUG || "").trim().toLowerCase() === "true";
const IPFS_UPLOAD_ENDPOINT = String(ENV.VITE_IPFS_UPLOAD_ENDPOINT || "/api/ipfs/upload").trim();
const IPFS_IMAGE_GATEWAY = String(ENV.VITE_IPFS_GATEWAY || "https://gateway.pinata.cloud/ipfs/")
  .trim()
  .replace(/\/?$/u, "/");
const RAW_PROTOCOL_REWARD_RECIPIENT = String(
  ENV.VITE_PROTOCOL_REWARD_RECIPIENT || ENV.VITE_TEAM_REWARD_RECIPIENT || ""
).trim();
const RAW_PROTOCOL_REWARD_ADMIN = String(ENV.VITE_PROTOCOL_REWARD_ADMIN || "").trim();
const DEFAULT_PROTOCOL_REWARD_RECIPIENT = String(
  RAW_PROTOCOL_REWARD_RECIPIENT || PROTOCOL_WALLET_ADDRESS || CURRENTX_ADDRESS || ""
).trim();
const DEFAULT_PROTOCOL_REWARD_ADMIN = String(
  RAW_PROTOCOL_REWARD_ADMIN || DEFAULT_PROTOCOL_REWARD_RECIPIENT
).trim();
const PROTOCOL_REWARD_CONFIG_ERROR = (() => {
  if (RAW_PROTOCOL_REWARD_RECIPIENT && !isAddress(RAW_PROTOCOL_REWARD_RECIPIENT)) {
    return "VITE_PROTOCOL_REWARD_RECIPIENT is set but invalid.";
  }
  if (RAW_PROTOCOL_REWARD_ADMIN && !isAddress(RAW_PROTOCOL_REWARD_ADMIN)) {
    return "VITE_PROTOCOL_REWARD_ADMIN is set but invalid.";
  }
  if (!isAddress(DEFAULT_PROTOCOL_REWARD_RECIPIENT)) {
    return "Protocol reward recipient default is invalid.";
  }
  if (!isAddress(DEFAULT_PROTOCOL_REWARD_ADMIN)) {
    return "Protocol reward admin default is invalid.";
  }
  return "";
})();
const CREATOR_BUY_UNAVAILABLE_DEFAULT_ERROR =
  "Creator Buy is unavailable on this CurrentX deployment. Set Creator Buy ETH amount to 0.";
const CURRENTX_INITIAL_BUY_ROUTER_SELECTOR = id(
  "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))"
)
  .slice(2, 10)
  .toLowerCase();
const CURRENTX_ROUTER_READER_ABI = [
  {
    inputs: [],
    name: "swapRouter",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];

const toImagePreviewSrc = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^ipfs:\/\//iu.test(raw)) return raw;
  const trimmed = raw.replace(/^ipfs:\/\//iu, "");
  const clean = trimmed.startsWith("ipfs/") ? trimmed.slice(5) : trimmed;
  return `${IPFS_IMAGE_GATEWAY}${clean}`;
};

const toBytes32Salt = (value, walletAddress) => {
  const raw = String(value ?? "").trim();
  if (/^0x[a-fA-F0-9]{64}$/u.test(raw)) return raw;
  if (raw) return id(raw);
  return id(`currentx-launchpad:${walletAddress || "anon"}:${Date.now()}`);
};

const formatAmount = (value, decimals = 18, max = 6) => {
  try {
    const num = Number(formatUnits(value ?? 0n, decimals));
    if (!Number.isFinite(num)) return "0";
    return num.toLocaleString(undefined, { maximumFractionDigits: max });
  } catch {
    return "0";
  }
};

const toBigIntSafe = (value) => {
  try {
    if (typeof value === "bigint") return value;
    if (value === null || value === undefined || value === "") return null;
    return BigInt(value);
  } catch {
    return null;
  }
};

const normalizeVaultApproveMode = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "50" ? "50" : "max";
};

const computeVaultApproveAmount = (walletBalanceRaw, approveMode) => {
  const balance = toBigIntSafe(walletBalanceRaw);
  if (balance === null || balance <= 0n) return null;
  const mode = normalizeVaultApproveMode(approveMode);
  if (mode === "50") {
    const half = balance / 2n;
    return half > 0n ? half : null;
  }
  return balance;
};

const formatPct = (value, digits = 2) => {
  if (!Number.isFinite(Number(value))) return "--";
  return `${Number(value).toFixed(digits)}%`;
};

const formatDate = (unix) => {
  if (!unix) return "--";
  const d = new Date(Number(unix) * 1000);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString();
};

const formatRemainingFromUnix = (unix) => {
  const end = Number(unix || 0);
  if (!Number.isFinite(end) || end <= 0) return "--";
  const now = Math.floor(Date.now() / 1000);
  const diff = end - now;
  if (diff <= 0) return "Unlocked";
  const days = Math.floor(diff / DAY);
  const hours = Math.floor((diff % DAY) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const resolveCreatorBuySupport = async (provider, currentxAddress) => {
  if (!provider || !isAddress(currentxAddress)) {
    return {
      supported: null,
      reason: "Unable to verify Creator Buy compatibility.",
      swapRouter: "",
    };
  }
  try {
    const reader = new Contract(currentxAddress, CURRENTX_ROUTER_READER_ABI, provider);
    const swapRouter = String(await reader.swapRouter().catch(() => "")).trim();
    if (!isAddress(swapRouter)) {
      return {
        supported: false,
        reason: "Creator Buy unavailable: CurrentX swap router is not configured.",
        swapRouter,
      };
    }
    const swapRouterCode = String(await provider.getCode(swapRouter)).trim().toLowerCase();
    if (!swapRouterCode || swapRouterCode === "0x") {
      return {
        supported: false,
        reason: `Creator Buy unavailable: swap router not found at ${swapRouter}.`,
        swapRouter,
      };
    }
    const selectorNeedle = `63${CURRENTX_INITIAL_BUY_ROUTER_SELECTOR}`;
    const supportsExpectedSelector =
      swapRouterCode.includes(selectorNeedle) ||
      swapRouterCode.includes(CURRENTX_INITIAL_BUY_ROUTER_SELECTOR);
    if (!supportsExpectedSelector) {
      return {
        supported: false,
        reason:
          "Creator Buy unavailable: swap router is incompatible with CurrentX initial buy flow. Set Creator Buy ETH to 0.",
        swapRouter,
      };
    }
    return { supported: true, reason: "", swapRouter };
  } catch {
    return {
      supported: null,
      reason: "Unable to verify Creator Buy compatibility.",
      swapRouter: "",
    };
  }
};

const CURRENTX_INTERFACE = new Interface(CURRENTX_ABI);
const HEX_REVERT_DATA = /^0x[0-9a-fA-F]{8,}$/u;

const collectErrorMessages = (error) => {
  const out = [];
  const queue = [error];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    if (typeof current === "string") {
      const value = current.trim();
      if (value) out.push(value);
      continue;
    }
    if (typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    ["shortMessage", "reason", "message"].forEach((key) => {
      const value = current?.[key];
      if (typeof value === "string" && value.trim()) out.push(value.trim());
    });

    ["error", "cause", "info", "data", "originalError"].forEach((key) => {
      const value = current?.[key];
      if (!value) return;
      if (typeof value === "string") {
        const clean = value.trim();
        if (clean) out.push(clean);
        return;
      }
      if (typeof value === "object") queue.push(value);
    });
  }
  return Array.from(new Set(out));
};

const extractRevertData = (error) => {
  const queue = [error];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    const directCandidates = [
      current?.data,
      current?.error?.data,
      current?.error?.error?.data,
      current?.info?.data,
      current?.info?.error?.data,
      current?.originalError?.data,
      current?.revert?.data,
      current?.result,
    ];
    for (const candidate of directCandidates) {
      if (typeof candidate === "string" && HEX_REVERT_DATA.test(candidate)) {
        return candidate;
      }
      if (candidate && typeof candidate === "object") queue.push(candidate);
    }

    Object.values(current).forEach((value) => {
      if (value && typeof value === "object") queue.push(value);
    });
  }
  return "";
};

const decodeCurrentxRevert = (revertData) => {
  if (!revertData) return "";
  try {
    const parsed = CURRENTX_INTERFACE.parseError(revertData);
    if (!parsed?.name) return "";
    const args = Array.from(parsed.args || [])
      .map((value) => (typeof value === "bigint" ? value.toString() : String(value)))
      .slice(0, 4);
    const argsText = args.length ? ` (${args.join(", ")})` : "";
    return `Contract reverted with ${parsed.name}${argsText}.`;
  } catch {
    return "";
  }
};

const isOpaqueRevert = (error) => {
  const lower = collectErrorMessages(error).join(" ").toLowerCase();
  const revertData = extractRevertData(error);
  return (
    lower.includes("missing revert data") ||
    (lower.includes("execution reverted") && !revertData)
  );
};

const errMsg = (error, fallback) => {
  const messages = collectErrorMessages(error);
  const raw = messages[0] || "";
  const lower = messages.join(" ").toLowerCase();
  const code =
    error?.code ?? error?.info?.error?.code ?? error?.error?.code ?? error?.data?.code ?? null;
  if (code === 4001 || code === "ACTION_REJECTED") return "Transaction rejected in wallet.";
  if (lower.includes("wrong network in wallet")) return raw;
  const decodedRevert = decodeCurrentxRevert(extractRevertData(error));
  if (decodedRevert) return decodedRevert;
  if (lower.includes("insufficient funds")) return "Insufficient ETH for value + gas.";
  if (lower.includes("missing revert data")) {
    return "Contract call failed without revert data. Check wallet network, vault minimum duration, reward config, and creator buy settings.";
  }
  if (lower.includes("execution reverted")) return raw || "Transaction reverted by contract.";
  return raw || fallback || "Transaction failed.";
};

const trimTrailingZeros = (value) =>
  String(value || "")
    .replace(/(\.\d*?[1-9])0+$/u, "$1")
    .replace(/\.0+$/u, "");

const formatEthPerToken = (value) => {
  if (!Number.isFinite(value) || value <= 0) return "--";
  if (value < 0.000000000001) return "~ < 0.000000000001 ETH/token";
  const out = value.toLocaleString(undefined, {
    useGrouping: false,
    maximumFractionDigits: 12,
  });
  return `~ ${out} ETH/token`;
};

const formatEthPerTokenPrecise = (value) => {
  if (!Number.isFinite(value) || value <= 0) return "--";
  if (value < 0.000000000000000001) return "0.000000000000000001";
  return trimTrailingZeros(value.toFixed(18));
};

const formatFeeTierPercent = (value) => {
  const fee = Number(value ?? NaN);
  if (!Number.isFinite(fee) || fee <= 0) return "--";
  return `${trimTrailingZeros((fee / 10000).toFixed(4))}%`;
};

const buildTokenMap = () => {
  const out = {};
  Object.values(TOKENS || {}).forEach((token) => {
    if (!token?.address) return;
    out[token.address.toLowerCase()] = token;
  });
  return out;
};

const KNOWN_TOKENS = buildTokenMap();
const PANEL_CLASS =
  "rounded-[1.75rem] border border-slate-700/45 bg-slate-950/60 p-5 shadow-[0_22px_50px_rgba(2,6,23,0.55)] backdrop-blur-xl";
const INPUT_CLASS =
  "w-full rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 transition focus:border-cyan-300/70 focus:outline-none focus:ring-2 focus:ring-cyan-300/20";
const SOFT_BUTTON_CLASS =
  "rounded-full border border-slate-600/70 bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-400 hover:text-slate-50";
const PRIMARY_BUTTON_CLASS =
  "rounded-xl border border-emerald-300/60 bg-gradient-to-r from-emerald-400/25 to-cyan-400/20 px-3 py-2 text-xs font-semibold text-emerald-100 shadow-[0_10px_24px_rgba(16,185,129,0.2)] transition hover:brightness-110 disabled:opacity-60";
const CYAN_BUTTON_CLASS =
  "rounded-xl border border-cyan-300/55 bg-gradient-to-r from-sky-500/20 to-cyan-400/18 px-3 py-2 text-xs font-semibold text-cyan-100 shadow-[0_10px_22px_rgba(56,189,248,0.18)] transition hover:brightness-110 disabled:opacity-60";
const AMBER_BUTTON_CLASS =
  "rounded-xl border border-amber-300/55 bg-gradient-to-r from-amber-400/20 to-orange-400/15 px-3 py-2 text-xs font-semibold text-amber-100 shadow-[0_10px_22px_rgba(251,191,36,0.14)] transition hover:brightness-110 disabled:opacity-60";
const TONED_PANEL_CLASS = "rounded-xl border border-slate-700/60 bg-slate-900/45";

function ActionInfo({ state }) {
  if (!state?.error && !state?.hash && !state?.message) return null;
  return (
    <div className="mt-2 space-y-2 text-xs">
      {state.error ? (
        <div className="rounded-xl border border-amber-400/50 bg-amber-500/15 px-3 py-2 text-amber-100">
          {state.error}
        </div>
      ) : null}
      {state.message ? (
        <div className="rounded-xl border border-sky-400/45 bg-sky-500/15 px-3 py-2 text-sky-100">
          {state.message}
        </div>
      ) : null}
      {state.hash ? (
        <a
          href={`${EXPLORER_BASE_URL}/tx/${state.hash}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-cyan-200 underline underline-offset-4 hover:text-cyan-100"
        >
          View transaction on {EXPLORER_LABEL}
        </a>
      ) : null}
    </div>
  );
}

function AddressField({ label, value, onChange, required = false }) {
  const invalid = required ? !isAddress(value) : value && !isAddress(value);
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium tracking-wide text-slate-300/85">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="0x..."
        className={`${INPUT_CLASS} ${
          invalid ? "border-rose-500/70 text-rose-100" : ""
        }`}
      />
    </div>
  );
}

function InfoDot() {
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-cyan-300/35 text-[10px] font-semibold text-cyan-200/80">
      i
    </span>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`h-4 w-4 text-slate-300/80 transition-transform ${open ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}

function LockIcon({ className = "h-3.5 w-3.5" }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 9V7a4 4 0 118 0v2" />
      <rect x="4.5" y="9" width="11" height="8" rx="2" />
    </svg>
  );
}

function CopyIcon({ className = "h-3.5 w-3.5" }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
      aria-hidden="true"
    >
      <rect x="7" y="7" width="9" height="10" rx="2" />
      <path d="M5 13H4a2 2 0 01-2-2V4a2 2 0 012-2h7a2 2 0 012 2v1" />
    </svg>
  );
}

function SectionEnableToggle({ enabled, onToggle, disabled = false }) {
  return (
    <button
      type="button"
      aria-pressed={enabled}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onToggle(!enabled);
      }}
      className={`inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
        disabled
          ? "cursor-not-allowed border-slate-700/70 bg-slate-900/50 text-slate-500"
          : enabled
            ? "border-emerald-300/55 bg-emerald-500/15 text-emerald-100"
            : "border-slate-600/70 bg-slate-900/70 text-slate-300 hover:border-slate-500 hover:text-slate-100"
      }`}
      title={disabled ? "Extension unavailable" : enabled ? "Extension enabled" : "Extension disabled"}
    >
      <span>Enable</span>
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] ${
          disabled
            ? "bg-slate-800/70 text-slate-500"
            : enabled
              ? "bg-emerald-500/20 text-emerald-100"
              : "bg-slate-800/80 text-slate-300"
        }`}
      >
        {disabled ? "N/A" : enabled ? "ON" : "OFF"}
      </span>
    </button>
  );
}

function AddressPreviewRow({ label, value, copyKey, copiedKey, onCopy }) {
  const normalized = String(value || "").trim();
  const valid = isAddress(normalized);
  const canView = Boolean(valid && EXPLORER_BASE_URL);
  const display = valid ? shorten(normalized) : normalized || "--";

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/45 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-400/85">{label}</span>
        <span className="inline-flex items-center gap-1">
          {valid ? (
            <button
              type="button"
              title={copiedKey === copyKey ? "Copied" : "Copy address"}
              onClick={() => onCopy(copyKey, normalized)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-300/80 transition hover:bg-slate-800/70 hover:text-slate-100"
            >
              <CopyIcon className="h-3.5 w-3.5" />
              <span className="sr-only">Copy address</span>
            </button>
          ) : null}
          {canView ? (
            <a
              href={`${EXPLORER_BASE_URL}/address/${normalized}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-slate-600/70 px-2 py-0.5 text-[11px] font-semibold text-slate-200 transition hover:border-slate-400 hover:text-slate-100"
            >
              View
            </a>
          ) : null}
        </span>
      </div>
      <div className={`mt-1 font-mono text-sm ${valid ? "text-slate-100" : "text-slate-300/75"}`}>{display}</div>
    </div>
  );
}

function SelectorPills({ value, onChange, options, columns = 3, disabled = false }) {
  const gridCols = columns === 2 ? "sm:grid-cols-2" : columns === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3";
  return (
    <div className={`grid grid-cols-1 gap-2 ${gridCols}`}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
              disabled
                ? "cursor-not-allowed border-slate-700/70 bg-slate-900/45 text-slate-500"
                : active
                  ? "border-emerald-300/65 bg-gradient-to-r from-emerald-400/20 to-cyan-400/15 text-emerald-100 shadow-[0_10px_22px_rgba(16,185,129,0.2)]"
                  : "border-slate-700/70 bg-slate-900/65 text-slate-200 hover:border-slate-500 hover:text-slate-50"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function CollapsibleSection({
  title,
  open,
  onToggle,
  statusLabel = "",
  statusSummary = "",
  statusTone = "neutral",
  headerAction = null,
  children,
}) {
  const statusToneClass =
    statusTone === "good"
      ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
      : statusTone === "warn"
        ? "border-amber-400/50 bg-amber-500/15 text-amber-100"
        : "border-slate-600/70 bg-slate-900/70 text-slate-300";
  return (
    <div className="border-t border-slate-700/55 pt-4">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-1.5 transition hover:bg-slate-900/35"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-100">
          {title}
          <InfoDot />
        </span>
        <span className="inline-flex items-center gap-2">
          {headerAction ? <span onClick={(event) => event.stopPropagation()}>{headerAction}</span> : null}
          {statusSummary ? <span className="text-xs text-slate-300/75">{statusSummary}</span> : null}
          {statusLabel ? (
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusToneClass}`}>
              {statusLabel}
            </span>
          ) : null}
          <ChevronIcon open={open} />
        </span>
      </button>
      {open ? <div className="mt-4 space-y-3">{children}</div> : null}
    </div>
  );
}

const defaultDeployForm = () => ({
  name: "",
  symbol: "",
  description: "",
  telegram: "",
  website: "",
  x: "",
  farcaster: "",
  salt: "",
  image: "",
  metadata: "",
  context: "",
  originatingChainId: String(defaultChainId),
  pairedToken: WETH_ADDRESS || "",
  vaultPercentage: "0",
  lockupDays: "30",
  vestingDays: "30",
  pairedTokenSwapAmountOutMinimum: "0",
  creatorReward: "80",
  creatorRewardType: "paired",
  creatorAdmin: "",
  creatorRewardRecipient: "",
  interfaceRewardRaw: "0",
  interfaceRewardType: "paired",
  interfaceAdmin: "",
  interfaceRewardRecipient: "",
  txValueEth: "0",
  useCustomCreatorBuyRecipient: false,
  creatorBuyRecipient: "",
  useCustomTeamRewardRecipient: false,
  teamRewardRecipient: "",
});

const defaultVaultForm = () => ({
  token: "",
  depositLockDays: "30",
  depositAdmin: "",
  approveMode: "max",
});

const LAUNCHPAD_VIEWS = new Set(["create", "deployments", "vault", "locker"]);

const normalizeLaunchpadView = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return LAUNCHPAD_VIEWS.has(normalized) ? normalized : "create";
};

export default function LaunchpadSection({ address, onConnect, initialView = "create", onOpenMarket }) {
  const [contracts] = useState({
    currentx: CURRENTX_ADDRESS || "",
    vault: CURRENTX_VAULT_ADDRESS || "",
    locker: LP_LOCKER_V2_ADDRESS || "",
  });
  const [protocol, setProtocol] = useState({
    loading: false,
    error: "",
    maxCreatorReward: null,
    maxVaultPercentage: null,
    tickSpacing: null,
    poolFee: null,
    tokenSupply: null,
    weth: "",
    swapRouter: "",
    creatorBuySupported: null,
    creatorBuySupportReason: "",
  });
  const [deployForm, setDeployForm] = useState(defaultDeployForm);
  const [deployAction, setDeployAction] = useState({ loading: false, error: "", hash: "", message: "" });
  const [deployResult, setDeployResult] = useState(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadCid, setImageUploadCid] = useState("");
  const [imageUploadError, setImageUploadError] = useState("");
  const [deployments, setDeployments] = useState([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(false);
  const [deploymentsError, setDeploymentsError] = useState("");

  const [vaultForm, setVaultForm] = useState(defaultVaultForm);
  const [vaultLocks, setVaultLocks] = useState({
    loading: false,
    error: "",
    items: [],
    minimumVaultTime: 0n,
  });
  const [vaultTokenMeta, setVaultTokenMeta] = useState(null);
  const [vaultWalletBalanceRaw, setVaultWalletBalanceRaw] = useState(null);
  const [vaultAction, setVaultAction] = useState({ loadingKey: "", error: "", hash: "", message: "" });

  const [locker, setLocker] = useState({
    loading: false,
    error: "",
    ids: [],
    selectedId: "",
    teamReward: null,
    maxCreatorReward: null,
    tokenReward: null,
  });
  const [lockerAction, setLockerAction] = useState({ loadingKey: "", error: "", hash: "", message: "" });
  const [lockerPickerOpen, setLockerPickerOpen] = useState(false);
  const [activeView, setActiveView] = useState(() => normalizeLaunchpadView(initialView));
  const [openSections, setOpenSections] = useState({
    metadata: false,
    rewards: false,
    vault: false,
    buy: false,
  });
  const [rewardAddressEditing, setRewardAddressEditing] = useState(false);
  const [imageMode, setImageMode] = useState("upload");
  const [deployAttempted, setDeployAttempted] = useState(false);
  const [highlightedField, setHighlightedField] = useState("");
  const [cidCopied, setCidCopied] = useState(false);
  const [copiedSummaryKey, setCopiedSummaryKey] = useState("");
  const [summaryAdvancedOpen, setSummaryAdvancedOpen] = useState(() => launchpadUiMemory.summaryAdvanced);
  const [formAdvancedOpen, setFormAdvancedOpen] = useState(() => launchpadUiMemory.formAdvanced);

  const tokenMetaCache = useRef({});
  const basicSectionRef = useRef(null);
  const metadataSectionRef = useRef(null);
  const rewardsSectionRef = useRef(null);
  const vaultSectionRef = useRef(null);
  const creatorBuySectionRef = useRef(null);
  const nameInputRef = useRef(null);
  const symbolInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const imageSectionRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const cidCopiedTimerRef = useRef(null);
  const summaryCopyTimerRef = useRef(null);
  const lockerPickerRef = useRef(null);

  useEffect(() => {
    setActiveView(normalizeLaunchpadView(initialView));
  }, [initialView]);

  useEffect(() => {
    if (!lockerPickerOpen) return undefined;
    const handlePointerDown = (event) => {
      if (lockerPickerRef.current && !lockerPickerRef.current.contains(event.target)) {
        setLockerPickerOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setLockerPickerOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [lockerPickerOpen]);

  useEffect(() => {
    if (!locker.ids.length || activeView !== "locker") {
      setLockerPickerOpen(false);
    }
  }, [activeView, locker.ids]);

  const minimumVaultLockDays = useMemo(() => {
    const seconds = Number(vaultLocks.minimumVaultTime || 0n);
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return Math.max(1, Math.ceil(seconds / DAY));
  }, [vaultLocks.minimumVaultTime]);

  const vaultLockDayOptions = useMemo(() => {
    const base = VAULT_LOCK_DAY_PRESETS.map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    const eligible = base.filter((value) => value >= minimumVaultLockDays);
    if (eligible.length > 0) return eligible.map((value) => String(value));
    return [String(base[base.length - 1] || 180)];
  }, [minimumVaultLockDays]);

  const vaultUnlockPreview = useMemo(() => {
    const lockDays = Number(String(vaultForm.depositLockDays || "").trim());
    if (!Number.isFinite(lockDays) || lockDays <= 0) return "--";
    const unlockMs = Date.now() + lockDays * DAY * 1000;
    const unlockDate = new Date(unlockMs);
    if (Number.isNaN(unlockDate.getTime())) return "--";
    return unlockDate.toLocaleString();
  }, [vaultForm.depositLockDays]);

  const vaultLockAmountRaw = useMemo(() => {
    const raw = toBigIntSafe(vaultTokenMeta?.totalSupplyRaw);
    if (raw === null || raw <= 0n) return null;
    return raw;
  }, [vaultTokenMeta]);

  const vaultWalletBalanceLabel = useMemo(() => {
    if (!vaultTokenMeta || vaultWalletBalanceRaw === null) return "--";
    const symbol = String(vaultTokenMeta.symbol || "TOKEN");
    return `${formatAmount(vaultWalletBalanceRaw, vaultTokenMeta.decimals || 18, 6)} ${symbol}`;
  }, [vaultTokenMeta, vaultWalletBalanceRaw]);

  const vaultApproveMode = normalizeVaultApproveMode(vaultForm.approveMode);
  const vaultApproveAmountRaw = useMemo(
    () => computeVaultApproveAmount(vaultWalletBalanceRaw, vaultApproveMode),
    [vaultWalletBalanceRaw, vaultApproveMode]
  );
  const vaultApproveAmountLabel = useMemo(() => {
    if (!vaultTokenMeta || vaultApproveAmountRaw === null) return "--";
    const symbol = String(vaultTokenMeta.symbol || "TOKEN");
    return `${formatAmount(vaultApproveAmountRaw, vaultTokenMeta.decimals || 18, 6)} ${symbol}`;
  }, [vaultApproveAmountRaw, vaultTokenMeta]);

  const vaultWalletSupplyPct = useMemo(() => {
    if (vaultWalletBalanceRaw === null || vaultLockAmountRaw === null || vaultLockAmountRaw <= 0n) return null;
    const bps = Number((vaultWalletBalanceRaw * 10000n) / vaultLockAmountRaw);
    if (!Number.isFinite(bps)) return null;
    return bps / 100;
  }, [vaultWalletBalanceRaw, vaultLockAmountRaw]);

  const vaultHasFullSupply = useMemo(() => {
    if (vaultWalletBalanceRaw === null || vaultLockAmountRaw === null) return null;
    return vaultWalletBalanceRaw >= vaultLockAmountRaw;
  }, [vaultWalletBalanceRaw, vaultLockAmountRaw]);

  useEffect(() => {
    setVaultForm((prev) => {
      const current = String(prev.depositLockDays || "").trim();
      if (vaultLockDayOptions.includes(current)) return prev;
      return { ...prev, depositLockDays: vaultLockDayOptions[0] || "30" };
    });
  }, [vaultLockDayOptions]);

  const resolveTokenMeta = useCallback(async (tokenAddress, providerOverride) => {
    if (!isAddress(tokenAddress)) return null;
    const lower = tokenAddress.toLowerCase();
    if (tokenMetaCache.current[lower]) return tokenMetaCache.current[lower];

    const known = KNOWN_TOKENS[lower];
    const provider = providerOverride || getReadOnlyProvider(false, true);
    const erc20 = new Contract(tokenAddress, ERC20_ABI, provider);
    const imageReader = new Contract(
      tokenAddress,
      [
        { inputs: [], name: "imageUrl", outputs: [{ internalType: "string", name: "", type: "string" }], stateMutability: "view", type: "function" },
        { inputs: [], name: "image", outputs: [{ internalType: "string", name: "", type: "string" }], stateMutability: "view", type: "function" },
      ],
      provider
    );
    const [name, symbol, decimals, totalSupplyRaw, imageUrlRaw, imageRaw] = await Promise.all([
      erc20
        .name()
        .catch(() => known?.name || known?.displaySymbol || known?.symbol || "Token"),
      erc20
        .symbol()
        .catch(() => known?.displaySymbol || known?.symbol || "TOKEN"),
      erc20.decimals().catch(() => known?.decimals || 18),
      erc20.totalSupply().catch(() => null),
      imageReader.imageUrl().catch(() => ""),
      imageReader.image().catch(() => ""),
    ]);
    const image = String(imageUrlRaw || imageRaw || "").trim();
    const meta = {
      address: tokenAddress,
      name: String(name || known?.name || known?.displaySymbol || known?.symbol || "Token"),
      symbol: String(symbol || known?.displaySymbol || known?.symbol || "TOKEN"),
      decimals: Number(decimals ?? known?.decimals ?? 18),
      logo: image ? toImagePreviewSrc(image) : String(known?.logo || ""),
      totalSupplyRaw: toBigIntSafe(totalSupplyRaw),
    };
    tokenMetaCache.current[lower] = meta;
    return meta;
  }, []);

  const refreshProtocol = useCallback(async () => {
    if (!isAddress(contracts.currentx)) {
      setProtocol((prev) => ({ ...prev, error: "Set a valid CurrentX address." }));
      return;
    }
    try {
      setProtocol((prev) => ({ ...prev, loading: true, error: "" }));
      const provider = getReadOnlyProvider(false, true);
      const currentx = new Contract(contracts.currentx, CURRENTX_ABI, provider);
      const [maxCreatorReward, maxVaultPercentage, tickSpacing, poolFee, tokenSupply, weth, creatorBuySupport] =
        await Promise.all([
          currentx.MAX_CREATOR_REWARD(),
          currentx.MAX_VAULT_PERCENTAGE(),
          currentx.TICK_SPACING(),
          currentx.POOL_FEE(),
          currentx.TOKEN_SUPPLY(),
          currentx.weth(),
          resolveCreatorBuySupport(provider, contracts.currentx),
        ]);
      setProtocol({
        loading: false,
        error: "",
        maxCreatorReward,
        maxVaultPercentage,
        tickSpacing,
        poolFee,
        tokenSupply,
        weth,
        swapRouter: creatorBuySupport?.swapRouter || "",
        creatorBuySupported: creatorBuySupport?.supported ?? null,
        creatorBuySupportReason: creatorBuySupport?.reason || "",
      });
    } catch (error) {
      setProtocol((prev) => ({ ...prev, loading: false, error: errMsg(error, "Unable to load CurrentX constants.") }));
    }
  }, [contracts.currentx]);

  const refreshDeployments = useCallback(async () => {
    if (!address || !isAddress(contracts.currentx)) {
      setDeployments([]);
      return;
    }
    try {
      setDeploymentsLoading(true);
      setDeploymentsError("");
      const provider = getReadOnlyProvider(false, true);
      const currentx = new Contract(contracts.currentx, CURRENTX_ABI, provider);
      const list = await currentx.getTokensDeployedByUser(address);
      const rows = await Promise.all(
        (list || []).map(async (item) => {
          const tokenAddress = String(item.token || "");
          const base = {
            token: tokenAddress,
            positionId: String(item.positionId || ""),
            name: "Token",
            symbol: "TOKEN",
            logo: "",
          };
          if (!isAddress(tokenAddress)) return base;
          try {
            const meta = await resolveTokenMeta(tokenAddress, provider);
            return {
              ...base,
              name: String(meta?.name || "Token"),
              symbol: String(meta?.symbol || "TOKEN"),
              logo: String(meta?.logo || ""),
            };
          } catch {
            return base;
          }
        })
      );
      setDeployments(rows);
    } catch (error) {
      setDeployments([]);
      setDeploymentsError(errMsg(error, "Unable to load deployed tokens."));
    } finally {
      setDeploymentsLoading(false);
    }
  }, [address, contracts.currentx, resolveTokenMeta]);

  const refreshVaultLocks = useCallback(async () => {
    if (!isAddress(contracts.vault)) {
      setVaultLocks({ loading: false, error: "Set a valid vault address.", items: [], minimumVaultTime: 0n });
      return;
    }
    try {
      setVaultLocks((prev) => ({ ...prev, loading: true, error: "" }));
      const provider = getReadOnlyProvider(false, true);
      const vault = new Contract(contracts.vault, CURRENTX_VAULT_ABI, provider);
      const minimumVaultTime = await vault.minimumVaultTime().catch(() => 0n);

      const tokenMap = new Map();
      (deployments || []).forEach((item) => {
        const token = String(item?.token || "");
        if (isAddress(token)) tokenMap.set(token.toLowerCase(), token);
      });
      const manualToken = String(vaultForm.token || "").trim();
      if (isAddress(manualToken)) tokenMap.set(manualToken.toLowerCase(), manualToken);
      const tokenList = Array.from(tokenMap.values());

      if (!tokenList.length) {
        setVaultLocks({ loading: false, error: "", items: [], minimumVaultTime });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const walletLower = String(address || "").toLowerCase();
      const lockRows = await Promise.all(
        tokenList.map(async (tokenAddress) => {
          try {
            const [allocation, meta] = await Promise.all([
              vault.allocation(tokenAddress),
              resolveTokenMeta(tokenAddress, provider),
            ]);
            const amount = BigInt(allocation?.amount ?? 0n);
            const endTime = Number(allocation?.endTime ?? 0n);
            const admin = String(allocation?.admin || "");
            const isOwnedByWallet =
              walletLower && admin ? admin.toLowerCase() === walletLower : true;
            const isActive = amount > 0n && endTime > now;
            if (!isOwnedByWallet || !isActive) return null;
            return {
              token: tokenAddress,
              amount,
              endTime,
              admin,
              name: String(meta?.name || "Token"),
              symbol: String(meta?.symbol || "TOKEN"),
              decimals: Number(meta?.decimals || 18),
              logo: String(meta?.logo || ""),
            };
          } catch {
            return null;
          }
        })
      );

      const items = lockRows
        .filter(Boolean)
        .sort((a, b) => Number(a.endTime || 0) - Number(b.endTime || 0));
      setVaultLocks({ loading: false, error: "", items, minimumVaultTime });
    } catch (error) {
      setVaultLocks((prev) => ({
        ...prev,
        loading: false,
        error: errMsg(error, "Unable to load active vault locks."),
      }));
    }
  }, [address, contracts.vault, deployments, resolveTokenMeta, vaultForm.token]);

  const refreshLocker = useCallback(async () => {
    if (!address || !isAddress(contracts.locker)) {
      setLockerPickerOpen(false);
      setLocker({ loading: false, error: "", ids: [], selectedId: "", teamReward: null, maxCreatorReward: null, tokenReward: null });
      return;
    }
    try {
      setLocker((prev) => ({ ...prev, loading: true, error: "" }));
      const provider = getReadOnlyProvider(false, true);
      const lockerContract = new Contract(contracts.locker, LP_LOCKER_V2_ABI, provider);
      const [idsRaw, teamReward, maxCreatorReward] = await Promise.all([
        lockerContract.getLpTokenIdsForCreator(address),
        lockerContract.TEAM_REWARD(),
        lockerContract.MAX_CREATOR_REWARD(),
      ]);
      const ids = (idsRaw || []).map((item) => String(item));
      setLocker((prev) => ({
        ...prev,
        loading: false,
        error: "",
        ids,
        selectedId: prev.selectedId && ids.includes(prev.selectedId) ? prev.selectedId : ids[0] || "",
        teamReward,
        maxCreatorReward,
        tokenReward: null,
      }));
      setLockerPickerOpen(false);
    } catch (error) {
      setLockerPickerOpen(false);
      setLocker((prev) => ({ ...prev, loading: false, error: errMsg(error, "Unable to load locker data."), ids: [], selectedId: "", tokenReward: null }));
    }
  }, [address, contracts.locker]);

  const refreshLockerReward = useCallback(async () => {
    if (!isAddress(contracts.locker) || !locker.selectedId) {
      setLocker((prev) => ({ ...prev, tokenReward: null }));
      return;
    }
    try {
      const provider = getReadOnlyProvider(false, true);
      const lockerContract = new Contract(contracts.locker, LP_LOCKER_V2_ABI, provider);
      const [info, positionManagerFromLocker] = await Promise.all([
        lockerContract.tokenRewards(BigInt(locker.selectedId)),
        lockerContract.positionManager().catch(() => ""),
      ]);

      const fallbackManager = String(UNIV3_POSITION_MANAGER_ADDRESS || "").trim();
      const positionManagerAddress = isAddress(positionManagerFromLocker)
        ? positionManagerFromLocker
        : isAddress(fallbackManager)
          ? fallbackManager
          : "";

      let token0 = "";
      let token1 = "";
      let fee = "";
      if (positionManagerAddress) {
        try {
          const positionManager = new Contract(
            positionManagerAddress,
            UNIV3_POSITION_MANAGER_ABI,
            provider
          );
          const position = await positionManager.positions(BigInt(locker.selectedId));
          token0 = String(position?.token0 || "");
          token1 = String(position?.token1 || "");
          fee = String(position?.fee || "");
        } catch {
          // ignore pair fetch errors and keep reward info available
        }
      }

      const [token0Meta, token1Meta] = await Promise.all([
        isAddress(token0) ? resolveTokenMeta(token0, provider).catch(() => null) : null,
        isAddress(token1) ? resolveTokenMeta(token1, provider).catch(() => null) : null,
      ]);

      setLocker((prev) => ({
        ...prev,
        tokenReward: {
          lpTokenId: String(info.lpTokenId || ""),
          creatorReward: info.creatorReward,
          token0,
          token1,
          fee,
          token0Meta,
          token1Meta,
        },
      }));
    } catch (error) {
      setLocker((prev) => ({ ...prev, error: errMsg(error, "Unable to load selected reward info."), tokenReward: null }));
    }
  }, [contracts.locker, locker.selectedId, resolveTokenMeta]);

  useEffect(() => {
    if (!address) return;
    const protocolRewardRecipient = DEFAULT_PROTOCOL_REWARD_RECIPIENT;
    const protocolRewardAdmin = DEFAULT_PROTOCOL_REWARD_ADMIN;
    setDeployForm((prev) => ({
      ...prev,
      creatorAdmin: prev.creatorAdmin || address,
      creatorRewardRecipient: prev.creatorRewardRecipient || address,
      interfaceAdmin: prev.interfaceAdmin || protocolRewardAdmin,
      interfaceRewardRecipient: prev.interfaceRewardRecipient || protocolRewardRecipient,
      teamRewardRecipient: prev.teamRewardRecipient || protocolRewardRecipient,
    }));
    setVaultForm((prev) => ({ ...prev, depositAdmin: prev.depositAdmin || address }));
  }, [address]);

  useEffect(() => {
    refreshProtocol();
  }, [refreshProtocol]);

  useEffect(() => {
    refreshDeployments();
  }, [refreshDeployments]);

  useEffect(() => {
    refreshVaultLocks();
  }, [refreshVaultLocks]);

  useEffect(() => {
    refreshLocker();
  }, [refreshLocker]);

  useEffect(() => {
    refreshLockerReward();
  }, [refreshLockerReward]);

  useEffect(() => {
    let cancelled = false;
    const token = String(vaultForm.token || "").trim();
    if (!isAddress(token)) {
      setVaultTokenMeta(null);
      return () => {};
    }
    resolveTokenMeta(token)
      .then((meta) => {
        if (!cancelled) setVaultTokenMeta(meta || null);
      })
      .catch(() => {
        if (!cancelled) setVaultTokenMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [resolveTokenMeta, vaultForm.token]);

  useEffect(() => {
    let cancelled = false;
    const token = String(vaultForm.token || "").trim();
    const wallet = String(address || "").trim();
    if (!isAddress(token) || !isAddress(wallet)) {
      setVaultWalletBalanceRaw(null);
      return () => {};
    }
    const provider = getReadOnlyProvider(false, true);
    const erc20 = new Contract(token, ERC20_ABI, provider);
    erc20
      .balanceOf(wallet)
      .then((value) => {
        if (!cancelled) setVaultWalletBalanceRaw(toBigIntSafe(value));
      })
      .catch(() => {
        if (!cancelled) setVaultWalletBalanceRaw(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address, vaultForm.token]);

  useEffect(() => {
    if (protocol.weth && !isAddress(deployForm.pairedToken)) {
      setDeployForm((prev) => ({ ...prev, pairedToken: protocol.weth }));
    }
  }, [deployForm.pairedToken, protocol.weth]);

  const uploadPngToIpfs = useCallback(async ({ dataBase64, fileName, fileBytes }) => {
    try {
      const hasRawFile = fileBytes instanceof Uint8Array && fileBytes.length > 0;
      const normalizeWallet = (value) => String(value || "").trim().toLowerCase();
      const parseUploadResponse = async (uploadRes) => {
        const rawText = await uploadRes.text().catch(() => "");
        let uploadJson = {};
        try {
          uploadJson = rawText ? JSON.parse(rawText) : {};
        } catch {
          uploadJson = {};
        }
        const detailParts = [
          uploadJson?.error,
          uploadJson?.message,
          uploadJson?.hint,
          uploadJson?.upstream ? `upstream: ${uploadJson.upstream}` : "",
          Object.keys(uploadJson).length ? "" : rawText,
        ]
          .map((item) => String(item || "").trim())
          .filter(Boolean);
        const detail = Array.from(new Set(detailParts)).join(" | ");
        if (!uploadRes.ok) {
          return {
            ok: false,
            status: uploadRes.status,
            detail,
          };
        }
        const imageValue = String(uploadJson?.ipfsUri || uploadJson?.gatewayUrl || "").trim();
        if (!imageValue) {
          throw new Error("IPFS upload returned an empty image URI.");
        }
        return {
          ok: true,
          status: uploadRes.status,
          detail,
          imageValue,
          cid: String(uploadJson?.cid || ""),
        };
      };

      const buildUploadChallengeHeaders = async () => {
        const normalizedAddress = normalizeWallet(address);
        if (!isAddress(normalizedAddress)) {
          throw new Error("Connect wallet before uploading image to IPFS.");
        }
        const provider = await getProvider();
        const signer = await provider.getSigner();
        const signerAddress = normalizeWallet(
          (await signer.getAddress().catch(() => normalizedAddress)) || normalizedAddress
        );
        if (!isAddress(signerAddress)) {
          throw new Error("Unable to resolve connected wallet for upload challenge.");
        }
        if (signerAddress !== normalizedAddress) {
          throw new Error("Wallet mismatch detected. Reconnect wallet and retry upload.");
        }

        const challengeRes = await fetch(IPFS_UPLOAD_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "challenge",
            address: signerAddress,
          }),
        });
        const challengeRaw = await challengeRes.text().catch(() => "");
        let challengeJson = {};
        try {
          challengeJson = challengeRaw ? JSON.parse(challengeRaw) : {};
        } catch {
          challengeJson = {};
        }
        if (!challengeRes.ok) {
          const detail = [
            challengeJson?.error,
            challengeJson?.message,
            challengeRaw,
          ]
            .map((item) => String(item || "").trim())
            .filter(Boolean)
            .join(" | ");
          throw new Error(
            detail
              ? `Upload challenge failed (${challengeRes.status}): ${detail.slice(0, 260)}`
              : `Upload challenge failed (${challengeRes.status}).`
          );
        }

        const challengeId = String(challengeJson?.challengeId || "").trim();
        const challengeMessage = String(challengeJson?.message || "").trim();
        if (!challengeId || !challengeMessage) {
          throw new Error("Upload challenge response is invalid.");
        }
        const challengeSignature = await signer.signMessage(challengeMessage);
        return {
          challengeId,
          challengeAddress: signerAddress,
          challengeSignature,
          headers: {
            "X-Upload-Challenge-Id": challengeId,
            "X-Upload-Challenge-Address": signerAddress,
            "X-Upload-Challenge-Signature": challengeSignature,
          },
        };
      };

      const sendJsonUpload = async (base64Payload, challengePayload) =>
        fetch(IPFS_UPLOAD_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(challengePayload?.headers || {}),
          },
          body: JSON.stringify({
            fileName: fileName || "token-image.png",
            contentType: "image/png",
            dataBase64: base64Payload,
            challengeId: challengePayload?.challengeId || "",
            challengeAddress: challengePayload?.challengeAddress || "",
            challengeSignature: challengePayload?.challengeSignature || "",
          }),
        });

      let parsedResult = null;
      let rawFailureResult = null;
      const challengePayload = await buildUploadChallengeHeaders();

      if (hasRawFile) {
        const rawUploadRes = await fetch(IPFS_UPLOAD_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "image/png",
            "X-File-Name": String(fileName || "token-image.png"),
            ...(challengePayload?.headers || {}),
          },
          body: fileBytes,
        });
        parsedResult = await parseUploadResponse(rawUploadRes);

        if (!parsedResult.ok) {
          rawFailureResult = parsedResult;
          const shouldFallbackToJson =
            parsedResult.status === 400 || parsedResult.status === 415 || parsedResult.status >= 500;
          if (shouldFallbackToJson) {
            const base64Payload = bytesToBase64(fileBytes);
            const jsonUploadRes = await sendJsonUpload(base64Payload, challengePayload);
            parsedResult = await parseUploadResponse(jsonUploadRes);
            if (!parsedResult.ok && rawFailureResult?.detail) {
              const mergedDetail = [rawFailureResult.detail, parsedResult.detail]
                .map((item) => String(item || "").trim())
                .filter(Boolean)
                .join(" | fallback: ");
              if (mergedDetail) {
                parsedResult = { ...parsedResult, detail: `raw: ${mergedDetail}` };
              }
            }
          }
        }
      } else {
        const jsonUploadRes = await sendJsonUpload(String(dataBase64 || ""), challengePayload);
        parsedResult = await parseUploadResponse(jsonUploadRes);
      }

      if (!parsedResult?.ok) {
        if (parsedResult?.status === 404) {
          throw new Error("IPFS upload endpoint not found at /api/ipfs/upload. Deploy backend API changes.");
        }
        throw new Error(
          parsedResult?.detail
            ? `IPFS upload failed (${parsedResult.status}): ${parsedResult.detail.slice(0, 320)}`
            : `IPFS upload failed (${parsedResult?.status || "unknown"}).`
        );
      }

      return {
        imageValue: parsedResult.imageValue,
        cid: parsedResult.cid,
      };
    } catch (error) {
      if (Number(error?.code) === 4001 || error?.code === "ACTION_REJECTED") {
        throw new Error("Signature rejected in wallet.");
      }
      const message = String(error?.message || "");
      if (message.toLowerCase().includes("failed to fetch")) {
        throw new Error("Cannot reach IPFS upload API. If local, run backend API (vercel dev) or deploy latest changes.");
      }
      throw error;
    }
  }, [address]);

  const migrateLegacyImageToIpfs = useCallback(async () => {
    if (imageUploading) return;
    const dataBase64 = extractPngBase64FromDataUrl(deployForm.image);
    if (!dataBase64) return;
    try {
      setImageUploadError("");
      setImageUploadCid("");
      setImageUploading(true);
      const fileBytes = base64ToBytes(dataBase64);
      const result = await uploadPngToIpfs({
        fileBytes,
        fileName: `${String(deployForm.symbol || "token").toLowerCase() || "token"}.png`,
      });
      setDeployForm((prev) => ({ ...prev, image: result.imageValue }));
      setImageUploadCid(result.cid);
    } catch (error) {
      setImageUploadError(error?.message || "Unable to upload image to IPFS.");
      throw error;
    } finally {
      setImageUploading(false);
    }
  }, [deployForm.image, deployForm.symbol, imageUploading, uploadPngToIpfs]);

  const handleImageFileChange = async (event) => {
    const file = event?.target?.files?.[0];
    if (event?.target) event.target.value = "";
    if (!file) return;

    if (imageUploading) return;
    setImageUploadError("");
    setImageUploadCid("");
    const isPng = file.type === "image/png" || String(file.name || "").toLowerCase().endsWith(".png");
    if (!isPng) {
      setImageUploadError("Only PNG files are supported.");
      return;
    }
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      setImageUploadError(`PNG file is too large. Max size is ${MAX_IMAGE_UPLOAD_LABEL}.`);
      return;
    }

    try {
      const fileArrayBuffer = await file.arrayBuffer();
      const fileBytes = new Uint8Array(fileArrayBuffer);
      if (!fileBytes.length) throw new Error("Invalid PNG payload.");

      setImageUploading(true);
      const result = await uploadPngToIpfs({
        fileBytes,
        fileName: file.name || "token-image.png",
      });
      setDeployForm((prev) => ({ ...prev, image: result.imageValue }));
      setImageUploadCid(result.cid);
    } catch (error) {
      setImageUploadError(error?.message || "Unable to load image.");
    } finally {
      setImageUploading(false);
    }
  };

  const focusMissingField = useCallback((field) => {
    setHighlightedField(field);
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => setHighlightedField(""), 1800);

    const targets = {
      Name: nameInputRef.current,
      Symbol: symbolInputRef.current,
      Image: imageSectionRef.current,
    };
    const target = targets[field];
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if ((field === "Name" || field === "Symbol") && target && typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    }
    if (field === "Image" && imageMode !== "upload") {
      setImageMode("upload");
    }
  }, [imageMode]);

  const handleCopyCid = useCallback(async () => {
    if (!imageUploadCid) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(imageUploadCid);
        setCidCopied(true);
        if (cidCopiedTimerRef.current) clearTimeout(cidCopiedTimerRef.current);
        cidCopiedTimerRef.current = setTimeout(() => setCidCopied(false), 1200);
      }
    } catch {
      setImageUploadError("Unable to copy CID. Copy it manually.");
    }
  }, [imageUploadCid]);

  const handleCopySummaryValue = useCallback(async (key, value) => {
    if (!value) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(value));
        setCopiedSummaryKey(key);
        if (summaryCopyTimerRef.current) clearTimeout(summaryCopyTimerRef.current);
        summaryCopyTimerRef.current = setTimeout(() => setCopiedSummaryKey(""), 1200);
      }
    } catch {
      // keep UI silent if clipboard is unavailable
    }
  }, []);

  useEffect(() => {
    launchpadUiMemory.summaryAdvanced = Boolean(summaryAdvancedOpen);
  }, [summaryAdvancedOpen]);

  useEffect(() => {
    launchpadUiMemory.formAdvanced = Boolean(formAdvancedOpen);
  }, [formAdvancedOpen]);

  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    if (cidCopiedTimerRef.current) clearTimeout(cidCopiedTimerRef.current);
    if (summaryCopyTimerRef.current) clearTimeout(summaryCopyTimerRef.current);
  }, []);

  const handleDeploy = async (event) => {
    event.preventDefault();
    setDeployAttempted(true);
    if (!address) {
      if (typeof onConnect === "function") onConnect();
      return;
    }
    if (!isAddress(contracts.currentx)) {
      setDeployAction({ loading: false, error: "CurrentX address is invalid.", hash: "", message: "" });
      return;
    }
    if (imageUploading) {
      setDeployAction({
        loading: false,
        error: "Image upload in progress. Wait for IPFS upload to finish.",
        hash: "",
        message: "",
      });
      return;
    }
    const missing = getMissingBasicFields(deployForm);
    if (missing.length) {
      focusMissingField(missing[0]);
      setDeployAction({
        loading: false,
        error: `Complete required fields before deploy: ${missing.join(", ")}.`,
        hash: "",
        message: "",
      });
      return;
    }

    try {
      setDeployAction({ loading: true, error: "", hash: "", message: "Submitting deployment..." });
      setDeployResult(null);

      const name = String(deployForm.name || "").trim();
      const symbol = String(deployForm.symbol || "").trim();
      let imageInput = String(deployForm.image || "").trim();
      const legacyBase64 = extractPngBase64FromDataUrl(imageInput);
      if (legacyBase64) {
        setDeployAction({ loading: true, error: "", hash: "", message: "Converting legacy PNG to IPFS..." });
        const legacyBytes = base64ToBytes(legacyBase64);
        const migrated = await uploadPngToIpfs({
          fileBytes: legacyBytes,
          fileName: `${String(symbol || "token").toLowerCase() || "token"}.png`,
        });
        imageInput = migrated.imageValue;
        setDeployForm((prev) => ({ ...prev, image: migrated.imageValue }));
        setImageUploadCid(migrated.cid);
      }
      const image = parseTokenImageValue(imageInput);
      const description = String(deployForm.description || "").trim();
      const telegram = parseOptionalHttpUrl(deployForm.telegram, "Telegram link");
      const website = parseOptionalHttpUrl(deployForm.website, "Website link");
      const x = parseOptionalHttpUrl(deployForm.x, "X (Twitter) link");
      const farcaster = parseOptionalHttpUrl(deployForm.farcaster, "Farcaster link");
      const creatorRewardType = REWARD_TYPES.includes(deployForm.creatorRewardType)
        ? deployForm.creatorRewardType
        : "paired";
      const interfaceRewardType = "paired";
      const pairedToken = isAddress(deployForm.pairedToken)
        ? deployForm.pairedToken
        : isAddress(protocol.weth)
          ? protocol.weth
          : isAddress(WETH_ADDRESS)
            ? WETH_ADDRESS
            : "";
      const creatorAdmin = isAddress(deployForm.creatorAdmin) ? deployForm.creatorAdmin : address;
      const creatorRewardRecipient = isAddress(deployForm.creatorRewardRecipient)
        ? deployForm.creatorRewardRecipient
        : address;
      const protocolRewardRecipient = DEFAULT_PROTOCOL_REWARD_RECIPIENT;
      const protocolRewardAdmin = DEFAULT_PROTOCOL_REWARD_ADMIN;
      const interfaceAdmin = protocolRewardAdmin;
      const interfaceRewardRecipient = protocolRewardRecipient;
      const creatorBuyRecipient = deployForm.useCustomCreatorBuyRecipient
        ? String(deployForm.creatorBuyRecipient || "").trim()
        : address;
      const teamRewardRecipient = isAddress(deployForm.teamRewardRecipient)
        ? deployForm.teamRewardRecipient
        : protocolRewardRecipient;
      const vaultPercentageRaw = parseUint(deployForm.vaultPercentage, "Vault percentage");
      const vaultPercentageNum = Number(vaultPercentageRaw);
      const lockupDaysRaw = parseUint(deployForm.lockupDays, "Lockup period (days)");
      const vestingDaysRaw = parseUint(deployForm.vestingDays, "Vesting period (days)");
      const originatingChainIdRaw = parseUint(deployForm.originatingChainId, "Originating chain id");
      const originatingChainId = BigInt(originatingChainIdRaw);
      const lockupDays = Number(lockupDaysRaw);
      const vestingDays = Number(vestingDaysRaw);
      if (vaultPercentageNum > 0) {
        if (!LOCKUP_DAY_PRESETS.includes(lockupDaysRaw)) {
          throw new Error("Lockup period must be 30, 90, or 180 days.");
        }
        if (!VESTING_DAY_PRESETS.includes(vestingDaysRaw)) {
          throw new Error("Vesting period must be 30, 90, or 180 days.");
        }
        if (vestingDays < lockupDays) throw new Error("Vesting period must be >= lockup period.");
      }
      if (!name) throw new Error("Token name is required.");
      if (!symbol) throw new Error("Token symbol is required.");
      if (!image) throw new Error(`Add a token image (PNG <=${MAX_IMAGE_UPLOAD_LABEL}).`);
      if (PROTOCOL_REWARD_CONFIG_ERROR) throw new Error(PROTOCOL_REWARD_CONFIG_ERROR);
      if (!isAddress(pairedToken)) throw new Error("Paired token is invalid.");
      if (!isAddress(creatorAdmin)) throw new Error("Creator admin is invalid.");
      if (!isAddress(creatorRewardRecipient)) throw new Error("Creator reward recipient is invalid.");
      if (!isAddress(protocolRewardRecipient)) {
        throw new Error("Protocol reward recipient is invalid. Configure VITE_PROTOCOL_REWARD_RECIPIENT.");
      }
      if (!isAddress(interfaceAdmin)) throw new Error("Interface admin is invalid.");
      if (!isAddress(interfaceRewardRecipient)) throw new Error("Interface reward recipient is invalid.");
      if (deployForm.useCustomCreatorBuyRecipient && !isAddress(creatorBuyRecipient)) {
        throw new Error("Creator buy recipient is invalid.");
      }
      if (deployForm.useCustomTeamRewardRecipient && !isAddress(teamRewardRecipient)) {
        throw new Error("Team reward recipient is invalid.");
      }

      const provider = await getProvider();
      const signerNetwork = await provider.getNetwork();
      const signerChainId = Number(signerNetwork?.chainId || 0);
      if (defaultChainId > 0 && signerChainId !== defaultChainId) {
        throw new Error(
          `Wrong network in wallet. Switch to ${NETWORK_NAME} (chain ${defaultChainId}). Detected chain: ${signerChainId || "unknown"}.`
        );
      }
      const currentxCode = await provider.getCode(contracts.currentx);
      if (!currentxCode || currentxCode === "0x") {
        throw new Error(
          `CurrentX contract not found at ${contracts.currentx} on ${NETWORK_NAME}. Check VITE_CURRENTX_ADDRESS and wallet network.`
        );
      }
      const signer = await provider.getSigner();
      const currentx = new Contract(contracts.currentx, CURRENTX_ABI, signer);
      if (isAddress(contracts.locker)) {
        const lockerContract = new Contract(contracts.locker, LP_LOCKER_V2_ABI, provider);
        const lockerFactory = String(await lockerContract.factory().catch(() => "")).trim();
        if (
          isAddress(lockerFactory) &&
          lockerFactory.toLowerCase() !== String(contracts.currentx).toLowerCase()
        ) {
          throw new Error(
            `CurrentX address mismatch with Locker factory. Expected ${lockerFactory}, found ${contracts.currentx}. Update VITE_CURRENTX_ADDRESS and restart the app.`
          );
        }
      }
      if (originatingChainId !== BigInt(signerChainId || 0)) {
        throw new Error(
          `Originating chain id mismatch. Set ${originatingChainIdRaw} to ${signerChainId || defaultChainId} for ${NETWORK_NAME}.`
        );
      }
      const isDeprecated = await currentx.deprecated().catch(() => false);
      if (isDeprecated) {
        throw new Error("CurrentX deployments are currently disabled (deprecated=true).");
      }
      if (deployForm.useCustomTeamRewardRecipient) {
        const isAdmin = await currentx.admins(address).catch(() => false);
        if (!isAdmin) {
          throw new Error(
            "Custom team reward recipient is admin-only. Disable custom team recipient for standard deploys."
          );
        }
      }

      let tokenSupply = protocol.tokenSupply;
      let tickSpacingRaw = protocol.tickSpacing;
      let maxCreatorReward = protocol.maxCreatorReward;
      let maxVaultPercentage = protocol.maxVaultPercentage;
      let poolFeeFromProtocol = protocol.poolFee;

      if (!tokenSupply) {
        try {
          tokenSupply = await currentx.TOKEN_SUPPLY();
        } catch {
          tokenSupply = null;
        }
      }
      if (tickSpacingRaw == null) {
        try {
          tickSpacingRaw = await currentx.TICK_SPACING();
        } catch {
          tickSpacingRaw = null;
        }
      }
      if (maxCreatorReward == null) {
        try {
          maxCreatorReward = await currentx.MAX_CREATOR_REWARD();
        } catch {
          maxCreatorReward = null;
        }
      }
      if (maxVaultPercentage == null) {
        try {
          maxVaultPercentage = await currentx.MAX_VAULT_PERCENTAGE();
        } catch {
          maxVaultPercentage = null;
        }
      }
      if (poolFeeFromProtocol == null) {
        try {
          poolFeeFromProtocol = await currentx.POOL_FEE();
        } catch {
          poolFeeFromProtocol = null;
        }
      }

      const spacing = Number(tickSpacingRaw || 0);
      const tick = computeTickFromMarketCapEth({
        marketCapEth: FIXED_STARTING_MARKET_CAP_ETH,
        tokenSupplyRaw: tokenSupply,
        tickSpacing: spacing,
      });
      if (spacing > 0 && tick % spacing !== 0) {
        throw new Error(`Starting tick must be a multiple of ${spacing}.`);
      }
      const creatorRewardInput = parseUint(deployForm.creatorReward, "Creator reward");
      const creatorRewardRaw =
        creatorRewardInput === "0" && maxCreatorReward
          ? String(maxCreatorReward)
          : creatorRewardInput;
      if (creatorRewardInput === "0" && maxCreatorReward == null) {
        throw new Error("Unable to resolve MAX_CREATOR_REWARD from contract. Set reward to 80 and retry.");
      }
      if (BigInt(creatorRewardRaw) === 0n) {
        throw new Error("Creator reward cannot be 0.");
      }
      const interfaceRewardRaw = "0";
      if (maxCreatorReward != null && BigInt(creatorRewardRaw) > BigInt(maxCreatorReward)) {
        throw new Error(`Creator reward exceeds MAX_CREATOR_REWARD (${String(maxCreatorReward)}).`);
      }
      if (maxVaultPercentage != null && BigInt(vaultPercentageRaw) > BigInt(maxVaultPercentage)) {
        throw new Error(`Vault percentage exceeds MAX_VAULT_PERCENTAGE (${String(maxVaultPercentage)}).`);
      }
      const pairedTokenPoolFee = parseUint(
        poolFeeFromProtocol != null ? String(poolFeeFromProtocol) : "3000",
        "Paired token pool fee"
      );
      const txValue = parseEthAmount(deployForm.txValueEth);
      if (txValue > 0n) {
        const creatorBuySupport = await resolveCreatorBuySupport(provider, contracts.currentx);
        if (creatorBuySupport?.supported === false) {
          throw new Error(creatorBuySupport.reason || creatorBuyUnavailableReason);
        }
      }
      if (txValue > 0n && deployForm.useCustomCreatorBuyRecipient) {
        throw new Error(
          "Custom recipient for Creator Buy is not supported by deployToken. Disable custom recipient or set ETH amount to 0."
        );
      }
      const initialBuyMinOutRaw = parseUint(deployForm.pairedTokenSwapAmountOutMinimum, "Initial buy min out");
      const vaultDurationSeconds = vaultPercentageNum > 0 ? BigInt(Math.floor(vestingDays * DAY)) : 0n;
      if (vaultPercentageNum > 0 && isAddress(contracts.vault)) {
        const vaultContract = new Contract(contracts.vault, CURRENTX_VAULT_ABI, provider);
        const minimumVaultTime = await vaultContract.minimumVaultTime().catch(() => null);
        if (minimumVaultTime != null && minimumVaultTime > 0n && vaultDurationSeconds < minimumVaultTime) {
          const minimumDays = Math.ceil(Number(minimumVaultTime) / DAY);
          throw new Error(
            `Vesting period is below vault minimum (${minimumDays} days). Increase vesting before deploy.`
          );
        }
      }

      const metadataPayload = {};
      if (description) metadataPayload.description = description;
      const links = {};
      if (telegram) links.telegram = telegram;
      if (website) links.website = website;
      if (x) links.x = x;
      if (farcaster) links.farcaster = farcaster;
      if (Object.keys(links).length) metadataPayload.links = links;

      const metadataValue =
        String(deployForm.metadata || "").trim() ||
        (Object.keys(metadataPayload).length ? JSON.stringify(metadataPayload) : "");
      const contextPayload = {
        uiSchema: "launchpad-v2",
        feeConfiguration: {
          preset: "recommended",
          fixedPoolFee: "",
        },
        rewardRecipients: [
          {
            role: "creator",
            admin: creatorAdmin,
            recipient: creatorRewardRecipient,
            rewardRaw: creatorRewardRaw,
            rewardType: creatorRewardType,
          },
          {
            role: "interface",
            admin: interfaceAdmin,
            recipient: interfaceRewardRecipient,
            rewardRaw: interfaceRewardRaw,
            rewardType: interfaceRewardType,
          },
        ],
        poolConfiguration: {
          type: "recommended",
          pairedToken,
          startingMarketCapEth: FIXED_STARTING_MARKET_CAP_ETH,
          tickIfToken0IsNewToken: String(tick),
        },
        creatorVault: {
          vaultPercentage: String(vaultPercentageNum),
          lockupDays: String(vaultPercentageNum > 0 ? lockupDays : 0),
          vestingDays: String(vaultPercentageNum > 0 ? vestingDays : 0),
        },
        creatorBuy: {
          ethAmount: String(deployForm.txValueEth || "0"),
          recipient: creatorBuyRecipient,
        },
      };
      if (deployForm.useCustomTeamRewardRecipient) {
        contextPayload.teamRewardRecipient = teamRewardRecipient;
      }
      const contextValue =
        String(deployForm.context || "").trim() ||
        JSON.stringify(contextPayload);

      const deploymentConfig = {
        tokenConfig: {
          name,
          symbol,
          salt: toBytes32Salt(deployForm.salt, address),
          image,
          metadata: metadataValue,
          context: contextValue,
          originatingChainId,
        },
        vaultConfig: {
          vaultPercentage: vaultPercentageNum,
          vaultDuration: vaultDurationSeconds,
        },
        poolConfig: {
          pairedToken,
          tickIfToken0IsNewToken: tick,
        },
        initialBuyConfig: {
          pairedTokenPoolFee: Number(pairedTokenPoolFee),
          pairedTokenSwapAmountOutMinimum: BigInt(initialBuyMinOutRaw),
        },
        rewardsConfig: {
          creatorReward: BigInt(creatorRewardRaw),
          creatorAdmin,
          creatorRewardRecipient,
          interfaceAdmin,
          interfaceRewardRecipient,
        },
      };

      const overrides = txValue > 0n ? { value: txValue } : {};
      setDeployAction({ loading: true, error: "", hash: "", message: "Simulating deployment..." });
      try {
        if (deployForm.useCustomTeamRewardRecipient) {
          await currentx.deployTokenWithCustomTeamRewardRecipient.staticCall(
            deploymentConfig,
            teamRewardRecipient,
            overrides
          );
        } else {
          await currentx.deployToken.staticCall(deploymentConfig, overrides);
        }
      } catch (simulationError) {
        if (!isOpaqueRevert(simulationError)) throw simulationError;
        setDeployAction({ loading: true, error: "", hash: "", message: "Simulation unavailable on RPC, estimating gas..." });
        try {
          if (deployForm.useCustomTeamRewardRecipient) {
            await currentx.deployTokenWithCustomTeamRewardRecipient.estimateGas(
              deploymentConfig,
              teamRewardRecipient,
              overrides
            );
          } else {
            await currentx.deployToken.estimateGas(deploymentConfig, overrides);
          }
          if (LAUNCHPAD_DEBUG_LOGS) {
            const simulationSummary = String(
              simulationError?.shortMessage || simulationError?.message || "opaque static simulation error"
            );
            console.warn(
              "[launchpad][deploy] opaque static simulation, continuing after successful gas estimate:",
              simulationSummary
            );
          }
        } catch (gasError) {
          if (!isOpaqueRevert(gasError)) throw gasError;
          if (txValue > 0n) {
            throw new Error(
              "Creator Buy precheck failed without revert data (staticCall + estimateGas). Set Creator Buy ETH to 0 and retry."
            );
          }
          if (LAUNCHPAD_DEBUG_LOGS) {
            const simulationSummary = String(
              simulationError?.shortMessage || simulationError?.message || "opaque static simulation error"
            );
            const gasSummary = String(gasError?.shortMessage || gasError?.message || "opaque gas estimate error");
            console.warn(
              "[launchpad][deploy] opaque simulation and gas estimate failure, continuing to tx send:",
              { simulation: simulationSummary, gas: gasSummary }
            );
          }
        }
      }
      setDeployAction({ loading: true, error: "", hash: "", message: "Sending transaction..." });
      const tx = deployForm.useCustomTeamRewardRecipient
        ? await currentx.deployTokenWithCustomTeamRewardRecipient(
            deploymentConfig,
            teamRewardRecipient,
            overrides
          )
        : await currentx.deployToken(deploymentConfig, overrides);

      setDeployAction({ loading: true, error: "", hash: tx.hash || "", message: "Waiting confirmation..." });
      const receipt = await tx.wait();

      let tokenAddress = "";
      let positionId = "";
      try {
        for (const log of receipt.logs || []) {
          const parsed = currentx.interface.parseLog(log);
          if (parsed?.name !== "TokenCreated") continue;
          tokenAddress = parsed.args?.tokenAddress || "";
          positionId = String(parsed.args?.positionId || "");
          break;
        }
      } catch {
        // ignore log parsing failures
      }

      if (!tokenAddress) {
        try {
          const list = await currentx.getTokensDeployedByUser(address);
          const latest = list?.[list.length - 1];
          tokenAddress = latest?.token || "";
          positionId = String(latest?.positionId || "");
        } catch {
          // ignore
        }
      }

      setDeployResult({ tokenAddress, positionId, txHash: receipt.hash || tx.hash || "" });
      setDeployAction({ loading: false, error: "", hash: receipt.hash || tx.hash || "", message: "Token deployed." });
      await Promise.all([refreshDeployments(), refreshLocker()]);
    } catch (error) {
      console.error("[launchpad][deploy] failed", error);
      setDeployAction({ loading: false, error: errMsg(error, "Deploy failed."), hash: "", message: "" });
    }
  };

  const handleVaultApprove = async () => {
    if (!address) {
      if (typeof onConnect === "function") onConnect();
      return;
    }
    try {
      setVaultAction({ loadingKey: "approve", error: "", hash: "", message: "Approving vault..." });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const token = String(vaultForm.token || "").trim();
      if (!isAddress(token)) throw new Error("Token address is invalid.");
      if (!isAddress(contracts.vault)) throw new Error("Vault address is invalid.");
      const erc20 = new Contract(token, ERC20_ABI, signer);
      const walletBalance = toBigIntSafe(await erc20.balanceOf(address).catch(() => null));
      const amount = computeVaultApproveAmount(walletBalance, vaultForm.approveMode);
      if (amount === null || amount <= 0n) {
        throw new Error("Wallet balance is too low for selected approve amount.");
      }
      const tx = await erc20.approve(contracts.vault, amount);
      const receipt = await tx.wait();
      const modeLabel = normalizeVaultApproveMode(vaultForm.approveMode) === "50" ? "50%" : "max";
      setVaultAction({
        loadingKey: "",
        error: "",
        hash: receipt.hash || tx.hash || "",
        message: `Allowance updated (${modeLabel} of wallet balance).`,
      });
    } catch (error) {
      setVaultAction({ loadingKey: "", error: errMsg(error, "Approve failed."), hash: "", message: "" });
    }
  };

  const handleVaultDeposit = async () => {
    if (!address) {
      if (typeof onConnect === "function") onConnect();
      return;
    }
    try {
      setVaultAction({ loadingKey: "deposit", error: "", hash: "", message: "Depositing..." });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const token = String(vaultForm.token || "").trim();
      if (!isAddress(token)) throw new Error("Token address is invalid.");
      if (!isAddress(contracts.vault)) throw new Error("Vault address is invalid.");
      const meta = await resolveTokenMeta(vaultForm.token, provider);
      const amount = toBigIntSafe(meta?.totalSupplyRaw);
      if (amount === null || amount <= 0n) {
        throw new Error("Unable to resolve token total supply for 100% lock.");
      }
      const erc20 = new Contract(token, ERC20_ABI, provider);
      const erc20WithSigner = new Contract(token, ERC20_ABI, signer);
      const walletBalance = toBigIntSafe(await erc20.balanceOf(address).catch(() => null));
      if (walletBalance !== null && walletBalance < amount) {
        throw new Error("Insufficient wallet balance for vault deposit.");
      }
      const allowance = toBigIntSafe(await erc20.allowance(address, contracts.vault).catch(() => null));
      if (allowance !== null && allowance < amount) {
        setVaultAction({
          loadingKey: "deposit",
          error: "",
          hash: "",
          message: "Allowance is below required amount. Approving required amount...",
        });
        const approvalTx = await erc20WithSigner.approve(contracts.vault, amount);
        const approvalReceipt = await approvalTx.wait();
        setVaultAction({
          loadingKey: "deposit",
          error: "",
          hash: approvalReceipt.hash || approvalTx.hash || "",
          message: "Approval confirmed. Sending deposit...",
        });
      }
      const now = Math.floor(Date.now() / 1000);
      const lockDaysRaw = String(vaultForm.depositLockDays || "").trim();
      const lockDays = Number(lockDaysRaw);
      if (!vaultLockDayOptions.includes(lockDaysRaw) || !Number.isFinite(lockDays) || lockDays <= 0) {
        throw new Error("Select a lock duration: 30, 90, or 180 days.");
      }
      const unlockTime = now + lockDays * DAY;
      if (unlockTime <= now) throw new Error("Unlock date must be in the future.");
      const minTime = Number(vaultLocks.minimumVaultTime || 0n);
      if (minTime > 0 && unlockTime - now < minTime) {
        const minimumDays = Math.ceil(minTime / DAY);
        throw new Error(`Lock duration must be at least ${minimumDays} days.`);
      }
      const admin = vaultForm.depositAdmin || address;
      if (!isAddress(admin)) throw new Error("Deposit admin is invalid.");

      const vault = new Contract(contracts.vault, CURRENTX_VAULT_ABI, signer);
      const tx = await vault.deposit(token, amount, unlockTime, admin);
      const receipt = await tx.wait();
      const nextBalance = toBigIntSafe(await erc20.balanceOf(address).catch(() => null));
      if (nextBalance !== null) setVaultWalletBalanceRaw(nextBalance);
      setVaultAction({ loadingKey: "", error: "", hash: receipt.hash || tx.hash || "", message: "Deposit completed." });
      await refreshVaultLocks();
    } catch (error) {
      setVaultAction({ loadingKey: "", error: errMsg(error, "Deposit failed."), hash: "", message: "" });
    }
  };

  const handleCollectLocker = async () => {
    if (!address) {
      if (typeof onConnect === "function") onConnect();
      return;
    }
    if (!locker.selectedId) {
      setLockerAction({ loadingKey: "", error: "Select LP token ID first.", hash: "", message: "" });
      return;
    }
    try {
      setLockerAction({ loadingKey: "collect", error: "", hash: "", message: "Collecting fees..." });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const lockerContract = new Contract(contracts.locker, LP_LOCKER_V2_ABI, signer);
      const tx = await lockerContract.collectRewards(BigInt(locker.selectedId));
      const receipt = await tx.wait();
      setLockerAction({ loadingKey: "", error: "", hash: receipt.hash || tx.hash || "", message: "Fees collected." });
      await refreshLockerReward();
    } catch (error) {
      setLockerAction({ loadingKey: "", error: errMsg(error, "Collect failed."), hash: "", message: "" });
    }
  };

  const launchpadViews = [
    { id: "market", label: "Market", hint: "Browse and trade launched tokens" },
    { id: "create", label: "Create Token", hint: "Deploy a new token" },
    { id: "deployments", label: "My Tokens", hint: "View your deployed tokens" },
    { id: "vault", label: "Vault", hint: "Active locks + deposit" },
    { id: "locker", label: "Locker", hint: "LP pair + collect fees" },
  ];

  const missingBasicFields = getMissingBasicFields(deployForm);
  const requiredFieldChecks = useMemo(
    () => [
      { key: "Name", done: !missingBasicFields.includes("Name") },
      { key: "Symbol", done: !missingBasicFields.includes("Symbol") },
      { key: "Image", done: !missingBasicFields.includes("Image") },
    ],
    [missingBasicFields]
  );
  const maxCreatorRewardUi = useMemo(() => {
    if (protocol.maxCreatorReward == null) return null;
    const value = Number(protocol.maxCreatorReward);
    return Number.isFinite(value) ? value : null;
  }, [protocol.maxCreatorReward]);
  const maxVaultPercentageUi = useMemo(() => {
    if (protocol.maxVaultPercentage == null) return null;
    const value = Number(protocol.maxVaultPercentage);
    return Number.isFinite(value) ? value : null;
  }, [protocol.maxVaultPercentage]);
  const vaultMaxPercentLabel = maxVaultPercentageUi != null ? String(maxVaultPercentageUi) : "30";
  const allocatedRewards = useMemo(() => {
    const creator = Number.parseFloat(String(deployForm.creatorReward || "0"));
    if (!Number.isFinite(creator)) return 0;
    if (creator === 0 && maxCreatorRewardUi != null) return maxCreatorRewardUi;
    return creator;
  }, [deployForm.creatorReward, maxCreatorRewardUi]);
  const allocatedRewardsLabel = Number.isInteger(allocatedRewards)
    ? String(allocatedRewards)
    : allocatedRewards.toFixed(2);
  const allocatedRewardsTotalLabel = maxCreatorRewardUi != null ? String(maxCreatorRewardUi) : "100";
  const autoProtocolRecipient = useMemo(
    () => (isAddress(DEFAULT_PROTOCOL_REWARD_RECIPIENT) ? DEFAULT_PROTOCOL_REWARD_RECIPIENT : ""),
    []
  );
  const imageRawValue = String(deployForm.image || "").trim();
  const imageIsLegacyDataUri = useMemo(
    () => /^data:image\/png;base64,/iu.test(imageRawValue),
    [imageRawValue]
  );
  const imagePreviewSrc = useMemo(() => toImagePreviewSrc(imageRawValue), [imageRawValue]);
  const imageSourceLabel = useMemo(() => {
    if (!imageRawValue) return "Not set";
    if (imageUploadCid) return "Uploaded to IPFS";
    if (/^ipfs:\/\//iu.test(imageRawValue) || /^https?:\/\//iu.test(imageRawValue)) return "From URL / IPFS";
    return "Set";
  }, [imageRawValue, imageUploadCid]);
  const metadataLinkCount = useMemo(() => {
    const links = [deployForm.telegram, deployForm.website, deployForm.x, deployForm.farcaster];
    return links.filter((value) => String(value || "").trim()).length;
  }, [deployForm.farcaster, deployForm.telegram, deployForm.website, deployForm.x]);
  const metadataConfigured = useMemo(
    () =>
      Boolean(String(deployForm.description || "").trim()) ||
      metadataLinkCount > 0 ||
      Boolean(String(deployForm.metadata || "").trim()),
    [deployForm.description, deployForm.metadata, metadataLinkCount]
  );
  const rewardAddressesCustomized = useMemo(() => {
    const norm = (value) => String(value || "").trim().toLowerCase();
    const defaultAddress = norm(address || "");
    const creatorAdmin = norm(deployForm.creatorAdmin);
    const creatorRecipient = norm(deployForm.creatorRewardRecipient);
    const customCreatorAdmin = Boolean(creatorAdmin && creatorAdmin !== defaultAddress);
    const customCreatorRecipient = Boolean(creatorRecipient && creatorRecipient !== defaultAddress);
    return customCreatorAdmin || customCreatorRecipient;
  }, [address, deployForm.creatorAdmin, deployForm.creatorRewardRecipient]);
  const rewardsCustomized = useMemo(() => {
    const norm = (value) => String(value || "").trim().toLowerCase();
    const rewardType = String(deployForm.creatorRewardType || "paired").trim();
    const rewardValue = String(deployForm.creatorReward || "80").trim() || "80";
    const customTeamRecipient = Boolean(deployForm.useCustomTeamRewardRecipient && norm(deployForm.teamRewardRecipient));
    return rewardAddressesCustomized || rewardType !== "paired" || rewardValue !== "80" || customTeamRecipient;
  }, [
    deployForm.creatorReward,
    deployForm.creatorRewardType,
    deployForm.teamRewardRecipient,
    deployForm.useCustomTeamRewardRecipient,
    rewardAddressesCustomized,
  ]);
  const rewardTypeLabel = useMemo(
    () =>
      REWARD_TYPE_OPTIONS.find((option) => option.value === String(deployForm.creatorRewardType || "paired"))?.label ||
      "WETH",
    [deployForm.creatorRewardType]
  );
  const rewardRecipientCount = useMemo(() => {
    const recipients = new Set();
    const creatorAddress = isAddress(deployForm.creatorRewardRecipient)
      ? deployForm.creatorRewardRecipient
      : isAddress(address)
        ? address
        : "";
    if (creatorAddress) recipients.add(creatorAddress.toLowerCase());
    if (deployForm.useCustomTeamRewardRecipient && isAddress(deployForm.teamRewardRecipient)) {
      recipients.add(String(deployForm.teamRewardRecipient).toLowerCase());
    }
    return recipients.size;
  }, [
    address,
    deployForm.creatorRewardRecipient,
    deployForm.teamRewardRecipient,
    deployForm.useCustomTeamRewardRecipient,
  ]);
  const vaultEnabled = useMemo(() => {
    const value = Number.parseFloat(String(deployForm.vaultPercentage || "0"));
    return Number.isFinite(value) && value > 0;
  }, [deployForm.vaultPercentage]);
  const creatorBuyRawInput = String(deployForm.txValueEth || "")
    .replace(/,/gu, ".")
    .trim();
  const creatorBuyAmount = useMemo(() => {
    const value = Number.parseFloat(creatorBuyRawInput || "0");
    return Number.isFinite(value) ? value : 0;
  }, [creatorBuyRawInput]);
  const creatorBuyUnavailable = protocol.creatorBuySupported === false;
  const creatorBuyUnavailableReason = String(
    protocol.creatorBuySupportReason || CREATOR_BUY_UNAVAILABLE_DEFAULT_ERROR
  ).trim();
  const creatorBuyConfigured = creatorBuyAmount > 0;
  const creatorBuyEnabled = !creatorBuyUnavailable && (openSections.buy || creatorBuyConfigured);
  const startingTickPreview = useMemo(() => {
    try {
      return computeTickFromMarketCapEth({
        marketCapEth: FIXED_STARTING_MARKET_CAP_ETH,
        tokenSupplyRaw: protocol.tokenSupply,
        tickSpacing: Number(protocol.tickSpacing || 0),
      });
    } catch {
      return null;
    }
  }, [protocol.tickSpacing, protocol.tokenSupply]);
  const startingPricePreview = useMemo(() => {
    try {
      const tokenSupply = Number(formatUnits(protocol.tokenSupply ?? 0n, 18));
      if (!Number.isFinite(tokenSupply) || tokenSupply <= 0) return null;
      return Number(FIXED_STARTING_MARKET_CAP_ETH) / tokenSupply;
    } catch {
      return null;
    }
  }, [protocol.tokenSupply]);
  const summaryReadyCount = 3 - missingBasicFields.length;
  const imageMissing = missingBasicFields.includes("Image");
  const imageNeedsAttention = imageMissing && (deployAttempted || highlightedField === "Image");
  const creatorBuyAmountLabel = trimTrailingZeros(String(deployForm.txValueEth || "0")) || "0";
  const metadataStatusLabel = metadataConfigured ? "Configured" : openSections.metadata ? "Not configured" : "Empty";
  const metadataStatusTone = metadataConfigured ? "good" : openSections.metadata ? "warn" : "neutral";
  const metadataStatusSummary = metadataConfigured
    ? `${metadataLinkCount} link${metadataLinkCount === 1 ? "" : "s"}`
    : "";
  const rewardsStatusLabel = rewardsCustomized ? "Configured" : "Enabled";
  const rewardsStatusTone = rewardsCustomized ? "good" : "neutral";
  const rewardStatusSummary = `${allocatedRewardsLabel}% ${rewardTypeLabel}`;
  const vaultStatusLabel = vaultEnabled ? "Configured" : "Disabled";
  const vaultStatusSummary = vaultEnabled
    ? `${deployForm.vaultPercentage || "0"}% • ${deployForm.lockupDays || "0"}d lock • ${deployForm.vestingDays || "0"}d vest`
    : "Disabled";
  const creatorBuyStatusLabel = creatorBuyUnavailable
    ? "Unavailable"
    : creatorBuyConfigured
      ? "Configured"
      : creatorBuyEnabled
        ? "Not configured"
        : "Disabled";
  const creatorBuyStatusSummary = creatorBuyUnavailable
    ? "Set to 0 ETH"
    : creatorBuyEnabled
      ? `${creatorBuyAmountLabel} ETH`
      : "Disabled";
  const creatorBuyStatusTone = creatorBuyUnavailable
    ? "warn"
    : creatorBuyConfigured
      ? "good"
      : creatorBuyEnabled
        ? "warn"
        : "neutral";
  const rewardsSummaryLine = `${rewardTypeLabel} • ${allocatedRewardsLabel}% • ${rewardRecipientCount} recipient${
    rewardRecipientCount === 1 ? "" : "s"
  }`;
  const vaultSummaryLine = `${deployForm.vaultPercentage || "0"}% • ${deployForm.lockupDays || "0"}d lock • ${
    deployForm.vestingDays || "0"
  }d vest`;
  const creatorBuySummaryLine = creatorBuyUnavailable ? "Unavailable (0 ETH required)" : `${creatorBuyAmountLabel} ETH`;
  const startTickCopyValue = startingTickPreview != null ? String(startingTickPreview) : "";
  const startingPriceCopyValue =
    startingPricePreview != null ? `${formatEthPerTokenPrecise(startingPricePreview)} ETH/token` : "";
  const isDeployLocked = deployAction.loading || imageUploading;
  const deployLockReason = imageUploading
    ? "Locked: waiting for image upload."
    : deployAction.loading
      ? "Locked: deployment in progress."
      : "";
  const actionBarNotice = isDeployLocked
    ? deployLockReason
    : deployAttempted && missingBasicFields.length
      ? `Complete required fields: ${missingBasicFields.join(", ")}.`
      : "";
  const toggleSection = useCallback((sectionKey) => {
    setOpenSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  }, []);
  const expandAllSections = useCallback(() => {
    setOpenSections({ metadata: true, rewards: true, vault: true, buy: true });
  }, []);
  const collapseAllSections = useCallback(() => {
    setOpenSections({ metadata: false, rewards: false, vault: false, buy: false });
  }, []);
  const jumpToSection = useCallback((sectionKey) => {
    const refsMap = {
      basic: basicSectionRef,
      metadata: metadataSectionRef,
      rewards: rewardsSectionRef,
      vault: vaultSectionRef,
      buy: creatorBuySectionRef,
    };
    if (sectionKey !== "basic") {
      setOpenSections((prev) => ({ ...prev, [sectionKey]: true }));
    }
    const target = refsMap[sectionKey]?.current;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);
  const handleToggleVaultExtension = useCallback((enabled) => {
    setOpenSections((prev) => ({ ...prev, vault: enabled }));
    setDeployForm((prev) => {
      const current = Number.parseFloat(String(prev.vaultPercentage || "0"));
      const nextVaultPercentage =
        enabled && !(Number.isFinite(current) && current > 0) ? VAULT_PERCENT_PRESETS[0] || "15" : prev.vaultPercentage;
      return {
        ...prev,
        vaultPercentage: enabled ? nextVaultPercentage : "0",
      };
    });
  }, []);
  const handleToggleCreatorBuyExtension = useCallback(
    (enabled) => {
      if (enabled && creatorBuyUnavailable) {
        setOpenSections((prev) => ({ ...prev, buy: true }));
        setDeployAction((prev) => ({
          ...prev,
          loading: false,
          hash: "",
          message: "",
          error: creatorBuyUnavailableReason,
        }));
        return;
      }
      setOpenSections((prev) => ({ ...prev, buy: enabled }));
      setDeployForm((prev) => {
        const current = Number.parseFloat(String(prev.txValueEth || "").replace(/,/gu, ".").trim() || "0");
        const nextAmount =
          enabled && !(Number.isFinite(current) && current > 0) ? CREATOR_BUY_ETH_PRESETS[0] || "0.1" : prev.txValueEth;
        return {
          ...prev,
          txValueEth: enabled ? nextAmount : "0",
          useCustomCreatorBuyRecipient: enabled ? prev.useCustomCreatorBuyRecipient : false,
          creatorBuyRecipient: enabled ? prev.creatorBuyRecipient : "",
        };
      });
    },
    [creatorBuyUnavailable, creatorBuyUnavailableReason]
  );
  const createSummaryCard = (
    <div className="space-y-3 rounded-2xl border border-slate-700/60 bg-slate-950/65 p-4">
      <div className="flex items-center gap-3">
        {imagePreviewSrc ? (
          <img
            src={imagePreviewSrc}
            alt="Token preview"
            className="h-11 w-11 rounded-full border border-slate-700 object-cover"
          />
        ) : (
          <div className="h-11 w-11 rounded-full border border-slate-700 bg-slate-900/70" />
        )}
        <div>
          <div className="text-sm font-semibold text-slate-100">
            {String(deployForm.name || "").trim() || "Token name"}
          </div>
          <div className="text-xs text-slate-300/80">
            {String(deployForm.symbol || "").trim() || "SYMBOL"}
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t border-slate-700/55 pt-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-300/80">Preset</span>
          <span
            className="rounded-full border border-cyan-300/55 bg-cyan-400/15 px-2 py-0.5 font-semibold text-cyan-100"
            title="Preset locked"
          >
            <span className="inline-flex items-center gap-1">
              {FIXED_STARTING_MARKET_CAP_ETH} ETH fixed
              <LockIcon className="h-3.5 w-3.5" />
            </span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-300/80">Initial price (preview)</span>
          <span className="font-mono text-slate-200">{formatEthPerToken(startingPricePreview ?? Number.NaN)}</span>
        </div>
      </div>

      <div className="space-y-2 border-t border-slate-700/55 pt-3 text-xs">
        <div className="font-semibold text-slate-100">Extensions enabled</div>
        <div className="space-y-1 rounded-lg border border-slate-700/55 bg-slate-900/35 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-300/80">Vault</span>
            <span className={vaultEnabled ? "text-emerald-200" : "text-slate-300/75"}>{vaultEnabled ? "On" : "Off"}</span>
          </div>
          {vaultEnabled ? <div className="text-[11px] text-slate-300/75">{vaultSummaryLine}</div> : null}
        </div>
        <div className="space-y-1 rounded-lg border border-slate-700/55 bg-slate-900/35 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-300/80">Creator Buy</span>
            <span
              className={
                creatorBuyUnavailable
                  ? "text-amber-200"
                  : creatorBuyEnabled
                    ? "text-emerald-200"
                    : "text-slate-300/75"
              }
            >
              {creatorBuyUnavailable ? "N/A" : creatorBuyEnabled ? "On" : "Off"}
            </span>
          </div>
          {creatorBuyEnabled || creatorBuyUnavailable ? (
            <div className="text-[11px] text-slate-300/75">{creatorBuySummaryLine}</div>
          ) : null}
        </div>
        <div className="space-y-1 rounded-lg border border-slate-700/55 bg-slate-900/35 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-300/80">Reward Recipients</span>
            <span className="text-emerald-200">On</span>
          </div>
          <div className="text-[11px] text-slate-300/75">{rewardsSummaryLine}</div>
        </div>
      </div>

      <div className="border-t border-slate-700/55 pt-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-300/80">Ready status</span>
          <span className="font-semibold text-slate-100">{summaryReadyCount}/3 required fields done</span>
        </div>
      </div>

      <div className="border-t border-slate-700/55 pt-3">
        <button
          type="button"
          onClick={() => setSummaryAdvancedOpen((prev) => !prev)}
          className="inline-flex items-center gap-2 rounded-full border border-slate-600/70 bg-slate-900/65 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-slate-400 hover:text-slate-100"
        >
          <span>Advanced</span>
          <ChevronIcon open={summaryAdvancedOpen} />
        </button>
        {summaryAdvancedOpen ? (
          <div className="mt-3 space-y-2 rounded-xl border border-slate-700/55 bg-slate-900/35 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-300/80">Start tick (for V3 initialization)</span>
              <div className="inline-flex items-center gap-1">
                <span className="font-mono text-slate-200">
                  {startingTickPreview != null ? String(startingTickPreview) : "--"}
                </span>
                {startTickCopyValue ? (
                  <button
                    type="button"
                    title={copiedSummaryKey === "tick" ? "Copied" : "Copy start tick"}
                    onClick={() => handleCopySummaryValue("tick", startTickCopyValue)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-300/75 transition hover:bg-slate-800/70 hover:text-slate-100"
                  >
                    <CopyIcon className="h-3.5 w-3.5" />
                    <span className="sr-only">Copy start tick</span>
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-300/80">Initial price (full precision)</span>
              <div className="inline-flex items-center gap-1">
                <span className="font-mono text-slate-200">{startingPriceCopyValue || "--"}</span>
                {startingPriceCopyValue ? (
                  <button
                    type="button"
                    title={copiedSummaryKey === "price" ? "Copied" : "Copy full precision price"}
                    onClick={() => handleCopySummaryValue("price", startingPriceCopyValue)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-300/75 transition hover:bg-slate-800/70 hover:text-slate-100"
                  >
                    <CopyIcon className="h-3.5 w-3.5" />
                    <span className="sr-only">Copy full precision price</span>
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <section className="w-full px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="cx-fade-up mb-6 rounded-[2rem] border border-slate-700/45 bg-slate-950/55 p-5 shadow-[0_24px_60px_rgba(2,6,23,0.58)] backdrop-blur-xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 inline-flex rounded-full border border-cyan-300/40 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/90">
              Token Studio
            </div>
            <h2 className="font-display text-3xl font-semibold text-white sm:text-4xl">Launchpad</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-300/80">
              Deploy token + create V3 pool (requires fixed {FIXED_STARTING_MARKET_CAP_ETH} ETH preset), then manage
              CurrentxVault and LpLocker extensions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                refreshProtocol();
                refreshDeployments();
                refreshVaultLocks();
                refreshLocker();
              }}
              className={SOFT_BUTTON_CLASS}
            >
              Refresh all
            </button>
            {!address ? (
              <button
                type="button"
                onClick={onConnect}
                className="rounded-full border border-sky-300/65 bg-gradient-to-r from-sky-500/90 to-cyan-400/90 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_10px_24px_rgba(56,189,248,0.35)] transition hover:brightness-110"
              >
                Connect wallet
              </button>
            ) : (
              <span className="rounded-full border border-emerald-300/50 bg-emerald-400/15 px-3 py-1.5 text-xs font-semibold text-emerald-100">
                {shorten(address)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {launchpadViews.map((view, index) => {
          const isMarketView = view.id === "market";
          const isActive = !isMarketView && activeView === view.id;
          return (
            <button
              key={view.id}
              type="button"
              onClick={() => {
                if (isMarketView) {
                  onOpenMarket?.();
                  return;
                }
                setActiveView(view.id);
              }}
              className={`cx-fade-up cx-tab-button rounded-2xl border px-4 py-3 text-left transition ${
                isActive
                  ? "cx-tab-button-active border-cyan-300/60 bg-gradient-to-br from-sky-500/20 via-cyan-400/18 to-emerald-400/14 text-cyan-50 shadow-[0_12px_28px_rgba(56,189,248,0.22)]"
                  : "border-slate-700/60 bg-slate-950/45 text-slate-200 hover:border-slate-500 hover:bg-slate-900/60"
              }`}
              style={{ animationDelay: `${80 + index * 55}ms` }}
            >
              <div className="font-display text-sm font-semibold">{view.label}</div>
              <div className="mt-1 text-xs text-slate-300/70">{view.hint}</div>
            </button>
          );
        })}
      </div>

      <div className={`mt-6 ${activeView === "create" || activeView === "deployments" ? "grid gap-6 xl:grid-cols-1" : "hidden"}`}>
        <div className={`${PANEL_CLASS} ${activeView === "create" ? "cx-panel-enter" : "hidden"}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-lg font-semibold">Create Token</div>
              <div className="text-xs text-slate-300/70">
                Deploy token + create V3 pool flow (fixed {FIXED_STARTING_MARKET_CAP_ETH} ETH preset).
              </div>
            </div>
            {protocol.loading ? <span className="text-xs text-slate-300/75">Preparing...</span> : null}
          </div>
          {protocol.error ? (
            <div className="mt-2 rounded-xl border border-amber-500/45 bg-amber-500/15 px-3 py-2 text-xs text-amber-100">{protocol.error}</div>
          ) : null}

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="space-y-3">
              <details className="rounded-xl border border-slate-700/60 bg-slate-900/35 px-3 py-2 xl:hidden">
                <summary className="cursor-pointer text-sm font-semibold text-slate-100">Review</summary>
                <div className="pt-3">{createSummaryCard}</div>
              </details>

              <form className="space-y-4 pb-20" onSubmit={handleDeploy}>
                <div ref={basicSectionRef} className="space-y-4 border-b border-slate-700/55 pb-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-200">Basic Token Info</div>
                  <div className="rounded-xl border border-cyan-300/45 bg-cyan-500/10 px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-sm font-semibold text-cyan-100">
                      <span>Starting market cap preset: {FIXED_STARTING_MARKET_CAP_ETH} ETH (fixed)</span>
                      <span title="Preset locked" className="inline-flex text-cyan-100">
                        <LockIcon />
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-cyan-100/90">
                      Doesn't transfer 10 ETH - only sets initial price/tick. Gas is still required.
                    </div>
                  </div>

                  <div className="grid gap-3 xl:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium tracking-wide text-slate-300/85">Name *</label>
                      <input
                        ref={nameInputRef}
                        value={deployForm.name}
                        onChange={(e) => setDeployForm((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g., CurrentX"
                        className={`${INPUT_CLASS} ${
                          highlightedField === "Name" || (deployAttempted && missingBasicFields.includes("Name"))
                            ? "border-amber-400/80 ring-2 ring-amber-400/30"
                            : ""
                        }`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium tracking-wide text-slate-300/85">Symbol *</label>
                      <input
                        ref={symbolInputRef}
                        value={deployForm.symbol}
                        onChange={(e) => setDeployForm((prev) => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
                        placeholder="e.g., CRX"
                        className={`${INPUT_CLASS} ${
                          highlightedField === "Symbol" || (deployAttempted && missingBasicFields.includes("Symbol"))
                            ? "border-amber-400/80 ring-2 ring-amber-400/30"
                            : ""
                        }`}
                      />
                    </div>
                  </div>

                  <div
                    ref={imageSectionRef}
                    className={`space-y-3 rounded-xl border p-3 transition ${
                      imageNeedsAttention || highlightedField === "Image"
                        ? "border-amber-400/70 bg-amber-500/10 ring-2 ring-amber-400/30"
                        : "border-slate-700/60 bg-slate-900/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-medium tracking-wide text-slate-200">Image (required)</label>
                      <span className="rounded-full border border-slate-600/70 bg-slate-900/70 px-2 py-0.5 text-[11px] text-slate-300">
                        {imageSourceLabel}
                      </span>
                    </div>

                    <div className="inline-flex rounded-lg border border-slate-700/70 bg-slate-950/65 p-1">
                      <button
                        type="button"
                        onClick={() => setImageMode("upload")}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                          imageMode === "upload"
                            ? "border border-cyan-300/50 bg-cyan-400/15 text-cyan-100"
                            : "text-slate-300/75 hover:text-slate-100"
                        }`}
                      >
                        Upload PNG
                      </button>
                      <button
                        type="button"
                        onClick={() => setImageMode("url")}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                          imageMode === "url"
                            ? "border border-cyan-300/50 bg-cyan-400/15 text-cyan-100"
                            : "text-slate-300/75 hover:text-slate-100"
                        }`}
                      >
                        Paste URL / ipfs://
                      </button>
                    </div>

                    {imageMode === "url" ? (
                      <div className="space-y-2">
                        <input
                          ref={imageInputRef}
                          value={deployForm.image}
                          onChange={(e) => {
                            setImageUploadError("");
                            setImageUploadCid("");
                            setDeployForm((prev) => ({ ...prev, image: e.target.value }));
                          }}
                          placeholder="https://... or ipfs://..."
                          className={INPUT_CLASS}
                        />
                        <div className="text-[11px] text-slate-400/80">
                          Upload PNG is available in the other tab as a secondary action.
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <label
                            className={`inline-flex cursor-pointer items-center rounded-lg border border-cyan-300/45 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200/70 hover:bg-cyan-400/10 ${
                              imageUploading ? "pointer-events-none opacity-60" : ""
                            }`}
                          >
                            {imageUploading ? "Uploading PNG..." : "Upload PNG to IPFS"}
                            <input
                              type="file"
                              accept="image/png"
                              onChange={handleImageFileChange}
                              disabled={imageUploading}
                              className="sr-only"
                            />
                          </label>
                          <span className="text-[11px] text-slate-400/80">PNG only, max {MAX_IMAGE_UPLOAD_LABEL}.</span>
                        </div>
                        <div className="text-[11px] text-slate-400/80">Switch mode to edit URL.</div>
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)]">
                      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-slate-700/70 bg-slate-950/70">
                        {imagePreviewSrc ? (
                          <img src={imagePreviewSrc} alt="Token preview" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[11px] text-slate-400/80">No image</span>
                        )}
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="text-slate-300/85">Image preview</div>
                        {imageUploadCid ? (
                          <div className="flex flex-wrap items-center gap-2 text-emerald-100">
                            <span className="rounded-full border border-emerald-400/45 bg-emerald-500/15 px-2 py-0.5">
                              Uploaded to IPFS
                            </span>
                            <span className="font-mono">{shorten(imageUploadCid)}</span>
                            <button
                              type="button"
                              onClick={handleCopyCid}
                              className="rounded-lg border border-emerald-400/45 bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-100 transition hover:border-emerald-300/70"
                            >
                              {cidCopied ? "Copied" : "Copy CID"}
                            </button>
                          </div>
                        ) : null}
                        {imageMissing ? (
                          <div className="text-amber-100">Add a token image (PNG &lt;={MAX_IMAGE_UPLOAD_LABEL}).</div>
                        ) : null}
                      </div>
                    </div>

                    {imageUploadError ? (
                      <div className="rounded-xl border border-amber-500/45 bg-amber-500/15 px-3 py-2 text-xs text-amber-100">
                        {imageUploadError}
                      </div>
                    ) : null}
                    {imageIsLegacyDataUri ? (
                      <div className="space-y-2 rounded-xl border border-amber-500/45 bg-amber-500/15 px-3 py-2 text-xs text-amber-100">
                        <div>Legacy image format detected (`data:image...`). Convert it to IPFS before deploy.</div>
                        <button
                          type="button"
                          onClick={migrateLegacyImageToIpfs}
                          disabled={imageUploading}
                          className={AMBER_BUTTON_CLASS}
                        >
                          {imageUploading ? "Converting..." : "Convert to IPFS now"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-700/60 bg-slate-900/30 p-3">
                  <button
                    type="button"
                    onClick={() => setFormAdvancedOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:bg-slate-900/45"
                  >
                    <span>Advanced</span>
                    <ChevronIcon open={formAdvancedOpen} />
                  </button>
                  {formAdvancedOpen ? (
                    <div className="mt-3 space-y-2 border-t border-slate-700/55 pt-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-300/80">Start tick (for V3 initialization)</span>
                        <div className="inline-flex items-center gap-1">
                          <span className="font-mono text-slate-200">
                            {startingTickPreview != null ? String(startingTickPreview) : "--"}
                          </span>
                          {startTickCopyValue ? (
                            <button
                              type="button"
                              title={copiedSummaryKey === "tick" ? "Copied" : "Copy start tick"}
                              onClick={() => handleCopySummaryValue("tick", startTickCopyValue)}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-300/75 transition hover:bg-slate-800/70 hover:text-slate-100"
                            >
                              <CopyIcon className="h-3.5 w-3.5" />
                              <span className="sr-only">Copy start tick</span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-400/80">
                        Reserved for future advanced settings (slippage defaults, tick spacing info, and more).
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-xl border border-slate-700/60 bg-slate-900/25 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-200">Jump to</div>
                    <div className="inline-flex items-center gap-2">
                      <button type="button" onClick={expandAllSections} className={SOFT_BUTTON_CLASS}>
                        Expand all
                      </button>
                      <button type="button" onClick={collapseAllSections} className={SOFT_BUTTON_CLASS}>
                        Collapse all
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      { key: "basic", label: "Basic" },
                      { key: "metadata", label: "Metadata" },
                      { key: "rewards", label: "Rewards" },
                      { key: "vault", label: "Vault" },
                      { key: "buy", label: "Creator Buy" },
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => jumpToSection(item.key)}
                        className="rounded-full border border-slate-600/70 bg-slate-900/70 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-slate-400 hover:text-slate-100"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

            <div ref={metadataSectionRef}>
            <CollapsibleSection
              title="Token Metadata (optional)"
              open={openSections.metadata}
              onToggle={() => toggleSection("metadata")}
              statusLabel={metadataStatusLabel}
              statusSummary={metadataStatusSummary}
              statusTone={metadataStatusTone}
            >
              <div className="text-xs text-slate-300/75">
                What this does: adds description and social links to your token metadata.
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                <textarea
                  value={deployForm.description}
                  onChange={(e) => setDeployForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Description"
                  rows={3}
                  className={`${INPUT_CLASS} xl:col-span-2`}
                />
                <input
                  value={deployForm.telegram}
                  onChange={(e) => setDeployForm((prev) => ({ ...prev, telegram: e.target.value }))}
                  placeholder="Telegram link"
                  className={INPUT_CLASS}
                />
                <input
                  value={deployForm.website}
                  onChange={(e) => setDeployForm((prev) => ({ ...prev, website: e.target.value }))}
                  placeholder="Website link"
                  className={INPUT_CLASS}
                />
                <input
                  value={deployForm.x}
                  onChange={(e) => setDeployForm((prev) => ({ ...prev, x: e.target.value }))}
                  placeholder="X (Twitter) link"
                  className={INPUT_CLASS}
                />
                <input
                  value={deployForm.farcaster}
                  onChange={(e) => setDeployForm((prev) => ({ ...prev, farcaster: e.target.value }))}
                  placeholder="Farcaster link"
                  className={INPUT_CLASS}
                />
              </div>
            </CollapsibleSection>
            </div>

            <div ref={rewardsSectionRef}>
              <CollapsibleSection
                title="Reward Recipients (optional)"
                open={openSections.rewards}
                onToggle={() => toggleSection("rewards")}
                statusLabel={rewardsStatusLabel}
                statusSummary={rewardStatusSummary}
                statusTone={rewardsStatusTone}
              >
                <div className="text-xs text-slate-300/75">
                  What this does: configures how creator-side rewards are split and distributed.
                </div>
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-200">Creator addresses</div>
                      <button
                        type="button"
                        onClick={() => {
                          if (rewardAddressEditing) {
                            setDeployForm((prev) => ({
                              ...prev,
                              creatorAdmin: address || "",
                              creatorRewardRecipient: address || "",
                            }));
                          }
                          setRewardAddressEditing((prev) => !prev);
                        }}
                        className={SOFT_BUTTON_CLASS}
                      >
                        {rewardAddressEditing ? "Use defaults" : "Edit custom"}
                      </button>
                    </div>
                    {rewardAddressEditing ? (
                      <div className="space-y-3">
                        <AddressField
                          label="Admin Address"
                          value={deployForm.creatorAdmin}
                          onChange={(value) => setDeployForm((prev) => ({ ...prev, creatorAdmin: value }))}
                        />
                        <AddressField
                          label="Reward Recipient Address"
                          value={deployForm.creatorRewardRecipient}
                          onChange={(value) => setDeployForm((prev) => ({ ...prev, creatorRewardRecipient: value }))}
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <AddressPreviewRow
                          label="Admin (auto)"
                          value={deployForm.creatorAdmin || address || ""}
                          copyKey="creator-admin"
                          copiedKey={copiedSummaryKey}
                          onCopy={handleCopySummaryValue}
                        />
                        <AddressPreviewRow
                          label="Recipient (auto)"
                          value={deployForm.creatorRewardRecipient || address || ""}
                          copyKey="creator-recipient"
                          copiedKey={copiedSummaryKey}
                          onCopy={handleCopySummaryValue}
                        />
                      </div>
                    )}
                    <div className="space-y-1">
                      <div className="text-xs text-slate-300/80">Reward Token</div>
                      <SelectorPills
                        value={deployForm.creatorRewardType}
                        onChange={(value) => setDeployForm((prev) => ({ ...prev, creatorRewardType: value }))}
                        options={REWARD_TYPE_OPTIONS}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-slate-300/80">Reward Percentage</div>
                      <div className="relative">
                        <input
                          value={deployForm.creatorReward}
                          onChange={(e) => setDeployForm((prev) => ({ ...prev, creatorReward: e.target.value }))}
                          placeholder={maxCreatorRewardUi != null ? String(maxCreatorRewardUi) : "80"}
                          className={`${INPUT_CLASS} pr-8`}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                          %
                        </span>
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-emerald-200">
                      Allocated Rewards: {allocatedRewardsLabel}/{allocatedRewardsTotalLabel}%
                    </div>
                    <div className="text-xs text-slate-300/75">
                      Interface reward is managed automatically by protocol recipient:{" "}
                      <span className="font-mono text-slate-300">
                        {autoProtocolRecipient ? shorten(autoProtocolRecipient) : "--"}
                      </span>
                    </div>
                    {PROTOCOL_REWARD_CONFIG_ERROR ? (
                      <div className="rounded-xl border border-amber-500/45 bg-amber-500/15 px-3 py-2 text-xs text-amber-100">
                        {PROTOCOL_REWARD_CONFIG_ERROR}
                      </div>
                    ) : null}
                </div>
              </CollapsibleSection>
            </div>

            <div ref={vaultSectionRef}>
              <CollapsibleSection
                title="Extension: Creator Vault (optional)"
                open={openSections.vault}
                onToggle={() => toggleSection("vault")}
                statusLabel={vaultStatusLabel}
                statusSummary={vaultStatusSummary}
                statusTone={vaultEnabled ? "good" : "neutral"}
                headerAction={<SectionEnableToggle enabled={vaultEnabled} onToggle={handleToggleVaultExtension} />}
              >
                <div className="text-xs text-slate-300/75">
                  What this does: locks a percentage of creator allocation in vesting.
                </div>
                <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                  Vault percentage is calculated on total token supply. Current on-chain cap: up to {vaultMaxPercentLabel}% of total supply.
                </div>
                {!vaultEnabled ? (
                  <div className="rounded-xl border border-slate-700/60 bg-slate-900/45 px-3 py-2 text-sm text-slate-300/80">
                    Disabled.
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <div className="text-xs text-slate-300/80">Vault Percentage</div>
                      <div className="relative">
                        <input
                          value={deployForm.vaultPercentage}
                          onChange={(e) => setDeployForm((prev) => ({ ...prev, vaultPercentage: e.target.value }))}
                          placeholder="15"
                          className={`${INPUT_CLASS} pr-8`}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                          %
                        </span>
                      </div>
                    </div>
                    <SelectorPills
                      value={
                        VAULT_PERCENT_PRESETS.includes(String(deployForm.vaultPercentage))
                          ? String(deployForm.vaultPercentage)
                          : ""
                      }
                      onChange={(value) => setDeployForm((prev) => ({ ...prev, vaultPercentage: value }))}
                      options={VAULT_PERCENT_PRESETS.map((value) => ({ value, label: `${value}%` }))}
                    />

                    <div className="space-y-1">
                      <div className="text-xs text-slate-300/80">Vault Recipient Address</div>
                      <AddressPreviewRow
                        label="Recipient wallet (auto)"
                        value={address || ""}
                        copyKey="vault-recipient"
                        copiedKey={copiedSummaryKey}
                        onCopy={handleCopySummaryValue}
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs text-slate-300/80">Lockup Period</div>
                    </div>
                    <SelectorPills
                      value={LOCKUP_DAY_PRESETS.includes(String(deployForm.lockupDays)) ? String(deployForm.lockupDays) : "30"}
                      onChange={(value) => setDeployForm((prev) => ({ ...prev, lockupDays: value }))}
                      columns={3}
                      options={LOCKUP_DAY_PRESETS.map((value) => ({ value, label: `${value} days` }))}
                    />
                    <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                      Vesting must be &gt;= lockup. Allowed durations: 30/90/180 days.
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs text-slate-300/80">Vesting Period</div>
                    </div>
                    <SelectorPills
                      value={VESTING_DAY_PRESETS.includes(String(deployForm.vestingDays)) ? String(deployForm.vestingDays) : "30"}
                      onChange={(value) => setDeployForm((prev) => ({ ...prev, vestingDays: value }))}
                      columns={3}
                      options={VESTING_DAY_PRESETS.map((value) => ({ value, label: `${value} days` }))}
                    />
                  </>
                )}
              </CollapsibleSection>
            </div>

            <div ref={creatorBuySectionRef}>
              <CollapsibleSection
                title="Extension: Creator Buy (optional)"
                open={openSections.buy}
                onToggle={() => toggleSection("buy")}
                statusLabel={creatorBuyStatusLabel}
                statusSummary={creatorBuyStatusSummary}
                statusTone={creatorBuyStatusTone}
                headerAction={
                  <SectionEnableToggle
                    enabled={creatorBuyEnabled}
                    onToggle={handleToggleCreatorBuyExtension}
                    disabled={creatorBuyUnavailable}
                  />
                }
              >
                <div className="text-xs text-slate-300/75">
                  What this does: executes an optional initial buy right after deployment.
                </div>
                {creatorBuyUnavailable ? (
                  <div className="space-y-2">
                    <div className="rounded-xl border border-amber-500/45 bg-amber-500/15 px-3 py-2 text-xs text-amber-100">
                      {creatorBuyUnavailableReason}
                    </div>
                    <div className="rounded-xl border border-slate-700/60 bg-slate-900/45 px-3 py-2 text-sm text-slate-300/85">
                      Keep Creator Buy at 0 ETH on this deployment.
                    </div>
                  </div>
                ) : !creatorBuyEnabled ? (
                  <div className="rounded-xl border border-slate-700/60 bg-slate-900/45 px-3 py-2 text-sm text-slate-300/80">
                    Disabled (0 ETH).
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="text-xs text-slate-300/80">ETH Amount for Creator Buy</div>
                      <div className="relative">
                        <input
                          value={deployForm.txValueEth}
                          onChange={(e) =>
                            setDeployForm((prev) => ({ ...prev, txValueEth: String(e.target.value || "").replace(/,/gu, ".") }))
                          }
                          placeholder="0.5"
                          className={`${INPUT_CLASS} pr-14`}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-300">
                          ETH
                        </span>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-400/80">Set to 0 ETH to disable this extension.</div>

                    <SelectorPills
                      value={
                        CREATOR_BUY_ETH_PRESETS.includes(String(deployForm.txValueEth))
                          ? String(deployForm.txValueEth)
                          : String(deployForm.txValueEth) === "0"
                            ? "0"
                            : ""
                      }
                      onChange={(value) => setDeployForm((prev) => ({ ...prev, txValueEth: value }))}
                      options={[
                        { value: "0", label: "0 ETH (Disabled)" },
                        ...CREATOR_BUY_ETH_PRESETS.map((value) => ({ value, label: `${value} ETH` })),
                      ]}
                    />

                    <div className="space-y-3 border-t border-slate-700/55 pt-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-100">Token Recipient</div>
                        <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                          <input
                            type="checkbox"
                            checked={deployForm.useCustomCreatorBuyRecipient}
                            onChange={(e) =>
                              setDeployForm((prev) => ({ ...prev, useCustomCreatorBuyRecipient: e.target.checked }))
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-cyan-400 focus:ring-cyan-300/40"
                          />
                          <span>Use custom recipient</span>
                        </label>
                      </div>

                      {deployForm.useCustomCreatorBuyRecipient ? (
                        <div className="space-y-2">
                          <AddressField
                            label="Recipient wallet"
                            value={deployForm.creatorBuyRecipient}
                            onChange={(value) => setDeployForm((prev) => ({ ...prev, creatorBuyRecipient: value }))}
                            required
                          />
                          {creatorBuyAmount > 0 ? (
                            <div className="rounded-xl border border-amber-500/45 bg-amber-500/15 px-3 py-2 text-xs text-amber-100">
                              Custom recipient for Creator Buy is not supported by deployToken when ETH amount is greater than 0.
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-slate-700/60 bg-slate-900/45 px-3 py-2 text-sm text-slate-300">
                          Tokens will be sent to your wallet:{" "}
                          <span className="font-mono text-slate-100">{address ? shorten(address) : "Connect wallet"}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CollapsibleSection>
            </div>

            <div className="space-y-2 border-t border-slate-700/55 pt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-200">Required fields</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {requiredFieldChecks.map((field) => (
                  <div
                    key={field.key}
                    className={`rounded-lg border px-2 py-1.5 text-xs font-semibold ${
                      field.done
                        ? "border-emerald-400/45 bg-emerald-500/10 text-emerald-100"
                        : "border-amber-400/45 bg-amber-500/10 text-amber-100"
                    }`}
                  >
                    {field.done ? "OK" : "!"} {field.key}
                  </div>
                ))}
              </div>
            </div>

            <div className="sticky bottom-0 z-10 -mx-5 border-t border-slate-700/65 bg-slate-950/95 px-5 pb-4 pt-3 [padding-bottom:max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setImageUploading(false);
                    setImageUploadCid("");
                    setImageUploadError("");
                    setImageMode("upload");
                    setDeployAttempted(false);
                    setHighlightedField("");
                    setRewardAddressEditing(false);
                    setOpenSections({ metadata: false, rewards: false, vault: false, buy: false });
                    setDeployForm((prev) => ({
                      ...defaultDeployForm(),
                      creatorAdmin: address || prev.creatorAdmin || "",
                      creatorRewardRecipient: address || prev.creatorRewardRecipient || "",
                      interfaceAdmin:
                        (isAddress(DEFAULT_PROTOCOL_REWARD_ADMIN) && DEFAULT_PROTOCOL_REWARD_ADMIN) || prev.interfaceAdmin || "",
                      interfaceRewardRecipient:
                        (isAddress(DEFAULT_PROTOCOL_REWARD_RECIPIENT) && DEFAULT_PROTOCOL_REWARD_RECIPIENT) ||
                        prev.interfaceRewardRecipient ||
                        "",
                      teamRewardRecipient:
                        (isAddress(DEFAULT_PROTOCOL_REWARD_RECIPIENT) && DEFAULT_PROTOCOL_REWARD_RECIPIENT) ||
                        prev.teamRewardRecipient ||
                        "",
                    }));
                  }}
                  className="rounded-xl border border-slate-600/70 bg-slate-900/75 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-400 hover:text-slate-50"
                >
                  Reset
                </button>
                <div className="space-y-1 text-xs md:flex-1 md:px-2">
                  <div className="text-slate-300/85">Deploy token + create V3 pool</div>
                  {actionBarNotice ? (
                    <div className="text-amber-100">
                      {isDeployLocked ? `Disabled reason: ${actionBarNotice}` : actionBarNotice}
                    </div>
                  ) : null}
                </div>
                <button
                  type="submit"
                  disabled={isDeployLocked}
                  title={isDeployLocked ? deployLockReason : ""}
                  className={PRIMARY_BUTTON_CLASS}
                >
                  {deployAction.loading ? "Deploying..." : "Deploy token"}
                </button>
              </div>
            </div>
          </form>

          {deployResult ? (
            <div className="mt-2 rounded-xl border border-emerald-400/45 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-100">
              <div>Token: {deployResult.tokenAddress || "--"}</div>
              <div>Position ID: {deployResult.positionId || "--"}</div>
            </div>
          ) : null}
          <ActionInfo state={deployAction} />
        </div>

            <div className="hidden xl:block">
              <div className="sticky top-24">{createSummaryCard}</div>
            </div>
          </div>
        </div>

        <div className={`${PANEL_CLASS} ${activeView === "deployments" ? "cx-panel-enter" : "hidden"}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-lg font-semibold">My Tokens</div>
              <div className="text-xs text-slate-300/70">Logo, name, symbol, and address.</div>
            </div>
            <button
              type="button"
              onClick={refreshDeployments}
              className={SOFT_BUTTON_CLASS}
            >
              Reload
            </button>
          </div>

          {deploymentsError ? (
            <div className="mt-2 rounded-xl border border-amber-500/45 bg-amber-500/15 px-3 py-2 text-xs text-amber-100">{deploymentsError}</div>
          ) : null}

          {deploymentsLoading ? <div className="mt-3 text-sm text-slate-300/75">Loading...</div> : null}
          {!deploymentsLoading && address && deployments.length === 0 ? (
            <div className="mt-3 text-sm text-slate-300/75">No deployments found for this wallet.</div>
          ) : null}
          {!address ? <div className="mt-3 text-sm text-slate-300/75">Connect wallet to load deployments.</div> : null}

          <div className="mt-3 space-y-2">
            {deployments.map((item) => {
              const tokenAddress = String(item.token || "").trim();
              const validTokenAddress = isAddress(tokenAddress);
              const copyKey = `deployment-token-${tokenAddress.toLowerCase()}`;

              return (
                <div key={`${item.token}-${item.positionId}`} className={`${TONED_PANEL_CLASS} p-3`}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-700/70 bg-slate-900/70">
                      {item.logo ? (
                        <img src={item.logo} alt={`${item.symbol || "TOKEN"} logo`} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xs font-semibold text-slate-200">
                          {String(item.symbol || "T")
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-100">{item.name || "Token"}</div>
                      <div className="text-xs text-slate-300/80">{item.symbol || "TOKEN"}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-400/75">Address</div>
                  <div className="font-mono text-sm break-all text-slate-100">{tokenAddress || "--"}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {validTokenAddress ? (
                      <button
                        type="button"
                        onClick={() => handleCopySummaryValue(copyKey, tokenAddress)}
                        className={SOFT_BUTTON_CLASS}
                      >
                        {copiedSummaryKey === copyKey ? "Copied" : "Copy address"}
                      </button>
                    ) : null}
                    {validTokenAddress && EXPLORER_BASE_URL ? (
                      <a
                        href={`${EXPLORER_BASE_URL}/token/${tokenAddress}`}
                        target="_blank"
                        rel="noreferrer"
                        className={SOFT_BUTTON_CLASS}
                      >
                        View on {EXPLORER_LABEL}
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setVaultForm((prev) => ({ ...prev, token: tokenAddress }));
                        setActiveView("vault");
                      }}
                      className={SOFT_BUTTON_CLASS}
                    >
                      Use in vault
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className={`mt-6 ${activeView === "vault" || activeView === "locker" ? "grid gap-6 xl:grid-cols-1" : "hidden"}`}>
        <div className={`${PANEL_CLASS} ${activeView === "vault" ? "cx-panel-enter" : "hidden"}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-lg font-semibold">CurrentxVault</div>
              <div className="text-xs text-slate-300/70">Active locks and new vault deposits.</div>
            </div>
            <button
              type="button"
              onClick={refreshVaultLocks}
              className={SOFT_BUTTON_CLASS}
            >
              Reload
            </button>
          </div>

          <div className="mt-3 space-y-4">
            {vaultLocks.error ? (
              <div className="rounded-xl border border-amber-500/45 bg-amber-500/15 px-3 py-2 text-xs text-amber-100">
                {vaultLocks.error}
              </div>
            ) : null}

            <div className={`${TONED_PANEL_CLASS} p-3`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-200">Active locks</div>
                  <div className="text-[11px] text-slate-400/80">Locks that are still active for this wallet.</div>
                </div>
                <div className="text-right text-[11px] text-slate-400/80">
                  <div>Minimum lock</div>
                  <div className="font-semibold text-slate-100">
                    {Number(vaultLocks.minimumVaultTime || 0n) > 0
                      ? `${Math.ceil(Number(vaultLocks.minimumVaultTime || 0n) / DAY)} days`
                      : "--"}
                  </div>
                </div>
              </div>

              {vaultLocks.loading ? <div className="mt-3 text-sm text-slate-300/75">Loading active locks...</div> : null}
              {!vaultLocks.loading && !address ? (
                <div className="mt-3 text-sm text-slate-300/75">Connect wallet to load active locks.</div>
              ) : null}
              {!vaultLocks.loading && address && vaultLocks.items.length === 0 ? (
                <div className="mt-3 text-sm text-slate-300/75">No active locks found.</div>
              ) : null}

              {!vaultLocks.loading && vaultLocks.items.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {vaultLocks.items.map((item) => (
                    <div key={`vault-lock-${item.token}`} className="rounded-xl border border-slate-700/55 bg-slate-900/35 p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-700/70 bg-slate-900/70">
                          {item.logo ? (
                            <img src={item.logo} alt={`${item.symbol || "TOKEN"} logo`} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-xs font-semibold text-slate-200">
                              {String(item.symbol || "T")
                                .slice(0, 2)
                                .toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-100">{item.name || "Token"}</div>
                          <div className="text-xs text-slate-300/80">{item.symbol || "TOKEN"}</div>
                        </div>
                      </div>

                      <div className="mt-2 text-xs text-slate-400/75">Address</div>
                      <div className="font-mono text-sm break-all text-slate-100">{item.token}</div>

                      <div className="mt-2 grid gap-1 text-xs text-slate-200">
                        <div>
                          Locked amount: {formatAmount(item.amount, item.decimals || 18, 6)} {item.symbol || ""}
                        </div>
                        <div>Unlock date: {formatDate(item.endTime)}</div>
                        <div>Status: unlocks in {formatRemainingFromUnix(item.endTime)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className={`${TONED_PANEL_CLASS} p-3`}>
              <div className="text-sm font-semibold text-slate-100">Deposit token into vault</div>
              <div className="mt-1 text-xs text-slate-300/75">
                Lock amount is fixed at 100% of the selected token supply.
              </div>

              <div className="mt-3 space-y-3">
                <AddressField
                  label="Token"
                  value={vaultForm.token}
                  onChange={(value) => setVaultForm((prev) => ({ ...prev, token: value }))}
                  required
                />
                <div className="text-xs text-slate-300/75">
                  Token meta:{" "}
                  {vaultTokenMeta ? `${vaultTokenMeta.symbol} (${vaultTokenMeta.decimals} decimals)` : "--"}
                </div>
                <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-xs text-slate-300/85">
                  <div>Wallet balance: {vaultWalletBalanceLabel}</div>
                  <div>Wallet ownership of supply: {vaultWalletSupplyPct === null ? "--" : formatPct(vaultWalletSupplyPct)}</div>
                </div>
                <AddressField
                  label="Admin wallet"
                  value={vaultForm.depositAdmin}
                  onChange={(value) => setVaultForm((prev) => ({ ...prev, depositAdmin: value }))}
                  required
                />

                <div className="space-y-2 rounded-xl border border-slate-700/60 bg-slate-900/40 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-slate-300/80">Approve amount uses selected wallet balance mode.</div>
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setVaultForm((prev) => ({ ...prev, approveMode: "50" }))}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                          vaultApproveMode === "50"
                            ? "border-cyan-300/65 bg-cyan-400/15 text-cyan-100"
                            : "border-slate-600/70 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:text-slate-100"
                        }`}
                      >
                        50%
                      </button>
                      <button
                        type="button"
                        onClick={() => setVaultForm((prev) => ({ ...prev, approveMode: "max" }))}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                          vaultApproveMode === "max"
                            ? "border-cyan-300/65 bg-cyan-400/15 text-cyan-100"
                            : "border-slate-600/70 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:text-slate-100"
                        }`}
                      >
                        Max
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-cyan-100/90">
                    Approve amount: {vaultApproveAmountLabel}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleVaultApprove}
                      disabled={
                        vaultAction.loadingKey === "approve" ||
                        (Boolean(address) && vaultApproveAmountRaw === null)
                      }
                      className={CYAN_BUTTON_CLASS}
                    >
                      {vaultAction.loadingKey === "approve"
                        ? "Approving..."
                        : vaultApproveMode === "50"
                          ? "Approve 50% balance"
                          : "Approve max balance"}
                    </button>
                  </div>
                </div>

                <div className="text-xs text-slate-300/80">Lock duration (days)</div>
                <SelectorPills
                  value={vaultLockDayOptions.includes(String(vaultForm.depositLockDays || "")) ? String(vaultForm.depositLockDays || "") : ""}
                  onChange={(value) => setVaultForm((prev) => ({ ...prev, depositLockDays: value }))}
                  columns={4}
                  options={vaultLockDayOptions.map((value) => ({ value, label: `${value} days` }))}
                />

                <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                  Unlock preview: {vaultUnlockPreview}
                </div>

                <div className="text-[11px] text-slate-400/80">
                  Minimum lock:{" "}
                  {Number(vaultLocks.minimumVaultTime || 0n) > 0
                    ? `${Math.ceil(Number(vaultLocks.minimumVaultTime || 0n) / DAY)} days`
                    : "--"}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleVaultDeposit}
                    disabled={
                      vaultAction.loadingKey === "deposit" ||
                      vaultLockAmountRaw === null
                    }
                    className={PRIMARY_BUTTON_CLASS}
                  >
                    {vaultAction.loadingKey === "deposit" ? "Depositing..." : "Lock"}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <ActionInfo state={vaultAction} />
        </div>

        <div className={`${PANEL_CLASS} ${activeView === "locker" ? "cx-panel-enter" : "hidden"}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-lg font-semibold">LpLocker</div>
              <div className="text-xs text-slate-300/70">LP pair for selected NFT ID + collect fees.</div>
            </div>
            <button
              type="button"
              onClick={refreshLocker}
              className={SOFT_BUTTON_CLASS}
            >
              Reload
            </button>
          </div>

          {locker.error ? (
            <div className="mt-2 rounded-xl border border-amber-500/45 bg-amber-500/15 px-3 py-2 text-xs text-amber-100">{locker.error}</div>
          ) : null}

          <div className="mt-3 space-y-3">
            <div className="space-y-1">
              <div className="text-xs text-slate-300/80">LP token selector</div>
              <div className="relative" ref={lockerPickerRef}>
                <button
                  type="button"
                  disabled={locker.loading || !locker.ids.length}
                  onClick={() => {
                    if (locker.loading || !locker.ids.length) return;
                    setLockerPickerOpen((prev) => !prev);
                  }}
                  className={`${INPUT_CLASS} flex items-center justify-between gap-3 ${
                    lockerPickerOpen ? "border-cyan-300/70 ring-2 ring-cyan-300/20" : ""
                  } ${locker.loading || !locker.ids.length ? "cursor-not-allowed opacity-70" : ""}`}
                >
                  <span className={`font-mono text-sm ${locker.selectedId ? "text-slate-100" : "text-slate-500"}`}>
                    {locker.loading
                      ? "Loading LP token IDs..."
                      : locker.selectedId || "No LP token IDs"}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="rounded-full border border-slate-600/70 bg-slate-900/80 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                      {locker.ids.length}
                    </span>
                    <ChevronIcon open={lockerPickerOpen} />
                  </span>
                </button>

                {lockerPickerOpen && locker.ids.length > 0 ? (
                  <div className="absolute z-30 mt-2 max-h-56 w-full overflow-auto rounded-xl border border-slate-700/80 bg-slate-950/95 p-1 shadow-[0_16px_36px_rgba(2,6,23,0.55)] backdrop-blur">
                    {locker.ids.map((tokenId) => {
                      const selected = locker.selectedId === tokenId;
                      return (
                        <button
                          key={tokenId}
                          type="button"
                          onClick={() => {
                            setLocker((prev) => ({ ...prev, selectedId: tokenId }));
                            setLockerPickerOpen(false);
                          }}
                          className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition ${
                            selected
                              ? "border border-cyan-300/60 bg-cyan-500/10 text-cyan-100"
                              : "border border-transparent text-slate-200 hover:border-slate-600/70 hover:bg-slate-900/70"
                          }`}
                        >
                          <span className="font-mono text-sm">{tokenId}</span>
                          {selected ? (
                            <span className="rounded-full border border-cyan-300/50 bg-cyan-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                              Selected
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>

            <div className={`${TONED_PANEL_CLASS} space-y-1 px-3 py-2 text-xs text-slate-200`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-300/80">NFT ID</span>
                <span className="font-mono text-slate-100">{locker.selectedId || "--"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-300/80">Creator reward</span>
                <span className="font-semibold text-slate-100">
                  {locker.tokenReward ? String(locker.tokenReward.creatorReward) : "--"}
                </span>
              </div>
              <div className="pt-1 text-slate-300/80">LP pair</div>
              {locker.tokenReward?.token0Meta || locker.tokenReward?.token1Meta ? (
                <div className="flex items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-900/40 px-2 py-2">
                  <div className="inline-flex items-center gap-1.5">
                    <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-slate-700/70 bg-slate-900/70">
                      {locker.tokenReward?.token0Meta?.logo ? (
                        <img
                          src={locker.tokenReward.token0Meta.logo}
                          alt={`${locker.tokenReward?.token0Meta?.symbol || "TOKEN0"} logo`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] font-semibold text-slate-200">
                          {String(locker.tokenReward?.token0Meta?.symbol || "T0")
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-semibold text-slate-100">
                      {locker.tokenReward?.token0Meta?.symbol || "TOKEN0"}
                    </span>
                  </div>
                  <span className="text-slate-400/80">/</span>
                  <div className="inline-flex items-center gap-1.5">
                    <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-slate-700/70 bg-slate-900/70">
                      {locker.tokenReward?.token1Meta?.logo ? (
                        <img
                          src={locker.tokenReward.token1Meta.logo}
                          alt={`${locker.tokenReward?.token1Meta?.symbol || "TOKEN1"} logo`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] font-semibold text-slate-200">
                          {String(locker.tokenReward?.token1Meta?.symbol || "T1")
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-semibold text-slate-100">
                      {locker.tokenReward?.token1Meta?.symbol || "TOKEN1"}
                    </span>
                  </div>
                  <span className="ml-auto rounded-full border border-slate-600/70 bg-slate-900/70 px-2 py-0.5 text-[11px] text-slate-200">
                    {locker.tokenReward?.fee ? `Fee ${formatFeeTierPercent(locker.tokenReward.fee)}` : "Fee --"}
                  </span>
                </div>
              ) : (
                <div className="text-xs text-slate-300/75">Pair details unavailable for this NFT ID.</div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleCollectLocker}
                disabled={lockerAction.loadingKey === "collect" || !locker.selectedId}
                className={CYAN_BUTTON_CLASS}
              >
                {lockerAction.loadingKey === "collect" ? "Collecting..." : "Collect rewards"}
              </button>
            </div>
          </div>

          <ActionInfo state={lockerAction} />
        </div>
      </div>
    </section>
  );
}
