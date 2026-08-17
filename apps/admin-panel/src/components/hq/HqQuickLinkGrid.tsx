"use client";

import Link from "next/link";
import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Icon3D } from "./Icon3D";

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
    <div className={cn("grid gap-4", colClass)}>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          prefetch
          className="biz-hq-link-card group h-full"
        >
          <div className="flex items-start justify-between gap-2">
            <Icon3D icon={link.icon} tone="default" size="md" />
            <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--color-biz-muted)] opacity-0 transition group-hover:opacity-100" />
          </div>
          <p className="mt-4 text-sm font-semibold leading-none">{link.label}</p>
          {link.description ? (
            <p className="mt-2 line-clamp-2 min-h-[2rem] text-xs leading-relaxed text-[var(--color-biz-muted)]">{link.description}</p>
          ) : null}
        </Link>
      ))}
    </div>
  );
});
