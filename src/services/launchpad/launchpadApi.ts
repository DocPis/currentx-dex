import type {
  LaunchpadActivityQuery,
  LaunchpadActivityResponse,
  LaunchpadCandle,
  LaunchpadTokenCard,
  LaunchpadTokensQuery,
  LaunchpadTokensResponse,
} from "./types";
import {
  getMockLaunchpadActivity,
  getMockLaunchpadCandles,
  getMockLaunchpadTokenActivity,
  getMockLaunchpadTokenDetail,
  getMockLaunchpadTokens,
} from "./launchpadMock";

const ENV = typeof import.meta !== "undefined" ? import.meta.env || {} : {};
const MOCK_FLAG = String(ENV.VITE_LAUNCHPAD_USE_MOCK || "").trim().toLowerCase();
const FORCE_MOCK = MOCK_FLAG === "1" || MOCK_FLAG === "true" || MOCK_FLAG === "yes";
const FALLBACK_FLAG = String(ENV.VITE_LAUNCHPAD_FALLBACK_TO_MOCK || "").trim().toLowerCase();
const ALLOW_MOCK_FALLBACK =
  FALLBACK_FLAG === "1" || FALLBACK_FLAG === "true" || FALLBACK_FLAG === "yes";
const RAW_API_BASE = String(ENV.VITE_LAUNCHPAD_API_BASE || "").trim().replace(/\/+$/u, "");
const MODE = String(ENV.MODE || "").trim().toLowerCase();
// In local dev/test we keep the old behavior (mock by default unless API_BASE is configured).
// In production/staging builds we assume a same-origin backend at /api/launchpad/*.
const IS_DEV_MODE = MODE === "development" || MODE === "test";

const isLocalHostname = (hostname: string) => {
  const value = String(hostname || "").trim().toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "0.0.0.0";
};

const hostFromUrl = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

// Prevent accidentally shipping a build that calls a localhost API from a public domain.
const RAW_API_BASE_HOST = hostFromUrl(RAW_API_BASE);
const SHOULD_IGNORE_RAW_API_BASE =
  Boolean(RAW_API_BASE_HOST) &&
  isLocalHostname(RAW_API_BASE_HOST) &&
  typeof window !== "undefined" &&
  !isLocalHostname(window.location.hostname);
const API_BASE = SHOULD_IGNORE_RAW_API_BASE ? "" : RAW_API_BASE;

const buildUrl = (path: string, query: Record<string, string | number | boolean | undefined> = {}) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  const basePath = API_BASE ? `${API_BASE}${path}` : path;
  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
};

class LaunchpadApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "LaunchpadApiError";
    this.status = status;
  }
}

const shouldFallbackToMock = (error: unknown) => {
  if (FORCE_MOCK) return true;
  if (!ALLOW_MOCK_FALLBACK) return false;
  if (!(error instanceof LaunchpadApiError)) return true;
  if (error.status === 404 || error.status === 405 || error.status === 501) return true;
  if (error.status >= 500) return true;
  return false;
};

