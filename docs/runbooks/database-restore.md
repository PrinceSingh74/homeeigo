# Database Restore Runbook — HOMIGO

**Scope:** Staging (GCP Cloud SQL) and legacy local/docker production backup paths.  
**Safety:** Never restore over production or active staging without explicit approval and write-stop.

---

## Purpose

Provide a reproducible procedure to recover PostgreSQL from automated backups or Point-in-Time Recovery (PITR) into an **isolated** target, validate integrity, and only then consider cutover.

A backup is **not certified** until an isolated restore has succeeded.

---

## Prerequisites

| Requirement | Staging (Cloud SQL) | Legacy local/docker |
|-------------|---------------------|---------------------|
| IAM | `roles/cloudsql.admin`, `roles/cloudsql.client` | Docker access to Postgres container |
| Tools | `gcloud`, Cloud SQL Auth Proxy | `pg_dump`, `pg_restore`, `bun` |
| Secrets | Secret Manager `STAGING_DATABASE_URL` (never print) | `.env` / Secret Manager (never commit) |
| Approval | Engineering lead + DBRE for production | Same |

---

## Environment Reference

| Environment | Instance | Database | Region | Project |
|-------------|----------|----------|--------|---------|
| Staging | `homigo-staging-db` | `homigo_staging_db` | `asia-south1` | `homigo-497619` |
| Production (GCP) | *Not in homigo-497619* | — | — | Verify separately |
| Legacy local | Docker `homigo-postgres` | `homigo_db` | local | S3 `homigo-prod-backups-*` |

---

## Verify Backup Status (read-only)

```powershell
# Non-destructive readiness report (JSON)
./deploy/scripts/database-backup-readiness.ps1 -Project homigo-497619 -Instance homigo-staging-db
```

```bash
gcloud sql backups list --instance=homigo-staging-db --project=homigo-497619
gcloud sql instances describe homigo-staging-db --project=homigo-497619 \
  --format="yaml(settings.backupConfiguration)"
```

**Expected (staging baseline):**
- Automated backups: **enabled**
- Schedule: **03:00** (instance timezone)
- Retained backups: **7** (count)
- Transaction log retention: **7 days**
- PITR: **enabled** (required for Stage C)

---

## Determine PITR Window

After PITR is enabled, Cloud SQL exposes recoverable time via clone operations. Use a timestamp **inside** the transaction log retention window (default 7 days).

```bash
# Clone to isolated instance at specific UTC time (example)
gcloud sql instances clone homigo-staging-db homigo-staging-pitr-test-YYYYMMDD \
  --project=homigo-497619 \
  --point-in-time='2026-08-03T04:00:00.000Z'
```

**Do not** restore over `homigo-staging-db` or any production instance.

---

## Isolated Restore from Clone (preferred smoke test)

Creates a **new** instance; does not modify source.

```bash
gcloud sql instances clone homigo-staging-db homigo-staging-restore-test-YYYYMMDD \
  --project=homigo-497619
```

Naming convention: `homigo-staging-restore-test-YYYYMMDD` or `homigo-staging-pitr-test-YYYYMMDD`.

---

## Isolated Restore from Automated Backup

1. Create empty target instance (same major PG version, same region/network model).
2. Restore backup to target (never to production):

```bash
gcloud sql backups restore BACKUP_ID \
  --restore-instance=homigo-staging-restore-test-YYYYMMDD \
  --backup-instance=homigo-staging-db \
  --project=homigo-497619
```

Obtain `BACKUP_ID` from `gcloud sql backups list`.

---

## Post-Restore Validation (isolated instance only)

Connect via Cloud SQL Auth Proxy — **do not** point staging/production Cloud Run at the test instance.

```bash
cloud-sql-proxy homigo-497619:asia-south1:homigo-staging-restore-test-YYYYMMDD
```

Validation queries (metadata only; no PII dumps):

```sql
SELECT version();
SELECT current_database();
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public';
-- If schema migrated: spot-check critical tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1 LIMIT 20;
```

Optional Prisma (read-only, local shell with test URL):

```bash
DATABASE_URL="postgresql://..." bunx prisma db execute --stdin <<< "SELECT 1"
```

**Side-effect safety:** Do not start Cloud Run, workers, cron, event consumers, or payment/webhook handlers against the restore-test instance.

---

## Application Connection (after validation only)

If cutover to restored data is approved:

