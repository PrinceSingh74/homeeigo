import "../src/load-env";
import prisma from "../src/lib/prisma";
import { certifyAutomation, getCertification } from "../src/automation/registry/certification";

const ADMIN_ID = "cmq9h67pk0000tz8s6tvnpet5";
const REASON =
  "I approve follow_up, rebooking, and satisfaction_intelligence for feature-gated SHADOW " +
  "execution using verified HOMEEIGO customer and booking data. The capabilities must remain " +
  "customer-isolated, must not auto-create bookings, must not perform financial mutations, must " +
  "not bypass existing notification governance, and must remain SHADOW-only until separately " +
  "certified and explicitly approved for LIVE execution.";
const REFERENCE = "HOMEEIGO Phase 7 Step 7B/7C Human Certification, 2026-08-24";

async function main() {
  console.log("=== STEP 7B/7C CERTIFICATION (hardened path) ===\n");

  const admin = await prisma.user.findUnique({
    where: { id: ADMIN_ID },
    select: { id: true, role: true, isActive: true, isBanned: true },
  });
  if (!admin || admin.role !== "ADMIN" || !admin.isActive || admin.isBanned) {
    throw new Error("REFUSING: admin does not resolve to an active, unbanned ADMIN");
  }
  console.log("Admin verified:", JSON.stringify(admin));

  const targets: Array<{ automationId: string; riskClass: "LOW" | "MEDIUM" | "HIGH"; knownLimitations: string }> = [
    {
      automationId: "rebooking",
      riskClass: "LOW",
      knownLimitations:
        "SHADOW-only. Thin wrapper over the certified rules.v3 recommendation engine — no " +
        "duplicate scoring logic. Suggestions only; no booking-write path exists in the module. " +
        "Real observation: genuine pre-existing customer cmqbzopsk004jtzs8k3e08ihx (32 repeat " +
        "Plumbing Repair bookings), 2026-08-24T08:54:38Z, HTTP 200, candidateCount 34, zero side " +
        "effects measured before/after (bookings/payments/wallet/ratings/notifications counts " +
        "unchanged).",
    },
    {
      automationId: "satisfaction_intelligence",
      riskClass: "LOW",
      knownLimitations:
        "SHADOW-only. Real data only: rating.stars, repeat completed-booking count, real " +
        "SupportTicket rows. No sentiment model, no fabricated emotion. Real observation: booking " +
        "cmse8tbwi00dvtz3wckgbwdmn (real 5-star rating, 8 completed bookings for that service, " +
        "0 support tickets), 2026-08-24T08:54:38Z, HTTP 200, zero side effects measured " +
        "before/after.",
    },
  ];

  for (const t of targets) {
    console.log(`\n--- ${t.automationId} v1 ---`);

    const existing = await getCertification(t.automationId, 1);
    if (existing && !existing.voidedAt) {
      console.log("Already certified and not voided — skipping (no duplicate certification):", existing.id);
      continue;
    }

    const result = await certifyAutomation({
      automationId: t.automationId,
      workflowVersion: 1,
      certifiedBy: "HOMEEIGO Team",
      approvedBy: { adminId: ADMIN_ID, reason: REASON },
      riskClass: t.riskClass,
      approvedExecutionMode: "SHADOW",
      approvalReference: REFERENCE,
      knownLimitations: t.knownLimitations,
    });
    console.log("certifyAutomation result:", JSON.stringify(result));

    // Fresh read-back from DB — never trust the in-memory result of the write.
    const readBack = await prisma.automationCertification.findUnique({
      where: { automationId_workflowVersion: { automationId: t.automationId, workflowVersion: 1 } },
    });
    if (!readBack) throw new Error(`INTEGRITY FAILURE: ${t.automationId} not found after certification`);

    console.log("DB read-back:");
    console.log("  id:", readBack.id);
    console.log("  approvedExecutionMode:", readBack.approvedExecutionMode);
    console.log("  approvedByAdminId:", readBack.approvedByAdminId);
    console.log("  approvalReference:", readBack.approvalReference);
    console.log("  riskClass:", readBack.riskClass);
    console.log("  voidedAt:", readBack.voidedAt);
    console.log("  certifiedAt:", readBack.certifiedAt.toISOString());

    if (readBack.approvedExecutionMode !== "SHADOW") throw new Error(`INTEGRITY FAILURE: ${t.automationId} not SHADOW`);
    if (readBack.voidedAt) throw new Error(`INTEGRITY FAILURE: ${t.automationId} unexpectedly voided`);
    if (readBack.approvedByAdminId !== ADMIN_ID) throw new Error(`INTEGRITY FAILURE: ${t.automationId} wrong admin`);
  }

  console.log("\n=== CERTIFICATION COMPLETE FOR 7B/7C — LIVE BLOCKED (SHADOW only) ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
