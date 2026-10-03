/**
 * Phase 08 — service time rules: the ONE implementation of "may this service start at this instant?"
 * for new bookings and reschedules (pure; no database).
 *
 * Civil-date rules (same-day, blackout dates) are evaluated in the platform's business timezone, then
 * compared as calendar dates — never with the server's local zone (`toDateString`) or UTC
 * (`toISOString().slice(0, 10)`), which disagreed with each other and let a 00:30 IST booking on a
 * blackout date slip through as "the previous day". Instant rules (past, lead time, advance window)
 * compare canonical instants.
 *
 * Timezone: every live service is in an Indian city and every user/provider defaults to Asia/Kolkata,
 * so the platform has one civil timezone today. It is a parameter, not an assumption baked into the
 * rules, so a multi-timezone future passes the location's IANA zone.
 */
export const BUSINESS_TIMEZONE = "Asia/Kolkata";
/** Applied only when a service configures no `availability.maximumAdvanceDays` (pre-existing default). */
export const DEFAULT_MAX_ADVANCE_DAYS = 30;

export type ServiceTimeReason =
  | "INVALID_DATE"
  | "SLOT_IN_PAST"
  | "LEAD_TIME_NOT_MET"
  | "BEYOND_ADVANCE_WINDOW"
  | "SAME_DAY_UNAVAILABLE"
  | "BLACKOUT_DATE";

export type ServiceTimeConfig = {
  minimumLeadTimeMinutes?: number;
  maximumAdvanceDays?: number;
  sameDay?: boolean;
  blackoutDates?: string[];
};

export type ServiceTimeResult = { ok: true } | { ok: false; reason: ServiceTimeReason; message: string };

/** YYYY-MM-DD of an instant in a timezone (en-CA formats as ISO date). */
export function civilDate(instant: Date, timeZone: string = BUSINESS_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** Customer-safe copy per reason. Reasons are stable API codes; the copy may change. */
export const SERVICE_TIME_MESSAGES: Record<ServiceTimeReason, (ctx: { leadMinutes?: number; maxDays?: number }) => string> = {
  INVALID_DATE: () => "Please choose a valid date and time.",
  SLOT_IN_PAST: () => "That time has already passed. Please choose a later slot.",
  LEAD_TIME_NOT_MET: ({ leadMinutes }) =>
    leadMinutes && leadMinutes >= 60
      ? `This service needs at least ${Math.round((leadMinutes / 60) * 10) / 10} hours' notice. Please choose a later slot.`
      : `This service needs at least ${leadMinutes ?? 0} minutes' notice. Please choose a later slot.`,
  BEYOND_ADVANCE_WINDOW: ({ maxDays }) => `This service can be booked up to ${maxDays ?? DEFAULT_MAX_ADVANCE_DAYS} days ahead.`,
  SAME_DAY_UNAVAILABLE: () => "Same-day booking isn't available for this service. Please choose another day.",
  BLACKOUT_DATE: () => "This service isn't available on that date. Please choose another day.",
};

export function evaluateServiceTimeRules(input: {
  scheduledDate: Date;
  now?: Date;
  availability?: ServiceTimeConfig | null;
  /** Legacy top-level flag; `availability.sameDay` wins when both are set. */
  sameDayAvailable?: boolean | null;
  timeZone?: string;
}): ServiceTimeResult {
  const now = input.now ?? new Date();
  const tz = input.timeZone ?? BUSINESS_TIMEZONE;
  const at = input.scheduledDate;
  const avail = input.availability ?? {};
  const fail = (reason: ServiceTimeReason, ctx: { leadMinutes?: number; maxDays?: number } = {}): ServiceTimeResult => ({
    ok: false,
    reason,
    message: SERVICE_TIME_MESSAGES[reason](ctx),
  });

  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return fail("INVALID_DATE");
  if (at.getTime() < now.getTime()) return fail("SLOT_IN_PAST");

  const leadMinutes = avail.minimumLeadTimeMinutes ?? 0;
  if (leadMinutes > 0 && at.getTime() < now.getTime() + leadMinutes * 60_000) return fail("LEAD_TIME_NOT_MET", { leadMinutes });

  const maxDays = avail.maximumAdvanceDays ?? DEFAULT_MAX_ADVANCE_DAYS;
  if (at.getTime() > now.getTime() + maxDays * 86_400_000) return fail("BEYOND_ADVANCE_WINDOW", { maxDays });

  const day = civilDate(at, tz);
  const sameDayAllowed = avail.sameDay ?? input.sameDayAvailable ?? undefined;
  if (sameDayAllowed === false && day === civilDate(now, tz)) return fail("SAME_DAY_UNAVAILABLE");

  if (avail.blackoutDates?.includes(day)) return fail("BLACKOUT_DATE");
  return { ok: true };
}
