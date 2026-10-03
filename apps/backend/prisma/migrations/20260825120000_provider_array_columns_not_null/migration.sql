-- P2-10: sibling of P1-6. `service_regions`, `working_days` and `certifications` on `providers`
-- have the same structural gap `service_categories` had — no DEFAULT and no NOT NULL, despite
-- Prisma typing them `String[]` (never null). Unlike `service_categories` (which had zero NULL
-- rows), these three carry REAL NULL data today, verified before writing this migration:
--     service_regions  NULL=25   empty=1    populated=120
--     working_days     NULL=80   empty=2    populated=64
--     certifications   NULL=78   empty=68   populated=0
-- so a backfill is required BEFORE the constraint can be added.
--
-- No data loss: for all three columns NULL and '{}' mean the same thing — "none declared". The
-- backfill only ever touches rows that are currently NULL; no populated array is read, rewritten
-- or reordered. Verified empirically: populated counts are identical before and after.
--
-- Why bother, given reads are already safe? Prisma's ORM client coerces NULL -> [] on read
-- (verified against real NULL rows), and the single raw-SQL reader
-- (partner-operations.service.ts's FOR UPDATE row lock) already guards both fields it selects
-- with `?? []` after a real production crash. This closes the gap at the source so a FUTURE raw
-- reader cannot reintroduce that crash class, rather than relying on every future call site
-- remembering the guard.

UPDATE "providers" SET "service_regions" = '{}' WHERE "service_regions" IS NULL;
UPDATE "providers" SET "working_days"    = '{}' WHERE "working_days"    IS NULL;
UPDATE "providers" SET "certifications"  = '{}' WHERE "certifications"  IS NULL;

ALTER TABLE "providers" ALTER COLUMN "service_regions" SET DEFAULT '{}';
ALTER TABLE "providers" ALTER COLUMN "working_days"    SET DEFAULT '{}';
ALTER TABLE "providers" ALTER COLUMN "certifications"  SET DEFAULT '{}';

ALTER TABLE "providers" ALTER COLUMN "service_regions" SET NOT NULL;
ALTER TABLE "providers" ALTER COLUMN "working_days"    SET NOT NULL;
ALTER TABLE "providers" ALTER COLUMN "certifications"  SET NOT NULL;
