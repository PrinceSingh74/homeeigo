import { parseApiError } from "@/lib/auth/errors";
import { AuthApiError } from "@/lib/auth/errors";
import { coordinatedRefresh } from "@/lib/auth/refresh-coordinator";
import { emitRecoverySignal } from "@/lib/telemetry/recovery";
import { isPageLeaving } from "@/lib/page-lifecycle";
import type { ApiResponse } from "@/types/auth";

import { API_PORT, resolveApiBase } from "@/lib/api-base";

function getApiBaseCandidates(_path: string): string[] {
  const primary = resolveApiBase();
  const onLoopback =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  // Same-machine only: if the Next rewrite wedges (ECONNRESET / 175s hangs), hit the
  // API port next. Never add localhost fallback on LAN — phones cannot reach it.
  // Auth used to try :3000 first. That sent login/refresh off the customer origin, so the
  // browser looked like it had jumped to another server and the refresh cookie landed on
  // the API host. Same-origin first; the 12s fetch timeout still fails over to the API.
  if (onLoopback && primary === "") {
    const direct = `http://${window.location.hostname}:${API_PORT}`;
    return ["", direct];
  }

  return [primary];
}

/**
 * This app's auth audience. The API host is shared by customer, partner and admin, so the backend
 * keys the HttpOnly refresh cookie by audience (hg_rt_customer / _partner / _admin) — otherwise
 * signing into one app would overwrite another's session in the same browser. The header is also a
 * CSRF control: a cross-site page cannot set it without a preflight the API refuses.
 */
const AUTH_AUDIENCE = "customer";
/** Same-origin Next rewrite hangs for minutes when the API is restarting. Fail over fast. */
const API_FETCH_MS = 12_000;

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

/** Next's rewrite returns 500/HTML on ECONNRESET — that is not our JSON envelope. */
function proxyLooksDead(status: number, contentType: string | null): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  if (status !== 500) return false;
  return !contentType?.includes("application/json");
}

async function fetchWithApiFallback(
  path: string,
  init: RequestInit,
  timeoutMs: number = API_FETCH_MS,
): Promise<{ response: Response; usedBase: string }> {
  const candidates = getApiBaseCandidates(path);
  let lastError: unknown;
  let lastDead: { response: Response; usedBase: string } | undefined;

  for (let i = 0; i < candidates.length; i++) {
    const base = candidates[i]!;
    try {
      const url = `${base}${path}`;
      const response = await fetch(url, {
        credentials: "include", // the refresh cookie must travel on auth calls
        ...init,
        headers: { ...((init.headers as Record<string, string>) ?? {}), "X-Homigo-Audience": AUTH_AUDIENCE },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const usedBase = base || `(proxy ${typeof window !== "undefined" ? window.location.origin : "ssr"})`;
      const canFailover =
        i < candidates.length - 1 && base === "" && proxyLooksDead(response.status, response.headers.get("content-type"));
      if (canFailover) {
        lastDead = { response, usedBase };
        continue;
      }
      return { response, usedBase };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastDead) return lastDead;

  const label = candidates.map((b) => b || "(same-origin proxy)").join(" or ");
  const timedOut = isAbortError(lastError);
  throw new AuthApiError(
    timedOut
      ? "The server took too long to respond. Please try again."
      : `Could not reach backend API (${label}). Check backend is running and API URL is correct.`,
    0,
    timedOut ? "REQUEST_TIMEOUT" : "INTERNAL_ERROR",
    lastError instanceof Error ? [lastError.message] : undefined,
  );
}

export type ApiClientConfig = {
  getAccessToken: () => string | null;
  /**
   * Whether a session exists at all. There is no refresh token in JavaScript any more (it lives in
   * an HttpOnly cookie), so "can we try a refresh?" is answered by the presence of a session, not by
   * holding a token.
   */
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
  headers?: Record<string, string>;
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

/** One in-flight refresh for the whole page. Bootstrap and a 401 retry must share it. */
export function refreshSessionCredential(): Promise<boolean> {
  return coordinatedRefresh(refreshAccessToken);
}

async function refreshAccessToken(): Promise<boolean> {
  if (!clientConfig) return false;
  if (!clientConfig.hasSession()) return false;

  const { markRefreshCall } = await import("@/lib/auth/bootstrap-gate");
  markRefreshCall();

  const { getDeviceId, getDeviceName } = await import("@/lib/auth/device");
  let res: Response;
  try {
    const result = await fetchWithApiFallback("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      // No token in the body: the browser sends the HttpOnly cookie and the API rotates it in place.
      body: JSON.stringify({
        deviceId: getDeviceId(),
        deviceName: getDeviceName(),
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

  // Cookie mode returns only an access token — the rotated refresh token stays in the cookie.
  const ok = res.ok && body.success && Boolean(body.data?.accessToken);
  emitRecoverySignal("jwt_refresh", ok ? 1 : 0);
  if (!ok) return false;

  clientConfig.setAccessToken(body.data!.accessToken!);
  return true;
}

/**
 * Authenticated request whose body is NOT the JSON envelope (an invoice's HTML, an export's zip).
 * Same bearer + single coordinated refresh-and-retry-once as `apiRequest`, so no caller hand-rolls
 * auth: a raw `fetch` either forgot the header (the Vision page always got 401) or never refreshed
 * an expired token (invoice / export failed after an hour).
 *
 * `body` is for a multipart upload: no Content-Type is set, so the browser writes the boundary.
 * An upload outlasts the default fetch window on a slow connection — pass `timeoutMs` for it.
 */
export async function apiRequestRaw(
  path: string,
  init: { method?: string; body?: FormData; timeoutMs?: number } = {},
  retried = false,
): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = clientConfig?.getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const { response } = await fetchWithApiFallback(
    path,
    { method: init.method ?? "GET", credentials: "include", headers, ...(init.body ? { body: init.body } : {}) },
    init.timeoutMs,
  );
  if (response.status === 401 && !retried && clientConfig?.hasSession()) {
    if (await coordinatedRefresh(refreshAccessToken)) return apiRequestRaw(path, init, true);
    clientConfig.clearSession();
  }
  return response;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, auth = false, headers: extraHeaders, skipRefresh = false, skipBootstrapGate = false } = options;

  if (auth && !skipBootstrapGate) {
    const { waitForAuthBootstrap, markProtectedApiAttempt } = await import("@/lib/auth/bootstrap-gate");
    markProtectedApiAttempt(path);
    await waitForAuthBootstrap();
  }

  const { getFraudHeaders } = await import("@/lib/fraud/signals");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getFraudHeaders(),
    ...extraHeaders,
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
    // A request the browser aborted because this page is navigating away is not an outage — the
    // backend usually answered it (seen: every /api/legal/consent/cookies 200 while this logged).
    if (typeof console !== "undefined" && !isPageLeaving()) {
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

  if (res.status === 401 && auth && !skipRefresh && clientConfig?.hasSession()) {
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
