import { PrismaClient } from "@prisma/client";
import { announceDdlTarget, assertDdlTarget, DdlTargetRefusal } from "../src/lib/ddl-target-guard";

/**
 * Re-applies the `wallet_balance_consistency` CHECK.
 *
 * This DROPs a protected constraint before re-adding it, so it is exactly the shape the migration
 * guard exists to catch. The urls used to be hardcoded for both databases and applied
 * unconditionally — meaning a single `bun run` rewrote a live constraint with no statement of
 * intent. Now each leg is guarded, and the live leg only runs when explicitly named:
 *
 *   bun run scripts/apply-wallet-bonus-consistency.ts                       # test DB only
 *   HOMIGO_DDL_CONFIRM=homigo_db bun run scripts/apply-wallet-bonus-consistency.ts --live
 *
 * The canonical source of this constraint is
 * prisma/migrations/20260825170000_wallet_txn_bonus_consistency/migration.sql; this script exists
 * only to re-apply it to an already-provisioned database.
 */
const DROP = `ALTER TABLE "wallet_transactions" DROP CONSTRAINT IF EXISTS "wallet_balance_consistency"`;
const ADD = `
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_balance_consistency" CHECK (
  (status)::text <> 'COMPLETED'
  OR wallet_balance_after IS NULL
  OR wallet_balance_before IS NULL
  OR (
    (type)::text = ANY (ARRAY['CREDIT'::text, 'REFUND'::text, 'BONUS'::text])
    AND abs(wallet_balance_after - (wallet_balance_before + amount)) < 0.005
  )
  OR (
    (type)::text = ANY (ARRAY['DEBIT'::text, 'WITHDRAWAL'::text])
    AND abs(wallet_balance_after - (wallet_balance_before - amount)) < 0.005
  )
  OR (type)::text = 'REVERSAL'
)
`;

function urlFor(database: string): string {
  const base = process.env.DATABASE_URL ?? "postgresql://postgres:homigo_dev@localhost:5433/homigo_db";
  try {
    const u = new URL(base);
    u.pathname = `/${database}`;
    u.search = "";
    return u.toString();
  } catch {
    return `postgresql://postgres:homigo_dev@localhost:5433/${database}`;
  }
}

async function apply(intent: "test" | "live", database: string) {
  const target = assertDdlTarget(intent, urlFor(database));
  announceDdlTarget("wallet_balance_consistency", target);
  const prisma = new PrismaClient({ datasources: { db: { url: urlFor(database) } } });
  try {
    await prisma.$executeRawUnsafe(DROP);
    await prisma.$executeRawUnsafe(ADD);
    console.log(`${target.database}: wallet_balance_consistency updated`);
  } finally {
    await prisma.$disconnect();
  }
}

await apply("test", "homigo_test");

if (process.argv.includes("--live")) {
  try {
    await apply("live", "homigo_db");
  } catch (err) {
    if (err instanceof DdlTargetRefusal) {
      console.error(err.message);
      process.exit(3);
    }
    throw err;
  }
} else {
  console.log("[ddl-guard] live leg skipped — pass --live with HOMIGO_DDL_CONFIRM=homigo_db to include it");
}
