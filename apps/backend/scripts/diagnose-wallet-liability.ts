/**
 * Wallet / liability drift DIAGNOSIS — read-only.
 *
 * The platform already had two tools for liability drift and neither answers the question that
 * matters. `financial-integrity.service` says a mismatch exists. `ledger-reconciliation.service`
 * makes it go away by posting an ADJUSTMENT. Nothing says WHY the two sides disagree, so every
 * incident ended in a plug entry and the cause survived to produce the next one.
 *
 * The cost of that is on record: 56 `liability_reconciliation` entries posted −₹17,245 against
 * PLATFORM_ESCROW chasing a target that was never an invariant, and 35 more against
 * CUSTOMER_WALLET.
 *
 * This script attributes the gap instead of closing it. It writes nothing, ever — no adjustment,
 * no backfill, no balance update. Run it BEFORE deciding whether a correcting entry is justified.
 *
 *   bun --env-file=.env run scripts/diagnose-wallet-liability.ts
 *   bun run scripts/diagnose-wallet-liability.ts --url postgresql://...   # explicit target
 *
 * Exit codes: 0 = every invariant-backed account reconciles; 1 = unexplained drift; 2 = bad usage.
 */
import { PrismaClient } from "@prisma/client";

const argOf = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const explicitUrl = argOf("url");
const prisma = explicitUrl
  ? new PrismaClient({ datasources: { db: { url: explicitUrl } } })
  : new PrismaClient();

/** Rupee tolerance. Matches `financial-integrity.service`'s WALLET_LIABILITY_MISMATCH threshold. */
const TOLERANCE = 1;

/** Imported value, not a local copy — a second constant here is a second source of truth. */
import { COIN_TO_RUPEE } from "../src/services/hcoin.service";

const rs = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Account = {
  code: string;
  label: string;
  /** An invariant-backed account has a one-to-one operational counterpart; drift there is real. */
  invariant: boolean;
  operational: () => Promise<number>;
  /** Why this comparison is or is not an invariant — printed so nobody has to guess. */
  basis: string;
};

async function ledgerBalance(code: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ bal: string | null }[]>(
    `SELECT COALESCE(SUM(le.credit_paise) - SUM(le.debit_paise), 0)::text AS bal
       FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.account_id
      WHERE la.code = $1`,
    code,
  );
  return Number(rows[0]?.bal ?? 0) / 100;
}

async function scalar(sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ v: string | null }[]>(sql);
  return Number(rows[0]?.v ?? 0);
}

const ACCOUNTS: Account[] = [
  {
    code: "CUSTOMER_WALLET",
    label: "Customer Wallet",
    invariant: true,
    basis: "SUM(users.wallet_balance) — one row per customer, no commingling",
    operational: () => scalar(`SELECT COALESCE(SUM(wallet_balance_paise),0)/100.0 AS v FROM users`),
  },
  {
    code: "PROVIDER_PAYABLE",
    label: "Provider Payable",
    invariant: true,
    basis: "SUM(providers.wallet_balance)",
    operational: () => scalar(`SELECT COALESCE(SUM(wallet_balance)::numeric,0) AS v FROM providers`),
  },
  {
    code: "HCOIN_LIABILITY",
    label: "H-Coin Liability",
    invariant: true,
    basis: `floor((issued - redeemed - expired) coins * ${COIN_TO_RUPEE}) — identical to hcoin.service.adminAnalytics()`,
    /**
     * Deliberately the SAME definition the production service uses: outstanding is derived from
     * `hcoin_transactions`, not from `hcoin_wallets.balance`, and coins are converted to rupees.
     *
     * An earlier draft of this script summed `hcoin_wallets.balance` directly and reported a
     * ₹3,670 drift that did not exist — that column is denominated in COINS, and 4,050 coins is
     * ₹405, not ₹4,050. A diagnostic that invents its own version of a balance produces exactly the
     * kind of phantom finding it is supposed to rule out.
     */
    operational: () =>
      scalar(
        `SELECT FLOOR(
                  (COALESCE(SUM(amount) FILTER (WHERE type::text = 'EARN'), 0)
                 - COALESCE(SUM(amount) FILTER (WHERE type::text = 'REDEEM'), 0)
                 - COALESCE(SUM(amount) FILTER (WHERE type::text = 'EXPIRE'), 0)) * ${COIN_TO_RUPEE}
                )::numeric AS v
           FROM hcoin_transactions`,
      ),
  },
  {
    code: "PLATFORM_ESCROW",
    label: "Platform Escrow",
    invariant: false,
    basis:
      "COMMINGLED — holds unreleased booking escrow, gift-card float and wallet-debit escrow. " +
      "Active gift-card balance is one contributor, not the account's counterpart. Reported, never adjusted.",
    operational: () => scalar(`SELECT COALESCE(SUM(balance),0)::numeric AS v FROM gift_cards WHERE status='ACTIVE'`),
  },
];

