/**
 * X-5 — booking-kind volume semantics.
 *
 * Phase 10 §11 added `bookings.booking_kind` (STANDARD | REWORK | REVISIT): a REWORK / REVISIT row
 * is a follow-up visit a complaint case created against an already-counted parent booking. Until
 * this fix, completing one incremented `provider.completedBookings` and wrote a ₹0 earning row, so
 * volume tiers, incentives and "completed jobs" analytics counted the same job twice — once as the
 * parent and once per follow-up.
 *
 * Canonical policy (derived from the §11 design, not invented here):
 *   - STANDARD completion counts everywhere, exactly as before.
 *   - REWORK / REVISIT completion still COMPLETES the booking (FSM, capacity and rating side
 *     effects untouched) but never increments volume counters, and writes an earning row only when
 *     it actually pays (netEarning > 0 — a PAID rework, if ever configured, still earns).
 *
 * `booking_kind` is NOT in the Prisma model (migration 20260924220000, raw SQL only), so every
 * reader here is guarded by an information_schema probe exactly like
 * `booking-payment-gate.ts#followUpColumnsPresent`: on a database without the migration nothing is
 * a follow-up and every count degrades to its pre-§11 behaviour instead of crashing — live
 * `--watch` backends hot-reload this file.
 */
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import prisma from "./prisma";

/** Works with both the root client and a transaction client. */
type RawClient = Pick<PrismaClient, "$queryRaw">;

export type BookingKind = "STANDARD" | "REWORK" | "REVISIT";

export function isFollowUpKind(kind: BookingKind | null | undefined): boolean {
  return kind === "REWORK" || kind === "REVISIT";
}

/** Cached column-presence probe; re-probed every 60 s while absent, permanent once seen present. */
let kindColumn: { present: boolean; at: number } | null = null;
export async function bookingKindColumnPresent(client: RawClient = prisma): Promise<boolean> {
  if (kindColumn && (kindColumn.present || Date.now() - kindColumn.at < 60_000)) return kindColumn.present;
  const [row] = await client.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'bookings' AND column_name = 'booking_kind'
                     AND table_schema = current_schema()) AS present`;
  kindColumn = { present: row?.present === true, at: Date.now() };
  return kindColumn.present;
}

/** Test hook: forget the cached probe so a suite can exercise the column-absent path. */
export function resetBookingKindColumnCache(): void {
  kindColumn = null;
}

/**
 * The booking's kind, read via raw SQL (the column is not in the Prisma model). A database without
 * the §11 migration, an unknown value, or a missing row all answer STANDARD — the pre-§11 world
 * where every completion counted, which is the only safe default for a counter.
 */
export async function getBookingKind(bookingId: string, client: RawClient = prisma): Promise<BookingKind> {
  if (!(await bookingKindColumnPresent(client))) return "STANDARD";
  const rows = await client.$queryRaw<Array<{ kind: string | null }>>`
    SELECT booking_kind AS kind FROM bookings WHERE id = ${bookingId}`;
  const kind = rows[0]?.kind;
  return kind === "REWORK" || kind === "REVISIT" ? kind : "STANDARD";
}

/**
 * The one shared predicate for "this completed booking counts toward volume". Every raw counter
 * that feeds tiers / incentives / completed-jobs analytics composes this with `Prisma.sql`; use
 * `standardCompletionWhere()` (below) so a pre-§11 database counts everything, as it always did.
 */
export const STANDARD_COMPLETION_WHERE = Prisma.sql`(bookings.booking_kind = 'STANDARD' OR bookings.booking_kind IS NULL)`;

/** `STANDARD_COMPLETION_WHERE` when the column exists, `TRUE` when it does not. */
export async function standardCompletionWhere(client: RawClient = prisma): Promise<Prisma.Sql> {
  return (await bookingKindColumnPresent(client)) ? STANDARD_COMPLETION_WHERE : Prisma.sql`TRUE`;
}

/** Lifetime COMPLETED count for one provider, follow-ups excluded (the `completedBookings` truth). */
export async function countStandardCompleted(providerId: string, client: RawClient = prisma): Promise<number> {
  const where = await standardCompletionWhere(client);
  const rows = await client.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS n FROM bookings
    WHERE provider_id = ${providerId} AND status = 'COMPLETED' AND ${where}`);
  return rows[0]?.n ?? 0;
}

/**
 * COMPLETED-since counts per provider, follow-ups excluded — the incentive engine's volume source
 * ("complete N jobs today / this week / this month" must not be satisfiable by rework visits).
 */
export async function countStandardCompletedByProvider(
  providerIds: string[],
  since: Date,
  client: RawClient = prisma,
): Promise<Map<string, number>> {
  if (providerIds.length === 0) return new Map();
  const where = await standardCompletionWhere(client);
  const rows = await client.$queryRaw<Array<{ provider_id: string; n: number }>>(Prisma.sql`
    SELECT provider_id, COUNT(*)::int AS n FROM bookings
    WHERE provider_id IN (${Prisma.join(providerIds)})
      AND status = 'COMPLETED' AND completed_at >= ${since} AND ${where}
    GROUP BY provider_id`);
  return new Map(rows.map((r) => [r.provider_id, r.n]));
}
