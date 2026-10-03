"use client";

import { Award } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerCareerHistoryQuery, usePartnerCareerQuery } from "@/hooks/use-partner-os";

export default function CareerPage() {
  const career = usePartnerCareerQuery();
  const history = usePartnerCareerHistoryQuery();
  const data = career.data;

  return (
    <HqPageShell
      title="Career"
      description="Levels reuse existing quality gates: Professional (trusted), Expert, Elite (super star). Levels do not automatically fall."
      icon={Award}
      loading={career.isLoading}
      error={career.isError ? "Could not load career progress." : null}
      onRetry={() => void career.refetch()}
    >
      {data ? (
        <div className="space-y-6">
          <section className="partner-glass rounded-2xl border border-partner-line p-5 sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-partner-muted">Current level</p>
            <p className="mt-1 font-display text-4xl font-semibold text-partner-text">{data.currentLevel}</p>
            {data.nextLevel ? (
              <p className="mt-2 text-sm text-partner-muted">
                {data.progressPct}% toward {data.nextLevel}
              </p>
            ) : (
              <p className="mt-2 text-sm text-partner-muted">Highest level reached.</p>
            )}
            <div className="mt-4 h-2 rounded-full bg-partner-line/70" role="progressbar" aria-valuenow={data.progressPct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next career level">
              <div className="h-2 rounded-full bg-partner-primary" style={{ width: `${data.progressPct}%` }} />
            </div>
            <p className="mt-3 text-sm text-partner-muted">
              Job priority boost: {data.benefitsActive ? `+${data.careerPriorityBoost}` : "paused"} · {data.qualificationState.replace(/_/g, " ").toLowerCase()}
            </p>
          </section>

          <section className="partner-card p-5">
            <h2 className="text-sm font-semibold">Requirements</h2>
            <ul className="mt-3 space-y-2">
              {data.requirements.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-partner-line px-3 py-2 text-sm">
                  <span>
                    <span className="mr-2 font-semibold" aria-hidden>
                      {r.met ? "✓" : "○"}
                    </span>
                    {r.label}
                  </span>
                  <span className="tabular-nums text-partner-muted">
                    {r.unit === "rating" ? r.current.toFixed(2) : Math.round(r.current)}
                    {" / "}
                    {r.unit === "rating" ? r.target.toFixed(2) : r.target}
                    {r.unit === "percent" ? "%" : r.unit === "jobs" ? " jobs" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="partner-card p-5">
            <h2 className="text-sm font-semibold">Badges</h2>
            {data.badges.length === 0 ? (
              <p className="mt-3 text-sm text-partner-muted">No badges awarded yet. Badges come from real rating, on-time, and safety outcomes.</p>
            ) : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {data.badges.map((b) => (
                  <li key={b.code} className="rounded-lg border border-partner-line px-3 py-3">
                    <p className="font-semibold">{b.label}</p>
                    <p className="text-xs text-partner-muted">{new Date(b.awardedAt).toLocaleDateString()}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="partner-card p-5">
            <h2 className="text-sm font-semibold">Level history</h2>
            {(history.data?.items?.length ?? 0) === 0 ? (
              <p className="mt-3 text-sm text-partner-muted">No promotions recorded yet.</p>
            ) : (
              <ol className="mt-3 space-y-2 text-sm">
                {(history.data?.items ?? []).map((h) => (
                  <li key={h.id} className="rounded-lg border border-partner-line px-3 py-2">
                    <p className="font-semibold">{h.previousLevel ?? "—"} → {h.newLevel}</p>
                    <p className="text-partner-muted">{h.reason}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : null}
    </HqPageShell>
  );
}
