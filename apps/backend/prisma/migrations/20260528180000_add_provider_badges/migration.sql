-- Part 4: Business Logic — add `badges` to providers for the badge system.
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "badges" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
