import "../src/load-env";
import prisma from "../src/lib/prisma";
import { announceDdlTarget, assertDdlTarget } from "../src/lib/ddl-target-guard";

/**
 * Adds an enum value. Additive and idempotent, but it still writes to whichever database
 * DATABASE_URL names — which must be stated rather than inherited from a stale shell.
 *   HOMIGO_DDL_CONFIRM=homigo_db bun run scripts/apply-partner-incentive-enum.ts
 */
const target = assertDdlTarget(process.env.DATABASE_URL?.includes("test") ? "test" : "live");
announceDdlTarget("JournalEntryType.PARTNER_INCENTIVE", target);

await prisma.$executeRawUnsafe(
  `ALTER TYPE "JournalEntryType" ADD VALUE IF NOT EXISTS 'PARTNER_INCENTIVE'`,
);
console.log("PARTNER_INCENTIVE enum applied to", target.database);
await prisma.$disconnect();
