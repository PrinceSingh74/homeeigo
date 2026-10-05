"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, MinusCircle, PlayCircle, XCircle } from "lucide-react";
import { apiRequest } from "@/services/auth/api-client";
import type { ApiResponse } from "@/types/auth";

/**
 * Phase 10 §8 — "What was done": the work steps of this booking and their state, from the server.
 * Read-only for the customer; the professional's notes and reasons are never shown here. States are
 * icon + word, never colour alone.
 */
type StepView = { code: string; stepNumber: number; title: string; mandatory: boolean; state: string };
type ExecutionView = { enforced: boolean; steps: StepView[] };

const STATE: Record<string, { label: string; Icon: typeof CheckCircle2; cls: string }> = {
  COMPLETED: { label: "Done", Icon: CheckCircle2, cls: "text-emerald-600" },
  IN_PROGRESS: { label: "In progress", Icon: PlayCircle, cls: "text-primary" },
  SKIPPED_WITH_REASON: { label: "Not needed", Icon: MinusCircle, cls: "text-muted" },
  FAILED: { label: "Could not be done — our team is on it", Icon: XCircle, cls: "text-red-600" },
  ESCALATED: { label: "With our support team", Icon: XCircle, cls: "text-amber-600" },
};
const PENDING = { label: "Not started", Icon: CircleDashed, cls: "text-muted" };

/** One cache entry per booking — the progress rail reads the same view. */
export function useBookingExecutionQuery(bookingId: string) {
  return useQuery({
    queryKey: ["bookings", "execution", bookingId],
    queryFn: () => apiRequest<ApiResponse<ExecutionView>>(`/api/bookings/${bookingId}/execution`, { auth: true }).then((r) => r.data!),
    enabled: !!bookingId,
    staleTime: 15_000,
  });
}

export function BookingExecution({ bookingId }: { bookingId: string }) {
  const query = useBookingExecutionQuery(bookingId);
  const view = query.data;
  if (!view || !view.enforced || view.steps.length === 0) return null;
  const done = view.steps.filter((s) => s.state === "COMPLETED").length;
  return (
    <section aria-labelledby={`booking-exec-${bookingId}`} data-testid="booking-execution">
      <h3 id={`booking-exec-${bookingId}`} className="mb-3 font-display text-lg font-bold text-content">
        What was done <span className="text-sm font-medium text-muted">· {done} of {view.steps.length}</span>
      </h3>
      <ol className="space-y-2 rounded-2xl glass-card p-4 text-sm">
        {view.steps.map((s) => {
          const st = STATE[s.state] ?? PENDING;
          return (
            <li key={s.code} className="flex gap-3" data-testid={`booking-step-${s.code}`} data-state={s.state}>
              <st.Icon size={16} className={`mt-0.5 shrink-0 ${st.cls}`} aria-hidden="true" />
              <p className="text-content">
                {s.stepNumber}. {s.title} <span className="text-xs text-muted">· <span className="font-semibold">{st.label}</span></span>
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
