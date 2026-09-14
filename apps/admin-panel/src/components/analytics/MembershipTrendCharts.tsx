"use client";

import { memo, useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { IndianRupee, Percent, ShieldCheck, TrendingUp, UserMinus, Wallet } from "lucide-react";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";

const CHARTS: {
  title: string;
  hint: string;
  field: string;
  icon: LucideIcon;
  tone: Icon3DTone;
}[] = [
  { title: "MRR", hint: "Monthly recurring revenue", field: "mrr", icon: IndianRupee, tone: "default" },
  { title: "ARR", hint: "Annualised run-rate", field: "arr", icon: TrendingUp, tone: "success" },
  { title: "Churn", hint: "Subscribers lost in period", field: "churnRatePct", icon: UserMinus, tone: "danger" },
  { title: "Retention", hint: "Subscribers kept in period", field: "retentionRatePct", icon: ShieldCheck, tone: "success" },
  { title: "Revenue", hint: "Collected membership value", field: "revenue", icon: Percent, tone: "cyan" },
  { title: "Avg LTV", hint: "Lifetime value per member", field: "avgLtv", icon: Wallet, tone: "warning" },
];

export const MembershipTrendCharts = memo(function MembershipTrendCharts({
  trends,
}: {
  trends: Array<Record<string, unknown>>;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {CHARTS.map((chart) => (
        <TrendBars key={chart.field} {...chart} points={trends} />
      ))}
    </div>
  );
});

const TrendBars = memo(function TrendBars({
  title,
  hint,
  points,
  field,
  icon,
  tone,
}: {
  title: string;
  hint: string;
  points: Array<Record<string, unknown>>;
  field: string;
  icon: LucideIcon;
  tone: Icon3DTone;
}) {
  const values = useMemo(() => points.map((p) => Number(p[field] ?? 0)), [points, field]);
  const max = useMemo(() => Math.max(1, ...values), [values]);

  return (
    <div className="biz-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-xs text-[var(--color-biz-muted)]">{hint}</p>
        </div>
        <Icon3D icon={icon} size="sm" tone={tone} />
      </div>
      {points.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--color-biz-muted)]">No trend points in this period.</p>
      ) : (
        <div className="flex h-32 items-end gap-1">
          {points.map((p) => {
            const v = Number(p[field] ?? 0);
            const h = Math.round((v / max) * 100);
            return (
              <div key={String(p.label)} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-[var(--color-biz-accent)]/80"
                  style={{ height: `${h}%`, minHeight: v > 0 ? 4 : 0 }}
                  title={`${p.label}: ${v}`}
                />
                <span className="truncate text-[9px] text-[var(--color-biz-muted)]">
                  {String(p.label).slice(-5)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
