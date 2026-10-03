/**
 * Phase 10 §11 — a case-created follow-up visit, as the partner sees it (pure; same wording as partner mobile).
 *
 * `GET /api/providers/me/bookings` sends `followUp: { kind, parentBookingNumber, caseNumber } | null`
 * from the booking's frozen snapshot. Without it a rework job looked like an ordinary ₹0 job.
 * Unknown kinds claim nothing.
 */
export type FollowUpView = {
  kind: string;
  parentBookingNumber: string | null;
  caseNumber: string | null;
};

export function followUpLine(followUp: FollowUpView | null | undefined): string | null {
  if (!followUp) return null;
  const label =
    followUp.kind === "REWORK" ? "Rework visit" : followUp.kind === "REVISIT" ? "Revisit (inspection)" : null;
  if (!label) return null;
  const parts = [
    followUp.parentBookingNumber ? `for booking ${followUp.parentBookingNumber}` : null,
    followUp.caseNumber ? `case ${followUp.caseNumber}` : null,
  ].filter(Boolean);
  return parts.length ? `${label} — ${parts.join(", ")}` : label;
}
