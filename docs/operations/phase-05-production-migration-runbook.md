# Phase 05 — production migration runbook (service domain, pricing, duration-aware partner slot)

| | |
|---|---|
| Status | **Readiness certified · execution BLOCKED — no production database target exists** |
| Owner of execution | Platform owner / DBA (a human; never an agent) |
| Applies | `apps/backend/prisma/migrations/20260919090000_*` … `20260921180000_*` (Phase 05 set, below) |
| Tooling | `apps/backend/scripts/release/phase05-migration-preflight.ts` (new, read-only), existing release gate `scripts/release/production-release.ts` |
| Rehearsed on | local `homigo_db` (dev data) 2026-09-22 — evidence in `docs/operations/evidence/phase05-preflight-homigo_db-{pre,post}-2026-09-22.json` |

This runbook does **not** replace the release gate or the general procedures. It adds what is specific to
Phase 05 and links the rest:

- Release gate + authorization file: `scripts/release/production-release.ts`, `PHASE_15_PRODUCTION_MIGRATION_PLAN.md` (§E post-deploy SQL, §F rollback), `PHASE_15_RELEASE_GUARD_VALIDATION.md`
- Promotion / rollback: `docs/operations/PRODUCTION-PROMOTION-RUNBOOK.md`, `docs/operations/ROLLBACK-RUNBOOK.md`
- Restore: `docs/runbooks/database-restore.md`, `docs/p2/P2_DR_RUNBOOK.md`
- History reconciliation (baselining a DB with no / drifted `_prisma_migrations`): `docs/homigo-db-migration-reconciliation-runbook.md`
- Service-domain migrations up to `20260920130000`: `docs/service-domain-production-migration-runbook.md`

## Never

- `prisma db push`, `prisma migrate reset`, `prisma migrate dev` against production.
- `prisma migrate resolve --applied …` to "skip" a migration (`scripts/resolve-pending-migrations.ts` does exactly this — not for production).
- Running any Prisma CLI command without an explicit URL you have read back: `prisma.config.ts` loads `.env` (the 2026-09-16 incident).
- Migrating through PgBouncer (`deploy/k8s/backend-deployment.yaml` points `DATABASE_URL` at a transaction-mode pooler). Use a **direct, non-pooled** URL for the migration session only.

## What runs, and what it does to existing data

| Migration | Effect | Class | Lock / cost note |
|---|---|---|---|
| `20260919090000_service_catalog_config` | services catalogue config column | additive | brief |
| `20260920120000_service_domain` | service domain columns / tables | additive | brief |
| `20260920130000_service_variants_addons` | variants / add-ons tables | additive | brief |
| `20260921120000_data_provenance` | `DataOrigin` enum; nullable `data_origin` on users, bookings, refund_requests | additive | brief |
| `20260921140000_live_only_check_and_column_alignment` | CHECK `booking_completed_requires_timestamp` (validates **all** bookings); `UPDATE geofences` + `SET NOT NULL`; drops `users_phone_number_idx` | data-changing | full scan of `bookings`; fails if any COMPLETED row lacks `completed_at` — run the pre-query below |
| `20260921150000_service_identity_taxonomy` | taxonomy rows; `UPDATE services SET service_code = slug` + `SET NOT NULL`; ~55 taxonomy backfill UPDATEs; triggers | data-changing | rewrites `services` rows (small table) |
| `20260921160000_service_addon_dependencies` | add-on dependency columns + CHECKs | additive | CHECKs validate existing add-ons |
| `20260921170000_service_pricing_integrity` | paise-precision / currency CHECKs; `services.data_origin`; marks test-pattern slugs `INFERRED_FIXTURE` | additive + backfill | CHECKs fail if any price has sub-paise precision — pre-query below |
| `20260921180000_duration_aware_partner_slot` | `services.partner_slot_policy` (default DURATION; laundry family → FIXED); `bookings.slot_duration_minutes` (nullable); replaces `bookings_sync_conflict_slots()` | additive + backfill | **existing bookings keep NULL → the legacy 60-min window; nothing is re-slotted** (owner decision D1) |

Earlier migrations in the same release (not Phase 05 but pending on any target older than 2026-09-21)
include `20260921090000_schema_drift_repair`, which **drops four plaintext-PII unique indexes** and creates ~20
indexes with plain `CREATE INDEX` (not `CONCURRENTLY`) — writes to bookings/payments block while they
build. Schedule a maintenance window sized on the target's row counts.

