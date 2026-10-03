import { AdminApiError, parseApiError } from "@/lib/api-error";
import { coordinatedRefresh } from "@/lib/refresh-coordinator";
import type { ApiResponse } from "@/types/admin";
import { resolveApiBase } from "@/lib/api-base";

/** Single source of truth: lib/api-base.ts. */
function resolveBase(): string {
  return resolveApiBase();
}

/**
 * This app's auth audience. The API host is shared by customer, partner and admin, so the HttpOnly
 * refresh cookie is keyed per audience (hg_rt_admin here) — signing into the console must not
 * overwrite a customer session in the same browser. The header is also a CSRF control on refresh.
 */
const AUTH_AUDIENCE = "admin";
const authHeaders = (h: Record<string, string> = {}): Record<string, string> => ({
  ...h,
  "X-Homigo-Audience": AUTH_AUDIENCE,
});

export type ApiClientConfig = {
  getAccessToken: () => string | null;
  /** A session may exist (the refresh token itself is an HttpOnly cookie, not visible to JS). */
  hasSession: () => boolean;
  setAccessToken: (accessToken: string) => void;
  clearSession: () => void;
};

let clientConfig: ApiClientConfig | null = null;

export function configureApiClient(config: ApiClientConfig): void {
  clientConfig = config;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  skipRefresh?: boolean;
  query?: Record<string, string | number | boolean | undefined | null>;
};

async function parseJson<T>(res: Response): Promise<ApiResponse<T>> {
  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return { success: false, error: res.statusText || "Invalid response" };
  }
}

export async function ensureAccessToken(): Promise<boolean> {
  if (clientConfig?.getAccessToken()) return true;
  if (!clientConfig?.hasSession()) return false;
  return coordinatedRefresh(refreshAccessToken);
}

async function refreshAccessToken(): Promise<boolean> {
  if (!clientConfig) return false;
  if (!clientConfig.hasSession()) return false;

  const { getDeviceId, getDeviceName } = await import("@/lib/device");
  let res: Response;
  try {
    res = await fetch(`${resolveBase()}/api/auth/refresh`, {
      method: "POST",
      credentials: "include", // the HttpOnly refresh cookie IS the credential
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ deviceId: getDeviceId(), deviceName: getDeviceName() }),
    });
  } catch {
    return false;
  }

  const body = await parseJson<{ accessToken?: string }>(res);
  if (!res.ok || !body.success || !body.data?.accessToken) {
    return false;
  }

  clientConfig.setAccessToken(body.data.accessToken);
  return true;
}

function buildQuery(params?: RequestOptions["query"]): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, auth = false, skipRefresh = false, query } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (auth && clientConfig) {
    const token = clientConfig.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const url = `${resolveBase()}${path}${buildQuery(query)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "include",
      headers: authHeaders(headers),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AdminApiError(
      "Could not reach backend API. Check that the API server is running.",
      0,
      "NETWORK_ERROR",
    );
  }

  if (res.status === 401 && auth && !skipRefresh && clientConfig?.hasSession()) {
    const refreshed = await coordinatedRefresh(refreshAccessToken);
    if (refreshed) {
      return apiRequest<T>(path, { ...options, skipRefresh: true });
    }
    clientConfig.clearSession();
  }

  const json = await parseJson<T>(res);
  if (!res.ok || !json.success) {
    throw parseApiError(json, res.status);
  }
  return json as T & ApiResponse<T>;
}

/** Plain-text responses (CSV exports, etc.) — skips JSON envelope parsing. */
export async function apiRequestText(
  path: string,
  options: Omit<RequestOptions, "body"> = {},
): Promise<string> {
  const { method = "GET", auth = false, skipRefresh = false, query } = options;

  const headers: Record<string, string> = {};
  if (auth && clientConfig) {
    const token = clientConfig.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const url = `${resolveBase()}${path}${buildQuery(query)}`;

  let res: Response;
  try {
    res = await fetch(url, { method, credentials: "include", headers: authHeaders(headers) });
  } catch {
    throw new AdminApiError(
      "Could not reach backend API. Check that the API server is running.",
      0,
      "NETWORK_ERROR",
    );
  }

  if (res.status === 401 && auth && !skipRefresh && clientConfig?.hasSession()) {
    const refreshed = await coordinatedRefresh(refreshAccessToken);
    if (refreshed) {
      return apiRequestText(path, { ...options, skipRefresh: true });
    }
    clientConfig.clearSession();
  }

  if (!res.ok) {
    const json = await parseJson<unknown>(res);
    throw parseApiError(json, res.status);
  }

  return res.text();
}

/** Binary file responses (PDF, images, etc.) — skips JSON envelope parsing. */
export async function apiRequestBlob(
  path: string,
  options: Omit<RequestOptions, "body"> = {},
): Promise<Blob> {
  const { method = "GET", auth = false, skipRefresh = false, query } = options;

  const headers: Record<string, string> = {};
  if (auth && clientConfig) {
    const token = clientConfig.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const url = `${resolveBase()}${path}${buildQuery(query)}`;

  let res: Response;
  try {
    res = await fetch(url, { method, credentials: "include", headers: authHeaders(headers) });
  } catch {
    throw new AdminApiError(
      "Could not reach backend API. Check that the API server is running.",
      0,
      "NETWORK_ERROR",
    );
  }

  if (res.status === 401 && auth && !skipRefresh && clientConfig?.hasSession()) {
    const refreshed = await coordinatedRefresh(refreshAccessToken);
    if (refreshed) {
      return apiRequestBlob(path, { ...options, skipRefresh: true });
    }
    clientConfig.clearSession();
  }

  if (!res.ok) {
    const json = await parseJson<unknown>(res);
    throw parseApiError(json, res.status);
  }

  const contentType = res.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await parseJson<unknown>(res);
    throw parseApiError(json, res.status);
  }

  return res.blob();
}
