# HOMIGO PHASE 0 / STAGE C — STEP 7
# Physical Schema, Index & Constraint Certification

**Certified:** 2026-08-04T05:31:53Z (catalog audit)  
**Mode:** READ ONLY — no database mutations performed  
**APPLICATION_RC_SHA:** `e459175c72b1ece6e6246e5d69f559f23cd0a23e` (unchanged)  
**SCHEMA_CERT_SOURCE_SHA:** `e459175c72b1ece6e6246e5d69f559f23cd0a23e`  
**SCHEMA_CERT_WORKTREE:** `%TEMP%\homigo-step7-rc-e459175` (clean porcelain)  
**AUTHORITATIVE_DB:** `homigo-staging-step6a-pitr-20260803` / `homigo_staging_db`  
**FORENSIC_OLD_DB:** `homigo-staging-db` (not queried)

---

## Audit Method

1. Verified GCP staging identity (project, instance, Cloud Run revision, SQL annotation).
2. Verified RC from clean detached worktree at `e459175`.
3. Read-only PostgreSQL catalog audit via Cloud Run Job `homigo-staging-migrate` (execution `homigo-staging-migrate-txwpr`) using `deploy/scripts/step7-schema-audit.mjs`.
4. Cross-checked physical schema against committed migration `20260731120000_event_foundation/migration.sql` and Prisma models at RC.
5. Runtime probes: `/health`, `/ready`, `/metrics`; scoped log search for Phase-0 missing-object errors.
6. `prisma validate` via certified image (execution `homigo-staging-migrate-97hpn`).

**Schema fingerprint (Phase-0 tables + booking lifecycle columns + indexes):** `19be0a0b28220bb8c05d696634cb8564`

Machine-readable inventory: `phase0-schema-inventory.json`

---

## Executive Result

| Gate | Result |
|------|--------|
| **STEP 7** | **PASS** |
| **PHASE_0_SCHEMA_CERTIFICATION** | **PASS** |
| **FULL_APPLICATION_SCHEMA_PARITY** | **DEFERRED** |

---

## Environment

| Field | Value |
|-------|-------|
| Project | `homigo-497619` |
| Instance | `homigo-staging-step6a-pitr-20260803` |
| Database | `homigo_staging_db` |
| PostgreSQL | 16 |
| Region | `asia-south1` |
| Cloud Run revision | `homigo-backend-staging-00019-8hr` |
| Image digest | `sha256:3c3138aa0bee7405c43193abcf93ef947be3db5878b953735e91437f6ab5eefa` |
| Authoritative staging target | **YES** |
| Production targeted | **NO** |

Cloud Run SQL annotation: `homigo-497619:asia-south1:homigo-staging-step6a-pitr-20260803`  
Database URL secret: `STAGING_DATABASE_URL` (value not recorded)

---

## Release Identity

| Field | Value |
|-------|-------|
| APPLICATION_RC_SHA | `e459175c72b1ece6e6246e5d69f559f23cd0a23e` |
| Source clean | **YES** (`git rev-parse HEAD` = RC; porcelain empty) |
| RC retrievable | **YES** (`git cat-file -e` exit 0) |
| Authoritative migrations | 23 |
| Final Phase-0 migration | `20260731120000_event_foundation` |

---

## Migration State

| Metric | Value |
|--------|-------|
| Applied | 23 |
| Pending | 0 |
| Failed | 0 |
| Rolled back | 0 |
| `event_foundation` | **APPLIED** (`finishedAt`: 2026-08-03T12:21:17.653Z) |
| Prisma status | Database schema up to date (23/23) |

All 23 migration names match the git-tracked set at RC `e459175`. No failed or rolled-back rows in `_prisma_migrations`.

---

## Core Phase-0 Tables

| Table | Exists | Columns Match | PK | FK | Unique | Indexes | Result |
|-------|--------|---------------|----|----|--------|---------|--------|
| `event_outbox` | YES | YES | YES | N/A | YES | YES | **PASS** |
| `event_consumer_receipts` | YES | YES | YES | N/A | YES | YES | **PASS** |
| `event_dead_letters` | YES | YES | YES | N/A | N/A | YES | **PASS** |
| `scheduled_jobs` | YES | YES | YES | N/A | N/A | YES | **PASS** |

