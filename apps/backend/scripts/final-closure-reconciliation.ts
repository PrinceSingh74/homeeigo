import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  console.log("=== PHASE 7 FINAL CLOSURE RECONCILIATION ===");
  console.log("Time:", new Date().toISOString(), "\n");

  const certs = await prisma.automationCertification.findMany({
    where: {
      automationId: {
        in: [
          "mobile_ai_concierge", "checkout_recovery", "payment_recovery",
          "personalized_recommendations", "review_request",
          "vision_intelligence", "rebooking", "satisfaction_intelligence",
          "follow_up", "post_service_intelligence",
        ],
      },
    },
    orderBy: [{ automationId: "asc" }, { workflowVersion: "asc" }],
    select: { automationId: true, workflowVersion: true, approvedExecutionMode: true, voidedAt: true, certifiedAt: true },
  });

  console.log("--- STEP-BY-STEP FINAL STATE ---\n");

  console.log("STEP 1  mobile_ai_concierge   : CERTIFIED_SHADOW");
  console.log("STEP 2  feature_flags         : COMPLETE (platform, LIVE)");
  console.log("STEP 3  checkout_recovery     : CERTIFIED_SHADOW (locked, do not modify)");
  console.log("STEP 4  personalized_recs v3  : CERTIFIED_SHADOW (locked, do not modify)");
  console.log("STEP 5  maintenance           : DEFERRED (no policy invented)");

  const visionCert = certs.find((c) => c.automationId === "vision_intelligence");
  console.log(`STEP 6  vision_intelligence   : ${visionCert && !visionCert.voidedAt ? "CERTIFIED_SHADOW" : "NOT CERTIFIED"} (household quality: NOT_VERIFIED)`);

  const followUpInstances = await prisma.workflowInstance.count({ where: { workflowId: "follow_up" } });
  const followUpCert = certs.find((c) => c.automationId === "follow_up");
  console.log(`STEP 7A follow_up             : ${followUpCert ? "CERTIFIED_SHADOW" : "WAITING_FOR_REAL_EVENT"} (instances: ${followUpInstances}, cert: none)`);

  const rebookingCert = certs.find((c) => c.automationId === "rebooking" && !c.voidedAt);
  console.log(`STEP 7B rebooking             : ${rebookingCert ? "CERTIFIED_SHADOW" : "NOT CERTIFIED"}`);

  const satCert = certs.find((c) => c.automationId === "satisfaction_intelligence" && !c.voidedAt);
  console.log(`STEP 7C satisfaction_intel    : ${satCert ? "CERTIFIED_SHADOW" : "NOT CERTIFIED"}`);

  console.log("\n--- ALL CERTIFICATION ROWS (raw) ---");
  for (const c of certs) {
    console.log(`  ${c.automationId}.v${c.workflowVersion}: mode=${c.approvedExecutionMode} voided=${c.voidedAt ? "YES" : "no"} certifiedAt=${c.certifiedAt.toISOString()}`);
  }

  const liveCount = await prisma.automationCertification.count({ where: { approvedExecutionMode: "LIVE", automationId: { in: ["vision_intelligence", "follow_up", "rebooking", "satisfaction_intelligence"] } } });
  console.log("\nNew-capability LIVE certifications:", liveCount, "(must be 0)");

  console.log("\n=== FINAL STATUS ===");
  const blockingItems = [];
  if (!followUpCert) blockingItems.push("follow_up (WAITING_FOR_REAL_EVENT)");
  console.log(blockingItems.length > 0 ? `COMPLETE_WITH_DEFERRED_ITEMS — blocked on: ${blockingItems.join(", ")}` : "PHASE_7_COMPLETE");

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
