/**
 * Reverse ONE specific erroneous journal with a mirror-image ADJUSTMENT — the accounting-correct
 * fix for a duplicate or orphan journal that `diagnose-wallet-liability.ts` has attributed.
 *
 * Why this exists instead of `reconcile-ledger.ts --post`: the reconcile tool plugs the NET delta
 * of an account against ADJUSTMENT_CLEARING. That hides which journal was wrong and leaves the
 * counter-account the erroneous journal hit (e.g. an invented BANK_SETTLEMENT debit) uncorrected.
 * A reversing entry undoes exactly the lines of the identified journal, on every account it
 * touched, and names it. Ledger history is never updated or deleted.
 *
 *   bun --env-file=.env run scripts/reverse-journal.ts --journal <journalId|entryNumber> \
 *       --reason "<why this journal is wrong, >= 20 chars>"            # DRY RUN, prints lines
 *   ... --post                                                          # writes the reversal
 *
 * Idempotent: the reversal carries idempotencyKey `reversal:<journalId>`; a second --post is a no-op.
 * Exit codes: 0 = done / dry-run ok, 1 = refused, 2 = bad usage.
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { financialLedgerService } from "../src/services/financial-ledger.service";
import { MIN_ADJUSTMENT_REASON_LENGTH } from "../src/services/ledger-reconciliation.service";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const ref = arg("journal")?.trim();
  const reason = arg("reason")?.trim() ?? "";
  const post = process.argv.includes("--post");
  if (!ref) {
    console.error("usage: --journal <journalId|entryNumber> --reason <text> [--post]");
    process.exit(2);
  }
  if (reason.length < MIN_ADJUSTMENT_REASON_LENGTH) {
    console.error(`REFUSING: --reason must be at least ${MIN_ADJUSTMENT_REASON_LENGTH} characters.`);
    process.exit(2);
  }

  const journal = await prisma.journalEntry.findFirst({
    where: { OR: [{ id: ref }, { entryNumber: ref }] },
    include: { lines: { include: { account: true } } },
  });
  if (!journal) {
    console.error(`REFUSING: journal ${ref} not found`);
    process.exit(1);
  }
  if (journal.type === "ADJUSTMENT" && journal.idempotencyKey?.startsWith("reversal:")) {
    console.error(`REFUSING: ${journal.entryNumber} is itself a reversal`);
    process.exit(1);
  }
  const key = `reversal:${journal.id}`;
  const already = await prisma.journalEntry.findUnique({ where: { idempotencyKey: key }, select: { entryNumber: true } });
  if (already) {
    console.log(`already reversed by ${already.entryNumber}; nothing to do`);
    process.exit(0);
  }

  const lines = journal.lines.map((l) => ({ accountCode: l.account.code, debit: l.credit, credit: l.debit }));
  const dbName = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0];
  console.log(`[reverse-journal] target db=${dbName} mode=${post ? "POST" : "DRY RUN"}`);
  console.log(`[reverse-journal] reversing ${journal.entryNumber} (${journal.type}, key=${journal.idempotencyKey}, created ${journal.createdAt.toISOString()})`);
  for (const l of lines) console.log(`  ${l.accountCode.padEnd(28)} DR ${l.debit.toFixed(2).padStart(10)}  CR ${l.credit.toFixed(2).padStart(10)}`);
  if (!post) {
    console.log("[reverse-journal] dry run — nothing written. Add --post to write the reversal.");
    process.exit(0);
  }

  const posted = await financialLedgerService.recordJournal({
    type: "ADJUSTMENT",
    referenceId: journal.id,
    referenceType: "journal_reversal",
    idempotencyKey: key,
    description: `Reversal of ${journal.entryNumber} (${journal.idempotencyKey}) — reason: ${reason}`,
    lines,
  });
  console.log(`[reverse-journal] posted ${posted.entryNumber} (${posted.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
