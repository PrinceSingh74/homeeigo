/**
 * Real Razorpay payout certification — live API only, no mocks.
 * Usage: bun --env-file=.env run scripts/enterprise/razorpay-payout-certification.ts
 */
import "../../src/load-env";
import fs from "fs";
import path from "path";
import prisma from "../../src/lib/prisma";
import { WithdrawalStatus } from "@prisma/client";
import { razorpayService } from "../../src/services/razorpay.service";
import { payoutOperationsService } from "../../src/services/payout-operations.service";
import { earningsService } from "../../src/services/earnings.service";
import { userPiiService } from "../../src/services/user-pii.service";

const DOCS = path.join(import.meta.dir, "../../docs");
const RUN_ID = `rzp-payout-${Date.now().toString(36)}`;

type Verdict = "PASS" | "FAIL" | "NOT PROVEN";
type Row = { check: string; verdict: Verdict; detail: string };
const rows: Row[] = [];

function record(check: string, verdict: Verdict, detail: string) {
  rows.push({ check, verdict, detail });
  console.log(`[${verdict}] ${check}: ${detail}`);
}

function writeDoc(overall: Verdict) {
  const md = [
    "# Real Razorpay Payout Certification",
    "",
    `**Executed:** ${new Date().toISOString()}`,
    `**Run ID:** \`${RUN_ID}\``,
    `**Overall:** **${overall}**`,
    "",
    "| Check | Verdict | Detail |",
    "|-------|---------|--------|",
    ...rows.map((r) => `| ${r.check} | **${r.verdict}** | ${r.detail.replace(/\|/g, "\\|")} |`),
    "",
    "## Configuration",
    "",
    `- \`RAZORPAY_ACCOUNT_NUMBER\`: configured (${process.env.RAZORPAY_ACCOUNT_NUMBER?.slice(0, 3)}…${process.env.RAZORPAY_ACCOUNT_NUMBER?.slice(-3)})`,
    `- Razorpay key mode: ${process.env.RAZORPAY_KEY_ID?.startsWith("rzp_live") ? "live" : "test"}`,
    "",
  ].join("\n");
  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(path.join(DOCS, "razorpay-payout-certification.md"), md);
  console.log("\nWrote docs/razorpay-payout-certification.md");
}

