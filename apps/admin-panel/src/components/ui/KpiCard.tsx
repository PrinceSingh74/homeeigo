import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  accent?: "amber" | "green" | "red";
}) {
  const accentClass =
    accent === "green"
      ? "text-[var(--color-biz-success)]"
      : accent === "red"
        ? "text-[var(--color-biz-danger)]"
        : "text-[var(--color-biz-accent)]";

  return (
    <div className="biz-card p-5">
      <Icon className={cn("mb-3 h-5 w-5", accentClass)} />
      <p className="text-xs text-[var(--color-biz-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{sub}</p>}
    </div>
  );
}
