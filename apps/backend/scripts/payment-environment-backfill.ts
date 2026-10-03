/**
 * §27 — deterministic environment backfill, ONLY where provable.
 *
 * The `environment` column arrives NULL (= UNKNOWN) on every historical row, and stays that way
 * unless the row carries the dev-mock gateway's own marker: order ids the mock mints start with
 * `order_dev_` and refund ids with `rfnd_dev_` (src/services/razorpay.service.ts). A row bearing
 * one of those ids never touched the real gateway in either mode, so 'TEST' is a fact, not a
 * guess. Everything else stays NULL — the environment of a real `order_…` / `rfnd_…` id cannot
 * be derived from our side (amount, date and key-at-the-time are all inference), and §27's whole
 * point is that UNKNOWN is a truthful answer while a guessed LIVE/TEST is not.
 *
 *   bun run scripts/payment-environment-backfill.ts --url postgresql://...          # report (default)
 *   bun run scripts/payment-environment-backfill.ts --url postgresql://... --apply  # fill mock rows
 *
 * `--url` is REQUIRED: this script never resolves a database from the environment, so it cannot
 * silently target the live database through a loaded `.env`. Report mode is read-only. `--apply`
 * updates ONLY rows that are NULL AND carry the mock marker; no other row is touched, ever.
 */
import { PrismaClient } from "@prisma/client";

const argOf = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const url = argOf("url");
const apply = process.argv.includes("--apply");

if (!url || url.startsWith("--")) {
  console.error("usage: bun run scripts/payment-environment-backfill.ts --url <postgresql://...> [--apply]");
  process.exit(2);
}

const dbName = url.split("/").pop()?.split("?")[0] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function columnPresent(table: string): Promise<boolean> {
  const [row] = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = 'environment'
    ) AS present`;
  return row?.present === true;
}

async function main() {
  console.log(`payment-environment backfill — db=${dbName} mode=${apply ? "APPLY" : "report"}`);

  for (const table of ["payments", "refund_requests"] as const) {
    if (!(await columnPresent(table))) {
      console.log(`  ${table}: environment column not present — migration 20260927100000_payment_environment not applied; nothing to do`);
      continue;
    }

    if (table === "payments") {
      const [c] = await prisma.$queryRaw<{ total_null: bigint; mock_null: bigint }[]>`
        SELECT count(*) FILTER (WHERE environment IS NULL) AS total_null,
               count(*) FILTER (WHERE environment IS NULL AND left(razorpay_order_id, 10) = 'order_dev_') AS mock_null
          FROM payments`;
      const totalNull = Number(c?.total_null ?? 0n);
      const mockNull = Number(c?.mock_null ?? 0n);
      console.log(`  payments: ${totalNull} UNKNOWN rows; ${mockNull} carry the dev-mock order marker (provably TEST); ${totalNull - mockNull} stay UNKNOWN`);
      if (apply && mockNull > 0) {
        const n = await prisma.$executeRaw`
          UPDATE payments SET environment = 'TEST'
           WHERE environment IS NULL AND left(razorpay_order_id, 10) = 'order_dev_'`;
        console.log(`  payments: applied — ${n} rows set to TEST`);
      }
    } else {
      const [c] = await prisma.$queryRaw<{ total_null: bigint; mock_null: bigint }[]>`
        SELECT count(*) FILTER (WHERE environment IS NULL) AS total_null,
               count(*) FILTER (WHERE environment IS NULL
                 AND (left(gateway_refund_id, 9) = 'rfnd_dev_' OR left(razorpay_refund_id, 9) = 'rfnd_dev_')) AS mock_null
          FROM refund_requests`;
      const totalNull = Number(c?.total_null ?? 0n);
      const mockNull = Number(c?.mock_null ?? 0n);
      console.log(`  refund_requests: ${totalNull} UNKNOWN rows; ${mockNull} carry the dev-mock refund marker (provably TEST); ${totalNull - mockNull} stay UNKNOWN`);
      if (apply && mockNull > 0) {
        const n = await prisma.$executeRaw`
          UPDATE refund_requests SET environment = 'TEST'
           WHERE environment IS NULL
             AND (left(gateway_refund_id, 9) = 'rfnd_dev_' OR left(razorpay_refund_id, 9) = 'rfnd_dev_')`;
        console.log(`  refund_requests: applied — ${n} rows set to TEST`);
      }
    }
  }

  if (!apply) console.log("  (report only — re-run with --apply to fill the provably-TEST rows)");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
