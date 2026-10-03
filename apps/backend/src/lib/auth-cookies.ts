/**
 * Refresh tokens for the WEB apps live in an HttpOnly cookie, never in JavaScript.
 *
 * ── Why the cookie is per audience ───────────────────────────────────────────
 * One API host serves customer, partner and admin. Cookies are host-scoped and ignore the port, so
 * a single `homigo_refresh` name means signing into the admin console overwrites the customer's
 * session in the same browser (and on localhost:3001/3002/3003 too). Each audience therefore gets
 * its own cookie name and the three sessions coexist.
 *
 * ── Why this is not CSRF-able ────────────────────────────────────────────────
 * `SameSite=Strict` keeps the cookie off any cross-site request, and `/api/auth/refresh` also
 * requires the custom `X-Homigo-Audience` header, which a cross-origin page cannot send without a
 * CORS preflight that the allowlist refuses. The cookie's Path is scoped to `/api/auth`, so it is
 * not attached to ordinary API calls at all — those still use the short-lived bearer access token.
 *
 * Mobile apps are unaffected: they send the refresh token in the request body and store it in the
 * platform keystore.
 *
 * Replaces the previous `homigo_access` / `homigo_refresh` pair, which nothing ever read: it put a
 * second long-lived copy of the refresh token in the browser for no benefit.
 */
import { JWT_CONFIG } from "../services/jwt.service";

const REFRESH_MAX_AGE = JWT_CONFIG.REFRESH_TOKEN_SECONDS;

export type AuthAudience = "customer" | "partner" | "admin";

export const AUDIENCE_HEADER = "x-homigo-audience";

export const REFRESH_COOKIE: Record<AuthAudience, string> = {
  customer: "hg_rt_customer",
  partner: "hg_rt_partner",
  admin: "hg_rt_admin",
};

/** Path the cookie is attached to — refresh and logout only. */
const COOKIE_PATH = "/api/auth";

type HeaderSet = {
  headers?: Record<string, string | number | string[] | undefined>;
  status?: number | string;
};

export function isAuthAudience(value: unknown): value is AuthAudience {
  return value === "customer" || value === "partner" || value === "admin";
}

/** The audience a web client declares for itself. Mobile/bearer clients send nothing. */
export function audienceFromRequest(request: { headers: { get(name: string): string | null } }): AuthAudience | null {
  const raw = request.headers.get(AUDIENCE_HEADER)?.trim().toLowerCase();
  return isAuthAudience(raw) ? raw : null;
}

/** The audience a signed-in user belongs to, used when the client did not declare one. */
export function audienceFromRole(role: string | null | undefined): AuthAudience {
  const r = (role ?? "").toUpperCase();
  if (r === "VENDOR" || r === "PROVIDER" || r === "PARTNER") return "partner";
  if (r === "ADMIN" || r === "SUPER_ADMIN" || r === "SUPPORT" || r === "FINANCE") return "admin";
  return "customer";
}

function cookieAttrs(maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict${secure}; Max-Age=${maxAge}`;
}

function appendCookie(set: HeaderSet, cookie: string): void {
  const prev = set.headers?.["Set-Cookie"] ?? set.headers?.["set-cookie"];
  const list = Array.isArray(prev) ? [...prev, cookie] : prev ? [String(prev), cookie] : [cookie];
  set.headers = { ...set.headers, "Set-Cookie": list };
}

/** Store the refresh token for one audience. The access token is never put in a cookie. */
export const appendAuthCookies = (set: HeaderSet, audience: AuthAudience, refreshToken: string): void => {
  appendCookie(set, `${REFRESH_COOKIE[audience]}=${encodeURIComponent(refreshToken)}; ${cookieAttrs(REFRESH_MAX_AGE)}`);
};

/** Clear one audience's cookie — never the other two, so other sessions survive a logout. */
export const clearAuthCookies = (set: HeaderSet, audience: AuthAudience): void => {
  appendCookie(set, `${REFRESH_COOKIE[audience]}=; ${cookieAttrs(0)}`);
};

/** Read the refresh token a browser sent for `audience` (or any audience, if none was declared). */
export function readRefreshCookie(
  request: { headers: { get(name: string): string | null } },
  audience: AuthAudience | null,
): { token: string; audience: AuthAudience } | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const jar = new Map<string, string>();
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  const order: AuthAudience[] = audience ? [audience] : ["customer", "partner", "admin"];
  for (const a of order) {
    const raw = jar.get(REFRESH_COOKIE[a]);
    if (raw) return { token: decodeURIComponent(raw), audience: a };
  }
  return null;
}
