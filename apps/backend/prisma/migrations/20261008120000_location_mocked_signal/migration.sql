-- The mock-location signal (device attestation, first half; 2026-10-08).
--
-- Android marks every fix a mock-location app produced (`mocked: true` on the fix, set by the OS).
-- iOS has no such flag and older clients send nothing. The server now keeps that word with each
-- fix it stores, with three values: TRUE = the device says the fix was mocked, FALSE = the OS says
-- it was not, NULL = unknown. A TRUE fix is not a position the server holds: arrival, start and the
-- on-site check answer LOCATION_UNCONFIRMED on it, and a customer no-show reported on it takes no
-- fee (lib/arrival-position.ts, services/arrival-position.service.ts).
--
-- Two nullable columns, no default, no backfill: every fix stored before this migration is of
-- unknown provenance and stays NULL. Nothing is read or rewritten; no index (the flag is read with
-- the row it belongs to, never searched for).

ALTER TABLE "partner_presence" ADD COLUMN IF NOT EXISTS "last_location_mocked" BOOLEAN;
ALTER TABLE "location_history" ADD COLUMN IF NOT EXISTS "mocked" BOOLEAN;
