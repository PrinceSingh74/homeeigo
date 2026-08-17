import { governanceConfig } from "./policy";
import {
  isValidTimeZone, minutesIntoLocalDay, nextLocalTime, localTimeParts,
  resolveRecipientTimeZone, CADENCE_DEFAULT_TIMEZONE,
} from "./timezone";
import type { RecipientType } from "../types";

/**
 * Whether it is a reasonable hour to message this person.
 *
 * The window is expressed in the recipient's own local time and crosses midnight by default —
 * 21:00 to 08:00 — so membership cannot be a simple range comparison. Every reading here comes
 * from the validated timezone helpers rather than from offset arithmetic, for the reason set out
 * there: a fixed offset is right in India and wrong the first time a zone with daylight saving is
 * added, and the resulting hour of drift is invisible until someone complains.
 *
 * Quiet hours defer; they do not suppress. A message that should not arrive at 23:15 is still a
 * message someone intended to send, and the right outcome is to hold it until the morning rather
 * than to lose it. What that deferral costs the workflow — and whether the workflow can survive
 * long enough to be woken — is settled by the step executor, not here.
 */

export type QuietHoursDecision = {
  /** True when the moment falls inside the quiet window. */
  inQuietHours: boolean;
  /** The first moment the recipient may be contacted again. Only meaningful when deferring. */
  nextAllowedAt: Date | null;
  timezone: string;
  /** Set when the supplied zone was unusable and the platform default was applied instead. */
  timezoneFallback: boolean;
  /** Local wall-clock reading, so an audit can show why rather than only what. */
  localTime: string;
  localMinute: number;
};

function formatLocal(at: Date, zone: string): string {
  const { hour, minute, second } = localTimeParts(at, zone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/**
 * Quiet-hours membership for a given moment in a given zone.
 *
 * ── Boundaries ────────────────────────────────────────────────────────────────
 *
 * The window is `[start, end)` in local minutes: 21:00:00 is inside it and 08:00:00 is not. A
 * recipient contacted at 20:59:59 is contacted during the evening; one minute later the evening is
 * over. Seconds are deliberately not part of the comparison — the window turns on the minute, so
 * 21:00:59 is as much inside it as 21:00:00.
 *
 * ── An unusable zone ──────────────────────────────────────────────────────────
 *
 * Falls back to the platform default rather than refusing to answer. Refusing would be the more
 * obviously "closed" behaviour, but it produces a notification that can never be scheduled and
 * never resolves — an unbounded deferral is a lost message with extra steps. Applying a real
 * window in the platform's own zone is both defined and conservative, and it is flagged so the
 * fallback is never mistaken for a resolved preference. In practice this branch guards direct
 * callers only: `resolveRecipientTimeZone` already returns a validated zone.
 */
export function evaluateQuietHoursIn(at: Date, timezone: string): QuietHoursDecision {
  const usable = isValidTimeZone(timezone);
  const zone = usable ? timezone : CADENCE_DEFAULT_TIMEZONE;

  const minute = minutesIntoLocalDay(at, zone);
  const start = governanceConfig.quietStartMinute;
  const end = governanceConfig.quietEndMinute;

  // A window that wraps past midnight is two ranges; one that does not is a single range.
  const inWindow = start > end ? minute >= start || minute < end : minute >= start && minute < end;

  const base = {
    timezone: zone,
    timezoneFallback: !usable,
    localTime: formatLocal(at, zone),
    localMinute: minute,
  };

  if (!inWindow) return { ...base, inQuietHours: false, nextAllowedAt: null };

  return {
    ...base,
    inQuietHours: true,
    nextAllowedAt: nextLocalTime(at, zone, Math.floor(end / 60), end % 60),
  };
}

/** The same question, answered for a recipient whose zone is read from their own profile. */
export async function evaluateQuietHours(
  recipientType: RecipientType,
  recipientId: string,
  at: Date = new Date(),
): Promise<QuietHoursDecision> {
  const { timezone } = await resolveRecipientTimeZone(recipientType, recipientId);
  return evaluateQuietHoursIn(at, timezone);
}

/**
 * The longest a quiet-hours deferral can ever hold a notification.
 *
 * A workflow that may be deferred has to outlive its own quiet window, so this is the figure its
 * `maxAgeMs` is checked against at registration. Measured from the first minute of the window to
 * its end, plus the day it may already have spent waiting to reach the notification step.
 */
export function maxQuietDeferralMs(): number {
  const start = governanceConfig.quietStartMinute;
  const end = governanceConfig.quietEndMinute;
  const spanMinutes = start > end ? 24 * 60 - start + end : end - start;
  return spanMinutes * 60_000;
}
