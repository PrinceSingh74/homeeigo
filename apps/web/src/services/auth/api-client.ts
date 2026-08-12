import { parseApiError } from "@/lib/auth/errors";
import { AuthApiError } from "@/lib/auth/errors";
import { coordinatedRefresh } from "@/lib/auth/refresh-coordinator";
import { emitRecoverySignal } from "@/lib/telemetry/recovery";
import type { ApiResponse } from "@/types/auth";

import { API_PORT, resolveApiBase } from "@/lib/api-base";

function getApiBaseCandidates(): string[] {
  const primary = resolveApiBase();
  const candidates = [primary];

  // Same-machine only: if the Next proxy ("") fails, try direct backend port.
  // Never add localhost fallback on LAN — phones cannot reach the dev machine's localhost.
  if (
    typeof window !== "undefined" &&
    primary === "" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  ) {
    candidates.push(`http://localhost:${API_PORT}`);
  }

  return candidates;
}

async function fetchWithApiFallback(
  path: string,
  init: RequestInit,
): Promise<{ response: Response; usedBase: string }> {
  const candidates = getApiBaseCandidates();
  let lastError: unknown;

  for (const base of candidates) {
    try {
      const url = `${base}${path}`;
      const response = await fetch(url, init);
      return { response, usedBase: base || `(proxy ${window.location?.origin ?? "ssr"})` };
    } catch (error) {
      lastError = error;
    }
  }

  const label = candidates.map((b) => b || "(same-origin proxy)").join(" or ");
  throw new AuthApiError(
    `Could not reach backend API (${label}). Check backend is running and API URL is correct.`,
    0,
    "INTERNAL_ERROR",
    lastError instanceof Error ? [lastError.message] : undefined,
  );
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
  /**
   * Calls made BY the bootstrap flow itself (e.g. /api/user/me) must not wait
   * on the bootstrap gate — bootstrap only completes after they return, so
   * gating them deadlocks the whole app on the auth spinner.
   */
  skipBootstrapGate?: boolean;
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

  const { markRefreshCall } = await import("@/lib/auth/bootstrap-gate");
  markRefreshCall();

  const { getDeviceId, getDeviceName } = await import("@/lib/auth/device");
  let res: Response;
  try {
    const result = await fetchWithApiFallback("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refreshToken,
        deviceId: getDeviceId(),
        deviceName: getDeviceName(),
        setAuthCookies: false,
      }),
    });
    res = result.response;
  } catch {
    return false;
  }

  const body = await parseJson<{
    accessToken?: string;
    refreshToken?: string;
  }>(res);

  const ok = res.ok && body.success && Boolean(body.data?.accessToken) && Boolean(body.data?.refreshToken);
  emitRecoverySignal("jwt_refresh", ok ? 1 : 0);
  if (!ok) return false;

  clientConfig.setTokens(body.data!.accessToken!, body.data!.refreshToken!);
  return true;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, auth = false, skipRefresh = false, skipBootstrapGate = false } = options;

  if (auth && !skipBootstrapGate) {
    const { waitForAuthBootstrap, markProtectedApiAttempt } = await import("@/lib/auth/bootstrap-gate");
    markProtectedApiAttempt(path);
    await waitForAuthBootstrap();
  }

  const { getFraudHeaders } = await import("@/lib/fraud/signals");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getFraudHeaders(),
  };

  if (auth && clientConfig) {
    const token = clientConfig.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    const result = await fetchWithApiFallback(path, {
      method,
      credentials: "include",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    res = result.response;
  } catch (err) {
    if (typeof console !== "undefined") {
      console.error("[auth] backend unreachable for", path, "→", err instanceof Error ? err.message : err);
    }
    if (err instanceof AuthApiError) throw err;
    throw new AuthApiError(
      "Could not reach backend API. Check backend is running and API URL is correct.",
      0,
      "INTERNAL_ERROR",
      err instanceof Error ? [err.message] : undefined,
    );
  }

  if (res.status === 401 && auth && !skipRefresh && clientConfig?.getRefreshToken()) {
    const { useAuthStore } = await import("@/stores/auth-store");
    const { recordStartup401 } = await import("@/lib/auth/bootstrap-gate");
    if (useAuthStore.getState().status === "initializing") {
      recordStartup401(path);
    }
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
