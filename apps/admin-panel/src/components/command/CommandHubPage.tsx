"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";

export type CommandHubLink = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  tone?: Icon3DTone;
};

export function CommandHubPage({
  icon,
  tone = "cyan",
  title,
  subtitle,
  links,
  children,
}: {
  icon: LucideIcon;
  tone?: Icon3DTone;
  title: string;
  subtitle: string;
  links: readonly CommandHubLink[];
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 biz-page-enter">
      <SectionHead icon={icon} tone={tone} title={title} subtitle={subtitle} />
      {children}
      <nav aria-label={`${title} destinations`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="biz-glass-panel group flex items-start gap-3 p-4 transition hover:border-[var(--color-biz-accent)]/40"
            >
              <Icon3D icon={Icon} tone={link.tone ?? tone} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-sm font-semibold">
                  {link.label}
                  <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-biz-muted)]">{link.description}</p>
              </div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
