"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bell,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { pageLead, pageTitle } from "@/lib/page-layout";
import { coreApi } from "@/services/core/api";
import {
  useDeleteNotificationMutation,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
} from "@/hooks/use-core-data";
import { useAppStore } from "@/stores/app-store";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/utils";
import type { BackendNotification } from "@/types/backend";

const PAGE_SIZE = 15;

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "booking", label: "Bookings" },
  { key: "offer", label: "Offers" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function iconFor(type: string) {
  if (type.includes("offer") || type.includes("promo")) return Tag;
  if (type.includes("booking")) return Sparkles;
  return MapPin;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function NotificationsPage() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const showToast = useAppStore((s) => s.showToast);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [page, setPage] = useState(1);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page) });
    if (filter === "unread") params.set("isRead", "false");
    if (filter === "booking") params.set("type", "booking");
    if (filter === "offer") params.set("type", "offer");
    return `?${params.toString()}`;
  }, [filter, page]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["notifications", "page", filter, page],
    queryFn: () => coreApi.notifications.list(queryString),
    enabled: isAuthenticated,
    staleTime: 10_000,
  });

  const markRead = useMarkNotificationReadMutation();
  const markAllRead = useMarkAllNotificationsReadMutation();
  const removeNotif = useDeleteNotificationMutation();

  const notifications = (data?.notifications ?? []) as BackendNotification[];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const unreadCount = data?.unreadCount ?? 0;

  // Visiting this page IS reading — clear the badge shortly after the list renders.
  const markAllSilently = markAllRead.mutate;
  useEffect(() => {
    if (!isAuthenticated || isLoading || unreadCount === 0) return;
    const t = setTimeout(() => markAllSilently(), 1200);
    return () => clearTimeout(t);
  }, [isAuthenticated, isLoading, unreadCount, markAllSilently]);

  return (
    <PageShell>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3 sm:mb-8">
        <div>
          <Link
            href="/"
            className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition hover:text-primary"
          >
            <ArrowLeft size={16} />
            Back home
          </Link>
          <h1 className={pageTitle}>Notifications</h1>
          <p className={pageLead}>
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            markAllRead.mutate(undefined, {
              onSuccess: () => showToast("All notifications marked as read", "success"),
              onError: () => showToast("Could not mark notifications as read", "error"),
            })
          }
          disabled={markAllRead.isPending || unreadCount === 0}
          className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-content transition hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <CheckCheck size={16} />
          Mark all read
        </button>
      </header>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setFilter(key);
              setPage(1);
            }}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-semibold transition",
              filter === key
                ? "bg-primary text-white"
                : "border border-line text-muted hover:border-primary hover:text-primary",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <ul className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="h-20 animate-pulse rounded-2xl bg-surface/70 ring-1 ring-line" />
          ))}
        </ul>
      ) : isError ? (
        <div className="rounded-2xl border border-line bg-surface/60 p-6 text-center text-sm text-muted">
          Failed to load notifications.
          <button
            type="button"
            onClick={() => void refetch()}
            className="ml-2 font-semibold text-primary underline"
          >
            Retry
          </button>
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-line bg-surface/60 px-6 py-14 text-center">
          <Bell size={36} className="mx-auto text-muted" />
          <p className="mt-3 text-sm font-semibold text-content">No notifications here</p>
          <p className="mt-1 text-sm text-muted">
            {filter === "all"
              ? "Booking updates and offers will show up here."
              : "Nothing matches this filter."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {notifications.map((n) => {
            const Icon = iconFor(n.type);
            return (
              <li
                key={n.id}
                className={cn(
                  "flex gap-3 rounded-2xl glass-card p-4 transition",
                  !n.isRead && "border-primary/25 ring-1 ring-primary/15",
                )}
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-content">
                      {n.title}
                      {!n.isRead && (
                        <span className="ml-2 inline-block size-2 rounded-full bg-primary align-middle" />
                      )}
                    </p>
                    <span className="shrink-0 text-[11px] text-muted">{timeAgo(n.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted">{n.message}</p>
                  <div className="mt-2 flex gap-3">
                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={() => markRead.mutate(n.id)}
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        Mark as read
                      </button>
                    )}
                    {n.referenceId ? (
                      <Link
                        href="/bookings"
                        onClick={() => markRead.mutate(n.id)}
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        View booking
                      </Link>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeNotif.mutate(n.id)}
                  className="grid size-9 shrink-0 place-items-center self-start rounded-lg text-muted transition hover:bg-error/10 hover:text-error"
                  aria-label="Delete notification"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="grid size-10 place-items-center rounded-xl border border-line text-content disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-semibold text-muted">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="grid size-10 place-items-center rounded-xl border border-line text-content disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      ) : null}
    </PageShell>
  );
}
