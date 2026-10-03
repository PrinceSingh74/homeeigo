"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2 } from "lucide-react";
import { getHqSection, isNavItemActive, navItemHint } from "@/lib/hq-navigation";
import { Icon3D } from "@/components/hq/Icon3D";
import { cn } from "@/lib/cn";

export function OperationsWorkspaceRail() {
  const pathname = usePathname();
  const ops = getHqSection("operations");
  if (!ops) return null;

  const items = [
    { href: ops.dashboardHref, label: "HQ Overview", icon: Building2 },
    ...ops.items,
  ];

  return (
    <nav
      aria-label="Operations workspaces"
      className="biz-card flex gap-2 overflow-x-auto p-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          item.href === ops.dashboardHref
            ? pathname === item.href
            : isNavItemActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch
            title={navItemHint(item.href) ?? item.label}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 transition",
              active
                ? "border-[var(--color-biz-accent)] bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-text)]"
                : "border-[var(--color-biz-line)] text-[var(--color-biz-muted)] hover:border-[var(--color-biz-accent)]/40 hover:text-[var(--color-biz-text)]",
            )}
          >
            <Icon3D icon={Icon} size="sm" tone={active ? "default" : "slate"} />
            <span className="pr-0.5 text-xs font-semibold whitespace-nowrap">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function OpsEyebrow() {
  return (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-biz-muted)]">
      Operations HQ
    </p>
  );
}
