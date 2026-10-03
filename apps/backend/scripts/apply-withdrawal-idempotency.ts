import "../src/load-env";
import prisma from "../src/lib/prisma";
import { announceDdlTarget, assertDdlTarget } from "../src/lib/ddl-target-guard";

/**
 * Additive DDL (column + unique index). It runs against whatever DATABASE_URL resolves to, which on
 * a developer machine is the LIVE local database — so the target has to be stated, not inherited.
 *   HOMIGO_DDL_CONFIRM=homigo_db bun run scripts/apply-withdrawal-idempotency.ts
 */
const target = assertDdlTarget(process.env.DATABASE_URL?.includes("test") ? "test" : "live");
announceDdlTarget("withdrawal idempotency_key", target);

await prisma.$executeRawUnsafe(
  `ALTER TABLE "withdrawals" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT`,
);
await prisma.$executeRawUnsafe(
  `CREATE UNIQUE INDEX IF NOT EXISTS "withdrawals_idempotency_key_key" ON "withdrawals"("idempotency_key")`,
);
console.log("withdrawal idempotency_key applied to", target.database);
await prisma.$disconnect();
