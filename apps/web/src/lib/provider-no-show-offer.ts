/**
 * §53 on the web — when to offer "my professional never arrived".
 *
 * Only while the booking is still waiting on the professional (the same statuses as the shared
 * rule in `booking-cancel-rules`, which is kept identical to the mobile app's copy and so is not
 * changed here), and not before the server would consider the report: nobody is late for an
 * appointment that has not begun, and the server allows the same wait after the booked time that
 * the professional is held to. The server decides; this only keeps a control it would refuse off
 * the screen.
 */
const REPORTABLE = new Set(["accepted", "assigned", "en_route", "arrived"]);

/** Mirror of the backend's NO_SHOW_POLICY.graceMinutes. */
export const PROVIDER_NO_SHOW_WAIT_MINUTES = 15;

export function canReportProviderNoShow(
  backendStatus: string | undefined,
  scheduledDate: string | Date | null | undefined,
  now: number = Date.now(),
): boolean {
  const s = (backendStatus ?? "").toLowerCase().replace(/-/g, "_");
  if (!REPORTABLE.has(s)) return false;
  const booked = scheduledDate ? new Date(scheduledDate).getTime() : Number.NaN;
  if (!Number.isFinite(booked)) return false;
  return now >= booked + PROVIDER_NO_SHOW_WAIT_MINUTES * 60_000;
}
