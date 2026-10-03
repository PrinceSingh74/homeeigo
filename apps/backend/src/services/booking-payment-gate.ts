import { Prisma, PaymentStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import prisma from "../lib/prisma";

/**
 * Whether a booking has been paid for well enough to commit a partner to it.
 *
 * Until now nothing asked. `accept()`, admin assignment and `start()` all read the booking's
 * *status* and never its *paymentStatus*, so a booking could travel PENDING → ACCEPTED → EN_ROUTE →
 * IN_PROGRESS → COMPLETED while the money never arrived. That was not a hypothetical: seven real
 * bookings reached dispatch unpaid and five of those were completed, and Razorpay confirms five of
 * them never saw a single payment attempt.
 *
 * The gate lives in one place on purpose. Three separate write paths reach partner commitment, and
 * three inline copies of "is it paid" is three chances for one of them to drift — which is exactly
 * how admin assignment came to bypass a rule that partner accept was supposed to enforce.
 *
 * It reads, decides, and returns. It never writes: not to the booking, not to the payment, not to
 * the ledger. A gate that mutates is a gate that can be the cause of the thing it was meant to
 * prevent.
 */

export const PAYMENT_GATE_REASON = {
  /** The money is in. The only reason normal progression is allowed. */
  SETTLED: "PAYMENT_SETTLED",
  /** Authoritative payment state is anything other than SUCCESS. */
  NOT_SETTLED: "PAYMENT_NOT_SETTLED",
  /** An administrator deliberately took responsibility, with an identity and a reason on record. */
  OVERRIDE: "PAYMENT_GATE_OVERRIDE",
  /** Nothing to judge. Fails closed rather than treating an absent booking as permissible. */
  BOOKING_NOT_FOUND: "BOOKING_NOT_FOUND",
  /** §11: a case-created follow-up whose fee was waived — nothing is owed (see isNoPaymentFollowUp). */
  NO_PAYMENT_REQUIRED: "NO_PAYMENT_REQUIRED",
} as const;

export type PaymentGateReason = (typeof PAYMENT_GATE_REASON)[keyof typeof PAYMENT_GATE_REASON];

/**
 * An administrator taking responsibility for dispatching an unpaid booking.
 *
 * Both fields are required and neither may be blank. An override with no reason is
 * indistinguishable from a bug six months later, and an override with no actor is not an override
 * at all — it is the gate being off.
 */
export type PaymentGateOverride = {
  adminId: string;
  reason: string;
};

export type PaymentGateVerdict = {
  allowed: boolean;
  reason: PaymentGateReason;
  /** The state actually read from the database, for the caller's audit trail. */
  paymentStatus?: PaymentStatus;
  /** True only when an authorised administrator override carried the decision. */
  overridden?: boolean;
};

/** The one payment state that permits normal progression. Wallet settles to SUCCESS like any other. */
export function isSettled(status: PaymentStatus | null | undefined): boolean {
  return status === PaymentStatus.SUCCESS;
}

/**
 * §5 — money that has gone BACK to the customer (or whose window closed with nothing captured).
 *
 * An override exists so an administrator can dispatch a job whose money has not arrived YET. It was
 * never a licence to work a job whose money has been returned: a stale override row, written while
 * the booking was merely unpaid, used to carry a later-refunded booking straight into IN_PROGRESS.
 * No override applies to these states. PARTIALLY_REFUNDED is deliberately absent — a goodwill
 * partial refund on a live job does not end the job.
 */
export const RETURNED_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.REFUNDED,
  PaymentStatus.REFUNDING,
  PaymentStatus.EXPIRED,
];

export function isPaymentReturned(status: PaymentStatus | null | undefined): boolean {
  return status != null && RETURNED_PAYMENT_STATUSES.includes(status);
}

/**
 * Phase 10 §11 — a follow-up visit a complaint case created with its fee WAIVED owes nothing.
 *
 * Such a booking (booking_kind REWORK / REVISIT, created by the case service, so `case_id` is set,
 * total 0) has no payment to wait for. It is NOT marked paid: no payment row, paymentStatus stays
 * PENDING — the gates simply do not ask it for money. Every other booking, including a STANDARD
 * booking whose total happens to be 0, is judged by `evaluatePaymentGate` exactly as before.
 * Money that went back (REFUNDED / REFUNDING / EXPIRED) is never exempt.
 *
 * The columns come from migration 20260924220000; on a database without it nothing is exempt.
 */