## Procedure

### 0. Preconditions (all must hold — today the first does not)

1. A production database target exists and its **direct** URL is known to the operator. *(BLOCKED: `docs/production-backup-and-alerting-requirements.md` — no production infrastructure or credentials.)*
2. The signed `.production-authorization.json` exists and `production-release.ts` passes (its `approvedMigrations` must list exactly the pending set — update the example, which still lists the Phase-15 set).
3. The release is built from a commit that **contains** the migration directories (all `202609*` migrations are untracked in git today — commit them first; a deploy from `HEAD` would ship none of this).
4. Traffic plan: writes paused, or a maintenance window agreed.

### 1. Backup and prove it

```bash
cd apps/backend
DATABASE_URL="$DIRECT_URL" bun run backup:db            # pg_dump -Fc + .sha256 sidecar
DR_SCRATCH_DATABASE_URL="$SCRATCH_URL" DATABASE_URL="$DIRECT_URL" bun run backup:verify-restore   # restore into scratch, row counts
```

### 2. Preflight (read-only)

```bash
bun run scripts/release/phase05-migration-preflight.ts --pre \
  --url "$DIRECT_URL" --confirm-db <prod db name> \
  --backup backups/<file>.dump --evidence evidence/phase05-pre.json
```

Must end `PASS`. It refuses without `--url`/`--confirm-db`, runs every query in one `READ ONLY` transaction and fails on:
wrong database · stale (> 6 h), unverified or other-database backup · tables without migration history (a `db push`-built
DB — baseline first) · failed / drifted / out-of-order history rows · **applied migrations whose file changed after apply**.
It lists the pending set and every destructive or data-changing statement in it, and fingerprints every existing
booking's partner window for step 6.

Pre-queries for the two CHECKs that validate existing rows (read-only; both must return 0):

```sql
SELECT count(*) FROM bookings WHERE status = 'COMPLETED' AND completed_at IS NULL;
SELECT count(*) FROM services WHERE round(base_price::numeric * 100) <> base_price::numeric * 100
                                 OR round(coalesce(min_price, 0)::numeric * 100) <> coalesce(min_price, 0)::numeric * 100
                                 OR round(coalesce(max_price, 0)::numeric * 100) <> coalesce(max_price, 0)::numeric * 100;
```

### 3. Rehearse on a restored clone

Restore the step-1 dump into a scratch database, run steps 4–6 against it, and keep the evidence. Only a clean rehearsal
authorizes step 4 on production. (`scripts/certify-fresh-migrate.ts` additionally proves the migrations build a DB from
empty; it refuses production-like names.)

### 4. Apply

```bash
cd apps/backend
DATABASE_URL="$DIRECT_URL" bunx prisma migrate deploy      # read the URL back before pressing enter
```

### 5. Post-verify (read-only)

```bash
bun run scripts/release/phase05-migration-preflight.ts --post \
  --url "$DIRECT_URL" --confirm-db <prod db name> \
  --pre-evidence evidence/phase05-pre.json --evidence evidence/phase05-post.json
DATABASE_URL="$DIRECT_URL" bun run scripts/pricing-readiness-report.ts --fail-on-incomplete
DATABASE_URL="$DIRECT_URL" bun run scripts/release/post-deploy-verify.ts   # NOTE: EXPECTED_APPLIED_MIGRATIONS=109 is stale (132 on disk) — update before use
```

`--post` must show every column / constraint / trigger check `PASS` and **"existing partner windows unchanged (D1)"**.
A differing fingerprint is expected only if bookings were created or cancelled between `--pre` and `--post`; with writes
paused it must be identical. `pricing-readiness-report` must report `bookable-but-not-price-complete: 0`.

### 6. Reopen traffic, then smoke

Quote → book → pay with a real low-value test service; confirm the partner calendar blocks the full appointment for a
DURATION service and 60 minutes for laundry.

## Rollback

There is no down-migration. The honest options, in order:

