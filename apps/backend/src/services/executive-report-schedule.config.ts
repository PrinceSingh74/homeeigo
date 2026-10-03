/**
 * When scheduled executive reports are allowed to run, and the deliberate fact that nobody has
 * decided yet.
 *
 * ── What discovery actually found ──────────────────────────────────────────────
 *
 * The platform has one canonical scheduler (`ScheduledJob` + `runScheduledJobTick` + the leader
 * lock) and one canonical executive report generator (`executiveReportingService`). Neither is
 * missing. What is missing is a *schedule*: there is no recurring executive report anywhere in the
 * codebase, no cron entry, no `ScheduledJob` row of that type, and nothing in `maintenance.ts` that
 * runs at a wall-clock hour. Every existing job runs on a fixed interval or in response to a
 * business event.
 *
 * So this file does not choose a time. It records that three separate business decisions are
 * outstanding and refuses to manufacture any of them.
 *
 * ── Three decisions, not one ───────────────────────────────────────────────────
 *
 * `REPORT_SCHEDULE` — the wall-clock time. `RECURRENCE` — daily, weekly, or something else.
 * `TIMEZONE` — whose clock, given that the recipients are administrators rather than customers.
 * They are genuinely independent: "weekly" without an hour schedules nothing, an hour without a
 * recurrence schedules everything, and both without a zone schedule the wrong moment for anyone not
 * sitting in the server's region.
 *
 * ── Values that must not be borrowed ───────────────────────────────────────────
 *
 * Two numbers nearby are tempting and both are wrong to reuse. `governanceConfig.quietEndMinute`
 * (08:00) answers "when does it stop being rude to message someone?" — a floor on permission, not a
 * business schedule. And `morningSchedule` (Item 6, partner-facing) is a different capability for a
 * different audience that is *itself* still UNSET; copying an unmade decision does not make it made.
 * `assertScheduleIsNotBorrowed` turns both mistakes into a test failure rather than a delivery.
 *
 * ── Fail closed ────────────────────────────────────────────────────────────────
 *
 * `localTime: null` and `recurrence: null` are the shipped state. Nothing may create a
 * `ScheduledJob` while either is null. An unset schedule is not a bug to be worked around — it is
 * the correct state until the business answers, and the report itself is fully buildable and
 * testable in the meantime.
 */

/** Local wall-clock time, `HH:MM` on a 24-hour clock. */
export type LocalTimeOfDay = `${number}${number}:${number}${number}`;

/**
 * How often the report recurs.
 *
 * Constrained to periods `executiveReportingService.periodToDays` already supports, because a
 * recurrence the report generator cannot produce is not a schedule, it is a wish. `null` is UNSET.
 */
export type ReportRecurrence = "daily" | "weekly" | "monthly";

/**
 * Whose clock the time is read in.
 *
 * `recipient-local` mirrors the notification layer, which already resolves each recipient's zone via
 * `resolveRecipientTimeZone`. `platform-fixed` would send every administrator the same instant.
 * Neither is selected here; naming both makes the outstanding decision reviewable instead of
 * implicit.
 */
export type ReportTimezoneStrategy = "recipient-local" | "platform-fixed";

export const REPORT_SCHEDULE_STATUS = {
  /** No time, recurrence or zone has been chosen. The shipped state. */
  UNSET: "UNSET",
  /** All three exist and a human approved them. Reachable only by an explicit code change. */
  APPROVED: "APPROVED",
} as const;

export type ReportScheduleStatus =
  (typeof REPORT_SCHEDULE_STATUS)[keyof typeof REPORT_SCHEDULE_STATUS];

export type ExecutiveReportScheduleConfig = {
  /** Never `true` while any of the three decisions is null — enforced below, not by trust. */
  readonly enabled: boolean;
  /** `null` means UNSET. Not "use the default", because there is no default. */
  readonly localTime: LocalTimeOfDay | null;
  readonly recurrence: ReportRecurrence | null;
  readonly timezoneStrategy: ReportTimezoneStrategy | null;
  readonly status: ReportScheduleStatus;
};

