# Stage C Step 5 — Exact Commit Staging Deployment & Artifact Certification Evidence

**Certification date:** 2026-08-03  
**Scope:** STAGING ONLY — project `homigo-497619`  
**Production impact:** NONE CONFIRMED

---

## Release Identities

| Field | Value |
|-------|-------|
| **APPLICATION_RC_SHA** | `262befa14e249b51f94a5ba43cd692a8c5919db1` |
| **APPLICATION_RC_SHORT** | `262befa` |
| **EVIDENCE_COMMIT_SHA** | NONE (evidence file created post-deploy; not in application image) |
| **RC source branch** | `origin/main` |
| **RC decision** | CASE B — `bfa52f5` is ops/docs/IaC only; runtime RC remains `262befa` |

### Commits reviewed (not deployed as application RC)

| SHA | Classification |
|-----|----------------|
| `5a75770` | Phase 0 events foundation (superseded) |
| `59f2ddd` | Redis connect boot fix (superseded) |
| `8407b74` | Staging provisioning script hardening (included in `262befa`) |
| `262befa` | **Selected APPLICATION_RC_SHA** — runtime + staging safety |
| `bfa52f5` | Step 4 only — monitoring IaC, backup scripts, runbooks, evidence (NOT runtime) |

---

## Source Integrity

| Field | Value |
|-------|-------|
| Build source | Clean detached worktree |
| Worktree path | `%TEMP%\homigo-step5-rc-262befa` |
| Worktree HEAD | `262befa14e249b51f94a5ba43cd692a8c5919db1` |
| Working tree | CLEAN (empty `git status --porcelain`) |
| Dirty `D:\homigo` used for build | **NO** |
| Archive size | 445 files / 2.9 MiB (no local `node_modules`) |

---

## Security Gate

| Check | Result |
|-------|--------|
| Secret scan (RC source) | PASS — no hardcoded credentials |
| Production secrets in source | NO |
| Sensitive values printed | NO |

---

## Quality Gates

| Gate | Command / method | Result |
|------|------------------|--------|
| Staging safety tests | `bun test src/lib/__tests__/staging-safety.test.ts` | **9/9 PASS** |
| Docker build (canonical release path) | `gcloud builds submit` from clean RC | **SUCCESS** |
| Local `bun run build` | prebuild script absent at this SHA | **N/A — Docker path used** |
| Prisma validate (local) | requires deps/env in worktree | **N/A — `prisma generate` succeeded in Docker build** |
| Phase 0 event tests | not gate-blocking; require full test env | **NOT RUN** |

---

## Pre-Deployment Recovery Safety

| Field | Value |
|-------|-------|
| Cloud SQL instance | `homigo-staging-db` |
| Database | `homigo_staging_db` |
| State | RUNNABLE |
| Automated backups | **ON** |
| PITR | **ON** |
| Deletion protection | **ON** |
| Redis | `homigo-staging-redis` — READY |

---

## Immutable Artifact

| Field | Value |
|-------|-------|
| Build ID | `33eaf460-1666-4b55-8a4b-ada425fa3af2` |
| Build timestamp (UTC) | `2026-08-03T09:11:33+00:00` |
| Build duration | 3m 3s |
| Image URI | `asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:262befa14e249b51f94a5ba43cd692a8c5919db1` |
| **Image digest** | `sha256:4dfa91d3a948aadac7a07e139ed31832c068131db24fdbd93547e5df30bb2ad9` |

> **Note:** Prior Step 3C deploy used digest `sha256:c5339ab9…`. Step 5 rebuild from identical Git SHA produced a new digest due to upstream base-image/dependency layer changes (reproducible source, immutable digest recorded at deploy time).

---

## Deployment

