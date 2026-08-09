"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Power, Trophy, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  usePartnerDashboardQuery,
  usePartnerMeQuery,
  usePartnerNotificationsQuery,
  useSetOnlineMutation,
} from "@/hooks/use-partner-data";
import { usePartnerStore, usePartnerUserName } from "@/stores/partner-store";
import { cn } from "@/lib/cn";
import {
  PARTNER_HQ_NAV,
  isPartnerNavActive,
  type PartnerNavSection,
} from "@/lib/partner-navigation";

type PartnerSidebarProps = {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
};

function sectionHasActive(pathname: string, section: PartnerNavSection) {
  return section.items.some((item) => isPartnerNavActive(pathname, item.href, item.label));
}

export function PartnerSidebar({ mobileOpen, onMobileClose }: PartnerSidebarProps) {
  const pathname = usePathname() ?? "/";
  const me = usePartnerMeQuery();
  const dashboard = usePartnerDashboardQuery();
  const notifications = usePartnerNotificationsQuery({ limit: 1, unreadOnly: true });
  const setOnline = useSetOnlineMutation();

  const authUser = usePartnerStore((s) => s.user);
  const storeName = usePartnerUserName();
  const provider = me.data;
  const online = provider?.isOnline ?? false;
  const fullName = provider?.name ?? storeName;
  const firstInitial = (provider?.firstName ?? authUser?.firstName ?? fullName).charAt(0).toUpperCase();
  const rating = provider?.rating ?? 0;
  const reviews = provider?.totalReviews ?? 0;
  const pending = dashboard.data?.counts.pendingRequests ?? 0;
  const unread = notifications.data?.unreadCount ?? 0;

  const defaultOpen = useMemo(() => {
    const open = new Set<string>();
    for (const section of PARTNER_HQ_NAV) {
      if (sectionHasActive(pathname, section)) open.add(section.id);
    }
    if (open.size === 0) open.add("home");
    return open;
  }, [pathname]);

  const [openSections, setOpenSections] = useState<Set<string>>(defaultOpen);

  const toggleSection = (id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sidebar = (
    <motion.aside
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "partner-sidebar partner-scroll fixed inset-y-0 left-0 z-50 flex flex-col",
        "lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
      )}
    >
      {onMobileClose && (
        <button
          type="button"
          onClick={onMobileClose}
          className="absolute right-3 top-4 z-10 rounded-lg p-1.5 text-partner-muted hover:bg-partner-primary/10 lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      )}

      <div className="flex h-[60px] shrink-0 items-center gap-3 px-5">
        <Image
          src="/brand/logo-full.png"
          alt="Homeeigo"
          width={560}
          height={386}
          className="h-10 w-[58px] shrink-0 object-contain dark:hidden"
        />
        <Image
          src="/brand/logo-full-dark.png"
          alt="Homeeigo"
          width={560}
          height={386}
          className="hidden h-10 w-[58px] shrink-0 object-contain dark:block"
        />
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] leading-none text-partner-text-secondary">
          Partner OS
        </p>
      </div>

      <div className="mx-4 mb-4 flex shrink-0 items-center gap-3 rounded-xl border border-partner-line bg-gradient-to-br from-[#f6f1d6]/60 to-[#d8ead7]/40 p-3.5 dark:from-partner-primary/10 dark:to-partner-accent/5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-partner-line bg-partner-card font-display text-sm font-bold text-partner-primary">
          {firstInitial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[13px] font-bold tracking-tight text-partner-text">{fullName}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-partner-text-secondary">
            <span>⭐ {rating > 0 ? rating.toFixed(1) : "—"} ({reviews})</span>
            <span className="flex items-center gap-1">
              <span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-partner-success status-pulse" : "bg-partner-muted")} />
              {online ? "Online" : "Offline"}
            </span>
          </p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
        {PARTNER_HQ_NAV.map((section) => {
          const SectionIcon = section.icon;
          const isOpen = openSections.has(section.id);
          const activeSection = sectionHasActive(pathname, section);

          return (
            <div key={section.id} className="mb-1">
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className={cn(
                  "flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold uppercase tracking-wider transition",
                  activeSection ? "text-partner-primary" : "text-partner-muted hover:text-partner-text",
                )}
              >
                <SectionIcon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{section.label}</span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
              </button>

              <AnimatePresence initial={false}>
                {isOpen ? (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-0.5 space-y-0.5 pb-1 pl-1">
                      {section.items.map(({ href, label, icon: Icon, badgeLabel }) => {
                        const active = isPartnerNavActive(pathname, href, label);
                        const badge =
                          label === "Requests" ? pending : label === "Notifications" ? unread : 0;

                        return (
                          <Link
                            key={label}
                            href={href}
                            onClick={onMobileClose}
                            className={cn(
                              "relative flex h-10 items-center gap-2.5 rounded-[10px] px-3 text-sm font-medium transition-all duration-200",
                              active
                                ? "partner-nav-active bg-partner-primary/10 text-partner-primary"
                                : "text-partner-text-secondary hover:bg-partner-primary/5 hover:text-partner-text",
                            )}
                          >
                            <Icon className={cn("h-4 w-4 shrink-0", active ? "text-partner-primary" : "text-partner-muted")} strokeWidth={2} />
                            <span className="truncate">{label}</span>
                            {badgeLabel ? (
                              <span className="ml-auto shrink-0 rounded-md bg-partner-purple/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-partner-purple">
                                {badgeLabel}
                              </span>
                            ) : badge > 0 ? (
                              <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-partner-danger px-1 text-[10px] font-bold text-white">
                                {badge}
                              </span>
                            ) : null}
                          </Link>
                        );
                      })}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 space-y-3 border-t border-partner-line/80 px-4 py-4">
        <div className="rounded-xl border border-partner-line bg-gradient-to-br from-[#f6f1d6]/50 to-[#d8ead7]/30 p-4 text-center dark:from-partner-primary/10 dark:to-partner-purple/5">
          <Trophy className="mx-auto h-9 w-9 text-amber-500" />
          <p className="mt-2 text-xs leading-relaxed text-partner-text-secondary">
            Climb commission tiers by completing more jobs this month.
          </p>
          <Link
            href="/performance-hq/scorecard"
            className="partner-glow-btn mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg bg-partner-primary text-[13px] font-semibold text-white"
          >
            View scorecard
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOnline.mutate(!online)}
          disabled={setOnline.isPending}
          className={cn(
            "flex h-10 w-full items-center justify-center gap-2 rounded-lg text-[13px] font-semibold text-white transition active:scale-[0.98]",
            online ? "bg-partner-danger" : "bg-partner-success",
            setOnline.isPending && "opacity-60",
          )}
        >
          <Power className="h-4 w-4" />
          {setOnline.isPending ? "Updating…" : online ? "Go Offline" : "Go Online"}
        </button>
      </div>
    </motion.aside>
  );

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          aria-label="Close overlay"
          onClick={onMobileClose}
        />
      )}
      {sidebar}
    </>
  );
}
