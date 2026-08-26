/**
 * Partner operational clock — working days/hours/breaks in the partner timezone.
 * Canonical for matching, booking validation, and the capacity engine.
 * Overnight windows are rejected (existing business model is same-day start < end).
 */

export const DEFAULT_PARTNER_TZ = "Asia/Kolkata";
export const WEEKDAY_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export const WEEKDAY_LONG = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
export const WEEKDAY_DISPLAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const TIME_HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type BreakWindow = { start: string; end: string };

export type ScheduleInput = {
  workingDays: string[];
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  /**
   * Accepts raw JSON as stored by Prisma, not just a parsed array. Both consumers immediately run
   * it through `parseBreakWindows(raw: unknown)`, which validates every entry (shape, HH:MM format,
   * start < end) and discards anything malformed — so a `Prisma.JsonValue` straight off
   * `provider.breakWindows` is handled safely. The previous `BreakWindow[] | null` was narrower
   * than the implementation and forced callers to either cast or mis-declare their input.
   */
  breakWindows?: BreakWindow[] | unknown;
  timezone?: string | null;
};

export function parseHmToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = TIME_HM_RE.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isValidHm(value: string): boolean {
  return TIME_HM_RE.test(value.trim());
}

export function assertStartBeforeEnd(start: string, end: string, label = "Hours"): string | null {
  const a = parseHmToMinutes(start);
  const b = parseHmToMinutes(end);
  if (a === null || b === null) return `${label} must use HH:MM`;
  if (a >= b) return `${label}: start must be before end`;
  return null;
}

export function parseBreakWindows(raw: unknown): BreakWindow[] {
  if (!Array.isArray(raw)) return [];
  const out: BreakWindow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const start = String((item as { start?: unknown }).start ?? "").trim();
    const end = String((item as { end?: unknown }).end ?? "").trim();
    if (!isValidHm(start) || !isValidHm(end)) continue;
    if (parseHmToMinutes(start)! >= parseHmToMinutes(end)!) continue;
    out.push({ start, end });
  }
  return out.slice(0, 4);
}

function tzOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const asUtc = Date.UTC(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute")),
    Number(get("second")),
  );
  return asUtc - date.getTime();
}

/** Inclusive start / exclusive end of the calendar day in the partner timezone. */
export function zonedDayBounds(timeZone: string, at = new Date()): { start: Date; end: Date } {
  const tz = timeZone || DEFAULT_PARTNER_TZ;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let start = new Date(utcGuess - tzOffsetMs(tz, new Date(utcGuess)));
  start = new Date(utcGuess - tzOffsetMs(tz, start));
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function zonedClock(
  date: Date,
  timeZone = DEFAULT_PARTNER_TZ,
): { dayIndex: number; minutes: number; weekdayShort: string } {
  const tz = timeZone || DEFAULT_PARTNER_TZ;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekday = (parts.find((p) => p.type === "weekday")?.value ?? "sun").toLowerCase().slice(0, 3);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const dayIndex = WEEKDAY_SHORT.indexOf(weekday as (typeof WEEKDAY_SHORT)[number]);
  return {
    dayIndex: dayIndex >= 0 ? dayIndex : date.getUTCDay(),
    minutes: hour * 60 + minute,
    weekdayShort: weekday,
  };
}

export function matchesWorkingDay(workingDays: string[], dayIndex: number): boolean {
  if (!workingDays.length) return true;
  const short = WEEKDAY_SHORT[dayIndex];
  const long = WEEKDAY_LONG[dayIndex];
  const display = WEEKDAY_DISPLAY[dayIndex];
  return workingDays.some((d) => {
    const norm = d.trim().toLowerCase();
    return (
      norm === String(dayIndex) ||
      norm === short ||
      norm === long ||
      norm === display?.toLowerCase()
    );
  });
}

export function isWithinWorkingWindow(schedule: ScheduleInput, at: Date): boolean {
  const tz = schedule.timezone || DEFAULT_PARTNER_TZ;
  const clock = zonedClock(at, tz);
  if (!matchesWorkingDay(schedule.workingDays, clock.dayIndex)) return false;
  const start = parseHmToMinutes(schedule.workingHoursStart);
  const end = parseHmToMinutes(schedule.workingHoursEnd);
  if (start === null || end === null) return true;
  return clock.minutes >= start && clock.minutes <= end;
}

export function isInBreakWindow(schedule: ScheduleInput, at: Date): boolean {
  const breaks = parseBreakWindows(schedule.breakWindows ?? []);
  if (breaks.length === 0) return false;
  const clock = zonedClock(at, schedule.timezone || DEFAULT_PARTNER_TZ);
  return breaks.some((b) => {
    const start = parseHmToMinutes(b.start);
    const end = parseHmToMinutes(b.end);
    if (start === null || end === null) return false;
    return clock.minutes >= start && clock.minutes < end;
  });
}

/** Next instant the partner could take a new offer, or null if unknown. */
export function computeNextAvailableAt(
  schedule: ScheduleInput,
  at: Date,
  opts: { availableNow: boolean; breakActive: boolean; outsideHours: boolean },
): Date | null {
  if (opts.availableNow) return at;
  const tz = schedule.timezone || DEFAULT_PARTNER_TZ;
  const clock = zonedClock(at, tz);
  if (opts.breakActive) {
    const breaks = parseBreakWindows(schedule.breakWindows ?? []);
    for (const b of breaks) {
      const start = parseHmToMinutes(b.start);
      const end = parseHmToMinutes(b.end);
      if (start === null || end === null) continue;
      if (clock.minutes >= start && clock.minutes < end) {
        const deltaMin = end - clock.minutes;
        return new Date(at.getTime() + deltaMin * 60_000);
      }
    }
  }
  if (opts.outsideHours) {
    const start = parseHmToMinutes(schedule.workingHoursStart);
    if (start === null) return null;
    const deltaMin = start > clock.minutes ? start - clock.minutes : 24 * 60 - clock.minutes + start;
    const candidate = new Date(at.getTime() + deltaMin * 60_000);
    // Walk forward up to 7 days to land on a working day.
    for (let i = 0; i < 8; i++) {
      const probe = new Date(candidate.getTime() + i * 24 * 60 * 60 * 1000);
      if (isWithinWorkingWindow(schedule, probe) && !isInBreakWindow(schedule, probe)) return probe;
    }
  }
  return null;
}

export function normalizeWorkingDays(days: string[]): string[] {
  const allowed = new Set<string>([
    ...WEEKDAY_DISPLAY,
    ...WEEKDAY_SHORT.map((d) => d[0]!.toUpperCase() + d.slice(1)),
  ]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of days) {
    const trimmed = raw.trim();
    const lower = trimmed.toLowerCase();
    const idx =
      WEEKDAY_SHORT.indexOf(lower as (typeof WEEKDAY_SHORT)[number]) >= 0
        ? WEEKDAY_SHORT.indexOf(lower as (typeof WEEKDAY_SHORT)[number])
        : WEEKDAY_LONG.indexOf(lower as (typeof WEEKDAY_LONG)[number]);
    const canonical = idx >= 0 ? WEEKDAY_DISPLAY[idx]! : allowed.has(trimmed) ? trimmed : null;
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}
