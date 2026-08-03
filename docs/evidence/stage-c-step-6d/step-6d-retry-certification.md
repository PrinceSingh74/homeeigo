# Stage C Step 6D — Staging Deploy & Step 6 Retry Certification

**Certification date:** 2026-08-03  
**Scope:** STAGING ONLY — project `homigo-497619`  
**Production impact:** NONE CONFIRMED  
**Result:** **STEP 6 RETRY — PASS**

---

## Final RC & Immutable Image

| Field | Value |
|-------|-------|
| **APPLICATION_RC_SHA** | `e459175c72b1ece6e6246e5d69f559f23cd0a23e` |
| **Image digest (pinned)** | `sha256:3c3138aa0bee7405c43193abcf93ef947be3db5878b953735e91437f6ab5eefa` |
| **Image ref** | `asia-south1-docker.pkg.dev/homigo-497619/homigo/backend@sha256:3c3138aa0bee7405c43193abcf93ef947be3db5878b953735e91437f6ab5eefa` |
| **Cloud Run revision** | `homigo-backend-staging-00019-8hr` |
| **Service URL** | `https://homigo-backend-staging-144968192234.asia-south1.run.app` |

Deploy used **digest pin** (not floating tag).

---

## Authoritative Staging Database

| Field | Value |
|-------|-------|
| **Instance** | `homigo-staging-step6a-pitr-20260803` |
| **Database** | `homigo_staging_db` |
| **Secret** | `STAGING_DATABASE_URL` (points to PITR instance post–Step 6C cutover) |
| **Cloud SQL annotation** | `homigo-497619:asia-south1:homigo-staging-step6a-pitr-20260803` |

---

## Pre-flight: Backups / PITR

`database-backup-readiness.ps1 -Instance homigo-staging-step6a-pitr-20260803`:

| Check | Result |
|-------|--------|
| Recent backup | PASS (2.22h old, SUCCESSFUL) |
| Instance state | RUNNABLE |
| Deletion protection | ON |
| PITR | ON |
| **Overall** | **PASS** |

---

## Prisma Gates (Cloud Run Job `homigo-staging-migrate`)

| Gate | Execution | Result |
|------|-----------|--------|
| `prisma validate` | `homigo-staging-migrate-kj5fx` | **PASS** — schema valid |
| `prisma migrate status` | `homigo-staging-migrate-d7kmg` | **PASS** — database schema is up to date (23 migrations) |
| `prisma migrate deploy` | `homigo-staging-migrate-lxcgh` | **PASS** — no pending migrations to apply |

**Authoritative migrations:** 23/23 applied, including **`20260731120000_event_foundation`**.

---

## Schema Drift

| Check | Result |
|-------|--------|
| Migration-managed DB vs pending migrations | **NONE** — status + deploy clean |
| Full `schema.prisma` vs 23-migration RC | **EXPLAINED GAP** — 25 uncommitted working-tree migrations documented in Step 6C (not unexplained drift) |

---

## Event Flags — PROVEN OFF

Revision `homigo-backend-staging-00019-8hr`:

| Flag | Value |
|------|-------|
| `EVENTS_OUTBOX_ENABLED` | **false** |
| `EVENTS_CONSUMERS_ENABLED` | **false** |

Event foundation **tables exist** (migration applied); processors **disabled** at runtime.

---

## Application Compatibility

| Endpoint | Auth | HTTP | Result |
|----------|------|------|--------|
| `GET /health` | none | **200** | database ok, redis ok |
| `GET /ready` | OPS bearer | **200** | database healthy (9ms) |
| `GET /metrics` | OPS bearer | **200** | valid Prometheus exposition |

Staging safety tests: **9/9 PASS**

---

## Logs

| Source | Result |
|--------|--------|
| Revision `00019-8hr` ERROR severity | **None observed** |
| Migrate job executions | Clean exit(0), no P3018/P1001 on final deploy/status |

---

## Post-deploy Safety

| Control | Result |
|---------|--------|
| Backups/PITR (authoritative instance) | **PASS** (pre-flight reconfirmed) |
| Production Cloud SQL | **NONE** in project |
| Forensic `homigo-staging-db` | Retained, not serving traffic |

---

## Step 6 Retry Verdict

**STEP 6 RETRY: PASS**

Original Step 6 failure (`part_6a` DROP INDEX on empty replay) is **remediated**. Staging now runs **digest-pinned `e459175`** against a **clean 23/23 migration-managed database** through **`event_foundation`**, with events **OFF** and health/ready/metrics **PASS**.

---

## Evidence chain

| Step | Document |
|------|----------|
| 6 (original failure) | `docs/evidence/stage-c-step-6/staging-migration-certification.md` |
| 6A (PITR forensics) | `docs/evidence/stage-c-step-6a/step-6a-certification.md` |
| 6B (chain remediation) | `docs/evidence/stage-c-step-6b/step-6b-certification.md` |
| 6C (DB cutover) | `docs/evidence/stage-c-step-6c/step-6c-certification.md` |
| **6D (this document)** | Step 6 retry PASS |
