-- Phase 14 §64 — retention boundaries for data classes that had none.
--
-- Measured in production before adding these: activity_logs 113,704 rows growing since
-- 2026-06-08, ai_tool_policy_logs 14,607, workflow_step_runs 4,053, ai_gateway_requests 2,249,
-- ai_gateway_audit 1,913 — none of them reachable by any retention job. `AuditLogService` writes
-- the SAME governance event to enterprise_audit_logs (governed, archived, purged) and to
-- activity_logs (ungoverned, kept forever), so one event had two different lifetimes.
--
-- Adding a category does NOT delete anything. `audit_retention_policies` rows are created by a
-- person, and the sweep is a no-op for any category with no row, so this ships as capability with
-- the durations left undecided — which is the honest state, since no retention period for AI
-- telemetry has been agreed by this project.
ALTER TYPE "retention_category" ADD VALUE IF NOT EXISTS 'AI_TELEMETRY';
ALTER TYPE "retention_category" ADD VALUE IF NOT EXISTS 'AUTOMATION_TELEMETRY';
ALTER TYPE "retention_category" ADD VALUE IF NOT EXISTS 'OPERATIONAL_ACTIVITY';
