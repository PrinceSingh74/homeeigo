"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  ClipboardList,
  Calendar,
  Wallet,
  Wallet2,
  BarChart3,
  Sparkles,
  MessageSquare,
  Bell,
  HelpCircle,
  Settings,
  Trophy,
  Power,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { usePartnerStore } from "@/stores/partner-store";
import { DEMO_VENDOR } from "@/lib/partner-data";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/requests", label: "Requests", icon: ClipboardList, badge: 3 },
  { href: "/requests", label: "Bookings", icon: Calendar },
  { href: "/wallet", label: "Earnings", icon: Wallet },
  { href: "/wallet", label: "Wallet", icon: Wallet2 },
  { href: "/analytics", label: "Performance", icon: BarChart3 },
  { href: "/ai", label: "AI Assistant", icon: Sparkles, badgeLabel: "New" },
  { href: "/profile", label: "Messages", icon: MessageSquare, badge: 2 },
  { href: "/", label: "Notifications", icon: Bell, badge: 5 },
  { href: "/profile", label: "Help & Support", icon: HelpCircle },
  { href: "/profile", label: "Settings", icon: Settings },
] as const;

type PartnerSidebarProps = {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
};

export function PartnerSidebar({ mobileOpen, onMobileClose }: PartnerSidebarProps) {
  const pathname = usePathname();
  const vendor = usePartnerStore((s) => s.vendor);
  const online = vendor.online;
  const setOnline = usePartnerStore((s) => s.setOnline);
  const pending = usePartnerStore((s) => s.requests.length);

  const isActive = (_href: string, label: string) => {
    if (label === "Dashboard") return pathname === "/";
    if (label === "Requests") return pathname === "/requests";
    if (label === "Bookings") return pathname.startsWith("/requests");
    if (label === "Earnings" || label === "Wallet") return pathname.startsWith("/wallet");
    if (label === "Performance") return pathname.startsWith("/analytics");
    if (label === "AI Assistant") return pathname.startsWith("/ai");
    if (label === "Settings" || label === "Messages" || label === "Help & Support")
      return pathname.startsWith("/profile");
    return false;
  };

  const sidebar = (
    <motion.aside
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={cn(
        "partner-sidebar partner-scroll fixed inset-y-0 left-0 z-50 flex flex-col",
        "lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}
    >
      {onMobileClose && (
        <button
          type="button"
          onClick={onMobileClose}
          className="absolute right-3 top-4 z-10 rounded-lg p-1.5 text-partner-muted hover:bg-white/5 lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      )}
      <div className="flex h-[60px] shrink-0 items-center gap-3 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-partner-primary to-partner-purple font-display text-sm font-bold text-white shadow-[0_0_12px_rgb(37_99_235/0.4)]">
          H
        </div>
        <div>
          <p className="font-display text-base font-bold tracking-[-0.02em] text-partner-text">
            HOMIGO
          </p>
          <p className="text-[11px] font-medium leading-none text-partner-text-secondary">
            PARTNER
          </p>
        </div>
      </div>

      <div className="mx-5 mb-6 flex shrink-0 items-center gap-3 rounded-xl bg-partner-primary/10 p-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] border-2 border-partner-primary bg-partner-primary/20 font-display text-sm font-bold text-partner-primary shadow-[0_0_12px_rgb(37_99_235/0.3)]">
          {vendor.avatarInitials ?? "RS"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[13px] font-bold tracking-tight text-partner-text">
            {vendor.name}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-snug text-partner-text-secondary">
            <span>⭐ {vendor.rating.toFixed(1)} ({DEMO_VENDOR.reviewCount})</span>
            <span className="flex items-center gap-1">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  online ? "bg-partner-success status-pulse" : "bg-partner-muted"
                )}
              />
              {online ? "Online" : "Offline"}
            </span>
          </p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-4">
        {NAV.map(({ href, label, icon: Icon, ...meta }) => {
          const active = isActive(href, label);
          const badge =
            label === "Requests"
              ? pending || ("badge" in meta ? meta.badge : 0)
              : "badge" in meta
                ? meta.badge
                : 0;
          const badgeLabel = "badgeLabel" in meta ? meta.badgeLabel : null;

          return (
            <Link
              key={label}
              href={href}
              onClick={onMobileClose}
              className={cn(
                "relative flex h-11 items-center gap-3 rounded-[10px] px-4 text-sm font-medium transition-all duration-200",
                active
                  ? "partner-nav-active pl-[13px] text-partner-primary"
                  : "border-l-[3px] border-transparent pl-4 text-partner-text-secondary hover:bg-partner-primary/10 hover:text-partner-text"
              )}
            >
              <Icon
                className={cn("h-5 w-5 shrink-0", active ? "text-partner-primary" : "text-partner-muted")}
                strokeWidth={2}
              />
              <span className={cn("truncate", active && "text-partner-text")}>{label}</span>
              {badgeLabel && (
                <span className="ml-auto shrink-0 rounded-md bg-partner-purple/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-partner-purple">
                  {badgeLabel}
                </span>
              )}
              {!badgeLabel && badge > 0 && (
                <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-partner-danger px-1 text-[10px] font-bold text-white">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 space-y-3 border-t border-partner-line/80 px-4 py-4">
        <div className="rounded-xl border border-partner-primary/20 bg-gradient-to-br from-partner-primary/15 to-partner-purple/10 p-4 text-center">
          <Trophy className="mx-auto h-10 w-10 text-amber-400 drop-shadow-[0_0_8px_rgb(251_191_36/0.5)]" />
          <p className="mt-3 text-xs leading-relaxed text-partner-text-secondary">
            Complete more jobs to unlock extra bonuses
          </p>
          <button
            type="button"
            className="partner-glow-btn mt-3 h-10 w-full rounded-lg bg-partner-primary text-[13px] font-semibold text-white transition hover:scale-[1.02]"
          >
            View Incentives
          </button>
        </div>

        <button
          type="button"
          onClick={() => setOnline(!online)}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-partner-danger text-[13px] font-semibold text-white transition hover:scale-[1.02] active:scale-[0.98]"
        >
          <Power className="h-4 w-4" />
          {online ? "Go Offline" : "Go Online"}
        </button>
        <p className="pb-1 text-center text-[9px] text-partner-muted-dim">Version 2.4.1</p>
      </div>
    </motion.aside>
  );

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          aria-label="Close overlay"
          onClick={onMobileClose}
        />
      )}
      {sidebar}
    </>
  );
}