let followUpColumns: { present: boolean; at: number } | null = null;
type RawReader = Pick<PrismaClient, "$queryRaw">;
export async function followUpColumnsPresent(client: RawReader = prisma): Promise<boolean> {
  if (followUpColumns && (followUpColumns.present || Date.now() - followUpColumns.at < 60_000)) return followUpColumns.present;
  const [row] = await client.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'case_id' AND table_schema = current_schema()) AS present`;
  followUpColumns = { present: row?.present === true, at: Date.now() };
  return followUpColumns.present;
}

export async function isNoPaymentFollowUp(bookingId: string, client: RawReader = prisma): Promise<boolean> {
  if (!(await followUpColumnsPresent(client))) return false;
  const rows = await client.$queryRaw<Array<{ exempt: boolean }>>`
    SELECT (booking_kind IN ('REWORK', 'REVISIT') AND case_id IS NOT NULL AND parent_booking_id IS NOT NULL
            AND total_amount = 0 AND total_amount_paise = 0
            AND payment_status NOT IN ('REFUNDED', 'REFUNDING', 'EXPIRED')) AS exempt
    FROM bookings WHERE id = ${bookingId}`;
  return rows[0]?.exempt === true;
}

/**
 * The payment exemption the partner job gates apply (audited override OR waived-fee follow-up, never
 * for money that went back), for a page of bookings in two queries — so a partner list can tell its
 * action mirror what `start()` / `accept()` will actually allow. Same predicates as the single-row checks.
 */
export async function paymentExemptBookingIds(
  rows: Array<{ id: string; paymentStatus: PaymentStatus | null }>,
  client: RawReader & PaymentGateAuditReader = prisma,
): Promise<Set<string>> {
  const ids = rows.filter((r) => !isSettled(r.paymentStatus) && !isPaymentReturned(r.paymentStatus)).map((r) => r.id);
  if (ids.length === 0) return new Set();
  const [overrides, followUps] = await Promise.all([
    client.activityLog.findMany({ where: { bookingId: { in: ids }, action: PAYMENT_GATE_OVERRIDE_ACTION }, select: { bookingId: true } }),
    (await followUpColumnsPresent(client))
      ? client.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM bookings
          WHERE id IN (${Prisma.join(ids)})
            AND booking_kind IN ('REWORK', 'REVISIT') AND case_id IS NOT NULL AND parent_booking_id IS NOT NULL
            AND total_amount = 0 AND total_amount_paise = 0
            AND payment_status NOT IN ('REFUNDED', 'REFUNDING', 'EXPIRED')`
      : Promise.resolve([] as Array<{ id: string }>),
  ]);
  return new Set([...overrides.map((o) => o.bookingId).filter((x): x is string => !!x), ...followUps.map((f) => f.id)]);
}

