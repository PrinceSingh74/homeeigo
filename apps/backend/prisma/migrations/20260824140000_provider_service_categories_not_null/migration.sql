-- P1-6: Provider.serviceCategories had no DEFAULT and no NOT NULL constraint, even though its
-- Prisma type (`String[]`, non-optional) claims it can never be null. Every real read in this
-- codebase goes through Prisma's ORM client (zero raw-SQL readers of service_categories were
-- found), which does coerce a genuine NULL to `[]` in application memory — so there is no live
-- crash today. But three sibling array columns on the SAME table (service_regions, working_days,
-- certifications) already carry real NULL rows in dev right now, proving the underlying cause
-- (a column added without NOT NULL/DEFAULT) is real and already active on this table, not
-- hypothetical — and any future raw-SQL reader of service_categories (a pattern already used
-- elsewhere on this same table, e.g. partner-operations.service.ts's FOR UPDATE row locks) would
-- reproduce the exact `TypeError: null is not an object` crash class already fixed once for
-- service_regions. No existing service_categories row is currently NULL (verified before writing
-- this migration), so no backfill/dedup step is needed — this closes the gap outright rather than
-- just papering over it with a default a future explicit NULL write could still bypass.
ALTER TABLE "providers" ALTER COLUMN "service_categories" SET DEFAULT '{}';
ALTER TABLE "providers" ALTER COLUMN "service_categories" SET NOT NULL;
