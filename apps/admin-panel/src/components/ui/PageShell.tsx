import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";

export function PageShell({
  title,
  subtitle,
  children,
  actions,
  eyebrow,
  icon: Icon,
  iconTone = "default",
  className,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: string;
  icon?: LucideIcon;
  iconTone?: Icon3DTone;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto max-w-7xl space-y-6 biz-page-enter", className)}>
      <header className="biz-page-hero">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            {Icon ? <Icon3D icon={Icon} tone={iconTone} size="lg" /> : null}
            <div className="min-w-0">
              {eyebrow ? (
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-biz-muted)]">
                  {eyebrow}
                </p>
              ) : null}
              <h1 className="biz-display text-2xl font-bold tracking-tight md:text-[1.75rem]">{title}</h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--color-biz-muted)]">{subtitle}</p>
            </div>
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      {children}
    </div>
  );
}
