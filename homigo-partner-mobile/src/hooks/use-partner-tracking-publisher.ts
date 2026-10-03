import { useEffect, useState } from "react";
import { trackingPublisherRegistry } from "@/lib/tracking-publisher-instance";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Publishes partner GPS to `/ws/tracking/:bookingId` while a job is live.
 *
 * Every screen that needs the live job's GPS calls this; the publisher itself exists once per
 * (session, booking) and stops with the last screen that holds it (X-76 — the job screen and the
 * always-mounted Requests tab used to open two sockets and two watchers for one job). Lifecycle,
 * permission rules and the message contract live in `src/lib/tracking-publisher-registry.ts`.
 *
 * GPS is corroboration, not the producer of lifecycle timestamps — `enRouteAt` and `arrivedAt` come
 * from the partner's explicit actions.
 */
export function usePartnerTrackingPublisher(opts: {
  bookingId: string | null | undefined;
  enabled?: boolean;
  minIntervalMs?: number;
}) {
  const { bookingId, enabled = true, minIntervalMs = 5_000 } = opts;
  const token = useAuthStore((s) => s.accessToken);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Not live (terminal, cancelled, not yet accepted) or signed out: hold nothing.
    if (!enabled || !bookingId || !token) return;
    const release = trackingPublisherRegistry.acquire({ bookingId, token, minIntervalMs, onConnected: setConnected });
    return () => {
      release();
      setConnected(false);
    };
  }, [bookingId, enabled, minIntervalMs, token]);

  return { connected };
}
