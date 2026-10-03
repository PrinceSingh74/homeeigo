import { describe, expect, it } from "bun:test";
import { dbReachable, prisma } from "./helpers/adversarial-fixtures";

/**
 * The invariants the suites rely on must actually exist in the database the suites run against.
 * `prisma db push` cannot create any of these (they live only in migration SQL), so a test DB built
 * without the replay step passes every double-booking and wallet-consistency test vacuously. This
 * turns "the migration file was not edited" into "the constraint is live where the tests run".
 */
describe("test database carries the raw-SQL invariants", () => {
  it("has the slot EXCLUDE constraints, their trigger, the wallet CHECK and the partial index", async () => {
    if (!(await dbReachable())) return;
    const constraints = await prisma.$queryRaw<Array<{ conname: string; contype: string }>>`
      SELECT conname, contype::text AS contype FROM pg_constraint
      WHERE conname IN ('bookings_provider_slot_excl', 'bookings_user_slot_excl', 'wallet_balance_consistency',
                        'booking_completed_requires_timestamp')
    `;
    const byName = Object.fromEntries(constraints.map((c) => [c.conname, c.contype]));
    expect(byName.bookings_provider_slot_excl).toBe("x");
    expect(byName.bookings_user_slot_excl).toBe("x");
    expect(byName.wallet_balance_consistency).toBe("c");
    // Found on the live database and in NO migration (2026-09-21). Fixtures had been setting
    // `completedAt` "because the CHECK requires it" against a test database that did not have it.
    expect(byName.booking_completed_requires_timestamp).toBe("c");

    const trigger = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger WHERE tgname = 'bookings_conflict_slots_trg' AND NOT tgisinternal
    `;
    expect(trigger.length).toBe(1);

    const fn = await prisma.$queryRaw<Array<{ proname: string }>>`
      SELECT proname FROM pg_proc WHERE proname = 'bookings_sync_conflict_slots'
    `;
    expect(fn.length).toBe(1);

    const idx = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE indexname = 'idx_addresses_payload_hash'
    `;
    expect(idx.length).toBe(1);

    // The half-open fix: a booking ending exactly when the next starts must NOT conflict, so the
    // range must be '[)' — visible in the constraint definition.
    const def = await prisma.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'bookings_provider_slot_excl'
    `;
    expect(def[0]?.def).toContain("'[)'");
  });

  it("has the money paise dual-write triggers on every table that stores an amount", async () => {
    if (!(await dbReachable())) return;
    /**
     * These were missing from the test database for months: `db push` cannot create a trigger, and
     * the replay list did not include the migration that does. Money suites therefore ran against a
     * database whose amount columns behaved differently from production's. The application sets both
     * the rupee and paise columns explicitly, so the trigger is a backstop — but a backstop that is
     * absent exactly where money is certified is not a backstop.
     */
    const rows = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger t
      JOIN pg_class r ON r.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND tgname LIKE 'trg_sync_%_paise'
    `;
    const present = new Set(rows.map((r) => r.tgname));
    for (const table of [
      "bookings",
      "payments",
      "wallet_transactions",
      "withdrawals",
      "earnings",
      "ledger_entries",
      "refund_requests",
      "users_money",
      "providers_money",
    ]) {
      expect(present.has(`trg_sync_${table}_paise`)).toBe(true);
    }

    const fn = await prisma.$queryRaw<Array<{ proname: string }>>`
      SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND proname = 'money_to_paise'
    `;
    expect(fn.length).toBe(1);
  });

  it("carries the consumer-idempotency arbiters the event handlers claim against", async () => {
    if (!(await dbReachable())) return;
    // A handler that claims by INSERT and treats P2002 as "already done" is only idempotent while
    // the index exists. Without it the claim silently becomes a second row.
    const idx = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
        'scheduled_jobs_review_request_trigger_event_id_key',
        'ml_feature_staging_event_id_key',
        'notifications_partner_referral_dedup_key',
        'notifications_booking_accepted_dedup_key'
      )
    `;
    expect(new Set(idx.map((i) => i.indexname)).size).toBe(4);
  });
});
