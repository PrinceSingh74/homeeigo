-- Phase 10 — customer policy decisions (age policy), append-only.
--
-- Before: `users.date_of_birth` existed but was written only by partner onboarding; no customer
-- policy was evaluated at booking time and there was no record of why a booking was allowed or
-- refused on policy grounds. The legal pages promise an age rule the platform never checked.
--
-- One row per evaluation of a customer policy for a booking attempt: the policy, its version, the
-- outcome and a reason code. `inputs` holds only what the decision used (whether an age was known,
-- the age in whole years, whether a guardian attestation was given) — never the date of birth, and
-- never anything a partner should see. A refusal has no booking, so booking_id is nullable.
--
-- Additive: one table, one index, one trigger.

CREATE TABLE IF NOT EXISTS "customer_policy_decisions" (
    "id"              BIGSERIAL PRIMARY KEY,
    "customer_id"     TEXT NOT NULL,
    "service_id"      TEXT NOT NULL,
    "booking_id"      TEXT REFERENCES "bookings"("id") ON DELETE SET NULL,
    "policy"          TEXT NOT NULL,
    "policy_version"  TEXT NOT NULL,
    "mode"            TEXT NOT NULL,
    "outcome"         TEXT NOT NULL,
    "reason_code"     TEXT NOT NULL,
    "inputs"          JSONB NOT NULL DEFAULT '{}'::jsonb,
    "request_id"      TEXT,
    "trace_id"        TEXT,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "customer_policy_decisions_policy_check" CHECK ("policy" IN ('CUSTOMER_AGE')),
    CONSTRAINT "customer_policy_decisions_outcome_check" CHECK ("outcome" IN ('ALLOWED', 'REFUSED', 'NOT_APPLICABLE'))
);
CREATE INDEX IF NOT EXISTS "customer_policy_decisions_customer_idx" ON "customer_policy_decisions" ("customer_id", "created_at");
CREATE INDEX IF NOT EXISTS "customer_policy_decisions_booking_idx" ON "customer_policy_decisions" ("booking_id") WHERE "booking_id" IS NOT NULL;

CREATE OR REPLACE FUNCTION customer_policy_decisions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'customer_policy_decisions is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "customer_policy_decisions_no_update" ON "customer_policy_decisions";
CREATE TRIGGER "customer_policy_decisions_no_update"
  BEFORE UPDATE OR DELETE ON "customer_policy_decisions"
  FOR EACH ROW EXECUTE FUNCTION customer_policy_decisions_append_only();
