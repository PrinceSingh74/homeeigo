"use client";

import { memo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, ShieldQuestion } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import type { SupportIntelligence, SupportRecommendationRow } from "@/types/admin";

/**
 * Phase 10, Capability 11 — support intelligence inside the existing support console.
 *
 * ── Honest labels, not flattering ones ─────────────────────────────────────────
 *
 * The hardest thing to get right here is `modelConfidence`. It is the model's own self-report, and
 * nothing in this platform has checked it against whether the classification was correct. Rendering
 * it as "96% confident" would invite an agent to read it as "96% likely right", which is a claim
 * nobody has earned. It is labelled as a self-report and sits beside the reason it cannot be acted
 * on: there is no approved threshold to compare it against.
 *
 * ── The panel cannot do anything ───────────────────────────────────────────────
 *
 * No mutation, no button that acts. The agent reads a recommendation and then uses the reply /
 * escalate / resolve controls already on this page, which already go through the support service.
 * That separation is the operating model, not a limitation of the UI.
 */

const RISK_STYLE: Record<string, string> = {
  LOW: "bg-[var(--color-biz-success)]/10 text-[var(--color-biz-success)]",
  MEDIUM: "bg-amber-500/10 text-amber-600",
  HIGH: "bg-[var(--color-biz-danger)]/10 text-[var(--color-biz-danger)]",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 rounded-lg bg-[var(--color-biz-bg)] px-3 py-2">
      <dt className="text-[var(--color-biz-muted)]">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export const SupportIntelligencePanel = memo(function SupportIntelligencePanel({
  ticketId,
}: {
  ticketId: string;
}) {
  const qc = useQueryClient();
  const q = useQuery<SupportIntelligence>({
    queryKey: ["admin", "support", "intelligence", ticketId],
    queryFn: () => adminApi.support.intelligence(ticketId),
    // The pipeline re-reads every source and may call a model; a long cache would show an agent a
    // reading of a ticket that has since moved on.
    staleTime: 30_000,
    retry: 1,
  });

  /** The audit trail. Separate query so a slow analysis never hides the history. */
  const history = useQuery<SupportRecommendationRow[]>({
    queryKey: ["admin", "support", "recommendations", ticketId],
    queryFn: () => adminApi.support.recommendations(ticketId),
    staleTime: 15_000,
    retry: 1,
  });

  /**
   * A verdict records agreement. It does not execute anything — the reply / escalate / resolve
   * controls below this panel remain the only way a ticket changes.
   */
  const verdict = useMutation({
    mutationFn: (v: "APPROVED" | "REJECTED") => adminApi.support.recommendationVerdict(ticketId, v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "support", "recommendations", ticketId] });
      void qc.invalidateQueries({ queryKey: ["admin", "support", "intelligence", ticketId] });
    },
  });

  const open = history.data?.find(
    (r) => r.lifecycle === "RECOMMENDATION" || r.lifecycle === "REVIEW_REQUIRED",
  );

  if (q.isLoading) {
    return (
      <section aria-labelledby="si-h" className="rounded-xl border border-[var(--color-biz-border)] p-4">
        <h3 id="si-h" className="mb-2 flex items-center gap-2 font-semibold">
          <Bot className="h-4 w-4" aria-hidden /> Support intelligence
        </h3>
        <p className="text-sm text-[var(--color-biz-muted)]">Analysing ticket…</p>
      </section>
    );
  }

  if (q.isError || !q.data) {
    return (
      <section aria-labelledby="si-h" className="rounded-xl border border-[var(--color-biz-border)] p-4">
        <h3 id="si-h" className="mb-2 flex items-center gap-2 font-semibold">
          <Bot className="h-4 w-4" aria-hidden /> Support intelligence
        </h3>
        <p className="text-sm text-[var(--color-biz-muted)]">
          {q.error instanceof Error
            ? q.error.message
            : "Intelligence unavailable. No classification is shown, because none was produced."}
        </p>
      </section>
    );
  }

  const { classification: c, recommendation: r, eligibility: e, context: ctx } = q.data;
  const degraded = c.state !== "CLASSIFIED";

  return (
    <section aria-labelledby="si-h" className="space-y-3 rounded-xl border border-[var(--color-biz-border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="si-h" className="flex items-center gap-2 font-semibold">
          <Bot className="h-4 w-4" aria-hidden /> Support intelligence
        </h3>
        <span className="text-[11px] text-[var(--color-biz-faint)]">
          {q.data.timings.totalMs} ms · {c.usedFallback ? "rules fallback" : c.provider ?? "model"}
        </span>
      </div>

      {/* A degraded classification is stated before anything is read, not after. */}
      {degraded ? (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <p className="text-xs text-[var(--color-biz-muted)]">
            The model did not classify this ticket ({c.state}
            {c.reasonCode ? `, ${c.reasonCode}` : ""}). The intent below came from the deterministic
            keyword rules, not from a model.
          </p>
        </div>
      ) : null}

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <Row label="Intent">{c.intent ?? "Not classified"}</Row>
        <Row label="Sentiment">{c.sentiment ?? "Not classified"}</Row>
        <Row label="Suggested priority">
          {c.suggestedPriority ?? "Not offered"}
          <span className="ml-1 text-[10px] text-[var(--color-biz-faint)]">(advisory)</span>
        </Row>
        <Row label="Declared category">{ctx.declaredCategory}</Row>
      </dl>

      <div className="rounded-lg border border-dashed border-[var(--color-biz-line)] p-2.5">
        <p className="text-xs">
          <ShieldQuestion className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
          <strong>Model self-report:</strong>{" "}
          {c.modelConfidence === null ? "none" : c.modelConfidence.toFixed(2)}
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">
          This is the number the model gave for its own answer. It has not been measured against
          whether past classifications were correct, and no approved threshold exists to compare it
          against, so it does not qualify anything for automation.
        </p>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
            Suggested next step
          </h4>
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${RISK_STYLE[r.risk] ?? ""}`}>
            {r.risk} risk
          </span>
          {r.requiresHumanReview ? (
            <span className="rounded-md bg-[var(--color-biz-surface)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-biz-muted)]">
              Human review required
            </span>
          ) : null}
        </div>
        <p className="text-sm font-medium">{r.action.replace(/_/g, " ")}</p>
        <p className="mt-0.5 text-xs text-[var(--color-biz-muted)]">{r.reason}</p>
      </div>

      <details>
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
          Evidence ({r.evidence.length})
        </summary>
        <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Evidence table">
          <table className="w-full min-w-[24rem] border-collapse text-left text-[11px]">
            <caption className="sr-only">Signals consulted, with their sources</caption>
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-[var(--color-biz-faint)]">
                <th scope="col" className="pb-1 pr-3">Signal</th>
                <th scope="col" className="pb-1 pr-3">Value</th>
                <th scope="col" className="pb-1">Source</th>
              </tr>
            </thead>
            <tbody>
              {r.evidence.map((ev, i) => (
                <tr key={`${ev.signal}-${i}`} className="border-t border-[var(--color-biz-line)]">
                  <th scope="row" className="py-1 pr-3 text-left font-medium">{ev.signal}</th>
                  <td className="py-1 pr-3 text-[var(--color-biz-muted)]">{ev.value}</td>
                  <td className="py-1 text-[var(--color-biz-muted)]">{ev.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
          Automation
        </h4>
        <p className="mt-0.5 text-xs">
          <strong>{e.eligible ? "Eligible" : "Not eligible"}</strong> · stage {e.stage} · policy{" "}
          {q.data.policyStatus} · flag {q.data.featureFlag.enabled ? "on" : "off"}
        </p>
        <ul className="mt-1.5 space-y-0.5">
          {e.checks.map((chk) => (
            <li key={chk.name} className="flex items-start gap-1.5 text-[11px]">
              {/* The verdict is a word, not only a colour. */}
              <span className={chk.passed ? "text-[var(--color-biz-success)]" : "text-[var(--color-biz-muted)]"}>
                {chk.passed ? "PASS" : "FAIL"}
              </span>
              <span className="text-[var(--color-biz-muted)]">
                <span className="font-medium">{chk.name}</span> — {chk.detail}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/*
        Verdict controls. Present only while a recommendation is open, because a verdict on advice
        somebody already ruled on is not a decision — it is a rewrite of the audit trail.
      */}
      {open ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-biz-bg)] p-2.5">
          <span className="text-[11px] text-[var(--color-biz-muted)]">
            Do you agree with this recommendation?
          </span>
          <button
            type="button"
            disabled={verdict.isPending}
            onClick={() => verdict.mutate("APPROVED")}
            className="rounded-lg border border-[var(--color-biz-line)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-biz-surface)] disabled:opacity-50"
          >
            {verdict.isPending ? "…" : "Agree"}
          </button>
          <button
            type="button"
            disabled={verdict.isPending}
            onClick={() => verdict.mutate("REJECTED")}
            className="rounded-lg border border-[var(--color-biz-line)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-biz-surface)] disabled:opacity-50"
          >
            {verdict.isPending ? "…" : "Disagree"}
          </button>
          <span className="text-[10px] text-[var(--color-biz-faint)]">
            Records agreement only. Use the reply controls below to act on the ticket.
          </span>
        </div>
      ) : null}

      {/* The audit trail: what was advised before, who acted, and whether they followed it. */}
      {history.data && history.data.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
            Recommendation history ({history.data.length})
          </summary>
          <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Recommendation history table">
            <table className="w-full min-w-[30rem] border-collapse text-left text-[11px]">
              <caption className="sr-only">Past recommendations, their lifecycle and who acted</caption>
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-[var(--color-biz-faint)]">
                  <th scope="col" className="pb-1 pr-3">When</th>
                  <th scope="col" className="pb-1 pr-3">Advised</th>
                  <th scope="col" className="pb-1 pr-3">Lifecycle</th>
                  <th scope="col" className="pb-1 pr-3">Human did</th>
                  <th scope="col" className="pb-1">Followed?</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((row) => (
                  <tr key={row.id} className="border-t border-[var(--color-biz-line)]">
                    <th scope="row" className="py-1 pr-3 text-left font-normal text-[var(--color-biz-muted)]">
                      {new Date(row.createdAt).toLocaleString("en-IN")}
                    </th>
                    <td className="py-1 pr-3">{row.action.replace(/_/g, " ")}</td>
                    {/* Lifecycle is spelled out; a colour alone would tell a screen reader nothing. */}
                    <td className="py-1 pr-3 font-medium">{row.lifecycle}</td>
                    <td className="py-1 pr-3 text-[var(--color-biz-muted)]">
                      {row.actedAction ? row.actedAction.replace(/_/g, " ") : "—"}
                    </td>
                    <td className="py-1 text-[var(--color-biz-muted)]">
                      {row.overridden === null ? "—" : row.overridden ? "overridden" : "followed"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {history.data.some((row) => row.failureReason) ? (
            <p className="mt-1 text-[11px] text-[var(--color-biz-muted)]">
              Notes: {history.data.filter((row) => row.failureReason).map((row) => row.failureReason).join(" · ")}
            </p>
          ) : null}
        </details>
      ) : null}

      {ctx.limitations.length > 0 || r.limitations.length > 0 ? (
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
            Limitations
          </h4>
          <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--color-biz-muted)]">
            {[...new Set([...ctx.limitations, ...r.limitations])].map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
});
