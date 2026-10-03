"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Icon3D, type Icon3DTone } from "./Icon3D";

export function SectionHead({
  icon,
  tone = "default",
  title,
  subtitle,
  meta,
  action,
  as = "h2",
}: {
  icon?: LucideIcon;
  tone?: Icon3DTone;
  title: string;
  subtitle?: string;
  meta?: string;
  action?: ReactNode;
  /** Page-level titles use h1; nested dashboard sections stay h2. */
  as?: "h1" | "h2";
}) {
  const Heading = as;
  return (
    <div className="exec-section-head">
      <div className="exec-section-head__title">
        {icon ? <Icon3D icon={icon} tone={tone} size="md" /> : null}
        <div className="min-w-0">
          <Heading className="truncate text-base font-semibold leading-snug tracking-tight md:text-lg">{title}</Heading>
          {subtitle ? (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--color-biz-muted)]">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {action ??
        (meta ? <span className="exec-section-head__meta">{meta}</span> : null)}
    </div>
  );
}
