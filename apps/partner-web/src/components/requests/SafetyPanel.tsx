"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, FlaskConical, HardHat, Info, OctagonAlert, ShieldAlert, Siren, Stethoscope, UserRound, Wrench } from "lucide-react";
import { BriefChips } from "@/components/requests/BriefChips";
import { apiRequest } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { useToastStore } from "@/stores/toast-store";
import type { ApiResponse } from "@/types/partner";

/**
 * Phase 10 §9 — safety for this job, from the booking's frozen safety rules.
 *
 * Shows everything the snapshot says: what to wear, what must not be used, warnings, what the
 * customer was asked to do, the conditions under which work must stop, and what to do in an
 * emergency or after an incident. When the service defines prohibited conditions the partner can
 * report one: the server stops the job (safety hold) and alerts the safety team. Only the safety
 * team can clear a hold. Anything not on the list is reported through the existing SOS / incident flow.
 */

/** Mirrored by hand from the partner projection of `GET /api/bookings/:id/safety`. */
export type SafetyView = {
  gate: { ok: boolean; message: string };
  safety: {
    prohibitedConditions: string[];
    warnings: string[];
    customerRequirements?: string[];
    providerRequirements: string[];
    information?: string | null;
    medicalDisclaimer?: string | null;
    emergencyProtocol: string | null;
    /** Newer snapshots only — a booking frozen before these existed has none. */
    ppe?: string[];
    chemicalRestrictions?: string[];
    incidentProtocol?: string | null;
  } | null;
  canReport: string[];
  holds: Array<{ id: number; condition: string; state: string }>;
};

export const jobSafetyKey = (bookingId: string) => ["partner", "safety", bookingId] as const;

/** One fetch for the safety section and the escalation section (same key, react-query dedupes). */
export function useJobSafety(bookingId: string, enabled = true) {
  return useQuery({
    queryKey: jobSafetyKey(bookingId),
    queryFn: () => apiRequest<ApiResponse<SafetyView>>(`/api/bookings/${bookingId}/safety`, { auth: true }).then((r) => r.data!),
    enabled: !!bookingId && enabled,
    staleTime: 10_000,
  });
}

function Note({ icon: Icon, label, children, testId }: { icon: typeof Info; label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex items-start gap-2 text-xs text-partner-text-secondary" data-testid={testId}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-partner-primary" aria-hidden="true" />
      <p className="min-w-0">
        <span className="font-semibold text-partner-text">{label}: </span>
        {children}
      </p>
    </div>
  );
}

