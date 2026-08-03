# Stage C Step 6A — PITR Recovery, Schema Drift Forensics & Baseline Certification

**Certification date:** 2026-08-03  
**Scope:** STAGING ONLY — project `homigo-497619`  
**Production impact:** NONE CONFIRMED  
**Result:** **PASS — remediation strategy certified (migration chain defect proven)**

---

## Forensic Source

| Field | Value |
|-------|-------|
| FORENSIC_SOURCE_SHA | `262befa14e249b51f94a5ba43cd692a8c5919db1` |
| FORENSIC_WORKTREE | `%TEMP%\homigo-step6a-rc-262befa` (clean, detached) |

---

## Step 6 Failure Preserved

| Field | Value |
|-------|-------|
| Failed migration | `20260529114745_part_6a_realtime_tracking` |
| Prisma error | P3018 |
| PostgreSQL error | 42704 |
| Failing operation | `DROP INDEX "providers_aadhar_number_key"` |
| Execution | Cloud Run Job `homigo-staging-migrate` |
| Migration start (UTC) | `2026-08-03T09:50:22.803Z` |
| Prior evidence | `docs/evidence/stage-c-step-6/staging-migration-certification.md` |

---

## PITR Recovery

| Field | Value |
|-------|-------|
| Source instance | `homigo-staging-db` |
| Requested timestamp (UTC) | `2026-08-03T09:47:36.653Z` |
| Marker vs migration start | ~2m46s **before** Step 6 execution |
| PITR_TIMESTAMP_VALID | **YES** (inside 7-day tx log window) |
| Target (isolated) | `homigo-staging-step6a-pitr-20260803` |
| Operation | `gcloud sql instances clone --point-in-time` |
| Start (UTC) | `2026-08-03T10:06:45.634Z` |
| End (UTC) | `2026-08-03T10:17:02.189Z` |
| Duration | ~617s (~10.3 min) |
| Result | **SUCCESS** (RUNNABLE, PostgreSQL 16, private IP `10.36.0.9`) |
| Live DB cutover | **NO** — application remains on `homigo-staging-db` |

---

## Restored State (PITR instance)

Verified via Cloud Run Job `homigo-staging-forensic` + `STAGING_STEP6A_PITR_URL`:

| Check | Result |
|-------|--------|
| Prisma migrations recorded | **0 applied** (23 pending) |
| Failed migration in `_prisma_migrations` | **None** |
| Partial Step 6 effects on PITR clone | **Removed** (pre-migration point) |
| Event foundation tables | **Not present** (expected) |

---

## Live Staging DB (`homigo-staging-db`) — unchanged

| Check | Result |
|-------|--------|
| Cloud Run SQL annotation | `homigo-497619:asia-south1:homigo-staging-db` |
| Partial Step 6 state | **Still present** (4 migrations applied, 1 failed) |
| Application health | `/health` 200, `/ready` 200 (tests against **live** DB) |
| Cutover to PITR clone | **Not performed** (by design — offline verification first) |

---

## Root Cause

**Classification: PROVEN (primary) + STRONGLY_SUPPORTED (secondary context)**

### Primary (proven)

Migration **`20260529114745_part_6a_realtime_tracking`** executes unconditional:

```sql
DROP INDEX "providers_aadhar_number_key";
DROP INDEX "providers_pan_number_key";
-- ... other DROP INDEX ...
```

