# Stage C Step 6 — Staging Database Migration Certification Evidence

**Certification date:** 2026-08-03  
**Scope:** STAGING ONLY — project `homigo-497619`  
**Production impact:** NONE CONFIRMED  
**Result:** **NOT CERTIFIED — migration failed (P3018)**

---

## Release Identity

| Field | Value |
|-------|-------|
| APPLICATION_RC_SHA | `262befa14e249b51f94a5ba43cd692a8c5919db1` |
| MIGRATION_SOURCE_SHA | `262befa14e249b51f94a5ba43cd692a8c5919db1` |
| Migration source matched application RC | YES |
| Clean worktree | YES (`%TEMP%\homigo-step6-rc-262befa`) |

---

## Database Target (verified)

| Field | Value |
|-------|-------|
| Project | `homigo-497619` |
| Instance | `homigo-staging-db` |
| Database | `homigo_staging_db` |
| Engine | PostgreSQL 16 |
| Region | `asia-south1` |
| Network | Private IP only |
| Secret reference | `STAGING_DATABASE_URL` |
| STAGING VERIFIED | YES |
| PRODUCTION TARGETED | NO |

---

## Pre-Migration Recovery Gate

| Check | Result |
|-------|--------|
| Instance state | RUNNABLE |
| Backups | ON |
| PITR | ON |
| Tx log retention | 7 days |
| Deletion protection | ON |
| Latest backup | SUCCESSFUL (id `1785739802950`, ~2.8h old) |
| Readiness script | PASS |
| **PRE_MIGRATION_TIMESTAMP_UTC** | `2026-08-03T09:47:36.653Z` |

---

## Prisma Validation

| Gate | Result |
|------|--------|
| `bunx prisma validate` (clean RC worktree) | PASS |

---

## Pre-Migration Status

| Field | Value |
|-------|-------|
| Migrations in repository | 23 |
| Applied in `_prisma_migrations` | 0 (no history; schema partially present from prior non-migrate provisioning) |
| Pending | All 23 |
| Failed migrations | None (pre-execution) |
| Drift/history issue | **YES** — physical schema existed without Prisma migration history |

---

## Migration Review — `20260731120000_event_foundation`

| Assessment | Value |
|------------|-------|
| Present in APPLICATION_RC_SHA | YES |
| Destructive operations | NO (no DROP TABLE/COLUMN, TRUNCATE, DELETE) |
| Data-loss risk | NONE |
| Lock risk | LOW |
| Backward compatibility | PASS |

Creates: `event_outbox`, `event_consumer_receipts`, `event_dead_letters`, `scheduled_jobs`, `EventOutboxStatus` enum, booking ETA columns.

**Note:** `assignment_jobs` is created by earlier migration `20260608200000_membership_finalization`, not event_foundation.

---

## Migration Execution

| Field | Value |
|-------|-------|
| Command | `./node_modules/.bin/prisma migrate deploy` |
| Mechanism | Cloud Run Job `homigo-staging-migrate` (certified image digest) |
| Started (UTC) | `2026-08-03T09:50:22.803Z` |
| Completed (UTC) | `2026-08-03T09:50:51.636Z` |
| Duration | ~29 seconds |
| Exit | **FAIL (P3018)** |

### Applied before failure

1. `20260527105812_init`
2. `20260527160000_refresh_token_last_activity`
3. `20260527184532_auth_system_updatesauth_system_updates`
4. `20260528180000_add_provider_badges`

### Failed migration

**`20260529114745_part_6a_realtime_tracking`**

```
ERROR: index "providers_aadhar_number_key" does not exist
Database error code: 42704
Prisma error: P3018
```

Root cause: migration executes `DROP INDEX "providers_aadhar_number_key"` (and similar) but staging schema (provisioned without migrate history) never had those indexes.

---

## Post-Migration Status

| Field | Value |
|-------|-------|
| Prisma status | NOT UP TO DATE |
| Failed migration recorded | `20260529114745_part_6a_realtime_tracking` |
| Pending after failure | 18+ migrations including `20260731120000_event_foundation` |
| Event foundation applied | **NO** |

---

## Application State After Failure

| Check | Result |
|-------|--------|
| Cloud Run revision | `homigo-backend-staging-00017-wfk` (unchanged) |
| Image digest | `sha256:4dfa91d3…` (unchanged) |
| Application redeployed | NO |
| `/health` | PASS (200) |
| `/ready` | PASS (200) |
| `EVENTS_OUTBOX_ENABLED` | false |
| `EVENTS_CONSUMERS_ENABLED` | false |

---

## Recovery Posture After Attempt

| Check | Result |
|-------|-------|
| Backups | ON |
| PITR | ON |
| Deletion protection | ON |
| Instance | RUNNABLE |

---

## Recommended Recovery Action

PITR restore of `homigo-staging-db` to **`2026-08-03T09:47:36Z`** (pre-migration marker) using approved Step 4 runbook, **OR** controlled `prisma migrate resolve` analysis for the failed migration after DBA review.

**Do NOT** retry `migrate deploy`, `db push`, or `migrate reset` without explicit recovery plan.

---

## Production Safety

Production migration: NO  
Production DB modified: NO  
Production deployment: NO
