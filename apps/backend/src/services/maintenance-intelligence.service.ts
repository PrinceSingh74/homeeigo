import prisma from "../lib/prisma";
import { ServiceIntervalStatus, ServiceIntervalUnit } from "@prisma/client";
import { resolveRecipientTimeZone } from "../notifications/governance/timezone";

/**
 * When a service a customer already bought is next expected.
 *
 * ── Rules decide, and only from a signed interval ────────────────────────────
 *
 * Two facts produce a due date: when the customer last completed the service, and how often that
 * service is declared to recur. The first is observed — `bookings.completed_at`, populated for every
 * completed row. The second cannot be observed at all in this platform and is never inferred here.
 *
 * The discovery that led to this file measured 87 repeat gaps across 125 completed bookings: 61% of
 * them under a single day, exactly one longer than thirty, none longer than ninety, over a window of
 * 71 days. Nothing in that says a service recurs every six months, and a quarterly cycle cannot even
 * be observed in a window shorter than two of them. So an interval is a business assertion, it lives
 * in `service_interval_policies`, and a named admin puts it there.
 *
 * The consequence is deliberate: with no policy, this engine reports UNKNOWN and says why. It never
 * falls back to a default, because a default interval is an invented business rule wearing the
 * clothes of a sensible one.
 *
 * ── No model participates ───────────────────────────────────────────────────
 *
 * A language model may phrase the result. It never computes a date, never chooses an interval, and
 * never decides whether something is due. Arithmetic on dates is not a thing to be approximated.
 */

/** Bumped whenever the classification thresholds or the date arithmetic change. */
export const MAINTENANCE_RULES_VERSION = "maintenance.v1";

/**
 * How close counts as "approaching".
 *
 * Expressed as a fraction of the interval rather than a fixed number of days, so a weekly service
 * and an annual one both get a proportionate warning instead of a seven-day window that is most of
 * the cycle for one and a rounding error for the other.
 */
const APPROACHING_FRACTION = 0.15;

/** Below this the proportional window would be under a day, which is not a useful warning. */
const MIN_APPROACHING_DAYS = 1;

export type MaintenanceState = "NOT_DUE" | "APPROACHING" | "DUE" | "OVERDUE" | "UNKNOWN";

export type MaintenanceSignal = {
  customerId: string;
  serviceId: string;
  serviceName: string;
  state: MaintenanceState;
  /** Why, in a form worth logging and worth showing. Never a bare state. */
  reasonCode:
    | "NO_POLICY"
    | "NO_COMPLETED_BOOKING"
    | "WITHIN_INTERVAL"
    | "APPROACHING_DUE"
    | "DUE_NOW"
    | "PAST_DUE";
  lastCompletedAt: string | null;
  nextDueAt: string | null;
  daysUntilDue: number | null;
  /** The exact policy that produced this, so a past answer stays explainable after a policy change. */
  policyId: string | null;
  policyVersion: number | null;
  intervalUnit: ServiceIntervalUnit | null;
  intervalValue: number | null;
  timezone: string;
  rulesVersion: string;
  generatedAt: string;
};

/** Calendar-correct addition: three months from 31 January is 30 April, not 31 April. */
function addInterval(from: Date, unit: ServiceIntervalUnit, value: number): Date {
  const d = new Date(from.getTime());
  if (unit === "DAY") d.setUTCDate(d.getUTCDate() + value);
  else if (unit === "WEEK") d.setUTCDate(d.getUTCDate() + value * 7);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + value);
    const lastOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastOfMonth));
  }
  return d;
}

function intervalInDays(unit: ServiceIntervalUnit, value: number): number {
  if (unit === "DAY") return value;
  if (unit === "WEEK") return value * 7;
  return value * 30;
}

/**
 * The policy in force for a service right now.
 *
 * ACTIVE, already effective, and not yet expired — all three, because a DRAFT policy is somebody
 * still thinking and an expired one is a decision that was deliberately ended. The newest version
 * wins so that a correction supersedes rather than competes.
 */
