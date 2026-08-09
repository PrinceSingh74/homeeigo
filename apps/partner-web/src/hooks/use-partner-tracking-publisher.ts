"use client";

import { useEffect, useMemo, useRef } from "react";
import { resolveWsBase } from "@/lib/api-client";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { usePartnerStore } from "@/stores/partner-store";

type Options = {
  bookingId: string | null | undefined;
  /**
   * Provide live coordinates (e.g. from geolocation watcher).
   * Hook will publish whenever this changes & throttle to ~5s.
   */
  coords:
    | {
        latitude: number;
        longitude: number;
        accuracy?: number;
        altitude?: number;
      }
    | null;
  enabled?: boolean;
  minIntervalMs?: number;
};

/**
 * Publishes partner GPS location updates to /ws/tracking/:bookingId.
 *
 * Backend route already accepts `{ type: "location_update", latitude, longitude, accuracy?, altitude? }`
 * (see apps/backend/src/websocket/tracking.ws.ts) — we re-use that contract so no backend changes are needed.
 *
 * Throttled to one send per `minIntervalMs` (default 5 s) and skips duplicate fixes.
 * Auto-reconnect + offline recovery are inherited from `useRealtimeChannel`.
 */
export function usePartnerTrackingPublisher({
  bookingId,
  coords,
  enabled = true,
  minIntervalMs = 5_000,
}: Options) {
  const token = usePartnerStore((s) => s.accessToken);
  const wsBase = resolveWsBase();

  const url = useMemo(() => {
    if (!enabled || !token || !bookingId) return null;
    return `${wsBase}/ws/tracking/${encodeURIComponent(bookingId)}?token=${encodeURIComponent(token)}`;
  }, [bookingId, enabled, token, wsBase]);

  const ws = useRealtimeChannel({ url, enabled: !!url });

  const lastSentAtRef = useRef(0);
  const lastFixRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!ws.connected || !coords) return;

    const now = Date.now();
    if (now - lastSentAtRef.current < minIntervalMs) return;

    const last = lastFixRef.current;
    if (
      last &&
      Math.abs(last.lat - coords.latitude) < 1e-6 &&
      Math.abs(last.lng - coords.longitude) < 1e-6
    ) {
      return;
    }

    const ok = ws.send({
      type: "location_update",
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      altitude: coords.altitude,
    });
    if (ok) {
      lastSentAtRef.current = now;
      lastFixRef.current = { lat: coords.latitude, lng: coords.longitude };
    }
  }, [coords, minIntervalMs, ws]);

  return {
    connected: ws.connected,
    reconnecting: ws.reconnecting,
    offline: ws.offline,
  };
}
