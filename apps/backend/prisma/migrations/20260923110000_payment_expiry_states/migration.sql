-- Phase 09 — PAYMENT_PENDING_TTL (owner decision 2026-09-23: 15 minutes).
--
-- Additive only: two new enum VALUES. No table, column, index, constraint, trigger or row is
-- touched, and no existing row can carry either value until the expiry job writes it.
--
-- Why new values rather than reusing existing ones:
--   * a booking that expired unpaid is not CANCELLED_BY_USER — the customer cancelled nothing, and
--     that status feeds cancellation-rate reporting;
--   * it is not CANCELLED_BY_PROVIDER either — that status feeds PARTNER RELIABILITY SCORING, so
--     reusing it would penalise a partner for a customer's unfinished payment;
--   * it is not REJECTED, which means a partner refused the job.
--   An expired booking is a fourth thing, and saying so is the only honest option.
--
--   PaymentStatus.EXPIRED is likewise distinct from FAILED: FAILED means the gateway declined a real
--   attempt; EXPIRED means the window closed with no capture. Finance reporting must be able to tell
--   an abandoned checkout from a declined card.
--
-- Capacity release needs no new code: `bookings_sync_conflict_slots` nulls user_slot_* and
-- provider_slot_* for any status outside ('PENDING','ACCEPTED','ASSIGNED','EN_ROUTE','IN_PROGRESS'),
-- and the GiST exclusion constraints only apply where those columns are NOT NULL. Moving a booking
-- to EXPIRED therefore frees the slot through the mechanism that already owns slots.
--
-- ADD VALUE is not transactional-unsafe here: PostgreSQL 16 allows it inside a transaction as long
-- as the new value is not USED in that same transaction. This migration only declares them.

ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
