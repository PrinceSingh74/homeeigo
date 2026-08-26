import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { useAppStore, type BookingStatus } from "@/lib/store";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { getApiBaseUrl, toWsBase } from "@/lib/api-config";
import { qk } from "@/hooks/use-core-data";
import { BoundedEventCache } from "@/lib/realtime/bounded-cache";

function mapBackendStatus(raw: string | undefined): BookingStatus | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  // Must match mapBackendBookingToSaved — en_route is live, not "confirmed".
  if (v === "in_progress" || v === "en_route") return "in_progress";
  if (v === "accepted" || v === "assigned" || v === "pending") return "confirmed";
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

export function useBookingStatusSubscription({ bookingId, enabled = true }: Options) {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.accessToken);
  const updateBookingStatus = useAppStore((s) => s.updateBookingStatus);

  const wsBase = toWsBase(getApiBaseUrl());

  const url = useMemo(() => {
    if (!enabled || !token || !bookingId) return null;
    return `${wsBase}/ws/booking/${encodeURIComponent(bookingId)}?token=${encodeURIComponent(token)}`;
  }, [bookingId, enabled, token, wsBase]);

  const lastStatusTsRef = useRef(0);
  const processedRef = useRef(new BoundedEventCache(1_000));

  const onMessage = useCallback(
    (data: string) => {
      try {
        const msg = JSON.parse(data) as {
          type?: string;
          timestamp?: string;
          data?: {
            bookingId?: string;
            status?: string;
            eventId?: string;
            timestamp?: string;
          };
        };

        const eventTs = msg.data?.timestamp ?? msg.timestamp ?? "";
        const dedupeKey =
          msg.data?.eventId ??
          `${msg.data?.bookingId ?? bookingId ?? ""}:${msg.data?.status ?? ""}:${eventTs}`;
        if (processedRef.current.has(dedupeKey)) return;
        processedRef.current.add(dedupeKey);

        const incomingTsNum = Date.parse(eventTs);
        if (!Number.isNaN(incomingTsNum) && incomingTsNum < lastStatusTsRef.current) return;
        if (!Number.isNaN(incomingTsNum)) lastStatusTsRef.current = incomingTsNum;

        const targetBookingId = msg.data?.bookingId ?? bookingId;
        if (!targetBookingId) return;

        if (msg.type === "BOOKING_STATUS" || msg.type === "BOOKING_COMPLETED") {
          const mapped = mapBackendStatus(msg.data?.status);
          if (mapped) updateBookingStatus(targetBookingId, mapped, msg.data?.status);
          void queryClient.invalidateQueries({ queryKey: qk.bookings });
          void queryClient.invalidateQueries({ queryKey: qk.tracking(targetBookingId) });
        }
      } catch {
        /* REST refetch keeps state consistent */
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