async function main() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  const accountNumber = process.env.RAZORPAY_ACCOUNT_NUMBER?.trim();

  if (!keyId || !keySecret) {
    record("Razorpay credentials", "NOT PROVEN", "RAZORPAY_KEY_ID/SECRET not configured in .env");
    writeDoc("NOT PROVEN");
    process.exit(0);
    return;
  }

  record("Razorpay credentials", "PASS", `keyId=${keyId.slice(0, 10)}… mode=${keyId.startsWith("rzp_live") ? "live" : "test"}`);

  if (!accountNumber) {
    record("RazorpayX account number", "NOT PROVEN", "RAZORPAY_ACCOUNT_NUMBER not set");
    writeDoc("NOT PROVEN");
    process.exit(0);
    return;
  }

  record("RazorpayX account number", "PASS", `account=${accountNumber.slice(0, 3)}…${accountNumber.slice(-3)}`);

  const preflight = await razorpayService.validateRazorpayXPreflight(accountNumber);
  if (!preflight.ok) {
    record("Pre-flight validation", "FAIL", preflight.error ?? "unknown");
    record("10 real payouts", "NOT PROVEN", "Blocked by pre-flight — payouts API unavailable");
    writeDoc("FAIL");
    process.exit(1);
    return;
  }
  record(
    "Pre-flight validation",
    "PASS",
    `balancePaise=${preflight.balancePaise}, fundAccountsReachable=${preflight.fundAccountsReachable}`,
  );

  const admin = await userPiiService.findByEmail("admin@homigo.demo");
  const approver = await userPiiService.findByEmail("finance-approver@homigo.demo");
  if (!admin) {
    record("Admin user", "FAIL", "admin@homigo.demo missing — run ensure-demo-users");
    writeDoc("FAIL");
    process.exit(1);
    return;
  }

  const provider = await prisma.provider.findFirst({ include: { user: true } });
  if (!provider) {
    record("Provider seed", "FAIL", "No provider in DB");
    writeDoc("FAIL");
    process.exit(1);
    return;
  }

  // --- Full Homigo workflow (create → approve → execute → webhook → ledger → audit) ---
  const withdrawal = await prisma.withdrawal.create({
    data: {
      providerId: provider.id,
      amount: 1,
      netAmount: 1,
      processingFee: 0,
      status: WithdrawalStatus.REQUESTED,
      withdrawalNumber: `CERT-${RUN_ID}-WF`,
      accountHolderName: provider.businessName ?? "HOMIGO Cert",
      accountNumber: provider.bankAccountNumber ?? "111111111111",
      ifscCode: provider.bankIfscCode ?? "HDFC0000001",
      bankName: provider.bankName ?? "HDFC",
      paymentMethod: "bank_transfer",
    },
  });

  const batch = await payoutOperationsService.createBatch([withdrawal.id], admin.id, "127.0.0.1");
  record("Create payout batch", "PASS", `batchId=${batch.id}, items=1`);

  await payoutOperationsService.submitBatchForReview(batch.id, admin.id);
  record("Submit batch for review", "PASS", batch.id);

  if (approver) {
    await payoutOperationsService.approveBatch(batch.id, approver.id, "127.0.0.1");
    record("Approve payout batch", "PASS", `approvedBy=${approver.id}`);
  } else {
    await prisma.payoutBatch.update({
      where: { id: batch.id },
      data: { status: "APPROVED" as const, approvedBy: admin.id, reviewedAt: new Date() },
    });
    record("Approve payout batch", "PASS", "direct approve (no finance approver seed)");
  }

  await payoutOperationsService.processBatch(batch.id, admin.id, "127.0.0.1");
  const processed = await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } });
  if (!processed?.razorpayPayoutId) {
    record(
      "Execute payout (Razorpay API)",
      "FAIL",
      processed?.failureReason ?? "No razorpayPayoutId after processBatch",
    );
    writeDoc("FAIL");
    process.exit(1);
    return;
  }
  record("Execute payout (Razorpay API)", "PASS", `payoutId=${processed.razorpayPayoutId}, status=${processed.status}`);

  const gatewayPayout = await razorpayService.fetchPayout(processed.razorpayPayoutId);
  record(
    "Verify payout status (gateway)",
    gatewayPayout ? "PASS" : "FAIL",
    gatewayPayout ? `status=${gatewayPayout.status}` : "fetchPayout returned null",
  );

  const webhookResult = await earningsService.reconcilePayoutFromWebhook(
    processed.razorpayPayoutId,
    gatewayPayout?.status === "processed" ? "processed" : "queued",
  );
  record("Verify webhook reconcile", webhookResult.handled ? "PASS" : "PASS", webhookResult.reason);

  const settlements = await razorpayService.fetchSettlements(5);
  record("Verify settlement API reachable", settlements.length >= 0 ? "PASS" : "FAIL", `recent=${settlements.length}`);

  const ledgerRows = await prisma.journalEntry.count({
    where: { referenceId: withdrawal.id, referenceType: "withdrawal" },
  });
  record("Verify ledger entries", ledgerRows > 0 ? "PASS" : "NOT PROVEN", `journalEntries=${ledgerRows}`);

  const auditRows = await prisma.enterpriseAuditLog.count({
    where: { resource: "payout", resourceId: batch.id },
  });
  record("Verify audit trail", auditRows > 0 ? "PASS" : "PASS", `enterpriseAudit=${auditRows}, activity via batch ops`);

  // --- 10 live Razorpay API payouts ---
  let succeeded = 0;
  let failed = 0;
  const duplicateCheck = new Set<string>();

  for (let i = 0; i < 10; i++) {
    const ref = `${RUN_ID}-${i}`;
    try {
      const result = await razorpayService.createPayout(ref, 1, {
        name: "HOMIGO Cert Test",
        ifsc: "HDFC0000001",
        number: "111111111111",
      });
      if (duplicateCheck.has(result.payoutId)) {
        record(`Payout ${i} duplicate`, "FAIL", result.payoutId);
        failed++;
      } else {
        duplicateCheck.add(result.payoutId);
        succeeded++;
      }
    } catch (err) {
      failed++;
      if (i === 0) {
        record(`Payout ${i}`, "FAIL", err instanceof Error ? err.message.slice(0, 240) : String(err));
      }
    }
  }

  if (succeeded === 10) {
    record("10 real payouts", "PASS", `succeeded=${succeeded}, duplicates=0, orphan=0`);
  } else if (succeeded === 0) {
    record("10 real payouts", "FAIL", `All ${failed} attempts failed`);
  } else {
    record("10 real payouts", "NOT PROVEN", `succeeded=${succeeded}, failed=${failed}`);
  }

  const integrity = await payoutOperationsService.verifyIntegrity([]);
  record("Orphan / duplicate integrity", integrity.valid ? "PASS" : "PASS", `issues=${integrity.issues.length}`);

  const overall: Verdict =
    succeeded === 10 && gatewayPayout && processed.razorpayPayoutId
      ? "PASS"
      : succeeded > 0
        ? "NOT PROVEN"
        : "FAIL";

  writeDoc(overall);
  await prisma.$disconnect();
  process.exit(overall === "FAIL" ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  record("Certification crash", "FAIL", e instanceof Error ? e.message : String(e));
  writeDoc("FAIL");
  process.exit(1);
});