/** Where an account's ledger position came from, so a delta can be read against real activity. */
async function composition(code: string) {
  return prisma.$queryRawUnsafe<{ type: string; reference_type: string | null; n: bigint; net: string }[]>(
    `SELECT je.type::text AS type, je.reference_type,
            count(*) AS n,
            ((SUM(le.credit_paise) - SUM(le.debit_paise))/100.0)::text AS net
       FROM ledger_entries le
       JOIN ledger_accounts la ON la.id = le.account_id
       JOIN journal_entries je ON je.id = le.journal_id
      WHERE la.code = $1
      GROUP BY 1, 2
      ORDER BY 3 DESC`,
    code,
  );
}

async function main() {
  const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>(`SELECT current_database() AS db`);
  if (process.argv.includes("--signs")) {
    console.log(`[wallet-liability] database=${db} mode=signs`);
    let signDrift = 0;
    for (const acc of ACCOUNTS) {
      const [ops, led] = await Promise.all([acc.operational(), ledgerBalance(acc.code)]);
      const delta = Math.round((led - ops) * 100) / 100;
      const drifting = Math.abs(delta) > TOLERANCE;
      const sign = !drifting ? "MATCH" : delta > 0 ? "LEDGER_ABOVE" : "OPS_ABOVE";
      const rows = await composition(acc.code);
      const entryCount = rows.reduce((s, r) => s + Number(r.n), 0);
      console.log(`${acc.code} ${acc.invariant ? sign : "INFO"} entries=${entryCount} groups=${rows.length}`);
      if (acc.invariant && drifting) signDrift += 1;
    }
    const hcoinCounts = await prisma.$queryRawUnsafe<{ type: string; n: bigint }[]>(
      `SELECT type::text AS type, count(*) AS n FROM hcoin_transactions GROUP BY 1 ORDER BY 1`,
    );
    for (const r of hcoinCounts) console.log(`hcoin_txn ${r.type} count=${r.n}`);
    const orphanWallet = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM journal_entries je
        WHERE je.reference_type = 'wallet_transaction'
          AND NOT EXISTS (SELECT 1 FROM wallet_transactions wt WHERE wt.id = je.reference_id)`,
    );
    const orphanHcoin = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM journal_entries je
        WHERE je.type::text IN ('HCOIN_EARNED','HCOIN_REDEEMED','HCOIN_EXPIRED','HCOIN_ADJUSTED')
          AND NOT EXISTS (SELECT 1 FROM hcoin_transactions t WHERE t.id = je.reference_id)`,
    );
    console.log(`orphan_wallet_journals=${orphanWallet[0]?.n ?? 0}`);
    console.log(`orphan_hcoin_journals=${orphanHcoin[0]?.n ?? 0}`);
    if (signDrift > 0) process.exitCode = 1;
    return;
  }
  console.log(`\n[wallet-liability] READ-ONLY diagnosis on "${db}"\n${"=".repeat(78)}`);

  let unexplained = 0;

  for (const acc of ACCOUNTS) {
    const [ops, led] = await Promise.all([acc.operational(), ledgerBalance(acc.code)]);
    const delta = Math.round((led - ops) * 100) / 100;
    const drifting = Math.abs(delta) > TOLERANCE;
    const tag = acc.invariant ? (drifting ? "DRIFT" : "ok   ") : "info ";

    console.log(
      `\n[${tag}] ${acc.label} (${acc.code})\n` +
        `        operational ${rs(ops)}   ledger ${rs(led)}   delta ${rs(delta)}\n` +
        `        basis: ${acc.basis}`,
    );

    const rows = await composition(acc.code);
    const plugs = rows.filter((r) => r.reference_type === "liability_reconciliation" || r.reference_type === "reconciliation");
    const real = rows.filter((r) => !plugs.includes(r));

    if (rows.length > 0) {
      console.log(`        ledger composition:`);
      for (const r of rows) {
        const isPlug = plugs.includes(r);
        console.log(
          `          ${isPlug ? "PLUG " : "     "} ${r.type.padEnd(24)} ${String(r.n).padStart(4)} entries  ${rs(Number(r.net))}` +
            (isPlug ? "   <- adjusting entry, not business activity" : ""),
        );
      }
      const plugTotal = plugs.reduce((s, r) => s + Number(r.net), 0);
      const realTotal = real.reduce((s, r) => s + Number(r.net), 0);
      if (plugs.length > 0) {
        console.log(
          `        WITHOUT plugs this account would read ${rs(realTotal)} ` +
            `(${plugs.reduce((s, r) => s + Number(r.n), 0)} plug entries moved ${rs(plugTotal)})`,
        );
      }
    }

    if (acc.invariant && drifting) unexplained += 1;
  }

  // ── Attribution for the customer wallet, the account most often plugged ────────────────────────
  console.log(`\n${"=".repeat(78)}\nCUSTOMER_WALLET attribution\n`);

  const unbacked = await prisma.$queryRawUnsafe<
    { id: string; type: string; amount: string; reason: string | null; reference_type: string | null; created: string }[]
  >(
    `SELECT wt.id, wt.type::text AS type, (wt.amount_paise/100.0)::text AS amount,
            wt.reason, wt.reference_type, wt.created_at::date::text AS created
       FROM wallet_transactions wt
      WHERE wt.status::text = 'COMPLETED'
        AND wt.user_id IS NOT NULL
        AND NOT EXISTS (
              SELECT 1 FROM journal_entries je
               WHERE je.reference_id = wt.id
                  OR je.idempotency_key LIKE '%' || wt.id
            )
      ORDER BY wt.created_at`,
  );

  if (unbacked.length === 0) {
    console.log("  Every completed customer wallet transaction has a journal entry.");
  } else {
    console.log(`  ${unbacked.length} completed customer wallet transaction(s) with no directly-linked journal:`);
    for (const r of unbacked) {
      console.log(
        `    ${r.created}  ${r.type.padEnd(7)} ${rs(Number(r.amount)).padStart(14)}  ` +
          `ref=${r.reference_type ?? "-"} reason=${r.reason ?? "-"}  id=${r.id}`,
      );
    }
    console.log(
      `  NOTE: some of these are linked by domain id rather than transaction id (a booking refund\n` +
        `  journals against the booking, an H-Coin redemption against the hcoin_transaction). Check the\n` +
        `  reference before treating one as missing.`,
    );
  }

  // ── Orphan and duplicate journals ─────────────────────────────────────────────────────────────
  //
  // The two failure shapes that produced the residual on 2026-09-21, neither of which any existing
  // check looked for:
  //
  //   ORPHAN    a journal credits CUSTOMER_WALLET referencing a wallet_transaction that does not
  //             exist. One such entry (JE-00001323, +₹1,000, 2026-09-05) credited the ledger for a
  //             top-up no customer balance ever received. Its row was the last transaction number
  //             issued that day, so deleting it left the sequence contiguous and invisible.
  //
  //   DUPLICATE one operational event journaled to the same account twice. Four H-Coin redemptions
  //             (₹176+₹67+₹141+₹168 = ₹552) carried BOTH a `wallet_topup:` journal and an
  //             `HCOIN_REDEEMED` journal. The redemption on 2026-09-19 has only the latter, which
  //             is how the code fix between 09-15 and 09-19 can be seen in the data.
  //
  // Together with a −₹200 tip debit and a ₹10 orphan these come to +₹1,362, against −₹1,394 of
  // plugs that under-represent seeded balances. The two nearly cancel, leaving −₹32. Closing that
  // ₹32 with another adjustment would have concealed ₹2,756 of gross error.
  console.log(`\n${"=".repeat(78)}\nOrphan and duplicate journals\n`);

  const orphanJournals = await prisma.$queryRawUnsafe<
    { entry_number: string; type: string; key: string; net: string; created: string }[]
  >(
    `SELECT je.entry_number, je.type::text AS type, je.idempotency_key AS key,
            ((SUM(le.credit_paise) - SUM(le.debit_paise))/100.0)::text AS net,
            je.created_at::date::text AS created
       FROM ledger_entries le
       JOIN ledger_accounts la ON la.id = le.account_id
       JOIN journal_entries je ON je.id = le.journal_id
      WHERE la.code = 'CUSTOMER_WALLET'
        AND je.reference_type = 'wallet_transaction'
        AND NOT EXISTS (SELECT 1 FROM wallet_transactions wt WHERE wt.id = je.reference_id)
      GROUP BY je.entry_number, je.type, je.idempotency_key, je.created_at
      ORDER BY je.created_at`,
  );

  if (orphanJournals.length === 0) {
    console.log("  No CUSTOMER_WALLET journal references a missing wallet_transaction.");
  } else {
    console.log(`  ORPHAN — ${orphanJournals.length} journal(s) reference a wallet_transaction that does not exist:`);
    for (const j of orphanJournals) {
      console.log(`    ${j.created}  ${j.entry_number}  ${j.type.padEnd(14)} ${rs(Number(j.net)).padStart(14)}  ${j.key}`);
    }
    console.log(
      `    These credit the ledger for movement no customer balance received. They are NOT fixed by\n` +
        `    an adjusting entry — the journal itself is the error.`,
    );
  }

  // A redemption that also produced a top-up journal is the same money booked twice. Matched on
  // account, amount and a 120s window because the two journals key on different domain ids.
  const doubleJournalled = await prisma.$queryRawUnsafe<
    { id: string; amount: string; created: string }[]
  >(
    `SELECT wt.id, (wt.amount_paise/100.0)::text AS amount, wt.created_at::date::text AS created
       FROM wallet_transactions wt
      WHERE wt.reference_type = 'hcoin_redemption'
        AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.idempotency_key = 'wallet_topup:' || wt.id)
        AND EXISTS (
              SELECT 1 FROM journal_entries je2
               JOIN ledger_entries le2 ON le2.journal_id = je2.id
               JOIN ledger_accounts la2 ON la2.id = le2.account_id
               WHERE la2.code = 'CUSTOMER_WALLET'
                 AND je2.type::text = 'HCOIN_REDEEMED'
                 AND abs(EXTRACT(EPOCH FROM (je2.created_at - wt.created_at))) < 120
                 AND le2.credit_paise = wt.amount_paise)
      ORDER BY wt.created_at`,
  );

  if (doubleJournalled.length === 0) {
    console.log("\n  No H-Coin redemption is journaled twice.");
  } else {
    const total = doubleJournalled.reduce((s, r) => s + Number(r.amount), 0);
    console.log(`\n  DUPLICATE — ${doubleJournalled.length} H-Coin redemption(s) journaled twice, ${rs(total)} over-credited:`);
    for (const r of doubleJournalled) console.log(`    ${r.created}  ${rs(Number(r.amount)).padStart(12)}  ${r.id}`);
  }

  // Non-transaction movements: these change the ledger with no wallet_transactions row at all.
  const nonTxn = await prisma.$queryRawUnsafe<{ type: string; n: bigint; net: string }[]>(
    `SELECT je.type::text AS type, count(*) AS n, ((SUM(le.credit_paise)-SUM(le.debit_paise))/100.0)::text AS net
       FROM ledger_entries le
       JOIN ledger_accounts la ON la.id = le.account_id
       JOIN journal_entries je ON je.id = le.journal_id
      WHERE la.code = 'CUSTOMER_WALLET' AND je.reference_type <> 'wallet_transaction'
      GROUP BY 1 ORDER BY 3 DESC`,
  );
  if (nonTxn.length > 0) {
    console.log(`\n  Ledger movements with no wallet_transactions row (expected for these types):`);
    for (const r of nonTxn) {
      console.log(`    ${r.type.padEnd(24)} ${String(r.n).padStart(4)} entries  ${rs(Number(r.net))}`);
    }
  }

  console.log(`\n${"=".repeat(78)}`);
  if (unexplained > 0) {
    console.error(
      `[wallet-liability] ${unexplained} invariant-backed account(s) drifting beyond ${rs(TOLERANCE)}.\n` +
        `Do NOT run \`bun run reconcile:ledger\` to clear this. That posts an ADJUSTMENT and destroys the\n` +
        `evidence of what caused it. Attribute the delta above first; a correcting entry is an accounting\n` +
        `decision that needs a stated reason.`,
    );
    process.exit(1);
  }
  console.log("[wallet-liability] PASS — every invariant-backed account reconciles.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
