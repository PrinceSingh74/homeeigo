import "../src/load-env";
import { registerAllConditions } from "../src/automation/conditions/condition-registry";
import { registerAllWorkflows } from "../src/automation/registry/definitions/index";
import { bootstrapTemplates } from "../src/notifications/templates/definitions";
import { syncWorkflowDefinitions, activateWorkflow, getWorkflow } from "../src/automation/registry/workflow-registry";
import prisma from "../src/lib/prisma";

/**
 * Activates follow_up v1, matching the exact precedent of review_request/payment_recovery/
 * checkout_recovery: status=ACTIVE (eligible to catch real triggers), executionMode stays SHADOW
 * (zero real side effects), certificationStatus stays DRAFT (no LIVE claim made). This is NOT a
 * LIVE activation — those are two independent axes in this schema.
 */
async function main() {
  registerAllConditions();
  await bootstrapTemplates();
  registerAllWorkflows();
  await syncWorkflowDefinitions();

  const def = getWorkflow("follow_up", 1);
  if (!def) throw new Error("follow_up v1 not registered");
  if (def.executionMode !== "SHADOW") throw new Error("REFUSING: executionMode is not SHADOW");

  await activateWorkflow("follow_up", 1);

  const row = await prisma.workflowDefinition.findUnique({
    where: { workflowId_version: { workflowId: "follow_up", version: 1 } },
    select: { workflowId: true, version: true, status: true, activatedAt: true },
  });
  console.log("Activated:", JSON.stringify(row, null, 2));

  const live = await prisma.workflowDefinition.findMany({
    where: { status: "ACTIVE" },
    select: { workflowId: true, version: true },
  });
  console.log(
    "\nAll ACTIVE workflows now (status axis only, NOT executionMode):",
    live.map((w) => `${w.workflowId}.v${w.version}`).join(", "),
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
