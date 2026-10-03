-- P1/P2: lead merge audit indexes, MERGE activity type, acquisition spend.

ALTER TYPE "PartnerLeadActivityType" ADD VALUE IF NOT EXISTS 'MERGE';

CREATE INDEX IF NOT EXISTS "partner_leads_merged_into_lead_id_idx" ON "partner_leads"("merged_into_lead_id");
CREATE INDEX IF NOT EXISTS "partner_leads_duplicate_of_lead_id_idx" ON "partner_leads"("duplicate_of_lead_id");

CREATE TABLE IF NOT EXISTS "acquisition_spend" (
    "id" TEXT NOT NULL,
    "source" "PartnerLeadSource" NOT NULL,
    "campaign" TEXT,
    "channel" TEXT,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "notes" TEXT,
    "created_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acquisition_spend_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "acquisition_spend_source_idx" ON "acquisition_spend"("source");
CREATE INDEX IF NOT EXISTS "acquisition_spend_period_start_period_end_idx" ON "acquisition_spend"("period_start", "period_end");
CREATE INDEX IF NOT EXISTS "acquisition_spend_campaign_idx" ON "acquisition_spend"("campaign");
