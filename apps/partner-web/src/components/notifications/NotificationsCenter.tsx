"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, Loader2, Trash2 } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import {
  useDeleteNotificationMutation,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  usePartnerNotificationsQuery,
} from "@/hooks/use-partner-data";
import { formatDate, formatTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { PartnerNotification } from "@/types/partner";

type Filter = "all" | "booking" | "earning" | "payment" | "system" | "review";

function categorize(type: string): Filter {
  const t = type.toLowerCase();
  if (t.includes("booking") || t.includes("service")) return "booking";
  if (t.includes("earn") || t.includes("payout") || t.includes("withdraw")) return "earning";
  if (t.includes("payment") || t.includes("wallet")) return "payment";
  if (t.includes("rating") || t.includes("review")) return "review";
  return "system";
}

function iconFor(filter: Filter): string {
  switch (filter) {
    case "booking":
      return "📋";
    case "earning":
      return "💰";
    case "payment":
      return "💳";
    case "review":
      return "⭐";
    default:
      return "🔔";
  }
}

export function NotificationsCenter() {
  const [filter, setFilter] = useState<Filter>("all");
  const { data, isLoading, isFetching } = usePartnerNotificationsQuery({ limit: 50 });
  const markRead = useMarkNotificationReadMutation();
  const markAllRead = useMarkAllNotificationsReadMutation();
  const remove = useDeleteNotificationMutation();

  const unread =
    data?.unreadCount ?? (data?.notifications ?? []).filter((n) => !n.isRead).length;

  // Viewing the center IS reading — clear the badge shortly after the list renders.
  const markAllSilently = markAllRead.mutate;
  useEffect(() => {
    if (isLoading || unread === 0) return;
    const t = setTimeout(() => markAllSilently(), 1200);
    return () => clearTimeout(t);
  }, [isLoading, unread, markAllSilently]);

  const filtered = useMemo(() => {
    const items = data?.notifications ?? [];
    if (filter === "all") return items;
    return items.filter((n) => categorize(n.type) === filter);
  }, [filter, data?.notifications]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-partner-primary" />
          <p className="text-sm text-partner-muted">
            Unread: <span className="font-bold text-partner-text">{unread}</span>
          </p>
          {isFetching && !isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-partner-muted" />
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-partner-line pb-3">
        {(["all", "booking", "earning", "payment", "system", "review"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition",
              filter === f
                ? "bg-partner-primary text-white"
                : "text-partner-muted hover:bg-partner-bg/60 hover:text-partner-text",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-partner-bg/60" />
          ))
        ) : filtered.length === 0 ? (
          <PartnerCard className="py-12 text-center">
            <p className="text-lg">🔔</p>
            <p className="mt-2 text-sm text-partner-muted">No notifications</p>
          </PartnerCard>
        ) : (
          filtered.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              onMarkRead={() => markRead.mutate(n.id)}
              onDelete={() => remove.mutate(n.id)}
              marking={markRead.isPending}
            />
          ))
        )}
      </div>
    </div>
  );
}

function NotificationRow({
  notification: n,
  onMarkRead,
  onDelete,
  marking,
}: {
  notification: PartnerNotification;
  onMarkRead: () => void;
  onDelete: () => void;
  marking: boolean;
}) {
  const cat = categorize(n.type);
  return (
    <div
      className={cn(
        "rounded-2xl border-l-4 p-4 transition",
        n.isRead
          ? "border-partner-line bg-partner-bg/30"
          : "border-partner-primary bg-partner-card shadow-sm",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="text-2xl">{iconFor(cat)}</span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-partner-text">{n.title}</h3>
            <p className="mt-1 text-sm text-partner-muted">{n.message}</p>
            <p className="mt-2 text-[10px] text-partner-muted">
              {formatDate(n.createdAt)} · {formatTime(n.createdAt)}
              {relativeTime(n.createdAt) ? ` · ${relativeTime(n.createdAt)}` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {!n.isRead ? (
            <button
              type="button"
              disabled={marking}
              onClick={onMarkRead}
              className="rounded-lg bg-partner-primary px-2.5 py-1 text-[10px] font-semibold text-white disabled:opacity-50"
            >
              Mark read
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg p-1.5 text-partner-muted hover:bg-partner-bg/60 hover:text-partner-danger"
            aria-label="Delete notification"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
