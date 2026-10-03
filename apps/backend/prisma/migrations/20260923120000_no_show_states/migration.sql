-- §52/§53 — no-show outcomes (owner decision 2026-09-23).
--
-- Additive only: two enum VALUES. No table, column, index, constraint, trigger or row is touched,
-- and no existing row can carry either value until the no-show path writes it.
--
-- Why they are distinct values and not a reason string on a cancellation:
--   * a customer no-show and a partner no-show have DIFFERENT money (the customer forfeits a capped
--     fee in one, and is made whole in the other) and different consequences for partner scoring;
--   * folding either into CANCELLED_BY_USER / CANCELLED_BY_PROVIDER would put the wrong party's name
--     on the outcome, and those statuses already feed cancellation-rate and partner-reliability
--     reporting;
--   * §53 is explicit that a provider no-show must never become a customer no-show, which is only
--     enforceable if the two are separate states.
--
-- Capacity release comes free: both sit outside the active set in `bookings_sync_conflict_slots`,
-- so the trigger nulls the slot columns exactly as it does for a cancellation.

ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'CUSTOMER_NO_SHOW';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'PROVIDER_NO_SHOW';
