"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, XCircle } from "lucide-react";
import { qk } from "@/hooks/use-core-data";
import { coreApi } from "@/services/core/api";
import { useAppStore } from "@/stores/app-store";
import type { BookingRequirementsView, RequirementItemView } from "@/types/backend";

/**
 * Phase 10 §6 — what the customer must have in place, whether it is, and what to do next.
 *
 * Read from the server's booking-scoped requirement state; never decided here. The one thing a
 * customer can do to a professional's check is say "it is in place now — please check again".
 * States are perceivable without colour (icon + word).
 */

const STATE: Record<RequirementItemView["state"], { label: string; Icon: typeof CheckCircle2; cls: string }> = {
  UNRESOLVED: { label: "Your professional will check this on arrival", Icon: CircleDashed, cls: "text-muted" },
  SATISFIED: { label: "In place", Icon: CheckCircle2, cls: "text-emerald-600" },
  FAILED: { label: "Missing — needed before work can start", Icon: XCircle, cls: "text-red-600" },
  EXPIRED: { label: "Will be checked again at the new appointment", Icon: Clock, cls: "text-amber-600" },
};

const WHEN: Record<RequirementItemView["enforcementPoint"], string> = {
  BEFORE_BOOKING: "Confirmed when you booked",
  BEFORE_ARRIVAL: "Needed before your professional arrives",
  AT_START: "Needed when the service starts",
};

export function BookingRequirements({ bookingId, active }: { bookingId: string; active: boolean }) {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  const query = useQuery<BookingRequirementsView>({
    queryKey: qk.bookingRequirements(bookingId),
    queryFn: () => coreApi.bookings.requirements(bookingId),
    enabled: !!bookingId,
    staleTime: 10_000,
  });
  const ready = useMutation({
    mutationFn: (code: string) => coreApi.bookings.requirementAction(bookingId, code, "READY"),
    onSuccess: () => showToast("Thanks — your professional will check again", "success"),
    onError: (e) => showToast(e instanceof Error ? e.message : "Could not update this requirement", "error"),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.bookingRequirements(bookingId) }),
  });

  const view = query.data;
  if (!view || !view.enforced || view.items.length === 0) return null;
  const blocked = view.items.filter((i) => i.blocking && i.blocking.remediation.role === "CUSTOMER");

  return (
    <section aria-labelledby={`booking-req-${bookingId}`} data-testid="booking-requirements">
      <h3 id={`booking-req-${bookingId}`} className="mb-3 font-display text-lg font-bold text-content">
        What we need from you
      </h3>
      {active && blocked.length > 0 ? (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            Work cannot start until {blocked.length === 1 ? "this is" : "these are"} in place. Once arranged, tap “It&apos;s ready now” so your professional can check again.
          </p>
        </div>
      ) : null}
      <ul className="space-y-3 rounded-2xl glass-card p-4 text-sm">
        {view.items.map((item) => {
          const s = STATE[item.state];
          const canReady = active && item.actions.includes("READY");
          return (
            <li key={item.code} className="flex gap-3" data-testid={`booking-requirement-${item.code}`} data-state={item.state}>
              <s.Icon size={16} className={`mt-0.5 shrink-0 ${s.cls}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-content">{item.label}</p>
                <p className="text-xs text-muted">
                  <span className="font-semibold">{s.label}</span> · {WHEN[item.enforcementPoint]}
                </p>
                {item.blocking?.remediation.role === "CUSTOMER" ? <p className="mt-0.5 text-xs text-amber-900">{item.blocking.remediation.text}</p> : null}
                {canReady ? (
                  <button
                    type="button"
                    disabled={ready.isPending}
                    onClick={() => ready.mutate(item.code)}
                    aria-label={`${item.label}: it's ready now, ask the professional to check again`}
                    className="mt-2 min-h-11 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    It&apos;s ready now
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
