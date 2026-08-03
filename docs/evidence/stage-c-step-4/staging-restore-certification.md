# Stage C Step 4 — Staging Database Restore Certification Evidence

**Certification date:** 2026-08-03  
**Scope:** STAGING ONLY — project `homigo-497619`  
**Production impact:** NONE CONFIRMED

---

## Source Database

| Field | Value |
|-------|-------|
| Project | `homigo-497619` |
| Instance | `homigo-staging-db` |
| Engine | Cloud SQL PostgreSQL 16 |
| Region | `asia-south1` |
| Role | Staging source database |
| Created | 2026-08-01T10:09:17Z |

---

## Normal Isolated Restore Test

| Field | Value |
|-------|-------|
| Method | `gcloud sql instances clone` |
| Source | `homigo-staging-db` |
| Target | `homigo-staging-restore-test-20260803` |
| Target created | 2026-08-03T06:52:45Z |
| Result | **SUCCESS** |
| Duration | **488.4 seconds (~8.1 min)** |
| Final state | **RUNNABLE** |
| PostgreSQL | 16 |
| Database present | `homigo_staging_db` |
| Application traffic | **NONE** (Cloud Run uses source instance only) |

---

## PITR Timestamp Restore Test

| Field | Value |
|-------|-------|
| Method | `gcloud sql instances clone --point-in-time` |
| Source | `homigo-staging-db` |
| Target | `homigo-staging-pitr-test-20260803` |
| Requested timestamp (UTC) | **2026-08-03T06:55:00.000Z** |
| Target created | 2026-08-03T07:01:58Z |
| Result | **SUCCESS** |
| Duration | **588.9 seconds (~9.8 min)** |
| Final state | **RUNNABLE** |
| PostgreSQL | 16 |
| Note | HTTP 409 on concurrent retry indicated async clone already in progress; final operation state is SUCCESS |

---

## Cloud Run Database Reference (pre-cleanup)

Cloud Run service `homigo-backend-staging` annotation:

`homigo-497619:asia-south1:homigo-staging-db`

Restore-test instances were **not** referenced by Cloud Run.

---

## Schema State at Certification

Staging database pre-migration: public schema empty (expected). Infrastructure restore validated; post-migration data validation deferred to future gate.

---

## Evidence Retention

This file preserves restore certification metadata before temporary instance cleanup. No credentials, connection strings, or PII included.
