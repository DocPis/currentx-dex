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
const API_BASE = String(ENV.VITE_LAUNCHPAD_API_BASE || "").trim().replace(/\/+$/u, "");

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

const useRealApi = () => Boolean(API_BASE) && !FORCE_MOCK;

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
      // TODO(backend): implement GET /api/launchpad/tokens/:address
      const url = buildUrl(`/api/launchpad/tokens/${tokenAddress}`);
      return fetchJson<LaunchpadTokenCard>(url, signal);
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
