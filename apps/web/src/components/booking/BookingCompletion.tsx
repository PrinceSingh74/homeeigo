"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CircleCheckBig, Flag, Info, ShieldCheck, ShieldOff } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { apiRequest } from "@/services/auth/api-client";
import { useAppStore } from "@/stores/app-store";
import type { ApiResponse } from "@/types/auth";
import { reportDecision, reportRefusal, type CaseReportability, type ReportDecision } from "@/lib/case-report";

/**
 * Phase 10 §10 — the customer's side of a completed job: what the server concluded about the work
 * (plain words only), the confirmation window, the cover on the booking, and the two things the
 * customer can do — confirm the work is done, or report an issue (which opens a §11 case).
 * Server truth; nothing is decided here. In particular the complaint window is never computed on
 * the client: `report` on GET /:id/cases says whether an issue can be raised (lib/case-report), and
 * on a backend that does not send it the action is offered and the server's refusal is shown.
 */

/** Mirrored by hand from bookingCompletionService.viewFor (customer audience). */
export type CompletionView = {
  enforced: boolean;
  bookingStatus: string;
  completedAt: string | null;
  completion: { state: "PENDING_CUSTOMER" | "CONFIRMED" | "AUTO_CONFIRMED" | "ISSUE_REPORTED"; confirmBy: string; resolvedAt: string | null; canConfirm: boolean } | null;
  verdict: { verdict: string; label: string; reasons: string[]; at: string } | null;
  /** state: ACTIVE | EXPIRED | VOID (service-warranty WarrantyRowState). null = no cover row on this booking. */
  warranty: { state: string; startsAt: string; expiresAt: string } | null;
};

/** Mirrored by hand from bookingCaseService.customerView (only the fields used here). */
type CaseSummary = { id: string; caseNumber: string; state: string; category: string; createdAt: string };
type CasesView = { available: boolean; cases: CaseSummary[]; categories: string[]; report?: CaseReportability };

/** UI labels for the server's category enum — descriptions of the choice, never data. */
const CATEGORY_LABEL: Record<string, string> = {
  QUALITY: "The quality of the work",
  INCOMPLETE: "The work was left unfinished",
  DAMAGE: "Something was damaged",
  BEHAVIOUR: "The professional's behaviour",
  NO_SHOW: "The professional did not show up",
  BILLING: "Billing or payment",
  OTHER: "Something else",
};

const CASE_STATE_LABEL: Record<string, string> = {
  CASE_CREATED: "Received",
  TRIAGE: "Being reviewed",
  ELIGIBILITY: "Checking what's covered",
  INVESTIGATION: "Being investigated",
  ACTION: "Being resolved",
  RESOLVED: "Resolved",
  REJECTED: "Closed — not approved",
  ESCALATED: "With our senior team",
};

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** One cache entry per booking — the progress rail and the modal's action row read the same view. */
export function useBookingCompletionQuery(bookingId: string) {
  return useQuery({
    queryKey: ["bookings", "completion", bookingId],
    queryFn: () => apiRequest<ApiResponse<CompletionView>>(`/api/bookings/${bookingId}/completion`, { auth: true }).then((r) => r.data!),
    enabled: !!bookingId,
    staleTime: 15_000,
  });
}

type CoverLine = { tone: "active" | "ended" | "none"; title: string; detail: string | null };

/**
 * Every cover state the API returns, in words. An ACTIVE row whose end date has passed reads as
 * ended — the dates are the server's; only "has that date passed" is evaluated here.
 */
export function describeCover(w: CompletionView["warranty"], now: number = Date.now()): CoverLine {
  if (!w) return { tone: "none", title: "No cover is active on this booking", detail: null };
  const started = `Started ${dateOnly(w.startsAt)}`;
  if (w.state === "VOID") return { tone: "none", title: "Cover no longer applies to this booking", detail: null };
  const ended = w.state === "EXPIRED" || new Date(w.expiresAt).getTime() <= now;
  if (ended) return { tone: "ended", title: `Cover ended on ${dateOnly(w.expiresAt)}`, detail: started };
  if (w.state === "ACTIVE") return { tone: "active", title: `Covered until ${dateOnly(w.expiresAt)}`, detail: started };
  // A state this client does not know: show the server's dates and make no claim about them.
  return { tone: "none", title: `Cover period: ${dateOnly(w.startsAt)} to ${dateOnly(w.expiresAt)}`, detail: null };
}

