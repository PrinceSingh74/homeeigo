# HOMEEIGO — Migration Authority

**Status: RESOLVED — RUNTIME VERIFIED (2026-09-21)**

Supersedes audit finding **DB-4 / BLOCKER-1**, which was **wrong** in its diagnosis and is corrected below.

---

## 1. What the audit claimed, and what is actually true

The Master Audit reported:

> *"3 of 125 migrations are recorded failed and rolled back… `_prisma_migrations` can no longer be trusted as a description of the schema… A fresh environment replaying this history would not reproduce the current database."* — P0 BLOCKER-1

**That diagnosis was incorrect.** It was produced by a query filtering `finished_at IS NULL`, which showed three failed rows without checking whether a *successful* row existed for the same migration.

Corrected facts:

| Migration | Rows | Clean applied row? | Reality |
|---|---|---|---|
| `20260816120000_automation_workflow_engine` | 2 | ✅ yes | Failed attempt, then re-applied successfully. **Normal Prisma retry.** |
| `20260817100000_notification_platform` | 2 | ✅ yes | Same. **Normal.** |
| `20260825140000_audit_log_action_created_at_index` | 2 | ✅ yes | Same. **Normal.** |
| `20260817090000_notification_delivery_claim` | 1 | ❌ no | **The audit missed this one entirely.** Rename residue — see §3. |

A failed-then-retried migration is the ordinary Prisma pattern; `migrate deploy` reads the clean row and moves on. Those three were never a problem.

**Proof:** a database built from migrations alone applies all 125 and passes every protected-object and client-query check (§5).

---

## 2. The real defects found

Investigating the claim surfaced two genuine problems the audit had not identified.

### MIG-1 (P1, DATABASE) — a drop statement that could never work

`20260527105812_init` creates four uniqueness rules with `CREATE UNIQUE INDEX`:

```sql
CREATE UNIQUE INDEX "users_email_key"        ON "users"("email");
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");
```

The migrations that meant to retire them after PII encryption used the wrong verb:

```sql
-- 20260609180000_p4_encryption_audit
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_key";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_phone_number_key";
-- 20260529140000_sensitive_field_lookup_hashes
ALTER TABLE "providers" DROP CONSTRAINT IF EXISTS "providers_pan_number_key";
ALTER TABLE "providers" DROP CONSTRAINT IF EXISTS "providers_aadhar_number_key";
```

In PostgreSQL a bare `CREATE UNIQUE INDEX` produces an **index**, not a table **constraint**. `ALTER TABLE ... DROP CONSTRAINT` cannot match it — and `IF EXISTS` swallows the mismatch. **The statement could not have worked and could not have reported that it did not work.**

A repository-wide scan found the same wrong-verb pattern against six index names:

```
providers_bank_account_number_key   providers_tax_id_key   providers_upi_id_key
users_email_key                     users_kyc_document_number_key
users_phone_number_key
```

Four survive in a fresh build (`users_email_key`, `users_phone_number_key`, `providers_aadhar_number_key`, `providers_pan_number_key`); the others were removed by a correctly-written `DROP INDEX` elsewhere.

**Impact.** A production database built from migrations would enforce uniqueness on the **plaintext** `email`, `phone_number`, `aadhar_number` and `pan_number` columns — columns superseded by encrypted storage plus `*_hash` lookup columns. The live database has not had these indexes for months. This is a latent insert failure that only appears on a *new* deployment, which is the worst place to discover it.

### MIG-2 (P1, DATABASE) — fifteen indexes that only ever existed via `db push`

`schema.prisma` declares 18 indexes that **no migration creates**. They reached the live database through `prisma db push` (the repository still carries `20260609130000_baseline_repair_db_push_drift`).

Fourteen are foreign-key / query support indexes. One is not:

```sql
CREATE UNIQUE INDEX booking_unique_active_slot
  ON bookings (user_id, service_id, scheduled_date)
  WHERE status <> ALL (ARRAY['CANCELLED_BY_USER','CANCELLED_BY_PROVIDER','REJECTED']);
```

