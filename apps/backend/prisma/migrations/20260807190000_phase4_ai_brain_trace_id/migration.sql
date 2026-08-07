-- Phase 4 remediation: traceId on activity timeline
ALTER TABLE "ai_activity_timeline" ADD COLUMN IF NOT EXISTS "trace_id" TEXT;
CREATE INDEX IF NOT EXISTS "ai_activity_timeline_trace_id_idx" ON "ai_activity_timeline"("trace_id");
