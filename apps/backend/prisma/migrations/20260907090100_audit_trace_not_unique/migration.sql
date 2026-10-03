-- Phase 14 — a trace id is a correlation key, not an identity.
--
-- `enterprise_audit_logs.trace_id` was UNIQUE, which capped the audit log at ONE event per
-- request. A single admin action routinely emits several — an approval and the promotion it
-- enables, a denial and the attempt behind it — and every event after the first failed its
-- insert and was swallowed by the audit service's catch. Demonstrated: emitting
-- ML_MODEL_APPROVED then ML_MODEL_PROMOTED under one trace stored only the approval.
--
-- Nothing reads this column by uniqueness; the only findUnique on the table is by `id`. The
-- index is retained because traces are filtered on.
DROP INDEX IF EXISTS "enterprise_audit_logs_trace_id_key";
CREATE INDEX IF NOT EXISTS "enterprise_audit_logs_trace_id_idx"
  ON "enterprise_audit_logs" ("trace_id");
