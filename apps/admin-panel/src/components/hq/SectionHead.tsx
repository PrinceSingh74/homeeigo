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
}: {
  icon?: LucideIcon;
  tone?: Icon3DTone;
  title: string;
  subtitle?: string;
  meta?: string;
  action?: ReactNode;
}) {
  return (
    <div className="exec-section-head">
      <div className="exec-section-head__title">
        {icon ? <Icon3D icon={icon} tone={tone} size="md" /> : null}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold leading-snug tracking-tight">{title}</h2>
          {subtitle ? (
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-[var(--color-biz-muted)]">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {action ??
        (meta ? <span className="exec-section-head__meta">{meta}</span> : null)}
    </div>
  );
}
