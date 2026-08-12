/**
 * Execute money-drift-validation.sql via Prisma.
 * Usage: bun --env-file=.env run scripts/run-money-drift.ts
 */
import "../src/load-env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import prisma from "../src/lib/prisma";

async function main() {
  const sql = readFileSync(resolve(import.meta.dir, "money-drift-validation.sql"), "utf8")
    .replace(/^--.*$/gm, "")
    .trim();

  const rows = await prisma.$queryRawUnsafe<Array<{ col: string; mismatches: bigint | number }>>(
    sql,
  );
  const total = rows.reduce((sum, r) => sum + Number(r.mismatches), 0);
  const failing = rows.filter((r) => Number(r.mismatches) > 0);
  console.log(JSON.stringify({ columnsChecked: rows.length, totalMismatches: total, failing, rows }, null, 2));
  if (total > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