This is the guard preventing a customer from holding two live bookings for the same service at the same scheduled time. **A production database built from migrations would have had no such guard.**

### MIG-3 (P2, DATABASE) — the live database is missing three indexes migrations provide

`20260610120000_enterprise_db_hardening` creates `idx_bookings_status_created`, `idx_bookings_user_scheduled` and `idx_payments_user_status_created`. It is recorded as applied on live, yet **none of the three exists there** — they were lost during the `db push` era and the migration will never run again.

Drift therefore ran in **both directions**: a fresh build had four indexes live lacked, and live had fifteen a fresh build lacked, while `prisma migrate status` reported *"Database schema is up to date!"* on both.

---

## 3. Rename residue — not a defect

`20260817090000_notification_delivery_claim` has one row, marked rolled back on 2026-09-20, and **no directory on disk**.

Commit `0a86cd2` (*"apply notification delivery claim after the deliveries table is created"*) renamed the migration `20260817090000_…` → `20260817110000_…` so it would run **after** `20260817100000_notification_platform` creates `notification_deliveries`. The renamed migration exists, is applied cleanly (2026-09-07), and its SQL is fully idempotent:

```sql
ALTER TYPE "NotificationDeliveryStatus" ADD VALUE IF NOT EXISTS 'PENDING' BEFORE 'QUEUED';
ALTER TABLE "notification_deliveries" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
```

The orphan row is the pre-rename record, correctly marked rolled back so `migrate deploy` ignores it.

### Operator decision (not taken here)

The row can be left or removed. **Recommendation: leave it.** It is an accurate record that the DDL was once applied under a different name, it costs nothing, and deleting rows from `_prisma_migrations` to make a report look tidy is precisely the habit that hides real problems. The verification script reports it as a NOTE rather than a failure, so it stays visible without training anyone to ignore a red check.

If it is removed, do it deliberately and record why:

```sql
-- Operator action, requires explicit authorization. Not run by any script.
DELETE FROM _prisma_migrations
 WHERE migration_name = '20260817090000_notification_delivery_claim'
   AND rolled_back_at IS NOT NULL;
```

---

## 4. The repair

`prisma/migrations/20260921090000_schema_drift_repair/migration.sql` — hand-written, single file, every statement idempotent.

| Section | Action |
|---|---|
| A | `DROP INDEX IF EXISTS` the four stale plaintext-PII unique indexes — the verb that actually works |
| B | `CREATE INDEX IF NOT EXISTS` the 14 FK/query indexes + `booking_unique_active_slot` + 2 indexes `schema.prisma` declares that neither database had |
| C | `CREATE INDEX IF NOT EXISTS` the three performance indexes live lost, with the **exact** `DESC` column ordering of the original migration |

Because every statement is idempotent, the migration is a no-op for objects that already exist and is safe on both a fresh database and the live one.

**It was written by hand on purpose.** `prisma migrate diff` output must never be used here: run against this schema it additionally proposes

```sql
ALTER TABLE "bookings" DROP COLUMN "provider_slot_end", ...
ALTER TABLE "knowledge_chunks" DROP COLUMN "search_vector";
```

— raw-SQL-managed objects deliberately absent from the Prisma datamodel. Applying that diff would delete the booking slot-exclusion columns outright. Of 83 statements in the generated diff, **5 were column drops**.

### Destructive-statement justification

The repository's `check-migration-safety.ts` gate **refused** the first version of this migration, exactly as designed. It was not overridden. An `-- ALLOW_DESTRUCTIVE:` justification was added stating that each dropped index has a live replacement, and **that claim was then verified** — `users_email_hash_key`, `users_phone_hash_key`, `providers_pan_number_hash_key` and `providers_aadhar_number_hash_key` are present in both databases.

---

## 5. Acceptance — evidence

