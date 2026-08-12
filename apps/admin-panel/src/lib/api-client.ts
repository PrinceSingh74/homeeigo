import { AdminApiError, parseApiError } from "@/lib/api-error";
import { coordinatedRefresh } from "@/lib/refresh-coordinator";
import type { ApiResponse } from "@/types/admin";
import { resolveApiBase } from "@/lib/api-base";

/** Single source of truth: lib/api-base.ts. */
function resolveBase(): string {
  return resolveApiBase();
}

export type ApiClientConfig = {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  setTokens: (accessToken: string, refreshToken: string) => void;
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

async function refreshAccessToken(): Promise<boolean> {
  if (!clientConfig) return false;
  const refreshToken = clientConfig.getRefreshToken();
  if (!refreshToken) return false;

  const { getDeviceId, getDeviceName } = await import("@/lib/device");
  let res: Response;
  try {
    res = await fetch(`${resolveBase()}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refreshToken,
        deviceId: getDeviceId(),
        deviceName: getDeviceName(),
        setAuthCookies: false,
      }),
    });
  } catch {
    return false;
  }

  const body = await parseJson<{ accessToken?: string; refreshToken?: string }>(res);
  if (!res.ok || !body.success || !body.data?.accessToken || !body.data?.refreshToken) {
    return false;
  }

  clientConfig.setTokens(body.data.accessToken, body.data.refreshToken);
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
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AdminApiError(
      "Could not reach backend API. Check that the API server is running.",
      0,
      "NETWORK_ERROR",
    );
  }

  if (res.status === 401 && auth && !skipRefresh && clientConfig?.getRefreshToken()) {
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
    res = await fetch(url, { method, headers });
  } catch {
    throw new AdminApiError(
      "Could not reach backend API. Check that the API server is running.",
      0,
      "NETWORK_ERROR",
    );
  }

  if (res.status === 401 && auth && !skipRefresh && clientConfig?.getRefreshToken()) {
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
    res = await fetch(url, { method, headers });
  } catch {
    throw new AdminApiError(
      "Could not reach backend API. Check that the API server is running.",
      0,
      "NETWORK_ERROR",
    );
  }

  if (res.status === 401 && auth && !skipRefresh && clientConfig?.getRefreshToken()) {
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
