-- Phase 6C-E — the decision log. Additive only: one enum, one table, five indexes.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationDecision') THEN
    CREATE TYPE "NotificationDecision" AS ENUM (
      'ALLOWED',
      'SUPPRESSED_RECIPIENT_DAILY_CAP',
      'SUPPRESSED_WORKFLOW_COOLDOWN',
      'DEFERRED_QUIET_HOURS',
      'PREFERENCE_SUPPRESSED',
      'BLOCKED_POLICY',
      'GOVERNANCE_UNAVAILABLE'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "notification_decision_audits" (
  "id"                   TEXT                   NOT NULL,
  "decision_id"          TEXT                   NOT NULL,
  -- Null for a deferral: the claim is released, so no delivery row survives to point at.
  "notification_id"      TEXT,
  -- The stable thread across attempts. A deferral and its resume share this and nothing else.
  "idempotency_key"      TEXT                   NOT NULL,
  "workflow_id"          TEXT,
  "workflow_version"     INTEGER,
  "workflow_instance_id" TEXT,
  "recipient_type"       TEXT                   NOT NULL,
  "recipient_id"         TEXT                   NOT NULL,
  "notification_type"    TEXT                   NOT NULL,
  "category"             "NotificationCategory" NOT NULL,
  "channel_intent"       "NotificationChannel",
  "decision"             "NotificationDecision" NOT NULL,
  "reason_code"          TEXT                   NOT NULL,
  "reason_text"          TEXT,
  "deferred_until"       TIMESTAMP(3),
  "trace_id"             TEXT,
  "correlation_id"       TEXT,
  "created_at"           TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_decision_audits_pkey" PRIMARY KEY ("id")
);

-- Structural backstop against a governance evaluation being recorded twice.
CREATE UNIQUE INDEX IF NOT EXISTS "notification_decision_audits_decision_id_key"
  ON "notification_decision_audits" ("decision_id");

-- "What has this person been told, and why" — the primary operational question.
CREATE INDEX IF NOT EXISTS "notification_decision_audits_recipient_idx"
  ON "notification_decision_audits" ("recipient_type", "recipient_id", "created_at");

-- "Is this workflow being suppressed more than it used to be."
CREATE INDEX IF NOT EXISTS "notification_decision_audits_workflow_idx"
  ON "notification_decision_audits" ("workflow_id", "created_at");

-- "Has the suppression rate moved" — dashboards read by decision, not by recipient.
CREATE INDEX IF NOT EXISTS "notification_decision_audits_decision_idx"
  ON "notification_decision_audits" ("decision", "created_at");

-- Joining a decision to the delivery it produced, and to the workflow run behind it.
CREATE INDEX IF NOT EXISTS "notification_decision_audits_notification_idx"
  ON "notification_decision_audits" ("notification_id");

CREATE INDEX IF NOT EXISTS "notification_decision_audits_instance_idx"
  ON "notification_decision_audits" ("workflow_instance_id");

-- trace_id and correlation_id are deliberately NOT indexed. They are join keys used when a specific
-- id is already in hand, and no current query scans by them; two indexes that earn nothing would
-- still be paid for on every write.
