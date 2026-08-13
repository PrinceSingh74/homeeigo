"use client";

import { useMemo, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useAuthStore } from "@/stores/auth-store";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import { qk, upsertTrackingInCache } from "@/hooks/use-core-data";
import { resolveWsBase } from "@/lib/api-base";


/**
 * Backend statuses a partner can actually be tracked for, most-live first.
 * A partner riding to the door (en_route/arrived) needs the live map — and the
 * start-PIN card — more than a job already underway, so en_route outranks
 * in_progress when the customer has two concurrent active bookings.
 */
const TRACKABLE_RANK: Record<string, number> = {
  en_route: 0,
  in_progress: 1,
  assigned: 2,
  accepted: 3,
};

export function useActiveTracking() {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.accessToken);
  const bookings = useAppStore((s) => s.bookings);
  const activeBooking = useMemo(() => {
    // Prefer the booking a partner is actually riding for / working on —
    // a "pending" booking (no provider yet) must never win over an accepted one.
    const trackable = bookings
      .filter((b) => b.backendStatus != null && b.backendStatus in TRACKABLE_RANK)
      .sort((a, b) => TRACKABLE_RANK[a.backendStatus!]! - TRACKABLE_RANK[b.backendStatus!]!);
    if (trackable.length) return trackable[0];
    // Fallback for locally-created bookings that have no backendStatus yet.
    return bookings.find((b) => b.status === "in_progress" || b.status === "confirmed");
  }, [bookings]);
  const [lastWsMessage, setLastWsMessage] = useState<string | null>(null);
  const processedEvents = useRef<Set<string>>(new Set());
  const lastTrackingTs = useRef<number>(0);

  const trackingQuery = useQuery({
    queryKey: activeBooking?.id ? qk.tracking(activeBooking.id) : ["tracking", "none"],
    queryFn: () => coreApi.tracking.get(activeBooking!.id),
    enabled: !!activeBooking?.id && !!token,
    staleTime: 10_000,
    retry: 3,
  });

  const wsBase = resolveWsBase();
  const wsUrl =
    activeBooking?.id && token
      ? `${wsBase}/ws/tracking/${activeBooking.id}?token=${encodeURIComponent(token)}`
      : null;

  const ws = useRealtimeChannel({
    url: wsUrl,
    enabled: !!wsUrl,
    onMessage: (event) => {
      setLastWsMessage(event.data ?? null);
      try {
        type TrackingWsPayload = {
          eventId?: string;
          timestamp?: string;
          entityId?: string;
          type?: string;
          bookingId?: string;
          status?: string;
          eta?: number;
          distance?: number;
          providerLatitude?: number;
          providerLongitude?: number;
          bearing?: number;
          speed?: number;
          locationUpdatedAt?: string;
        };
        const raw = JSON.parse(event.data ?? "{}") as TrackingWsPayload & {
          data?: TrackingWsPayload;
        };
        // Server wraps the envelope: { type, data: { ...fields }, timestamp }.
        // Unwrap it (tolerating a flat payload for older messages).
        const payload: TrackingWsPayload =
          raw.data && typeof raw.data === "object"
            ? { ...raw.data, type: raw.data.type ?? raw.type }
            : raw;
        const dedupeKey =
          payload.eventId ??
          `${payload.entityId ?? payload.bookingId ?? activeBooking?.id ?? "b"}:${payload.type ?? ""}:${payload.status ?? ""}:${payload.timestamp ?? payload.locationUpdatedAt ?? ""}:${payload.eta ?? ""}`;
        if (processedEvents.current.has(dedupeKey)) return;
        processedEvents.current.add(dedupeKey);
        if (processedEvents.current.size > 500) {
          const first = processedEvents.current.values().next().value as string | undefined;
          if (first) processedEvents.current.delete(first);
        }
        const incomingTs = Date.parse(payload.locationUpdatedAt ?? payload.timestamp ?? "");
        if (!Number.isNaN(incomingTs) && incomingTs < lastTrackingTs.current) return;
        if (!Number.isNaN(incomingTs)) lastTrackingTs.current = incomingTs;
        // Only tracking-bearing messages may touch the cache — connection acks /
        // presence pings must not fabricate a tracking record ("in_progress" ghost).
        const hasTrackingData =
          payload.providerLatitude != null ||
          payload.eta != null ||
          payload.distance != null ||
          (payload.type ?? "").startsWith("tracking.");
        const bid = payload.bookingId ?? activeBooking?.id;
        if (bid && hasTrackingData) {
          upsertTrackingInCache(queryClient, bid, payload);
        }
      } catch {
        void queryClient.invalidateQueries({ queryKey: qk.tracking(activeBooking?.id ?? "") });
      }
    },
  });

  return {
    activeBooking,
    tracking: trackingQuery.data?.tracking,
    isLoading: trackingQuery.isLoading,
    isStale: trackingQuery.isStale,
    lastWsMessage,
    connected: ws.connected,
    reconnecting: ws.reconnecting,
    offline: ws.offline,
  };
}
