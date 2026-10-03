"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GlassPanel } from "@/components/hq/GlassPanel";
import { DataUnavailable, HqLoading, SectionHeading } from "@/components/hq/primitives";
import { mlApi, type HealthCheck, type ModelReadiness, type GovernedModel, type DemandEvaluation } from "@/services/ml-api";
import { cn } from "@/lib/cn";
import { evaluationDatasetLine } from "@/lib/warehouse-availability-view";

/**
 * Phase-12 Model Governance — what the platform predicts with, and whether it should.
 *
 * Every number comes from /api/admin/ml/*. There is no sample model, no placeholder metric and no
 * hardcoded readiness: where a model has no data the page says so and names what is missing, because
 * a governance console that shows plausible-looking models is worse than one that shows none.
 *
 * The page leads with platform health rather than the model list on purpose. Every model in this
 * platform's warehouse registry read TRAINED / production while the pipeline behind them had been
 * failing for 22 days and the forecast horizon had expired 69 days earlier. A model list that cannot
 * say that is the thing that hid it.
 */

const READINESS_TONE: Record<string, string> = {
  DATA_READY: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  DATA_PARTIAL: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  DATA_INSUFFICIENT: "text-slate-300 border-slate-400/30 bg-slate-400/10",
  DATA_UNTRUSTED: "text-red-300 border-red-400/30 bg-red-400/10",
  NOT_APPLICABLE: "text-slate-400 border-slate-500/30 bg-slate-500/10",
};

const STAGE_TONE: Record<string, string> = {
  PRODUCTION: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  APPROVED: "text-blue-300 border-blue-400/30 bg-blue-400/10",
  SHADOW: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  CANDIDATE: "text-slate-300 border-slate-400/30 bg-slate-400/10",
  ROLLED_BACK: "text-red-300 border-red-400/30 bg-red-400/10",
  REJECTED: "text-red-300 border-red-400/30 bg-red-400/10",
  RETIRED: "text-slate-400 border-slate-500/30 bg-slate-500/10",
};

const CHECK_TONE: Record<HealthCheck["state"], string> = {
  OK: "text-emerald-400",
  WARN: "text-amber-300",
  FAIL: "text-red-300",
  UNKNOWN: "text-slate-400",
};

function Pill({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        className ?? "border-[var(--color-biz-line)] text-[var(--color-biz-muted)]",
      )}
    >
      {label}
    </span>
  );
}

