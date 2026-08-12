import { parseApiError, AuthApiError } from "@/lib/auth/errors";
import { coordinatedRefresh } from "@/lib/auth/refresh-coordinator";
import { getApiBaseUrl } from "@/lib/api-config";
import { reportRecoverySignal, reportVital } from "@/lib/observability/telemetry";
import type { ApiResponse } from "@/types/auth";

const REQUEST_TIMEOUT_MS = Number(process.env.EXPO_PUBLIC_API_TIMEOUT_MS ?? 20000);

async function fetchWithApiFallback(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const base = getApiBaseUrl();
  const url = `${base}${path}`;
  if (__DEV__) {
    console.info(`[Homeeigo API] ${init.method ?? "GET"} ${url}`);
  }
  // Abort stalled requests so a bad network can't hang the UI forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    reportVital("TTFB", Date.now() - startedAt, "api"); // API latency → backend RUM (constant route label)
    if (__DEV__) {
      console.info(`[Homeeigo API] ${init.method ?? "GET"} ${url} → ${res.status}`);
    }
    return res;
  } catch (error) {
    clearTimeout(timer);
    const aborted = error instanceof Error && error.name === "AbortError";
    const detail = aborted ? `request timed out after ${REQUEST_TIMEOUT_MS}ms` : error instanceof Error ? error.message : String(error);
    if (__DEV__) {
      console.warn(`[Homeeigo API] ${init.method ?? "GET"} ${url} FAILED: ${detail}`);
    }
    throw new AuthApiError(
      aborted
        ? `The request timed out. Check your connection and try again.`
        : `Could not reach backend API at ${base}. Start the backend (port 3000) and ensure your phone and PC are on the same Wi‑Fi. Set EXPO_PUBLIC_API_URL in homigo-mobile/.env if auto-detection fails.`,
      0,
      aborted ? "TIMEOUT" : "NETWORK_ERROR",
      [detail],
    );
  }
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
  /** Idempotency key — set on replayed offline mutations so the backend can dedupe side effects. */
  idempotencyKey?: string;
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

  const { ensureDeviceId, getDeviceName } = await import("@/lib/auth/device");
  const deviceId = await ensureDeviceId();
  let res: Response;
  try {
    res = await fetchWithApiFallback("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refreshToken,
        deviceId,
        deviceName: getDeviceName(),
        setAuthCookies: false,
      }),
    });
  } catch {
    return false;
  }

  const body = await parseJson<{
    accessToken?: string;
    refreshToken?: string;
  }>(res);

  const ok = res.ok && body.success && Boolean(body.data?.accessToken) && Boolean(body.data?.refreshToken);
  reportRecoverySignal("jwt_refresh", ok ? 1 : 0);
  if (!ok) return false;

  clientConfig.setTokens(body.data!.accessToken!, body.data!.refreshToken!);
  return true;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, auth = false, skipRefresh = false, idempotencyKey } = options;

  const { getFraudHeaders } = await import("@/lib/fraud/signals");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getFraudHeaders(),
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  if (auth && clientConfig) {
    const token = clientConfig.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetchWithApiFallback(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error instanceof AuthApiError) throw error;
    throw new AuthApiError(
      "Could not reach backend API. Check backend is running and EXPO_PUBLIC_API_URL is correct.",
      0,
      "INTERNAL_ERROR",
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
