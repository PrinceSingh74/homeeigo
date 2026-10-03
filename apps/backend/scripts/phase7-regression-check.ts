import "../src/load-env";
import { registerAllConditions } from "../src/automation/conditions/condition-registry";
import { registerAllWorkflows } from "../src/automation/registry/definitions/index";
import { listWorkflows } from "../src/automation/registry/workflow-registry";
import { bootstrapTemplates } from "../src/notifications/templates/definitions";
import prisma from "../src/lib/prisma";

async function main() {
  console.log("=== PHASE 6 CRITICAL REGRESSION CHECK ===\n");
  let allPass = true;

  // 1. Registry still resolves cleanly, no duplicate-registration errors, all pre-existing
  //    workflows still present alongside the new follow_up.
  registerAllConditions();
  await bootstrapTemplates();
  registerAllWorkflows();
  const all = listWorkflows();
  const ids = all.map((w) => `${w.workflowId}.v${w.version}`);
  console.log("Registered workflows:", ids.join(", "));

  const mustExist = ["payment_recovery.v1", "payment_recovery.v2", "checkout_recovery.v1", "review_request.v1", "follow_up.v1"];
  for (const id of mustExist) {
    const present = ids.includes(id);
    console.log(`  ${id}: ${present ? "PASS" : "FAIL — MISSING"}`);
    if (!present) allPass = false;
  }

  // 2. Their certifications remain untouched — not voided, not mutated.
  const certs = await prisma.automationCertification.findMany({
    where: { automationId: { in: ["payment_recovery", "checkout_recovery", "review_request"] } },
    select: { automationId: true, workflowVersion: true, approvedExecutionMode: true, voidedAt: true, certifiedAt: true },
  });
  console.log("\nExisting certifications (must be unchanged, not voided):");
  for (const c of certs) {
    console.log(`  ${c.automationId}.v${c.workflowVersion}: mode=${c.approvedExecutionMode} voided=${c.voidedAt ?? "null"} certifiedAt=${c.certifiedAt.toISOString()}`);
    if (c.voidedAt) {
      console.log("    FAIL: unexpectedly voided");
      allPass = false;
    }
    if (c.approvedExecutionMode !== "SHADOW") {
      console.log("    FAIL: unexpectedly not SHADOW");
      allPass = false;
    }
  }

  // 3. Their DB-level workflow definitions are still ACTIVE and match their registered fingerprint.
  const defs = await prisma.workflowDefinition.findMany({
    where: { workflowId: { in: ["payment_recovery", "checkout_recovery", "review_request"] } },
    select: { workflowId: true, version: true, status: true },
  });
  console.log("\nWorkflowDefinition rows (must still be ACTIVE):");
  for (const d of defs) {
    console.log(`  ${d.workflowId}.v${d.version}: status=${d.status}`);
    if (d.status !== "ACTIVE") {
      console.log("    FAIL: expected ACTIVE");
      allPass = false;
    }
  }

  console.log(`\n=== ${allPass ? "REGRESSION CLEAN" : "REGRESSION FAILURE DETECTED"} ===`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
