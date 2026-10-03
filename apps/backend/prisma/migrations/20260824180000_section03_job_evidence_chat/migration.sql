-- Section 03: job evidence + booking chat (additive).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JobEvidenceStage') THEN
    CREATE TYPE "JobEvidenceStage" AS ENUM ('ARRIVAL', 'START', 'COMPLETION');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "job_evidence" (
  "id" TEXT NOT NULL,
  "booking_id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "stage" "JobEvidenceStage" NOT NULL,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "media_storage_key" TEXT,
  "media_mime_type" TEXT,
  "media_url" TEXT,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "client_upload_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "job_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "job_evidence_booking_id_stage_client_upload_id_key"
  ON "job_evidence" ("booking_id", "stage", "client_upload_id");

CREATE INDEX IF NOT EXISTS "job_evidence_booking_id_stage_is_current_idx"
  ON "job_evidence" ("booking_id", "stage", "is_current");

CREATE INDEX IF NOT EXISTS "job_evidence_provider_id_idx"
  ON "job_evidence" ("provider_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_evidence_booking_id_fkey'
  ) THEN
    ALTER TABLE "job_evidence"
      ADD CONSTRAINT "job_evidence_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_evidence_provider_id_fkey'
  ) THEN
    ALTER TABLE "job_evidence"
      ADD CONSTRAINT "job_evidence_provider_id_fkey"
      FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "booking_conversations" (
  "id" TEXT NOT NULL,
  "booking_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_conversations_booking_id_key"
  ON "booking_conversations" ("booking_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_conversations_booking_id_fkey'
  ) THEN
    ALTER TABLE "booking_conversations"
      ADD CONSTRAINT "booking_conversations_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "booking_messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "sender_user_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "client_message_id" TEXT,
  "delivered_at" TIMESTAMP(3),
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_messages_conversation_id_client_message_id_key"
  ON "booking_messages" ("conversation_id", "client_message_id");

CREATE INDEX IF NOT EXISTS "booking_messages_conversation_id_created_at_idx"
  ON "booking_messages" ("conversation_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_messages_conversation_id_fkey'
  ) THEN
    ALTER TABLE "booking_messages"
      ADD CONSTRAINT "booking_messages_conversation_id_fkey"
      FOREIGN KEY ("conversation_id") REFERENCES "booking_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_messages_sender_user_id_fkey'
  ) THEN
    ALTER TABLE "booking_messages"
      ADD CONSTRAINT "booking_messages_sender_user_id_fkey"
      FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
