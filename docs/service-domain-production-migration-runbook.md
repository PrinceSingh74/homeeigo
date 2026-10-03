# Service domain — production migration runbook

**Do not execute against production without explicit authorization.** This pass did not.

Rehearsal (this session): `bun run scripts/certify-fresh-migrate.ts` against **`homigo_cert_migrate`** on `homigo-postgres:5433`.

- 124 migrations applied in order
- no manual repair
- `scripts/check-schema-drift.ts` OK (2976 model fields, 35 protected objects)
- no `prisma db push`

## Pre-check

1. Owner written authorization naming the target database.
2. Confirm `DATABASE_URL` database name is the intended production name (print it; abort if it is `homigo_db` / `*_test` / `*_cert_*` by mistake, or the reverse).
3. `bun run scripts/check-migration-safety.ts` — must OK.
4. Snapshot `_prisma_migrations` vs `prisma/migrations` directories. Resolve unknown applied names (dev currently records `20260817090000_notification_delivery_claim` with **no repo directory**) **before** deploy, or deploy will disagree with Prisma.
5. Backup (pg_dump or cloud snapshot) **completed and restore-tested on a clone**.
6. `scripts/prisma-generate-windows.ts` on deploy runners (Linux CI does not have the Windows DLL lock).

## Backup

```bash
cd apps/backend
bun --env-file=.env run scripts/backup-db.ts
```

Retain dump + sha256. Local rehearsal is not production PITR.

## Schema snapshot

Record:

```sql
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY 1;
SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1;
SELECT conname FROM pg_constraint WHERE conname LIKE 'bookings_%slot%' OR conname IN ('wallet_balance_consistency');
```

## Migration order

```bash
cd apps/backend
bunx prisma migrate deploy
```

Service-domain files (additive, last in chain):

- `20260920110000_booking_queue_indexes`
- `20260920120000_service_domain`
- `20260920130000_service_variants_addons`

No drops of `catalog_config`, slot triggers, or exclusion constraints.

## Protected objects (must survive)

Triggers listed in `scripts/check-schema-drift.ts` (`bookings_conflict_slots_trg`, money paise sync, financial history guards, …). Constraints `bookings_provider_slot_excl`, `bookings_user_slot_excl`, `wallet_balance_consistency`. Sequences `journal_entry_number_seq`, `wallet_txn_number_seq`, `withdrawal_number_seq`. Hidden slot columns `provider_slot_*` / `user_slot_*`.

## Data checks

- Service rows still `is_active` as before (migration does not unpublish).
- JSON `catalog_config` intact.
- Variant/addon backfill: only ids matching the code regex; others skipped, not invented.
- Grandfathered SKUs remain bookable if they were.

## Post-check

```bash
bun --env-file=.env run scripts/check-schema-drift.ts
bunx prisma generate
# health + quote + booking smoke against the migrated environment
```

## Rollback

Additive columns/tables. Reverse drop only after readers are gone. **Do not** drop `catalog_config` or booking snapshots. Slot trigger rollback is a separate owner-approved protected migration (see `docs/business-decision-scheduling.md`).

## Verification / monitoring

- `service_quote_failures_total`, `service_catalog_lookup_latency`
- error rate on `/api/services`, quote, booking create
- exclusion-constraint 23P01 rate unchanged

## Smoke tests (post-migrate, non-production first)

Against the migrated environment (never against unauthorized production):

1. `GET /health` → database ok
2. `GET /api/services?limit=5` → 200, no INTERNAL/DRAFT
3. Server price-quote for a known SKU (no client total)
4. One booking create on an isolated clone only
5. `scripts/check-schema-drift.ts` still OK
6. Protected slot exclusions still reject overlapping partner slots

## Operator authorization boundary

`prisma migrate deploy` against production is permitted only when a named owner has written:

- target instance + database name
- backup/restore proof
- maintenance window
- go/no-go

This repository does **not** contain that authorization. `PRODUCTION_MIGRATE` stays **BLOCKED**.

## Failure handling

If deploy fails mid-chain: do not hand-edit production. Restore from backup or Prisma migrate resolve only with recorded checksum investigation. Never `prisma db push` on production.
