import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";

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
  const tone: Icon3DTone =
    accent === "green" ? "success" : accent === "red" ? "danger" : accent === "amber" ? "warning" : "default";

  return (
    <div className="biz-glass-panel biz-kpi min-w-0 overflow-hidden p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p className="min-w-0 text-[11px] font-semibold uppercase leading-snug tracking-[0.12em] text-[var(--color-biz-muted)]">
          {label}
        </p>
        {Icon ? <Icon3D icon={Icon} size="sm" tone={tone} /> : null}
      </div>
      <p
        data-stat-value
        className={cn(
          "biz-num mt-3 min-w-0 truncate text-[clamp(1.25rem,1.8vw,1.65rem)] font-bold leading-none tracking-tight",
          loading && "text-[var(--color-biz-faint)]",
        )}
      >
        {loading ? "—" : value}
      </p>
      {sub && !loading ? (
        <p className="mt-2 min-w-0 text-xs leading-snug text-[var(--color-biz-muted)]">{sub}</p>
      ) : null}
    </div>
  );
});
