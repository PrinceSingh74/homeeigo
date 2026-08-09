import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

type HqStat = {
  label: string;
  value: string | number;
  hint?: string;
};

type HqPageShellProps = {
  title: string;
  description: string;
  icon?: LucideIcon;
  stats?: HqStat[];
  children?: React.ReactNode;
  className?: string;
};

export function HqPageShell({
  title,
  description,
  icon: Icon,
  stats,
  children,
  className,
}: HqPageShellProps) {
  return (
    <div className={cn("space-y-6", className)}>
      <header className="partner-glass rounded-2xl border border-partner-line p-5 sm:p-6">
        <div className="flex items-start gap-3">
          {Icon ? (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f6f1d6] to-[#d8ead7] text-partner-primary shadow-sm dark:from-partner-primary/20 dark:to-partner-accent/10">
              <Icon className="h-5 w-5" strokeWidth={2} />
            </div>
          ) : null}
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-partner-text">{title}</h1>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-partner-muted">{description}</p>
          </div>
        </div>
      </header>

      {stats && stats.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <article key={stat.label} className="partner-card partner-card-hover p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-partner-muted">{stat.label}</p>
              <p className="partner-stat-value mt-2 text-partner-text">{stat.value}</p>
              {stat.hint ? <p className="mt-1 text-xs text-partner-muted">{stat.hint}</p> : null}
            </article>
          ))}
        </div>
      ) : null}

      {children}
    </div>
  );
}
