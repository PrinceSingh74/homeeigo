/**
 * Phase 10 §11 — the warranty line on a completed job (pure; rendered by QualityPanel).
 *
 * `GET /api/bookings/:id/completion` returns `warranty: { state, startsAt, expiresAt } | null`
 * (backend `booking_warranties`, states ACTIVE | EXPIRED | VOID). The partner sees the window the
 * customer is covered for, so a rework request inside it is expected rather than a surprise. An
 * ACTIVE row whose window has already passed (the expiry sweeper has not run yet) reads as ended —
 * the app never claims cover the server would refuse. Unknown states claim nothing.
 */
export type WarrantyView = { state: string; startsAt: string; expiresAt: string };

export function warrantyLine(
  warranty: WarrantyView | null | undefined,
  now: Date,
  fmt: (iso: string) => string,
): string | null {
  if (!warranty) return null;
  if (warranty.state === "VOID") return "Warranty no longer applies to this job.";
  const expires = Date.parse(warranty.expiresAt);
  if (!Number.isFinite(expires)) return null;
  if (warranty.state === "EXPIRED" || (warranty.state === "ACTIVE" && expires <= now.getTime())) {
    return `Warranty ended on ${fmt(warranty.expiresAt)}.`;
  }
  if (warranty.state === "ACTIVE") return `Warranty: covered until ${fmt(warranty.expiresAt)}.`;
  return null;
}
