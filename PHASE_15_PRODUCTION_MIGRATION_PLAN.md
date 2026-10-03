# PHASE 15 — Production Migration Plan

**This plan is rehearsed, not proposed.** Every number comes from an actual `prisma migrate deploy`
against a template clone of production (`PHASE_15_PRODUCTION_CLONE_EVIDENCE.md`).

**Authorization status: ABSENT. This plan is ready to execute and has not been executed.**

---

## A. The exact set — 12 migrations, in dependency order

Prisma applies these in lexical-timestamp order; the order below is the order it actually used.

| # | Migration | Delivers | Destructive? |
|---|---|---|---|
| 1 | `20260609130000_baseline_repair_db_push_drift` | reconciles `chargebacks.risk_level`, `geofences.service_categories` | no |
| 2 | `20260817110000_notification_delivery_claim` | claim-before-send on notification deliveries | no |
| 3 | `20260903090000_support_ai_recommendations` | support recommendation storage | no |
| 4 | `20260904090000_knowledge_base` | RAG knowledge base | no |
| 5 | `20260905090000_knowledge_authority` | knowledge authority table | no |
| 6 | `20260906090000_ml_model_governance` | **`ml_model_versions`** | no |
| 7 | `20260907090000_phase14_governance` | **`ai_budget_policies`, `ai_budget_windows`**, policy versioning | no |
| 8 | `20260907090100_audit_trace_not_unique` | **drops the `trace_id` unique index** | drops 1 index |
| 9 | `20260907090200_retention_categories` | audit retention categories | no |
| 10 | `20260907100000_partner_lifecycle_verified` | partner lifecycle state | no |
| 11 | `20260908090000_phase15_workflow_drafts` | **`ai_workflow_drafts`** | no |
| 12 | `20260909090000_booking_slot_half_open_ranges` | half-open slot ranges | drops + recreates 2 constraints |

**No migration in this set contains `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` or `DELETE FROM`** —
verified by scanning all twelve. The only drops are of an index (#8) and two exclusion constraints
that are immediately recreated (#12).

## B. Measured cost

```
total runtime      : 28,306 ms   (exit 0)
clone creation     :  5,667 ms
data loss          : none - 353,220 audit rows before and after
row counts         : bookings 670 -> 670, payments 392 -> 392
schema growth      : 203 -> 212 public tables
```

## C. Lock risk

Two migrations take meaningful locks; the rest create new objects and are effectively free.

| Migration | Lock | Why it matters |
|---|---|---|
| #8 `audit_trace_not_unique` | `DROP INDEX` takes ACCESS EXCLUSIVE on `enterprise_audit_logs` | 353,220 rows, but dropping an index is a catalog operation — brief |
| #12 `booking_slot_half_open_ranges` | **ACCESS EXCLUSIVE on `bookings` while two GiST indexes rebuild** | The real one. `bookings` is a hot table; the rebuild blocks reads and writes for its duration |

At production's current size (670 bookings) #12 completed within the 28 s total. **That number does
not transfer to a larger `bookings` table** — the rebuild is proportional to row count, and this
plan should be re-timed against a clone taken at deployment time rather than trusting today's
figure.

**Schedule #12 in a maintenance window.** Everything else can run at any time.

## D. Pre-deploy checks

1. Take a fresh backup and **verify the restore**, not just the backup (`scripts/verify-backup-restore.ts`).
2. Re-clone production and re-run this rehearsal — the measurement above ages.
3. Confirm the deployed application version understands the new schema. Migrations #6, #7, #11
   create tables the current production code does not read; they are additive and safe ahead of a
   code deploy.
4. Confirm no long-running transaction holds `bookings` (#12 will queue behind it and block
   everything arriving after).
5. Re-measure `financialIntegrityService.validate()`. It currently scores **84** with two open HIGH
   drifts — record that number before deploying so it is not later blamed on the migration.

## E. Post-deploy verification — run these, do not trust logs

```sql
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) FROM _prisma_migrations;  -- expect 109
SELECT count(*) FROM enterprise_audit_logs;                                                                  -- expect the pre-deploy count, unchanged
SELECT bool_or(indexdef ILIKE 'CREATE UNIQUE%') FROM pg_indexes
  WHERE tablename='enterprise_audit_logs' AND indexdef ILIKE '%trace_id%';                                   -- expect false
SELECT bool_and(pg_get_constraintdef(oid) LIKE '%''[)''%') FROM pg_constraint
  WHERE conname LIKE 'bookings_%slot_excl';                                                                   -- expect true
SELECT to_regclass('public.ml_model_versions'), to_regclass('public.ai_budget_policies'),
       to_regclass('public.ai_workflow_drafts');                                                              -- expect all non-null
```

Then boot the application and confirm the scheduled-job processor, event consumers and workflow
engine start — all four were observed starting against the migrated clone.

## F. Rollback strategy — stated honestly

| Migration | Rollback |
|---|---|
| #1-#7, #9-#11 | **Additive.** Rolling back means dropping new tables/columns. Safe only before the new code writes to them; after that it is data loss |
| #8 `audit_trace_not_unique` | **Cannot be reversed once used.** Re-creating the unique index fails the moment a second audit row shares a trace — which is the entire point of the change. Forward-fix only |
| #12 `booking_slot_half_open_ranges` | Reversible in principle (`'[)'` -> `'[]'`), but fails if any two bookings now touch at a boundary — exactly the bookings the change exists to permit. Forward-fix only |

**Two of these twelve migrations are one-way.** Not because they destroy data, but because the
states they enable are legal afterwards and illegal before. Any plan promising a clean rollback of
the full set would be promising something that cannot be delivered.

The genuine recovery path for #8 and #12 is **restore from the pre-deploy backup**, which is why
step 1 of the pre-deploy checks is verifying the restore rather than the backup.

## G. What blocks execution

`IS_EXPLICIT_PRODUCTION_AUTHORIZATION_PRESENT = NO` — no environment variable, no authorization
file, and no convention in the codebase. The plan stops here by rule, not by uncertainty: it is
rehearsed, verified, and ready.
