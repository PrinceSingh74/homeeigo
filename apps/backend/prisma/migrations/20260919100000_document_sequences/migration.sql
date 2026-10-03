-- Atomic daily counters for human-readable document numbers
-- (HOMIGO-YYYYMMDD-NNNNN bookings, WXN-… wallet transactions, WD-… withdrawals).
--
-- The generators read the day's highest number and added one, so two concurrent creates minted the
-- same number and one of them failed on the unique key (bookings retried; most wallet paths did not).
-- One row per (scope, day), incremented with INSERT … ON CONFLICT DO UPDATE … RETURNING.
--
-- Hand-scoped and additive (see prisma/README.md and memory: a generated diff drops the booking
-- slot-exclusion columns). Creates one table; touches no existing object.
CREATE TABLE IF NOT EXISTS "document_sequences" (
    "scope" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "value" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("scope", "day"),
    CONSTRAINT "document_sequences_value_positive" CHECK ("value" > 0)
);
