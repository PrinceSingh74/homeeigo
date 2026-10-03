import "../src/load-env";
import prisma from "../src/lib/prisma";
import { certifyAutomation, getCertification } from "../src/automation/registry/certification";

const ADMIN_ID = "cmq9h67pk0000tz8s6tvnpet5";
const AUTOMATION_ID = "vision_intelligence";
const REASON =
  "I approve HOMEEIGO Vision Intelligence for SHADOW execution based on verified Gemini provider " +
  "integration, image validation and ownership controls, advisory-only behavior, security testing, " +
  "retention controls, and successful end-to-end verification. This approval does not authorize " +
  "LIVE activation or customer-facing production use.";
const REFERENCE = "HOMEEIGO Phase 7 Step 6 Vision Intelligence Human Certification, 2026-08-24";

async function main() {
  console.log("=== STEP 6 VISION — CERTIFICATION (hardened path) ===\n");

  // 1. Verify ADMIN role/active/not banned
  const admin = await prisma.user.findUnique({
    where: { id: ADMIN_ID },
    select: { id: true, role: true, isActive: true, isBanned: true },
  });
  if (!admin || admin.role !== "ADMIN" || !admin.isActive || admin.isBanned) {
    throw new Error("REFUSING: admin does not resolve to an active, unbanned ADMIN");
  }
  console.log("Admin verified:", JSON.stringify(admin));

  const existing = await getCertification(AUTOMATION_ID, 1);
  if (existing && !existing.voidedAt) {
    console.log("\nAlready certified and not voided — refusing to duplicate:", existing.id);
    process.exit(0);
  }

  // 2+3. Audit BEFORE certification (handled inside certifyAutomation — writes ActivityLog first,
  // then the AutomationCertification row, refusing the whole operation if the audit write fails).
  const result = await certifyAutomation({
    automationId: AUTOMATION_ID,
    workflowVersion: 1,
    certifiedBy: "HOMEEIGO Team",
    approvedBy: { adminId: ADMIN_ID, reason: REASON },
    riskClass: "LOW",
    approvedExecutionMode: "SHADOW",
    approvalReference: REFERENCE,
    knownLimitations:
      "SHADOW-only. Real Gemini provider proven end-to-end (real submit->analyze HTTP flow, real " +
      "provider call, honest PROVIDER_ERROR recording on failure). Advisory-only — no downstream " +
      "action treats output as authorization for money or state changes. Ownership isolation, magic-" +
      "byte validation, MIME cross-check, and 30-day retention/purge all verified. " +
      "REAL_HOUSEHOLD_QUALITY_NOT_VERIFIED — no legitimate customer household photo has been used " +
      "for observation; only synthetic test fixtures, which correctly fail Gemini's own image " +
      "validation. Admin dashboard RBAC-gated (403 confirmed for non-admin). Mobile vision UI not " +
      "built — web is the certified customer surface. LIVE explicitly not authorized by this " +
      "certification.",
  });
  console.log("\ncertifyAutomation result:", JSON.stringify(result));

  // 4. Read back from DB — never trust the in-memory write result.
  const readBack = await prisma.automationCertification.findUnique({
    where: { automationId_workflowVersion: { automationId: AUTOMATION_ID, workflowVersion: 1 } },
  });
  if (!readBack) throw new Error("INTEGRITY FAILURE: certification not found after write");

  console.log("\n=== DB READ-BACK ===");
  console.log("id:", readBack.id);
  console.log("automationId:", readBack.automationId);
  console.log("workflowVersion:", readBack.workflowVersion);
  console.log("approvedExecutionMode:", readBack.approvedExecutionMode);
  console.log("approvedByAdminId:", readBack.approvedByAdminId);
  console.log("approvalReference:", readBack.approvalReference);
  console.log("riskClass:", readBack.riskClass);
  console.log("capabilityFingerprint:", readBack.capabilityFingerprint);
  console.log("shadowEvidenceReference:", readBack.shadowEvidenceReference);
  console.log("knownLimitations:", readBack.knownLimitations);
  console.log("voidedAt:", readBack.voidedAt);
  console.log("certifiedAt:", readBack.certifiedAt.toISOString());

  // 5. Verify fields
  if (readBack.approvedExecutionMode !== "SHADOW") throw new Error("INTEGRITY FAILURE: not SHADOW");
  if (readBack.voidedAt) throw new Error("INTEGRITY FAILURE: unexpectedly voided");
  if (readBack.approvedByAdminId !== ADMIN_ID) throw new Error("INTEGRITY FAILURE: wrong admin");
  if (readBack.approvalReference !== REFERENCE) throw new Error("INTEGRITY FAILURE: reference mismatch");
  if (!readBack.knownLimitations) throw new Error("INTEGRITY FAILURE: knownLimitations missing");

  // 6. LIVE blocked check
  const liveCount = await prisma.automationCertification.count({
    where: { automationId: AUTOMATION_ID, approvedExecutionMode: "LIVE" },
  });
  console.log("\nLIVE certifications for vision_intelligence:", liveCount, "(must be 0)");
  if (liveCount !== 0) throw new Error("INTEGRITY FAILURE: LIVE certification exists");

  console.log("\n=== VISION CERTIFICATION COMPLETE — SHADOW ONLY, LIVE BLOCKED ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
