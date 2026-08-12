import { useMemo, useRef, useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { useAuthStore } from "@/stores/auth-store";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { coreApi } from "@/services/core/api";
import { getApiBaseUrl, toWsBase } from "@/lib/api-config";
import { qk, upsertTrackingInCache } from "@/hooks/use-core-data";
import { BoundedEventCache } from "@/lib/realtime/bounded-cache";

export function useActiveTracking() {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const bookings = useAppStore((s) => s.bookings);
  const activeBooking = useMemo(
    () => bookings.find((b) => b.status === "in_progress" || b.status === "confirmed"),
    [bookings],
  );
  const [lastWsMessage, setLastWsMessage] = useState<string | null>(null);
  const processedEvents = useRef(new BoundedEventCache(500));
  const lastTrackingTs = useRef<number>(0);

  const trackingQuery = useQuery({
    queryKey: activeBooking?.id ? qk.tracking(activeBooking.id) : ["tracking", "none"],
    queryFn: () => coreApi.tracking.get(activeBooking!.id),
    enabled: !!activeBooking?.id && !!token && isAuthenticated,
    staleTime: 10_000,
    // No local retry override: a booking with no tracking record yet answers 404,
    // and the client's shared policy already declines to retry a settled 4xx.
  });

  const wsBase = toWsBase(getApiBaseUrl());
  const wsUrl =
    activeBooking?.id && token
      ? `${wsBase}/ws/tracking/${activeBooking.id}?token=${encodeURIComponent(token)}`
      : null;

  const ws = useRealtimeChannel({
    url: wsUrl,
    enabled: !!wsUrl,
    onMessage: (data) => {
      setLastWsMessage(data);
      try {
        type TrackingFields = {
          eventId?: string;
          timestamp?: string;
          entityId?: string;
          type?: string;
          bookingId?: string;
          status?: string;
          eta?: number;
          distance?: number;
          latitude?: number;
          longitude?: number;
          providerLatitude?: number;
          providerLongitude?: number;
          bearing?: number;
          speed?: number;
          locationUpdatedAt?: string;
        };
        const frame = JSON.parse(data) as TrackingFields & { data?: TrackingFields };
        // Backend wire format is an envelope: { type, data: {...fields}, timestamp }
        // (see notification-hub.ts toWsMessage / tracking.service.ts). Flat frames still supported.
        const payload: TrackingFields =
          frame.data && typeof frame.data === "object"
            ? { ...frame.data, type: frame.type ?? frame.data.type }
            : frame;
        const dedupeKey =
          payload.eventId ??
          `${payload.entityId ?? payload.bookingId ?? activeBooking?.id ?? "b"}:${payload.type ?? ""}:${payload.status ?? ""}:${payload.timestamp ?? payload.locationUpdatedAt ?? ""}:${payload.eta ?? ""}`;
        if (processedEvents.current.has(dedupeKey)) return;
        processedEvents.current.add(dedupeKey);
        const incomingTs = Date.parse(payload.locationUpdatedAt ?? payload.timestamp ?? "");
        if (!Number.isNaN(incomingTs) && incomingTs < lastTrackingTs.current) return;
        if (!Number.isNaN(incomingTs)) lastTrackingTs.current = incomingTs;
        const bid = payload.bookingId ?? activeBooking?.id;
        if (bid) {
          upsertTrackingInCache(queryClient, bid, {
            ...payload,
            providerLatitude: payload.providerLatitude ?? payload.latitude,
            providerLongitude: payload.providerLongitude ?? payload.longitude,
          });
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
    connected: ws.connected,
    reconnecting: ws.reconnecting,
    offline: ws.offline,
    lastWsMessage,
  };
}
