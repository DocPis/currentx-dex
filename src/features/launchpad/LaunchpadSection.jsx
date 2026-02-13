import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Contract, formatUnits, id, isAddress, parseEther, parseUnits } from "ethers";
import {
  CURRENTX_ADDRESS,
  CURRENTX_VAULT_ADDRESS,
  EXPLORER_BASE_URL,
  LP_LOCKER_V2_ADDRESS,
  MEGAETH_CHAIN_ID_HEX,
  NETWORK_NAME,
  TOKENS,
  WETH_ADDRESS,
  getProvider,
  getReadOnlyProvider,
} from "../../shared/config/web3";
import {
  CURRENTX_ABI,
  CURRENTX_VAULT_ABI,
  ERC20_ABI,
  LP_LOCKER_V2_ABI,
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
  const raw = String(value ?? "0").trim() || "0";
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

const parseTokenAmount = (value, decimals, label) => {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`${label} is required.`);
  if (!/^\d+(\.\d+)?$/u.test(raw)) throw new Error(`${label} is invalid.`);
  return parseUnits(raw, decimals);
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
const VAULT_DAY_PRESETS = ["7", "30", "90", "180"];
const CREATOR_BUY_ETH_PRESETS = ["0.1", "0.5", "1"];
const PROTOCOL_WALLET_ADDRESS = "0xF1aEC27981FA7645902026f038F69552Ae4e0e8F";
const ENV = typeof import.meta !== "undefined" ? import.meta.env || {} : {};
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

const formatDate = (unix) => {
  if (!unix) return "--";
  const d = new Date(Number(unix) * 1000);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString();
};

const errMsg = (error, fallback) => {
  const raw = error?.shortMessage || error?.reason || error?.message || "";
  const lower = String(raw).toLowerCase();
  const code =
    error?.code ?? error?.info?.error?.code ?? error?.error?.code ?? error?.data?.code ?? null;
  if (code === 4001 || code === "ACTION_REJECTED") return "Transaction rejected in wallet.";
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

function SectionEnableToggle({ enabled, onToggle }) {
  return (
    <button
      type="button"
      aria-pressed={enabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(!enabled);
      }}
      className={`inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
        enabled
          ? "border-emerald-300/55 bg-emerald-500/15 text-emerald-100"
          : "border-slate-600/70 bg-slate-900/70 text-slate-300 hover:border-slate-500 hover:text-slate-100"
      }`}
      title={enabled ? "Extension enabled" : "Extension disabled"}
    >
      <span>Enable</span>
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] ${
          enabled ? "bg-emerald-500/20 text-emerald-100" : "bg-slate-800/80 text-slate-300"
        }`}
      >
        {enabled ? "ON" : "OFF"}
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

function SelectorPills({ value, onChange, options, columns = 3 }) {
  const gridCols = columns === 2 ? "sm:grid-cols-2" : columns === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3";
  return (
    <div className={`grid grid-cols-1 gap-2 ${gridCols}`}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
              active
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
  approveAmount: "",
  depositAmount: "",
  depositUnlockAt: "",
  depositAdmin: "",
  withdrawAmount: "",
  withdrawTo: "",
});

export default function LaunchpadSection({ address, onConnect }) {
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
  const [claimAction, setClaimAction] = useState({ loadingKey: "", error: "", hash: "", message: "" });

  const [vaultForm, setVaultForm] = useState(defaultVaultForm);
  const [vaultInfo, setVaultInfo] = useState({ loading: false, error: "", allocation: null, minimumVaultTime: null });
  const [vaultTokenMeta, setVaultTokenMeta] = useState(null);
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
  const [activeView, setActiveView] = useState("create");
  const [openSections, setOpenSections] = useState({
    metadata: false,
    rewards: false,
    vault: false,
    buy: false,
  });
  const [rewardExtensionEnabled, setRewardExtensionEnabled] = useState(false);
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

  const resolveTokenMeta = useCallback(async (tokenAddress, providerOverride) => {
    if (!isAddress(tokenAddress)) return null;
    const lower = tokenAddress.toLowerCase();
    if (tokenMetaCache.current[lower]) return tokenMetaCache.current[lower];

    const known = KNOWN_TOKENS[lower];
    if (known) {
      const meta = {
        address: tokenAddress,
        symbol: known.displaySymbol || known.symbol || "TOKEN",
        decimals: Number(known.decimals || 18),
      };
      tokenMetaCache.current[lower] = meta;
      return meta;
    }

    const provider = providerOverride || getReadOnlyProvider(false, true);
    const erc20 = new Contract(tokenAddress, ERC20_ABI, provider);
    const [symbol, decimals] = await Promise.all([
      erc20.symbol().catch(() => "TOKEN"),
      erc20.decimals().catch(() => 18),
    ]);
    const meta = { address: tokenAddress, symbol: String(symbol || "TOKEN"), decimals: Number(decimals || 18) };
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
      const [maxCreatorReward, maxVaultPercentage, tickSpacing, poolFee, tokenSupply, weth] =
        await Promise.all([
          currentx.MAX_CREATOR_REWARD(),
          currentx.MAX_VAULT_PERCENTAGE(),
          currentx.TICK_SPACING(),
          currentx.POOL_FEE(),
          currentx.TOKEN_SUPPLY(),
          currentx.weth(),
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
      setDeployments(
        (list || []).map((item) => ({
          token: item.token,
          positionId: String(item.positionId || ""),
          locker: item.locker,
        }))
      );
    } catch (error) {
      setDeployments([]);
      setDeploymentsError(errMsg(error, "Unable to load deployed tokens."));
    } finally {
      setDeploymentsLoading(false);
    }
  }, [address, contracts.currentx]);

  const refreshVault = useCallback(async () => {
    if (!isAddress(contracts.vault) || !isAddress(vaultForm.token)) {
      setVaultInfo((prev) => ({ ...prev, allocation: null, error: "" }));
      setVaultTokenMeta(null);
      return;
    }
    try {
      setVaultInfo((prev) => ({ ...prev, loading: true, error: "" }));
      const provider = getReadOnlyProvider(false, true);
      const vault = new Contract(contracts.vault, CURRENTX_VAULT_ABI, provider);
      const [allocation, minimumVaultTime, meta] = await Promise.all([
        vault.allocation(vaultForm.token),
        vault.minimumVaultTime(),
        resolveTokenMeta(vaultForm.token, provider),
      ]);
      setVaultTokenMeta(meta);
      setVaultInfo({
        loading: false,
        error: "",
        allocation: {
          token: allocation.token,
          amount: allocation.amount,
          endTime: allocation.endTime,
          admin: allocation.admin,
        },
        minimumVaultTime,
      });
    } catch (error) {
      setVaultInfo((prev) => ({ ...prev, loading: false, error: errMsg(error, "Unable to load vault info.") }));
    }
  }, [contracts.vault, resolveTokenMeta, vaultForm.token]);

  const refreshLocker = useCallback(async () => {
    if (!address || !isAddress(contracts.locker)) {
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
    } catch (error) {
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
      const info = await lockerContract.tokenRewards(BigInt(locker.selectedId));
      setLocker((prev) => ({
        ...prev,
        tokenReward: {
          lpTokenId: String(info.lpTokenId || ""),
          creatorReward: info.creatorReward,
          creatorAdmin: info.creator?.admin || "",
          creatorRecipient: info.creator?.recipient || "",
          interfaceAdmin: info.interfacer?.admin || "",
          interfaceRecipient: info.interfacer?.recipient || "",
        },
      }));
    } catch (error) {
      setLocker((prev) => ({ ...prev, error: errMsg(error, "Unable to load selected reward info."), tokenReward: null }));
    }
  }, [contracts.locker, locker.selectedId]);

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
    setVaultForm((prev) => ({ ...prev, depositAdmin: prev.depositAdmin || address, withdrawTo: prev.withdrawTo || address }));
  }, [address]);

  useEffect(() => {
    refreshProtocol();
  }, [refreshProtocol]);

  useEffect(() => {
    refreshDeployments();
  }, [refreshDeployments]);

  useEffect(() => {
    refreshVault();
  }, [refreshVault]);

  useEffect(() => {
    refreshLocker();
  }, [refreshLocker]);

  useEffect(() => {
    refreshLockerReward();
  }, [refreshLockerReward]);

  useEffect(() => {
    if (protocol.weth && !isAddress(deployForm.pairedToken)) {
      setDeployForm((prev) => ({ ...prev, pairedToken: protocol.weth }));
    }
  }, [deployForm.pairedToken, protocol.weth]);

  const uploadPngToIpfs = useCallback(async ({ dataBase64, fileName, fileBytes }) => {
    try {
      const hasRawFile = fileBytes instanceof Uint8Array && fileBytes.length > 0;
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

      const sendJsonUpload = async (base64Payload) =>
        fetch(IPFS_UPLOAD_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: fileName || "token-image.png",
            contentType: "image/png",
            dataBase64: base64Payload,
          }),
        });

      let parsedResult = null;
      let rawFailureResult = null;

      if (hasRawFile) {
        const rawUploadRes = await fetch(IPFS_UPLOAD_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "image/png",
            "X-File-Name": String(fileName || "token-image.png"),
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
            const jsonUploadRes = await sendJsonUpload(base64Payload);
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
        const jsonUploadRes = await sendJsonUpload(String(dataBase64 || ""));
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
      const message = String(error?.message || "");
      if (message.toLowerCase().includes("failed to fetch")) {
        throw new Error("Cannot reach IPFS upload API. If local, run backend API (vercel dev) or deploy latest changes.");
      }
      throw error;
    }
  }, []);

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
      const lockupDays = Number(parseUint(deployForm.lockupDays, "Lockup period (days)"));
      const vestingDays = Number(parseUint(deployForm.vestingDays, "Vesting period (days)"));
      if (vaultPercentageNum > 0) {
        if (lockupDays < 7) throw new Error("Lockup period must be at least 7 days.");
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
        throw new Error(`Wrong network in wallet. Switch to ${NETWORK_NAME} (chain ${defaultChainId}).`);
      }
      const signer = await provider.getSigner();
      const currentx = new Contract(contracts.currentx, CURRENTX_ABI, signer);

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
      if (txValue > 0n && deployForm.useCustomCreatorBuyRecipient) {
        throw new Error(
          "Custom recipient for Creator Buy is not supported by deployToken. Disable custom recipient or set ETH amount to 0."
        );
      }
      const initialBuyMinOutRaw = parseUint(deployForm.pairedTokenSwapAmountOutMinimum, "Initial buy min out");
      const initialBuyMinOutFinal = txValue > 0n && initialBuyMinOutRaw === "0" ? "1" : initialBuyMinOutRaw;
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
          originatingChainId: BigInt(parseUint(deployForm.originatingChainId, "Originating chain id")),
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
          pairedTokenSwapAmountOutMinimum: BigInt(initialBuyMinOutFinal),
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
      setDeployAction({ loading: false, error: errMsg(error, "Deploy failed."), hash: "", message: "" });
    }
  };

  const handleClaimRewards = async (tokenAddress) => {
    if (!address) {
      if (typeof onConnect === "function") onConnect();
      return;
    }
    try {
      setClaimAction({ loadingKey: tokenAddress.toLowerCase(), error: "", hash: "", message: "Claiming rewards..." });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const currentx = new Contract(contracts.currentx, CURRENTX_ABI, signer);
      const tx = await currentx.claimRewards(tokenAddress);
      const receipt = await tx.wait();
      setClaimAction({ loadingKey: "", error: "", hash: receipt.hash || tx.hash || "", message: "Rewards claimed." });
    } catch (error) {
      setClaimAction({ loadingKey: "", error: errMsg(error, "Claim failed."), hash: "", message: "" });
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
      const meta = await resolveTokenMeta(vaultForm.token, provider);
      const amount = parseTokenAmount(vaultForm.approveAmount, meta.decimals, "Approve amount");
      const erc20 = new Contract(vaultForm.token, ERC20_ABI, signer);
      const tx = await erc20.approve(contracts.vault, amount);
      const receipt = await tx.wait();
      setVaultAction({ loadingKey: "", error: "", hash: receipt.hash || tx.hash || "", message: "Allowance updated." });
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
      const meta = await resolveTokenMeta(vaultForm.token, provider);
      const amount = parseTokenAmount(vaultForm.depositAmount, meta.decimals, "Deposit amount");
      const unlockMs = Date.parse(vaultForm.depositUnlockAt || "");
      if (!Number.isFinite(unlockMs)) throw new Error("Unlock date is invalid.");
      const unlockTime = Math.floor(unlockMs / 1000);
      const now = Math.floor(Date.now() / 1000);
      if (unlockTime <= now) throw new Error("Unlock date must be in the future.");
      const minTime = Number(vaultInfo.minimumVaultTime || 0n);
      if (minTime > 0 && unlockTime - now < minTime) {
        throw new Error(`Unlock date must be at least ${minTime} seconds from now.`);
      }
      const admin = vaultForm.depositAdmin || address;
      if (!isAddress(admin)) throw new Error("Deposit admin is invalid.");

      const vault = new Contract(contracts.vault, CURRENTX_VAULT_ABI, signer);
      const tx = await vault.deposit(vaultForm.token, amount, unlockTime, admin);
      const receipt = await tx.wait();
      setVaultAction({ loadingKey: "", error: "", hash: receipt.hash || tx.hash || "", message: "Deposit completed." });
      await refreshVault();
    } catch (error) {
      setVaultAction({ loadingKey: "", error: errMsg(error, "Deposit failed."), hash: "", message: "" });
    }
  };

  const handleVaultWithdraw = async () => {
    if (!address) {
      if (typeof onConnect === "function") onConnect();
      return;
    }
    try {
      setVaultAction({ loadingKey: "withdraw", error: "", hash: "", message: "Withdrawing..." });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const meta = await resolveTokenMeta(vaultForm.token, provider);
      const amount = parseTokenAmount(vaultForm.withdrawAmount, meta.decimals, "Withdraw amount");
      const to = vaultForm.withdrawTo || address;
      if (!isAddress(to)) throw new Error("Withdraw recipient is invalid.");

      const vault = new Contract(contracts.vault, CURRENTX_VAULT_ABI, signer);
      const tx = await vault.withdraw(vaultForm.token, amount, to);
      const receipt = await tx.wait();
      setVaultAction({ loadingKey: "", error: "", hash: receipt.hash || tx.hash || "", message: "Withdraw completed." });
      await refreshVault();
    } catch (error) {
      setVaultAction({ loadingKey: "", error: errMsg(error, "Withdraw failed."), hash: "", message: "" });
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
    { id: "create", label: "Create Token", hint: "Deploy a new token" },
    { id: "deployments", label: "My Tokens", hint: "Claim rewards and manage deployed tokens" },
    { id: "vault", label: "Vault", hint: "Approve, deposit, withdraw" },
    { id: "locker", label: "Locker", hint: "Read rewards and collect fees" },
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
  const rewardsEnabled = rewardExtensionEnabled || rewardsCustomized;
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
  const creatorBuyAmount = useMemo(() => {
    const value = Number.parseFloat(String(deployForm.txValueEth || "0"));
    return Number.isFinite(value) ? value : 0;
  }, [deployForm.txValueEth]);
  const creatorBuyEnabled = creatorBuyAmount > 0;
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
  const rewardsStatusLabel = !rewardsEnabled
    ? "Disabled"
    : rewardsCustomized
      ? "Configured"
      : openSections.rewards
        ? "Not configured"
        : "Empty";
  const rewardsStatusTone = !rewardsEnabled ? "neutral" : rewardsCustomized ? "good" : "warn";
  const rewardStatusSummary = !rewardsEnabled
    ? "Disabled"
    : rewardsCustomized
      ? `${allocatedRewardsLabel}% ${rewardTypeLabel}`
      : "Enabled";
  const vaultStatusLabel = vaultEnabled ? "Configured" : "Disabled";
  const vaultStatusSummary = vaultEnabled
    ? `${deployForm.vaultPercentage || "0"}% • ${deployForm.lockupDays || "0"}d lock • ${deployForm.vestingDays || "0"}d vest`
    : "Disabled";
  const creatorBuyStatusLabel = creatorBuyEnabled ? "Configured" : "Disabled";
  const creatorBuyStatusSummary = creatorBuyEnabled ? `${creatorBuyAmountLabel} ETH` : "Disabled";
  const rewardsSummaryLine = `${rewardTypeLabel} • ${allocatedRewardsLabel}% • ${rewardRecipientCount} recipient${
    rewardRecipientCount === 1 ? "" : "s"
  }`;
  const vaultSummaryLine = `${deployForm.vaultPercentage || "0"}% • ${deployForm.lockupDays || "0"}d lock • ${
    deployForm.vestingDays || "0"
  }d vest`;
  const creatorBuySummaryLine = `${creatorBuyAmountLabel} ETH`;
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
  const handleToggleRewardsExtension = useCallback(
    (enabled) => {
      setRewardExtensionEnabled(enabled);
      if (enabled) {
        setOpenSections((prev) => ({ ...prev, rewards: true }));
        setRewardAddressEditing(true);
        setDeployForm((prev) => ({
          ...prev,
          creatorAdmin: prev.creatorAdmin || address || "",
          creatorRewardRecipient: prev.creatorRewardRecipient || address || "",
        }));
        return;
      }
      setRewardAddressEditing(false);
      setOpenSections((prev) => ({ ...prev, rewards: false }));
      setDeployForm((prev) => ({
        ...prev,
        creatorAdmin: address || "",
        creatorRewardRecipient: address || "",
        creatorReward: "80",
        creatorRewardType: "paired",
        useCustomTeamRewardRecipient: false,
        teamRewardRecipient: autoProtocolRecipient || "",
      }));
    },
    [address, autoProtocolRecipient]
  );
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
  const handleToggleCreatorBuyExtension = useCallback((enabled) => {
    setOpenSections((prev) => ({ ...prev, buy: enabled }));
    setDeployForm((prev) => {
      const current = Number.parseFloat(String(prev.txValueEth || "0"));
      const nextAmount =
        enabled && !(Number.isFinite(current) && current > 0) ? CREATOR_BUY_ETH_PRESETS[0] || "0.1" : prev.txValueEth;
      return {
        ...prev,
        txValueEth: enabled ? nextAmount : "0",
        useCustomCreatorBuyRecipient: enabled ? prev.useCustomCreatorBuyRecipient : false,
        creatorBuyRecipient: enabled ? prev.creatorBuyRecipient : "",
      };
    });
  }, []);
  useEffect(() => {
    if (rewardsCustomized) setRewardExtensionEnabled(true);
  }, [rewardsCustomized]);
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
            <span className={creatorBuyEnabled ? "text-emerald-200" : "text-slate-300/75"}>
              {creatorBuyEnabled ? "On" : "Off"}
            </span>
          </div>
          {creatorBuyEnabled ? <div className="text-[11px] text-slate-300/75">{creatorBuySummaryLine}</div> : null}
        </div>
        <div className="space-y-1 rounded-lg border border-slate-700/55 bg-slate-900/35 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-300/80">Reward Recipients</span>
            <span className={rewardsEnabled ? "text-emerald-200" : "text-slate-300/75"}>
              {rewardsEnabled ? "On" : "Off"}
            </span>
          </div>
          {rewardsEnabled ? <div className="text-[11px] text-slate-300/75">{rewardsSummaryLine}</div> : null}
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
              CurrentxVault and LpLockerv2 extensions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                refreshProtocol();
                refreshDeployments();
                refreshVault();
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {launchpadViews.map((view, index) => (
          <button
            key={view.id}
            type="button"
            onClick={() => setActiveView(view.id)}
            className={`cx-fade-up cx-tab-button rounded-2xl border px-4 py-3 text-left transition ${
              activeView === view.id
                ? "cx-tab-button-active border-cyan-300/60 bg-gradient-to-br from-sky-500/20 via-cyan-400/18 to-emerald-400/14 text-cyan-50 shadow-[0_12px_28px_rgba(56,189,248,0.22)]"
                : "border-slate-700/60 bg-slate-950/45 text-slate-200 hover:border-slate-500 hover:bg-slate-900/60"
            }`}
            style={{ animationDelay: `${80 + index * 55}ms` }}
          >
            <div className="font-display text-sm font-semibold">{view.label}</div>
            <div className="mt-1 text-xs text-slate-300/70">{view.hint}</div>
          </button>
        ))}
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
                headerAction={<SectionEnableToggle enabled={rewardsEnabled} onToggle={handleToggleRewardsExtension} />}
              >
                <div className="text-xs text-slate-300/75">
                  What this does: configures how creator-side rewards are split and distributed.
                </div>
                {!rewardsEnabled ? (
                  <div className="rounded-xl border border-slate-700/60 bg-slate-900/45 px-3 py-2 text-sm text-slate-300/80">
                    Disabled.
                  </div>
                ) : (
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
                )}
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
                      <input
                        value={deployForm.lockupDays}
                        onChange={(e) => setDeployForm((prev) => ({ ...prev, lockupDays: e.target.value }))}
                        placeholder="30"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <SelectorPills
                      value={VAULT_DAY_PRESETS.includes(String(deployForm.lockupDays)) ? String(deployForm.lockupDays) : ""}
                      onChange={(value) => setDeployForm((prev) => ({ ...prev, lockupDays: value }))}
                      columns={4}
                      options={VAULT_DAY_PRESETS.map((value) => ({ value, label: `${value} days` }))}
                    />
                    <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                      Vesting must be &gt;= lockup. Lockup minimum is 7 days.
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs text-slate-300/80">Vesting Period</div>
                      <input
                        value={deployForm.vestingDays}
                        onChange={(e) => setDeployForm((prev) => ({ ...prev, vestingDays: e.target.value }))}
                        placeholder="30"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <SelectorPills
                      value={VAULT_DAY_PRESETS.includes(String(deployForm.vestingDays)) ? String(deployForm.vestingDays) : ""}
                      onChange={(value) => setDeployForm((prev) => ({ ...prev, vestingDays: value }))}
                      columns={4}
                      options={VAULT_DAY_PRESETS.map((value) => ({ value, label: `${value} days` }))}
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
                statusTone={creatorBuyEnabled ? "good" : "neutral"}
                headerAction={<SectionEnableToggle enabled={creatorBuyEnabled} onToggle={handleToggleCreatorBuyExtension} />}
              >
                <div className="text-xs text-slate-300/75">
                  What this does: executes an optional initial buy right after deployment.
                </div>
                {!creatorBuyEnabled ? (
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
                          onChange={(e) => setDeployForm((prev) => ({ ...prev, txValueEth: e.target.value }))}
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
                          {Number.parseFloat(String(deployForm.txValueEth || "0")) > 0 ? (
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
                    setRewardExtensionEnabled(false);
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
              <div className="font-display text-lg font-semibold">My Deployments</div>
              <div className="text-xs text-slate-300/70">`getTokensDeployedByUser` + `claimRewards`</div>
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
            {deployments.map((item) => (
              <div key={`${item.token}-${item.positionId}`} className={`${TONED_PANEL_CLASS} p-3`}>
                <div className="text-xs text-slate-400/75">Token</div>
                <div className="font-mono text-sm break-all">{item.token}</div>
                <div className="mt-1 text-xs text-slate-300">Position ID: {item.positionId || "--"}</div>
                <div className="text-xs text-slate-300">Locker: {item.locker || "--"}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={claimAction.loadingKey === item.token.toLowerCase()}
                    onClick={() => handleClaimRewards(item.token)}
                    className={CYAN_BUTTON_CLASS}
                  >
                    {claimAction.loadingKey === item.token.toLowerCase() ? "Claiming..." : "Claim rewards"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVaultForm((prev) => ({ ...prev, token: item.token }))}
                    className={SOFT_BUTTON_CLASS}
                  >
                    Use in vault
                  </button>
                </div>
              </div>
            ))}
          </div>
          <ActionInfo state={claimAction} />
        </div>
      </div>

      <div className={`mt-6 ${activeView === "vault" || activeView === "locker" ? "grid gap-6 xl:grid-cols-1" : "hidden"}`}>
        <div className={`${PANEL_CLASS} ${activeView === "vault" ? "cx-panel-enter" : "hidden"}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-lg font-semibold">CurrentxVault</div>
              <div className="text-xs text-slate-300/70">`allocation`, `deposit`, `withdraw`</div>
            </div>
            <button
              type="button"
              onClick={refreshVault}
              className={SOFT_BUTTON_CLASS}
            >
              Reload
            </button>
          </div>

          <div className="mt-3 space-y-3">
            <AddressField
              label="Token"
              value={vaultForm.token}
              onChange={(value) => setVaultForm((prev) => ({ ...prev, token: value }))}
              required
            />
            <div className="text-xs text-slate-300/75">
              Token meta: {vaultTokenMeta ? `${vaultTokenMeta.symbol} (${vaultTokenMeta.decimals} decimals)` : "--"}
            </div>
            {vaultInfo.error ? (
              <div className="rounded-xl border border-amber-500/45 bg-amber-500/15 px-3 py-2 text-xs text-amber-100">{vaultInfo.error}</div>
            ) : null}

            <div className={`${TONED_PANEL_CLASS} space-y-1 px-3 py-2 text-xs text-slate-200`}>
              <div>
                Allocation amount: {vaultInfo.allocation ? `${formatAmount(vaultInfo.allocation.amount, vaultTokenMeta?.decimals || 18, 6)} ${vaultTokenMeta?.symbol || ""}` : "--"}
              </div>
              <div>Unlock time: {vaultInfo.allocation ? formatDate(vaultInfo.allocation.endTime) : "--"}</div>
              <div>Admin: {vaultInfo.allocation?.admin ? shorten(vaultInfo.allocation.admin) : "--"}</div>
              <div>Minimum vault time: {vaultInfo.minimumVaultTime ? `${vaultInfo.minimumVaultTime}s` : "--"}</div>
            </div>

            <details className={`${TONED_PANEL_CLASS} p-3`}>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-200/85">
                1) Approve token
              </summary>
              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                <input
                  value={vaultForm.approveAmount}
                  onChange={(e) => setVaultForm((prev) => ({ ...prev, approveAmount: e.target.value }))}
                  placeholder="Approve amount"
                  className={INPUT_CLASS}
                />
                <button
                  type="button"
                  onClick={handleVaultApprove}
                  disabled={vaultAction.loadingKey === "approve"}
                  className={CYAN_BUTTON_CLASS}
                >
                  {vaultAction.loadingKey === "approve" ? "Approving..." : "Approve"}
                </button>
              </div>
            </details>

            <details className={`${TONED_PANEL_CLASS} p-3`}>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-200/85">
                2) Deposit allocation
              </summary>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <input
                  value={vaultForm.depositAmount}
                  onChange={(e) => setVaultForm((prev) => ({ ...prev, depositAmount: e.target.value }))}
                  placeholder="Deposit amount"
                  className={INPUT_CLASS}
                />
                <input
                  type="datetime-local"
                  value={vaultForm.depositUnlockAt}
                  onChange={(e) => setVaultForm((prev) => ({ ...prev, depositUnlockAt: e.target.value }))}
                  className={INPUT_CLASS}
                />
                <AddressField
                  label="Deposit admin"
                  value={vaultForm.depositAdmin}
                  onChange={(value) => setVaultForm((prev) => ({ ...prev, depositAdmin: value }))}
                  required
                />
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleVaultDeposit}
                  disabled={vaultAction.loadingKey === "deposit"}
                  className={PRIMARY_BUTTON_CLASS}
                >
                  {vaultAction.loadingKey === "deposit" ? "Depositing..." : "Deposit"}
                </button>
              </div>
            </details>

            <details className={`${TONED_PANEL_CLASS} p-3`}>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-200/85">
                3) Withdraw allocation
              </summary>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <input
                  value={vaultForm.withdrawAmount}
                  onChange={(e) => setVaultForm((prev) => ({ ...prev, withdrawAmount: e.target.value }))}
                  placeholder="Withdraw amount"
                  className={INPUT_CLASS}
                />
                <AddressField
                  label="Withdraw recipient"
                  value={vaultForm.withdrawTo}
                  onChange={(value) => setVaultForm((prev) => ({ ...prev, withdrawTo: value }))}
                  required
                />
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleVaultWithdraw}
                  disabled={vaultAction.loadingKey === "withdraw"}
                  className={AMBER_BUTTON_CLASS}
                >
                  {vaultAction.loadingKey === "withdraw" ? "Withdrawing..." : "Withdraw"}
                </button>
              </div>
            </details>
          </div>
          <ActionInfo state={vaultAction} />
        </div>

        <div className={`${PANEL_CLASS} ${activeView === "locker" ? "cx-panel-enter" : "hidden"}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-lg font-semibold">LpLockerv2</div>
              <div className="text-xs text-slate-300/70">`getLpTokenIdsForCreator`, `tokenRewards`, `collectRewards`</div>
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

          <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
            <div className={`${TONED_PANEL_CLASS} px-3 py-2`}>TEAM_REWARD: {locker.teamReward ? String(locker.teamReward) : "--"}</div>
            <div className={`${TONED_PANEL_CLASS} px-3 py-2`}>MAX_CREATOR_REWARD: {locker.maxCreatorReward ? String(locker.maxCreatorReward) : "--"}</div>
          </div>

          <div className="mt-3 space-y-3">
            <select
              value={locker.selectedId}
              onChange={(e) => setLocker((prev) => ({ ...prev, selectedId: e.target.value }))}
              className={INPUT_CLASS}
            >
              {!locker.ids.length ? <option value="">No LP token IDs</option> : null}
              {locker.ids.map((tokenId) => (
                <option key={tokenId} value={tokenId}>
                  {tokenId}
                </option>
              ))}
            </select>

            <div className={`${TONED_PANEL_CLASS} space-y-1 px-3 py-2 text-xs text-slate-200`}>
              <div>Creator reward: {locker.tokenReward ? String(locker.tokenReward.creatorReward) : "--"}</div>
              <div>Creator admin: {locker.tokenReward?.creatorAdmin || "--"}</div>
              <div>Creator recipient: {locker.tokenReward?.creatorRecipient || "--"}</div>
              <div>Interface admin: {locker.tokenReward?.interfaceAdmin || "--"}</div>
              <div>Interface recipient: {locker.tokenReward?.interfaceRecipient || "--"}</div>
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
