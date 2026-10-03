# Service domain migration plan

## Mapping

See `docs/service-domain-architecture.md` (CURRENT → TARGET). Unknown operational facts (materials SKUs, certifications, badges) are **not** backfilled.

## Migration

File: `apps/backend/prisma/migrations/20260920120000_service_domain/migration.sql`

Additive columns, `service_config_versions`.

File: `apps/backend/prisma/migrations/20260920130000_service_variants_addons/migration.sql`

- `service_variants`, `service_addons`, `service_categories`
- JSONB backfill of existing `catalog_config.variants` / `addons` (ids that fail the code regex are skipped, not invented)
- Distinct `services.category` → `service_categories` lookup
- No `DROP` of `catalog_config`, bookings, triggers, or exclusion constraints

## Apply

Local / test (isolated database only):

```bash
cd apps/backend
bunx prisma migrate deploy   # against the intended DATABASE_URL
bunx prisma generate
bun run check:migration-safety
bun --env-file=.env.test run scripts/check-schema-drift.ts
```

Production: **not executed** by this change set. Requires explicit authorization.

## Rollback (practical)

New columns and `service_config_versions` are additive. A reverse migration would drop them only after confirming no readers remain. Do not drop `catalog_config` or `service_selection`.

## Verification

1. `bunx prisma generate`
2. Typecheck / unit tests (`service-domain`, `service-catalog-config`)
3. Existing booking selection tests
4. Protected-object / schema-drift scripts
5. Catalogue list still keyed by `is_active` (synced with `is_customer_visible`)
