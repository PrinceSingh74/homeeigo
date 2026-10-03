-- Durable provenance for business-shaped rows.
--
-- WHY THIS EXISTS
-- ---------------
-- On 2026-09-21, 97% of `refund_requests` were test or certification artifacts:
--
--   CERTIFICATION  289  (f2 cert, phase-5a certification, t07 race, adv rbac test, independent audit)
--   TEST            38  (E2E cleanup, E2E wallet refund test, "Created accidentally during
--                        automated UI verification")
--   FAULT_INJECTION  2  (gateway rejection, gateway timeout)
--   REAL?           10  (Cancelled by partner)
--
-- Of 18 distinct refund reasons, two read as genuine business events. The same contamination
-- reaches bookings (55 linked to `f2 cert` refunds) and users (88 of 882 with synthetic e-mail).
--
-- The defect is NOT that the rows exist — test data in a development database is normal and
-- deleting it is never proposed here. The defect is that **provenance survives only as free text
-- somebody happened to type into `reason`**. That means:
--
--   * classification is a regex over prose;
--   * a future certification run that omits a marker is INDISTINGUISHABLE from real business;
--   * no query can reliably exclude synthetic rows, so no analytic can be trusted.
--
-- SCOPE — deliberately the smallest architecture that gives complete lineage
-- --------------------------------------------------------------------------
-- Three tables carry the column: `users`, `bookings`, `refund_requests`.
--
-- `payments` and `wallet_transactions` deliberately do NOT. Every payment has a parent booking
-- (verified: 0 orphan payments), so a payment's origin is its booking's origin, and a wallet
-- transaction's is its user's or provider's. Adding a fourth and fifth column would create two more
-- places for the truth to disagree with itself. Children derive; they do not duplicate.
--
-- DECLARED vs INFERRED
-- --------------------
-- A label derived from a regex over historical prose is not the same fact as a label a script
-- declared about a row it was creating. Conflating them would let this document's own guesswork
-- harden into "data". The enum therefore carries both, and the analytics policy treats
-- `INFERRED_*` exactly as it treats its declared counterpart while keeping the distinction legible.
--
-- NULL means UNKNOWN. Historical rows stay NULL until a rule can classify them, and an unclassified
-- row is treated as real by the analytics policy — which fails safe for genuine history and unsafe
-- only for a script that skipped the field, which §5E prevents at the source.
--
-- SAFETY
-- ------
-- Additive only: one new type, three nullable columns. No row is read, written, deleted or
-- rewritten. No index, constraint, trigger or sequence is touched. Safe on a fresh database and on
-- the existing one, and a no-op for anything already present.

CREATE TYPE "DataOrigin" AS ENUM (
  -- Declared by the code path that created the row.
  'REAL',
  'FIXTURE',
  'TEST',
  'CERTIFICATION',
  'SYNTHETIC',
  -- Derived after the fact from existing markers. Reproducible by an explicit rule, never a guess
  -- promoted to a fact.
  'INFERRED_FIXTURE',
  'INFERRED_TEST',
  'INFERRED_CERTIFICATION',
  'INFERRED_SYNTHETIC'
);

-- Nullable with no default on purpose. A default of 'REAL' would silently relabel every historical
-- row as genuine business data, which is the exact failure this migration exists to prevent.
ALTER TABLE "users"           ADD COLUMN IF NOT EXISTS "data_origin" "DataOrigin";
ALTER TABLE "bookings"        ADD COLUMN IF NOT EXISTS "data_origin" "DataOrigin";
ALTER TABLE "refund_requests" ADD COLUMN IF NOT EXISTS "data_origin" "DataOrigin";

COMMENT ON COLUMN "users"."data_origin" IS
  'Provenance. NULL = UNKNOWN. INFERRED_* is derived from historical markers, not declared. Business analytics default to (data_origin IS NULL OR data_origin = ''REAL'').';
COMMENT ON COLUMN "bookings"."data_origin" IS
  'Provenance. NULL = UNKNOWN. See users.data_origin.';
COMMENT ON COLUMN "refund_requests"."data_origin" IS
  'Provenance. NULL = UNKNOWN. See users.data_origin.';

-- No index is created here. All three tables are small (users 882, bookings 705, refund_requests
-- 339) and `data_origin` is low-cardinality, so an index would cost writes and return nothing.
-- Add a partial index on the non-REAL values when a table passes ~100k rows; that is a measurement,
-- not a guess to make now.