Phase-0 event tables intentionally define **no foreign keys** in `20260731120000_event_foundation`.

---

## event_outbox Certification

**OUTBOX_SCHEMA_READY: YES**

18 columns physically present; all match migration contract.

| Column | Expected Type | Actual Type | Nullable | Default | Match |
|--------|---------------|-------------|----------|---------|-------|
| id | TEXT NOT NULL | text | NO | — | YES |
| event_id | TEXT NOT NULL | text | NO | — | YES |
| event_type | TEXT NOT NULL | text | NO | — | YES |
| event_version | TEXT DEFAULT '1.0' | text | NO | `'1.0'::text` | YES |
| aggregate_type | TEXT NOT NULL | text | NO | — | YES |
| aggregate_id | TEXT NOT NULL | text | NO | — | YES |
| actor_type | TEXT | text | YES | — | YES |
| actor_id | TEXT | text | YES | — | YES |
| payload | JSONB NOT NULL | jsonb | NO | — | YES |
| metadata | JSONB | jsonb | YES | — | YES |
| status | EventOutboxStatus DEFAULT PENDING | EventOutboxStatus | NO | `'PENDING'::"EventOutboxStatus"` | YES |
| attempts | INTEGER DEFAULT 0 | int4 | NO | 0 | YES |
| last_error | TEXT | text | YES | — | YES |
| available_at | TIMESTAMP(3) DEFAULT now | timestamp | NO | CURRENT_TIMESTAMP | YES |
| locked_at | TIMESTAMP(3) | timestamp | YES | — | YES |
| locked_by | TEXT | text | YES | — | YES |
| published_at | TIMESTAMP(3) | timestamp | YES | — | YES |
| created_at | TIMESTAMP(3) DEFAULT now | timestamp | NO | CURRENT_TIMESTAMP | YES |
| updated_at | TIMESTAMP(3) NOT NULL | timestamp | NO | — | YES |

**PK:** `event_outbox_pkey` on `id` (TEXT)

**Unique:** `event_outbox_event_id_key` on `event_id`

**Indexes (all valid/ready):**

| Index | Columns | Purpose |
|-------|---------|---------|
| `event_outbox_status_available_at_created_at_idx` | status, available_at, created_at | Pending/retry polling |
| `event_outbox_status_locked_at_idx` | status, locked_at | Lease/stale-lock recovery |
| `event_outbox_aggregate_type_aggregate_id_idx` | aggregate_type, aggregate_id | Aggregate lookup |
| `event_outbox_event_type_created_at_idx` | event_type, created_at | Type/time ordering |

Correlation/causation stored in `metadata` JSONB per application design (no dedicated columns in Phase-0 migration).

**Index design sanity:** SUFFICIENT for outbox polling, retry scheduling, and locking.

---

## Consumer Receipt Certification

**CONSUMER_IDEMPOTENCY_DB_ENFORCEMENT: PASS**

6 columns match migration. Physical idempotency enforced by:

```
CREATE UNIQUE INDEX event_consumer_receipts_consumer_name_event_id_key
  ON event_consumer_receipts (consumer_name, event_id)
```

PostgreSQL will reject duplicate `(consumer_name, event_id)` pairs — **YES**, duplicate successful receipt registration is structurally prevented.

Supporting index: `event_consumer_receipts_processed_at_idx` on `processed_at` — SUFFICIENT for retention/audit queries.

---

## DLQ Certification

**DLQ_SCHEMA_READY: YES**

11 columns match migration (`event_id`, `event_type`, `consumer_name`, `payload` JSONB, `error`, `attempts`, `last_attempt_at`, `created_at`, `resolved_at`, `resolution`).

**Indexes (all valid/ready):**

