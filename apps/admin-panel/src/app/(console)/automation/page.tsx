"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Layers, Workflow, Zap } from "lucide-react";
import Link from "next/link";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi, type StuckWorkflowInstance } from "@/services/admin-api";

export default function AutomationCenterPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "automation", "overview"],
    queryFn: () => adminApi.automation.overview(),
    refetchInterval: 30_000,
  });

  const replayMut = useMutation({
    mutationFn: (id: string) => adminApi.automation.replayDeadLetter(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "automation"] }),
  });

  const metrics = (data?.metrics ?? {}) as Record<string, number>;
  const workflows = data?.workflows.registered ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Automation Center</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">
            Workflows, event triggers, outbox health, and dead-letter queue
          </p>
        </div>
        <Link
          href="/automation/events"
          className="rounded-lg border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold"
        >
          Event catalog
        </Link>
      </div>

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Could not load automation overview. Check your permissions and try again.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Outbox pending" value={String(metrics.outboxPending ?? "—")} icon={Layers} loading={isLoading} />
        <KpiCard label="Outbox failed" value={String(metrics.outboxFailed ?? "—")} icon={AlertTriangle} loading={isLoading} accent={metrics.outboxFailed ? "amber" : "green"} />
        <KpiCard label="Dead letters" value={String(metrics.dlqCount ?? "—")} icon={Zap} loading={isLoading} />
        <KpiCard label="Shadow runs" value={String(metrics.shadowExecutions ?? "—")} icon={Activity} loading={isLoading} />
      </div>

      <section className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-5">
        <div className="mb-4 flex items-center gap-2">
          <Workflow className="h-5 w-5 text-[var(--color-biz-accent)]" />
          <h2 className="text-lg font-semibold">Registered workflows</h2>
          <span className="text-sm text-[var(--color-biz-muted)]">({workflows.length})</span>
        </div>
        {isLoading ? (
          <p className="text-sm text-[var(--color-biz-muted)]">Loading workflows…</p>
        ) : workflows.length === 0 ? (
          <p className="text-sm text-[var(--color-biz-muted)]">No workflows registered.</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Registered workflows table">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-biz-line)] text-[var(--color-biz-muted)]">
                  <th className="pb-2 pr-4 font-medium">Workflow</th>
                  <th className="pb-2 pr-4 font-medium">Trigger</th>
                  <th className="pb-2 pr-4 font-medium">Mode</th>
                  <th className="pb-2 pr-4 font-medium">Certification</th>
                  <th className="pb-2 font-medium">Engine coverage</th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((w) => (
                  <tr key={`${w.workflowId}.v${w.version}`} className="border-b border-[var(--color-biz-line)]/60">
                    <td className="py-2.5 pr-4 font-medium">{w.name}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-[var(--color-biz-muted)]">{w.trigger}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${w.executionMode === "SHADOW" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                        {w.executionMode}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-[var(--color-biz-muted)]">{w.certificationStatus}</td>
                    {/*
                      An operator about to certify a workflow needs to know which of its steps the
                      engine will refuse. ACTION and ESCALATION terminate at NOT_IMPLEMENTED, so a
                      workflow can run to completion having escalated nothing.
                    */}
                    <td className="py-2.5 text-xs">
                      {w.unexecutableSteps?.length ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800" title={w.unexecutableSteps.map((s) => `${s.stepId} (${s.type})`).join(", ")}>
                          {w.unexecutableSteps.length} step
                          {w.unexecutableSteps.length === 1 ? "" : "s"} not executable
                        </span>
                      ) : (
                        <span className="text-[var(--color-biz-muted)]">All steps executable</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <StuckInstancesPanel />
      <InstancesPanel />
      <OutboxPanel />
      <DeadLetterPanel
        loading={isLoading}
        onReplay={(id) => replayMut.mutate(id)}
        replayPending={replayMut.isPending}
      />
    </div>
  );
}

/**
 * Instances the engine has decided cannot make progress, with the action it recommends.
 *
 * The detector and the recovery endpoint have both existed since Phase 14 and nothing called
 * either: 16 stuck instances were counted in `/metrics` with no way to see or resolve one. The
 * console reported the problem and offered no way to act on it.
 *
 * Three rules this panel does not get to soften, because they come from the recovery engine:
 *   - STALE_LEASE is shown but NOT actionable. The executor reclaims expired leases itself, so an
 *     operator acting here would race it.
 *   - The only verbs are REQUEUE and CANCEL. There is no step-level compensation model, so a
 *     button claiming to undo work it cannot undo would be worse than no button.
 *   - A reason of at least 10 characters is mandatory, and the status/timestamp the operator was
 *     looking at travel with the request so two simultaneous recoveries resolve to one winner.
 */
function StuckInstancesPanel() {
  const qc = useQueryClient();
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const { data: stuck = [], isLoading, isError } = useQuery({
    queryKey: ["admin", "automation", "stuck"],
    queryFn: () => adminApi.automation.stuckWorkflows(),
    refetchInterval: 60_000,
  });

  const recover = useMutation({
    mutationFn: (input: { row: StuckWorkflowInstance; action: "REQUEUE" | "CANCEL" }) =>
      adminApi.automation.recoverWorkflow({
        instanceId: input.row.instanceId,
        action: input.action,
        reason: reasons[input.row.instanceId] ?? "",
        observedStatus: input.row.status,
        observedUpdatedAt: input.row.updatedAt ?? new Date().toISOString(),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "automation"] }),
  });

  const actionable = stuck.filter((s) => s.actionable);

  return (
    <section className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        <h2 className="text-lg font-semibold">Stuck instances</h2>
        <span className="text-sm text-[var(--color-biz-muted)]">
          ({actionable.length} actionable of {stuck.length})
        </span>
      </div>

      {isError ? (
        <p className="text-sm text-red-700">Could not load stuck instances. Check your permissions.</p>
      ) : isLoading ? (
        <p className="text-sm text-[var(--color-biz-muted)]">Loading…</p>
      ) : stuck.length === 0 ? (
        // Distinct from "we could not tell": the detector ran and found nothing.
        <p className="text-sm text-[var(--color-biz-muted)]">
          No instance is stuck. Parked workflows whose wake-up is still in the future are healthy and
          are not listed here.
        </p>
      ) : (
        <div className="space-y-3">
          {stuck.map((row) => (
            <article
              key={row.instanceId}
              className="rounded-lg border border-[var(--color-biz-line)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-xs">{row.workflowId} v{row.workflowVersion}</p>
                  <p className="text-sm font-semibold">
                    {row.reason}
                    <span className="ml-2 font-normal text-[var(--color-biz-muted)]">
                      step {row.stepIndex}/{row.stepCount} · {row.status} · {row.executionMode}
                    </span>
                  </p>
                </div>
                <span className="text-xs text-[var(--color-biz-muted)]">
                  {Math.round(row.ageMs / 3_600_000)}h old
                </span>
              </div>

              {/* The engine's own words. An operator is never asked to trust the label alone. */}
              <p className="mt-2 text-xs text-[var(--color-biz-muted)]">{row.evidence}</p>

              {!row.actionable ? (
                <p className="mt-3 text-xs text-[var(--color-biz-muted)]">
                  No operator action — the executor reclaims this itself. Acting here would race it.
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`Reason for recovering ${row.workflowId}`}
                    placeholder="Reason (required, min 10 characters)"
                    value={reasons[row.instanceId] ?? ""}
                    onChange={(e) =>
                      setReasons((r) => ({ ...r, [row.instanceId]: e.target.value }))
                    }
                    className="min-w-[16rem] flex-1 rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm"
                  />
                  {(["REQUEUE", "CANCEL"] as const).map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => recover.mutate({ row, action })}
                      disabled={recover.isPending || (reasons[row.instanceId] ?? "").trim().length < 10}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40 ${
                        action === row.recommendedAction
                          ? "bg-[var(--color-biz-accent)] text-white"
                          : "border border-[var(--color-biz-line)]"
                      }`}
                    >
                      {action}
                      {action === row.recommendedAction ? " (recommended)" : ""}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function InstancesPanel() {
  const { data: instances = [], isLoading } = useQuery({
    queryKey: ["admin", "automation", "instances"],
    queryFn: () => adminApi.automation.instances({ limit: 20 }),
  });

  return (
    <section className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-5">
      <h2 className="mb-4 text-lg font-semibold">Workflow instances</h2>
      {isLoading ? (
        <p className="text-sm text-[var(--color-biz-muted)]">Loading…</p>
      ) : instances.length === 0 ? (
        <p className="text-sm text-[var(--color-biz-muted)]">No workflow instances.</p>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Workflow instances table">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--color-biz-line)] text-[var(--color-biz-muted)]">
                <th className="pb-2 pr-4 font-medium">Workflow</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Mode</th>
                <th className="pb-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((row) => (
                <tr key={row.id} className="border-b border-[var(--color-biz-line)]/60">
                  <td className="py-2 pr-4 font-mono text-xs">{row.workflowId}</td>
                  <td className="py-2 pr-4">{row.status}</td>
                  <td className="py-2 pr-4">{row.executionMode}</td>
                  <td className="py-2 text-xs text-[var(--color-biz-muted)]">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function OutboxPanel() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin", "automation", "outbox"],
    queryFn: () => adminApi.automation.outbox({ limit: 30 }),
  });

  return (
    <section className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-5">
      <h2 className="mb-4 text-lg font-semibold">Outbox</h2>
      {isLoading ? (
        <p className="text-sm text-[var(--color-biz-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--color-biz-muted)]">No outbox rows.</p>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Outbox table">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--color-biz-line)] text-[var(--color-biz-muted)]">
                <th className="pb-2 pr-4 font-medium">Event</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Attempts</th>
                <th className="pb-2 font-medium">Last error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--color-biz-line)]/60">
                  <td className="py-2 pr-4 font-mono text-xs">{row.eventType}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.status === "FAILED"
                          ? "bg-red-100 text-red-800"
                          : row.status === "PENDING"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{row.attempts}</td>
                  <td className="py-2 text-xs text-red-300">{row.lastError?.slice(0, 120) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DeadLetterPanel({
  loading,
  onReplay,
  replayPending,
}: {
  loading: boolean;
  onReplay: (id: string) => void;
  replayPending: boolean;
}) {
  const { data: dlq = [] } = useQuery({
    queryKey: ["admin", "automation", "dead-letters"],
    queryFn: () => adminApi.automation.deadLetters(20),
  });

  return (
    <section className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-5">
      <h2 className="mb-4 text-lg font-semibold">Dead letter queue</h2>
      {loading ? (
        <p className="text-sm text-[var(--color-biz-muted)]">Loading…</p>
      ) : dlq.length === 0 ? (
        <p className="text-sm text-[var(--color-biz-muted)]">No dead-letter events.</p>
      ) : (
        <ul className="space-y-2">
          {dlq.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-biz-line)] px-3 py-2 text-sm">
              <div>
                <span className="font-mono text-xs">{row.eventType}</span>
                <span className="mx-2 text-[var(--color-biz-muted)]">·</span>
                <span className="text-[var(--color-biz-muted)]">{row.consumerName}</span>
                {row.errorMessage && (
                  <p className="mt-1 text-xs text-red-300">{row.errorMessage.slice(0, 120)}</p>
                )}
                {row.resolvedAt && (
                  <p className="mt-1 text-xs text-emerald-300">
                    Resolved{row.resolution ? ` (${row.resolution})` : ""}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={replayPending || Boolean(row.resolvedAt)}
                onClick={() => onReplay(row.id)}
                className="rounded border border-[var(--color-biz-line)] px-3 py-1 text-xs font-semibold disabled:opacity-50"
              >
                {row.resolvedAt ? "Resolved" : "Replay"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
