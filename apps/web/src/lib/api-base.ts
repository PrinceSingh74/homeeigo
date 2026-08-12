/**
 * SINGLE SOURCE OF TRUTH for the backend API + WebSocket base URLs (customer app).
 *
 * HTTP API resolution order:
 *   1) NEXT_PUBLIC_API_URL — explicit override (production / fixed backend domain).
 *      Ignored in the browser when it points at localhost but the page is opened from a LAN IP
 *      (misbound env from .env.example).
 *   2) Browser (dev/LAN): "" (empty) → requests go to `/api/*` on THIS app's own origin,
 *      and the Next.js rewrite proxy (next.config.js) forwards them to the backend
 *      server-side. Same-origin from the browser's view, so NO cross-origin/CORS/PNA
 *      "Failed to fetch" — works on localhost AND on phones/tablets over the LAN.
 *   3) SSR (runs on the dev machine): talk to the backend directly on localhost.
 *
 * WebSockets CANNOT go through Next rewrites, so resolveWsBase() always derives a full
 * ws(s):// URL from the page host (LAN-safe), independent of the HTTP proxy.
 */
const API_PORT = process.env.NEXT_PUBLIC_API_PORT ?? "3000";

let _loggedApiBase = false;

function isLocalhostHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** True when NEXT_PUBLIC_API_URL=localhost but the page is opened from a LAN device. */
function isMisboundLocalhostEnv(env: string): boolean {
  if (typeof window === "undefined") return false;
  const envIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(env);
  return envIsLocal && !isLocalhostHost(window.location.hostname);
}

export function resolveApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");

  if (typeof window !== "undefined") {
    // Browser: same-origin proxy unless a valid explicit API URL is set.
    const resolved = env && !isMisboundLocalhostEnv(env) ? env : "";
    if (!_loggedApiBase) {
      _loggedApiBase = true;
      console.log("API_BASE", resolved || `(proxy ${window.location.origin}/api/*)`);
    }
    return resolved;
  }

  // SSR (on the dev machine): backend is local unless env override is set.
  const resolved = env ?? `http://localhost:${API_PORT}`;
  if (!_loggedApiBase) {
    _loggedApiBase = true;
    console.log("API_BASE", resolved);
  }
  return resolved;
}

/** WebSocket base — auto ws:// (LAN/dev) or wss:// (https/prod). Derived from the page host. */
export function resolveWsBase(): string {
  const env = process.env.NEXT_PUBLIC_WS_URL?.replace(/\/+$/, "");
  if (env) return env;
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    const wsProto = protocol === "https:" ? "wss" : "ws";
    return `${wsProto}://${hostname}:${API_PORT}`;
  }
  return `ws://localhost:${API_PORT}`;
}

export { API_PORT };
