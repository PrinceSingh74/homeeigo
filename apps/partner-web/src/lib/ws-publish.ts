import { resolveWsBase } from "@/lib/api-client";
import { usePartnerStore } from "@/stores/partner-store";
import type { BookingLifecycleEvent } from "@/hooks/use-partner-booking-publisher";

const PENDING_TTL_MS = 5_000;
const OPEN_TIMEOUT_MS = 3_000;
const FLUSH_DELAY_MS = 250;

/**
 * Per-booking dedupe (5s window) so a rapid double-click on the same
 * action (e.g. accept) doesn't fire two WS broadcasts.
 */
const recent = new Map<string, number>();

function rememberKey(key: string): boolean {
  const now = Date.now();
  // GC entries older than the TTL while we're here.
  if (recent.size > 64) {
    for (const [k, ts] of recent) {
      if (now - ts > PENDING_TTL_MS) recent.delete(k);
    }
  }
  const last = recent.get(key) ?? 0;
  if (now - last < PENDING_TTL_MS) return false;
  recent.set(key, now);
  return true;
}

/**
 * Open a transient WebSocket to /ws/booking/:bookingId, send a lifecycle
 * event, and close it after a short flush window. Used after REST mutations
 * to broadcast the change instantly to any watcher (customer / admin) that
 * happens to be in the same booking room.
 *
 * Designed to be safe to call:
 *   - returns false (no throw) if offline, unauthenticated, or socket fails
 *   - does not block the caller (resolves once flush delay elapses)
 *   - does not affect REST mutation outcome — caller already committed state
 *
 * Backend route contract: apps/backend/src/websocket/booking.ws.ts
 *   { type: "accept_booking" | "reject_booking" | "start_service" | "complete_booking" }
 */
export function publishBookingLifecycle(
  bookingId: string,
  event: BookingLifecycleEvent,
): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!navigator.onLine) return Promise.resolve(false);

  const token = usePartnerStore.getState().accessToken;
  if (!token) return Promise.resolve(false);

  const dedupeKey = `${bookingId}:${event.type}`;
  if (!rememberKey(dedupeKey)) return Promise.resolve(false);

  const url = `${resolveWsBase()}/ws/booking/${encodeURIComponent(bookingId)}?token=${encodeURIComponent(token)}`;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      resolve(false);
      return;
    }

    const cleanup = (value: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(openTimer);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve(value);
    };

    const openTimer = window.setTimeout(() => cleanup(false), OPEN_TIMEOUT_MS);

    socket.onopen = () => {
      try {
        socket.send(JSON.stringify(event));
      } catch {
        cleanup(false);
        return;
      }
      // Give the server a moment to receive before we close.
      window.setTimeout(() => cleanup(true), FLUSH_DELAY_MS);
    };

    socket.onerror = () => cleanup(false);
    socket.onclose = () => cleanup(settled);
  });
}