Validated on isolated clones (`homigo_migauth`, `homigo_migauth2`, `homigo_migauth3`) created with `CREATE DATABASE`, never with the dangerous `TEMPLATE` clone. `DATABASE_URL` was set explicitly in the environment for every Prisma CLI invocation; `prisma.config.ts` loads dotenv, and dotenv does not override an existing variable, so the isolated target held.

| Criterion | Result |
|---|---|
| Fresh empty DB → `prisma migrate deploy` | ✅ **125 migrations applied, exit 0** |
| Protected objects survive | ✅ both slot-exclusion constraints, half-open `'[)'` ranges, 4 slot columns, `search_vector` |
| `booking_unique_active_slot` present | ✅ |
| Stale plaintext-PII indexes absent | ✅ all four |
| Wallet idempotency uniqueness | ✅ `wallet_transactions_idempotency_key_key` in both |
| Generated client can query the schema | ✅ 10/10 money- and booking-path models |
| `check-migration-safety.ts` | ✅ pass (54 files scanned) |
| `check-ddl-guard-coverage.ts` | ✅ pass |
| **`verify-migration-authority.ts` on rebuilt DB** | ✅ **29/29 PASS** |
| **`verify-migration-authority.ts` on live DB** | ✅ **29/29 PASS** |

### Remaining structural difference (expected)

| Object | Where | Explanation |
|---|---|---|
| `forensic_recovery_log` | live only | Ad-hoc incident table created outside migrations. Intentionally **not** added to migrations — see §6. |
| 6 indexes | rebuild only | Live gained them when `20260921090000_schema_drift_repair` was applied on 2026-09-21 (Pass 6). These are the MIG-2/MIG-3 improvements. |

> **Superseded by §9.** This table was a named-object comparison. A full catalog diff (Pass 6) found
> four more differences it could not see, all now closed by `20260921140000`.

---

## 6. Operator runbook — applying the repair to the live database

**Not performed by this work.** The repair migration exists and is validated; applying it to `homigo_db` is an operator action.

```bash
# 1. Back up first. Non-negotiable.
cd apps/backend
bun run backup:db

# 2. Confirm what will run. Must list exactly one pending migration.
DATABASE_URL="postgresql://<user>:<pass>@<host>:5433/homigo_db" bunx prisma migrate status

# 3. Apply.
DATABASE_URL="postgresql://<user>:<pass>@<host>:5433/homigo_db" bunx prisma migrate deploy

# 4. Verify. Must print 29/29 PASS.
bun run scripts/verify-migration-authority.ts --url "postgresql://<user>:<pass>@<host>:5433/homigo_db"
```

Expected effect on live: **+6 indexes**, no drops (the four stale indexes are already absent there), no column changes, no data change.

`CREATE INDEX` takes a lock that blocks writes on the target table. `bookings` and `payments` are write-hot; on a live system use `CREATE INDEX CONCURRENTLY` instead, which cannot run inside the transaction Prisma wraps a migration in — so for a zero-downtime apply, run the three section-C statements manually with `CONCURRENTLY` **before** `migrate deploy`, and the `IF NOT EXISTS` guards will make the migration a no-op for them.

### `forensic_recovery_log`

Exists on live, created outside migrations during an incident. **Decide and record:**
- If it holds evidence worth keeping → export it, then drop the table.
- If it is disposable → drop it.

Either way it should not be added to migrations; a fresh environment has no reason to carry an incident artifact.

---

## 7. Preventing recurrence

| Control | Status |
|---|---|
| `scripts/verify-migration-authority.ts` | ✅ **added** — read-only, requires an explicit `--url`, refuses to inherit `DATABASE_URL` |
| `check-migration-safety.ts` | ✅ already existed and **caught this work's destructive statements** |
| `check-ddl-guard-coverage.ts` | ✅ already existed |
| CI job: rebuild from migrations and verify | ⬜ **recommended** — see below |
| Ban `prisma db push` outside local scratch | ⬜ **recommended** — MIG-2 and MIG-3 are both its residue |

