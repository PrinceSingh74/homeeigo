-- customer_policy_decisions: let a booking be deleted (found by the Phase 10–11 conformance suite).
--
-- Defect: the table is append-only by trigger, and its booking FK is ON DELETE SET NULL. Deleting a
-- booking makes the referential-integrity trigger UPDATE the decision row (booking_id = NULL) — which
-- the append-only trigger refuses (P0001 "customer_policy_decisions is append-only"). So a booking
-- that has a decision row could not be deleted at all: every booking of a service with an explicit
-- age policy, which since the age-policy apply is every business booking. That blocks any
-- data-erasure purge. 20260926120000_purge_cascade_fixes fixed the same class for the §10/§11
-- tables; this table was missed.
--
-- Fix: the trigger still refuses every DIRECT update and every delete. The one update it lets
-- through is the referential-integrity unlink itself: fired from inside the parent's delete
-- (pg_trigger_depth() > 1), changing booking_id from a value to NULL and nothing else. The decision
-- row survives the booking, exactly as ON DELETE SET NULL intended — the record of why a booking was
-- allowed or refused is kept, only its pointer to the erased booking is cleared.
-- Replacement of one trigger function; no data touched.

CREATE OR REPLACE FUNCTION customer_policy_decisions_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND pg_trigger_depth() > 1
     AND OLD.booking_id IS NOT NULL
     AND NEW.booking_id IS NULL
     AND (to_jsonb(NEW) - 'booking_id') = (to_jsonb(OLD) - 'booking_id') THEN
    RETURN NEW; -- ON DELETE SET NULL from deleting the booking: the decision outlives its booking
  END IF;
  RAISE EXCEPTION 'customer_policy_decisions is append-only';
END;
$$ LANGUAGE plpgsql;
