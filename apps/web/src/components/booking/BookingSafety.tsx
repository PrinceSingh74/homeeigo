"use client";

import { useQuery } from "@tanstack/react-query";
import { OctagonAlert, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/services/auth/api-client";
import type { ApiResponse } from "@/types/auth";

/**
 * Phase 10 §9 — the safety information the customer was given at booking (warnings, what to do,
 * medical disclaimer, emergency protocol) and, if work is on safety hold, a plain explanation.
 * Server truth; the professional's notes and incident internals are never shown.
 */
type View = {
  gate: { ok: boolean; message: string };
  safety: { warnings: string[]; customerRequirements: string[]; information: string | null; medicalDisclaimer: string | null; emergencyProtocol: string | null } | null;
  holds: Array<{ condition: string }>;
};

export function BookingSafety({ bookingId }: { bookingId: string }) {
  const q = useQuery({
    queryKey: ["bookings", "safety", bookingId],
    queryFn: () => apiRequest<ApiResponse<View>>(`/api/bookings/${bookingId}/safety`, { auth: true }).then((r) => r.data!),
    enabled: !!bookingId,
    staleTime: 15_000,
  });
  const v = q.data;
  const s = v?.safety;
  const has = !!s && (s.warnings.length || s.customerRequirements.length || s.information || s.medicalDisclaimer || s.emergencyProtocol);
  if (!v || (!has && v.gate.ok)) return null;
  return (
    <section aria-labelledby={`booking-safety-${bookingId}`} data-testid="booking-safety">
      <h3 id={`booking-safety-${bookingId}`} className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-content">
        <ShieldCheck size={18} aria-hidden="true" /> Safety
      </h3>
      {!v.gate.ok ? (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-900" data-testid="booking-safety-hold">
          <OctagonAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>Work is paused for safety{v.holds.length ? `: ${v.holds.map((h) => h.condition).join(", ")}` : ""}. Our safety team is looking into it and will contact you.</p>
        </div>
      ) : null}
      <div className="space-y-2 rounded-2xl glass-card p-4 text-sm">
        {s?.information ? <p className="text-content">{s.information}</p> : null}
        {s?.customerRequirements.map((r) => <p key={r} className="text-content">• {r}</p>)}
        {s?.warnings.map((w) => <p key={w} className="text-amber-900">⚠ {w}</p>)}
        {s?.medicalDisclaimer ? <p className="text-xs text-muted">{s.medicalDisclaimer}</p> : null}
        {s?.emergencyProtocol ? <p className="text-xs text-muted">In an emergency: {s.emergencyProtocol}</p> : null}
      </div>
    </section>
  );
}
