"use client";

import { useCallback, useMemo, useRef } from "react";
import { resolveWsBase } from "@/lib/api-client";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { usePartnerStore } from "@/stores/partner-store";

export type BookingLifecycleEvent =
  | { type: "accept_booking" }
  | { type: "reject_booking"; data?: { reason?: string } }
  | { type: "start_service" }
  | { type: "complete_booking" };

type Options = {
  bookingId: string | null | undefined;
  enabled?: boolean;
};

/**
 * Opens /ws/booking/:bookingId and exposes a `publish()` that fires
 * booking lifecycle events to the room — used to instantly notify the
 * customer side without waiting for a REST response.
 *
 * Designed to run alongside the existing REST mutations
 * (useAcceptBookingMutation, useRejectBookingMutation, ...): REST stays
 * the source of truth; WebSocket is the broadcast channel.
 *
 * Backend contract: apps/backend/src/websocket/booking.ws.ts already
 * handles these message types — no backend changes needed.
 */
export function usePartnerBookingPublisher({ bookingId, enabled = true }: Options) {
  const token = usePartnerStore((s) => s.accessToken);
  const wsBase = resolveWsBase();

  const url = useMemo(() => {
    if (!enabled || !token || !bookingId) return null;
    return `${wsBase}/ws/booking/${encodeURIComponent(bookingId)}?token=${encodeURIComponent(token)}`;
  }, [bookingId, enabled, token, wsBase]);

  const ws = useRealtimeChannel({ url, enabled: !!url });

  const recentEventsRef = useRef<Map<string, number>>(new Map());

  const publish = useCallback(
    (event: BookingLifecycleEvent): boolean => {
      if (!ws.connected) return false;

      // Drop duplicate lifecycle event if fired within 2s window (e.g. rapid double-click).
      const key = event.type;
      const now = Date.now();
      const last = recentEventsRef.current.get(key) ?? 0;
      if (now - last < 2_000) return false;
      recentEventsRef.current.set(key, now);

      return ws.send(event);
    },
    [ws],
  );

  return {
    publish,
    connected: ws.connected,
    reconnecting: ws.reconnecting,
    offline: ws.offline,
  };
}
