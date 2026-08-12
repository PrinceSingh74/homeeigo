"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/stores/app-store";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { useNativeNotifications } from "@/hooks/use-native-notifications";
import { qk, upsertNotificationInCache } from "@/hooks/use-core-data";
import type { BackendNotification } from "@/types/backend";
import { resolveWsBase } from "@/lib/api-base";


const SYSTEM_WS_TYPES = new Set(["SUBSCRIBE", "UNSUBSCRIBE", "PONG", "PING"]);

function isSystemWsPayload(raw: { type?: string }, msg: { message?: string; id?: string; title?: string; notificationType?: string; referenceType?: string }) {
  const envelopeType = String(raw.type ?? "").toUpperCase();
  if (SYSTEM_WS_TYPES.has(envelopeType)) return true;
  if (
    msg.message === "Connected to notifications" &&
    !msg.id &&
    !msg.title &&
    !msg.notificationType &&
    !msg.referenceType
  ) {
    return true;
  }
  return false;
}

export function RealtimeBridge() {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const updateBookingStatus = useAppStore((s) => s.updateBookingStatus);
  const showToast = useAppStore((s) => s.showToast);
  const nativeNotifications = useNativeNotifications();
  const wsBase = resolveWsBase();

  const notificationsUrl = useMemo(
    () => (isAuthenticated && token ? `${wsBase}/ws/notifications?token=${encodeURIComponent(token)}` : null),
    [isAuthenticated, token, wsBase],
  );

  const processedEvents = useRef<Set<string>>(new Set());
  const bookingStatusUpdatedAt = useRef<Map<string, number>>(new Map());
  const wasOffline = useRef(false);
  const wasConnected = useRef(false);

  const ws = useRealtimeChannel({
    url: notificationsUrl,
    enabled: isAuthenticated && !!token,
    onMessage: (event) => {
      try {
        const raw = JSON.parse(event.data ?? "{}") as {
          type?: string;
          data?: Record<string, unknown>;
          timestamp?: string;
        };
        const msg = (raw.data ?? raw) as {
          eventId?: string;
          timestamp?: string;
          entityId?: string;
          id?: string;
          type?: string;
          notificationType?: string;
          title?: string;
          message?: string;
          createdAt?: string;
          isRead?: boolean;
          referenceId?: string;
          referenceType?: string;
          status?: "confirmed" | "in_progress" | "completed" | "cancelled";
        };

        if (isSystemWsPayload(raw, msg)) return;

        const eventKey =
          msg.eventId ??
          `${msg.entityId ?? msg.id ?? "n"}:${msg.referenceId ?? "r"}:${msg.status ?? ""}:${msg.timestamp ?? msg.createdAt ?? raw.timestamp ?? ""}`;
        if (processedEvents.current.has(eventKey)) return;
        processedEvents.current.add(eventKey);
        if (processedEvents.current.size > 500) {
          const first = processedEvents.current.values().next().value as string | undefined;
          if (first) processedEvents.current.delete(first);
        }

        let shouldRefreshNotifications = false;
        let shouldRefreshBookings = false;

        if (msg.referenceId && msg.status) {
          const incomingTs = Date.parse(msg.timestamp ?? msg.createdAt ?? "");
          const prevTs = bookingStatusUpdatedAt.current.get(msg.referenceId) ?? 0;
          if (!Number.isNaN(incomingTs) && incomingTs < prevTs) return;
          bookingStatusUpdatedAt.current.set(msg.referenceId, Number.isNaN(incomingTs) ? Date.now() : incomingTs);
          updateBookingStatus(msg.referenceId, msg.status);
          shouldRefreshBookings = true;
        }

        const isSupportSignal =
          msg.referenceType === "support_ticket" ||
          (msg.title?.toLowerCase().includes("support") ?? false);

        if (msg.id && (msg.notificationType || msg.type) && msg.title && msg.message) {
          const notification: BackendNotification = {
            id: msg.id,
            type: msg.notificationType ?? msg.type ?? "notification",
            title: msg.title,
            message: msg.message,
            referenceId: msg.referenceId ?? null,
            isRead: msg.isRead ?? false,
            createdAt: msg.createdAt ?? msg.timestamp ?? new Date().toISOString(),
          };
          upsertNotificationInCache(queryClient, notification);
          shouldRefreshNotifications = true;
          void nativeNotifications.show({
            title: notification.title,
            body: notification.message,
            tag: notification.id,
            url: isSupportSignal
              ? msg.referenceId
                ? `/support?ticket=${encodeURIComponent(msg.referenceId)}`
                : "/support"
              : notification.referenceId
                ? `/bookings?focus=${encodeURIComponent(notification.referenceId)}`
                : "/",
            data: { type: notification.type, referenceId: notification.referenceId },
          });
          showToast(msg.message, "info");
        }

        if (isSupportSignal) {
          void queryClient.invalidateQueries({ queryKey: ["support"] });
          if (msg.referenceId) {
            void queryClient.invalidateQueries({
              queryKey: ["support", "ticket", msg.referenceId],
            });
          }
          if (msg.message && !msg.id) showToast(msg.message, "info");
        }

        if (shouldRefreshNotifications) {
          void queryClient.invalidateQueries({ queryKey: qk.notifications });
        }
        if (shouldRefreshBookings) {
          void queryClient.invalidateQueries({ queryKey: qk.bookings });
        }
      } catch {
        // ignore malformed ws payloads
      }
    },
  });

  useEffect(() => {
    if (ws.offline && !wasOffline.current) {
      showToast("You are offline. Realtime updates will resume automatically.", "info");
      wasOffline.current = true;
      wasConnected.current = false;
    }
    if (!ws.offline && wasOffline.current && ws.connected && !wasConnected.current) {
      showToast("Realtime connection restored.", "success");
      wasOffline.current = false;
      wasConnected.current = true;
    }
    if (ws.connected) {
      wasConnected.current = true;
    }
  }, [showToast, ws.connected, ws.offline]);

  return null;
}
