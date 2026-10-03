import "../src/load-env";
import { PrismaClient } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { voidCertification } from "../src/automation/registry/certification";

const ADMIN_ID = "cmq9h67pk0000tz8s6tvnpet5";

async function correctCertifications() {
  console.log("=== PHASE 7 CERTIFICATION CORRECTION ===\n");

  // Verify admin
  const admin = await prisma.user.findUnique({
    where: { id: ADMIN_ID },
    select: { id: true, email: true }
  });

  if (!admin) {
    console.error("ERROR: Admin not found");
    process.exit(1);
  }

  console.log("Admin verified:", admin.email);

  // STEP 1: Certification is VALID (implementation complete)
  const step1 = await prisma.automationCertification.findUnique({
    where: {
      automationId_workflowVersion: {
        automationId: "mobile_ai_concierge",
        workflowVersion: 1
      }
    }
  });

  if (step1) {
    console.log("\n✅ STEP 1 Certification Status:");
    console.log("  ID:", step1.id);
    console.log("  Mode:", step1.approvedExecutionMode);
    console.log("  Voided:", step1.voidedAt ? "YES" : "NO");
    console.log("  Status: VALID (implementation complete, ready for sign-off)");
  }

  // STEP 7: Certification is PREMATURE (implementation not done)
  const step7 = await prisma.automationCertification.findUnique({
    where: {
      automationId_workflowVersion: {
        automationId: "post_service_intelligence",
        workflowVersion: 1
      }
    }
  });

  if (step7 && !step7.voidedAt) {
    console.log("\n⚠️  STEP 7 Certification Status:");
    console.log("  ID:", step7.id);
    console.log("  Mode:", step7.approvedExecutionMode);
    console.log("  Status: SCOPE_APPROVAL_ONLY (implementation not done)");

    console.log("\n  Action: VOIDING (preserves evidence, allows re-certification after implementation)");

    // Void the premature certification
    await voidCertification({
      automationId: "post_service_intelligence",
      workflowVersion: 1,
      voidedBy: ADMIN_ID,
      reason: "VOIDED: Scope approval only. Implementation not yet complete. Re-certify after implementation + tests + observation."
    });

    // Read back to verify void
    const verified = await prisma.automationCertification.findUnique({
      where: { id: step7.id }
    });

    if (verified?.voidedAt) {
      console.log("  ✅ Voided successfully");
      console.log("  Voided At:", verified.voidedAt);
      console.log("  Voided By:", verified.voidedBy);
      console.log("  Reason:", verified.voidReason);
    }
  }

  console.log("\n=== CORRECTION COMPLETE ===\n");
  console.log("STEP 1: KEEP (implementation done)");
  console.log("STEP 7: VOIDED (will recreate after implementation)\n");
  process.exit(0);
}

correctCertifications().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
