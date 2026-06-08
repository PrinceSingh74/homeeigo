-- P1 webhook dedup state machine
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

ALTER TABLE "webhook_event_dedup"
  ADD COLUMN "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN "gateway_event_id" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_error" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "webhook_event_dedup" SET "status" = 'PROCESSED' WHERE "status" = 'RECEIVED';

CREATE INDEX "webhook_event_dedup_status_idx" ON "webhook_event_dedup"("status");
