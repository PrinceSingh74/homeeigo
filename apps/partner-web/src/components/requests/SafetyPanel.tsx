"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OctagonAlert, ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { useToastStore } from "@/stores/toast-store";
import type { ApiResponse } from "@/types/partner";

/**
 * Phase 10 §9 — safety for this job, from the booking's frozen safety rules.
 *
 * Shows what to wear/watch for and, when the service defines prohibited conditions, lets the partner
 * report one: the server stops the job (safety hold) and alerts the safety team. Only the safety team
 * can clear a hold. Anything not on the list is reported through the existing SOS / incident flow.
 */
type SafetyView = {
  gate: { ok: boolean; message: string };
  safety: { prohibitedConditions: string[]; warnings: string[]; providerRequirements: string[]; emergencyProtocol: string | null } | null;
  canReport: string[];
  holds: Array<{ id: number; condition: string; state: string }>;
};

export function SafetyPanel({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  const [picked, setPicked] = useState("");
  const [note, setNote] = useState("");
  const key = ["partner", "safety", bookingId];
  const q = useQuery({ queryKey: key, queryFn: () => apiRequest<ApiResponse<SafetyView>>(`/api/bookings/${bookingId}/safety`, { auth: true }).then((r) => r.data!), staleTime: 10_000 });
  const report = useMutation({
    mutationFn: () => apiRequest<ApiResponse<unknown>>(`/api/bookings/${bookingId}/safety/prohibited-condition`, { method: "POST", auth: true, body: { condition: picked, ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: () => { showToast("Work is on hold — our safety team has been alerted", "info"); setPicked(""); setNote(""); },
    onError: (e) => showToast(getErrorMessage(e), "error"),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["partner", "job-actions", bookingId] });
      void qc.invalidateQueries({ queryKey: ["partner", "execution", bookingId] });
    },
  });
  const v = q.data;
  const s = v?.safety;
  const hasContent = !!s && (s.prohibitedConditions.length || s.warnings.length || s.providerRequirements.length || s.emergencyProtocol);
  if (!v || (!hasContent && v.gate.ok)) return null;
  return (
    <section className="space-y-2" data-testid="safety-panel" aria-labelledby={`safety-${bookingId}`}>
      <p id={`safety-${bookingId}`} className="flex items-center gap-1.5 text-sm font-semibold text-partner-text">
        <ShieldAlert className="h-4 w-4 text-partner-primary" aria-hidden="true" /> Safety
      </p>
      {!v.gate.ok ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-400 bg-red-50 p-3 text-xs text-red-900" data-testid="safety-hold">
          <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p><span className="font-semibold">Stop — safety hold. </span>{v.gate.message}</p>
        </div>
      ) : null}
      {s?.providerRequirements.length ? <p className="text-xs text-partner-text-secondary">Wear / bring: {s.providerRequirements.join(", ")}</p> : null}
      {s?.warnings.map((w) => <p key={w} className="text-xs text-amber-900 dark:text-amber-400">⚠ {w}</p>)}
      {s?.emergencyProtocol ? <p className="text-xs text-partner-text-secondary">In an emergency: {s.emergencyProtocol}</p> : null}
      {v.canReport.length ? (
        <div className="space-y-2 rounded-xl border border-partner-line p-3">
          <label htmlFor={`cond-${bookingId}`} className="text-xs font-semibold text-partner-text">Report a prohibited condition (stops the job)</label>
          <select id={`cond-${bookingId}`} value={picked} onChange={(e) => setPicked(e.target.value)} className="min-h-11 w-full rounded-xl border border-partner-line px-3 text-sm">
            <option value="">Choose what you found…</option>
            {v.canReport.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input aria-label="What did you see? (optional)" placeholder="What did you see? (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="min-h-11 w-full rounded-xl border border-partner-line px-3 text-sm" />
          <button type="button" disabled={!picked || report.isPending} onClick={() => report.mutate()} className="min-h-11 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            Stop work and alert safety team
          </button>
        </div>
      ) : null}
    </section>
  );
}