/** Unassigned waived-fee follow-ups waiting for dispatch — the cron queue's counterpart of isNoPaymentFollowUp. */
export async function pendingNoPaymentFollowUpIds(limit: number, client: RawReader = prisma): Promise<string[]> {
  if (!(await followUpColumnsPresent(client))) return [];
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM bookings
    WHERE booking_kind IN ('REWORK', 'REVISIT') AND case_id IS NOT NULL AND parent_booking_id IS NOT NULL
      AND total_amount = 0 AND total_amount_paise = 0 AND status = 'PENDING' AND provider_id IS NULL
      AND payment_status NOT IN ('REFUNDED', 'REFUNDING', 'EXPIRED')
    ORDER BY created_at LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

/** An override is only an override if someone identifiable gave a reason. */
export function isUsableOverride(override?: PaymentGateOverride | null): boolean {
  return Boolean(override && override.adminId.trim().length > 0 && override.reason.trim().length > 0);
}

/**
 * Decides from a payment status that has already been read — used where the caller is inside a
 * transaction holding the booking row locked, so the state cannot move underneath the decision.
 */
export function evaluatePaymentGate(
  paymentStatus: PaymentStatus | null | undefined,
  override?: PaymentGateOverride | null,
): PaymentGateVerdict {
  if (isSettled(paymentStatus)) {
    return { allowed: true, reason: PAYMENT_GATE_REASON.SETTLED, paymentStatus: paymentStatus! };
  }
  /**
   * Checked only after settlement fails.
   *
   * An override is a decision to proceed *despite* the gate, so evaluating it first would mean a
   * paid booking and an unpaid one produced the same audit trail, and nobody could later tell which
   * overrides actually mattered.
   */
  if (isUsableOverride(override) && !isPaymentReturned(paymentStatus)) {
    return {
      allowed: true,
      reason: PAYMENT_GATE_REASON.OVERRIDE,
      paymentStatus: paymentStatus ?? undefined,
      overridden: true,
    };
  }
  return {
    allowed: false,
    reason: PAYMENT_GATE_REASON.NOT_SETTLED,
    paymentStatus: paymentStatus ?? undefined,
  };
}

/**
 * The audited action an administrator's override writes, and the only thing that makes one real.
 *
 * Deliberately the same ActivityLog row the audit trail already reads. Storing the override
 * anywhere else — a boolean on the booking, a flag in memory — would let an override exist that
 * nobody was recorded as having authorised. Here the audit record *is* the authorisation: no row,
 * no override, and the row necessarily carries the admin's id and their reason.
 */
export const PAYMENT_GATE_OVERRIDE_ACTION = "ADMIN_BOOKING_PAYMENT_GATE_OVERRIDE";

/**
 * Narrow reader for the override audit row — the real Prisma delegate, not a hand-written stand-in.
 *
 * This was `{ activityLog: { findFirst: (args: unknown) => Promise<unknown> } }`, defaulted with
 * `prisma as never`. A parameter typed `unknown` obliges the implementation to accept ANY argument,
 * and Prisma's delegate accepts only its own args type — so the real client was not assignable and
 * the default needed a cast to get in.
 *
 * The cast was the smaller problem. With `args: unknown` the query below was NOT TYPECHECKED AT
 * ALL: a misspelled `action`, a wrong field name, or a `where` on a column that does not exist
 * would have compiled. On this function that is a payment control failing silently — the override
 * lookup returning the wrong answer either blocks a partner an admin deliberately dispatched, or
 * reports an override that was never granted.
 *
 * `Pick<PrismaClient, "activityLog">` keeps the seam (callers still pass a transaction client)
 * while typechecking the query against the real schema.
 */
type PaymentGateAuditReader = Pick<PrismaClient, "activityLog">;

/**
 * Whether an administrator has already taken responsibility for dispatching this booking unpaid.
 *
 * Consulted by the later, defence-in-depth gates. Without it, an override at assignment would be
 * undone at `start()` — the partner would be dispatched by an admin and then blocked from working,
 * which is a worse outcome than either enforcing or not enforcing consistently.
 */
export async function hasAuditedPaymentGateOverride(
  bookingId: string,
  client: PaymentGateAuditReader = prisma,
): Promise<boolean> {
  const row = await client.activityLog.findFirst({
    where: { bookingId, action: PAYMENT_GATE_OVERRIDE_ACTION },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Reads the booking's own payment state and decides.
 *
 * The status comes from the database every time. A caller cannot pass one in — not from a client
 * payload, not from mobile state, not from a cached copy, and not from what was true when a
 * workflow was triggered hours ago. The whole point of the gate is that it does not take anyone's
 * word for whether the money arrived.
 */
export async function assertBookingPaymentReadyForDispatch(
  bookingId: string,
  override?: PaymentGateOverride | null,
): Promise<PaymentGateVerdict> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { paymentStatus: true },
  });
  if (!booking) {
    return { allowed: false, reason: PAYMENT_GATE_REASON.BOOKING_NOT_FOUND };
  }
  const verdict = evaluatePaymentGate(booking.paymentStatus, override);
  if (!verdict.allowed && (await isNoPaymentFollowUp(bookingId))) {
    return { allowed: true, reason: PAYMENT_GATE_REASON.NO_PAYMENT_REQUIRED, paymentStatus: booking.paymentStatus };
  }
  return verdict;
}
