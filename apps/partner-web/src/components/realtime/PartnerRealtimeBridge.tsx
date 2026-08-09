"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resolveWsBase } from "@/lib/api-client";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { partnerKeys } from "@/hooks/use-partner-data";
import { usePartnerStore } from "@/stores/partner-store";
import { useToastStore } from "@/stores/toast-store";

/**
 * Subscribes to `/ws/notifications?token=…` and reacts to backend events:
 * - Booking lifecycle messages → invalidate bookings + dashboard caches
 * - Earnings / wallet events → invalidate wallet + dashboard
 * - Any payload with `message` → surface as toast
 *
 * Backed by an exponential-backoff reconnect via `useRealtimeChannel`.
 */
export function PartnerRealtimeBridge() {
  const queryClient = useQueryClient();
  const token = usePartnerStore((s) => s.accessToken);
  const showToast = useToastStore((s) => s.showToast);
  const wsBase = resolveWsBase();

  const url = useMemo(
    () => (token ? `${wsBase}/ws/notifications?token=${encodeURIComponent(token)}` : null),
    [token, wsBase],
  );

  const processed = useRef<Set<string>>(new Set());

  const ws = useRealtimeChannel({
    url,
    enabled: !!token,
    onMessage: (event) => {
      try {
        const raw = JSON.parse(event.data ?? "{}") as {
          type?: string;
          data?: Record<string, unknown>;
        };
        const envelopeType = String(raw.type ?? "").toUpperCase();
        if (envelopeType === "SUBSCRIBE" || envelopeType === "PONG" || envelopeType === "PING") return;

        const msg = (raw.data ?? raw) as {
          eventId?: string;
          id?: string;
          type?: string;
          notificationType?: string;
          title?: string;
          message?: string;
          createdAt?: string;
          referenceId?: string;
          referenceType?: string;
          status?: string;
        };

        const dedupeKey =
          msg.eventId ??
          `${msg.id ?? msg.referenceId ?? "n"}:${msg.notificationType ?? msg.type ?? ""}:${msg.createdAt ?? ""}`;
        if (processed.current.has(dedupeKey)) return;
        processed.current.add(dedupeKey);
        if (processed.current.size > 300) {
          const first = processed.current.values().next().value as string | undefined;
          if (first) processed.current.delete(first);
        }

        const kind = (msg.notificationType ?? msg.type ?? "").toLowerCase();

        // Booking-related signals → refetch lists + dashboard
        const isBookingSignal =
          kind.startsWith("booking_") ||
          (kind === "notification.created" && msg.notificationType === "BOOKING_REQUEST");

        if (isBookingSignal || kind === "service_started" || kind === "service_completed") {
          void queryClient.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
          void queryClient.invalidateQueries({ queryKey: partnerKeys.dashboard });
        }

        // Wallet / earnings signals
        if (
          kind.startsWith("wallet_") ||
          kind === "earning_credited" ||
          kind === "withdrawal_processed"
        ) {
          void queryClient.invalidateQueries({ queryKey: partnerKeys.walletBalance });
          void queryClient.invalidateQueries({ queryKey: partnerKeys.walletTxAll });
          void queryClient.invalidateQueries({ queryKey: partnerKeys.payouts });
          void queryClient.invalidateQueries({ queryKey: partnerKeys.invoices });
          void queryClient.invalidateQueries({ queryKey: partnerKeys.dashboard });
        }

        if (kind === "notification" || kind.includes("notif")) {
          void queryClient.invalidateQueries({ queryKey: partnerKeys.notificationsAll });
        }

        const isSupportSignal =
          msg.referenceType === "support_ticket" ||
          (msg.title?.toLowerCase().includes("support update") ?? false) ||
          (msg.title?.toLowerCase().includes("support queue") ?? false);
        if (isSupportSignal) {
          void queryClient.invalidateQueries({ queryKey: ["partner", "support"] });
          if (msg.referenceId) {
            void queryClient.invalidateQueries({
              queryKey: ["partner", "support", "ticket", msg.referenceId],
            });
          }
        }

        // Review / rating signals
        if (kind === "rating_received" || kind === "review_received") {
          void queryClient.invalidateQueries({ queryKey: partnerKeys.reviewsAll });
          void queryClient.invalidateQueries({ queryKey: partnerKeys.dashboard });
        }

        if (msg.message && msg.message !== "Connected to notifications") {
          showToast(msg.message, "info");
        }
      } catch {
        // ignore malformed payloads
      }
    },
  });

  const wasOffline = useRef(false);
  useEffect(() => {
    if (ws.offline && !wasOffline.current) {
      showToast("You are offline. Realtime updates will resume automatically.", "info");
      wasOffline.current = true;
    }
    if (!ws.offline && wasOffline.current && ws.connected) {
      showToast("Realtime connection restored.", "success");
      wasOffline.current = false;
    }
  }, [showToast, ws.connected, ws.offline]);

  useEffect(() => {
    if (ws.connected) {
      void queryClient.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      void queryClient.invalidateQueries({ queryKey: partnerKeys.dashboard });
    }
  }, [queryClient, ws.connected]);

  return null;
}
