-- Certification governance hardening.
--
-- Nine partner-acquisition certifications were written by the boot path itself, with `certified_by`
-- defaulting to a service-account string and no human anywhere in the chain. Three things were
-- missing and are added here, all nullable so every existing row survives untouched:
--
--   approved_by_admin_id   the admin whose authorization produced the row, resolved against users
--   capability_fingerprint what the engine could execute when it was signed
--   voided_at/by/reason    withdrawal, recorded rather than deleted
--
-- Nullable on purpose: the nine existing rows have no admin and no fingerprint, and back-filling one
-- would invent an approval that never happened. Their nulls are the finding.
ALTER TABLE "automation_certifications" ADD COLUMN IF NOT EXISTS "approved_by_admin_id" TEXT;
ALTER TABLE "automation_certifications" ADD COLUMN IF NOT EXISTS "capability_fingerprint" TEXT;
ALTER TABLE "automation_certifications" ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMP(3);
ALTER TABLE "automation_certifications" ADD COLUMN IF NOT EXISTS "voided_by" TEXT;
ALTER TABLE "automation_certifications" ADD COLUMN IF NOT EXISTS "void_reason" TEXT;
