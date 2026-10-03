"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, CircleAlert, FileWarning } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import type { ApiResponse } from "@/types/partner";

/**
 * Phase 10 §10/§11 — quality for this job, from the server's recorded verdict (partner projection:
 * verdict + reason codes, rendered as human labels), the customer-confirmation state, and the
 * customer's reported issues (read-only: what the customer said and the outcome — never money or
 * admin detail; the server does not send them). After a refused "Mark complete" the latest verdict
 * here IS the refusal — the blocking reasons are listed under it.
 */

/** Mirrored by hand from bookingQualityService.viewFor (partner audience). */
type QualityView = {
  enforced: boolean;
  latest: { verdict: string; reasonCodes: string[]; at: string } | null;
  history: Array<{ sequence: number; verdict: string; reasonCodes: string[]; byAdmin: boolean; at: string; missingChecklistItems: string[] }>;
};

/** Mirrored by hand from bookingCompletionService.viewFor (partner audience). */
type CompletionView = {
  enforced: boolean;
  bookingStatus: string;
  completedAt: string | null;
  completion: { state: string; confirmBy: string; resolvedAt: string | null; resolvedByType: string | null; caseId: string | null } | null;
  verdict: { verdict: string; reasonCodes: string[]; at: string } | null;
  warranty: { state: string; startsAt: string; expiresAt: string } | null;
};

/** Mirrored by hand from bookingCaseService.partnerView. */
type PartnerCase = {
  id: string;
  caseNumber: string;
  bookingId: string;
  type: string;
  category: string;
  state: string;
  description: string | null;
  createdAt: string;
  closedAt: string | null;
  resolution: { action: string | null; followUpBookingId: string | null } | null;
  evidence: Array<{ id: number; kind: string; note: string | null; createdAt: string }>;
};
type CasesView = { available: boolean; cases: PartnerCase[]; categories: string[] };

const VERDICT_LABEL: Record<string, string> = {
  PASS: "Passed quality checks",
  PASS_WITH_EXCEPTION: "Passed — an optional step was skipped with a reason",
  REWORK_REQUIRED: "Rework required before this job can be completed",
  ESCALATED: "Under review — completion is blocked",
  FAILED: "Did not meet the standard",
};
const BLOCKING_VERDICTS = new Set(["REWORK_REQUIRED", "ESCALATED", "FAILED"]);

const REASON_LABEL: Record<string, string> = {
  SAFETY_HOLD_ACTIVE: "A safety hold is active — only the safety team can clear it",
  SAFETY_INCIDENT_OPEN: "A safety incident is open on this job",
  EXECUTION_STEP_ESCALATED: "A work step is with the support team for review",
  EXECUTION_STEP_FAILED: "A work step failed and needs to be redone",
  QUALITY_PROOF_REQUIRED: "Required proof photos are missing",
  QUALITY_CHECKLIST_REQUIRED: "The service checklist is not complete",
  EXECUTION_STEP_INCOMPLETE: "Required work steps are not finished",
  EXECUTION_STEP_SKIPPED: "An optional step was skipped with a reason",
  NO_QUALITY_POLICY: "No quality checks are configured for this service",
  ADMIN_OVERRIDE: "Recorded by an administrator",
};

const CATEGORY_LABEL: Record<string, string> = {
  QUALITY: "Quality of the work",
  INCOMPLETE: "Work left unfinished",
  DAMAGE: "Something was damaged",
  BEHAVIOUR: "Behaviour",
  NO_SHOW: "No show",
  BILLING: "Billing or payment",
  OTHER: "Other",
};

const CASE_STATE_LABEL: Record<string, string> = {
  CASE_CREATED: "Received",
  TRIAGE: "Being reviewed",
  ELIGIBILITY: "Coverage check",
  INVESTIGATION: "Being investigated",
  ACTION: "Being resolved",
  RESOLVED: "Resolved",
  REJECTED: "Closed — not upheld",
  ESCALATED: "With the senior team",
};

const CASE_ACTION_LABEL: Record<string, string> = {
  REWORK: "A follow-up visit was arranged",
  REFUND: "Resolved by the support team",
  INSPECTION: "An inspection visit was arranged",
  REJECT: "Closed — no action",
  NONE: "Closed — no further action",
};

