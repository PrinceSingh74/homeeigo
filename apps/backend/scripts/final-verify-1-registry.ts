import "../src/load-env";
import { registerAllConditions } from "../src/automation/conditions/condition-registry";
import { registerAllWorkflows, FOLLOW_UP_WORKFLOW } from "../src/automation/registry/definitions/index";
import { getWorkflow } from "../src/automation/registry/workflow-registry";
import { triggersFor } from "../src/automation/registry/trigger-registry";
import { EVENT_TYPES } from "../src/events/catalog/event-types";
import { bootstrapTemplates } from "../src/notifications/templates/definitions";
import { rebookingSuggestionsFor } from "../src/services/rebooking-intelligence.service";
import { satisfactionSignalFor } from "../src/services/satisfaction-intelligence.service";

async function main() {
  console.log("=== STEP 1: REGISTRY VERIFICATION ===\n");
  let allPass = true;

  registerAllConditions();
  await bootstrapTemplates();
  registerAllWorkflows();

  // 1a. follow_up workflow definition
  const def = getWorkflow(FOLLOW_UP_WORKFLOW, 1);
  console.log("1a. follow_up workflow definition:");
  console.log("   registered:", !!def);
  console.log("   trigger:", def?.trigger);
  console.log("   executionMode:", def?.executionMode);
  console.log("   certificationStatus:", def?.certificationStatus);
  console.log("   steps:", def?.steps.map((s) => s.type).join(" -> "));
  if (!def || def.executionMode !== "SHADOW") { allPass = false; console.log("   FAIL"); }

  // 1b. follow_up trigger wiring
  const triggers = triggersFor(EVENT_TYPES.BOOKING_COMPLETED);
  const hasFollowUp = triggers.some((t) => t.workflowId === "follow_up");
  const hasReviewRequest = triggers.some((t) => t.workflowId === "review_request");
  console.log("\n1b. follow_up trigger wiring:");
  console.log("   triggers for BOOKING_COMPLETED:", triggers.map((t) => t.workflowId).join(", "));
  console.log("   follow_up wired:", hasFollowUp, "| review_request preserved:", hasReviewRequest);
  if (!hasFollowUp || !hasReviewRequest) { allPass = false; console.log("   FAIL"); }

  // 1c. rebooking service — importable, callable shape check (no real call, just existence)
  console.log("\n1c. rebooking service:");
  console.log("   rebookingSuggestionsFor is a function:", typeof rebookingSuggestionsFor === "function");
  if (typeof rebookingSuggestionsFor !== "function") { allPass = false; console.log("   FAIL"); }

  // 1d. satisfaction service
  console.log("\n1d. satisfaction service:");
  console.log("   satisfactionSignalFor is a function:", typeof satisfactionSignalFor === "function");
  if (typeof satisfactionSignalFor !== "function") { allPass = false; console.log("   FAIL"); }

  console.log(`\n=== ${allPass ? "REGISTRY VERIFICATION: ALL PASS" : "REGISTRY VERIFICATION: FAILURES"} ===`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
