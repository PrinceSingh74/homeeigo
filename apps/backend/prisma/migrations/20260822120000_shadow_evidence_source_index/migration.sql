-- Evidence on this table is filtered by `source` before anything else: a certification may cite only
-- OBSERVATION rows, and TEST rows are swept on a separate schedule. The existing
-- (workflow_id, created_at) index does not cover that predicate, so the split scanned every row for
-- the workflow. This adds the composite that matches how the evidence is actually read.
CREATE INDEX IF NOT EXISTS "automation_shadow_executions_source_idx"
  ON "automation_shadow_executions" ("source", "workflow_id", "created_at");
