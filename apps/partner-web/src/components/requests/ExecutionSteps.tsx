"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleDashed, HardHat, ListChecks, Lock, Package, PlayCircle, Wrench, XCircle } from "lucide-react";
import { BriefChips } from "@/components/requests/BriefChips";
import { apiRequest } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { fileToDataUrl } from "@/lib/file-to-data-url";
import { completeBody, completePlan, stepMetaLabel, type CompletePlan } from "@/lib/step-evidence";
import { partnerApi } from "@/services/partner-api";
import { useToastStore } from "@/stores/toast-store";
import type { ApiResponse } from "@/types/partner";

/**
 * Phase 10 §8 — the partner's step-by-step work plan for this job.
 *
 * Server truth (`GET /api/bookings/:id/execution`): which steps apply to THIS booking, their state,
 * what blocks each one, and what the partner may do. Buttons ask; the server decides (dependencies,
 * linked safety requirement, evidence in the job evidence store, reasons for exceptions). State is
 * perceivable without colour: icon + explicit state word.
 */

type StepView = {
  code: string; stepNumber: number; title: string; description: string | null; kind: string; mandatory: boolean; skippable: boolean;
  evidence: string; estimatedMinutes: number | null; ppe: string[]; warnings: string[]; state: string;
  blockedBy: { reason: string; detail: string[] } | null; note: string | null; reason: string | null; actions: string[];
  /** What this step needs to hand. Absent on a server that predates the fields. */
  materials?: string[]; equipment?: string[];
};
export type ExecutionView = { enforced: boolean; steps: StepView[]; gate: { ok: boolean; blocking: Array<{ code: string; reason: string }> } };

export const jobExecutionKey = (bookingId: string) => ["partner", "execution", bookingId] as const;

/** One fetch for the steps section and the escalation section (same key, react-query dedupes). */
export function useJobExecution(bookingId: string, enabled = true) {
  return useQuery({
    queryKey: jobExecutionKey(bookingId),
    queryFn: () => apiRequest<ApiResponse<ExecutionView>>(`/api/bookings/${bookingId}/execution`, { auth: true }).then((r) => r.data!),
    enabled: !!bookingId && enabled,
    staleTime: 10_000,
  });
}

const BLOCK_LABEL: Record<string, string> = {
  BOOKING_NOT_IN_PROGRESS: "Start the job first",
  DEPENDENCY_INCOMPLETE: "Finish the earlier steps first",
  SAFETY_REQUIREMENT_UNMET: "A safety requirement is not in place yet",
};

function Icon({ state }: { state: string }) {
  const c = "h-4 w-4 shrink-0";
  if (state === "COMPLETED") return <CheckCircle2 className={`${c} text-partner-success`} aria-hidden="true" />;
  if (state === "FAILED" || state === "ESCALATED") return <XCircle className={`${c} text-red-500`} aria-hidden="true" />;
  if (state === "BLOCKED") return <Lock className={`${c} text-partner-muted`} aria-hidden="true" />;
  if (state === "IN_PROGRESS") return <PlayCircle className={`${c} text-partner-primary`} aria-hidden="true" />;
  return <CircleDashed className={`${c} text-partner-muted`} aria-hidden="true" />;
}

