# PHASE 15 — Final Closure

# VERDICT: PHASE_15_BLOCKED_BY_PRODUCTION_MATURITY

**Not `PHASE_15_COMPLETE`.** That verdict requires independently verified production LIVE state, and
production LIVE state does not exist in this environment — not because the work is unfinished, but
because there is nothing deployed to be live *on*.

---

## A. The one fact that decides the verdict

**No application is running against production.** No process listens on any port. `homigo_db` is a
database holding real data; there is no serving environment attached to it, no worker, no scheduler,
no traffic.

Everything the brief defines as LIVE — a reachable route, a canary cohort, production traffic
verification, observed error and cost rates — requires a deployed runtime. Declaring LIVE against a
database with no application in front of it would be the exact failure this brief warns against.

## B. Production authorization: ABSENT

Searched before touching anything: shell environment, repository authorization files, and any
codebase convention (`PRODUCTION_MIGRATION_AUTHORIZED`, `ALLOW_PRODUCTION`, `CONFIRM_PRODUCTION`,
`--force-production`). **None exists.**

Per the brief's own rule, the instruction to make the system live does not authorize a production
mutation when the execution context provides no authorization mechanism. So: everything was
rehearsed, nothing was written.

## C. What was actually done this pass

| Work | Evidence |
|---|---|
| Production re-audited from zero, read-only | `PHASE_15_PRODUCTION_STATE_BASELINE.md` |
| 12 pending migrations identified in dependency order | `PHASE_15_PRODUCTION_MIGRATION_PLAN.md` |
| **Full migration set run against a real production clone** | `PHASE_15_PRODUCTION_CLONE_EVIDENCE.md` |
| Isolation incident measured properly, correcting my earlier report | `PHASE_15_PRODUCTION_ISOLATION_INCIDENT_FINAL.md` |
| Audit-loss defect found by the rehearsal and fixed | runtime test, section E |
| Full regression | **1999 pass / 0 fail / 0 deadlocks** |

### The rehearsal is the substantive result

```
CREATE DATABASE homigo_rehearsal TEMPLATE homigo_db   ->  5.7 s
prisma migrate deploy                                 ->  exit 0, 28,306 ms

migrations 97 -> 109        audit rows 353,220 -> 353,220  (zero loss)
trace_id unique true -> FALSE                              (Phase-14 blocker cleared)
slot ranges closed -> HALF-OPEN                            (back-to-back bookings fixed)
ml_model_versions, ai_budget_*, ai_workflow_drafts: absent -> PRESENT

application boot against the migrated clone: HTTP + scheduler + event bus + workflow engine all up
```

The deployment path is measured and ready. It stops at the authorization boundary, not a technical
one.

## D. Three prior claims this pass overturned

1. **"100 applied / 107 on disk."** 100 is the migration ledger's *row count*. The applied count is
   **97**; three rows are rolled back.
2. **"141 fixture bookings from one incident."** There are **231**, spanning 2026-06-09 to
   2026-09-05. Ninety of them **predate my incident by three months**, and the contamination reached
   the money path — 110 payments (₹58,333) and 14 CREDITED earnings (₹6,286.40). Fixture data is
   roughly **34% of all bookings** in production.
3. **A catalog query that would have cleared a live blocker.** `pg_constraint` reported `trace_id`
   as not unique; `pg_indexes` shows it is a unique *index*. The blocker stands. Recorded because
   this is precisely how a real blocker gets reported as fixed.

## E. Defect found and fixed this pass

**Audit rows were being silently discarded for system actors.** During the clone boot:

```
[ERROR] audit-log persistence failed
        {"event":"LEDGER_BACKFILL_RUN",
         "error":"Foreign key constraint violated on activity_logs_user_id_fkey"}
```

`activity_logs.user_id` is a foreign key to `users.id`, but background services identify themselves
with a label (`"ledger-reconciliation"`). Postgres rejected it, the audit row was lost, and the
catch logged and moved on — **a successful privileged action leaving no audit record**, twice in a
75-second boot.

Fixed by rewriting the row with a null actor FK and the label preserved in the payload. Proven at
runtime by `src/__tests__/audit-system-actor.test.ts`, not by reading the schema.

## F. Against the brief's 30 acceptance criteria

| Criterion | State |
|---|---|
| 1. Production migration maturity verified | **YES** — rehearsed, exit 0, zero data loss |
| 2. Required migrations applied to production | **NO — authorization absent** |
| 3–5. ML registry / AI budget / audit trace in production | **NO** — the tables are created by (2) |
| 6–8. Provider governance, RAG governance, RBAC | Verified in test; **unverifiable in production** until (2) |
| 9–11. Simulation, What-If, workflow drafting | Operational in test; not production-verifiable |
| 12. Multimodal | **Correctly blocked** — no injection-defence design or content-influence policy |
| 13. Voice | **Correctly blocked** — no STT/TTS adapter exists |
| 14. Recommendation | Deterministic baseline **beats** the learned model; baseline is used |
| 15. Fraud | Governed signals, no fabricated ML — 9 adjudicated labels is not a training set |
| 16. Cancellation | Not promoted — 0.24 SE advantage |
| 17–19. Customer / partner / admin surfaces | Assessed; nothing shipped the evidence does not support |
| 20–25. PII, injection, audit chaos, budget concurrency, observability, E2E | Pass in test |
| 26. **Canary** | **Impossible — nothing is deployed to canary onto** |
| 27. **Rollback verified** | **Partially. Two of the twelve migrations are one-way** — see below |
| 28–30. Forensic audit, no in-scope defect, production independently verified | Audit done; production verified as **behind** |

## G. Rollback, stated honestly

Two migrations **cannot be rolled back once used**:

- `20260907090100_audit_trace_not_unique` — re-creating the unique index fails the moment a second
  audit row shares a trace, which is the entire purpose of the change.
- `20260909090000_booking_slot_half_open_ranges` — reverting to closed ranges fails if any two
  bookings now touch at a boundary, which is exactly what the change permits.

Neither destroys data; both enable states that are legal afterwards and illegal before. The real
recovery path is restore-from-backup, which is why the plan's first pre-deploy step is verifying the
**restore**, not the backup.

A plan promising clean rollback of the full set would be promising something undeliverable.

## H. What must happen for PHASE_15_COMPLETE

1. **Grant production authorization** through a real mechanism.
2. Backup + verified restore; re-clone and re-time the rehearsal (today's 28 s figure ages).
3. Apply the 12 migrations, scheduling the `bookings` GiST rebuild in a maintenance window.
4. **Deploy the application** — the artifacts exist (`Dockerfile`, `deploy/cloud-run/service.yaml`);
   nothing is running.
5. Create production feature flags. Production currently holds **two flags, both `dev`, both off** —
   there is no flag state for any Phase-15 capability to roll out through.
6. Then, and only then, canary, observe real traffic, and re-verify from zero.

## I. Standing production statements

**No destructive mutation was performed.** An earlier test-isolation incident inserted 141 fixture
bookings and 60 payment rows into production; a wider audit found the true total is **231 fixture
bookings across three months**, with 110 payments and 14 CREDITED earnings attached. The incident is
documented and **awaiting authorized reconciliation**. Its mechanism is now closed at the
client-construction level.

Production financial integrity independently measures **84**, with two open HIGH ops-versus-ledger
drifts (₹1,000 and ₹983). Pre-existing, not repaired here — repairing a ledger drift is a production
write.

## J. The honest summary

The engineering is done and the deployment is rehearsed. What is missing is not code:
**authorization, a deployed runtime, and production feature flags.** None of the three can be
manufactured from this side, and inventing any of them is the one thing that would make this report
worthless.
