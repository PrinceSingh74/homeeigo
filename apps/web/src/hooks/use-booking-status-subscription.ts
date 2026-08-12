"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/stores/app-store";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { qk } from "@/hooks/use-core-data";
import type { BookingStatus } from "@/lib/bookings";
import { resolveWsBase } from "@/lib/api-base";


/**
 * Map backend BookingStatus → customer-facing BookingStatus.
 * Backend broadcasts: accepted | rejected | cancelled | in_progress | completed | assigned | en_route
 */
function mapBackendStatus(raw: string | undefined): BookingStatus | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v === "accepted" || v === "assigned" || v === "en_route") return "confirmed";
  if (v === "in_progress") return "in_progress";
  if (v === "completed") return "completed";
  if (
    v === "rejected" ||
    v === "cancelled" ||
    v === "cancelled_by_user" ||
    v === "cancelled_by_provider"
  ) {
    return "cancelled";
  }
  return null;
}

type Options = {
  bookingId: string | null | undefined;
  enabled?: boolean;
};

/**
 * Subscribes to /ws/booking/:bookingId to receive instant booking lifecycle
 * updates published by the partner side. Updates the Zustand app-store status,
 * reconciles React Query caches and applies stale-event protection.
 *
 * Backend contract: apps/backend/src/websocket/booking.ws.ts already broadcasts
 * `{ type: "BOOKING_STATUS", data: { bookingId, status, ... }, timestamp }` —
 * we re-use that shape without changing any route or message format.
 */
export function useBookingStatusSubscription({ bookingId, enabled = true }: Options) {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.accessToken);
  const updateBookingStatus = useAppStore((s) => s.updateBookingStatus);

  const wsBase = resolveWsBase();

  const url = useMemo(() => {
    if (!enabled || !token || !bookingId) return null;
    return `${wsBase}/ws/booking/${encodeURIComponent(bookingId)}?token=${encodeURIComponent(token)}`;
  }, [bookingId, enabled, token, wsBase]);

  const lastStatusTsRef = useRef(0);
  const processedRef = useRef<Set<string>>(new Set());

  const onMessage = useCallback(
    (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data ?? "{}") as {
          type?: string;
          timestamp?: string;
          data?: {
            bookingId?: string;
            status?: string;
            eventId?: string;
            timestamp?: string;
          };
        };

        // Tolerant dedupe — combine eventId + status + timestamp
        const eventTs = msg.data?.timestamp ?? msg.timestamp ?? "";
        const dedupeKey =
          msg.data?.eventId ??
          `${msg.data?.bookingId ?? bookingId ?? ""}:${msg.data?.status ?? ""}:${eventTs}`;
        if (processedRef.current.has(dedupeKey)) return;
        processedRef.current.add(dedupeKey);
        if (processedRef.current.size > 200) {
          const first = processedRef.current.values().next().value as string | undefined;
          if (first) processedRef.current.delete(first);
        }

        // Stale-event protection — drop out-of-order updates
        const incomingTsNum = Date.parse(eventTs);
        if (!Number.isNaN(incomingTsNum) && incomingTsNum < lastStatusTsRef.current) return;
        if (!Number.isNaN(incomingTsNum)) lastStatusTsRef.current = incomingTsNum;

        const targetBookingId = msg.data?.bookingId ?? bookingId;
        if (!targetBookingId) return;

        if (msg.type === "BOOKING_STATUS" || msg.type === "BOOKING_COMPLETED") {
          const mapped = mapBackendStatus(msg.data?.status);
          if (mapped) {
            updateBookingStatus(targetBookingId, mapped);
          }
          void queryClient.invalidateQueries({ queryKey: qk.bookings });
          void queryClient.invalidateQueries({ queryKey: qk.tracking(targetBookingId) });
        }
      } catch {
        // Ignore malformed payloads; existing REST refetch keeps state consistent.
      }
    },
    [bookingId, queryClient, updateBookingStatus],
  );

  const ws = useRealtimeChannel({ url, enabled: !!url, onMessage });

  useEffect(() => {
    if (ws.connected && bookingId) {
      void queryClient.invalidateQueries({ queryKey: qk.bookings });
      void queryClient.invalidateQueries({ queryKey: qk.tracking(bookingId) });
    }
  }, [bookingId, queryClient, ws.connected]);

  return {
    connected: ws.connected,
    reconnecting: ws.reconnecting,
    offline: ws.offline,
  };
}
