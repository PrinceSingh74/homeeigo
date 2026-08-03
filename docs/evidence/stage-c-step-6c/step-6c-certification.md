# Stage C Step 6C — RC Freeze, Migration Authority & Staging DB Recovery

**Certification date:** 2026-08-03  
**Scope:** STAGING ONLY — project `homigo-497619`  
**Production impact:** NONE CONFIRMED  
**Result:** **PASS**

---

## 1. Remediation Commits Pushed

| SHA | Message | Remote |
|-----|---------|--------|
| `afb5cd60b77236a0bda70648e8bbe63ec438a04d` | fix(prisma): make part_6a migration idempotent for clean deploy | **PUSHED** |
| `2491b7bb5667bfa85228e54d4e1f25d45d48c91e` | fix(prisma): add referral foundation before fraud engine migration | **PUSHED** |
| `e459175c72b1ece6e6246e5d69f559f23cd0a23e` | fix(prisma): add H-Coin foundation before finance integrity phase2 | **PUSHED** |
| `600544a` | docs(evidence): Stage C Step 6B migration chain remediation certification | **PUSHED** |

**Remote:** `origin/main` @ `600544a` (2026-08-03)

---

## 2. Frozen Corrected RC

| Field | Value |
|-------|-------|
| **APPLICATION_RC_SHA** | `e459175c72b1ece6e6246e5d69f559f23cd0a23e` |
| **Image digest** | `sha256:3c3138aa0bee7405c43193abcf93ef947be3db5878b953735e91437f6ab5eefa` |
| **Decision** | **e459175 REMAINS Phase 0 RC** — certifies committed 23-migration chain through `event_foundation` |

Cloud Run runtime image remains Step 5 revision until explicit deploy of `e459175` (DB cutover completed; app image unchanged at `262befa` digest).

---

## 3. Untracked Migrations Investigation (25 folders)

**Finding:** All 25 are **legitimate, code-backed** migrations — not experimental orphans. They are **uncommitted working-tree artifacts** sitting chronologically between `20260608280000` and `20260731120000`.

| Classification | Count | Migrations |
|----------------|-------|------------|
| Legitimate / required by code | 23 | All except 2 below |
| Duplicate / superseded (internal) | 2 | `20260609260000_money_paise_dual_write` (subsumed by `09280000`); `20260612000000_assignment_one_sent_per_job` (index dropped by `16120000`) |
| Experimental / orphan | 0 | — |

**Schema gap:** `schema.prisma` references models requiring these migrations (admin RBAC, gift cards, paise columns, PII encryption, compliance, partner OS, etc.). Two models have **no migration anywhere**: `Geofence`, `GeofenceEvent`, `CityCoverageOverride`.

**Belong in Phase 0 RC (e459175)?** **NO** — Phase 0 scope is event foundation via **23 tracked migrations** (Step 6B certified). Untracked batch deferred to post–Phase 0 waves.

### Recommended commit waves (post–Phase 0)

| Wave | Purpose | When |
|------|---------|------|
| **Wave 1** | Runtime blockers: paise dual-write, wallet hardening, RBAC, token security, support messages, assignment broadcast, booking BIGINT | Before production cutover |
| **Wave 2** | Security/compliance: encryption, retention, gift-card hardening, slot exclusion, enterprise operations | Pre-production hardening |
| **Wave 3** | Feature/intelligence: finance config, enterprise OS v6, coverage, partner OS v2 | When those surfaces ship |

---

## 4. Authoritative Migration Set

| Set | Count | Source of truth |
|-----|-------|-----------------|
| **Phase 0 RC (authoritative for staging)** | **23** | Git `apps/backend/prisma/migrations/` @ `e459175` |
| **Working-tree backlog (not authoritative)** | 25 | Local untracked — do not apply on staging until committed + certified |
| **Final migration** | `20260731120000_event_foundation` | Event platform tables |

**Rule:** Staging `prisma migrate deploy` MUST use clean worktree at RC SHA — never dirty `D:\homigo` disk (48 dirs).

---

## 5. Staging DB Recovery (Certified PITR Path)

### Problem

Live `homigo-staging-db` had partial Step 6 failure (4 applied, 1 failed at `part_6a`).

### Recovery executed

| Step | Action | Result |
|------|--------|--------|
| 1 | PITR source (Step 6A) | `homigo-staging-step6a-pitr-20260803` @ pre-migration point |
| 2 | `prisma migrate deploy` @ `e459175` | Job `homigo-staging-migrate-6rdkd` — **SUCCESS** (23/23) |
| 3 | Cutover `STAGING_DATABASE_URL` | Secret version **3** → PITR instance connection |
| 4 | Cutover Cloud Run SQL annotation | `homigo-staging-step6a-pitr-20260803` |
| 5 | New revision | `homigo-backend-staging-00018-wxs` |

### Abandoned instance (forensic retention)

| Instance | State | Action |
|----------|-------|--------|
| `homigo-staging-db` | Partial failed migration | **NOT cut over** — retained with deletion protection for forensics |

---

## 6. Clean Staging DB Verification

| Check | Result |
|-------|--------|
| `prisma migrate status` (authoritative DB) | **Database schema is up to date!** (23 migrations) |
| Job execution | `homigo-staging-migrate-7vd6q` |
| `/health` | HTTP **200** — database ok |
| `/ready` | HTTP **200** — database healthy (8ms) |
| Event tables | Created by `event_foundation` migration (applied) |

---

## 7. Backups / PITR / Deletion Protection

| Instance | Backups | PITR | Deletion protection |
|----------|---------|------|---------------------|
| **Authoritative** `homigo-staging-step6a-pitr-20260803` | ON | ON | **ON** |
| Forensic `homigo-staging-db` | ON | ON | **ON** |
| Replay test `homigo-staging-migration-replay-20260803` | OFF | — | OFF (test only) |

`database-backup-readiness.ps1` on `homigo-staging-db`: **PASS** (backup 5.49h old, RUNNABLE, deletion protection).

---

## 8. Event Flags — PROVEN OFF

Revision `homigo-backend-staging-00018-wxs`:

| Flag | Value |
|------|-------|
| `EVENTS_OUTBOX_ENABLED` | **false** |
| `EVENTS_CONSUMERS_ENABLED` | **false** |

---

## 9. Step 6C Verdict

**STEP 6C: PASS**

- Remediation + evidence **pushed** to `origin/main`
- RC **frozen** at `e459175` (23-migration Phase 0 scope)
- 25 untracked migrations **audited** — legitimate, **deferred** from this RC
- Staging DB **recovered** via certified PITR path + `e459175` migrate deploy + cutover
- Authoritative DB **clean** (23/23, event_foundation reached)
- Backups/PITR/deletion protection **verified** on authoritative instance
- Events **remain OFF**

### Follow-ups (out of scope)

- Deploy Cloud Run image @ `e459175` (optional — DB already on remediated schema)
- Commit Wave 1 untracked migrations as next release gate
- Create missing migrations for `Geofence` / `CityCoverageOverride`
- Update monitoring alert filters if instance name change from `homigo-staging-db` is permanent