| Index | Columns | Purpose |
|-------|---------|---------|
| `event_dead_letters_consumer_name_created_at_idx` | consumer_name, created_at | Consumer failure history |
| `event_dead_letters_event_type_idx` | event_type | Type filtering |
| `event_dead_letters_resolved_at_idx` | resolved_at | Unresolved/replay lookup |

**Index design sanity:** SUFFICIENT for operator DLQ workflows.

---

## Scheduled Jobs Certification

**SCHEDULED_JOB_SCHEMA_READY: YES**

12 columns match migration (`job_type`, `trigger_event_id`, `payload` JSONB, `run_at`, `status` DEFAULT `'pending'`, `attempts`, `last_error`, timestamps).

**Indexes (all valid/ready):**

| Index | Columns | Purpose |
|-------|---------|---------|
| `scheduled_jobs_status_run_at_idx` | status, run_at | Due-job polling |
| `scheduled_jobs_trigger_event_id_idx` | trigger_event_id | Event linkage |
| `scheduled_jobs_job_type_status_idx` | job_type, status | Type/status filtering |

No job idempotency unique constraint defined in Phase-0 migration (intentional).

**Index design sanity:** SUFFICIENT for scheduler due-time lookup.

---

## Booking Lifecycle Fields

Migration origin: `20260731120000_event_foundation` (`ALTER TABLE bookings`).

| Field | Exists | DB Type | Prisma Type | Nullable | Result |
|-------|--------|---------|-------------|----------|--------|
| en_route_at | YES | timestamp(3) | DateTime? | YES | **PASS** |
| arrived_at | YES | timestamp(3) | DateTime? | YES | **PASS** |
| travel_duration_min | YES | integer (int4) | Int? | YES | **PASS** |

**Booking indexes for lifecycle fields:** NOT REQUIRED BY AUTHORITATIVE MIGRATION (no indexes defined on these columns in Phase-0 boundary).

---

## Index Certification Summary

| Metric | Value |
|--------|-------|
| Expected (event_foundation) | 13 non-PK indexes + 4 PK unique indexes = **17** |
| Matched | **17** |
| Missing | **NONE** |
| Invalid / not ready | **NONE** |
| Unexpected relevant | **NONE** |

All indexes report `indisvalid=true`, `indisready=true`.

---

## Unique Constraints

Enforced via unique indexes (information_schema UNIQUE empty; pg_indexes confirms):

| Name | Table | Columns | Match |
|------|-------|---------|-------|
| `event_outbox_event_id_key` | event_outbox | event_id | YES |
| `event_consumer_receipts_consumer_name_event_id_key` | event_consumer_receipts | consumer_name, event_id | YES |

Event uniqueness + consumer idempotency: **PASS**

---

## Foreign Keys

Phase-0 authoritative migrations define **zero** FKs on the four event/reliability tables. Physical catalog confirms: **NONE** (expected).

---

## Defaults / Nullability / Types

**Mismatches: NONE** for Phase-0 contract.

Notable verified defaults:
- `event_outbox.status` → `PENDING`
- `event_outbox.attempts` → `0`
- `event_consumer_receipts.result` → `'ok'`
- `event_dead_letters.attempts` → `1`
- `scheduled_jobs.status` → `'pending'`
- `scheduled_jobs.attempts` → `0`

JSON payloads: `event_outbox.payload`, `event_dead_letters.payload`, `scheduled_jobs.payload` stored as **JSONB** (matches Prisma `Json`).

---

## Enums / Status Values

| Enum | Expected Values | Actual Values | Match |
|------|-----------------|---------------|-------|
| EventOutboxStatus | PENDING, PROCESSING, PUBLISHED, FAILED | PENDING, PROCESSING, PUBLISHED, FAILED | YES |

`scheduled_jobs.status` is TEXT (not enum) per migration — matches Prisma `String`.

---

## Prisma Compatibility

| Check | Result |
|-------|--------|
| prisma validate | **PASS** (Cloud Run Job, certified image) |
| prisma generate | **NOT_REQUIRED** (pre-generated client in image) |
| Physical mapping | **PASS** — models `EventOutbox`, `EventConsumerReceipt`, `EventDeadLetter`, `ScheduledJob`, booking lifecycle fields map 1:1 |

