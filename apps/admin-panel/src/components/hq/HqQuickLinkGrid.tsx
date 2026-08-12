"use client";

import Link from "next/link";
import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";

export type QuickLink = {
  href: string;
  label: string;
  description?: string;
  icon: LucideIcon;
};

export const HqQuickLinkGrid = memo(function HqQuickLinkGrid({
  links,
  columns = 3,
}: {
  links: readonly QuickLink[];
  columns?: 2 | 3 | 4;
}) {
  const colClass =
    columns === 4
      ? "sm:grid-cols-2 lg:grid-cols-4"
      : columns === 2
        ? "sm:grid-cols-2"
        : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className={cn("grid gap-3", colClass)}>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          prefetch
          className="biz-hq-link-card group"
        >
          <div className="flex items-start justify-between gap-2">
            <link.icon className="h-5 w-5 shrink-0 text-[var(--color-biz-accent)] transition group-hover:scale-110" />
            <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--color-biz-muted)] opacity-0 transition group-hover:opacity-100" />
          </div>
          <p className="mt-3 text-sm font-semibold">{link.label}</p>
          {link.description ? (
            <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{link.description}</p>
          ) : null}
        </Link>
      ))}
    </div>
  );
});
