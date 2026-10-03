/**
 * SECTION 7E — the money-path half of the split-brain question, as a separate process.
 *
 *   DATABASE_URL=... bun run scripts/chaos/7e-ledger-racer.ts --run <id> --key <idempotencyKey> --barrier <epochMs>
 *
 * Three money-adjacent maintenance jobs are NON-exclusive, and the design justifies that by calling
 * them idempotent. Sections F and H measured that non-exclusive jobs really can run on two nodes at
 * once, so the justification is load-bearing: if it does not hold, those jobs double-post.
 *
 * The write these jobs actually perform is a journal entry through `financialLedgerService`, which
 * checks `findUnique(idempotencyKey)` and then creates. That is check-then-act, and the only thing
 * standing between it and a duplicate is the UNIQUE constraint on `journal_entries.idempotency_key`.
 * This process is one of two racers that arrive at the same key at the same instant to find out
 * whether that constraint is really what holds, rather than reading the code and assuming.
 *
 * The barrier matters: started sequentially, the first writer finishes before the second looks, the
 * lookup succeeds, and the race never happens.
 */
import { assertChaosTargetIsolated } from "../../src/lib/chaos-isolation";

assertChaosTargetIsolated("7E ledger race");

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string): string => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--")) return argv[i + 1]!;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
};

const RUN = arg("run");
const KEY = arg("key");
const BARRIER = Number(arg("barrier"));
const AMOUNT = Number(arg("amount", "125.5"));

const prisma = (await import("../../src/lib/prisma")).default;
const { financialLedgerService } = await import("../../src/services/financial-ledger.service");

/** Two real accounts from this database, so the entry is a legitimate balanced double entry. */
const accounts = await prisma.ledgerAccount.findMany({ select: { code: true }, orderBy: { code: "asc" }, take: 2 });
if (accounts.length < 2) {
  console.error("[racer] FATAL: fewer than two ledger accounts exist — cannot post a balanced entry");
  process.exit(3);
}

const marker = async (payload: Record<string, unknown>) => {
  await prisma.scheduledJob.create({
    data: {
      jobType: `7e-${RUN}`,
      runAt: new Date(),
      status: "completed",
      completedAt: new Date(),
      payload: { run: RUN, pid: process.pid, at: Date.now(), ...payload },
    },
  });
};

// Spin to the barrier. Both processes then issue their first query within a few milliseconds.
while (Date.now() < BARRIER) await new Promise((r) => setTimeout(r, 2));

let outcome: string;
let entryId: string | null = null;
try {
  const journal = await financialLedgerService.recordJournal({
    type: "ADJUSTMENT",
    referenceId: `7e-${RUN}`,
    referenceType: "chaos_7e",
    description: `7E concurrency probe ${RUN}`,
    idempotencyKey: KEY,
    lines: [
      { accountCode: accounts[0]!.code, debit: AMOUNT, credit: 0 },
      { accountCode: accounts[1]!.code, debit: 0, credit: AMOUNT },
    ],
  });
  entryId = journal.id;
  outcome = "wrote_or_reused";
} catch (err) {
  const code = (err as { code?: string } | null)?.code;
  // P2002 is the unique constraint doing the job the check-then-act cannot: the loser of the race
  // is rejected by the database rather than posting a second entry.
  outcome = code === "P2002" ? "rejected_unique" : `error:${code ?? (err instanceof Error ? err.message : String(err))}`;
}

await marker({ phase: "raced", outcome, entryId });
console.log(`[racer] pid=${process.pid} outcome=${outcome} entryId=${entryId}`);
await prisma.$disconnect();
process.exit(0);
