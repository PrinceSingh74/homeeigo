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
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

export function HqPageShell({
  title,
  description,
  icon: Icon,
  stats,
  children,
  className,
  loading = false,
  error,
  onRetry,
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

      {error ? (
        <div className="partner-card space-y-3 p-5" role="alert">
          <p className="text-sm font-semibold text-partner-text">Could not load this page</p>
          <p className="text-sm text-partner-muted">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-11 items-center rounded-lg border border-partner-line px-4 text-sm font-semibold"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          role="status"
          aria-busy="true"
          aria-label="Loading metrics"
        >
          {[0, 1, 2, 3].map((i) => (
            <article key={i} className="partner-card p-4">
              <div className="h-3 w-20 animate-pulse rounded bg-partner-line/60" />
              <div className="mt-3 h-8 w-28 animate-pulse rounded bg-partner-line/50" />
            </article>
          ))}
        </div>
      ) : stats && stats.length > 0 ? (
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

      {loading ? (
        <div className="space-y-3" aria-hidden>
          <div className="h-24 animate-pulse rounded-2xl bg-partner-line/40" />
          <div className="h-24 animate-pulse rounded-2xl bg-partner-line/30" />
        </div>
      ) : error ? null : (
        children
      )}
    </div>
  );
}
