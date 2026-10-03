"use client";

import { useQuery } from "@tanstack/react-query";
import { FileWarning } from "lucide-react";
import { apiRequest } from "@/services/auth/api-client";
import type { ApiResponse } from "@/types/auth";

/**
 * Phase 10 §11 — the customer's reported issues on this booking, with a plain-words state timeline.
 * Server truth (customerView): the customer sees their case, their own evidence and state changes —
 * never admin reasons, notes or override text (the server does not send them, and nothing internal
 * is invented here).
 */

/** Mirrored by hand from bookingCaseService.customerView. */
type CaseView = {
  id: string;
  caseNumber: string;
  bookingId: string;
  type: string;
  category: string;
  state: string;
  description: string | null;
  createdAt: string;
  closedAt: string | null;
  eligibility: { warrantyCovers: boolean; proofRequired: boolean; proofMissing: boolean; reasonCodes: string[] };
  resolution: { action: string | null; status: string | null; refundPaise: number | null; followUpBookingId: string | null } | null;
  evidence: Array<{ id: number; kind: string; note: string | null; createdAt: string }>;
  timeline: Array<{ state: string; at: string }>;
};
type CasesView = { available: boolean; cases: CaseView[]; categories: string[] };

const CATEGORY_LABEL: Record<string, string> = {
  QUALITY: "Quality of the work",
  INCOMPLETE: "Work left unfinished",
  DAMAGE: "Something was damaged",
  BEHAVIOUR: "Professional's behaviour",
  NO_SHOW: "Professional did not show up",
  BILLING: "Billing or payment",
  OTHER: "Something else",
};

const STATE_LABEL: Record<string, string> = {
  CASE_CREATED: "Received",
  TRIAGE: "Being reviewed",
  ELIGIBILITY: "Checking what's covered",
  INVESTIGATION: "Being investigated",
  ACTION: "Being resolved",
  RESOLVED: "Resolved",
  REJECTED: "Closed — not approved",
  ESCALATED: "With our senior team",
};

const ACTION_LABEL: Record<string, string> = {
  REWORK: "A follow-up visit was arranged",
  REFUND: "A refund was issued",
  INSPECTION: "An inspection visit was arranged",
  REJECT: "No action was taken on this issue",
  NONE: "Closed with no further action",
};

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function BookingCases({ bookingId }: { bookingId: string }) {
  const q = useQuery({
    queryKey: ["bookings", "cases", bookingId],
    queryFn: () => apiRequest<ApiResponse<CasesView>>(`/api/bookings/${bookingId}/cases`, { auth: true }).then((r) => r.data!),
    enabled: !!bookingId,
    staleTime: 15_000,
  });
  const v = q.data;
  if (!v || !v.available || v.cases.length === 0) return null;
  return (
    <section aria-labelledby={`booking-cases-${bookingId}`} data-testid="booking-cases">
      <h3 id={`booking-cases-${bookingId}`} className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-content">
        <FileWarning size={18} aria-hidden="true" /> Reported issues
      </h3>
      <ul className="space-y-3">
        {v.cases.map((c) => {
          const action = c.resolution?.action ? ACTION_LABEL[String(c.resolution.action)] ?? null : null;
          const refund = typeof c.resolution?.refundPaise === "number" && c.resolution.refundPaise > 0 ? c.resolution.refundPaise : null;
          return (
            <li key={c.id} className="rounded-2xl glass-card p-4 text-sm" data-testid={`booking-case-${c.caseNumber}`} data-state={c.state}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-content">{CATEGORY_LABEL[c.category] ?? c.category}</p>
                <p className="text-xs text-muted">Case {c.caseNumber}</p>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                <span className="font-semibold">{STATE_LABEL[c.state] ?? c.state}</span> · reported {dateTime(c.createdAt)}
              </p>
              {c.description ? <p className="mt-2 text-content">{c.description}</p> : null}
              {action ? (
                <p className="mt-2 text-content" data-testid="booking-case-resolution">
                  {action}
                  {refund ? ` — ₹${(refund / 100).toLocaleString("en-IN")}` : ""}.
                </p>
              ) : null}
              {c.timeline.length > 0 ? (
                <ol className="mt-3 space-y-1 border-t border-line pt-2 text-xs text-muted" aria-label={`Case ${c.caseNumber} progress`}>
                  {c.timeline.map((t, i) => (
                    <li key={`${t.state}-${t.at}-${i}`}>
                      {STATE_LABEL[t.state] ?? t.state} · {dateTime(t.at)}
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
