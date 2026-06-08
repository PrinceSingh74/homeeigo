import { Elysia } from "elysia";

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

export const securityHeadersPlugin = new Elysia({ name: "security-headers" })
  .onRequest(({ request, set }) => {
    if (!FORCE_HTTPS) return;
    const proto = request.headers.get("x-forwarded-proto");
    // Only redirect when we can prove the inbound request was plain HTTP.
    if (proto && proto.split(",")[0]!.trim() === "http") {
      const url = new URL(request.url);
      url.protocol = "https:";
      set.status = 301;
      set.headers["Location"] = url.toString();
      return "";
    }
  })
  .onAfterHandle(({ path, set }) => {
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

    if (isSensitivePath(path)) {
      set.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
      set.headers["Pragma"] = "no-cache";
      set.headers["Expires"] = "0";
    }
  });
