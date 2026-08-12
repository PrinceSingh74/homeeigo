-- Defense-in-depth: at most ONE in-flight (SENT) dispatch per assignment job.
-- Prevents duplicate dispatch even under concurrent workers / multi-instance
-- without Redis (the in-memory lock is per-process). Redispatch after timeout is
-- unaffected: the prior attempt is moved to TIMEOUT (not SENT) before the next.
CREATE UNIQUE INDEX IF NOT EXISTS assignment_attempts_one_sent_per_job
  ON assignment_attempts (job_id)
  WHERE status = 'SENT';
