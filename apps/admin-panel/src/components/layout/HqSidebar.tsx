"use client";

import Image from "next/image";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Building2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  HQ_SECTIONS,
  isNavItemActive,
  resolveHqSection,
  type HqSectionId,
} from "@/lib/hq-navigation";
import { useMountProbe, useRenderProbe } from "@/lib/render-probe";

const STORAGE_KEY = "homigo-hq-nav-expanded";

const NavLink = memo(function NavLink({
  href,
  label,
  icon: Icon,
  active,
  nested,
}: {
  href: string;
  label: string;
  icon: (typeof HQ_SECTIONS)[number]["items"][number]["icon"];
  active: boolean;
  nested?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-all duration-200",
        nested ? "h-9 px-3" : "h-10 px-3",
        active
          ? "bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-text)]"
          : "text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)] hover:text-[var(--color-biz-text)]",
      )}
    >
      {active ? (
        <span
          className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--color-biz-accent)]"
          aria-hidden
        />
      ) : null}
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          active
            ? "text-[var(--color-biz-accent)]"
            : "text-[var(--color-biz-faint)] group-hover:text-[var(--color-biz-muted)]",
        )}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
});

const HqSectionBlock = memo(function HqSectionBlock({
  sectionId,
  label,
  emoji,
  dashboardHref,
  items,
  pathname,
  expanded,
  onToggle,
}: {
  sectionId: HqSectionId;
  label: string;
  emoji: string;
  dashboardHref: string;
  items: (typeof HQ_SECTIONS)[number]["items"];
  pathname: string;
  expanded: boolean;
  onToggle: (id: HqSectionId) => void;
}) {
  const isActiveSection = resolveHqSection(pathname).id === sectionId;
  const hasActiveChild = items.some((item) => isNavItemActive(pathname, item.href));

  return (
    <div className="mb-0.5" data-hq-section={sectionId}>
      <button
        type="button"
        onClick={() => onToggle(sectionId)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold tracking-tight transition-all duration-200",
          isActiveSection
            ? "bg-[var(--color-biz-glass)] text-[var(--color-biz-text)] ring-1 ring-inset ring-[var(--color-biz-line)]"
            : "text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)] hover:text-[var(--color-biz-text)]",
        )}
        aria-expanded={expanded}
      >
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md text-sm leading-none transition-colors",
            isActiveSection
              ? "bg-[var(--color-biz-accent-dim)] ring-1 ring-inset ring-[rgb(61_126_255_/_0.25)]"
              : "bg-[var(--color-biz-elevated)]",
          )}
          aria-hidden
        >
          {emoji}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--color-biz-faint)] transition-transform duration-200",
            expanded ? "rotate-180" : "",
          )}
        />
      </button>

      <div
        className={cn(
          "grid transition-all duration-200 ease-out",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 py-1 pl-2">
            {dashboardHref !== "/" ? (
              <NavLink
                href={dashboardHref}
                label="HQ Overview"
                icon={Building2}
                active={pathname === dashboardHref}
                nested
              />
            ) : null}
            {items.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isNavItemActive(pathname, item.href)}
                nested
              />
            ))}
          </div>
        </div>
      </div>

      {!expanded && hasActiveChild ? (
        <div className="ml-6 mt-0.5 h-0.5 w-8 rounded-full bg-[var(--color-biz-accent)]" />
      ) : null}
    </div>
  );
});

export const HqSidebar = memo(function HqSidebar() {
  useRenderProbe("HqSidebar");
  useMountProbe("HqSidebar");
  const pathname = usePathname();
  const activeSection = resolveHqSection(pathname).id;

  const [expanded, setExpanded] = useState<Set<HqSectionId>>(() => new Set([activeSection]));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as HqSectionId[];
        setExpanded(new Set(parsed));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(activeSection);
      return next;
    });
  }, [activeSection]);

  const onToggle = useCallback((id: HqSectionId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const sections = useMemo(() => HQ_SECTIONS, []);

  return (
    <aside
      className="biz-sidebar hidden h-dvh w-60 shrink-0 flex-col overflow-hidden lg:flex xl:w-72"
      data-admin-shell
    >
      <div className="biz-sidebar-brand shrink-0">
        <div className="flex items-center gap-3">
          <Image
            src="/brand/logo-full-dark.png"
            alt="Homeeigo"
            width={560}
            height={386}
            className="h-11 w-16 shrink-0 object-contain"
          />
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-biz-muted)]">
            Enterprise OS
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <nav aria-label="Enterprise HQ navigation" className="space-y-0.5">
          {sections.map((section) => (
            <HqSectionBlock
              key={section.id}
              sectionId={section.id}
              label={section.shortLabel}
              emoji={section.emoji}
              dashboardHref={section.dashboardHref}
              items={section.items}
              pathname={pathname}
              expanded={expanded.has(section.id)}
              onToggle={onToggle}
            />
          ))}
        </nav>
      </div>

      <div className="shrink-0 border-t border-[var(--color-biz-line)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="biz-live-dot" aria-hidden />
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-biz-muted)]">
            {sections.reduce((n, s) => n + s.items.length, 0)} routes · 9 HQs · Live
          </p>
        </div>
      </div>
    </aside>
  );
});
