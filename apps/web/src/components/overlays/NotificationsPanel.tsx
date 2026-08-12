"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Bell, BellRing, Sparkles, MapPin, Tag, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";
import { bookUrl } from "@/lib/booking-url";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import {
  useDeleteNotificationMutation,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationsQuery,
} from "@/hooks/use-core-data";
import { useNativeNotifications } from "@/hooks/use-native-notifications";
import type { BackendNotification } from "@/types/backend";

export function NotificationsPanel({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const router = useRouter();
  const { isAuthenticated, isInitializing } = useAuth();
  const { data, isLoading, isError, refetch } = useNotificationsQuery();
  const markRead = useMarkNotificationReadMutation();
  const markAllRead = useMarkAllNotificationsReadMutation();
  const removeNotif = useDeleteNotificationMutation();
  const nativeNotifications = useNativeNotifications();
  const backendNotifications = (data?.notifications ?? []) as BackendNotification[];
  const unreadCount = data?.unreadCount ?? 0;

  // Viewing the panel IS reading — silently clear the badge shortly after open
  // (small delay so the user sees what was new before it settles).
  const markAllSilently = markAllRead.mutate;
  useEffect(() => {
    if (!open || !isAuthenticated || isLoading || unreadCount === 0) return;
    const t = setTimeout(() => markAllSilently(), 1200);
    return () => clearTimeout(t);
  }, [open, isAuthenticated, isLoading, unreadCount, markAllSilently]);
  const notifications = backendNotifications.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.message,
    time: new Date(n.createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    action: n.referenceId ? `/bookings` : bookUrl(),
    icon: n.type.includes("offer")
      ? Tag
      : n.type.includes("booking")
        ? Sparkles
        : MapPin,
  }));

  return (
    <Modal open={open} onClose={closeOverlay} title="Notifications" size="md">
      {nativeNotifications.isSupported && nativeNotifications.permission === "default" ? (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-3">
          <BellRing size={18} className="mt-0.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-content">Stay in the loop</p>
            <p className="mt-0.5 text-xs text-muted">
              Get notified about booking updates even when HOMEEIGO is in the background.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void nativeNotifications.requestPermission().then((result) => {
                if (result === "granted") {
                  showToast("Notifications enabled", "success");
                } else if (result === "denied") {
                  showToast("Notifications blocked. Enable in browser settings.", "info");
                }
              });
            }}
            className="rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-white"
          >
            Enable
          </button>
        </div>
      ) : null}
      {!isAuthenticated && !isInitializing ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface/60 p-5 text-center text-sm text-muted">
          <p>Sign in to see booking updates and offers.</p>
          <Link
            href="/login"
            onClick={closeOverlay}
            className="mt-3 inline-block font-semibold text-primary underline"
          >
            Log in
          </Link>
        </div>
      ) : null}
      {(isInitializing || (isAuthenticated && isLoading)) ? (
        <ul className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="h-20 animate-pulse rounded-2xl bg-surface/70 ring-1 ring-line" />
          ))}
        </ul>
      ) : null}
      {isAuthenticated && isError && !isLoading ? (
        <div className="rounded-2xl border border-line bg-surface/60 p-4 text-center text-sm text-muted">
          Failed to load notifications.
          <button
            type="button"
            onClick={() => void refetch()}
            className="ml-2 font-semibold text-primary underline"
          >
            Retry
          </button>
        </div>
      ) : null}
      <ul className="flex flex-col gap-3">
        {(!isAuthenticated || isLoading || isError ? [] : notifications).map((n) => {
          const Icon = n.icon;
          return (
            <li key={n.id}>
              <div className="flex w-full gap-2 rounded-2xl glass-card p-2 text-left transition hover:bg-primary/5">
                <button
                  type="button"
                  onClick={() => {
                    markRead.mutate(n.id);
                    closeOverlay();
                    router.push(n.action);
                  }}
                  className="flex min-w-0 flex-1 gap-3 rounded-xl p-2"
                >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-content">
                      {n.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">
                      {n.time}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">
                    {n.body}
                  </span>
                </span>
                </button>
                <button
                  type="button"
                  onClick={() => removeNotif.mutate(n.id)}
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-error/10 hover:text-error"
                  aria-label="Delete notification"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {isAuthenticated && !isLoading && !isError && notifications.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface/60 p-5 text-center text-sm text-muted">
          No notifications yet.
        </div>
      ) : null}
      {isAuthenticated ? (
        <Link
          href="/notifications"
          onClick={closeOverlay}
          className="mt-4 block text-center text-sm font-semibold text-primary hover:underline"
        >
          View all notifications
        </Link>
      ) : null}
      {isAuthenticated ? (
        <button
          type="button"
          onClick={() => {
            markAllRead.mutate(undefined, {
              onSuccess: () => {
                showToast("All notifications marked as read", "success");
                closeOverlay();
              },
              onError: () => showToast("Could not mark notifications as read", "error"),
            });
          }}
          disabled={markAllRead.isPending || notifications.length === 0}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold text-primary hover:bg-primary/5"
        >
          <Bell size={16} />
          Mark all as read
        </button>
      ) : null}
    </Modal>
  );
}