export async function activePolicyFor(serviceId: string, at = new Date()) {
  return prisma.serviceIntervalPolicy.findFirst({
    where: {
      serviceId,
      status: ServiceIntervalStatus.ACTIVE,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { version: "desc" },
  });
}

/**
 * Classify one customer/service pair.
 *
 * `customerId` is the authenticated actor's id, resolved by the caller and never taken from a
 * request body — a maintenance signal for the wrong customer is a data leak, exactly as a
 * recommendation would be.
 */
export async function maintenanceFor(
  customerId: string,
  serviceId: string,
  now = new Date(),
): Promise<MaintenanceSignal> {
  const [service, lastBooking, policy, tz] = await Promise.all([
    prisma.service.findUnique({ where: { id: serviceId }, select: { id: true, name: true } }),
    /**
     * Only COMPLETED counts. A cancelled visit is not a service performed, and a booking whose
     * payment failed is not one either — treating them as completions would restart a maintenance
     * cycle that never happened.
     */
    prisma.booking.findFirst({
      where: { userId: customerId, serviceId, status: "COMPLETED", completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
    activePolicyFor(serviceId, now),
    /** Resolved the same way notification governance resolves it, so a due date and a quiet-hours
     *  window never disagree about what "today" means for the same person. */
    resolveRecipientTimeZone("CUSTOMER", customerId).catch(() => ({ timezone: "Asia/Kolkata" })),
  ]);

  const base = {
    customerId,
    serviceId,
    serviceName: service?.name ?? serviceId,
    lastCompletedAt: lastBooking?.completedAt?.toISOString() ?? null,
    timezone: tz.timezone,
    rulesVersion: MAINTENANCE_RULES_VERSION,
    generatedAt: now.toISOString(),
  };

  /**
   * The two ways of knowing nothing are kept apart. "No policy" is a gap in the business
   * configuration and someone can fix it; "never bought it" is a fact about the customer. Collapsing
   * them into one silent absence would hide the first behind the second.
   */
  if (!policy) {
    return {
      ...base, state: "UNKNOWN", reasonCode: "NO_POLICY",
      nextDueAt: null, daysUntilDue: null,
      policyId: null, policyVersion: null, intervalUnit: null, intervalValue: null,
    };
  }
  if (!lastBooking?.completedAt) {
    return {
      ...base, state: "UNKNOWN", reasonCode: "NO_COMPLETED_BOOKING",
      nextDueAt: null, daysUntilDue: null,
      policyId: policy.id, policyVersion: policy.version,
      intervalUnit: policy.intervalUnit, intervalValue: policy.intervalValue,
    };
  }

  const nextDue = addInterval(lastBooking.completedAt, policy.intervalUnit, policy.intervalValue);
  const msUntil = nextDue.getTime() - now.getTime();
  const daysUntilDue = Math.floor(msUntil / 86_400_000);

  const windowDays = Math.max(
    MIN_APPROACHING_DAYS,
    Math.round(intervalInDays(policy.intervalUnit, policy.intervalValue) * APPROACHING_FRACTION),
  );

  /** Ordered strictly: past due first, then due today, then the warning window, then nothing. */
  let state: MaintenanceState;
  let reasonCode: MaintenanceSignal["reasonCode"];
  if (daysUntilDue < 0) { state = "OVERDUE"; reasonCode = "PAST_DUE"; }
  else if (daysUntilDue === 0) { state = "DUE"; reasonCode = "DUE_NOW"; }
  else if (daysUntilDue <= windowDays) { state = "APPROACHING"; reasonCode = "APPROACHING_DUE"; }
  else { state = "NOT_DUE"; reasonCode = "WITHIN_INTERVAL"; }

  return {
    ...base, state, reasonCode,
    nextDueAt: nextDue.toISOString(),
    daysUntilDue,
    policyId: policy.id, policyVersion: policy.version,
    intervalUnit: policy.intervalUnit, intervalValue: policy.intervalValue,
  };
}

/**
 * Every service this customer has ever completed, classified.
 *
 * Scoped to their own history on purpose: a maintenance signal for something they never bought is a
 * recommendation, and recommendations are a different engine with different rules.
 */
export async function maintenanceForCustomer(
  customerId: string,
  now = new Date(),
): Promise<{ signals: MaintenanceSignal[]; rulesVersion: string; policiesInForce: number }> {
  const services = await prisma.booking.findMany({
    where: { userId: customerId, status: "COMPLETED", completedAt: { not: null } },
    select: { serviceId: true },
    distinct: ["serviceId"],
  });

  const signals: MaintenanceSignal[] = [];
  for (const s of services) signals.push(await maintenanceFor(customerId, s.serviceId, now));

  /** Soonest first, and anything unknowable last — an UNKNOWN has no date to sort by. */
  const order: Record<MaintenanceState, number> = { OVERDUE: 0, DUE: 1, APPROACHING: 2, NOT_DUE: 3, UNKNOWN: 4 };
  signals.sort((a, b) =>
    (order[a.state] - order[b.state]) ||
    ((a.daysUntilDue ?? Number.MAX_SAFE_INTEGER) - (b.daysUntilDue ?? Number.MAX_SAFE_INTEGER)) ||
    a.serviceId.localeCompare(b.serviceId));

  return {
    signals,
    rulesVersion: MAINTENANCE_RULES_VERSION,
    policiesInForce: signals.filter((s) => s.policyId !== null).length,
  };
}

/**
 * The facts a language model may use to phrase a maintenance signal.
 *
 * Dates are already computed and are passed as computed values — the model is never asked to work
 * one out, and never handed the raw interval and a last-serviced date to add together itself.
 */
export function maintenanceFacts(s: MaintenanceSignal): Record<string, unknown> {
  return {
    service: s.serviceName,
    state: s.state,
    reason: s.reasonCode,
    lastCompletedAt: s.lastCompletedAt,
    nextDueAt: s.nextDueAt,
    daysUntilDue: s.daysUntilDue,
    interval: s.intervalValue === null ? null : `${s.intervalValue} ${s.intervalUnit}`,
    rulesVersion: s.rulesVersion,
  };
}

/** Wording that works with no model available, built from the same facts one would receive. */
export function maintenanceReason(s: MaintenanceSignal): string {
  switch (s.reasonCode) {
    case "NO_POLICY":
      return `No recurrence interval has been set for ${s.serviceName}, so nothing can be said about when it is next due.`;
    case "NO_COMPLETED_BOOKING":
      return `${s.serviceName} has no completed booking for this customer yet.`;
    case "PAST_DUE":
      return `${s.serviceName} was last completed on ${s.lastCompletedAt?.slice(0, 10)} and was due on ${s.nextDueAt?.slice(0, 10)}.`;
    case "DUE_NOW":
      return `${s.serviceName} is due today, based on its ${s.intervalValue} ${s.intervalUnit?.toLowerCase()} interval.`;
    case "APPROACHING_DUE":
      return `${s.serviceName} is due on ${s.nextDueAt?.slice(0, 10)}, in ${s.daysUntilDue} days.`;
    case "WITHIN_INTERVAL":
      return `${s.serviceName} is not due until ${s.nextDueAt?.slice(0, 10)}.`;
  }
}
