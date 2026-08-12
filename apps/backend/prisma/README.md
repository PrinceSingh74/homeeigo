# Prisma schema guardrails (Homigo backend)

This project uses a **curated** `schema.prisma`: PascalCase models and camelCase fields with `@map` / `@@map` to PostgreSQL snake_case tables. Migrations are the source of truth for database structure.

## Do not overwrite the schema with introspection

```bash
# Avoid on this repo — it replaces PascalCase models with raw table names
# (e.g. financial_adjustments instead of FinancialAdjustment) and breaks @prisma/client types.
bunx prisma db pull
```

If you need to compare DB vs schema, introspect to a **temporary file** and diff manually:

```bash
bunx prisma db pull --print > /tmp/introspected.prisma
# Merge only missing columns/enums into schema.prisma with proper @map directives.
```

## Safe workflow after schema changes

```bash
bunx prisma validate
bunx prisma migrate dev    # only when you intentionally change the database
bunx prisma generate
bunx tsc --noEmit
bun test
```

Production deploy:

```bash
bunx prisma migrate deploy
bunx prisma generate
```

## Naming conventions

| Prisma (schema) | PostgreSQL (DB) |
|-----------------|-----------------|
| `FinancialAdjustment` | `financial_adjustments` |
| `targetUserId` | `target_user_id` |
| `AdjustmentStatus` | `"AdjustmentStatus"` enum |

Services use camelCase accessors (`prisma.financialAdjustment`, `prisma.hCoinExpiryConfig`). Tables created by migrations use snake_case; the schema must bridge the two.

## When things look “missing” from `@prisma/client`

1. Run `bunx prisma migrate status` — if DB is up to date, tables likely exist.
2. Check for snake_case model blocks in `schema.prisma` (symptom of `db pull`).
3. Restore PascalCase + `@@map`, then `prisma generate` — **no new migration** if only naming changed.

## Related migrations (finance / ops models)

- `20260608250000_p0_security_financial_atomicity` — wallet reservations, partner registration sessions
- `20260608250000_enterprise_observability` — `app_log_entries`, `ops_alerts`
- `20260608270000_finance_integrity_10_finalization` — liability snapshots, journal enum values
- `20260608280000_finance_integrity_10_phase2` — adjustments, ledger backfill, H-Coin expiry
