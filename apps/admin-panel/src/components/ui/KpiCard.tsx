import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export const KpiCard = memo(function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  accent?: "amber" | "green" | "red";
  loading?: boolean;
}) {
  const chipClass =
    accent === "green"
      ? "biz-icon-chip biz-icon-chip--success"
      : accent === "red"
        ? "biz-icon-chip biz-icon-chip--danger"
        : accent === "amber"
          ? "biz-icon-chip biz-icon-chip--warning"
          : "biz-icon-chip";

  return (
    <div className="biz-glass-panel biz-kpi p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
          {label}
        </p>
        {Icon ? (
          <span className={chipClass}>
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      <p
        data-stat-value
        className={cn(
          "mt-2 text-[1.75rem] font-bold leading-9 tracking-tight",
          loading && "text-[var(--color-biz-faint)]",
        )}
      >
        {loading ? "…" : value}
      </p>
      {sub && !loading && (
        <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{sub}</p>
      )}
    </div>
  );
});
