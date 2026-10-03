import { devAffordancesAllowed } from "./deployed-environment";

/**
 * Derive the client IP for rate limiting and audit logs.
 * X-Forwarded-For is only trusted when TRUST_PROXY=true (Cloud Run / load balancer).
 * Direct dev connections ignore spoofable XFF headers.
 *
 * Which X-Forwarded-For entry to believe (2026-10-01):
 *   Each proxy APPENDS the address it received the connection from, so only the right-most entries
 *   were written by infrastructure you control; everything to their left is whatever the client sent.
 *   Taking the LEFT-most entry let any caller pick a fresh rate-limit bucket per request by sending
 *   a random X-Forwarded-For. Set TRUST_PROXY_HOPS to the number of trusted proxies in front of the
 *   API (e.g. 1 for a single load balancer) and the entry that proxy appended is used instead.
 *   Unset keeps the previous left-most behaviour, because the right value depends on the hosting
 *   topology, which is not decided yet — production-config warns while it is unset.
 *
 *   X-Real-IP is a single proxy-set header with no chain: believed only behind a trusted proxy, or
 *   on a developer machine (tests use it to simulate distinct callers). A directly exposed deployed
 *   host ignores it — a client could otherwise set it to anything.
 */
export function getClientIp(request: Request): string {
  const trustProxy =
    process.env.TRUST_PROXY === "true" ||
    process.env.TRUST_PROXY === "1" ||
    process.env.NODE_ENV === "production";

  if (trustProxy) {
    return forwardedClient(request.headers.get("x-forwarded-for")) || request.headers.get("x-real-ip") || "unknown";
  }

  if (devAffordancesAllowed()) return request.headers.get("x-real-ip") || "127.0.0.1";
  return "direct";
}

/** The X-Forwarded-For entry written by the outermost trusted proxy (see TRUST_PROXY_HOPS above). */
function forwardedClient(header: string | null): string | undefined {
  if (!header) return undefined;
  const entries = header
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 0) return undefined;
  const hops = trustedProxyHops();
  if (hops === null) return entries[0];
  // With N trusted proxies the client address is the N-th entry from the right. Fewer entries than
  // that means the request did not pass through all of them; fall back to the left-most, which is
  // then the only address there is.
  return entries[Math.max(0, entries.length - hops)];
}

function trustedProxyHops(): number | null {
  const raw = process.env.TRUST_PROXY_HOPS?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}
