import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";

export function Panel({
  title,
  hint,
  action,
  icon: Icon,
  iconTone = "default",
  children,
  className,
  padded = true,
}: {
  title?: string;
  hint?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
  iconTone?: Icon3DTone;
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cn("biz-card overflow-hidden", className)}>
      {title || action || Icon ? (
        <header className="biz-panel-head">
          <div className="flex min-w-0 items-start gap-3">
            {Icon ? <Icon3D icon={Icon} size="sm" tone={iconTone} /> : null}
            <div className="min-w-0">
              {title ? <h2 className="text-sm font-semibold tracking-tight">{title}</h2> : null}
              {hint ? <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-biz-muted)]">{hint}</p> : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      <div className={padded ? "p-5" : undefined}>{children}</div>
    </section>
  );
}
