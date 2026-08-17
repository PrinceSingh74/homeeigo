import prisma from "../../lib/prisma";
import type { RecipientType } from "../types";

/**
 * Where a recipient's day starts and ends.
 *
 * Cadence and quiet hours are both statements about the recipient's own clock, so every boundary
 * in Phase 6C is computed here and nowhere else. Two rules follow from that:
 *
 *   - the zone comes from the recipient's stored profile, never from the request. A caller that
 *     could name its own timezone could name one where it is permanently 09:00 and walk straight
 *     through quiet hours;
 *   - the arithmetic is done with `Intl`, never by adding 5.5 hours to a UTC timestamp. Manual
 *     offsets are correct for India today and wrong the moment a zone with DST is added, and the
 *     bug that produces is invisible until the clocks change.
 */

const DEFAULT_ZONE = "Asia/Kolkata";

/** Zones already proven usable by this runtime, so the validity probe runs once per zone. */
const validated = new Map<string, boolean>();

/**
 * A fixed UTC offset, in any of the forms `Intl` will accept: `+0530`, `+05:30`, `-08`.
 *
 * These have to be rejected explicitly, because `Intl.DateTimeFormat` accepts them quite happily
 * and they look like they work. An offset cannot express a daylight-saving change: a recipient
 * stored as `+01:00` would keep a British quiet window an hour out for half of every year, and the
 * symptom — messages an hour early each summer — is the kind of thing nobody traces back to a
 * timezone field. A zone is a place, not an arithmetic constant.
 */
const OFFSET_SHAPED = /^[+-]\d{2}(:?\d{2})?$/;

/**
 * Whether the runtime can resolve this zone *and* it is a real named zone.
 *
 * Letting `DateTimeFormat` throw is the only reliable availability check — matching against a
 * hand-maintained list drifts out of date and silently accepts names the runtime cannot use — but
 * availability alone is not enough, hence the offset rejection above.
 */
export function isValidTimeZone(zone: string): boolean {
  const cached = validated.get(zone);
  if (cached !== undefined) return cached;

  let ok = false;
  if (zone && !OFFSET_SHAPED.test(zone)) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: zone });
      ok = true;
    } catch {
      ok = false;
    }
  }
  validated.set(zone, ok);
  return ok;
}

/**
 * The zone to judge this recipient by.
 *
 * PARTNER ids name a provider, so the person behind it is resolved first — a partner's day is
 * their own, not the company's. Anything unresolvable or invalid falls back to the platform
 * default rather than failing: a missing profile field is not a reason to lose a notification,
 * and the default is the correct zone for every current recipient.
 */
export async function resolveRecipientTimeZone(
  recipientType: RecipientType,
  recipientId: string,
): Promise<{ timezone: string; source: "PROFILE" | "DEFAULT" }> {
  let userId: string | null = recipientId;

  if (recipientType === "PARTNER") {
    const provider = await prisma.provider.findUnique({
      where: { id: recipientId },
      select: { userId: true },
    });
    userId = provider?.userId ?? null;
  }

  if (!userId) return { timezone: DEFAULT_ZONE, source: "DEFAULT" };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });

  const stored = user?.timezone?.trim();
  if (stored && isValidTimeZone(stored)) return { timezone: stored, source: "PROFILE" };

  return { timezone: DEFAULT_ZONE, source: "DEFAULT" };
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** The wall-clock reading an observer in `zone` would see at `instant`. */
function wallClock(instant: Date, zone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return {
    year: Number(out.year), month: Number(out.month), day: Number(out.day),
    hour: Number(out.hour), minute: Number(out.minute), second: Number(out.second),
  };
}

/**
 * The recipient's calendar day, as the `YYYY-MM-DD` text the cadence window is keyed by.
 *
 * The window runs `[00:00:00.000, 24:00:00.000)` in `zone`: a notification at 23:59:59.999 local
 * belongs to the day that is ending, and one at 00:00:00.000 local belongs to the day beginning.
 */
export function windowDateFor(instant: Date, zone: string): string {
  const { year, month, day } = wallClock(instant, zone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Minutes past local midnight — the form both quiet-hour boundaries are compared in. */
export function minutesIntoLocalDay(instant: Date, zone: string): number {
  const { hour, minute } = wallClock(instant, zone);
  return hour * 60 + minute;
}

/** Local wall-clock reading, exposed for boundary assertions and audit text. */
export function localTimeParts(instant: Date, zone: string): Parts {
  return wallClock(instant, zone);
}

/**
 * The instant at which a given local wall-clock time next occurs at or after `from`.
 *
 * Used to answer "when does the quiet window end". Rather than constructing a local timestamp and
 * converting — which has no correct single answer across a DST gap — this walks forward in whole
 * minutes from the current local minute, so the result is always a real instant that genuinely
 * reads as the requested time in that zone.
 */
export function nextLocalTime(from: Date, zone: string, targetHour: number, targetMinute: number): Date {
  const target = targetHour * 60 + targetMinute;
  const nowMinutes = minutesIntoLocalDay(from, zone);
  // Zero the seconds so the result lands exactly on the boundary minute rather than inside it.
  const { second } = wallClock(from, zone);
  const base = new Date(from.getTime() - second * 1000 - from.getMilliseconds());

  let delta = target - nowMinutes;
  if (delta <= 0) delta += 24 * 60;

  let candidate = new Date(base.getTime() + delta * 60_000);

  /**
   * A zone that shifted its offset in between would land us a minute or two off the intended
   * wall-clock time. Correcting by the observed difference re-anchors it; two passes is enough for
   * any real transition, and the loop stops as soon as the reading is exact.
   */
  for (let i = 0; i < 2; i++) {
    const drift = minutesIntoLocalDay(candidate, zone) - target;
    if (drift === 0) break;
    candidate = new Date(candidate.getTime() - drift * 60_000);
  }
  return candidate;
}

export const CADENCE_DEFAULT_TIMEZONE = DEFAULT_ZONE;