---

## Runtime Compatibility

| Endpoint | HTTP |
|----------|------|
| /health | **200** |
| /ready | **200** (OPS auth) |
| /metrics | **200** (OPS auth) |

| Check | Result |
|-------|--------|
| Phase-0 missing table errors | **NONE** (scoped log search, revision `00019-8hr`) |
| Phase-0 missing column errors | **NONE** |

---

## Deferred Schema Gap

| Item | Status |
|------|--------|
| 25 deferred uncommitted migrations | **NOT APPLIED** — legitimate post-Phase0 scope (Step 6C) |
| 2 superseded migrations | **DOCUMENTED** in Step 6C evidence |
| Geofence / GeofenceEvent | **SCHEMA ORPHAN** — no migration at RC |
| CityCoverageOverride | **SCHEMA ORPHAN** — no migration at RC |
| Deferred runtime P2021 noise | **NONE** in recent scoped logs (gift_cards, token_blacklist, etc.) |

**FULL_APPLICATION_SCHEMA_PARITY: DEFERRED** — application `schema.prisma` at RC references models beyond 23-migration boundary; this does not fail Phase-0 certification.

---

## Recovery Controls

| Control | State |
|---------|-------|
| Backups | **ON** (7 retained) |
| PITR | **ON** |
| Deletion protection | **ON** |
| Private network | **YES** (ipv4 disabled, private VPC) |

---

## Event State

| Flag | Value |
|------|-------|
| EVENTS_OUTBOX_ENABLED | **false** (service template + revision `00019-8hr`) |
| EVENTS_CONSUMERS_ENABLED | **false** |
| Outbox processor | **OFF** |
| Event consumers | **OFF** |

---

## Monitoring Target

Repo IaC (`deploy/monitoring/`) references **`homigo-staging-step6a-pitr-20260803`** exclusively.  
Old forensic instance `homigo-staging-db` **not** referenced as authoritative: **NO drift detected** in repo config.

---

## Production Safety

| Check | Result |
|-------|--------|
| Production DB modified | **NO** |
| Production migration | **NO** |
| Production deployment | **NO** |
| Production credentials used | **NO** |

---

## Evidence

| Artifact | Path |
|----------|------|
| This report | `docs/evidence/stage-c-step-7/step-7-schema-certification.md` |
| Schema inventory | `docs/evidence/stage-c-step-7/phase0-schema-inventory.json` |
| Audit script | `deploy/scripts/step7-schema-audit.mjs` |
| Secret scan | **PASS** (no passwords, connection strings, tokens, or PII in evidence) |
| PII in evidence | **NONE** |

---

## Post-Audit Cleanup

- Cloud Run Job `homigo-staging-migrate` restored to `prisma migrate deploy`.
- Temporary env var `STEP7_B64` removed.
- Raw audit log dump (contained job metadata only) deleted; not committed.

---

## Final Gate

```
============================================================
STAGE C — STEP 7 PASS ✅
PHASE-0 PHYSICAL DATABASE SCHEMA CERTIFIED
============================================================

MIGRATION HISTORY:           PASS
EVENT_OUTBOX:                PASS
CONSUMER IDEMPOTENCY:        PASS
DEAD LETTER QUEUE:           PASS
SCHEDULED JOBS:              PASS
BOOKING LIFECYCLE FIELDS:    PASS
INDEXES:                     PASS
CONSTRAINTS:                 PASS
PRISMA PHASE-0 CONTRACT:     PASS
RUNTIME COMPATIBILITY:       PASS
RECOVERY CONTROLS:           PASS
EVENT PROCESSING:            OFF
PRODUCTION:                  UNTOUCHED
FULL APPLICATION SCHEMA PARITY: DEFERRED
```

**SAFE TO ENTER: STAGE D — REAL STAGING CERTIFICATION**

Do not enable event flags automatically. Do not begin real booking/payment flows automatically. **STOP AFTER STEP 7.**
