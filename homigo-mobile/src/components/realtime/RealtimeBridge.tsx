import { useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { scheduleLocalNotification } from "@/hooks/use-push-notifications";
import { useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/lib/store";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { getApiBaseUrl, toWsBase } from "@/lib/api-config";
import { qk, upsertNotificationInCache } from "@/hooks/use-core-data";
import { BoundedEventCache, BoundedTimestampMap } from "@/lib/realtime/bounded-cache";
import type { BackendNotification } from "@/types/backend";

export function RealtimeBridge() {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const updateBookingStatus = useAppStore((s) => s.updateBookingStatus);
  const showToast = useAppStore((s) => s.showToast);
  const wsBase = toWsBase(getApiBaseUrl());

  const notificationsUrl = useMemo(
    () => (token && isAuthenticated ? `${wsBase}/ws/notifications?token=${encodeURIComponent(token)}` : null),
    [token, isAuthenticated, wsBase],
  );

  const processedEvents = useRef(new BoundedEventCache(2_000));
  const bookingStatusUpdatedAt = useRef(new BoundedTimestampMap(500));

  useRealtimeChannel({
    url: notificationsUrl,
    enabled: !!notificationsUrl,
    onMessage: (raw) => {
      try {
        type NotificationFields = {
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
          status?: "confirmed" | "in_progress" | "completed" | "cancelled";
        };
        const frame = JSON.parse(raw) as NotificationFields & { data?: NotificationFields };
        const msg: NotificationFields =
          frame.data && typeof frame.data === "object" ? { ...frame.data, type: frame.type ?? frame.data.type } : frame;
        const eventKey =
          msg.eventId ??
          `${msg.entityId ?? msg.id ?? "n"}:${msg.referenceId ?? "r"}:${msg.status ?? ""}:${msg.timestamp ?? msg.createdAt ?? ""}`;
        if (processedEvents.current.has(eventKey)) return;
        processedEvents.current.add(eventKey);

        let shouldRefreshNotifications = false;
        let shouldRefreshBookings = false;

        if (msg.referenceId && msg.status) {
          const incomingTs = Date.parse(msg.timestamp ?? msg.createdAt ?? "");
          const prevTs = bookingStatusUpdatedAt.current.get(msg.referenceId) ?? 0;
          if (!Number.isNaN(incomingTs) && incomingTs < prevTs) return;
          bookingStatusUpdatedAt.current.set(
            msg.referenceId,
            Number.isNaN(incomingTs) ? Date.now() : incomingTs,
          );
          updateBookingStatus(msg.referenceId, msg.status);
          shouldRefreshBookings = true;
        }
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
        }
        if (msg.message) {
          if (AppState.currentState !== "active" && msg.title) {
            void scheduleLocalNotification({
              title: msg.title,
              body: msg.message,
              data: { referenceId: msg.referenceId },
            });
          } else {
            showToast(msg.message);
          }
        }

        if (shouldRefreshNotifications) {
          void queryClient.invalidateQueries({ queryKey: qk.notifications });
        }
        if (shouldRefreshBookings) {
          void queryClient.invalidateQueries({ queryKey: qk.bookings });
        }
      } catch {
        /* ignore malformed payloads */
      }
    },
  });

  return null;
}
