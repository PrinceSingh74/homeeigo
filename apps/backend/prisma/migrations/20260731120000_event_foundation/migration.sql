-- Homigo Intelligence Platform — Phase 0: Event & Reliability Foundation

-- CreateEnum
CREATE TYPE "EventOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- AlterTable: booking ETA ML label fields
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "en_route_at" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "arrived_at" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "travel_duration_min" INTEGER;

-- CreateTable
CREATE TABLE "event_outbox" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_version" TEXT NOT NULL DEFAULT '1.0',
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "actor_type" TEXT,
    "actor_id" TEXT,
    "payload" JSONB NOT NULL,
    "metadata" JSONB,
    "status" "EventOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_consumer_receipts" (
    "id" TEXT NOT NULL,
    "consumer_name" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "result" TEXT NOT NULL DEFAULT 'ok',
    "error_message" TEXT,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_consumer_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_dead_letters" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "consumer_name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "last_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "event_dead_letters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scheduled_jobs" (
    "id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "trigger_event_id" TEXT,
    "payload" JSONB NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "event_outbox_event_id_key" ON "event_outbox"("event_id");
CREATE INDEX "event_outbox_status_available_at_created_at_idx" ON "event_outbox"("status", "available_at", "created_at");
CREATE INDEX "event_outbox_aggregate_type_aggregate_id_idx" ON "event_outbox"("aggregate_type", "aggregate_id");
CREATE INDEX "event_outbox_event_type_created_at_idx" ON "event_outbox"("event_type", "created_at");
CREATE INDEX "event_outbox_status_locked_at_idx" ON "event_outbox"("status", "locked_at");

CREATE UNIQUE INDEX "event_consumer_receipts_consumer_name_event_id_key" ON "event_consumer_receipts"("consumer_name", "event_id");
CREATE INDEX "event_consumer_receipts_processed_at_idx" ON "event_consumer_receipts"("processed_at");

CREATE INDEX "event_dead_letters_consumer_name_created_at_idx" ON "event_dead_letters"("consumer_name", "created_at");
CREATE INDEX "event_dead_letters_event_type_idx" ON "event_dead_letters"("event_type");
CREATE INDEX "event_dead_letters_resolved_at_idx" ON "event_dead_letters"("resolved_at");

CREATE INDEX "scheduled_jobs_status_run_at_idx" ON "scheduled_jobs"("status", "run_at");
CREATE INDEX "scheduled_jobs_trigger_event_id_idx" ON "scheduled_jobs"("trigger_event_id");
CREATE INDEX "scheduled_jobs_job_type_status_idx" ON "scheduled_jobs"("job_type", "status");
