"use client";

import { BarChart3 } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerLifecycleQuery, usePartnerScoreHistoryQuery, usePartnerScoreQuery } from "@/hooks/use-partner-os";
import type { PartnerScorecard } from "@/services/partner-api";

const COMPONENT_LABELS: Record<string, string> = {
  quality: "Quality",
  reliability: "Reliability",
  completion: "Completion",
  onTime: "On-time",
  customerSatisfaction: "Customer satisfaction",
  compliance: "Compliance",
  safety: "Safety",
};

function bandLabel(band: PartnerScorecard["band"]) {
  return band.replace(/_/g, " ");
}

function ScoreRing({ score, band }: { score: number | null; band: PartnerScorecard["band"] }) {
  const display = score == null ? "—" : Math.round(score).toString();
  return (
    <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-end sm:gap-4">
      <p className="font-display text-6xl font-semibold tracking-tight text-partner-text tabular-nums" aria-live="polite">
        {display}
        <span className="ml-1 text-2xl font-medium text-partner-muted">/100</span>
      </p>
      <p className="mb-1 text-sm font-semibold uppercase tracking-[0.14em] text-partner-muted">{bandLabel(band)}</p>
    </div>
  );
}

function Meter({ value, label }: { value: number | null; label: string }) {
  if (value == null) {
    return <div className="h-1.5 w-full rounded-full bg-partner-line/70" aria-label={`${label}: insufficient data`} />;
  }
  return (
    <div
      className="h-1.5 w-full rounded-full bg-partner-line/70"
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-1.5 rounded-full bg-partner-primary" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export default function ScorecardPage() {
  const score = usePartnerScoreQuery();
  const history = usePartnerScoreHistoryQuery();
  const lifecycle = usePartnerLifecycleQuery();
  const data = score.data;
  const latest = history.data?.items[0];

  return (
    <HqPageShell
      title="Partner Score"
      description="Server-calculated score from ratings, jobs, on-time arrivals, compliance, and approved safety status. Not editable on this device."
      icon={BarChart3}
      loading={score.isLoading}
      error={score.isError ? "Could not load your score." : null}
      onRetry={() => void score.refetch()}
    >
      {data ? (
        <div className="space-y-6">
          <section className="partner-glass rounded-2xl border border-partner-line p-5 sm:p-8">
            <ScoreRing score={data.overallScore} band={data.band} />
            <p className="mt-3 max-w-2xl text-sm text-partner-muted">
              {data.band === "INSUFFICIENT_DATA"
                ? "Not enough completed jobs yet to publish an overall score. Components with enough sample still appear below."
                : `Calculated ${new Date(data.calculatedAt).toLocaleString()} · policy ${data.policyVersion}`}
            </p>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-partner-muted">Lifecycle</dt>
                <dd className="font-semibold">{lifecycle.data?.lifecycleState?.replace(/_/g, " ") ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-partner-muted">Availability</dt>
                <dd className="font-semibold">{lifecycle.data?.availability.currentStatus ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-partner-muted">Sample</dt>
                <dd className="font-semibold">{data.sample.completedJobs} jobs · {data.sample.ratings} ratings</dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-partner-muted">Components</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Object.entries(data.components).map(([key, c]) => (
                <article key={key} className="partner-card p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold text-partner-text">{COMPONENT_LABELS[key] ?? key}</h3>
                    <p className="text-lg font-semibold tabular-nums">
                      {c.value == null ? "—" : Math.round(c.value)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-partner-muted">{c.value == null ? "Not enough data" : `${Math.round(c.weight * 100)}% of score`}</p>
                  <div className="mt-3">
                    <Meter label={COMPONENT_LABELS[key] ?? key} value={c.value} />
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="partner-card p-5">
              <h2 className="text-sm font-semibold">Why did my score change?</h2>
              {!history.isLoading && !latest ? (
                <p className="mt-3 text-sm text-partner-muted">No score history yet. Complete jobs and collect ratings to see changes.</p>
              ) : null}
              {latest ? (
                <div className="mt-3 space-y-2">
                  <p className="text-sm tabular-nums text-partner-text">
                    {latest.previousScore ?? "—"} → {latest.newScore ?? "—"}
                    {latest.delta != null ? ` (${latest.delta > 0 ? "+" : ""}${latest.delta})` : ""}
                  </p>
                  <ul className="space-y-1 text-sm text-partner-muted">
                    {(latest.reasons ?? []).map((r) => (
                      <li key={`${r.code}-${r.component}`}>{r.detail}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
            <article className="partner-card p-5">
              <h2 className="text-sm font-semibold">Trend</h2>
              <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                {(["7d", "30d", "90d"] as const).map((w) => {
                  const t = data.trends[w];
                  return (
                    <div key={w}>
                      <dt className="text-partner-muted">{w.toUpperCase()}</dt>
                      <dd className="font-semibold tabular-nums">
                        {!t || t.insufficient || t.delta == null ? "Limited history" : `${t.delta > 0 ? "+" : ""}${t.delta}`}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </article>
          </section>
        </div>
      ) : null}
    </HqPageShell>
  );
}
