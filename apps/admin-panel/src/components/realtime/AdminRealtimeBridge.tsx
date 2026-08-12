"use client";

import { useMemo, useRef } from "react";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { adminKeys } from "@/hooks/use-admin-data";
import { debouncedInvalidate } from "@/lib/realtime-invalidation";
import { useAdminStore } from "@/stores/admin-store";
// WS cannot go through the Next HTTP proxy — resolveApiBase() returns "" in
// proxy mode, which would produce a relative WS URL that never connects.
// Always use the absolute LAN-safe resolver from api-base.
import { resolveWsBase } from "@/lib/api-base";

/**
 * Subscribes the admin console to /ws/notifications and reconciles
 * dashboard / list caches in real-time. Debounced invalidation prevents
 * refetch storms when the backend emits burst notifications.
 */
export function AdminRealtimeBridge() {
  useRenderProbe("AdminRealtimeBridge");
  useMountProbe("AdminRealtimeBridge");
  const queryClient = useQueryClient();
  const status = useAdminStore((s) => s.status);
  const token = useAdminStore((s) => s.accessToken);
  const wsBase = resolveWsBase();

  const url = useMemo(
    () =>
      status === "authenticated" && token
        ? `${wsBase}/ws/notifications?token=${encodeURIComponent(token)}`
        : null,
    [status, token, wsBase],
  );

  const processed = useRef<Set<string>>(new Set());
  const lastEventTsRef = useRef(0);

  useRealtimeChannel({
    url,
    enabled: !!url,
    trackConnectionState: false,
    onMessage: (event) => {
      try {
        const raw = JSON.parse(event.data ?? "{}") as {
          type?: string;
          data?: Record<string, unknown>;
          timestamp?: string;
        };
        const envelopeType = String(raw.type ?? "").toUpperCase();
        if (envelopeType === "SUBSCRIBE" || envelopeType === "PONG" || envelopeType === "PING") return;

        const msg = (raw.data ?? raw) as {
          eventId?: string;
          id?: string;
          type?: string;
          notificationType?: string;
          referenceId?: string;
          referenceType?: string;
          title?: string;
          message?: string;
          createdAt?: string;
          timestamp?: string;
        };

        const ts = msg.timestamp ?? msg.createdAt ?? raw.timestamp ?? "";
        const tsNum = Date.parse(ts);
        if (!Number.isNaN(tsNum) && tsNum < lastEventTsRef.current) return;

        const dedupeKey =
          msg.eventId ??
          `${msg.id ?? msg.referenceId ?? "n"}:${msg.notificationType ?? msg.type ?? ""}:${ts}`;
        if (processed.current.has(dedupeKey)) return;
        processed.current.add(dedupeKey);
        if (processed.current.size > 300) {
          const first = processed.current.values().next().value as string | undefined;
          if (first) processed.current.delete(first);
        }

        if (!Number.isNaN(tsNum)) lastEventTsRef.current = tsNum;

        const kind = (msg.notificationType ?? msg.type ?? "").toLowerCase();

        if (
          kind.startsWith("booking_") ||
          kind === "booking_status" ||
          kind === "service_started" ||
          kind === "service_completed"
        ) {
          debouncedInvalidate(queryClient, adminKeys.bookingsAll);
          debouncedInvalidate(queryClient, adminKeys.dashboard);
        }

        if (kind === "customer_updated" || kind === "user_created") {
          debouncedInvalidate(queryClient, adminKeys.customersAll);
          debouncedInvalidate(queryClient, adminKeys.dashboard);
        }
        if (kind === "provider_updated" || kind === "partner_approved") {
          debouncedInvalidate(queryClient, adminKeys.providersAll);
          debouncedInvalidate(queryClient, adminKeys.dashboard);
        }

        if (
          kind === "payment_received" ||
          kind.startsWith("wallet_") ||
          kind === "withdrawal_processed"
        ) {
          debouncedInvalidate(queryClient, adminKeys.dashboard);
          debouncedInvalidate(queryClient, adminKeys.bookingsAll);
        }

        const isSupportSignal =
          msg.referenceType === "support_ticket" ||
          (msg.title?.toLowerCase().includes("support queue") ?? false) ||
          (msg.title?.toLowerCase().includes("support update") ?? false) ||
          (msg.title?.toLowerCase().includes("support") ?? false);
        if (isSupportSignal) {
          debouncedInvalidate(queryClient, ["admin", "support"]);
          if (msg.referenceId) {
            debouncedInvalidate(queryClient, ["admin", "support", "ticket", msg.referenceId]);
          }
        }
      } catch {
        // ignore malformed payloads
      }
    },
  });

  return null;
}
