/**
 * Phase D — the one service that evaluates, records and exposes customer (age) policy decisions.
 *
 * Decisions live in `customer_policy_decisions` (migration 20260924230000), append-only by trigger.
 * Because a row can never be updated, a decision cannot be "attached" to a booking afterwards:
 *   - REFUSED   → recorded immediately, outside any transaction, with booking_id NULL
 *                 (there is no booking — the refusal IS the record).
 *   - ALLOWED / NOT_APPLICABLE on a service with an age policy → recorded INSIDE the booking-create
 *                 transaction with the new booking's id (`recordInTransaction`), so the booking and
 *                 the decision that admitted it commit or roll back together.
 * Services with no `customerPolicy.age` at all record nothing (no policy was evaluated).
 *
 * `inputs` never contains the date of birth. Partners never see this table or its contents.
 * Without the table (migration not applied) the policy is STILL evaluated and enforced; only the
 * record is skipped, and that is logged + counted.
 */
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { getEventContext } from "../events/core/event-context";
import { parseCatalogConfig, type ServiceCatalogConfig } from "../lib/service-catalog-config";
import {
  AGE_POLICY_MESSAGES,
  CUSTOMER_POLICY_TIMEZONE,
  evaluateAgePolicy,
  parseDateOfBirth,
  type AgePolicyDecision,
} from "../lib/customer-policy";
import { AuditLogService } from "./audit-log.service";

type Db = Prisma.TransactionClient | typeof prisma;

