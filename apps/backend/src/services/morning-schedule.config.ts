/**
 * When Morning Intelligence is allowed to run, and the deliberate fact that nobody has decided yet.
 *
 * ── Why this file exists at all ────────────────────────────────────────────────
 *
 * Every other automation in the platform is started by a business event: a payment failed, a booking
 * completed, a partner was activated. Morning Intelligence is the first capability whose trigger is
 * a *time of day*, and the discovery pass found that no such trigger exists anywhere — the event
 * catalog is business-event driven, and every job in `maintenance.ts` runs on a fixed interval
 * (`every N ms`) rather than at a wall-clock hour.
 *
 * So the hour a partner should be briefed is not a value this code can look up. It is a business
 * decision that has not been made, and this module's job is to hold that gap open honestly instead
 * of closing it with a plausible-looking number.
 *
 * ── The number that must not be borrowed ───────────────────────────────────────
 *
 * `governanceConfig.quietEndMinute` is 08:00 local, and it is the single most tempting value in the
 * codebase to reuse here. It must not be. Quiet hours answer "when does it stop being rude to
 * message someone?" — the earliest moment a message is *permitted*. A schedule answers "when is this
 * brief actually useful to a partner?" Those are different questions, and the first is a floor, not
 * an answer to the second. Briefing every partner at the exact instant the quiet window lifts would
 * be a decision nobody made, wearing the costume of a decision somebody made.
 *
 * `assertScheduleIsNotDerivedFromQuietHours` below exists so that confusion fails a test rather than
 * reaching a partner, and it is deliberately callable rather than a comment.
 *
 * ── Fail closed ────────────────────────────────────────────────────────────────
 *
 * `localTime: null` is the shipped state. Nothing may create a scheduled execution while it is null:
 * `isMorningScheduleApproved()` is the only permission-shaped question here, and it answers false
 * until a human sets a time. An unset schedule is not a bug to be worked around — it is the correct
 * state until the business answers.
 */

/** Local wall-clock time in a partner's own zone, `HH:MM` on a 24-hour clock. */
export type LocalTimeOfDay = `${number}${number}:${number}${number}`;

/**
 * How the local time is interpreted across partners.
 *
 * Only `recipient-local` is offered, and the type is a union of one on purpose. A single platform-
 * wide instant would brief a partner in a different zone at the wrong hour, and the notification
 * layer already resolves each recipient's own zone via `resolveRecipientTimeZone`. Naming the
 * strategy makes the choice reviewable rather than implicit.
 */
export type TimezoneStrategy = "recipient-local";

export type MorningScheduleConfig = {
  /**
   * Whether a scheduled morning execution may be created at all.
   *
   * Never `true` while `localTime` is null — enforced by `isMorningScheduleApproved`, not by trust.
   */
  readonly enabled: boolean;
  /** `null` means UNSET: no business decision exists. Not "use the default", because there is none. */
  readonly localTime: LocalTimeOfDay | null;
  readonly timezoneStrategy: TimezoneStrategy;
  /** Why the schedule is in the state it is in, for anything that reports status to a human. */
  readonly status: MorningScheduleStatus;
};

export const MORNING_SCHEDULE_STATUS = {
  /** No time has been chosen. The shipped state. */
  UNSET: "UNSET",
  /** A time exists and a human approved it. Only reachable by an explicit configuration change. */
  APPROVED: "APPROVED",
} as const;

export type MorningScheduleStatus =
  (typeof MORNING_SCHEDULE_STATUS)[keyof typeof MORNING_SCHEDULE_STATUS];

/**
 * The capability's own state, separate from the schedule's.
 *
 * Morning Intelligence is fully built and testable while unschedulable, so "can this assemble a
 * brief?" and "may this run on a timer?" have to be answerable independently. Collapsing them would
 * make the finished work look broken.
 */
export const MORNING_INTELLIGENCE_STATE = "DISABLED_UNTIL_SCHEDULE_APPROVED" as const;

/**
 * The shipped configuration.
 *
 * Deliberately not read from the environment. Every other config in this codebase takes an env
 * override because the value is a tuning knob with a known-good default; this one has no default to
 * fall back to, and an env var would let a deployment quietly invent the business decision that this
 * whole module exists to withhold. Changing it is a code change, reviewed like one.
 */
export const morningSchedule: MorningScheduleConfig = Object.freeze({
  enabled: false,
  localTime: null,
  timezoneStrategy: "recipient-local",
  status: MORNING_SCHEDULE_STATUS.UNSET,
});

/**
 * Whether a scheduled morning execution may be created.
 *
 * Both halves are required. `enabled` alone is not enough — a flag flipped without a time would
 * produce a schedule with nothing to schedule — and a `localTime` alone is not enough, because a
 * time written down is not the same as a time approved.
 */
export function isMorningScheduleApproved(
  config: MorningScheduleConfig = morningSchedule,
): boolean {
  return config.enabled && config.localTime !== null && config.status === "APPROVED";
}

export const MORNING_SCHEDULE_REFUSAL = "MORNING_SCHEDULE_UNSET" as const;

/**
 * Guard for anything that would create a scheduled execution.
 *
 * Returns a refusal reason rather than throwing, so a caller records why it did nothing instead of
 * turning an expected, correct state into an error somebody has to triage.
 */
export function morningScheduleRefusal(
  config: MorningScheduleConfig = morningSchedule,
): typeof MORNING_SCHEDULE_REFUSAL | null {
  return isMorningScheduleApproved(config) ? null : MORNING_SCHEDULE_REFUSAL;
}

/**
 * Refuses a schedule that merely echoes the quiet-hours boundary.
 *
 * Called by the test suite against the shipped config and against any future proposed one. If a
 * later change sets `localTime` to whatever `AUTOMATION_QUIET_END_MINUTE` happens to be, this says
 * so — because that specific mistake is indistinguishable from a real decision once it is written
 * down as `"08:00"`, and the whole point of this module is that it is not one.
 *
 * A genuine business decision that lands on the same clock time is still possible; it just has to be
 * recorded deliberately via `quietHoursCollisionAcknowledged`, which no code path sets on its own.
 */
export function assertScheduleIsNotDerivedFromQuietHours(args: {
  localTime: LocalTimeOfDay | null;
  quietEndMinute: number;
  quietHoursCollisionAcknowledged?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (args.localTime === null) return { ok: true };
  if (args.quietHoursCollisionAcknowledged === true) return { ok: true };

  const [hh, mm] = args.localTime.split(":");
  const minuteOfDay = Number(hh) * 60 + Number(mm);
  if (minuteOfDay === args.quietEndMinute) {
    return {
      ok: false,
      reason:
        `Morning schedule ${args.localTime} equals quiet-hours end ` +
        `(minute ${args.quietEndMinute}). Quiet-hours end is the earliest permitted contact time, ` +
        `not a business schedule. Set quietHoursCollisionAcknowledged only if a human genuinely ` +
        `chose this hour on its own merits.`,
    };
  }
  return { ok: true };
}