1. Stop writes (scale Cloud Run to 0 or disable traffic).
2. Update **staging-only** Secret Manager `STAGING_DATABASE_URL` to new instance (human via console).
3. Deploy new Cloud Run revision.
4. Run `/health` and `/ready` (OPS token).
5. Re-enable traffic.

Production cutover requires separate approval gate.

---

## Legacy Local / Docker Restore

See also `docs/runbooks/04-database-restore.md`.

```bash
# Backup
BACKUP_DOCKER_CONTAINER=homigo-postgres bun run scripts/backup-db.ts

# Drill to scratch DB (never equals live DATABASE_URL)
DR_SCRATCH_DATABASE_URL=postgresql://...@localhost/homigo_dr_scratch bun run p2:dr
```

---

## Rollback

If restore-test validation fails: delete the **restore-test instance only** after confirming name/project. Do not delete `homigo-staging-db`.

---

## Cleanup

```bash
# ONLY after confirming instance name is restore-test, NOT staging/production
gcloud sql instances delete homigo-staging-restore-test-YYYYMMDD --project=homigo-497619
```

If ambiguous: **MANUAL CLEANUP REQUIRED** — do not auto-delete.

---

## HOMIGO DATABASE RECOVERY OBJECTIVES

### Policy (engineering baseline — staging)

| Objective | Target | Meaning |
|-----------|--------|---------|
| **RPO** | **15 minutes** | Maximum acceptable data loss in a disaster scenario for a production-grade HOMIGO database architecture |
| **RTO** | **30 minutes** | Maximum acceptable time to restore database infrastructure to an operational state |

**Status:** POLICY — approved for staging certification closure; business sign-off recommended before production migration.

### Observed capability (staging evidence — 2026-08-03)

| Mechanism | Configuration | Observed |
|-----------|---------------|----------|
| Automated backups | Daily ~03:00 UTC, 7 retained | Latest SUCCESSFUL backup verified |
| PITR | Enabled, 7-day transaction logs | Timestamp restore **SUCCESS** |
| Normal clone restore | `homigo-staging-restore-test-20260803` | **488.4 s (~8.1 min)** |
| PITR clone restore | `2026-08-03T06:55:00Z` → `homigo-staging-pitr-test-20260803` | **588.9 s (~9.8 min)** |

### Assessment

| Metric | Target | Observed infrastructure recovery | Assessment |
|--------|--------|----------------------------------|------------|
| RPO | 15 min | PITR + 7d tx logs supports **sub-hour** recovery points (not a provider SLA guarantee) | **PARTIAL** — policy defined; continuous PITR history accumulates post-enable |
| RTO | 30 min | Clone ~8–10 min (infra only) | **PASS** for **infrastructure database recovery RTO** |

**Limitation:** Measured RTO is **infrastructure database recovery**, not full business-service recovery (application validation, schema migration state, cutover). Staging schema was pre-migration empty at certification time.

### Escalation

Escalate if: backup failure alert fires, stale backup >36h, instance down, or restore test fails.

---

## RPO / RTO (legacy reference)

| Metric | Policy defined | Observed / supported |
|--------|----------------|----------------------|
| RPO | **15 min (policy)** | PITR + 7d logs |
| RTO | **30 min (policy)** | ~8–10 min clone (infra) |

Recommend business sign-off on RPO/RTO before production migration.

---

## Disaster Scenarios

| # | Scenario | Recovery |
|---|----------|----------|
| 1 | Accidental row deletion | PITR clone to timestamp before deletion |
| 2 | Bad application deploy | Roll back Cloud Run revision; assess DB drift |
| 3 | Bad migration | Do not re-run on prod; restore/PITR to pre-migration timestamp |
| 4 | DB corruption | Restore latest successful automated backup to new instance |
| 5 | Instance deleted | Create new instance + restore latest backup |
| 6 | Region outage | **NOT SUPPORTED** — single-region `asia-south1` only |
| 7 | Compromised credentials | Rotate secrets in Secret Manager; audit IAM; validate integrity |

---

## Escalation

| Role | Contact |
|------|---------|
| DBRE / Platform | _TBD_ |
| Engineering lead | _TBD_ |
| GCP support | Cloud Console → Support |

---

## Production Safety Warnings

- **NEVER** `DROP DATABASE`, `prisma migrate deploy`, or restore over production without approved maintenance window.
- **NEVER** expose `DATABASE_URL` in logs, tickets, or chat.
- Staging restore success **does not** prove production S3/docker backups are recoverable — certify separately.