/** The capability's own state, separate from the schedule's. The report builds; it just cannot recur. */
export const SCHEDULED_EXECUTIVE_REPORTS_STATE = "DISABLED_UNTIL_SCHEDULE_APPROVED" as const;

/** The exact decisions a human owes, named so they can be tracked rather than rediscovered. */
export const REPORT_HUMAN_DECISIONS = [
  "EXECUTIVE_REPORT_SCHEDULE_HUMAN_DECISION_REQUIRED",
  "EXECUTIVE_REPORT_RECURRENCE_HUMAN_DECISION_REQUIRED",
  "EXECUTIVE_REPORT_TIMEZONE_HUMAN_DECISION_REQUIRED",
] as const;

/**
 * The shipped configuration.
 *
 * Deliberately not read from the environment, for the same reason as the morning schedule: an env
 * var would let a deployment quietly invent the business decision this module exists to withhold.
 */
export const executiveReportSchedule: ExecutiveReportScheduleConfig = Object.freeze({
  enabled: false,
  localTime: null,
  recurrence: null,
  timezoneStrategy: null,
  status: REPORT_SCHEDULE_STATUS.UNSET,
});

/** Whether a scheduled executive report may be created. All conditions, or none. */
export function isReportScheduleApproved(
  config: ExecutiveReportScheduleConfig = executiveReportSchedule,
): boolean {
  return (
    config.enabled &&
    config.localTime !== null &&
    config.recurrence !== null &&
    config.timezoneStrategy !== null &&
    config.status === REPORT_SCHEDULE_STATUS.APPROVED
  );
}

export const REPORT_SCHEDULE_REFUSAL = "EXECUTIVE_REPORT_SCHEDULE_UNSET" as const;

/**
 * Guard for anything that would create a `ScheduledJob`.
 *
 * Returns a refusal reason rather than throwing, so a caller records why it did nothing instead of
 * turning an expected, correct state into an error somebody has to triage.
 */
export function reportScheduleRefusal(
  config: ExecutiveReportScheduleConfig = executiveReportSchedule,
): typeof REPORT_SCHEDULE_REFUSAL | null {
  return isReportScheduleApproved(config) ? null : REPORT_SCHEDULE_REFUSAL;
}

/**
 * Refuses a schedule that merely echoes a nearby number instead of stating a decision.
 *
 * Callable rather than a comment, and asserted by test against the shipped config and against any
 * future proposed one. A genuine business decision that happens to land on one of these times is
 * still possible; it just has to be recorded deliberately via `collisionAcknowledged`, which no code
 * path sets on its own.
 */
export function assertScheduleIsNotBorrowed(args: {
  localTime: LocalTimeOfDay | null;
  quietEndMinute: number;
  partnerMorningLocalTime: LocalTimeOfDay | null;
  collisionAcknowledged?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (args.localTime === null) return { ok: true };
  if (args.collisionAcknowledged === true) return { ok: true };

  const minuteOf = (t: LocalTimeOfDay) => {
    const [hh, mm] = t.split(":");
    return Number(hh) * 60 + Number(mm);
  };
  const chosen = minuteOf(args.localTime);

  if (chosen === args.quietEndMinute) {
    return {
      ok: false,
      reason:
        `Executive report schedule ${args.localTime} equals quiet-hours end (minute ` +
        `${args.quietEndMinute}). Quiet-hours end is the earliest permitted contact time, not a ` +
        `business schedule.`,
    };
  }
  if (args.partnerMorningLocalTime !== null && chosen === minuteOf(args.partnerMorningLocalTime)) {
    return {
      ok: false,
      reason:
        `Executive report schedule ${args.localTime} equals the partner morning schedule. That is a ` +
        `different capability for a different audience; matching it is a coincidence, not a decision.`,
    };
  }
  return { ok: true };
}
