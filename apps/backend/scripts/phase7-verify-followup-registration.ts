import "../src/load-env";
import { registerAllConditions } from "../src/automation/conditions/condition-registry";
import { registerAllWorkflows, FOLLOW_UP_WORKFLOW } from "../src/automation/registry/definitions/index";
import { getWorkflow } from "../src/automation/registry/workflow-registry";
import { getCondition } from "../src/automation/conditions/condition-registry";
import { bootstrapTemplates } from "../src/notifications/templates/definitions";
import { resolveTemplate } from "../src/notifications/templates/registry";

async function main() {
  console.log("=== STEP 7A REGISTRATION VERIFICATION ===\n");

  registerAllConditions();
  await bootstrapTemplates();
  registerAllWorkflows();

  const def = getWorkflow(FOLLOW_UP_WORKFLOW, 1);
  console.log("Workflow registered:", !!def);
  if (!def) {
    console.error("FAIL: follow_up v1 not found in registry");
    process.exit(1);
  }
  console.log("  workflowId:", def.workflowId);
  console.log("  version:", def.version);
  console.log("  trigger:", def.trigger);
  console.log("  executionMode:", def.executionMode);
  console.log("  certificationStatus:", def.certificationStatus);
  console.log("  riskClass:", def.riskClass);
  console.log("  steps:", def.steps.map((s) => s.type).join(" -> "));

  const cond = getCondition("booking.still_completed");
  console.log("\nCondition registered:", !!cond);
  if (!cond) {
    console.error("FAIL: booking.still_completed not found");
    process.exit(1);
  }
  console.log("  ", JSON.stringify(cond));

  const tmpl = resolveTemplate({
    notificationType: "booking.follow_up_checkin",
    channel: "PUSH",
    language: "en",
  });
  console.log("\nTemplate resolvable:", !!tmpl);
  if (!tmpl) {
    console.error("FAIL: booking.follow_up_checkin push/en template not resolvable");
    process.exit(1);
  }
  console.log("  templateId:", tmpl.templateId);
  console.log("  title:", tmpl.title);
  console.log("  body:", tmpl.body);

  console.log("\nEXECUTION MODE CHECK: expect SHADOW, got", def.executionMode);
  if (def.executionMode !== "SHADOW") {
    console.error("FAIL: executionMode is not SHADOW — would violate non-negotiable LIVE-block rule");
    process.exit(1);
  }

  console.log("\n=== ALL CHECKS PASS ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
