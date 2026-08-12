/**
 * HOMIGO Payment Reconciliation War Room — Phases 1-4 forensic audit.
 * READ-ONLY. Evidence-based. No mock data.
 *
 * Run: bun --env-file=.env run scripts/war-room/payment-forensic-audit.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import prisma from "../../src/lib/prisma";
import { financialIntegrityService } from "../../src/services/financial-integrity.service";

const DOCS = join(import.meta.dir, "../../docs/war-room");
const r2 = (n: number) => Math.round(n * 100) / 100;
const ts = () => new Date().toISOString();

mkdirSync(DOCS, { recursive: true });

async function ledgerBalance(code: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ bal: number }[]>(
    `SELECT COALESCE(SUM(le.credit) - SUM(le.debit), 0)::float AS bal
     FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.account_id
     WHERE la.code = $1`,
    code,
  );
  return r2(Number(rows[0]?.bal ?? 0));
}

async function main() {
  console.log(`\n=== HOMIGO Payment Forensic Audit · ${ts()} ===\n`);

  // ── PHASE 1: Payment lifecycle trace ──────────────────────────────────────
  const successPayments = await prisma.$queryRawUnsafe<
    Array<{
      payment_id: string;
      booking_id: string | null;
      amount: number;
      amount_paid: number;
      status: string;
      razorpay_order_id: string | null;
      razorpay_payment_id: string | null;
      settlement_id: string | null;
      completed_at: Date | null;
      has_journal: boolean;
      has_ledger: boolean;
      has_payment_settlement: boolean;
      provider_payable_journal: boolean;
    }>
  >(`
    SELECT
      p.id AS payment_id,
      p.booking_id,
      p.amount::float,
      p.amount_paid::float AS amount_paid,
      p.status,
      p.razorpay_order_id,
      p.razorpay_payment_id,
      p.settlement_id,
      p.completed_at,
      EXISTS(SELECT 1 FROM journal_entries je WHERE je.reference_id = p.id AND je.reference_type = 'payment') AS has_journal,
      EXISTS(
        SELECT 1 FROM ledger_entries le
        JOIN journal_entries je ON je.id = le.journal_id
        WHERE je.reference_id = p.id AND je.reference_type = 'payment'
      ) AS has_ledger,
      EXISTS(SELECT 1 FROM payment_settlements ps WHERE ps.payment_id = p.id) AS has_payment_settlement,
      EXISTS(
        SELECT 1 FROM journal_entries je
        WHERE je.reference_id = p.booking_id AND je.reference_type = 'booking'
          AND je.type IN ('BOOKING_PAYMENT', 'PROVIDER_EARNING')
      ) AS provider_payable_journal
    FROM payments p
    WHERE p.status = 'SUCCESS'
    ORDER BY p.created_at DESC
    LIMIT 500
  `);

  const lifecycleGaps = successPayments.map((p) => {
    const gaps: string[] = [];
    if (!p.razorpay_order_id) gaps.push("MISSING_RAZORPAY_ORDER");
    if (!p.razorpay_payment_id) gaps.push("MISSING_RAZORPAY_PAYMENT");
    if (!p.settlement_id && !p.has_payment_settlement) gaps.push("MISSING_SETTLEMENT");
    if (!p.has_journal) gaps.push("MISSING_JOURNAL");
    if (!p.has_ledger) gaps.push("MISSING_LEDGER");
    if (p.booking_id && !p.provider_payable_journal) gaps.push("MISSING_PROVIDER_PAYABLE_JOURNAL");
    return { ...p, gaps };
  });

  const withGaps = lifecycleGaps.filter((p) => p.gaps.length > 0);

  const phase1 = `# Payment Forensic Report

Generated: ${ts()}

## Scope
SUCCESS payments traced end-to-end (latest 500).

## Summary
| Metric | Count |
|--------|------:|
| SUCCESS payments sampled | ${successPayments.length} |
| Payments with lifecycle gaps | ${withGaps.length} |
| Missing Razorpay order | ${withGaps.filter((p) => p.gaps.includes("MISSING_RAZORPAY_ORDER")).length} |
| Missing Razorpay payment ID | ${withGaps.filter((p) => p.gaps.includes("MISSING_RAZORPAY_PAYMENT")).length} |
| Missing settlement link | ${withGaps.filter((p) => p.gaps.includes("MISSING_SETTLEMENT")).length} |
| Missing journal | ${withGaps.filter((p) => p.gaps.includes("MISSING_JOURNAL")).length} |
| Missing ledger | ${withGaps.filter((p) => p.gaps.includes("MISSING_LEDGER")).length} |
| Missing provider payable journal | ${withGaps.filter((p) => p.gaps.includes("MISSING_PROVIDER_PAYABLE_JOURNAL")).length} |

## SQL Evidence — Unsettled SUCCESS payments (>3 days)
\`\`\`sql
SELECT id, booking_id, amount_paid, razorpay_payment_id, settlement_id, completed_at, created_at
FROM payments
WHERE status = 'SUCCESS' AND settlement_id IS NULL
  AND completed_at < now() - interval '3 days';
\`\`\`

\`\`\`json
${JSON.stringify(
    await prisma.$queryRawUnsafe(
      `SELECT id, booking_id, amount_paid::float, razorpay_payment_id, settlement_id, completed_at, created_at
       FROM payments WHERE status = 'SUCCESS' AND settlement_id IS NULL
         AND completed_at < now() - interval '3 days' LIMIT 50`,
    ),
    null,
    2,
  )}
\`\`\`

## SQL Evidence — SUCCESS with null completed_at (invisible to settlement check)
\`\`\`sql
SELECT count(*) FROM payments WHERE status = 'SUCCESS' AND settlement_id IS NULL AND completed_at IS NULL;
\`\`\`
Result: **${(await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int n FROM payments WHERE status = 'SUCCESS' AND settlement_id IS NULL AND completed_at IS NULL`))[0].n}**

## Sample gap records (first 25)
| Payment ID | Booking | Amount | Gaps |
|------------|---------|-------:|------|
${withGaps
    .slice(0, 25)
    .map((p) => `| ${p.payment_id.slice(0, 8)}… | ${p.booking_id?.slice(0, 8) ?? "—"}… | ₹${p.amount_paid} | ${p.gaps.join(", ")} |`)
    .join("\n")}
`;

  // ── PHASE 2: SETTLEMENT_MISMATCH root cause ─────────────────────────────
  const unsettledOld = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      booking_id: string | null;
      amount_paid: number;
      razorpay_payment_id: string | null;
      settlement_id: string | null;
      completed_at: Date | null;
      created_at: Date;
      has_ps: boolean;
      days_since_success: number;
    }>
  >(`
    SELECT p.id, p.booking_id, p.amount_paid::float, p.razorpay_payment_id, p.settlement_id,
           p.completed_at, p.created_at,
           EXISTS(SELECT 1 FROM payment_settlements ps WHERE ps.payment_id = p.id) AS has_ps,
           EXTRACT(day FROM now() - COALESCE(p.completed_at, p.created_at))::int AS days_since_success
    FROM payments p
    WHERE p.status = 'SUCCESS' AND p.settlement_id IS NULL
    ORDER BY p.created_at ASC
    LIMIT 100
  `);

  const settlementMismatchIssues = await prisma.reconciliationIssue.findMany({
    where: { issueType: "SETTLEMENT_MISMATCH" },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { reconciliation: { select: { runDate: true, matchPct: true } } },
  });

  const phase2 = `# Settlement Mismatch Root Cause

Generated: ${ts()}

## Root Cause Summary

The reconciliation engine flags **SETTLEMENT_MISMATCH** when:
\`SUCCESS payments with settlement_id IS NULL AND completed_at < now() - 3 days\`

### Critical engine bugs identified:
1. **Aggregate issue inflation** — one issue row per daily run ("N payments unsettled") instead of per-payment dedup → inflates local issue count to 100+
2. **completed_at NULL blind spot** — payments with NULL completed_at are excluded from the >3d check but still unsettled
3. **settlement_id not backfilled** — PaymentSettlement rows may exist while payment.settlement_id remains NULL
4. **Settlement sync not scheduled in dev** — without RAZORPAY_KEY_ID or webhooks, settlements never link

## Unsettled SUCCESS payments (evidence)
Total unsettled (settlement_id IS NULL): **${await prisma.payment.count({ where: { status: "SUCCESS", settlementId: null } })}**

| Payment ID | Booking | Amount | RZP Payment | Has PaymentSettlement | Days | Root Cause |
|------------|---------|-------:|-------------|----------------------:|-----:|------------|
${unsettledOld
    .slice(0, 30)
    .map((p) => {
      let cause = "MISSING_SETTLEMENT";
      if (p.has_ps && !p.settlement_id) cause = "MAPPING_FAILURE (PaymentSettlement exists, payment.settlement_id NULL)";
      else if (!p.razorpay_payment_id) cause = "MISSING_GATEWAY_ID";
      else if (p.days_since_success < 3) cause = "DELAYED_SETTLEMENT (<3d window)";
      else if (p.completed_at === null) cause = "NULL_COMPLETED_AT";
      return `| ${p.id.slice(0, 8)}… | ${p.booking_id?.slice(0, 8) ?? "—"}… | ₹${p.amount_paid} | ${p.razorpay_payment_id?.slice(0, 12) ?? "—"} | ${p.has_ps} | ${p.days_since_success} | ${cause} |`;
    })
    .join("\n")}

## Reconciliation issue records (SETTLEMENT_MISMATCH)
${settlementMismatchIssues.map((i) => `- ${i.createdAt.toISOString()}: ${i.details} (run match ${i.reconciliation.matchPct}%)`).join("\n")}
`;

  // ── PHASE 3: Local issues classification ──────────────────────────────
  const localIssues = await prisma.reconciliationIssue.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const classify = (type: string, details: string | null): string => {
    const d = (details ?? "").toLowerCase();
    if (type === "MISMATCH" && d.includes("amountpaid")) return "AMOUNT_MISMATCH";
    if (type === "MISSING_GATEWAY") return "MISSING_PAYMENT";
    if (type === "REFUND_MISMATCH") return "REFUND_MISMATCH";
    if (type === "SETTLEMENT_MISMATCH") return "SETTLEMENT_PENDING";
    if (type === "MISSING_LOCAL") return "MISSING_LEDGER";
    return type;
  };

  const classified = localIssues.reduce(
    (acc, i) => {
      const c = classify(i.issueType, i.details);
      acc[c] = (acc[c] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const phase3 = `# Local Finance Anomalies

Generated: ${ts()}

## Issue classification (latest 200 reconciliation issues)
${Object.entries(classified)
    .map(([k, v]) => `- **${k}**: ${v}`)
    .join("\n")}

Total reconciliation issues in DB: **${await prisma.reconciliationIssue.count()}**

## SQL — amount mismatches
\`\`\`sql
SELECT id, amount, amount_paid, status, razorpay_payment_id FROM payments
WHERE status = 'SUCCESS' AND amount_paid != amount;
\`\`\`
\`\`\`json
${JSON.stringify(await prisma.$queryRawUnsafe(`SELECT id, amount::float, amount_paid::float, status FROM payments WHERE status = 'SUCCESS' AND amount_paid != amount LIMIT 20`), null, 2)}
\`\`\`

## SQL — SUCCESS without journal
\`\`\`sql
SELECT p.id FROM payments p
WHERE p.status = 'SUCCESS'
  AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.reference_id = p.id AND je.reference_type = 'payment');
\`\`\`
Count: **${(await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int n FROM payments p WHERE p.status = 'SUCCESS' AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.reference_id = p.id AND je.reference_type = 'payment')`))[0].n}**
`;

  // ── PHASE 4: Gateway issues ─────────────────────────────────────────────
  const gwIssues = await prisma.gatewayReconciliationIssue.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const gwByType = gwIssues.reduce(
    (acc, i) => {
      acc[i.issueType] = (acc[i.issueType] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const phase4 = `# Gateway Integrity Report

Generated: ${ts()}

## Gateway reconciliation issues (latest 100)
${Object.entries(gwByType)
    .map(([k, v]) => `- **${k}**: ${v}`)
    .join("\n")}

Total gateway issues in DB: **${await prisma.gatewayReconciliationIssue.count()}**

## Settlement batches
Local batches: **${await prisma.settlementBatch.count()}**
Payment-settlement links: **${await prisma.paymentSettlement.count()}**

## SQL — payments with PaymentSettlement but NULL settlement_id
\`\`\`sql
SELECT p.id, p.settlement_id, ps.settlement_id AS ps_settlement
FROM payments p JOIN payment_settlements ps ON ps.payment_id = p.id
WHERE p.settlement_id IS NULL;
\`\`\`
Count: **${(await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int n FROM payments p JOIN payment_settlements ps ON ps.payment_id = p.id WHERE p.settlement_id IS NULL`))[0].n}**
`;

  writeFileSync(join(DOCS, "payment-forensic-report.md"), phase1);
  writeFileSync(join(DOCS, "settlement-mismatch-rootcause.md"), phase2);
  writeFileSync(join(DOCS, "local-finance-anomalies.md"), phase3);
  writeFileSync(join(DOCS, "gateway-integrity-report.md"), phase4);

  // Integrity snapshot
  const fi = await financialIntegrityService.validate();
  const walletOps = r2(Number((await prisma.user.aggregate({ _sum: { walletBalance: true } }))._sum.walletBalance ?? 0));
  const walletLedger = Math.abs(await ledgerBalance("CUSTOMER_WALLET"));
  const provOps = r2(Number((await prisma.provider.aggregate({ _sum: { walletBalance: true } }))._sum.walletBalance ?? 0));
  const provLedger = Math.abs(await ledgerBalance("PROVIDER_PAYABLE"));

  const reconRuns = await prisma.paymentReconciliation.findMany({ orderBy: { runDate: "desc" }, take: 10 });
  const avgMatch = r2(
    Number((await prisma.paymentReconciliation.aggregate({ _avg: { matchPct: true } }))._avg.matchPct ?? 0),
  );

  console.log("Phase 1-4 reports written to apps/backend/docs/war-room/");
  console.log(`SUCCESS payments: ${successPayments.length}, with gaps: ${withGaps.length}`);
  console.log(`Unsettled SUCCESS: ${await prisma.payment.count({ where: { status: "SUCCESS", settlementId: null } })}`);
  console.log(`Local issues: ${await prisma.reconciliationIssue.count()}, Gateway issues: ${await prisma.gatewayReconciliationIssue.count()}`);
  console.log(`Avg match %: ${avgMatch}, Integrity: ${fi.status} score=${fi.score}`);
  console.log(`Wallet drift: ops ₹${walletOps} vs ledger ₹${walletLedger}`);
  console.log(`Provider drift: ops ₹${provOps} vs ledger ₹${provLedger}`);

  return {
    successPayments: successPayments.length,
    withGaps: withGaps.length,
    unsettled: await prisma.payment.count({ where: { status: "SUCCESS", settlementId: null } }),
    localIssues: await prisma.reconciliationIssue.count(),
    gatewayIssues: await prisma.gatewayReconciliationIssue.count(),
    avgMatch,
    integrity: fi,
    reconRuns,
  };
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("AUDIT FAILED:", e);
    process.exit(1);
  });
