# DBA runbook — reconcile `homigo_db` migration history (dev)

**Status: CLONE REHEARSAL PASS — live `homigo_db` still BLOCKED pending operator apply.**  
**Pass 4 (2026-09-20): `pg_dump` → `homigo_db_reconcile_clone` → soft-retire orphan → `migrate deploy` → drift OK → `:3011/api/services` 200. Live DB not mutated. No TEMPLATE. No `db push`.**

## Evidence (live `homigo_db` after Postgres recovery)

| Fact | Value |
|---|---|
| Size | 1058 MB |
| Applied finished migrations | 122 |
| Repo migration directories | 124 |
| Orphan applied name (no repo dir) | `20260817090000_notification_delivery_claim` |
| Matching repo dir | `20260817110000_notification_delivery_claim` |
| Checksums | **identical** `17fd70865fbc115e9e1835962e5740d0ba4bf0c48183e9656358628cdf07bcd7` = SHA-256 of repo `migration.sql` |
| Schema for claim SQL | `notification_deliveries.updated_at` **exists**; enum `PENDING` **exists** — SQL already applied |
| Both rows finished | yes (090000 on 2026-08-19; 110000 on 2026-09-07) |
| Missing applied (SQL **not** on schema) | `20260920110000_booking_queue_indexes`, `20260920120000_service_domain`, `20260920130000_service_variants_addons` |
| Proof 20110000 absent | indexes `bookings_queue_pending_idx` / `bookings_wait_time_by_priority_idx` **missing** |
| Proof 20120000/130000 absent | no `capability_profile` / lifecycle columns; `service_variants` / `service_addons` **null** |
| Other queue-like indexes present | `bookings_queue_priority_status_idx`, `bookings_status_provider_id_priority_score_queued_at_idx` — **different** names; not substitutes for marking 20110000 applied |
| TEMPLATE clone | **unsafe** — crashed local postmaster; do **not** retry |

## Classification

1. **Renamed migration (duplicate history), not missing SQL:** `20260817090000` ↔ `20260817110000` same checksum, objects present. Orphan name blocks clean `migrate deploy` because Prisma sees an applied migration with no directory.
2. **Genuinely unapplied additive migrations:** the three `20260920*` service-domain / queue-index files — directories in repo, objects absent on `homigo_db`.
3. **Not** stale DB-only invent; **not** missing repo SQL for those three.

## Forbidden on live `homigo_db`

- `prisma db push`
- `prisma migrate reset`
- `CREATE DATABASE … TEMPLATE homigo_db` on this Docker host
- Deleting `_prisma_migrations` rows without a verified backup + clone rehearsal
- Manufacturing alternate SQL

## Safe procedure (operator / DBA)

### A. Backup (required)

```bash
# Prefer pg_dump to a file — NOT TEMPLATE clone on this workstation
docker exec homigo-postgres pg_dump -U postgres -Fc -d homigo_db -f /tmp/homigo_db_pre_reconcile.dump
docker cp homigo-postgres:/tmp/homigo_db_pre_reconcile.dump ./homigo_db_pre_reconcile.dump
sha256sum homigo_db_pre_reconcile.dump
```

Restore-test the dump on a **separate** Postgres (spare disk/RAM host or CI service), not another TEMPLATE on the same overloaded Docker VM.

### B. Clone via restore (not TEMPLATE)

```bash
createdb -U postgres homigo_db_reconcile_clone
pg_restore -U postgres -d homigo_db_reconcile_clone --no-owner ./homigo_db_pre_reconcile.dump
```

### C. Soft-retire the orphan name (clone only first)

Do **not** delete the row. Mark it rolled back so Prisma ignores it; keep the finished `20260817110000` row (same checksum, repo directory exists):

```sql
-- ON CLONE ONLY
BEGIN;
UPDATE "_prisma_migrations"
SET "rolled_back_at" = NOW()
WHERE "migration_name" = '20260817090000_notification_delivery_claim'
  AND "rolled_back_at" IS NULL;
-- Expect 1 row. Do not touch 20260817110000.
COMMIT;
```

Verify:

```sql
SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled
FROM "_prisma_migrations"
WHERE migration_name LIKE '%notification_delivery_claim%';
-- 090000: finished=t, rolled=t
-- 110000: finished=t, rolled=f
```

### D. Deploy the three missing migrations (clone)

```bash
cd apps/backend
DATABASE_URL="postgresql://…/homigo_db_reconcile_clone" bunx prisma migrate deploy
DATABASE_URL="postgresql://…/homigo_db_reconcile_clone" bun run scripts/check-schema-drift.ts
```

Expect: `service_variants` / `service_addons` present; `capability_profile` + lifecycle columns; `bookings_queue_pending_idx` + `bookings_wait_time_by_priority_idx` present; drift OK; protected triggers intact.

### E. Smoke (clone)

- `GET /api/services` 200 against an API pointed at the clone
- quote + booking smoke from runbook
- `check-migration-safety.ts`

### F. Live `homigo_db` (only after clone PASS + written approval)

Repeat **C → D → E** on live with maintenance window. Keep dump from A. No reset.

## Pass 4 rehearsal evidence (clone only)

| Step | Result |
|---|---|
| `pg_dump -Fc` → `/tmp/homigo_db_pass4.dump` | **62.2 MB**, exit 0 (~14 s) |
| `CREATE DATABASE homigo_db_reconcile_clone` + `pg_restore` | exit 0; 66 services |
| Soft-retire `20260817090000` (`rolled_back_at=NOW()`) | 1 row; `20260817110000` kept finished |
| `prisma migrate deploy` on clone | applied **exactly** the three `20260920*` migrations; 124 finished |
| `check-schema-drift.ts` | **OK** (2976 fields / 35 protected) |
| Clone API `:3011` | `/health` ok; `/api/services` **200** |
| Live `homigo_db` | **untouched** — still no `is_customer_visible` / `service_variants`; orphan `rolled_back_at` still null; uncached `/api/services` still errors |

**Do not** treat clone success as live reconciliation. Live apply still needs an approved window (repeat C→D→E on `homigo_db` with the dump from A retained).

## Why live apply stays BLOCKED

Live mutation was not authorized this pass. Clone proves the procedure is safe and complete; operator must still approve applying the same steps to `homigo_db`.

## Owner / engineering

| Step | Who |
|---|---|
| Approve maintenance / spare Postgres | Owner / DBA |
| pg_dump + restore rehearsal | Engineering or DBA |
| Soft-retire 090000 + migrate deploy | Engineering with DBA oversight |
| Production (if ever) | Separate authorization — see production migration runbook |