export function BookingCompletion({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  const [reportOpen, setReportOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  /** The server's refusal for this booking: shown in the form, and — when final — on the card. */
  const [refusal, setRefusal] = useState<{ message: string; final: boolean } | null>(null);

  /** Said once a report has gone in: photos can only be added to a case that exists. */
  const [notice, setNotice] = useState<string | null>(null);

  const q = useBookingCompletionQuery(bookingId);
  // Fetched for every completed booking, not only after an issue: `report` says whether one can be raised.
  const casesQ = useQuery({
    queryKey: ["bookings", "cases", bookingId],
    queryFn: () => apiRequest<ApiResponse<CasesView>>(`/api/bookings/${bookingId}/cases`, { auth: true }).then((r) => r.data!),
    enabled: !!bookingId && (q.data?.completion != null || q.data?.bookingStatus === "COMPLETED"),
    staleTime: 15_000,
  });

  const confirm = useMutation({
    mutationFn: () => apiRequest<ApiResponse<{ changed: boolean }>>(`/api/bookings/${bookingId}/confirm-completion`, { method: "POST", auth: true }),
    onSuccess: () => showToast("Thank you — your service is confirmed", "success"),
    onError: (e) => showToast(e instanceof Error ? e.message : "Could not confirm this booking", "error"),
    onSettled: () =>
      void Promise.all([
        qc.invalidateQueries({ queryKey: ["bookings", "completion", bookingId] }),
        qc.invalidateQueries({ queryKey: ["bookings", "quality", bookingId] }),
      ]),
  });

  const report = useMutation({
    mutationFn: () =>
      apiRequest<ApiResponse<{ replayed: boolean }>>(`/api/bookings/${bookingId}/cases`, {
        method: "POST",
        auth: true,
        body: { category, ...(description.trim() ? { description: description.trim() } : {}) },
      }),
    onSuccess: (r) => {
      // A replay means a case is already open on this booking; the server did not open a second one.
      showToast(r.data?.replayed ? "You already have an open issue on this booking — it's shown below" : "Issue reported — our team will look into it", r.data?.replayed ? "info" : "success");
      setNotice("You can now add photos or more details to this case under Reported issues.");
      setRefusal(null);
      setReportOpen(false);
      setCategory("");
      setDescription("");
    },
    onError: (e) => {
      const next = reportRefusal((e as { code?: string } | null)?.code, e instanceof Error ? e.message : null);
      setRefusal(next);
      if (next.final) setReportOpen(false);
    },
    onSettled: () =>
      void Promise.all([
        qc.invalidateQueries({ queryKey: ["bookings", "completion", bookingId] }),
        qc.invalidateQueries({ queryKey: ["bookings", "cases", bookingId] }),
      ]),
  });

  const v = q.data;
  if (!v || !v.completion) return null;
  const c = v.completion;
  const cases = casesQ.data?.cases ?? [];
  const latestCase = cases[0] ?? null;
  const cover = describeCover(v.warranty);
  const confirmed = c.state === "CONFIRMED" || c.state === "AUTO_CONFIRMED";
  // The server's `report` decides; without it (older backend) the action is offered and its refusal shown.
  // While the first answer is still loading nothing is offered, so a button never appears and vanishes.
  const decision: ReportDecision = casesQ.isLoading
    ? { kind: "none" }
    : reportDecision({ report: casesQ.data?.report, completionState: c.state, latestCaseState: latestCase?.state, refusal });
  const openCase = decision.kind === "open_case" ? (cases.find((k) => k.id === decision.caseId) ?? null) : null;
  const openReport = () => {
    setRefusal(null);
    setNotice(null);
    setReportOpen(true);
  };
  const goToCases = () => {
    const heading = document.getElementById(`booking-cases-${bookingId}`);
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const secondaryBtn = "min-h-11 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-content transition hover:bg-primary/5";
  const reportButton =
    decision.kind === "offer" ? (
      <button type="button" onClick={openReport} data-testid="booking-report-issue" className={secondaryBtn}>
        {decision.label}
      </button>
    ) : null;

  return (
    <section aria-labelledby={`booking-completion-${bookingId}`} data-testid="booking-completion" data-state={c.state}>
      <h3 id={`booking-completion-${bookingId}`} className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-content">
        <BadgeCheck size={18} aria-hidden="true" /> Job completion
      </h3>
      <div className="space-y-4 rounded-2xl glass-card p-4 text-sm">
        {v.verdict ? (
          <div data-testid="booking-completion-verdict">
            <p className="font-semibold text-content">{v.verdict.label}</p>
            {v.verdict.reasons.map((r) => (
              <p key={r} className="text-xs text-muted">
                • {r}
              </p>
            ))}
          </div>
        ) : null}

        {c.state === "PENDING_CUSTOMER" ? (
          <div className="space-y-3">
            <p className="text-content">
              Please confirm the work is done. If we don&apos;t hear from you, it will be confirmed automatically on{" "}
              <span className="font-semibold">{dateTime(c.confirmBy)}</span>.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={confirm.isPending || !c.canConfirm}
                onClick={() => confirm.mutate()}
                data-testid="booking-confirm-completion"
                className="min-h-12 flex-1 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {confirm.isPending ? "Confirming..." : "Confirm work is done"}
              </button>
              {reportButton}
            </div>
          </div>
        ) : null}

        {confirmed ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-content" data-testid="booking-completion-confirmed">
              <CircleCheckBig size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              <span>
                {c.state === "CONFIRMED" ? "You confirmed this service" : "This service was confirmed automatically"}
                {c.resolvedAt ? ` on ${dateTime(c.resolvedAt)}` : ""}.
              </span>
            </p>
            {reportButton ? (
              <div>
                <p className="mb-2 text-xs text-muted">Noticed a problem since then? You can still tell us.</p>
                {reportButton}
              </div>
            ) : null}
          </div>
        ) : null}

        {c.state === "ISSUE_REPORTED" ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-content" data-testid="booking-completion-issue">
              <Flag size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              <span>
                You reported an issue{latestCase ? ` (case ${latestCase.caseNumber})` : ""}.
                {latestCase ? ` Status: ${CASE_STATE_LABEL[latestCase.state] ?? latestCase.state}.` : " Our team is looking into it."}
              </span>
            </p>
            {reportButton}
          </div>
        ) : null}

        {decision.kind === "open_case" ? (
          <div className="space-y-2 rounded-xl border border-line bg-surface/60 p-3" data-testid="booking-report-open-case">
            <p className="flex items-start gap-2 text-content">
              <Info size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
              <span>
                {c.state === "ISSUE_REPORTED" ? "Your issue is still open" : `You have an open issue on this booking${openCase ? ` (case ${openCase.caseNumber})` : ""}`}
                . You can add photos or more details to it under Reported issues.
              </span>
            </p>
            <button type="button" onClick={goToCases} className={secondaryBtn}>
              Go to your open case
            </button>
          </div>
        ) : null}

        {decision.kind === "reason" ? (
          <p className="flex items-start gap-2 rounded-xl border border-line bg-surface/60 p-3 text-content" role="status" data-testid="booking-report-refused">
            <Info size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
            <span>{decision.message}</span>
          </p>
        ) : null}

        {notice && decision.kind !== "reason" ? (
          <p className="text-xs text-muted" role="status" data-testid="booking-report-notice">
            {notice}
          </p>
        ) : null}

        <div className="flex items-start gap-2 border-t border-line pt-3" data-testid="booking-warranty" data-cover={cover.tone}>
          {cover.tone === "active" ? (
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <ShieldOff size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
          )}
          <div>
            <p className={cover.tone === "active" ? "font-semibold text-content" : "text-muted"}>{cover.title}</p>
            {cover.detail ? <p className="text-xs text-muted">{cover.detail}</p> : null}
          </div>
        </div>
      </div>

      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title="Report an issue" size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!category || report.isPending) return;
            setRefusal(null);
            report.mutate();
          }}
        >
          <div>
            <label htmlFor={`case-category-${bookingId}`} className="mb-1 block text-sm font-semibold text-content">
              What went wrong?
            </label>
            <select
              id={`case-category-${bookingId}`}
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              data-testid="case-category"
              className="min-h-11 w-full rounded-xl border border-line bg-transparent p-3 text-sm text-content outline-none focus:border-primary"
            >
              <option value="" disabled>
                Choose one
              </option>
              {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`case-description-${bookingId}`} className="mb-1 block text-sm font-semibold text-content">
              Tell us what happened <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id={`case-description-${bookingId}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={4}
              data-testid="case-description"
              className="w-full rounded-xl border border-line bg-transparent p-3 text-sm text-content outline-none focus:border-primary"
              placeholder="What happened, and what would you like us to do?"
            />
          </div>
          {refusal && !refusal.final ? (
            <p role="alert" className="rounded-xl border border-line bg-surface/60 p-3 text-sm text-error" data-testid="case-error">
              {refusal.message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={!category || report.isPending}
            data-testid="case-submit"
            className="min-h-11 w-full rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {report.isPending ? "Sending..." : "Report issue"}
          </button>
        </form>
      </Modal>
    </section>
  );
}
