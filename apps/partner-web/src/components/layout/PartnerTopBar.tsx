"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Bell, ChevronDown, Loader2, LogOut, Menu, Search, Sun } from "lucide-react";
import { AppearanceMenu } from "@/components/theme/AppearanceMenu";
import { useRouter } from "next/navigation";
import {
  usePartnerDashboardQuery,
  usePartnerMeQuery,
  usePartnerNotificationsQuery,
} from "@/hooks/use-partner-data";
import { usePartnerStore, usePartnerUserName } from "@/stores/partner-store";
import { getGreeting } from "@/lib/format";

type PartnerTopBarProps = {
  onMenuOpen?: () => void;
};

export function PartnerTopBar({ onMenuOpen }: PartnerTopBarProps) {
  const router = useRouter();
  const logout = usePartnerStore((s) => s.logout);
  const me = usePartnerMeQuery();
  const dashboard = usePartnerDashboardQuery();
  const fullName = usePartnerUserName();
  const firstName = fullName.split(" ")[0] || fullName;
  const initials = fullName.charAt(0).toUpperCase();
  const pendingRequests = dashboard.data?.counts.pendingRequests ?? 0;
  const notifications = usePartnerNotificationsQuery({ limit: 1 });
  const unreadNotifications = notifications.data?.unreadCount ?? 0;
  const bellCount = unreadNotifications + pendingRequests;
  const [signingOut, setSigningOut] = useState(false);

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      router.replace("/login");
    }
  }

  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
      className="partner-header fixed top-0 right-0 z-40 lg:left-[var(--sidebar-width)]"
    >
      <div className="partner-header-inner px-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onMenuOpen}
            className="shrink-0 rounded-lg p-2 text-partner-muted transition hover:bg-white/5 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-bold tracking-[-0.03em] text-partner-text lg:text-xl">
              {getGreeting()}, {firstName} 👋
            </h1>
            <p className="mt-0.5 hidden truncate text-[13px] leading-snug text-partner-text-secondary sm:block">
              {pendingRequests > 0
                ? `${pendingRequests} new request${pendingRequests === 1 ? "" : "s"} waiting for you.`
                : "You're all caught up — stay online for new jobs."}
            </p>
          </div>
        </div>

        <div className="hidden md:flex md:justify-center">
          <div className="flex h-10 w-full max-w-[400px] items-center gap-3 rounded-[10px] border border-partner-primary/20 bg-partner-primary/10 px-4">
            <Search className="h-4 w-4 shrink-0 text-partner-muted" />
            <input
              type="search"
              placeholder="Search bookings, customers…"
              className="min-w-0 flex-1 bg-transparent text-sm leading-none text-partner-text outline-none placeholder:text-partner-muted"
            />
            <kbd className="hidden shrink-0 rounded border border-partner-line px-1.5 py-0.5 font-sans text-[11px] text-partner-muted lg:inline">
              ⌘K
            </kbd>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 lg:gap-4">
          <AppearanceMenu />

          <div className="hidden text-right xl:block">
            <p className="text-[11px] leading-tight text-partner-muted">{dateStr}</p>
            <p className="mt-0.5 flex items-center justify-end gap-2 text-[13px] text-partner-text-secondary">
              <span>{timeStr}</span>
              <span className="flex items-center gap-1">
                <Sun className="h-4 w-4 text-amber-400" />
                {me.data?.city ?? "Online"}
              </span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/notifications")}
            className="relative shrink-0 rounded-[10px] p-2.5 text-partner-text-secondary transition hover:bg-partner-primary/10"
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell className="h-5 w-5" />
            {bellCount > 0 ? (
              <span className="badge-pulse absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-partner-danger px-1 text-[9px] font-bold text-white">
                {bellCount > 9 ? "9+" : bellCount}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => router.push("/profile")}
            className="flex shrink-0 items-center gap-2 rounded-[10px] p-1 transition hover:bg-partner-primary/10"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border-2 border-partner-primary/30 bg-partner-primary/20 text-xs font-bold text-partner-primary">
              {initials}
            </div>
            <ChevronDown className="hidden h-3.5 w-3.5 text-partner-muted sm:block" />
          </button>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            aria-label="Sign out"
            className="shrink-0 rounded-[10px] p-2.5 text-partner-text-secondary transition hover:bg-partner-primary/10 disabled:opacity-60"
          >
            {signingOut ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <LogOut className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </motion.header>
  );
}
