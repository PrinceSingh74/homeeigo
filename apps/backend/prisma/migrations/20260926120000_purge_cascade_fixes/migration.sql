-- Purge-cascade fixes for the §10/§11 tables (found by the first full regression whose fixture
-- cleanup actually ran — the X-4 no-op had masked it).
--
-- Defect: the append-only triggers on booking_quality_verdicts / booking_case_events /
-- booking_case_evidence block EVERY delete, including the ON DELETE CASCADE fired when a booking
-- (or its case) is legitimately hard-deleted — so a booking that ever received a verdict could not
-- be deleted at all (P0001), which breaks test cleanup today and any data-erasure purge tomorrow.
-- Two FKs also broke the same cascade: booking_completions.case_id had no ON DELETE action, and
-- booking_quality_verdicts.supersedes_id made same-table cascade order matter (P2003).
--
-- Fix: append-only still refuses every DIRECT update/delete (pg_trigger_depth() = 1), but lets a
-- CASCADE delete through (depth > 1: the referential-integrity trigger of the parent delete is the
-- outer frame). No application path can reach depth > 1 for these tables; only deleting the parent
-- row can — and deleting the parent is exactly the purge case the history must follow.
-- Additive/replacement of trigger functions and two FK actions; no data touched.

CREATE OR REPLACE FUNCTION booking_quality_verdicts_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD; -- cascade from deleting the booking itself: history follows its subject
  END IF;
  RAISE EXCEPTION 'booking_quality_verdicts is append-only: record a new verdict that supersedes the old one';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION booking_case_history_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD; -- cascade from deleting the case/booking
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- The completion row dies with its booking either way; when the CASE is what the cascade reaches
-- first, the row must follow it rather than block the whole delete.
ALTER TABLE "booking_completions" DROP CONSTRAINT IF EXISTS "booking_completions_case_id_fkey";
ALTER TABLE "booking_completions" ADD CONSTRAINT "booking_completions_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "booking_cases"("id") ON DELETE CASCADE;

-- Same-table supersedes chain: cascade order between a superseded verdict and its superseder is
-- not defined, so the reference itself must cascade. Direct deletes stay impossible (trigger above).
ALTER TABLE "booking_quality_verdicts" DROP CONSTRAINT IF EXISTS "booking_quality_verdicts_supersedes_id_fkey";
ALTER TABLE "booking_quality_verdicts" ADD CONSTRAINT "booking_quality_verdicts_supersedes_id_fkey"
  FOREIGN KEY ("supersedes_id") REFERENCES "booking_quality_verdicts"("id") ON DELETE CASCADE;
