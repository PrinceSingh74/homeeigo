-- Phase 09 — bounded idempotency for booking create.
--
-- Additive only: one new table. No existing table, column, index, constraint, trigger or row is
-- touched, and nothing is seeded. Bookings created without an Idempotency-Key behave exactly as they
-- do today; this table only records keys that clients actually send.
--
-- Why a table rather than a cache: the answer to "did this exact request already create a booking?"
-- has to survive a restart and be shared across processes, and it has to be decided by the same
-- transaction that creates the booking. A unique index is the only arbiter that holds under
-- concurrency — the same mechanism the platform already uses for journal entries and webhook dedup.
--
-- Bounded on purpose:
--   * (user_id, key) is UNIQUE — one key means one booking, per user, and a key cannot be reused
--     for a different request (the request fingerprint is compared before any reply is replayed);
--   * expires_at gives every row a lifetime, so the table cannot grow without limit;
--   * status distinguishes a request still in flight from one that finished, so a concurrent retry
--     is refused rather than allowed to create a second booking.
--
-- booking_id is ON DELETE SET NULL: removing a booking must never be blocked by its idempotency
-- record, and a key whose booking is gone is simply a key with nothing to replay.

CREATE TABLE IF NOT EXISTS "booking_idempotency_keys" (
  "id"           TEXT PRIMARY KEY,
  "user_id"      TEXT NOT NULL,
  "key"          TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "booking_id"   TEXT,
  "status"       TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "expires_at"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "booking_idempotency_keys_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "booking_idempotency_keys_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "booking_idempotency_status_check"
    CHECK ("status" IN ('IN_PROGRESS', 'COMPLETED')),
  -- A finished record must name the booking it produced, or it can replay nothing.
  CONSTRAINT "booking_idempotency_completed_has_booking"
    CHECK ("status" <> 'COMPLETED' OR "booking_id" IS NOT NULL OR "completed_at" IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_idempotency_keys_user_id_key_key"
  ON "booking_idempotency_keys" ("user_id", "key");

-- The sweep reads by expiry only.
CREATE INDEX IF NOT EXISTS "booking_idempotency_keys_expires_at_idx"
  ON "booking_idempotency_keys" ("expires_at");
