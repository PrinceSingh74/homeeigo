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
  /** Changes on every sign-in / sign-out; a refresh from an earlier session must not be applied. */
  getSessionEpoch?: () => number;
  /** Persists then applies a rotated pair; resolves false when the session has ended meanwhile. */
  setTokens: (accessToken: string, refreshToken: string, epoch?: number) => Promise<boolean> | boolean | void;
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
  /**
   * Authenticate with THIS access token instead of the session's current one. For a request that
   * must outlive the session it belongs to: sign-out's push unlink is started just before
   * `clearSession()` and is sent after it. Pair it with `skipRefresh`.
   */
  accessToken?: string;
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
  if (!clientConfig.getRefreshToken()) return false;

  const { ensureDeviceId, getDeviceName } = await import("@/lib/auth/device");
  const deviceId = await ensureDeviceId();
  // Read the token only after the awaits above. They can take seconds (a lazily loaded module,
  // SecureStore), and a token captured before them may already have been rotated by another
  // refresh — sending it then is token reuse to the server, which revokes the whole family.
  const refreshToken = clientConfig.getRefreshToken();
  if (!refreshToken) return false;
  const epoch = clientConfig.getSessionEpoch?.();
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

  // Awaited: the retry must not run before the rotated token is durable (see the store's applyRotation).
  const applied = await clientConfig.setTokens(body.data!.accessToken!, body.data!.refreshToken!, epoch);
  return applied !== false;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, auth = false, skipRefresh = false, idempotencyKey, accessToken } = options;

  const { getFraudHeaders } = await import("@/lib/fraud/signals");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getFraudHeaders(),
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  if (auth && clientConfig) {
    const token = accessToken ?? clientConfig.getAccessToken();
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
    const epochAtRefresh = clientConfig.getSessionEpoch?.();
    const refreshed = await coordinatedRefresh(refreshAccessToken);
    if (refreshed) {
      return apiRequest<T>(path, { ...options, skipRefresh: true });
    }
    // Only end the session this request belonged to — never one that was started meanwhile.
    if (clientConfig.getSessionEpoch?.() === epochAtRefresh) clientConfig.clearSession();
  }

  const json = await parseJson<T>(res);
  if (!res.ok || !json.success) {
    throw parseApiError(json, res.status);
  }

  return json as T & ApiResponse<T>;
}
