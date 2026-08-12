"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { qk, upsertTrackingInCache } from "@/hooks/use-core-data";
import { trackingApi } from "@/lib/tracking-api";
import { resolveWsBase } from "@/lib/api-base";


/**
 * Phase 17.2 — live tracking for ONE booking. Parameterised variant of `useActiveTracking`,
 * reusing the SAME infra (`useRealtimeChannel` WS + `coreApi.tracking` + react-query cache) —
 * no duplicate tracking system. Handles dedup, out-of-order drops, and reconnect recovery
 * (refetch + the server re-emits last-known on join). Booking ownership is enforced by the
 * server endpoint, so an unauthorised booking surfaces as a query error.
 */
export function useBookingTracking(bookingId: string | null | undefined, opts?: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.accessToken);
  const enabled = Boolean(bookingId && token && opts?.enabled !== false);

  const processed = useRef<Set<string>>(new Set());
  const lastTs = useRef<number>(0);
  const wasConnected = useRef(false);

  const trackingQuery = useQuery({
    queryKey: bookingId ? qk.tracking(bookingId) : ["tracking", "none"],
    queryFn: () => trackingApi.get(bookingId!),
    enabled,
    staleTime: 10_000,
    retry: 2,
  });

  const wsUrl = enabled ? `${resolveWsBase()}/ws/tracking/${bookingId}?token=${encodeURIComponent(token!)}` : null;

  const ws = useRealtimeChannel({
    url: wsUrl,
    enabled: !!wsUrl,
    onMessage: (event) => {
      try {
        type TrackingWsPayload = {
          eventId?: string; type?: string; bookingId?: string; status?: string;
          eta?: number; distance?: number; providerLatitude?: number; providerLongitude?: number;
          bearing?: number; speed?: number;
          locationUpdatedAt?: string; timestamp?: string;
        };
        const raw = JSON.parse(event.data ?? "{}") as TrackingWsPayload & { data?: TrackingWsPayload };
        // Server wraps the envelope: { type, data: { ...fields }, timestamp } — unwrap it
        // (tolerating a flat payload for older messages).
        const p: TrackingWsPayload =
          raw.data && typeof raw.data === "object" ? { ...raw.data, type: raw.data.type ?? raw.type } : raw;
        const key = p.eventId ?? `${p.bookingId ?? bookingId}:${p.type ?? ""}:${p.status ?? ""}:${p.locationUpdatedAt ?? p.timestamp ?? ""}:${p.eta ?? ""}`;
        if (processed.current.has(key)) return;
        processed.current.add(key);
        if (processed.current.size > 500) {
          const first = processed.current.values().next().value as string | undefined;
          if (first) processed.current.delete(first);
        }
        const ts = Date.parse(p.locationUpdatedAt ?? p.timestamp ?? "");
        if (!Number.isNaN(ts) && ts < lastTs.current) return; // drop out-of-order
        if (!Number.isNaN(ts)) lastTs.current = ts;
        // Only tracking-bearing messages may touch the cache — connection acks /
        // presence pings must not fabricate a tracking record.
        const hasTrackingData =
          p.providerLatitude != null || p.eta != null || p.distance != null || (p.type ?? "").startsWith("tracking.");
        if (bookingId && hasTrackingData) upsertTrackingInCache(queryClient, bookingId, p);
      } catch {
        if (bookingId) void queryClient.invalidateQueries({ queryKey: qk.tracking(bookingId) });
      }
    },
  });

  // FEATURE 4 — reconnect recovery: when the socket comes back, refetch the latest state.
  useEffect(() => {
    if (ws.connected && !wasConnected.current && bookingId) {
      void queryClient.invalidateQueries({ queryKey: qk.tracking(bookingId) });
    }
    wasConnected.current = ws.connected;
  }, [ws.connected, bookingId, queryClient]);

  const t = trackingQuery.data?.tracking;
  return {
    tracking: t,
    status: (t?.status ?? "assigned").toUpperCase(),
    eta: t?.eta ?? null,
    estimatedArrivalTime: t?.estimatedArrivalTime ?? null,
    distance: t?.distance ?? null,
    bearing: (t as { bearing?: number } | undefined)?.bearing ?? null,
    speed: (t as { speed?: number } | undefined)?.speed ?? null,
    providerPosition: t?.providerLatitude != null && t?.providerLongitude != null ? { lat: t.providerLatitude, lng: t.providerLongitude } : null,
    isLoading: trackingQuery.isLoading,
    isError: trackingQuery.isError,
    connected: ws.connected,
    reconnecting: ws.reconnecting,
    offline: ws.offline,
  };
}
