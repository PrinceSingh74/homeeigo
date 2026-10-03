import { beforeAll, describe, expect, it } from "bun:test";
import { registerAllTemplates } from "../notifications/templates/definitions";
import { clearTemplates, listTemplates, validateVariables } from "../notifications/templates/registry";
import { registerAllWorkflows } from "../automation/registry/definitions";
import { listWorkflows } from "../automation/registry/workflow-registry";

/**
 * Every NOTIFICATION step in every registered workflow must be sendable on every channel that has
 * a template for its notification type.
 *
 * `validateVariables` is strict in both directions — a missing declared variable and an undeclared
 * supplied variable both fail the send with VARIABLE_VALIDATION_FAILED. Three SHADOW workflows
 * (surge alert, morning brief, dispatch stall) shipped with step/template mismatches that would
 * have skipped every send the moment they were promoted to LIVE. This test makes that mismatch a
 * compile-time-equivalent failure instead of a production surprise.
 *
 * Variables the step lifts from its subject (partnerName, bookingNumber, documentType,
 * withdrawalNumber) are supplied by notification-step.ts; everything else must come from the
 * trigger metadata. Both are simulated as plain strings here — the contract under test is the
 * NAME set, not the values.
 */
describe("workflow notification steps match their templates", () => {
  beforeAll(() => {
    // Suites share one process and several register the catalogue; registering twice throws. Start
    // from an empty registry so the result is the full catalogue whatever ran before.
    clearTemplates();
    registerAllTemplates();
    registerAllWorkflows();
  });

  it("every (workflow step × channel template) pair validates with exactly the declared variables", () => {
    const templates = listTemplates();
    const failures: string[] = [];
    let pairs = 0;

    for (const wf of listWorkflows()) {
      for (const step of wf.steps) {
        if (step.type !== "NOTIFICATION") continue;
        const supplied: Record<string, unknown> = {};
        for (const name of step.variables ?? []) supplied[name] = "x";

        const forType = templates.filter((t) => t.notificationType === step.notificationType);
        if (forType.length === 0) {
          failures.push(`${wf.workflowId}@${wf.version} step ${step.id}: no template registered for ${step.notificationType}`);
          continue;
        }
        for (const t of forType) {
          pairs += 1;
          const v = validateVariables(t, supplied);
          if (!v.ok) failures.push(`${wf.workflowId}@${wf.version} step ${step.id} × ${t.templateId}: ${v.error}`);
        }
      }
    }

    expect(pairs).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it("the three previously broken SHADOW workflows now declare partnerName", () => {
    const byId = new Map(listWorkflows().map((w) => [w.workflowId, w]));
    for (const id of ["partner.surge_alert", "partner.dispatch_stall", "partner.morning_intelligence"]) {
      const wf = [...byId.values()].find((w) => w.steps.some((s) => s.type === "NOTIFICATION" && s.notificationType === id));
      expect(wf, `workflow with notification ${id}`).toBeDefined();
      const step = wf!.steps.find((s) => s.type === "NOTIFICATION" && s.notificationType === id);
      expect(step && step.type === "NOTIFICATION" ? step.variables : []).toContain("partnerName");
    }
  });
});
