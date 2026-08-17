import { registerWorkflow, syncWorkflowDefinitions } from "../workflow-registry";
import { registerAllConditions } from "../../conditions/condition-registry";
import { bootstrapTemplates } from "../../../notifications/templates/definitions";

/**
 * Every workflow definition, registered at boot.
 *
 * 6A ships one workflow and it deliberately has no side effects. Its job is to prove the engine —
 * that an instance starts once per trigger, waits durably through the existing scheduler, advances
 * under a claim only one worker can win, and terminates. Workflows that actually contact people
 * arrive in 6G, once conditions (6B), notification routing (6E'), cadence (6C) and shadow mode
 * (6D) exist to make that safe.
 *
 * Nothing is activated here. Activation is a deliberate act — see `activateWorkflow` — because an
 * ACTIVE version is immutable from that moment on.
 */

/** Engine self-test: start → wait 1 minute → stop. Touches nothing outside the workflow tables. */
export const ENGINE_SELFTEST_WORKFLOW = "engine_selftest";

export function registerAllWorkflows(): void {
  registerWorkflow({
    workflowId: ENGINE_SELFTEST_WORKFLOW,
    version: 1,
    name: "Automation engine self-test",
    trigger: "manual",
    steps: [
      { id: "wait", type: "WAIT", delayMs: 60_000 },
      { id: "done", type: "STOP", reasonCode: "SELFTEST_OK" },
    ],
    maxAgeMs: 3_600_000,
    maxSteps: 8,
    metadata: { purpose: "6A structural verification — no external side effects" },
  });
}

export async function bootstrapWorkflows(): Promise<void> {
  // Conditions first: a workflow step naming a condition that is not registered yet would fail
  // its instance, and registration order is the one thing that decides which happens.
  registerAllConditions();
  // Templates before workflows: a NOTIFICATION step whose template is not yet registered would
  // route to NO_TEMPLATE and skip silently.
  await bootstrapTemplates();
  registerAllWorkflows();
  await syncWorkflowDefinitions();
}