| Field | Value |
|-------|-------|
| Platform | Cloud Run |
| Project | `homigo-497619` |
| Region | `asia-south1` |
| Service | `homigo-backend-staging` |
| Staging URL | `https://homigo-backend-staging-144968192234.asia-south1.run.app` |
| Previous revision (rollback target) | `homigo-backend-staging-00015-rcs` |
| Pre-Step-5 deploy revision | `homigo-backend-staging-00016-skh` |
| **New revision** | `homigo-backend-staging-00017-wfk` |
| Deploy timestamp (UTC) | `2026-08-03T09:16:58Z` |
| Traffic | 100% → `00017-wfk` |
| Deploy method | Digest-pinned (`@sha256:4dfa91d3…`) |

---

## Runtime Configuration (verified)

| Variable | Value |
|----------|-------|
| `APP_ENV` | `staging` |
| `NODE_ENV` | `production` |
| `EVENTS_OUTBOX_ENABLED` | `false` |
| `EVENTS_CONSUMERS_ENABLED` | `false` |
| Razorpay | PLACEHOLDER (not live) |
| Payout | DISABLED |
| Cloud SQL annotation | `homigo-497619:asia-south1:homigo-staging-db` only |

---

## Migration Safety

| Action | Executed |
|--------|----------|
| `prisma migrate deploy` | **NO** |
| `prisma migrate dev` | **NO** |
| `prisma db push` | **NO** |
| Schema mutated by Step 5 | **NO** |

Dockerfile startup: `CMD ["bun", "run", "src/index.ts"]` — no migration on boot.

Pending migration in RC source: `20260731120000_event_foundation` (Step 6 scope).

---

## Post-Deploy Verification

| Endpoint | HTTP | Result |
|----------|------|--------|
| `GET /health` | 200 | PASS — `environment: staging`, DB ok, Redis ok |
| `GET /ready` (OPS auth) | 200 | PASS — DB healthy, Redis healthy |
| `GET /metrics` (OPS auth) | 200 | PASS — valid Prometheus exposition |

### Startup log notes (non-blocking)

- Prisma errors on missing `event_outbox`, `event_dead_letters`, `event_consumer_receipts` tables — **expected pre-Step-6 migration**
- `assignment_jobs` table missing — background job noise, service healthy
- No evidence of outbox processor polling (`startOutboxProcessor` gated by `EVENTS_OUTBOX_ENABLED=false`)
- Consumer dispatch gated by `EVENTS_CONSUMERS_ENABLED=false` in event bus

---

## Artifact Chain of Custody

```
262befa14e249b51f94a5ba43cd692a8c5919db1
        ↓
asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:262befa14e249b51f94a5ba43cd692a8c5919db1
        ↓
sha256:4dfa91d3a948aadac7a07e139ed31832c068131db24fdbd93547e5df30bb2ad9
        ↓
homigo-backend-staging-00017-wfk
```

**Result:** VERIFIED

---

## Production Isolation

| Check | Result |
|-------|--------|
| Production Cloud Run in `homigo-497619` | NONE (only `homigo-backend-staging`) |
| Production Cloud SQL in project | NONE (only `homigo-staging-db`) |
| Production Redis in project | NONE (only `homigo-staging-redis`) |
| Production DNS modified | NO |
| Production credentials used | NO |
| Production migration | NO |

---

## Rollback

| Field | Value |
|-------|-------|
| Previous healthy revision | `homigo-backend-staging-00015-rcs` |
| Intermediate revision | `homigo-backend-staging-00016-skh` |
| Rollback available | YES |
| Rollback executed | NO |

---

## Step 5 Gate Summary

**STEP 5: PASS**

- Exact RC determined and remotely retrievable from `origin/main`
- Clean checkout build — no dirty worktree
- Immutable digest-pinned deploy to staging
- Events OFF throughout
- No migration executed
- Staging DB recovery controls ON
- Health / ready / metrics PASS
- Production untouched

**Safe to proceed to:** Stage C Step 6 — Staging Database Migration & Schema Verification (do NOT execute automatically).
