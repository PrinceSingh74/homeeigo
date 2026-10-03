-- Phase 10 — persist AI support recommendations so a human decision can be compared against them.
--
-- Additive only: one new enum, one new table, one FK onto support_tickets. No existing column is
-- altered and no existing row is touched, so applying this cannot change any current behaviour.

CREATE TYPE "SupportRecommendationState" AS ENUM (
  'RECOMMENDATION', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED', 'EXPIRED'
);

CREATE TABLE "support_ai_recommendations" (
  "id"                    TEXT NOT NULL,
  "ticket_id"             TEXT NOT NULL,
  "rules_version"         TEXT NOT NULL,
  "recommendation_key"    TEXT NOT NULL,
  "intent"                TEXT,
  "sentiment"             TEXT,
  "model_confidence"      DOUBLE PRECISION,
  "classification_state"  TEXT NOT NULL,
  "used_fallback"         BOOLEAN NOT NULL DEFAULT false,
  "provider"              TEXT,
  "model"                 TEXT,
  "action"                TEXT NOT NULL,
  "risk"                  TEXT NOT NULL,
  "requires_human_review" BOOLEAN NOT NULL,
  "lifecycle"             "SupportRecommendationState" NOT NULL DEFAULT 'RECOMMENDATION',
  "acted_by"              TEXT,
  "acted_at"              TIMESTAMP(3),
  "acted_action"          TEXT,
  "overridden"            BOOLEAN,
  "approval_id"           TEXT,
  "failure_reason"        TEXT,
  "evidence"              JSONB NOT NULL,
  "limitations"           TEXT[],
  "eligibility_checks"    JSONB NOT NULL,
  "automation_eligible"   BOOLEAN NOT NULL DEFAULT false,
  "latency_ms"            INTEGER,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "support_ai_recommendations_pkey" PRIMARY KEY ("id")
);

-- The dedupe guarantee: one row per (ticket, rules version, context fingerprint). Re-analysing an
-- unchanged ticket updates the existing row instead of accumulating duplicates.
CREATE UNIQUE INDEX "support_ai_recommendations_recommendation_key_key"
  ON "support_ai_recommendations"("recommendation_key");

CREATE INDEX "support_ai_recommendations_ticket_id_created_at_idx"
  ON "support_ai_recommendations"("ticket_id", "created_at");
CREATE INDEX "support_ai_recommendations_lifecycle_idx"
  ON "support_ai_recommendations"("lifecycle");
CREATE INDEX "support_ai_recommendations_intent_idx"
  ON "support_ai_recommendations"("intent");
CREATE INDEX "support_ai_recommendations_action_idx"
  ON "support_ai_recommendations"("action");

ALTER TABLE "support_ai_recommendations"
  ADD CONSTRAINT "support_ai_recommendations_ticket_id_fkey"
  FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