const dt = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function QualityPanel({ bookingId }: { bookingId: string }) {
  const quality = useQuery({
    queryKey: ["partner", "quality", bookingId],
    queryFn: () => apiRequest<ApiResponse<QualityView>>(`/api/bookings/${bookingId}/quality`, { auth: true }).then((r) => r.data!),
    enabled: !!bookingId,
    staleTime: 10_000,
  });
  const completion = useQuery({
    queryKey: ["partner", "completion", bookingId],
    queryFn: () => apiRequest<ApiResponse<CompletionView>>(`/api/bookings/${bookingId}/completion`, { auth: true }).then((r) => r.data!),
    enabled: !!bookingId,
    staleTime: 10_000,
  });
  const cases = useQuery({
    queryKey: ["partner", "cases", bookingId],
    queryFn: () => apiRequest<ApiResponse<CasesView>>(`/api/bookings/${bookingId}/cases`, { auth: true }).then((r) => r.data!),
    enabled: !!bookingId,
    staleTime: 10_000,
  });

  const latest = quality.data?.latest ?? null;
  const latestHistory = quality.data?.history?.length ? quality.data.history[quality.data.history.length - 1] : null;
  const missing = latestHistory?.missingChecklistItems ?? [];
  const comp = completion.data?.completion ?? null;
  const caseList = cases.data?.available ? cases.data.cases : [];
  if (!latest && !comp && caseList.length === 0) return null;
  const blocking = !!latest && BLOCKING_VERDICTS.has(latest.verdict);

  return (
    <section className="space-y-2" data-testid="quality-panel" aria-labelledby={`quality-${bookingId}`}>
      <p id={`quality-${bookingId}`} className="flex items-center gap-1.5 text-sm font-semibold text-partner-text">
        <BadgeCheck className="h-4 w-4 text-partner-primary" aria-hidden="true" /> Quality
      </p>

      {latest ? (
        <div
          role={blocking ? "alert" : undefined}
          className={`rounded-xl border p-3 text-xs ${blocking ? "border-amber-400 bg-amber-50 text-amber-900" : "border-partner-line text-partner-text-secondary"}`}
          data-testid="quality-verdict"
          data-verdict={latest.verdict}
        >
          <p className="flex items-start gap-2 font-semibold">
            {blocking ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : null}
            <span>
              {VERDICT_LABEL[latest.verdict] ?? latest.verdict} <span className="font-normal">· {dt(latest.at)}</span>
            </span>
          </p>
          {latest.reasonCodes.length ? (
            <ul className="mt-1 space-y-0.5 pl-6">
              {latest.reasonCodes.map((c) => (
                <li key={c}>• {REASON_LABEL[c] ?? c}</li>
              ))}
            </ul>
          ) : null}
          {blocking && missing.length ? (
            <p className="mt-1 pl-6">Checklist still open: {missing.join(", ")}</p>
          ) : null}
        </div>
      ) : null}

      {comp ? (
        <p className="text-xs text-partner-text-secondary" data-testid="quality-completion" data-state={comp.state}>
          {comp.state === "PENDING_CUSTOMER"
            ? `Waiting for the customer to confirm — auto-confirms by ${dt(comp.confirmBy)}.`
            : comp.state === "CONFIRMED"
              ? `The customer confirmed this job${comp.resolvedAt ? ` on ${dt(comp.resolvedAt)}` : ""}.`
              : comp.state === "AUTO_CONFIRMED"
                ? `This job was confirmed automatically${comp.resolvedAt ? ` on ${dt(comp.resolvedAt)}` : ""}.`
                : comp.state === "ISSUE_REPORTED"
                  ? "The customer reported an issue — see below."
                  : null}
        </p>
      ) : null}

      {caseList.length ? (
        <div className="space-y-2" data-testid="quality-cases">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-partner-text">
            <FileWarning className="h-3.5 w-3.5 text-partner-primary" aria-hidden="true" /> Reported issues
          </p>
          <ul className="space-y-2">
            {caseList.map((k) => (
              <li key={k.id} className="rounded-xl border border-partner-line p-3 text-xs" data-testid={`quality-case-${k.caseNumber}`} data-state={k.state}>
                <p className="font-semibold text-partner-text">
                  {CATEGORY_LABEL[k.category] ?? k.category}
                  <span className="font-normal text-partner-muted"> · {k.caseNumber} · {CASE_STATE_LABEL[k.state] ?? k.state}</span>
                </p>
                {k.description ? <p className="mt-1 text-partner-text-secondary">{k.description}</p> : null}
                {k.resolution?.action ? (
                  <p className="mt-1 text-partner-text-secondary">{CASE_ACTION_LABEL[String(k.resolution.action)] ?? "Resolved"}.</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
