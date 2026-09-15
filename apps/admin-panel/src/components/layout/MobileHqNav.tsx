"use client";

import Link from "next/link";
import { memo, useState } from "react";
import { usePathname } from "next/navigation";
import { Building2, Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { HQ_SECTIONS, isNavItemActive, navItemHint, resolveHqSection } from "@/lib/hq-navigation";
import { usePendingHref } from "@/lib/nav-pending";
import { Icon3D } from "@/components/hq/Icon3D";

export const MobileHqNav = memo(function MobileHqNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const pendingHref = usePendingHref();
  const visualPath = pendingHref ?? pathname;
  const current = resolveHqSection(visualPath);

  return (
    <div className="border-b border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] lg:hidden">
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon3D icon={current.icon} size="sm" tone={current.iconTone} />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--color-biz-muted)]">Enterprise OS</p>
            <p className="truncate text-sm font-semibold">{current.label}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-2 text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)]"
          aria-label={open ? "Close navigation" : "Open navigation"}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <nav className="max-h-[60dvh] overflow-y-auto border-t border-[var(--color-biz-line)] px-3 py-2">
          {HQ_SECTIONS.map((section) => (
            <div key={section.id} className="mb-3">
              <p className="mb-1.5 flex items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-biz-muted)]">
                <Icon3D icon={section.icon} size="sm" tone={section.iconTone} />
                {section.shortLabel}
              </p>
              <div className="space-y-0.5">
                {section.dashboardHref !== "/" ? (
                  <Link
                    href={section.dashboardHref}
                    prefetch
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm",
                      visualPath === section.dashboardHref
                        ? "bg-[var(--color-biz-accent-dim)] font-semibold text-[var(--color-biz-text)]"
                        : "text-[var(--color-biz-muted)]",
                    )}
                  >
                    <Icon3D
                      icon={Building2}
                      size="sm"
                      tone={visualPath === section.dashboardHref ? section.iconTone : "default"}
                    />
                    HQ Overview
                  </Link>
                ) : null}
                {section.items.map((item) => {
                  const active = isNavItemActive(visualPath, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch
                      title={navItemHint(item.href)}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm",
                        active
                          ? "bg-[var(--color-biz-accent-dim)] font-semibold text-[var(--color-biz-text)]"
                          : "text-[var(--color-biz-muted)]",
                      )}
                    >
                      <Icon3D icon={item.icon} size="sm" tone={active ? section.iconTone : "default"} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      ) : null}
    </div>
  );
});
