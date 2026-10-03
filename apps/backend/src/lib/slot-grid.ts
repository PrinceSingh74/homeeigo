import { BUSINESS_TIMEZONE, civilDate } from "./service-availability";

/**
 * Wave 4 — the customer-facing slot grid.
 *
 * Owner-authorised policy, 2026-09-23:
 *   timezone                  Asia/Kolkata (the platform's business timezone)
 *   customer operating window 07:00–22:00
 *   slot grid                 30 minutes
 *   24×7                      only by explicit configuration
 *   midnight crossing         supported
 *   occupancy buffer (D1)     unchanged: [start − 30m, end + 30m)
 *
 * Pure: no database, no clock of its own beyond what the caller passes. It produces CANDIDATE
 * starts; whether a candidate is bookable is decided by the service rules, the partner's window and
 * real occupancy — never here. Keeping the grid separate is what stops "what times exist" and "what
 * times are free" from drifting apart, which is exactly how the client's hardcoded six chips ended up
 * offering slots the platform refuses.
 */

export const SLOT_GRID_MINUTES = 30;
/** The window a CUSTOMER may choose from. A partner's own working hours are a separate, narrower gate. */
export const OPERATING_WINDOW = { start: "07:00", end: "22:00" } as const;

export type OperatingWindow = { start: string; end: string };

export type SlotGridOptions = {
  /** YYYY-MM-DD in `timeZone`. */
  date: string;
  timeZone?: string;
  window?: OperatingWindow;
  stepMinutes?: number;
  /**
   * Explicit 24×7 operation. Off by default: a platform is not open around the clock because nobody
   * wrote down that it closes.
   */
  allDay?: boolean;
  /**
   * How long the appointment occupies. A slot is a candidate only if the appointment it would start
   * still ends inside the operating window — unless it legitimately crosses midnight (see below).
   */
  durationMinutes?: number;
  /**
   * Midnight crossing is supported: an appointment may run past 00:00 into the next day when the
   * operating window itself reaches the end of the day (24×7, or a window ending at 23:59/24:00).
   * Under an ordinary 07:00–22:00 window a job that would run past closing is not offered.
   */
  allowMidnightCrossing?: boolean;
};

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOf(hm: string): number {
  const m = HM.exec(hm.trim());
  if (!m) throw new Error(`slot grid: "${hm}" is not HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** The UTC instant of `date` at `minutes` past midnight in `timeZone`. */
export function instantAt(date: string, minutes: number, timeZone: string = BUSINESS_TIMEZONE): Date {
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  // Asia/Kolkata has no DST and a fixed +05:30 offset, which is why a literal offset is exact here.
  // Any other zone goes through the generic path below.
  if (timeZone === "Asia/Kolkata") return new Date(`${date}T${hh}:${mm}:00+05:30`);
  const guess = new Date(`${date}T${hh}:${mm}:00Z`);
  // Correct the guess by the zone's offset at that instant.
  const asSeen = new Date(guess.toLocaleString("en-US", { timeZone }));
  const asUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() + (asUtc.getTime() - asSeen.getTime()));
}

/**
 * Candidate slot starts for one civil day.
 *
 * With `allDay`, the grid spans the whole day. Otherwise it spans the operating window, and a slot is
 * dropped when the appointment it would start runs past the window's close — the customer is never
 * offered a start the platform cannot finish.
 */
export function buildSlotGrid(opts: SlotGridOptions): Date[] {
  const tz = opts.timeZone ?? BUSINESS_TIMEZONE;
  const step = Math.max(1, Math.round(opts.stepMinutes ?? SLOT_GRID_MINUTES));
  const duration = Math.max(0, Math.round(opts.durationMinutes ?? 0));
  const window = opts.window ?? OPERATING_WINDOW;

  const open = opts.allDay ? 0 : minutesOf(window.start);
  const close = opts.allDay ? 24 * 60 : minutesOf(window.end);
  if (close <= open) throw new Error(`slot grid: window ${window.start}–${window.end} does not describe a day`);

  // A window that reaches the end of the day is what makes crossing midnight meaningful.
  const reachesEndOfDay = opts.allDay || close >= 24 * 60 - 1;
  const mayCross = (opts.allowMidnightCrossing ?? true) && reachesEndOfDay;

  const out: Date[] = [];
  for (let m = open; m < close; m += step) {
    if (!mayCross && m + duration > close) break;
    out.push(instantAt(opts.date, m, tz));
  }
  return out;
}

/** The civil day a slot belongs to, for grouping an availability response. */
export function slotDay(instant: Date, timeZone: string = BUSINESS_TIMEZONE): string {
  return civilDate(instant, timeZone);
}
