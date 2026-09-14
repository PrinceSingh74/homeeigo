"use client";

import { memo, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Icon3D, type Icon3DTone } from "./Icon3D";

export const HqLandingShell = memo(function HqLandingShell({
  emoji,
  icon: Icon,
  iconTone = "default",
  title,
  subtitle,
  children,
  actions,
  className,
}: {
  emoji: string;
  icon?: LucideIcon;
  iconTone?: Icon3DTone;
  title: string;
  subtitle: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto max-w-7xl space-y-6 biz-page-enter", className)}>
      <header className="biz-hq-hero border-b border-[var(--color-biz-line)] pb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3.5">
            {Icon ? (
              <Icon3D icon={Icon} size="lg" tone={iconTone} />
            ) : (
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-biz-accent-dim)] text-xl shadow-[0_0_24px_rgb(61_126_255_/_0.12)] ring-1 ring-inset ring-[rgb(61_126_255_/_0.25)]"
                aria-hidden
              >
                {emoji}
              </span>
            )}
            <div className="space-y-1">
              <h1 className="biz-display text-2xl font-bold tracking-tight md:text-[1.75rem]">
                {title}
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-[var(--color-biz-muted)]">{subtitle}</p>
            </div>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      {children}
    </div>
  );
});
