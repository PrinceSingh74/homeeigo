/**
 * The customer's six-stage progress rail for one booking:
 *   Arrival → Start check → Service started → Work in progress → Quality check → Completed / Confirmed
 *
 * Pure derivation from what the API returns — GET /api/bookings/:id (status + the four lifecycle
 * timestamps), /start-pin, /execution and /completion. A stage carries a time only when the server
 * recorded one; nothing here reads the clock, and a stage the server holds no record of is reported
 * as "skipped" rather than ticked.
 *
 * Mirrored in homigo-mobile/src/lib/booking-progress.ts — change both together.
 */

export type ProgressStageId = "arrival" | "start_check" | "service_started" | "work" | "quality_check" | "completion";

/**
 * done        the server recorded it
 * current     where the visit is now
 * attention   needs the customer's eye (an issue was reported)
 * upcoming    not reached yet
 * skipped     the visit moved past it and the server holds no record of it
 * not_reached the booking ended (cancelled, expired, no-show) before this stage
 */
export type ProgressStageState = "done" | "current" | "attention" | "upcoming" | "skipped" | "not_reached";

export type ProgressStage = {
  id: ProgressStageId;
  label: string;
  state: ProgressStageState;
  /** When the server recorded this stage. null = no timestamp was returned; show none. */
  at: string | null;
  /** A server deadline attached to the stage (the auto-confirm time), never a guess. */
  dueAt: string | null;
  detail: string | null;
};

export type BookingEnd = "cancelled" | "expired" | "customer_no_show" | "provider_no_show";

export type BookingProgress = { stages: ProgressStage[]; ended: BookingEnd | null };

type Stamp = string | Date | null | undefined;

export type BookingProgressInput = {
  /** GET /api/bookings/:id */
  booking: { status?: string | null; enRouteAt?: Stamp; arrivedAt?: Stamp; startedAt?: Stamp; completedAt?: Stamp } | null | undefined;
  /** GET /api/bookings/:id/start-pin */
  startPin?: { state: string; verifiedAt: string | null } | null;
  /** GET /api/bookings/:id/execution */
  execution?: { enforced: boolean; steps: Array<{ state: string }> } | null;
  /** GET /api/bookings/:id/completion */
  completion?: {
    completion: { state: string; confirmBy: string; resolvedAt: string | null } | null;
    verdict: { label: string; at: string } | null;
  } | null;
};

function stamp(v: Stamp): string | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return v;
}

function endOf(status: string): BookingEnd | null {
  if (status === "expired") return "expired";
  if (status === "customer_no_show") return "customer_no_show";
  if (status === "provider_no_show") return "provider_no_show";
  if (status === "rejected" || status.includes("cancel")) return "cancelled";
  return null;
}

export function deriveBookingProgress(input: BookingProgressInput): BookingProgress {
  const b = input.booking ?? {};
  const status = String(b.status ?? "").toLowerCase().replace(/-/g, "_");
  const ended = endOf(status);

  const enRouteAt = stamp(b.enRouteAt);
  const arrivedAt = stamp(b.arrivedAt);
  const startedAt = stamp(b.startedAt);
  const completedAt = stamp(b.completedAt);

  const completed = status === "completed";
  const started = completed || status === "in_progress" || !!startedAt;
  const arrived = started || !!arrivedAt;
  const enRoute = status === "en_route" || !!enRouteAt;

  /** A stage that has not happened: where the visit is, still ahead, or never reached. */
  const open = (isCurrent: boolean): ProgressStageState => (ended ? "not_reached" : isCurrent ? "current" : "upcoming");
  const stage = (id: ProgressStageId, label: string, state: ProgressStageState, extra: Partial<ProgressStage> = {}): ProgressStage => ({
    id, label, state, at: null, dueAt: null, detail: null, ...extra,
  });

  const stages: ProgressStage[] = [];

  // 1. Arrival
  if (arrived) {
    stages.push(stage("arrival", "Arrived", "done", { at: arrivedAt }));
  } else {
    const state = open(enRoute);
    stages.push(stage("arrival", "Arrival", state, { detail: state === "current" ? "Your professional is on the way." : null }));
  }

  // 2. Start check (PIN)
  const pin = input.startPin ?? null;
  if (pin?.verifiedAt) {
    stages.push(stage("start_check", "Start PIN confirmed", "done", { at: pin.verifiedAt }));
  } else if (started) {
    // The job began and the server reports no verified PIN — say so instead of ticking it.
    stages.push(stage("start_check", "Start check (PIN)", "skipped", { detail: pin ? "A start PIN was not used on this visit." : null }));
  } else {
    const state = open(arrived);
    stages.push(
      stage("start_check", "Start check (PIN)", state, {
        detail: state === "current" && pin?.state === "active" ? "Your start PIN is ready — share it in person." : null,
      }),
    );
  }

  // 3. Service started
  stages.push(started ? stage("service_started", "Service started", "done", { at: startedAt }) : stage("service_started", "Service started", open(false)));

  // 4. Work in progress
  const steps = input.execution?.enforced ? input.execution.steps : [];
  const stepsDone = steps.filter((s) => s.state === "COMPLETED").length;
  const stepDetail = steps.length > 0 ? `${stepsDone} of ${steps.length} steps done` : null;
  if (completed) {
    stages.push(stage("work", "Work finished", "done", { at: completedAt, detail: stepDetail }));
  } else {
    const state = open(started);
    stages.push(stage("work", "Work in progress", state, { detail: started ? stepDetail : null }));
  }

  // 5. Quality check
  const verdict = input.completion?.verdict ?? null;
  if (verdict) {
    stages.push(stage("quality_check", "Quality check", "done", { at: verdict.at, detail: verdict.label }));
  } else if (completed) {
    stages.push(stage("quality_check", "Quality check", "skipped"));
  } else {
    stages.push(stage("quality_check", "Quality check", open(false)));
  }

  // 6. Completed / Confirmed
  const c = input.completion?.completion ?? null;
  if (c?.state === "CONFIRMED") {
    stages.push(stage("completion", "Confirmed by you", "done", { at: c.resolvedAt }));
  } else if (c?.state === "AUTO_CONFIRMED") {
    stages.push(stage("completion", "Confirmed automatically", "done", { at: c.resolvedAt }));
  } else if (c?.state === "ISSUE_REPORTED") {
    stages.push(stage("completion", "Issue reported", "attention", { at: c.resolvedAt, detail: "Our team is reviewing your report." }));
  } else if (c?.state === "PENDING_CUSTOMER") {
    stages.push(stage("completion", "Waiting for your confirmation", ended ? "not_reached" : "current", { dueAt: c.confirmBy }));
  } else if (completed) {
    stages.push(stage("completion", "Completed", "done", { at: completedAt }));
  } else {
    stages.push(stage("completion", "Completed", open(false)));
  }

  return { stages, ended };
}

/** One plain word per state, so the rail never relies on colour or an icon alone. */
export const PROGRESS_STATE_WORD: Record<ProgressStageState, string> = {
  done: "Done",
  current: "Now",
  attention: "Needs attention",
  upcoming: "Up next",
  skipped: "Not recorded",
  not_reached: "Not reached",
};

export const BOOKING_END_NOTE: Record<BookingEnd, string> = {
  cancelled: "This booking was cancelled.",
  expired: "This booking expired before payment was completed.",
  customer_no_show: "This visit did not go ahead.",
  provider_no_show: "The professional did not arrive for this visit.",
};
