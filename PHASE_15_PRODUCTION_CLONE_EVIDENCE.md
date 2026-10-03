# PHASE 15 — Production Clone Rehearsal Evidence

The full migration set was run against a real clone of production, and the application was booted
against the result. This is the measurement, not a plan.

---

## A. The clone

```
CREATE DATABASE homigo_rehearsal TEMPLATE homigo_db     -> 5.667 s
```

A byte-for-byte template copy of the 1001 MB production database, inside the same
`homigo-postgres` container. Pre-migration state, read back from the clone itself:

```
migrations applied : 97   (of 100 ledger rows)
enterprise_audit_logs : 353,220
bookings : 670
payments : 392
```

## B. The migration run

```
bunx prisma migrate deploy   ->   exit 0
runtime: 28,306 ms
```

12 migrations applied, ending with `20260909090000_booking_slot_half_open_ranges` (the back-to-back
booking fix authored in this pass). Output ended with *"All migrations have been successfully
applied."*

## C. Post-migration verification

Read back from the clone with direct SQL — not from application logs.

| Invariant | Before | After | Verdict |
|---|---|---|---|
| Migrations applied | 97 | **109** | +12 |
| Ledger rows | 100 | 112 | 3 rolled-back rows retained, not re-run |
| `enterprise_audit_logs` | 353,220 | **353,220** | **zero data loss** |
| `bookings` | 670 | 670 | unchanged |
| `payments` | 392 | 392 | unchanged |
| Public tables | 203 | 212 | +9 |
| `trace_id` unique | true | **false** | **the Phase-14 audit blocker is cleared by the migration** |
| Slot ranges half-open | false | **true** | back-to-back bookings become possible |
| `ml_model_versions` | absent | **present** | |
| `ai_budget_policies` / `_windows` | absent | **present** | |
| `ai_workflow_drafts` | absent | **present** | |

The two rows that matter most are `trace_id` and the audit row count: the migration removes the
constraint that caps the audit log at one event per trace, and does so without losing a single one
of the 353,220 existing audit records.

## D. Application boot against the migrated clone

The real entry point (`src/index.ts`), pointed at `homigo_rehearsal`, on port 3399:

```
Server:  http://localhost:3399
Swagger: http://localhost:3399/swagger
Health:  http://localhost:3399/health

scheduled_job_processor_started   {"intervalMs":10000,"batchSize":25}
event_consumer_ok                 metrics.v1 / ai-context-indexer.v1 / automation-trigger.v1
workflow_instance_started         workflowId=checkout_recovery
security:LEDGER_BACKFILL_RUN      scanned=444 backfilled=0 skipped=444 failed=0
```

HTTP server, scheduled-job processor, event bus, workflow engine and ledger reconciliation all came
up against the migrated schema. The workflow fingerprint gate passed — workflow instances started,
which it blocks when definitions do not match.

## E. Two real problems the boot exposed

A rehearsal that only confirms what you hoped is not a rehearsal. This one surfaced two genuine
defects, and both are production conditions, not clone artifacts.

### E1 — Audit rows were being silently discarded for system actors — **FIXED**

```
[ERROR] audit-log persistence failed
        {"event":"LEDGER_BACKFILL_RUN",
         "error":"Foreign key constraint violated on activity_logs_user_id_fkey"}
```

Twice in a 75-second boot. `activity_logs.user_id` is a foreign key to `users.id`, but
`ledgerReconciliationService` identifies itself as `"ledger-reconciliation"` — a label, not an
account. Postgres rejects it, the whole audit row is lost, and the catch logs and moves on. **A
successful privileged action left no audit record.**

Fixed in `audit-log.service.ts`: on `P2003` the row is rewritten with a null actor FK and the actor
label preserved in the payload. Proven at runtime by
`src/__tests__/audit-system-actor.test.ts` — the row now exists, `userId` is null, and
`systemActor` reads `"ledger-reconciliation"`.

### E2 — Production financial integrity is at 84, with two open HIGH drifts

```
WALLET_LIABILITY_MISMATCH   ops Rs.106,998    vs ledger Rs.107,998      gap Rs.1,000
PROVIDER_PAYABLE_MISMATCH   ops Rs.121,849.40 vs ledger Rs.120,866.40   gap Rs.983
```

Pre-existing, not introduced here, and not fixed here — repairing a ledger drift means writing to
production. Recorded so it is not discovered after a deployment and attributed to it.

## F. What this rehearsal does and does not establish

**Establishes:** the migration set applies cleanly to real production data in ~28 seconds, loses
nothing, clears the `trace_id` blocker, creates the ML-registry and AI-budget tables, and the
application boots fully against the result.

**Does not establish:** that the system works under production traffic. There is no deployed
production runtime to compare against — nothing is serving. Boot is not load, and a clone on the
same host is not a production host.
