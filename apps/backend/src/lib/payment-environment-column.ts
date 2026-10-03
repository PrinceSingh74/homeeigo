/**
 * §27 / mandate M — durable per-payment environment truth.
 *
 * `payments.environment` / `refund_requests.environment` record which Razorpay world ('LIVE' or
 * 'TEST') a row actually moved through, stamped at write time from the credential in use. NULL
 * means UNKNOWN: a historical row predating the column, which is never guessed at.
 *
 * Everything here is probe-guarded: the column arrives by migration, not `prisma db push`, and a
 * `--watch` backend hot-reloads this code against a database that may not have it yet. A missing
 * column degrades every path below to a silent no-op (stamp) or UNKNOWN (read) — never a crash.
 * The column is deliberately NOT in the Prisma model, so all access is raw, parameterised SQL.
 */
import prisma from "./prisma";
import { logger } from "./logger";
import { resolvePaymentEnvironment } from "./payment-environment";

export type StampedPaymentEnvironment = "LIVE" | "TEST";

type Db = Pick<typeof prisma, "$queryRaw" | "$executeRaw">;
type EnvTable = "payments" | "refund_requests";

/**
 * Same literal `razorpay.service.isDevOrder` matches (not imported: a lib module must not pull in
 * a service). Order ids the dev-mock gateway mints — the one marker that PROVES a row is TEST.
 */
export const DEV_MOCK_ORDER_PREFIX = "order_dev_";

/** Refund ids the dev-mock refund path mints (`rfnd_dev_…` in razorpay.service). */
export const DEV_MOCK_REFUND_PREFIX = "rfnd_dev_";

/**
 * Cached column probe, per table — the `tablesPresent` pattern from booking-safety.service.
 * Present is remembered forever (a column is never dropped underneath a running process by
 * anything sane); absent is re-probed after a minute so applying the migration does not require
 * a restart.
 */
const probed: Partial<Record<EnvTable, { present: boolean; at: number }>> = {};

export async function paymentEnvironmentColumnPresent(db: Db = prisma, table: EnvTable = "payments"): Promise<boolean> {
  const k = probed[table];
  if (k && (k.present || Date.now() - k.at < 60_000)) return k.present;
  try {
    const [row] = await db.$queryRaw<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = 'environment'
      ) AS present`;
    probed[table] = { present: row?.present === true, at: Date.now() };
  } catch {
    // A failed probe is "not deployed", never a crash on a money path.
    probed[table] = { present: false, at: Date.now() };
  }
  return probed[table]!.present;
}

/** Test hook: the cache is process-global, so suites that stub the probe must clear it. */
export function resetPaymentEnvironmentColumnCacheForTests(): void {
  delete probed.payments;
  delete probed.refund_requests;
}

/**
 * The environment every gateway interaction of THIS process belongs to.
 *
 * - A classifiable configured key wins: `rzp_live_…` → LIVE, `rzp_test_…` → TEST.
 * - An unrecognisable configured key returns null — it cannot be classified, so nothing is
 *   stamped and no mismatch is asserted from it (resolvePaymentEnvironment already flags it).
 * - No key at all → TEST: with no credential the process can only talk to the dev-mock gateway
 *   (`order_dev_…` / `rfnd_dev_…`), and production refuses to create orders or refunds while
 *   unconfigured before any row could be written.
 */
export function processGatewayEnvironment(
  keyId: string | undefined | null = process.env.RAZORPAY_KEY_ID,
): StampedPaymentEnvironment | null {
  const v = resolvePaymentEnvironment(keyId);
  if (v.environment === "LIVE" || v.environment === "TEST") return v.environment;
  if (v.mismatch === "UNRECOGNISED_KEY_FORMAT") return null;
  return "TEST";
}

/** Environment for a payment given the gateway order that backs it. A dev-mock order IS test. */
export function environmentForGatewayOrder(
  orderId: string | null | undefined,
  keyId: string | undefined | null = process.env.RAZORPAY_KEY_ID,
): StampedPaymentEnvironment | null {
  if (orderId && orderId.startsWith(DEV_MOCK_ORDER_PREFIX)) return "TEST";
  return processGatewayEnvironment(keyId);
}

/**
 * Stamp a payment's environment from the ACTIVE credential (or the dev-mock order marker).
 * Only fills NULL — an environment once recorded is history and is never rewritten. Never throws:
 * stamping is provenance, and provenance must not be able to fail a payment.
 */
export async function stampPaymentEnvironment(db: Db, paymentId: string, orderId?: string | null): Promise<void> {
  try {
    if (!(await paymentEnvironmentColumnPresent(db, "payments"))) return;
    const env = environmentForGatewayOrder(orderId);
    if (!env) return;
    await db.$executeRaw`UPDATE payments SET environment = ${env} WHERE id = ${paymentId} AND environment IS NULL`;
  } catch (err) {
    logger.warn("payment_environment.stamp_failed", {
      paymentId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

/** Stamp the world a refund request is about to execute in. Fills NULL only; never throws. */
export async function stampRefundRequestEnvironment(
  db: Db,
  refundRequestId: string,
  environment: StampedPaymentEnvironment,
): Promise<void> {
  try {
    if (!(await paymentEnvironmentColumnPresent(db, "refund_requests"))) return;
    await db.$executeRaw`UPDATE refund_requests SET environment = ${environment} WHERE id = ${refundRequestId} AND environment IS NULL`;
  } catch (err) {
    logger.warn("payment_environment.refund_stamp_failed", {
      refundRequestId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

/**
 * A payment's recorded environment. null = UNKNOWN — the column is absent (pre-migration DB) or
 * the row predates stamping. Callers treat UNKNOWN as the historical default (allowed), counted.
 */
export async function readPaymentEnvironment(db: Db, paymentId: string): Promise<StampedPaymentEnvironment | null> {
  try {
    if (!(await paymentEnvironmentColumnPresent(db, "payments"))) return null;
    const rows = await db.$queryRaw<{ environment: string | null }[]>`
      SELECT environment FROM payments WHERE id = ${paymentId}`;
    const e = rows[0]?.environment ?? null;
    return e === "LIVE" || e === "TEST" ? e : null;
  } catch {
    return null;
  }
}
