-- chargebacks.risk_level: TEXT → "FinancialRiskLevel", matching prisma/schema.prisma.
--
-- 20260608220000_financial_core added the column as TEXT while the Prisma model declares the
-- FinancialRiskLevel enum. A database built from the migrations (i.e. production) therefore rejects
-- any Prisma filter on it: `WHERE risk_level = $1::"FinancialRiskLevel"` → 42883 "operator does not
-- exist: text = FinancialRiskLevel" (proven on a migrations-only database, release certification
-- 2026-09-20). Databases that were shaped by `db push` (dev homigo_db, the test DB) already have the
-- enum, so this is guarded and a no-op there.
--
-- Hand-scoped. Every stored value is one of the enum labels because the application only ever writes
-- the enum; the USING cast fails the migration (and rolls it back) if that is ever not true.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chargebacks' AND column_name = 'risk_level' AND data_type = 'text'
  ) THEN
    ALTER TABLE "chargebacks" ALTER COLUMN "risk_level" DROP DEFAULT;
    ALTER TABLE "chargebacks" ALTER COLUMN "risk_level" TYPE "FinancialRiskLevel" USING "risk_level"::"FinancialRiskLevel";
    ALTER TABLE "chargebacks" ALTER COLUMN "risk_level" SET DEFAULT 'MEDIUM';
  END IF;
END $$;
