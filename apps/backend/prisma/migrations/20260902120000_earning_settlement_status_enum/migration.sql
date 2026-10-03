-- G-03: constrain Earning.payment_status to canonical enum (was unconstrained TEXT default 'credited').

CREATE TYPE "EarningSettlementStatus" AS ENUM ('CREDITED', 'REVERSED');

ALTER TABLE "earnings"
  ALTER COLUMN "payment_status" DROP DEFAULT;

ALTER TABLE "earnings"
  ALTER COLUMN "payment_status" TYPE "EarningSettlementStatus"
  USING (
    CASE UPPER(TRIM("payment_status"))
      WHEN 'CREDITED' THEN 'CREDITED'::"EarningSettlementStatus"
      WHEN 'REVERSED' THEN 'REVERSED'::"EarningSettlementStatus"
      ELSE 'CREDITED'::"EarningSettlementStatus"
    END
  );

ALTER TABLE "earnings"
  ALTER COLUMN "payment_status" SET DEFAULT 'CREDITED';