let known: { present: boolean; at: number } | null = null;
async function tablePresent(db: Db = prisma): Promise<boolean> {
  if (known && (known.present || Date.now() - known.at < 60_000)) return known.present;
  const [row] = await db.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('customer_policy_decisions') IS NOT NULL AS present`;
  known = { present: row?.present === true, at: Date.now() };
  return known.present;
}

export type BookingPolicyEvaluation = {
  decision: AgePolicyDecision;
  /** True when the service carries an age policy, so the decision must be recorded. */
  recordable: boolean;
  /** Id of the refusal row when one was written (REFUSED only). */
  decisionId: number | null;
  message: string;
};

type RawDecision = {
  id: bigint;
  customer_id: string;
  service_id: string;
  booking_id: string | null;
  policy: string;
  policy_version: string;
  mode: string;
  outcome: string;
  reason_code: string;
  inputs: unknown;
  request_id: string | null;
  trace_id: string | null;
  created_at: Date;
};

export const DOB_ERRORS = {
  DOB_INVALID: "DOB_INVALID",
  DOB_IN_FUTURE: "DOB_IN_FUTURE",
  DOB_IMPLAUSIBLE: "DOB_IMPLAUSIBLE",
  DOB_LOCKED: "DOB_LOCKED",
  NOT_FOUND: "NOT_FOUND",
  REASON_REQUIRED: "REASON_REQUIRED",
} as const;

function sameCivilDate(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

async function insertDecision(
  db: Db,
  row: { customerId: string; serviceId: string; bookingId: string | null; decision: AgePolicyDecision },
): Promise<number | null> {
  if (!(await tablePresent(db))) {
    incCounter("customer_policy_decision_unrecorded_total", { reason: "table_absent" });
    logger.warn("customer_policy_decision_unrecorded", {
      reason: "customer_policy_decisions table absent",
      serviceId: row.serviceId,
      outcome: row.decision.outcome,
      reasonCode: row.decision.reasonCode,
    });
    return null;
  }
  const ctx = getEventContext();
  // Only the three fields the decision used — never the date of birth.
  const inputs = JSON.stringify({
    ageKnown: row.decision.inputs.ageKnown,
    ageYears: row.decision.inputs.ageYears,
    guardianAttested: row.decision.inputs.guardianAttested,
  });
  const [r] = await db.$queryRaw<{ id: bigint }[]>`
    INSERT INTO customer_policy_decisions
      (customer_id, service_id, booking_id, policy, policy_version, mode, outcome, reason_code, inputs, request_id, trace_id)
    VALUES
      (${row.customerId}, ${row.serviceId}, ${row.bookingId}, 'CUSTOMER_AGE', ${row.decision.policyVersion}, ${row.decision.mode},
       ${row.decision.outcome}, ${row.decision.reasonCode}, ${inputs}::jsonb, ${ctx.requestId ?? null}, ${ctx.traceId ?? null})
    RETURNING id`;
  incCounter("customer_policy_decision_total", { policy: "CUSTOMER_AGE", outcome: row.decision.outcome, reason: row.decision.reasonCode });
  return r ? Number(r.id) : null;
}

class CustomerPolicyService {
  private async readDob(customerId: string, db: Db = prisma): Promise<Date | null> {
    const u = await db.user.findUnique({ where: { id: customerId }, select: { dateOfBirth: true } });
    return u?.dateOfBirth ?? null;
  }

  /**
   * Evaluate the service's age policy for a booking attempt. A refusal is recorded here (no
   * booking exists); an admission is returned for the caller to record inside its transaction.
   */
  async evaluateForBooking(input: {
    customerId: string;
    serviceId: string;
    catalogConfig: ServiceCatalogConfig | null;
    guardianAttested?: boolean;
    now?: Date;
  }): Promise<BookingPolicyEvaluation> {
    const policy = input.catalogConfig?.customerPolicy;
    const recordable = policy?.age != null;
    const dateOfBirth = recordable ? await this.readDob(input.customerId) : null;
    const decision = evaluateAgePolicy({
      policy,
      dateOfBirth,
      guardianAttested: input.guardianAttested === true,
      now: input.now ?? new Date(),
      timeZone: CUSTOMER_POLICY_TIMEZONE,
    });
    let decisionId: number | null = null;
    if (decision.outcome === "REFUSED") {
      const ctx = getEventContext();
      logger.info("customer_policy_refused", {
        serviceId: input.serviceId,
        mode: decision.mode,
        reasonCode: decision.reasonCode,
        requestId: ctx.requestId,
        traceId: ctx.traceId,
      });
      try {
        decisionId = await insertDecision(prisma, { customerId: input.customerId, serviceId: input.serviceId, bookingId: null, decision });
      } catch (err) {
        // The refusal stands whether or not its record could be written.
        incCounter("customer_policy_decision_unrecorded_total", { reason: "insert_failed" });
        logger.error("customer_policy_decision_insert_failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { decision, recordable, decisionId, message: AGE_POLICY_MESSAGES[decision.reasonCode] };
  }

  /** Record an admitting decision with its booking, inside the booking-create transaction. */
  async recordInTransaction(
    tx: Prisma.TransactionClient,
    input: { customerId: string; serviceId: string; bookingId: string; evaluation: BookingPolicyEvaluation },
  ): Promise<number | null> {
    if (!input.evaluation.recordable || input.evaluation.decision.outcome === "REFUSED") return null;
    return insertDecision(tx, { customerId: input.customerId, serviceId: input.serviceId, bookingId: input.bookingId, decision: input.evaluation.decision });
  }

  /** Read-only evaluation for the price quote: nothing is written. */
  async preview(input: { customerId: string; serviceId: string; guardianAttested?: boolean; now?: Date }) {
    const service = await prisma.service.findUnique({ where: { id: input.serviceId }, select: { catalogConfig: true } });
    const cfg = parseCatalogConfig(service?.catalogConfig ?? null);
    const policy = cfg?.customerPolicy;
    const dateOfBirth = policy?.age ? await this.readDob(input.customerId) : null;
    const d = evaluateAgePolicy({ policy, dateOfBirth, guardianAttested: input.guardianAttested === true, now: input.now ?? new Date() });
    return {
      outcome: d.outcome,
      reasonCode: d.reasonCode,
      mode: d.mode,
      policyVersion: d.policyVersion,
      message: AGE_POLICY_MESSAGES[d.reasonCode],
      // What the UI needs to explain the rule: the configured thresholds (never the customer's age or DOB).
      policy: policy?.age ?? null,
      dateOfBirthSet: dateOfBirth != null,
    };
  }

  /** Customer records their own date of birth once. Changing it afterwards is a support action. */
  async setOwnDateOfBirth(customerId: string, raw: string, meta: { ipAddress?: string; userAgent?: string } = {}) {
    const parsed = parseDateOfBirth(raw, new Date());
    if (!parsed.ok) return { ok: false as const, error: parsed.error };
    // Set only while unset: two concurrent first writes cannot both win.
    const r = await prisma.user.updateMany({ where: { id: customerId, dateOfBirth: null }, data: { dateOfBirth: parsed.date } });
    if (r.count === 0) {
      const current = await this.readDob(customerId);
      if (current && sameCivilDate(current, parsed.date)) return { ok: true as const, changed: false };
      if (!current) return { ok: false as const, error: DOB_ERRORS.NOT_FOUND };
      incCounter("customer_dob_change_refused_total");
      return { ok: false as const, error: DOB_ERRORS.DOB_LOCKED };
    }
    await AuditLogService.record("CUSTOMER_DOB_RECORDED", "success", {
      userId: customerId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      traceId: getEventContext().traceId ?? null,
      details: { actor: "customer" },
    });
    return { ok: true as const, changed: true };
  }

  /** Support/admin sets or corrects a customer's date of birth, with a reason. */
  async adminSetDateOfBirth(input: { adminId: string; userId: string; raw: string; reason: string; ipAddress?: string; userAgent?: string }) {
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 3) return { ok: false as const, error: DOB_ERRORS.REASON_REQUIRED };
    const parsed = parseDateOfBirth(input.raw, new Date());
    if (!parsed.ok) return { ok: false as const, error: parsed.error };
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, dateOfBirth: true } });
    if (!user) return { ok: false as const, error: DOB_ERRORS.NOT_FOUND };
    const hadValue = user.dateOfBirth != null;
    await prisma.user.update({ where: { id: input.userId }, data: { dateOfBirth: parsed.date } });
    await AuditLogService.record("CUSTOMER_DOB_CORRECTED", "success", {
      userId: input.adminId,
      reason,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      traceId: getEventContext().traceId ?? null,
      // Which account and whether a value was replaced — never the value, old or new.
      details: { actor: "admin", targetUserId: input.userId, replacedExisting: hadValue },
    });
    return { ok: true as const, changed: true };
  }

  async dateOfBirthSet(customerId: string): Promise<boolean> {
    return (await this.readDob(customerId)) != null;
  }

  /** Admin listing. Carries the decision's inputs (age known / whole-year age / attestation) — never the date of birth. */
  async listDecisions(filter: { customerId?: string; serviceId?: string; limit?: number }) {
    if (!(await tablePresent())) return { deployed: false as const, decisions: [] };
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 200);
    const customerId = filter.customerId ?? null;
    const serviceId = filter.serviceId ?? null;
    const rows = await prisma.$queryRaw<RawDecision[]>`
      SELECT id, customer_id, service_id, booking_id, policy, policy_version, mode, outcome, reason_code, inputs, request_id, trace_id, created_at
      FROM customer_policy_decisions
      WHERE (${customerId}::text IS NULL OR customer_id = ${customerId}::text)
        AND (${serviceId}::text IS NULL OR service_id = ${serviceId}::text)
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}`;
    return {
      deployed: true as const,
      decisions: rows.map((r) => ({
        id: Number(r.id),
        customerId: r.customer_id,
        serviceId: r.service_id,
        bookingId: r.booking_id,
        policy: r.policy,
        policyVersion: r.policy_version,
        mode: r.mode,
        outcome: r.outcome,
        reasonCode: r.reason_code,
        inputs: r.inputs,
        requestId: r.request_id,
        traceId: r.trace_id,
        createdAt: r.created_at,
      })),
    };
  }
}

export const customerPolicyService = new CustomerPolicyService();