1. **Before reopening traffic:** restore the step-1 backup (`docs/runbooks/database-restore.md`). Loses nothing.
2. **After traffic, D1 behaviour only:** revert the slot function to the pre-Phase-05 body. The trigger fires only on
   `scheduled_date`, `status`, `provider_id`, so existing rows are not rewritten; bookings made since keep their stored
   window until one of those columns changes.

   ```sql
   CREATE OR REPLACE FUNCTION bookings_sync_conflict_slots() RETURNS trigger AS $$
   BEGIN
     IF NEW.status IN ('PENDING', 'ACCEPTED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS') THEN
       NEW.user_slot_start := NEW.scheduled_date - interval '30 minutes';
       NEW.user_slot_end := NEW.scheduled_date + interval '30 minutes';
       IF NEW.provider_id IS NOT NULL THEN
         NEW.provider_slot_start := NEW.scheduled_date - interval '30 minutes';
         NEW.provider_slot_end := NEW.scheduled_date + interval '30 minutes';
       ELSE
         NEW.provider_slot_start := NULL; NEW.provider_slot_end := NULL;
       END IF;
     ELSE
       NEW.user_slot_start := NULL; NEW.user_slot_end := NULL;
       NEW.provider_slot_start := NULL; NEW.provider_slot_end := NULL;
     END IF;
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;
   ```

   The application's mirror (`reservedWindow()` in `booking-validation.service.ts`) must be reverted in the same release.
3. **Columns and CHECKs** are additive and safe to leave in place under the previous application version.
   The data backfills (`service_code`, taxonomy, `INFERRED_FIXTURE` marks, laundry → FIXED) are one-way without the backup.

## Migration history reconciliation (2026-09-22) — CLOSED

The first closure report said "6 migrations edited after apply". **That count was wrong**: the preflight line
was truncated when read. The untruncated check found **48** applied rows whose file no longer hashes to the
checksum Prisma recorded.

Forensics (read-only on `homigo_db`): each applied checksum was matched to a git revision; applied vs
current content was diffed; a migrations-only rebuild (`homigo_cert_migrate`, `certify-fresh-migrate`) was
compared object by object with `homigo_db` (`diff-schema-catalogs`) → **IDENTICAL**. `prisma migrate status`
reported "up to date" on both — Prisma never re-checks applied checksums, which is why this went unseen.

| MIGRATION | APPLIED STATE | REPO STATE | SCHEMA IMPACT | RECONCILIATION | EVIDENCE |
|---|---|---|---|---|---|
| 40 migrations `20260608240000` … `20260825120000` (list in the evidence file) | applied from LF bytes | same content, CRLF working copies (`core.autocrlf=true`, no `.gitattributes`) | **A — none** (byte-identical after LF normalisation) | files normalised to LF; `apps/backend/.gitattributes` pins `prisma/migrations/**/*.sql eol=lf` so checkouts cannot drift again. **No history change.** | `git diff --quiet` on the 23 tracked files = no content change |
| `20260529114745_part_6a_realtime_tracking` | plain `DROP INDEX` / `CREATE INDEX` | `IF EXISTS` / `IF NOT EXISTS`; 3 index creations moved to the next migration | **A** — same objects | checksum reconciled | catalog IDENTICAL |
| `20260529120000_add_partner_registration` | — | + 3 `CREATE INDEX IF NOT EXISTS` (moved in) | **A/C** — objects already on live | checksum reconciled | catalog IDENTICAL |
| `20260608120000_membership_premium_engine` | — | + `ReferralStatus`, `referral_transactions`, `referral_commissions`, `referral_withdrawals` (+ indexes, FKs) | **C** — live had them (created outside migrations); the edit made fresh builds reproduce live | checksum reconciled | catalog IDENTICAL |
| `20260608140000_referral_fraud_engine` | `status DEFAULT 'APPROVED'` | `DEFAULT 'PENDING'` | **C** — live column default is already `'PENDING'` (verified on both DBs) | checksum reconciled | `information_schema.columns` on live + fresh |
| `20260608210000_financial_ledger` | — | + `HCoinTxnType`, `hcoin_wallets`, `hcoin_transactions`, `hcoin_rewards` | **C** | checksum reconciled | catalog IDENTICAL |
| `20260609280000_money_paise_full_dual_write` | — | + `wallet_transfers`, wallet paise columns, email-verification columns, `services.premium_only`, `bookings.addons` (all `IF NOT EXISTS`) | **C** | checksum reconciled | catalog IDENTICAL |
| `20260616120000_assignment_broadcast_dispatch` | history row inserted **by hand**; checksum literal `manual-broadcast` (not a hash) | real file | **D** — history hand-edited | checksum set to the file hash | catalog IDENTICAL |
| `20260824130000_assignment_attempt_unique_dedup` | no git revision matches (edited before first commit) | current file | **D** | checksum reconciled | catalog IDENTICAL |