export default function MlGovernancePage() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const health = useQuery({ queryKey: ["admin", "ml", "health"], queryFn: () => mlApi.health() });
  const readiness = useQuery({ queryKey: ["admin", "ml", "readiness"], queryFn: () => mlApi.readiness() });
  const models = useQuery({ queryKey: ["admin", "ml", "models"], queryFn: () => mlApi.models() });
  const evaluation = useMutation({ mutationFn: () => mlApi.demandEvaluation(14) });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "ml"] });

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold">Model Governance</h1>
        <p className="mt-1 text-sm text-[var(--color-biz-muted)]">
          What the platform predicts with, what the data supports, and who approved it. A model reaches
          production only by a person deciding it should.
        </p>
      </header>

      {notice ? (
        <div
          role="status"
          className={cn(
            "rounded-xl border px-4 py-2.5 text-sm",
            notice.tone === "ok"
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
              : "border-red-400/30 bg-red-400/10 text-red-200",
          )}
        >
          {notice.text}
        </div>
      ) : null}

      <section>
        <SectionHeading title="Platform health" hint="whether predictions describe the present" />
        {health.isLoading ? (
          <HqLoading label="Checking the ML platform…" />
        ) : health.isError ? (
          <DataUnavailable
            title="Health unavailable"
            reason={health.error instanceof Error ? health.error.message : "The request failed."}
          />
        ) : health.data ? (
          <GlassPanel className="p-4">
            <p className={cn("text-sm font-medium", health.data.serviceable ? "text-emerald-400" : "text-red-300")}>
              {health.data.summary}
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {health.data.checks.map((c) => (
                <li key={c.name} className="border-t border-[var(--color-biz-line)] pt-2 first:border-0 first:pt-0">
                  <p className="text-xs">
                    <span className={cn("font-semibold", CHECK_TONE[c.state])}>{c.state}</span>{" "}
                    <span className="font-medium">{c.name.replace(/_/g, " ")}</span>
                  </p>
                  <p className="text-xs text-[var(--color-biz-muted)]">{c.detail}</p>
                </li>
              ))}
            </ul>
          </GlassPanel>
        ) : null}
      </section>

      <section>
        <SectionHeading title="Data readiness" hint="measured row counts, not roadmap intent" />
        {readiness.isLoading ? (
          <HqLoading label="Measuring data readiness…" />
        ) : readiness.isError ? (
          <DataUnavailable
            title="Readiness unavailable"
            reason={readiness.error instanceof Error ? readiness.error.message : "The request failed."}
          />
        ) : readiness.data ? (
          <div className="flex flex-col gap-3">
            {!readiness.data.warehouseReachable ? (
              <p className="text-xs text-amber-300">
                The warehouse could not be read, so warehouse-backed models are reported as unknown rather
                than as zero.
              </p>
            ) : null}
            {readiness.data.models.map((m) => (
              <ReadinessCard key={m.model} m={m} />
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <SectionHeading title="Demand forecast evaluation" hint="temporal holdout against real baselines" />
        <GlassPanel className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-xs text-[var(--color-biz-muted)]">
              Splits the series by date, trains on the earlier part only, and scores every forecaster on
              days it never saw. A model that cannot beat &ldquo;tomorrow equals today&rdquo; is a cost,
              not a forecast.
            </p>
            <button
              type="button"
              disabled={evaluation.isPending}
              onClick={() => evaluation.mutate()}
              className="rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-medium hover:bg-white/5 disabled:opacity-50"
            >
              {evaluation.isPending ? "Evaluating…" : "Run evaluation"}
            </button>
          </div>
          {evaluation.isError ? (
            <p className="mt-3 text-sm text-red-300">
              {evaluation.error instanceof Error ? evaluation.error.message : "The run failed."}
            </p>
          ) : null}
          {evaluation.data ? <EvaluationReport e={evaluation.data} /> : null}
        </GlassPanel>
      </section>

      <section>
        <SectionHeading title="Governed models" hint="lifecycle, approval and rollback" />
        {models.isLoading ? (
          <HqLoading label="Loading the registry…" />
        ) : models.isError ? (
          <DataUnavailable
            title="Registry unavailable"
            reason={models.error instanceof Error ? models.error.message : "The request failed."}
          />
        ) : (models.data ?? []).length === 0 ? (
          <DataUnavailable
            title="No governed model versions"
            reason="Nothing has been registered in this environment. A warehouse model with no governed version here is serving without an approval on record, which the health panel above reports."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {(models.data ?? []).map((g) => (
              <ModelCard
                key={g.modelName}
                g={g}
                onNotice={(text, tone) => { setNotice({ tone, text }); invalidate(); }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ReadinessCard({ m }: { m: ModelReadiness }) {
  const blocking = m.leakage.filter((l) => l.severity === "BLOCKING");
  return (
    <GlassPanel className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{m.model.replace(/_/g, " ")}</p>
          <p className="text-xs text-[var(--color-biz-muted)]">{m.purpose}</p>
        </div>
        <div className="flex items-center gap-2">
          <Pill label={m.readiness.replace(/_/g, " ")} className={READINESS_TONE[m.readiness]} />
          <Pill label={m.decision.replace(/_/g, " ")} />
        </div>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
        {Object.entries(m.evidence).map(([k, v]) => (
          <div key={k} className="text-xs">
            <dt className="inline text-[var(--color-biz-muted)]">{k}: </dt>
            <dd className="inline font-medium tabular-nums">{v === null ? "—" : String(v)}</dd>
          </div>
        ))}
      </dl>

      {blocking.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {blocking.map((l, i) => (
            <li key={i} className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-200">
              <span className="font-semibold">{l.kind.replace(/_/g, " ")}</span>
              {l.affectedRows !== null ? <span className="tabular-nums"> ({l.affectedRows} rows)</span> : null} — {l.detail}
            </li>
          ))}
        </ul>
      ) : null}

      {m.blocker ? <p className="mt-2 text-xs text-[var(--color-biz-muted)]">{m.blocker}</p> : null}
      <p className="mt-2 text-[11px] text-[var(--color-biz-muted)]">source: {m.source}</p>
    </GlassPanel>
  );
}

function EvaluationReport({ e }: { e: DemandEvaluation }) {
  const scored = e.results.filter((r) => r.metrics !== null);
  return (
    <div className="mt-4 border-t border-[var(--color-biz-line)] pt-4">
      <p
        className={cn(
          "mb-3 rounded-lg border px-3 py-2 text-xs",
          e.candidateBeatsAllBaselines
            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
            : "border-amber-400/30 bg-amber-400/10 text-amber-200",
        )}
        role="status"
      >
        {e.verdict}
      </p>

      {/* X-88: a dataset that was never read (SOURCE_UNAVAILABLE) has no day counts to print. */}
      {evaluationDatasetLine(e.dataset, e.split) ? (
        <p className="text-xs text-[var(--color-biz-muted)]">{evaluationDatasetLine(e.dataset, e.split)}</p>
      ) : null}
      {e.dataset.warnings.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {e.dataset.warnings.map((w, i) => (
            <li key={i} className="text-[11px] text-amber-300">{w}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Forecaster evaluation table">
        <table className="w-full min-w-[640px] text-xs">
          <caption className="sr-only">Forecaster comparison on the temporal holdout</caption>
          <thead>
            <tr className="text-left uppercase tracking-wide text-[var(--color-biz-muted)]">
              <th scope="col" className="pb-2 font-semibold">Forecaster</th>
              <th scope="col" className="pb-2 font-semibold">Kind</th>
              <th scope="col" className="pb-2 font-semibold">MAE</th>
              <th scope="col" className="pb-2 font-semibold">RMSE</th>
              <th scope="col" className="pb-2 font-semibold">Bias</th>
              <th scope="col" className="pb-2 font-semibold">MASE</th>
            </tr>
          </thead>
          <tbody>
            {e.results.map((r) => (
              <tr key={r.name} className="border-t border-[var(--color-biz-line)] align-top">
                <td className="py-2">
                  <p className={cn("font-medium", e.best?.name === r.name ? "text-emerald-400" : "")}>{r.name}</p>
                  <p className="text-[var(--color-biz-muted)]">{r.description}</p>
                  {r.unavailableReason ? (
                    <p className="mt-1 text-amber-300">{r.unavailableReason}</p>
                  ) : null}
                </td>
                <td className="py-2 text-[var(--color-biz-muted)]">{r.kind}</td>
                <td className="py-2 tabular-nums">{r.metrics ? r.metrics.mae : "—"}</td>
                <td className="py-2 tabular-nums">{r.metrics ? r.metrics.rmse : "—"}</td>
                <td className="py-2 tabular-nums">{r.metrics ? r.metrics.bias : "—"}</td>
                <td className="py-2 tabular-nums">{r.metrics?.mase ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {scored[0]?.metrics?.notReported.map((n) => (
        <p key={n.metric} className="mt-2 text-[11px] text-[var(--color-biz-muted)]">
          <span className="font-medium">{n.metric} not reported</span> — {n.reason}
        </p>
      ))}
    </div>
  );
}

function ModelCard({
  g, onNotice,
}: {
  g: GovernedModel;
  onNotice: (text: string, tone: "ok" | "err") => void;
}) {
  const [open, setOpen] = useState(false);
  const versions = useQuery({
    queryKey: ["admin", "ml", "versions", g.modelName],
    queryFn: () => mlApi.versions(g.modelName),
    enabled: open,
  });

  const act = <T,>(fn: () => Promise<T>, describe: (r: T) => string) =>
    fn().then((r) => onNotice(describe(r), "ok"))
        .catch((e: unknown) => onNotice(e instanceof Error ? e.message : "Request failed.", "err"));

  return (
    <GlassPanel className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-left text-sm font-medium hover:underline">
            {g.modelName}
          </button>
          <p className="text-xs text-[var(--color-biz-muted)]">
            {g.versions} version(s) ·{" "}
            {g.production ? `serving v${g.production.version}` : "nothing in production"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {Object.entries(g.stages).map(([stage, n]) => (
            <Pill key={stage} label={`${stage.replace(/_/g, " ")} ${n}`} className={STAGE_TONE[stage]} />
          ))}
        </div>
      </div>

      {g.production ? (
        <div className="mt-3 rounded-lg border border-[var(--color-biz-line)] p-3 text-xs">
          <p>
            <span className="text-[var(--color-biz-muted)]">approved by </span>
            <span className="font-medium">{g.production.approvedBy ?? "—"}</span>
            <span className="text-[var(--color-biz-muted)]"> on </span>
            {g.production.approvedAt ? new Date(g.production.approvedAt).toISOString().slice(0, 10) : "—"}
          </p>
          {g.production.approvalNote ? (
            <p className="mt-1 text-[var(--color-biz-muted)]">{g.production.approvalNote}</p>
          ) : null}
          <p className="mt-1 text-[var(--color-biz-muted)]">
            dataset {g.production.datasetVersion} · features {g.production.featureVersion} · code{" "}
            {g.production.codeVersion} · artifact {g.production.artifactHash ?? g.production.artifactRef}
          </p>
          <button
            type="button"
            className="mt-2 rounded-lg border border-[var(--color-biz-line)] px-2.5 py-1 text-[11px] font-medium hover:bg-white/5"
            onClick={() => {
              const reason = window.prompt(
                `Roll ${g.modelName} back to the version it replaced?\n\nReason (recorded in the audit log):`,
              );
              if (reason && reason.trim().length >= 10) {
                void act(() => mlApi.rollback(g.modelName, reason.trim()), (r) => r.detail ?? "Rolled back.");
              }
            }}
          >
            Roll back
          </button>
        </div>
      ) : null}

      {open ? (
        versions.isLoading ? (
          <div className="mt-3"><HqLoading label="Loading versions…" /></div>
        ) : versions.isError ? (
          <div className="mt-3">
            <DataUnavailable
              title="Versions unavailable"
              reason={versions.error instanceof Error ? versions.error.message : "The request failed."}
            />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Model versions table">
            <table className="w-full min-w-[720px] text-xs">
              <caption className="sr-only">Version history for {g.modelName}</caption>
              <thead>
                <tr className="text-left uppercase tracking-wide text-[var(--color-biz-muted)]">
                  <th scope="col" className="pb-2 font-semibold">Version</th>
                  <th scope="col" className="pb-2 font-semibold">Stage</th>
                  <th scope="col" className="pb-2 font-semibold">Metrics</th>
                  <th scope="col" className="pb-2 font-semibold">Provenance</th>
                  <th scope="col" className="pb-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(versions.data ?? []).map((v) => (
                  <tr key={v.id} className="border-t border-[var(--color-biz-line)] align-top">
                    <td className="py-2 font-medium tabular-nums">v{v.version}</td>
                    <td className="py-2"><Pill label={v.stage.replace(/_/g, " ")} className={STAGE_TONE[v.stage]} /></td>
                    <td className="py-2 text-[var(--color-biz-muted)]">
                      {v.metrics
                        ? Object.entries(v.metrics).map(([k, n]) => `${k}=${n}`).join(" ")
                        : "not measured"}
                      {v.beatsBaseline === true ? <span className="ml-1 text-emerald-400">beats baseline</span> : null}
                      {v.beatsBaseline === false ? <span className="ml-1 text-amber-300">did not beat baseline</span> : null}
                    </td>
                    <td className="py-2 text-[var(--color-biz-muted)]">
                      {v.datasetVersion} / {v.featureVersion} / {v.codeVersion}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {(v.stage === "CANDIDATE" || v.stage === "SHADOW") ? (
                          <button
                            type="button"
                            className="rounded-lg border border-[var(--color-biz-line)] px-2.5 py-1 text-[11px] font-medium hover:bg-white/5"
                            onClick={() => {
                              const note = window.prompt(
                                `Approve ${g.modelName} v${v.version} for production?\n\nApproval note (at least 10 characters, recorded in the audit log):`,
                              );
                              if (note && note.trim().length >= 10) {
                                void act(() => mlApi.approve(v.id, note.trim()), (r) => r.detail ?? "Approved.");
                              }
                            }}
                          >
                            Approve
                          </button>
                        ) : null}
                        {v.stage === "APPROVED" ? (
                          <button
                            type="button"
                            className="rounded-lg border border-[var(--color-biz-line)] px-2.5 py-1 text-[11px] font-medium hover:bg-white/5"
                            onClick={() => void act(() => mlApi.promote(v.id), (r) => r.detail ?? "Promoted.")}
                          >
                            Promote
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </GlassPanel>
  );
}
