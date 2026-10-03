-- Partner application "request changes" — return applicant to a specific onboarding step.

ALTER TYPE "PartnerRegistrationStatus" ADD VALUE IF NOT EXISTS 'CHANGES_REQUESTED';

ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "changes_requested_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "changes_requested_step" TEXT,
  ADD COLUMN IF NOT EXISTS "changes_requested_notes" TEXT;
