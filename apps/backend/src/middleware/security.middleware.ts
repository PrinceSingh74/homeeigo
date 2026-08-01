/**
 * Part 5/11 — Transport security.
 *
 * - Optional HTTPS enforcement (when FORCE_HTTPS=true, e.g. behind a proxy that
 *   sets `x-forwarded-proto`).
 * - A hardened set of response security headers on every response.
 * - `no-store` caching on auth/admin paths so sensitive responses are never
 *   cached by intermediaries or the browser.
 */

const FORCE_HTTPS = process.env.FORCE_HTTPS === "true";
const IS_PROD = process.env.NODE_ENV === "production";
const HSTS_MAX_AGE = process.env.HSTS_MAX_AGE || "31536000";

// API-appropriate CSP: this server returns JSON, so lock everything down and
// forbid being framed. (The web/admin/partner apps ship their own CSP.)
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function isSensitivePath(path: string): boolean {
  return path.startsWith("/api/auth") || path.startsWith("/api/admin") || path.includes("/payments");
}

type RequestCtx = { request: Request; set: { status?: number | string; headers: Record<string, string | number> } };

/**
 * Security-header + HTTPS-redirect handler, attached on the ROOT app instance via
 * `.onRequest` (index.ts). onRequest fires for EVERY request before routing, so —
 * unlike the previous local `onAfterHandle` (success-path + local scope only) —
 * these headers land on every response: success, 4xx/5xx errors, and 404s.
 *
 * Returns "" only to short-circuit the FORCE_HTTPS → HTTPS redirect.
 */
export function applySecurityHeaders({ request, set }: RequestCtx): string | undefined {
  if (FORCE_HTTPS) {
    const proto = request.headers.get("x-forwarded-proto");
    if (proto && proto.split(",")[0]!.trim() === "http") {
      const url = new URL(request.url);
      url.protocol = "https:";
      set.status = 301;
      set.headers["Location"] = url.toString();
      return "";
    }
  }

  set.headers["X-Frame-Options"] = "DENY";
  set.headers["X-Content-Type-Options"] = "nosniff";
  set.headers["X-XSS-Protection"] = "1; mode=block";
  set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
  set.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY;
  set.headers["Permissions-Policy"] = "geolocation=(self), microphone=(), camera=()";
  set.headers["Cross-Origin-Opener-Policy"] = "same-origin";
  set.headers["Cross-Origin-Resource-Policy"] = "same-site";

  if (IS_PROD || FORCE_HTTPS) {
    set.headers["Strict-Transport-Security"] = `max-age=${HSTS_MAX_AGE}; includeSubDomains; preload`;
  }

  const path = new URL(request.url).pathname;
  if (isSensitivePath(path)) {
    set.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
    set.headers["Pragma"] = "no-cache";
    set.headers["Expires"] = "0";
  }
  return undefined;
}
