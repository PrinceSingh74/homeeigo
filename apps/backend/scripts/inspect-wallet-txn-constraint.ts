import { PrismaClient } from "@prisma/client";
import { announceDdlTarget, assertDdlTarget } from "../src/lib/ddl-target-guard";

/**
 * READ-ONLY inspection of the wallet_transactions constraint and the money_to_paise function.
 *
 * It reads catalog tables only, but it used to hardcode the LIVE local url, which meant it could
 * never be pointed at the test database when that was the one being diagnosed — and a reader of
 * the output had no way to tell which database produced it. The target is now stated and printed.
 *
 *   bun run scripts/inspect-wallet-txn-constraint.ts                                  # test DB
 *   HOMIGO_DDL_CONFIRM=homigo_db DATABASE_URL=…/homigo_db bun run scripts/… --live    # live DB
 */
const live = process.argv.includes("--live");
const url = live
  ? process.env.DATABASE_URL ?? "postgresql://postgres:homigo_dev@localhost:5433/homigo_db"
  : "postgresql://postgres:homigo_dev@localhost:5433/homigo_test";

const target = assertDdlTarget(live ? "live" : "test", url);
announceDdlTarget("inspect wallet_transactions constraint", target);

const prisma = new PrismaClient({ datasources: { db: { url } } });

const rows = await prisma.$queryRaw<Array<{ conname: string; def: string }>>`
  SELECT con.conname, pg_get_constraintdef(con.oid) AS def
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'wallet_transactions'
    AND (con.conname ILIKE '%consist%' OR pg_get_constraintdef(con.oid) ILIKE '%wallet_balance%')
`;
console.log(JSON.stringify(rows, null, 2));

const fn = await prisma.$queryRaw<Array<{ def: string }>>`
  SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'money_to_paise' LIMIT 1
`;
console.log(fn[0]?.def?.slice(0, 800));

await prisma.$disconnect();
