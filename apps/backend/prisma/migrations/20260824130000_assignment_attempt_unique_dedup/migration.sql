-- ALLOW_DATA_LOSS: collapses duplicate assignment attempts for the same (job, provider) before the
-- unique index is added, keeping the most recent attempt row. Retained pre-existing migration; the
-- declaration is added so the guard can distinguish reviewed deletion from accidental deletion.
-- P0-3, part 1: drop a stale, now-incompatible constraint. `assignment_attempts_one_sent_per_job`
-- (added 20260612000000, "at most ONE in-flight (SENT) dispatch per assignment job") predates
-- broadcast dispatch, which intentionally creates many simultaneous SENT rows for the same job_id
-- (one per offered provider, up to ASSIGNMENT_BROADCAST_FANOUT). Verified: this old index is
-- present on the `homigo_test` DB (applied via the test-setup custom-SQL step, which replays every
-- migration.sql containing CREATE UNIQUE INDEX) but NOT on the dev DB (migration drift — dev never
-- had `prisma migrate deploy` run for it). That drift is the ONLY reason broadcast dispatch works
-- in dev today: on any environment where this migration is actually applied (test, or a future
-- real `migrate deploy` to staging/prod), every SENT insert past the first in a broadcast round
-- would violate this index, throw P2002, and be silently swallowed by dispatchToNextProvider's
-- existing "already offered to this provider — skip, keep broadcasting" catch (which was written
-- for a *different*, provider-scoped constraint that never actually existed until this migration —
-- see part 2) — silently collapsing every broadcast dispatch to exactly one provider. Dropping it
-- here removes a live landmine, not a currently-relied-upon safeguard (no code references its name;
-- it is pure DB-level defense-in-depth for a dispatch mode — legacy single-offer — that predates
-- the current one).
DROP INDEX IF EXISTS assignment_attempts_one_sent_per_job;

-- P0-3, part 2: assignment_attempts had no unique constraint on (job_id, provider_id), even though
-- assignment-engine.service.ts::dispatchToNextProvider already catches Prisma P2002 ("Already
-- offered to this provider for this job — skip, keep broadcasting") assuming this constraint
-- exists. It never did, so two concurrent dispatch paths for the same booking (the immediate
-- dispatchBookingNow() call on booking-create racing a processQueue() cron tick, or two ticks
-- interleaving before either committed) could both successfully insert a SENT attempt row for
-- the same provider — confirmed against real dev data: 34 duplicate (job_id, provider_id) pairs,
-- all 2-row duplicates, existed before this migration.

-- Dedup first: keep exactly one row per (job_id, provider_id), preferring a row that reflects a
-- genuine partner response (ACCEPTED, then REJECTED) over a race artifact (SENT/TIMEOUT/
-- SUPERSEDED), tie-broken by earliest dispatch. Verified against real data: 2 of the 34 duplicate
-- groups had mixed statuses (one ACCEPTED + one TIMEOUT each) — a naive "keep earliest" rule
-- would have deleted a genuine ACCEPTED row in one of those two groups, so status is ranked first.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY job_id, provider_id
      ORDER BY
        CASE status
          WHEN 'ACCEPTED' THEN 0
          WHEN 'REJECTED' THEN 1
          ELSE 2
        END,
        dispatched_at ASC
    ) AS rn
  FROM assignment_attempts
)
DELETE FROM assignment_attempts
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Enforce going forward.
ALTER TABLE "assignment_attempts"
  ADD CONSTRAINT "assignment_attempts_job_id_provider_id_key" UNIQUE ("job_id", "provider_id");
