#!/usr/bin/env bun
/** Schema drift regression — bookings.addons + Phase 1 tables */
import prisma from "../src/lib/prisma";

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

async function main() {
  const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'addons'
  `;
  checks.push({ name: "bookings.addons", ok: cols.length > 0, detail: cols.length ? "JSONB present" : "MISSING" });

  const sample = await prisma.booking.findFirst({ select: { id: true, addons: true } }).catch(() => null);
  checks.push({ name: "bookings.addons_query", ok: sample !== null, detail: sample ? "query OK" : "query failed" });

  for (const table of ["etl_watermarks", "etl_job_executions", "data_quality_results", "ml_feature_staging"]) {
    const exists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${table}) AS exists
    `;
    checks.push({ name: `table_${table}`, ok: !!exists[0]?.exists, detail: exists[0]?.exists ? "exists" : "missing" });
  }

  for (const c of checks) console.log(`${c.ok ? "✅" : "❌"} ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) process.exit(1);
  console.log("\nRegression validation PASSED");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
