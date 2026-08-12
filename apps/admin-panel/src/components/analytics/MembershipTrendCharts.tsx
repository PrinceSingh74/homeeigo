"use client";

import { memo, useMemo } from "react";

export const MembershipTrendCharts = memo(function MembershipTrendCharts({
  trends,
}: {
  trends: Array<Record<string, unknown>>;
}) {
  const charts = useMemo(
    () =>
      [
        { title: "MRR Trend", field: "mrr" },
        { title: "ARR Trend", field: "arr" },
        { title: "Churn Trend", field: "churnRatePct" },
        { title: "Retention Trend", field: "retentionRatePct" },
        { title: "Revenue Growth", field: "revenue" },
        { title: "LTV Distribution", field: "avgLtv" },
      ] as const,
    [],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {charts.map(({ title, field }) => (
        <TrendBars key={field} title={title} points={trends} field={field} />
      ))}
    </div>
  );
});

const TrendBars = memo(function TrendBars({
  title,
  points,
  field,
}: {
  title: string;
  points: Array<Record<string, unknown>>;
  field: string;
}) {
  const values = useMemo(() => points.map((p) => Number(p[field] ?? 0)), [points, field]);
  const max = useMemo(() => Math.max(1, ...values), [values]);

  return (
    <div className="biz-card p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
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
    </div>
  );
});
