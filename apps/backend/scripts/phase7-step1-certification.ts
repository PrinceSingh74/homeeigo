import "../src/load-env";
import { PrismaClient } from "@prisma/client";
import prisma from "../src/lib/prisma";

const ADMIN_ID = "cmq9h67pk0000tz8s6tvnpet5";
const AUTOMATION_ID = "mobile_ai_concierge";

async function createStep1Certification() {
  console.log("=== STEP 1 CERTIFICATION CREATION ===\n");

  // Verify admin exists
  const admin = await prisma.user.findUnique({
    where: { id: ADMIN_ID },
    select: { id: true, email: true, role: true, isActive: true }
  });

  if (!admin || !admin.isActive) {
    console.error("ERROR: Admin user not found or inactive");
    process.exit(1);
  }

  console.log("Admin verified:", admin);
  console.log("Admin ID:", ADMIN_ID);

  // Create certification record
  const certification = await prisma.automationCertification.create({
    data: {
      automationId: AUTOMATION_ID,
      workflowVersion: 1,
      certifiedBy: "HOMIGO Team",
      approvalReference: "HOMIGO Phase 7 Step 1 Human Certification, 2026-08-24",
      riskClass: "LOW",
      approvedExecutionMode: "SHADOW",
      knownLimitations: "Feature-gated OFF by default via AI_CONCIERGE flag. Customer isolation verified. Prompt injection screening active. No mutations to core systems (bookings, payments, wallet, ledger). LIVE activation blocked.",
      approvedByAdminId: ADMIN_ID,
      certifiedAt: new Date("2026-08-24")
    }
  });

  console.log("\n✅ Certification record created:", certification.id);
  console.log("Automation ID:", certification.automationId);
  console.log("Workflow Version:", certification.workflowVersion);
  console.log("Risk Class:", certification.riskClass);
  console.log("Execution Mode:", certification.approvedExecutionMode);
  console.log("Approved By Admin ID:", certification.approvedByAdminId);

  // Read back verification
  const verify = await prisma.automationCertification.findUnique({
    where: { id: certification.id },
    select: {
      id: true,
      automationId: true,
      workflowVersion: true,
      approvedExecutionMode: true,
      certifiedAt: true,
      approvalReference: true,
      approvedByAdminId: true,
      knownLimitations: true
    }
  });

  if (!verify) {
    console.error("\nERROR: Certification not found after creation (integrity check failed)");
    process.exit(1);
  }

  console.log("\n✅ INTEGRITY VERIFIED - Certification readable from database:");
  console.log(JSON.stringify(verify, null, 2));

  // Verify LIVE is blocked
  if (verify.approvedExecutionMode !== "SHADOW") {
    console.error("\nERROR: Execution mode is not SHADOW");
    process.exit(1);
  }

  console.log("\n✅ LIVE ACTIVATION BLOCKED - Execution mode = SHADOW");
  console.log("\n=== STEP 1 CERTIFICATION COMPLETE ===\n");
  process.exit(0);
}

createStep1Certification().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
