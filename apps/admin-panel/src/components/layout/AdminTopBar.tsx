"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Bell, Loader2, LogOut, Moon, Sun } from "lucide-react";
import {
  useAdminProvidersQuery,
  useAdminCustomersQuery,
  useAdminNotificationsQuery,
  useMarkAllAdminNotificationsReadMutation,
} from "@/hooks/use-admin-data";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import { useAdminStore, useAdminUserName } from "@/stores/admin-store";
import { resolveHqSection } from "@/lib/hq-navigation";
import { GlobalSearch } from "@/components/layout/GlobalSearch";

/**
 * Lightweight top bar with:
 * - Real admin name + role
 * - Pending-vendor count surfaced from /api/admin/providers?status=pending
 * - Global command-search (partners / bookings / customers) via <GlobalSearch/>
 * - Sign-out
 */
export const AdminTopBar = memo(function AdminTopBar() {
  useRenderProbe("AdminTopBar");
  useMountProbe("AdminTopBar");
  const name = useAdminUserName();
  const router = useRouter();
  const pathname = usePathname();
  const hq = resolveHqSection(pathname);
  const logout = useAdminStore((s) => s.logout);
  const [signingOut, setSigningOut] = useState(false);

  const pendingProviders = useAdminProvidersQuery({ page: 1, limit: 1, status: "pending", badge: true });
  const bannedCustomers = useAdminCustomersQuery({ page: 1, limit: 1, status: "banned", badge: true });

  // Bell = the admin's own notification feed (same pipeline as customer/partner).
  const notifications = useAdminNotificationsQuery();
  const markAllRead = useMarkAllAdminNotificationsReadMutation();
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const notifItems = notifications.data?.notifications ?? [];
  const unreadCount = notifications.data?.unreadCount ?? 0;

  // Close on outside click / Escape.
  useEffect(() => {
    if (!bellOpen) return;
    const onDown = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBellOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [bellOpen]);

  // Viewing the dropdown IS reading — clear the badge shortly after open.
  const markAllSilently = markAllRead.mutate;
  useEffect(() => {
    if (!bellOpen || unreadCount === 0) return;
    const t = setTimeout(() => markAllSilently(), 1200);
    return () => clearTimeout(t);
  }, [bellOpen, unreadCount, markAllSilently]);

  // Day/Night — "Executive Mint" light remap vs default Graphite (tokens only).
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  }, []);
  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    if (next === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem("homigo-admin-theme", next);
    } catch {
      /* storage unavailable — session-only */
    }
  }

  const alertCount =
    (pendingProviders.data?.total ?? 0) + (bannedCustomers.data?.total ?? 0);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      router.replace("/login");
    }
  }

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-[var(--color-biz-line)] bg-[var(--color-biz-surface)]/80 px-4 py-3 backdrop-blur-md md:px-6">
      <div className="mr-4 hidden min-w-0 items-center gap-2 sm:flex">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--color-biz-elevated)] text-xs ring-1 ring-inset ring-[var(--color-biz-line)]"
          aria-hidden
        >
          {hq.emoji}
        </span>
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">
          {hq.label}
        </p>
      </div>
      <GlobalSearch />
      <div className="ml-4 flex items-center gap-3">
        {alertCount > 0 ? (
          <span
            className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-300"
            title="Pending vendor approvals + banned users"
          >
            {alertCount} flag{alertCount === 1 ? "" : "s"}
          </span>
        ) : null}
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg p-2 text-[var(--color-biz-muted)] transition-colors hover:bg-[var(--color-biz-elevated)] hover:text-[var(--color-biz-text)]"
          aria-label={theme === "light" ? "Switch to night mode" : "Switch to day mode"}
          title={theme === "light" ? "Night mode" : "Day mode"}
        >
          {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </button>
        <div ref={bellRef} className="relative">
          <button
            type="button"
            onClick={() => setBellOpen((v) => !v)}
            className="relative rounded-lg p-2 text-[var(--color-biz-muted)] transition-colors hover:bg-[var(--color-biz-elevated)] hover:text-[var(--color-biz-text)]"
            aria-label="Notifications"
            aria-expanded={bellOpen}
            title="Notifications"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[var(--color-biz-accent)] px-1 text-[9px] font-bold text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </button>
          {bellOpen ? (
            <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-[var(--color-biz-line-strong)] bg-[var(--color-biz-surface)] shadow-[var(--shadow-enterprise)]">
              <div className="flex items-center justify-between border-b border-[var(--color-biz-line)] px-4 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
                  Notifications
                </p>
                {unreadCount > 0 ? (
                  <span className="rounded-full bg-[var(--color-biz-accent-dim)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-biz-accent)]">
                    {unreadCount} new
                  </span>
                ) : null}
              </div>
              <ul className="max-h-80 overflow-y-auto">
                {notifications.isLoading ? (
                  <li className="px-4 py-6 text-center text-sm text-[var(--color-biz-muted)]">Loading…</li>
                ) : notifItems.length === 0 ? (
                  <li className="px-4 py-6 text-center text-sm text-[var(--color-biz-muted)]">
                    No notifications yet.
                  </li>
                ) : (
                  notifItems.map((n) => (
                    <li
                      key={n.id}
                      className={`border-b border-[var(--color-biz-line)] px-4 py-3 last:border-b-0 ${
                        n.isRead ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {!n.isRead ? (
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-biz-accent)]" />
                        ) : (
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[var(--color-biz-text)]">{n.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-biz-muted)]">{n.message}</p>
                          <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--color-biz-faint)]">
                            {new Date(n.createdAt).toLocaleString("en-IN", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium leading-tight">{name}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-biz-muted)]">Admin</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-biz-accent-dim)] text-sm font-bold text-[var(--color-biz-accent)] ring-1 ring-inset ring-[var(--color-biz-line-strong)]">
          {name.charAt(0).toUpperCase()}
        </div>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={signingOut}
          aria-label="Sign out"
          className="rounded-lg p-2 text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)] disabled:opacity-60"
        >
          {signingOut ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <LogOut className="h-5 w-5" />
          )}
        </button>
      </div>
    </header>
  );
});
