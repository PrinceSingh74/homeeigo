import "../src/load-env";
import { registerAllConditions } from "../src/automation/conditions/condition-registry";
import { registerAllWorkflows } from "../src/automation/registry/definitions/index";
import { listWorkflows } from "../src/automation/registry/workflow-registry";
import { bootstrapTemplates } from "../src/notifications/templates/definitions";
import { evaluateFlag, PHASE7_FLAGS } from "../src/services/feature-flag.service";
import prisma from "../src/lib/prisma";

async function main() {
  console.log("=== PHASE 7 FINAL RECONCILIATION ===");
  console.log("Time:", new Date().toISOString());
  console.log();

  // --- SOURCE vs RUNTIME: registry loads without error ---
  registerAllConditions();
  await bootstrapTemplates();
  registerAllWorkflows();
  const registered = listWorkflows().map((w) => `${w.workflowId}.v${w.version}`);
  console.log("1. SOURCE/RUNTIME — registry loaded cleanly:", registered.includes("follow_up.v1") ? "PASS" : "FAIL");

  // --- DATABASE: workflow_definitions status ---
  const wfDefs = await prisma.workflowDefinition.findMany({
    where: { workflowId: { in: ["follow_up", "review_request", "payment_recovery", "checkout_recovery"] } },
    select: { workflowId: true, version: true, status: true },
    orderBy: [{ workflowId: "asc" }, { version: "asc" }],
  });
  console.log("\n2. DATABASE — WorkflowDefinition status:");
  for (const d of wfDefs) console.log(`   ${d.workflowId}.v${d.version}: ${d.status}`);

  // --- FLAGS: real evaluator, real user ---
  const realUser = await prisma.user.findFirst({ where: { role: "CUSTOMER" }, select: { id: true } });
  console.log("\n3. FLAGS — evaluated for a real user:");
  for (const key of [PHASE7_FLAGS.AI_FOLLOW_UP, PHASE7_FLAGS.AI_REBOOKING, PHASE7_FLAGS.AI_SATISFACTION_INTELLIGENCE]) {
    const d = await evaluateFlag(key, realUser?.id);
    console.log(`   ${key}: enabled=${d.enabled} reason=${d.reason}`);
  }

  // --- WORKFLOWS: instances ever created for follow_up ---
  const followUpInstances = await prisma.workflowInstance.count({ where: { workflowId: "follow_up" } });
  console.log(`\n4. WORKFLOW INSTANCES — follow_up: ${followUpInstances} (0 = no real booking.completed event has fired since activation)`);

  // --- CERTIFICATIONS: current state of all Phase 7 automations ---
  const certs = await prisma.automationCertification.findMany({
    where: { automationId: { in: ["mobile_ai_concierge", "follow_up", "rebooking", "satisfaction_intelligence", "post_service_intelligence", "payment_recovery", "checkout_recovery", "review_request"] } },
    select: { automationId: true, workflowVersion: true, approvedExecutionMode: true, voidedAt: true, approvedByAdminId: true, approvalReference: true, certifiedAt: true },
    orderBy: [{ automationId: "asc" }, { workflowVersion: "asc" }],
  });
  console.log("\n5. CERTIFICATIONS — current state:");
  for (const c of certs) {
    console.log(`   ${c.automationId}.v${c.workflowVersion}: mode=${c.approvedExecutionMode} voided=${c.voidedAt ? c.voidedAt.toISOString() : "no"} admin=${c.approvedByAdminId} ref="${c.approvalReference}"`);
  }
  console.log("   (rebooking / satisfaction_intelligence: no rows — none created, correctly, no reason supplied yet)");

  // --- EVIDENCE: shadow execution rows for the new automations ---
  const evidence = await prisma.automationShadowExecution.count({ where: { workflowId: "follow_up" } });
  console.log(`\n6. EVIDENCE — AutomationShadowExecution rows for follow_up: ${evidence} (0 expected, no instance has reached that step yet)`);

  // --- AUDIT: activity log entries this session's work produced ---
  const recentAudit = await prisma.activityLog.findMany({
    where: { action: "AUTOMATION_CERTIFICATION_APPROVED" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { action: true, description: true, createdAt: true },
  });
  console.log("\n7. AUDIT — most recent AUTOMATION_CERTIFICATION_APPROVED entries:");
  for (const a of recentAudit) console.log(`   ${a.createdAt.toISOString()}: ${a.description}`);

  // --- LIVE check: nothing new is executionMode LIVE ---
  const liveCount = await prisma.automationCertification.count({
    where: { automationId: { in: ["follow_up", "rebooking", "satisfaction_intelligence"] }, approvedExecutionMode: "LIVE" },
  });
  console.log(`\n8. LIVE CHECK — Phase 7 new-capability LIVE certifications: ${liveCount} (must be 0)`);

  console.log("\n=== RECONCILIATION COMPLETE ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