But those indexes are **created later** in **`20260529120000_add_partner_registration`**:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "providers_aadhar_number_key" ...
CREATE UNIQUE INDEX IF NOT EXISTS "providers_pan_number_key" ...
```

Chronological order: `114745` (part_6a) runs **before** `120000` (add_partner_registration).

On empty database, after `init` → `add_provider_badges`, **`providers_aadhar_number_key` does not exist** when part_6a runs → PostgreSQL 42704 → Prisma P3018.

**Clean empty-DB replay reproduced identical failure** (see below).

### Secondary (strongly supported)

- `deploy/scripts/staging-gcp-provision.ps1` does **not** run `prisma migrate deploy`
- `docs/enterprise/homigo-cloudrun-autoscaling-certification.md` documents historical **`prisma db push`** on Cloud SQL
- Step 4 evidence noted staging public schema **empty** at restore certification time; Step 6 `init` then created tables from migration chain

**Conclusion:** Failure is **not** merely "mystery drift" — the certified migration chain at `262befa` **cannot** complete `migrate deploy` from empty DB regardless of prior provisioning method.

---

## Clean Database Replay

| Field | Value |
|-------|-------|
| Performed | **YES** |
| Instance | `homigo-staging-migration-replay-20260803` (empty, isolated) |
| Database | `homigo_staging_db` (new) |
| Command | `./node_modules/.bin/prisma migrate deploy` |
| Job | `homigo-staging-replay-migrate` |
| Result | **FAIL** at `20260529114745_part_6a_realtime_tracking` |
| Error | `index "providers_aadhar_number_key" does not exist` (42704 / P3018) |
| Migrations applied before fail | init, refresh_token, auth_system_updates, add_provider_badges |
| Repository chain valid from empty DB | **NO** |

---

## Failed Migration Analysis

| Index | Created by | Dropped by part_6a (before create?) | On init path after migration 4 |
|-------|----------|-------------------------------------|--------------------------------|
| `providers_aadhar_number_key` | add_partner_registration (later) | YES — **first failure** | MISSING |
| `providers_pan_number_key` | add_partner_registration (later) | YES | MISSING |
| `providers_tax_id_key` | init | YES | EXISTS |
| `providers_bank_account_number_key` | init | YES | EXISTS |
| `providers_upi_id_key` | init | YES | EXISTS |
| `users_kyc_document_number_key` | init | YES | EXISTS |

Underlying uniqueness for aadhar/pan later moves to hash columns in `20260529140000_sensitive_field_lookup_hashes`.

---

## Reconciliation Summary (PITR restored = pre-Step-6 empty)

| Migration range | Live schema match | Baseline eligible |
|-----------------|-------------------|-------------------|
| All 23 at PITR point | MISSING (empty DB) | **NO** — nothing to baseline |
| Live `homigo-staging-db` post-fail | PARTIAL (4 applied, 1 failed) | **NO** — corrupted history |

**BASELINE_BOUNDARY_CANDIDATE:** **NONE** at current live DB. After cutover to PITR-empty DB, boundary is **pre-init (empty)** requiring **full chain execution after migration fix**.

---

## Recommended Remediation

**Strategy: E (Migration chain remediation) + C (Clean migration-managed DB)**

### Controlled next procedure (NOT executed in 6A)

1. **Cutover or replace** authoritative staging DB with PITR-restored empty state (or fresh empty instance).
2. **New application commit** (post-`262befa`) fixing `20260529114745_part_6a_realtime_tracking`:
   - Replace unconditional `DROP INDEX` with `DROP INDEX IF EXISTS` for all six indexes, **OR**
   - Reorder/split migration with approved checksum impact analysis.
3. **Re-certify** migration chain via clean empty-DB `migrate deploy` (must reach `20260731120000_event_foundation`).
4. **Separate authorized step:** baseline only if drift remains after fix; **do not** use `migrate resolve` to skip broken migration.
5. **Retry Step 6** only on fixed RC + clean/recovered DB.

### Explicitly NOT recommended

- Blind `migrate resolve --applied` on failed migration
- `prisma db push` on staging
- `migrate reset`
- Editing migration SQL without new RC + replay proof

---

## Safety State (end of 6A)

| Check | Result |
|-------|--------|
| EVENTS_OUTBOX_ENABLED | false |
| EVENTS_CONSUMERS_ENABLED | false |
| APPLICATION_RC_SHA | `262befa` (unchanged) |
| Cloud Run revision | `homigo-backend-staging-00017-wfk` (unchanged) |
| MIGRATE RESOLVE EXECUTED | **NO** |
| Migration retry on live DB | **NO** |
| Backups / PITR / deletion protection (homigo-staging-db) | ON / ON / ON |

---

## Temporary Resources

| Resource | Action | Reason |
|----------|--------|--------|
| `homigo-staging-step6a-pitr-20260803` | **KEEP** | PITR forensic baseline |
| `homigo-staging-migration-replay-20260803` | **KEEP** | Clean replay evidence |
| `STAGING_STEP6A_PITR_URL` | **KEEP** | Forensic access (no values in evidence) |
| `STAGING_REPLAY_MIGRATE_URL` | **KEEP** | Replay test access |
| Cloud Run jobs (forensic/replay/migrate) | **KEEP** | Tooling for next gate |

Delete only after baseline remediation completes and evidence archived.

---

## Step 6 Retry Readiness

**Ready to retry Step 6:** **NO**

**Blockers:**

1. Migration chain defect at `20260529114745_part_6a_realtime_tracking` (proven)
2. Live `homigo-staging-db` still in failed partial migration state
3. Requires migration fix commit + DB cutover to clean/PITR state before retry