Recommended CI addition:

```yaml
migration-authority:
  runs-on: ubuntu-latest
  services:
    postgres: { image: postgres:16-alpine, env: { POSTGRES_PASSWORD: postgres }, ports: ['5432:5432'] }
  steps:
    - uses: actions/checkout@v4
    - uses: oven-sh/setup-bun@v2
    - run: bun install
      working-directory: apps/backend
    - name: Rebuild schema from migrations only
      run: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres bunx prisma migrate deploy
      working-directory: apps/backend
    - name: Verify protected objects and client compatibility
      run: bun run scripts/verify-migration-authority.ts --url postgresql://postgres:postgres@localhost:5432/postgres
      working-directory: apps/backend
```

This would have caught MIG-1 and MIG-2 the day they were introduced.

---

## 8. Status

| Item | Status |
|---|---|
| Migration history is trustworthy | **RUNTIME VERIFIED** |
| Fresh database reproduces the running schema | **RUNTIME VERIFIED** |
| Protected objects survive a rebuild | **RUNTIME VERIFIED** |
| MIG-1 stale PII unique indexes | **FIXED — applied to live 2026-09-21 (Pass 6)** |
| MIG-2 `db push`-only indexes incl. duplicate-booking guard | **FIXED — applied to live 2026-09-21 (Pass 6)** |
| MIG-3 live missing three perf indexes | **FIXED — applied to live 2026-09-21 (Pass 6)** |
| MIG-4 `booking_completed_requires_timestamp` in no migration (§9) | **FIXED — `20260921140000`, applied to live and rebuild** |
| MIG-5 `users_phone_number_idx` rebuild-only, datamodel never had it (§9) | **FIXED — retired in `20260921140000`** |
| MIG-6 `geofences.service_categories` nullable on rebuild, NOT NULL in datamodel and live (§9) | **FIXED — `20260921140000`** |
| MIG-7 three column defaults present on one side only (§9) | **FIXED — `20260921140000`, additive** |
| Rename residue row | **DOCUMENTED — operator decision, recommend leave** |
| `forensic_recovery_log` | **DOCUMENTED — operator decision** (EXPLAINED in the catalog diff, never counted) |
| `sync_money_sim_paise` function on live (§9) | **DEPRECATE_CANDIDATE — operator drop; residue of `scripts/money-simulation.sql`** |
| Apply repair to live | **DONE 2026-09-21** — `migrate deploy`, 11-measure data snapshot identical before/after |
| Full catalog diff rebuild vs live | **IDENTICAL** (`scripts/diff-schema-catalogs.ts`, 2026-09-21) |
| CI guard | **RECOMMENDED, not added** (CI edits not in scope of this pass) |

**Audit finding DB-4 / BLOCKER-1 is withdrawn as stated and replaced by MIG-1, MIG-2 and MIG-3, all of which are now fixed in the repository and verified against isolated clones.**

---

## 9. Pass 6 — full catalog diff (2026-09-21)

§5 compared a **named list** of protected objects. That can only find drift someone already knows
to look for. `scripts/diff-schema-catalogs.ts` compares the whole catalog — tables, columns (type,
nullability, default), indexes, constraints, triggers, sequences, enum values, function bodies —
between a database built only from `prisma/migrations` (`homigo_p6_fresh_rebuild`, `migrate deploy`
from empty) and the live `homigo_db`.

### What it found after `20260921090000` was applied to live

