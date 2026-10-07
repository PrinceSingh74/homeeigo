import { useEffect } from "react";
import { AppState } from "react-native";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  connectPartnerRealtime,
  disconnectPartnerRealtime,
  pausePartnerRealtime,
  resumePartnerRealtime,
  subscribePartnerRealtime,
  useRealtimeStatus,
} from "@/lib/realtime-client";
import type { RealtimeFrame } from "@/lib/realtime-events";
import { useAuthStore } from "@/stores/auth-store";

/** Query-key prefixes per realtime target (keys as declared across src/ and app/). */
const KEYS_BY_TARGET: Record<string, ReadonlyArray<readonly unknown[]>> = {
  // A booking event (reschedule, reassignment, cancel, no-show) changes what the job screen may
  // offer and show, so its panels are asked again too — otherwise a cached "Start job" could
  // outlive a job that is no longer arrived, or no longer this partner's.
  bookings: [
    ["partner", "bookings"],
    ["partner", "map", "active-bookings"],
    ["partner", "map", "route"],
    ["partner", "route"],
    ["partner", "job-actions"],
    ["partner", "job-evidence"],
    ["partner", "job-earning"],
    ["partner", "job-contact"],
  ],
  // The job screen's panels (JobDetailScreen / JobLifecycleActions keys: ["partner", <panel>, bookingId]).
  execution: [
    ["partner", "job-actions"],
    ["partner", "requirements"],
    ["partner", "execution"],
    ["partner", "safety"],
    ["partner", "quality"],
    ["partner", "completion"],
    ["partner", "cases"],
  ],
  dashboard: [["partner", "dashboard"]],
  operations: [["partner", "operations"]],
  wallet: [
    ["partner", "wallet"],
    ["partner", "wallet-txns"],
    ["partner", "wallet-txns-all"],
    ["partner", "payouts"],
    ["partner", "withdrawals"],
    ["partner", "earnings"],
    ["partner", "invoices"],
  ],
  notifications: [["partner", "notifications"]],
  reviews: [["partner", "reviews"]],
  support: [["partner", "support"]],
};

function applyFrame(qc: QueryClient, frame: RealtimeFrame) {
  for (const target of frame.targets) {
    for (const queryKey of KEYS_BY_TARGET[target] ?? []) {
      void qc.invalidateQueries({ queryKey: [...queryKey] });
    }
  }
}

/**
 * Mount ONCE at the app root. Keeps the `/ws/notifications` socket bound to the current access
 * token (a refreshed token reconnects; sign-out disconnects), pauses it in the background, and turns
 * backend events into query invalidations so lists update without waiting for a poll.
 */
export function usePartnerRealtime() {
  const qc = useQueryClient();
  const token = useAuthStore((s) => (s.hydrated && s.user ? s.accessToken : null));

  useEffect(() => subscribePartnerRealtime((frame) => applyFrame(qc, frame)), [qc]);

  useEffect(() => {
    if (!token) {
      disconnectPartnerRealtime();
      return;
    }
    connectPartnerRealtime(token);
  }, [token]);

  useEffect(() => {
    if (AppState.currentState !== "active" && AppState.currentState != null) pausePartnerRealtime();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") resumePartnerRealtime();
      else if (next === "background") pausePartnerRealtime();
      // "inactive" (iOS control centre, incoming call sheet) is transient — keep the socket.
    });
    return () => sub.remove();
  }, []);

  useEffect(() => () => disconnectPartnerRealtime(), []);
}

/**
 * Poll interval for data the socket also pushes. The socket is an accelerator, not a guarantee:
 * when it is healthy, poll slowly as a safety net; when it is down, fall back to the fast cadence.
 */
export function useRealtimeFallbackInterval(fastMs: number, healthyMs: number): number {
  const connected = useRealtimeStatus((s) => s.connected);
  return connected ? healthyMs : fastMs;
}
