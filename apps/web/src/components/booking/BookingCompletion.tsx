"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CircleCheckBig, Flag, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { apiRequest } from "@/services/auth/api-client";
import { useAppStore } from "@/stores/app-store";
import type { ApiResponse } from "@/types/auth";

/**
 * Phase 10 §10 — the customer's side of a completed job: what the server concluded about the work
 * (plain words only), the confirmation window, and the two things the customer can do — confirm the
 * work is done, or report an issue (which opens a §11 case). Server truth; nothing is decided here.
 */

/** Mirrored by hand from bookingCompletionService.viewFor (customer audience). */
type CompletionView = {
  enforced: boolean;
  bookingStatus: string;
  completedAt: string | null;
  completion: { state: "PENDING_CUSTOMER" | "CONFIRMED" | "AUTO_CONFIRMED" | "ISSUE_REPORTED"; confirmBy: string; resolvedAt: string | null; canConfirm: boolean } | null;
  verdict: { verdict: string; label: string; reasons: string[]; at: string } | null;
  warranty: { state: string; startsAt: string; expiresAt: string } | null;
};

/** Mirrored by hand from bookingCaseService.customerView (only the fields used here). */
type CaseSummary = { id: string; caseNumber: string; state: string; category: string; createdAt: string };
type CasesView = { available: boolean; cases: CaseSummary[]; categories: string[] };

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

export function BookingCompletion({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  const [reportOpen, setReportOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");

  const q = useQuery({
    queryKey: ["bookings", "completion", bookingId],
    queryFn: () => apiRequest<ApiResponse<CompletionView>>(`/api/bookings/${bookingId}/completion`, { auth: true }).then((r) => r.data!),
    enabled: !!bookingId,
    staleTime: 15_000,
  });
  const casesQ = useQuery({
    queryKey: ["bookings", "cases", bookingId],
    queryFn: () => apiRequest<ApiResponse<CasesView>>(`/api/bookings/${bookingId}/cases`, { auth: true }).then((r) => r.data!),
    enabled: !!bookingId && q.data?.completion?.state === "ISSUE_REPORTED",
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
    onSuccess: () => {
      showToast("Issue reported — our team will look into it", "success");
      setReportOpen(false);
      setCategory("");
      setDescription("");
    },
    onError: (e) => showToast(e instanceof Error ? e.message : "Could not report this issue", "error"),
    onSettled: () =>
      void Promise.all([
        qc.invalidateQueries({ queryKey: ["bookings", "completion", bookingId] }),
        qc.invalidateQueries({ queryKey: ["bookings", "cases", bookingId] }),
      ]),
  });

  const v = q.data;
  if (!v || !v.completion) return null;
  const c = v.completion;
  const latestCase = casesQ.data?.cases?.[0] ?? null;
  const warrantyActive = v.warranty && v.warranty.state === "ACTIVE" ? v.warranty : null;

  return (
    <section aria-labelledby={`booking-completion-${bookingId}`} data-testid="booking-completion" data-state={c.state}>
      <h3 id={`booking-completion-${bookingId}`} className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-content">
        <BadgeCheck size={18} aria-hidden="true" /> Job completion
      </h3>
      <div className="space-y-3 rounded-2xl glass-card p-4 text-sm">
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
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={confirm.isPending}
                onClick={() => confirm.mutate()}
                data-testid="booking-confirm-completion"
                className="min-h-11 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {confirm.isPending ? "Confirming..." : "Confirm work is done"}
              </button>
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                data-testid="booking-report-issue"
                className="min-h-11 rounded-xl border border-red-300 px-4 py-2 text-xs font-semibold text-red-700"
              >
                Report an issue
              </button>
            </div>
          </div>
        ) : null}

        {c.state === "CONFIRMED" || c.state === "AUTO_CONFIRMED" ? (
          <p className="flex items-start gap-2 text-content" data-testid="booking-completion-confirmed">
            <CircleCheckBig size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
            <span>
              {c.state === "CONFIRMED" ? "You confirmed this service" : "This service was confirmed automatically"}
              {c.resolvedAt ? ` on ${dateTime(c.resolvedAt)}` : ""}.
            </span>
          </p>
        ) : null}

        {c.state === "ISSUE_REPORTED" ? (
          <p className="flex items-start gap-2 text-content" data-testid="booking-completion-issue">
            <Flag size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              You reported an issue{latestCase ? ` (case ${latestCase.caseNumber})` : ""}.
              {latestCase ? ` Status: ${CASE_STATE_LABEL[latestCase.state] ?? latestCase.state}.` : " Our team is looking into it."}
            </span>
          </p>
        ) : null}

        {warrantyActive ? (
          <p className="flex items-start gap-2 text-xs text-muted" data-testid="booking-warranty">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
            <span>Covered until {dateOnly(warrantyActive.expiresAt)}</span>
          </p>
        ) : null}
      </div>

      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title="Report an issue" size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!category || report.isPending) return;
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
              className="w-full rounded-xl border border-line bg-transparent p-3 text-sm text-content outline-none focus:border-primary"
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
