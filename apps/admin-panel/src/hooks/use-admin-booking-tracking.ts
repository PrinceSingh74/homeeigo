"use client";

import { useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { resolveWsBase } from "@/lib/api-base";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { useAdminStore } from "@/stores/admin-store";

export type AdminTracking = {
  bookingId: string;
  status?: string;
  /** true = live GPS stream; false = partner's last-known location (no active trip). */
  live?: boolean;
  providerLatitude?: number | null;
  providerLongitude?: number | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  distance?: number | null;
  eta?: number | null;
  bearing?: number | null;
  speed?: number | null;
  estimatedArrivalTime?: string | null;
  locationUpdatedAt?: string | null;
};

type TrackingWsPayload = Partial<AdminTracking> & {
  eventId?: string;
  type?: string;
  timestamp?: string;
};

const key = (bookingId: string) => ["admin", "tracking", bookingId] as const;

/**
 * Live per-booking tracking for the admin console — the SAME pipeline the
 * customer app uses: REST snapshot (GET /api/tracking/:id, admin-scoped) +
 * /ws/tracking/:bookingId realtime updates (admin role is authorised
 * server-side). The server wraps WS envelopes as { type, data: {...} } —
 * unwrap before merging into the cache.
 */
export function useAdminBookingTracking(bookingId: string | null | undefined, enabled = true) {
  const queryClient = useQueryClient();
  const token = useAdminStore((s) => s.accessToken);
  const on = Boolean(bookingId && token && enabled);
  const lastTs = useRef(0);

  const snapshot = useQuery({
    queryKey: bookingId ? key(bookingId) : ["admin", "tracking", "none"],
    queryFn: async () => {
      const res = await apiRequest<{ success: boolean; data?: { tracking: AdminTracking } }>(
        `/api/tracking/${bookingId}`,
        { auth: true },
      );
      return res.data?.tracking ?? null;
    },
    enabled: on,
    staleTime: 10_000,
    retry: 1,
  });

  const ws = useRealtimeChannel({
    url: on ? `${resolveWsBase()}/ws/tracking/${bookingId}?token=${encodeURIComponent(token!)}` : null,
    enabled: on,
    onMessage: (event) => {
      try {
        const raw = JSON.parse(event.data ?? "{}") as TrackingWsPayload & { data?: TrackingWsPayload };
        const p: TrackingWsPayload =
          raw.data && typeof raw.data === "object" ? { ...raw.data, type: raw.data.type ?? raw.type } : raw;
        const hasTrackingData =
          p.providerLatitude != null || p.eta != null || p.distance != null || (p.type ?? "").startsWith("tracking.");
        if (!hasTrackingData || !bookingId) return;
        const ts = Date.parse(p.locationUpdatedAt ?? p.timestamp ?? "");
        if (!Number.isNaN(ts) && ts < lastTs.current) return; // drop out-of-order
        if (!Number.isNaN(ts)) lastTs.current = ts;
        queryClient.setQueryData<AdminTracking | null>(key(bookingId), (prev) => ({
          ...(prev ?? { bookingId }),
          ...p,
          bookingId,
        }));
      } catch {
        /* non-JSON frame (heartbeat) — ignore */
      }
    },
  });

  return {
    tracking: snapshot.data ?? null,
    isLoading: snapshot.isLoading,
    isError: snapshot.isError,
    connected: ws.connected,
    reconnecting: ws.reconnecting,
  };
}