export function ExecutionSteps({
  bookingId,
  heading = true,
  emptyText,
}: {
  bookingId: string;
  /** The page's section heading already names this block. */
  heading?: boolean;
  /** Shown instead of nothing when the booking has no step plan. */
  emptyText?: string;
}) {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  const [reasonFor, setReasonFor] = useState<{ code: string; action: "SKIP" | "FAIL" | "ESCALATE" } | null>(null);
  const [text, setText] = useState("");
  // Per step: the photos picked for Done (in the plan's order: before, after) and the note.
  const [files, setFiles] = useState<Record<string, Array<File | null>>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const key = jobExecutionKey(bookingId);
  const query = useJobExecution(bookingId);
  const act = useMutation({
    mutationFn: async (v: { code: string; action: string; body?: Record<string, string>; plan?: CompletePlan; files?: Array<File | null>; note?: string }) => {
      let body = v.body ?? {};
      if (v.plan) {
        // Each photo is recorded as job evidence at the stage the server's rule reads (before = START,
        // after = COMPLETION); the step is then completed against the last one.
        const ids: string[] = [];
        for (const [i, p] of v.plan.photos.entries()) {
          const file = v.files?.[i];
          if (!file) throw new Error(p.prompt);
          const up = await partnerApi.uploadEvidence(bookingId, { stage: p.stage, mediaUrl: await fileToDataUrl(file), clientUploadId: `web-step-${v.code}-${p.stage}-${Date.now()}` });
          ids.push(up.evidence.id);
        }
        body = { ...body, ...completeBody(v.plan, ids, v.note) };
      }
      return apiRequest<ApiResponse<{ state: string }>>(`/api/bookings/${bookingId}/execution/${encodeURIComponent(v.code)}/${v.action.toLowerCase()}`, { method: "POST", auth: true, body });
    },
    onError: (e) => showToast(getErrorMessage(e), "error"),
    onSuccess: (_r, v) => {
      setReasonFor(null);
      setText("");
      setFiles((m) => ({ ...m, [v.code]: [] }));
      setNotes((m) => ({ ...m, [v.code]: "" }));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["partner", "job-actions", bookingId] });
      void qc.invalidateQueries({ queryKey: ["partner", "job-evidence", bookingId] });
    },
  });

  const view = query.data;
  if (!view || !view.enforced || view.steps.length === 0) {
    if (!emptyText) return null;
    return (
      <p className="text-sm text-partner-muted" data-testid="execution-steps-empty">
        {query.isLoading ? "Loading service steps…" : query.isError ? "Service steps could not be loaded — refresh to try again." : emptyText}
      </p>
    );
  }
  const done = view.steps.filter((s) => s.state === "COMPLETED" || s.state === "SKIPPED_WITH_REASON").length;

  return (
    <section className="space-y-3" data-testid="execution-steps" aria-labelledby={`exec-${bookingId}`}>
      <p id={`exec-${bookingId}`} className="flex items-center gap-1.5 text-sm font-semibold text-partner-text">
        <ListChecks className="h-4 w-4 text-partner-primary" aria-hidden="true" />
        {heading ? "Work steps " : <span className="sr-only">Work steps </span>}
        <span className="font-normal text-partner-muted">{heading ? "· " : ""}{done} of {view.steps.length} done</span>
      </p>
      {!view.gate.ok ? (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-xs text-amber-900" data-testid="execution-gate-blocked">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          The job can be completed once every required step is done.
        </p>
      ) : (
        <p role="status" className="text-xs text-partner-success" data-testid="execution-gate-ok">All required steps are done.</p>
      )}
      <ol className="divide-y divide-partner-border/60">
        {view.steps.map((s) => {
          const busy = act.isPending && act.variables?.code === s.code;
          const plan = completePlan(s.evidence);
          const picked = files[s.code] ?? [];
          const ready = plan.photos.every((_, i) => Boolean(picked[i])) && (!plan.note || (notes[s.code] ?? "").trim().length >= 3);
          return (
            <li key={s.code} className="py-2" data-testid={`step-${s.code}`} data-state={s.state}>
              <div className="flex items-start gap-2">
                <Icon state={s.state} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-partner-text">
                    {s.stepNumber}. {s.title}
                    {!s.mandatory ? <span className="ml-2 text-[11px] font-normal text-partner-muted">optional</span> : null}
                  </p>
                  <p className="text-xs text-partner-muted">
                    <span className="font-semibold">{stepMetaLabel(s.state, s.evidence)}</span>
                    {s.estimatedMinutes ? ` · ~${s.estimatedMinutes} min` : ""}
                  </p>
                  {s.description ? <p className="mt-0.5 text-xs text-partner-text-secondary">{s.description}</p> : null}
                  <BriefChips label="Wear" items={s.ppe} icon={HardHat} className="mt-1.5" testId={`step-${s.code}-ppe`} />
                  <BriefChips label="Materials" items={s.materials ?? []} icon={Package} className="mt-1.5" testId={`step-${s.code}-materials`} />
                  <BriefChips label="Equipment" items={s.equipment ?? []} icon={Wrench} className="mt-1.5" testId={`step-${s.code}-equipment`} />
                  {s.warnings.map((w) => (
                    <p key={w} className="mt-1 flex items-start gap-1.5 text-xs text-amber-900 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span><span className="font-semibold">Warning: </span>{w}</span>
                    </p>
                  ))}
                  {s.blockedBy ? <p className="mt-0.5 text-xs text-partner-muted">{BLOCK_LABEL[s.blockedBy.reason] ?? s.blockedBy.reason}</p> : null}
                  {s.reason ? <p className="mt-0.5 text-xs text-partner-muted">Reason: {s.reason}</p> : null}
                </div>
              </div>
              {s.actions.length ? (
                <div className="mt-2 flex flex-wrap gap-2 pl-6">
                  {s.actions.includes("START") ? (
                    <button type="button" disabled={busy} onClick={() => act.mutate({ code: s.code, action: "START" })} aria-label={`Start step ${s.stepNumber}: ${s.title}`} className="min-h-11 rounded-xl bg-partner-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Start</button>
                  ) : null}
                  {s.actions.includes("COMPLETE") ? (
                    <>
                      {plan.photos.map((p, i) => {
                        const label = plan.photos.length === 2 ? (i === 0 ? "Before photo" : "After photo") : "Photo";
                        return (
                          <label key={p.stage} className="flex min-h-11 flex-col gap-1 text-xs text-partner-muted">
                            {label} (required)
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              aria-label={`${label} for step ${s.stepNumber}: ${s.title}`}
                              onChange={(e) => {
                                const file = e.target.files?.[0] ?? null;
                                setFiles((m) => { const next = [...(m[s.code] ?? [])]; next[i] = file; return { ...m, [s.code]: next }; });
                              }}
                              className="text-xs"
                            />
                          </label>
                        );
                      })}
                      {plan.note ? (
                        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-partner-muted">
                          Note (required)
                          <input
                            value={notes[s.code] ?? ""}
                            maxLength={500}
                            onChange={(e) => setNotes((m) => ({ ...m, [s.code]: e.target.value }))}
                            aria-label={`Note for step ${s.stepNumber}: ${s.title}`}
                            className="min-h-11 rounded-xl border border-partner-line px-3 text-sm"
                          />
                        </label>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy || !ready}
                        onClick={() => act.mutate({ code: s.code, action: "COMPLETE", plan, files: picked, note: notes[s.code] })}
                        aria-label={`Mark step ${s.stepNumber} done: ${s.title}`}
                        className="min-h-11 self-end rounded-xl bg-partner-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Done
                      </button>
                    </>
                  ) : null}
                  {(["SKIP", "FAIL", "ESCALATE"] as const).filter((a) => s.actions.includes(a)).map((a) => (
                    <button key={a} type="button" disabled={busy} onClick={() => { setReasonFor({ code: s.code, action: a }); setText(""); }} aria-label={`${a === "SKIP" ? "Skip" : a === "FAIL" ? "Report failure of" : "Escalate"} step ${s.stepNumber}: ${s.title}`} className="min-h-11 rounded-xl border border-partner-line px-3 py-2 text-xs font-semibold text-partner-text disabled:opacity-50">
                      {a === "SKIP" ? "Skip" : a === "FAIL" ? "Couldn't do it" : "Escalate"}
                    </button>
                  ))}
                  {reasonFor?.code === s.code ? (
                    <div className="flex w-full flex-col gap-2">
                      <label htmlFor={`reason-${s.code}`} className="text-xs text-partner-muted">Reason (required)</label>
                      <input id={`reason-${s.code}`} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} className="min-h-11 rounded-xl border border-partner-line px-3 text-sm" />
                      <div className="flex gap-2">
                        <button type="button" disabled={busy || text.trim().length < 3} onClick={() => act.mutate({ code: s.code, action: reasonFor.action, body: { reason: text.trim() } })} className="min-h-11 rounded-xl border border-red-400 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50 dark:text-partner-danger">Confirm</button>
                        <button type="button" onClick={() => setReasonFor(null)} className="min-h-11 rounded-xl border border-partner-line px-3 py-2 text-xs font-semibold">Cancel</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
