-- Four-axis lock: add canonical VERIFIED. Legacy KYC_PENDING / VERIFICATION / APPROVED
-- remain on the enum for history rows and are mapped on read.
ALTER TYPE "PartnerLifecycleState" ADD VALUE IF NOT EXISTS 'VERIFIED';