Correction applied with `scripts/release/reconcile-migration-checksums.ts` (new): metadata-only, one transaction,
compare-and-set per row. It **refuses** without `HOMIGO_DDL_CONFIRM=<db>`, and refuses unless a migrations-only
rebuild is catalog-IDENTICAL to the target (proven: pointing `--expected` at the db-push-built `homigo_test` was
refused). Backup first (`homigo_2026-09-22T04-34-18-362Z.dump`, sha256 `cc2fb3c5…`, verified).
Evidence: `docs/operations/evidence/migration-checksum-reconciliation-homigo_db-2026-09-22.json` (old → new per row).
After: preflight `applied migrations unedited (checksum)` **PASS**; reconcile dry-run "nothing to reconcile".

- **Existing populated DB path:** safe — no DDL ran; business tables untouched (8-table fingerprint identical).
- **Fresh path:** `certify-fresh-migrate` builds the full schema from the 132 migrations; catalog IDENTICAL to live.
- **A production DB that applied the originals:** run the same tool against it, after its own migrations-only
  catalog proof. The preflight now distinguishes line-ending-only (WARN) from content drift (FAIL).

## Test database parity (2026-09-22)

`homigo_test` is left as is (db push, used by the suite). A **migrations-only** database,
`homigo_migrations_test`, was built with `certify-fresh-migrate` (132 migrations, schema-drift OK, 35 protected
objects) and given the disposable-DB grant (`homigo.allow_financial_purge=on`).

- Full backend suite on it: **2934 pass / 0 fail** (the first run's 10 failures were the `_test`-suffix naming
  convention and timeouts, not schema).
- Phase 05 + money suites on it: 424/0.
- CURRENT TEST DB vs MIGRATION-BUILT DB (`diff-schema-catalogs`): 61 differences, all explained by `db push`
  building from `schema.prisma` instead of migration SQL:
  - `_prisma_migrations` absent on `homigo_test` (by construction);
  - index and constraint **names** differ where Prisma's generated names differ from the migrations' hand-written ones (12 EXTRA / 12 MISSING pairs on the same columns);
  - 3 migration-only performance indexes (`idx_bookings_status_created`, `idx_bookings_user_scheduled`, `idx_payments_user_status_created`) are absent on `homigo_test`;
  - DB-level defaults set by migrations (`now()`, `ARRAY[]::text[]`, `clock_timestamp()`) that `schema.prisma` leaves to the client;
  - enum value **order** (values are identical);
  - function-body whitespace (the test-setup SQL replay collapses newlines; hashes differ, logic identical — verified for `bookings_record_status_history`; the D1 slot trigger `bookings_sync_conflict_slots` is byte-identical);
  - `wallet_transactions_idempotency_key_key`: partial unique index (`WHERE key IS NOT NULL`) on migrations vs a full unique index on the test DB — equivalent in Postgres, because unique indexes admit many NULLs.
- None of these changes a Phase 05 invariant (money CHECKs, exclusion constraints, D1 trigger, provenance columns are identical); the migration-built DB is now the parity reference.

## Open items found while certifying (not caused by Phase 05)

| Item | Evidence | Action |
|---|---|---|
| `homigo_test` is built with `db push` (no migration history) | preflight `--pre` on homigo_test: history FAIL | Test-only. The migration-built `homigo_migrations_test` is the parity reference (full suite 2934/0). |
| `db:push` script (`package.json`) and `scripts/reset-dev-db.ps1` (`migrate reset --force`) have no target guard | survey | Guard them with `assertDdlTarget` (`src/lib/ddl-target-guard.ts`) or remove. |
| `post-deploy-verify.ts` expects 109 applied migrations; 132 exist | `scripts/release/post-deploy-verify.ts:20` | Update the constant with the release. |
| No `directUrl` in `schema.prisma`; runtime URL is a transaction-mode pooler in k8s | `deploy/k8s/backend-deployment.yaml:30-32` | Provide a direct URL for migrations. |
