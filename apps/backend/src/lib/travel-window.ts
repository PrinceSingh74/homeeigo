/**
 * X-59 — when a GPS ping may put an accepted job "on the way". Owner decision, 2026-09-29.
 *
 * Before this, any location ping on an ACCEPTED / ASSIGNED job committed EN_ROUTE, and the partner app
 * publishes GPS as soon as a job screen opens — so a job booked days ahead told the customer the
 * professional was on the way. Policy:
 *   - a GPS ping may start travel only from GPS_TRAVEL_WINDOW_MINUTES before the scheduled start;
 *   - after the start it still may, while the job is live (non-terminal, still this partner's);
 *   - the explicit "On my way" action is not governed by this window;
 *   - an unset or invalid setting fails CLOSED: GPS then never changes travel state.
 * The canonical value lives here (versioned with the code); `GPS_TRAVEL_WINDOW_MINUTES` in the process
 * environment overrides it for an environment, and anything that is not a positive number disables it.
 */
export const GPS_TRAVEL_WINDOW_MINUTES = 60;

/** The window in minutes, or null (closed) when the environment sets it to anything but a positive number. */
export function gpsTravelWindowMinutes(env: Record<string, string | undefined> = process.env): number | null {
  const raw = env.GPS_TRAVEL_WINDOW_MINUTES;
  if (raw === undefined) return GPS_TRAVEL_WINDOW_MINUTES;
  const n = Number(raw.trim());
  return raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

/** True when a GPS ping at `now` may start travel for a job scheduled at `scheduledStart`. */
export function gpsTravelWindowOpen(scheduledStart: Date, now: Date, windowMinutes: number | null): boolean {
  if (windowMinutes === null) return false;
  const start = scheduledStart.getTime();
  if (!Number.isFinite(start)) return false;
  return now.getTime() >= start - windowMinutes * 60_000;
}
