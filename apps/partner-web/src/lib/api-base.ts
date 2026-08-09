/**
 * SINGLE SOURCE OF TRUTH for the backend API + WebSocket base URLs (partner app).
 *
 * HTTP API resolution order:
 *   1) NEXT_PUBLIC_API_URL — explicit override (production / fixed backend domain).
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

export function resolveApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
  if (env) return env;
  // Browser: same-origin relative — the dev server proxies /api/* to the backend.
  if (typeof window !== "undefined") return "";
  // SSR (on the dev machine): backend is local.
  return `http://localhost:${API_PORT}`;
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
