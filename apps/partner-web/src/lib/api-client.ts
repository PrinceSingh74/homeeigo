import { PartnerApiError, parseApiError } from "@/lib/api-error";
import { coordinatedRefresh } from "@/lib/refresh-coordinator";
import type { ApiResponse } from "@/types/partner";
import { resolveApiBase } from "@/lib/api-base";

/** Single source of truth: lib/api-base.ts. */
function resolveBase(): string {
  return resolveApiBase();
}

/**
 * This app's auth audience. The API host is shared by customer, partner and admin, so the HttpOnly
 * refresh cookie is keyed per audience (hg_rt_partner here) and one app's login cannot overwrite
 * another's session in the same browser. The header is also a CSRF control on /api/auth/refresh.
 */
const AUTH_AUDIENCE = "partner";
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
  registration?: boolean;
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

/** Refresh the access token once (coordinated across concurrent callers). Used when a socket is closed with 4401. */
export async function ensureAccessToken(): Promise<boolean> {
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
      // No token in the body: the API reads the cookie and rotates it in place.
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

/**
 * Authenticated request whose body is not the JSON envelope (invoice HTML). Same bearer + single
 * coordinated refresh-and-retry-once as apiRequest; a hand-rolled fetch never refreshed.
 */
export async function apiRequestRaw(path: string, retried = false): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = clientConfig?.getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${resolveBase()}${path}`, { credentials: "include", headers: authHeaders(headers) });
  if (res.status === 401 && !retried && clientConfig?.hasSession()) {
    if (await coordinatedRefresh(refreshAccessToken)) return apiRequestRaw(path, true);
    clientConfig.clearSession();
  }
  return res;
}

/**
 * 401s that reject the PRESENCE session named in the request body, not the access token. Refreshing
 * on them is wrong and self-sustaining: refresh rotates the session, revoking the id the heartbeat
 * just sent, so the retry is rejected again and every beat mints and revokes another refresh token.
 * The heartbeat hook owns their recovery (re-read the snapshot, beat again).
 */
const PRESENCE_SESSION_CODES = new Set(["INVALID_SESSION", "STALE_SESSION", "DEVICE_MISMATCH"]);

async function isPresenceSessionReject(res: Response): Promise<boolean> {
  try {
    const body = (await res.clone().json()) as { code?: string } | null;
    return PRESENCE_SESSION_CODES.has(body?.code ?? "");
  } catch {
    return false;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, auth = false, registration = false, skipRefresh = false, query } = options;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth && clientConfig) {
    const token = clientConfig.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (registration) {
    const { getRegistrationToken } = await import("@/lib/registration-session");
    const regToken = getRegistrationToken();
    if (regToken) headers["X-Registration-Token"] = regToken;
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
    throw new PartnerApiError(
      "Could not reach backend API. Check that the API server is running.",
      0,
      "NETWORK_ERROR",
    );
  }

  if (res.status === 401 && auth && !skipRefresh && clientConfig?.hasSession() && !(await isPresenceSessionReject(res))) {
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

// WebSockets cannot go through the Next HTTP proxy, so the ws base must ALWAYS
// be an absolute ws(s):// URL. resolveBase() returns "" in same-origin proxy
// mode, which silently produced relative WS URLs that never connect — delegate
// to the LAN-safe resolver in api-base instead.
export { resolveWsBase } from "@/lib/api-base";