export function SafetyPanel({
  bookingId,
  heading = true,
  emptyText,
}: {
  bookingId: string;
  /** The page's section heading already names this block. */
  heading?: boolean;
  /** Shown instead of nothing when the booking has no safety rules and no hold. */
  emptyText?: string;
}) {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  const [picked, setPicked] = useState("");
  const [note, setNote] = useState("");
  const q = useJobSafety(bookingId);
  const report = useMutation({
    mutationFn: () => apiRequest<ApiResponse<unknown>>(`/api/bookings/${bookingId}/safety/prohibited-condition`, { method: "POST", auth: true, body: { condition: picked, ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: () => { showToast("Work is on hold — our safety team has been alerted", "info"); setPicked(""); setNote(""); },
    onError: (e) => showToast(getErrorMessage(e), "error"),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: jobSafetyKey(bookingId) });
      void qc.invalidateQueries({ queryKey: ["partner", "job-actions", bookingId] });
      void qc.invalidateQueries({ queryKey: ["partner", "execution", bookingId] });
    },
  });
  const v = q.data;
  const s = v?.safety;
  const ppe = s?.ppe ?? [];
  const chemicals = s?.chemicalRestrictions ?? [];
  const customerReqs = s?.customerRequirements ?? [];
  const hasContent =
    !!s &&
    Boolean(
      s.prohibitedConditions.length || s.warnings.length || s.providerRequirements.length || customerReqs.length ||
      ppe.length || chemicals.length || s.information || s.medicalDisclaimer || s.emergencyProtocol || s.incidentProtocol,
    );
  if (!v || (!hasContent && v.gate.ok)) {
    if (!emptyText) return null;
    return (
      <p className="text-sm text-partner-muted" data-testid="safety-empty">
        {q.isLoading ? "Loading safety rules…" : q.isError ? "Safety rules could not be loaded — refresh to try again." : emptyText}
      </p>
    );
  }
  return (
    <section
      className="space-y-3"
      data-testid="safety-panel"
      aria-labelledby={heading ? `safety-${bookingId}` : undefined}
      aria-label={heading ? undefined : "Safety rules"}
    >
      {heading ? (
        <p id={`safety-${bookingId}`} className="flex items-center gap-1.5 text-sm font-semibold text-partner-text">
          <ShieldAlert className="h-4 w-4 text-partner-primary" aria-hidden="true" /> Safety
        </p>
      ) : null}
      {!v.gate.ok ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-400 bg-red-50 p-3 text-xs text-red-900" data-testid="safety-hold">
          <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p><span className="font-semibold">Stop — safety hold. </span>{v.gate.message}</p>
        </div>
      ) : null}
      <BriefChips label="Wear" items={ppe} icon={HardHat} testId="safety-ppe" />
      <BriefChips label="Have in place" items={s?.providerRequirements ?? []} icon={Wrench} testId="safety-provider-requirements" />
      <BriefChips label="Do not use" items={chemicals} icon={FlaskConical} testId="safety-chemical-restrictions" />
      {s?.warnings.length ? (
        <ul className="space-y-1" data-testid="safety-warnings">
          {s.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span><span className="font-semibold">Warning: </span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {customerReqs.length ? (
        <Note icon={UserRound} label="The customer was asked to" testId="safety-customer-requirements">{customerReqs.join(" · ")}</Note>
      ) : null}
      {s?.information ? <Note icon={Info} label="Good to know" testId="safety-information">{s.information}</Note> : null}
      {s?.medicalDisclaimer ? <Note icon={Stethoscope} label="Medical note" testId="safety-medical-disclaimer">{s.medicalDisclaimer}</Note> : null}
      {s?.prohibitedConditions.length ? (
        <div className="space-y-1" data-testid="safety-prohibited-conditions">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-partner-text">
            <Ban className="h-3.5 w-3.5 shrink-0 text-partner-primary" aria-hidden="true" />
            Stop work if you find any of these
          </p>
          <ul className="list-disc space-y-0.5 pl-6 text-xs text-partner-text-secondary">
            {s.prohibitedConditions.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      ) : null}
      {s?.emergencyProtocol ? <Note icon={Siren} label="In an emergency" testId="safety-emergency-protocol">{s.emergencyProtocol}</Note> : null}
      {s?.incidentProtocol ? <Note icon={ShieldAlert} label="If an incident happens" testId="safety-incident-protocol">{s.incidentProtocol}</Note> : null}
      {v.canReport.length ? (
        <div id={`report-condition-${bookingId}`} className="space-y-2 rounded-xl border border-partner-line p-3">
          <label htmlFor={`cond-${bookingId}`} className="text-xs font-semibold text-partner-text">Report a prohibited condition (stops the job)</label>
          <select id={`cond-${bookingId}`} value={picked} onChange={(e) => setPicked(e.target.value)} className="min-h-11 w-full rounded-xl border border-partner-line bg-partner-bg px-3 text-sm text-partner-text">
            <option value="">Choose what you found…</option>
            {v.canReport.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input aria-label="What did you see? (optional)" placeholder="What did you see? (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="min-h-11 w-full rounded-xl border border-partner-line bg-partner-bg px-3 text-sm text-partner-text" />
          <button type="button" disabled={!picked || report.isPending} onClick={() => report.mutate()} className="min-h-11 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            Stop work and alert safety team
          </button>
        </div>
      ) : null}
    </section>
  );
}