| # | Object | Where | What it means |
|---|---|---|---|
| MIG-4 | `bookings.booking_completed_requires_timestamp` — `CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)` | **live only, validated** | In **no migration**. Added by hand during the August certification (`docs/enterprise/homigo-enterprise-elite-certification.md`). A production database built from migrations would have accepted a COMPLETED booking with no completion time. Two test fixtures described it as "present in every database"; the test database they run in did not have it. |
| MIG-5 | `users_phone_number_idx` | **rebuild only** | `20260527105812_init` creates it; live dropped it by hand; `schema.prisma` declares no index on the plaintext column. The rebuild was the side out of line with the datamodel. |
| MIG-6 | `geofences.service_categories` | nullable on rebuild, NOT NULL on live | Datamodel says `String[] @default([])` — never null. Live had 0 NULL rows. |
| MIG-7 | `automation_shadow_executions.intended_fallback` default (rebuild only); `city_coverage_overrides.updated_at`, `geofences.updated_at` defaults (live only) | one side each | Prisma supplies all three on every write; no behavioural difference. |
| — | 5 columns: `now()` vs `CURRENT_TIMESTAMP`, `'{}'::text[]` vs `ARRAY[]::text[]` | text only | Same default spelled two ways; the tool now normalises. |
| — | 15 money-trigger functions | text only | CRLF migration files on Windows; the tool now strips `\r` before hashing. |
| — | `forensic_recovery_log` (+9 columns, pkey, sequence) | live only | §6. EXPLAINED in the tool with the reason; never counted. |
| — | `pg_stat_statements` view + 3 functions | live only | Extension-owned; the tool now excludes extension objects. |
| — | `sync_money_sim_paise()` | live only | Residue of `scripts/money-simulation.sql`; no trigger references it. **DEPRECATE_CANDIDATE**, operator drop. |

### The repair — `20260921140000_live_only_check_and_column_alignment`

Hand-written, idempotent, no `migrate diff`. Adds the CHECK if absent, drops the plaintext index if
present, sets `service_categories` NOT NULL (after a WHERE-scoped empty-array fill), and adds each
missing default on the side lacking it. `check-migration-safety.ts`: OK.

### Evidence

| Step | Result |
|---|---|
| `migrate deploy` on the rebuild | applied, exit 0 |
| `verify-migration-authority.ts` on the rebuild | **35/35** (was 32/32: +`users_phone_number_idx` must-be-absent, +2 CHECK constraints asserted by definition and `convalidated`) |
| `migrate status` on live | exactly one pending (`20260921140000`) + the known rename-residue row |
| Live 11-measure snapshot before | `D:/homigo-backups/pass6-snapshot-pre-140000.json` — users 882, bookings 705, ledger debit = credit = ₹711,290.10 |
| `migrate deploy` on live | applied, exit 0 |
| Live 11-measure snapshot after | `pass6-snapshot-post-140000.json` — **identical** |
| `verify-migration-authority.ts` on live | **35/35** |
| Catalog diff rebuild vs live | **IDENTICAL** — 0 MISSING / 0 EXTRA / 0 DIFFERENT; 14 EXPLAINED (`D:/homigo-ci-tmp/schema-diff-post-live-apply.txt`) |
| `/health`, `/ready` on the running backend | 200 / 200 |

### Gates that now carry MIG-4

- `scripts/check-migration-safety.ts` — `booking_completed_requires_timestamp` is a protected RAW_SQL_INVARIANT; a migration dropping it is refused.
- `scripts/verify-migration-authority.ts` — asserted on every target by name, definition text and `convalidated`.
- `scripts/setup-test-db.ts` — `20260921140000` is in `INVARIANT_MIGRATIONS`, so the isolated test database carries the CHECK.
- `src/__tests__/db-invariants.test.ts` — asserts `contype = 'c'` for it on the test database.
- `scripts/diff-schema-catalogs.ts` — exits 1 on any unexplained difference; EXPLAINED entries carry their reason in the source.

### Left open on purpose

- `sync_money_sim_paise()` — operator drop (DEPRECATE_CANDIDATE). Not dropped here: no DDL on live beyond the migration.
- `forensic_recovery_log` — §6 unchanged.
- 180 users still carry a plaintext `phone_number` and **no** `phone_hash`; `user-pii.service` falls back to a plaintext equality for them. The retired index does not change that path on live (it was already absent). The fix is the hash backfill, not an index — **OPERATOR_ACTION**, tracked in the Pass 6 board.