const fetchJson = async <T>(url: string, signal?: AbortSignal): Promise<T> => {
  const response = await fetch(url, {
    method: "GET",
    signal,
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new LaunchpadApiError(`Launchpad API request failed (${response.status})`, response.status);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new LaunchpadApiError("Launchpad API returned invalid JSON", response.status);
  }
};

const useRealApi = () => {
  if (FORCE_MOCK) return false;
  if (API_BASE) return true;
  return !IS_DEV_MODE;
};

const withFallback = async <T>(
  runReal: () => Promise<T>,
  runMock: () => Promise<T>
): Promise<T> => {
  if (!useRealApi()) {
    return runMock();
  }
  try {
    return await runReal();
  } catch (error) {
    if (shouldFallbackToMock(error)) {
      return runMock();
    }
    throw error;
  }
};

export const isLaunchpadUsingMock = () => !useRealApi() || FORCE_MOCK;

export const fetchLaunchpadTokens = async (
  query: LaunchpadTokensQuery = {},
  signal?: AbortSignal
): Promise<LaunchpadTokensResponse> => {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.max(1, Number(query.pageSize) || 24);
  const q = String(query.q || "").trim();
  const sort = query.sort || "mcap";
  const filters = Array.isArray(query.filters) ? query.filters : [];

  return withFallback(
    async () => {
      // TODO(backend): implement GET /api/launchpad/tokens?page=&q=&sort=&filters=
      const url = buildUrl("/api/launchpad/tokens", {
        page,
        pageSize,
        q,
        sort,
        filters: filters.join(","),
      });
      return fetchJson<LaunchpadTokensResponse>(url, signal);
    },
    () => getMockLaunchpadTokens({ page, pageSize, q, sort, filters })
  );
};

export const fetchLaunchpadTokenDetail = async (
  address: string,
  signal?: AbortSignal
): Promise<LaunchpadTokenCard | null> => {
  const tokenAddress = String(address || "").trim();
  if (!tokenAddress) return null;

  return withFallback(
    async () => {
      // Primary: GET /api/launchpad/tokens/:address
      // Fallback: GET /api/launchpad/tokens?address=0x...
      //
      // Some hosts/proxies don't support dynamic function routes reliably; this keeps the UI working.
      const primaryUrl = buildUrl(`/api/launchpad/tokens/${tokenAddress}`);
      try {
        return await fetchJson<LaunchpadTokenCard>(primaryUrl, signal);
      } catch (error) {
        // Map 404s to `null` (token genuinely missing) instead of treating them as hard errors.
        if (error instanceof LaunchpadApiError && error.status === 404) return null;

        // If the dynamic route isn't available (or doesn't pass the param), retry via query string.
        if (error instanceof LaunchpadApiError && [400, 404, 405].includes(error.status)) {
          const fallbackUrl = buildUrl("/api/launchpad/tokens", { address: tokenAddress });
          try {
            return await fetchJson<LaunchpadTokenCard>(fallbackUrl, signal);
          } catch (fallbackError) {
            if (fallbackError instanceof LaunchpadApiError && fallbackError.status === 404) return null;
            throw fallbackError;
          }
        }

        throw error;
      }
    },
    () => getMockLaunchpadTokenDetail(tokenAddress)
  );
};

export const fetchLaunchpadTokenCandles = async (
  address: string,
  tf = "24h",
  signal?: AbortSignal
): Promise<LaunchpadCandle[]> => {
  const tokenAddress = String(address || "").trim();
  const timeframe = String(tf || "24h").trim() || "24h";
  if (!tokenAddress) return [];

  return withFallback(
    async () => {
      // TODO(backend): implement GET /api/launchpad/tokens/:address/candles?tf=
      const url = buildUrl(`/api/launchpad/tokens/${tokenAddress}/candles`, { tf: timeframe });
      const payload = await fetchJson<{ items: LaunchpadCandle[] } | LaunchpadCandle[]>(url, signal);
      return Array.isArray(payload) ? payload : payload.items || [];
    },
    () => getMockLaunchpadCandles(tokenAddress, timeframe)
  );
};

export const fetchLaunchpadActivity = async (
  query: LaunchpadActivityQuery = {},
  signal?: AbortSignal
): Promise<LaunchpadActivityResponse> => {
  const limit = Math.max(1, Number(query.limit) || 20);
  const type = query.type || "buys";

  return withFallback(
    async () => {
      // TODO(backend): implement GET /api/launchpad/activity?type=buys&limit=
      const url = buildUrl("/api/launchpad/activity", { type, limit });
      return fetchJson<LaunchpadActivityResponse>(url, signal);
    },
    () => getMockLaunchpadActivity({ type, limit })
  );
};

export const fetchLaunchpadTokenActivity = async (
  address: string,
  query: LaunchpadActivityQuery = {},
  signal?: AbortSignal
): Promise<LaunchpadActivityResponse> => {
  const tokenAddress = String(address || "").trim();
  if (!tokenAddress) return { items: [], updatedAt: new Date().toISOString() };
  const limit = Math.max(1, Number(query.limit) || 40);
  const type = query.type || "trades";

  return withFallback(
    async () => {
      // TODO(backend): implement GET /api/launchpad/tokens/:address/activity?limit=&type=
      const url = buildUrl(`/api/launchpad/tokens/${tokenAddress}/activity`, { type, limit });
      return fetchJson<LaunchpadActivityResponse>(url, signal);
    },
    () => getMockLaunchpadTokenActivity(tokenAddress, { type, limit })
  );
};

const deriveWsFromApiBase = () => {
  if (!API_BASE) return "";
  if (API_BASE.startsWith("https://")) return API_BASE.replace(/^https:\/\//u, "wss://");
  if (API_BASE.startsWith("http://")) return API_BASE.replace(/^http:\/\//u, "ws://");
  return "";
};

export const getLaunchpadWsUrl = () => {
  const explicit = String(ENV.VITE_LAUNCHPAD_WS_URL || "").trim();
  if (explicit) return explicit;
  const derived = deriveWsFromApiBase();
  if (!derived) return "";
  // TODO(backend): expose WS endpoint at /api/launchpad/ws
  return `${derived}/api/launchpad/ws`;
};
