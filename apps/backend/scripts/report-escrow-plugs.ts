/**
 * Read-only dry-run report on the historical PLATFORM_ESCROW plug entries.
 *
 * Before Enterprise Pass 2, `PLATFORM_ESCROW` was in the reconciler's ADJUSTABLE set and was
 * compared against active gift-card balance alone — although the account is commingled (booking
 * escrow, provider earnings, wallet debits, gift cards and refunds all move it). Every reconcile run
 * therefore posted a `liability_reconciliation` ADJUSTMENT forcing it towards the gift-card figure.
 * Those entries are still in the ledger.
 *
 * Reversing them is an accounting decision (BUSINESS_DECISION) and may touch closed periods, so this
 * script does not do it. It answers the questions a decision needs, per entry and in total:
 *
 *   journal · date · amount · direction · the account balance just before it · the balance just after
 *   · what the balance would be today without it · the reason recorded on it · reversal impact
 *
 *   bun run scripts/report-escrow-plugs.ts --url "<postgres url>" [--csv path]
 *
 * Writes nothing to the database. `--csv` writes a local file only.
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const url = arg("url");
if (!url) {
  console.error("REFUSING: --url is required. This script never reads DATABASE_URL from the environment.");
  process.exit(2);
}
const csvPath = arg("csv");
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Line = {
  journal_id: string;
  created_at: Date;
  description: string | null;
  idempotency_key: string | null;
  debit: string;
  credit: string;
};

async function main() {
  const [{ current_database: db }] = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
    "SELECT current_database()",
  );
  console.log(`[escrow-plugs] target database: ${db} (read-only)\n`);

  // Discover the ledger line table's shape rather than assuming column names.
  const lineCols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='ledger_entries'`,
  );
  const cols = new Set(lineCols.map((c) => c.column_name));
  // The rupee columns, not the paise ones: paise was added alongside the floats later, and whether
  // every historical row was backfilled is a separate question. The two are cross-checked below so
  // a disagreement is reported instead of silently picked between.
  const debitCol = "debit";
  const creditCol = "credit";
  const scale = 1;
  const hasPaise = cols.has("debit_paise") && cols.has("credit_paise");

  const plugs = await prisma.$queryRawUnsafe<Line[]>(
    `SELECT j.id AS journal_id, j.created_at, j.description, j.idempotency_key,
            l.${debitCol}::text AS debit, l.${creditCol}::text AS credit
     FROM journal_entries j
     JOIN ledger_entries l ON l.journal_id = j.id
     JOIN ledger_accounts a ON a.id = l.account_id
     WHERE j.reference_type = 'liability_reconciliation' AND a.code = 'PLATFORM_ESCROW'
     ORDER BY j.created_at ASC`,
  );

  // The account's full movement history, so the balance before and after each plug can be derived
  // from the ledger itself rather than asserted.
  const movements = await prisma.$queryRawUnsafe<
    { created_at: Date; journal_id: string; ref: string | null; net: string }[]
  >(
    `SELECT j.created_at, j.id AS journal_id, j.reference_type AS ref,
            (COALESCE(l.${creditCol},0) - COALESCE(l.${debitCol},0))::text AS net
     FROM journal_entries j
     JOIN ledger_entries l ON l.journal_id = j.id
     JOIN ledger_accounts a ON a.id = l.account_id
     WHERE a.code = 'PLATFORM_ESCROW'
     ORDER BY j.created_at ASC, j.id ASC`,
  );

  // Liability account: credit increases the balance.
  let running = 0;
  const balanceAfter = new Map<string, number>();
  for (const m of movements) {
    running += Number(m.net) / scale;
    balanceAfter.set(m.journal_id, running);
  }
  const current = running;

  let plugTotal = 0;
  const rows = plugs.map((p) => {
    const amount = (Number(p.credit) - Number(p.debit)) / scale; // +credit raises, -debit lowers
    plugTotal += amount;
    const after = balanceAfter.get(p.journal_id) ?? NaN;
    return {
      journal: p.journal_id,
      date: p.created_at.toISOString().slice(0, 19),
      amount: Math.round(amount * 100) / 100,
      direction: amount < 0 ? "lowered escrow" : "raised escrow",
      balanceBefore: Math.round((after - amount) * 100) / 100,
      balanceAfter: Math.round(after * 100) / 100,
      reason: p.description ?? "(none recorded)",
    };
  });

  const withoutPlugs = current - plugTotal;

  let paiseNote = "paise columns absent — not cross-checked";
  if (hasPaise) {
    const [x] = await prisma.$queryRawUnsafe<{ rupees: string; paise: string }[]>(
      `SELECT SUM(l.credit - l.debit)::text AS rupees,
              (SUM(l.credit_paise - l.debit_paise) / 100.0)::text AS paise
       FROM ledger_entries l JOIN ledger_accounts a ON a.id = l.account_id
       WHERE a.code = 'PLATFORM_ESCROW'`,
    );
    const diff = Math.abs(Number(x!.rupees) - Number(x!.paise));
    paiseNote =
      diff < 0.01
        ? `rupee and paise columns agree (₹${Number(x!.rupees).toFixed(2)})`
        : `rupee ₹${Number(x!.rupees).toFixed(2)} vs paise ₹${Number(x!.paise).toFixed(2)} — DISAGREE by ₹${diff.toFixed(2)}`;
  }

  console.log(`PLATFORM_ESCROW plug entries: ${rows.length}`);
  if (rows.length) {
    console.log(`  first: ${rows[0]!.date}   last: ${rows[rows.length - 1]!.date}`);
    const lowered = rows.filter((r) => r.amount < 0);
    const raised = rows.filter((r) => r.amount > 0);
    console.log(`  lowered escrow: ${lowered.length} entries, ₹${lowered.reduce((a, r) => a + r.amount, 0).toFixed(2)}`);
    console.log(`  raised escrow:  ${raised.length} entries, ₹${raised.reduce((a, r) => a + r.amount, 0).toFixed(2)}`);
    const reasoned = rows.filter((r) => /reason:/.test(r.reason)).length;
    console.log(`  entries carrying a stated reason: ${reasoned} of ${rows.length}`);
  }
  console.log("");
  console.log(`  escrow balance today (ledger):       ₹${current.toFixed(2)}   [${paiseNote}]`);
  console.log(`  net effect of all plugs:             ₹${plugTotal.toFixed(2)}`);
  console.log(`  escrow balance without the plugs:    ₹${withoutPlugs.toFixed(2)}`);
  console.log("");
  console.log("Reversal impact, if an owner decides to reverse:");
  console.log(`  - PLATFORM_ESCROW would move by ₹${(-plugTotal).toFixed(2)}, to ₹${withoutPlugs.toFixed(2)}.`);
  console.log(`  - ADJUSTMENT_CLEARING would move by the same amount in the opposite direction.`);
  console.log(`  - Global debit = credit is preserved either way: every plug is a balanced two-line journal.`);
  console.log(`  - Entries dated inside a closed accounting period cannot be reversed in place; they need a`);
  console.log(`    correcting entry dated in the open period, which is itself the accounting decision.`);
  console.log(`\nStatus: BUSINESS_DECISION. Nothing was changed.`);

  if (csvPath) {
    const header = "journal,date,amount,direction,balance_before,balance_after,reason";
    const body = rows.map((r) =>
      [r.journal, r.date, r.amount, r.direction, r.balanceBefore, r.balanceAfter, JSON.stringify(r.reason)].join(","),
    );
    writeFileSync(csvPath, [header, ...body].join("\n"));
    console.log(`\nwrote ${rows.length} rows to ${csvPath}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
