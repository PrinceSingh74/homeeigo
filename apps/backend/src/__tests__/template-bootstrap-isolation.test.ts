import { afterEach, describe, expect, it } from "bun:test";
import { registerTemplate } from "../notifications/templates/registry";
import {
  __resetBootHealthForTests,
  getBootDegradations,
  isBootDegraded,
} from "../lib/boot-health";

/**
 * One malformed notification template must not stop the platform's event delivery.
 *
 * ── The outage this encodes ──────────────────────────────────────────────────
 *
 * `registerTemplate` throws on a template whose body names an undeclared variable — correctly, and
 * that validation is asserted here rather than relaxed. But `bootstrapTemplates()` used to sit in
 * the middle of `bootstrapWorkflows()`, so the throw travelled out to the catch in `maintenance.ts`,
 * which returns before `startOutboxProcessor()` and `startScheduledJobProcessor()`. A typo in one
 * notification body therefore stopped every domain event and every scheduled job — silently, for
 * three days.
 *
 * Nothing in the workflow registry reads the template registry, so the coupling was ordering, not
 * dependency. These cases pin both halves of the fix: validation still refuses bad templates, and a
 * refusal is contained to notifications instead of taking event delivery down with it.
 */
afterEach(() => {
  __resetBootHealthForTests();
});

describe("template validation is not weakened", () => {
  it("refuses a template whose body names an undeclared variable", () => {
    expect(() =>
      registerTemplate({
        templateId: `test.undeclared.${Date.now()}`,
        version: 1,
        notificationType: "test.undeclared",
        category: "TRANSACTIONAL",
        channel: "IN_APP",
        language: "en",
        body: "Hello {{partnerName}}, your {{documentType}} expires",
        variables: { partnerName: "string" },
      }),
    ).toThrow(/undeclared variable/i);
  });

  it("refuses a template whose TITLE names an undeclared variable", () => {
    expect(() =>
      registerTemplate({
        templateId: `test.undeclared-title.${Date.now()}`,
        version: 1,
        notificationType: "test.undeclared.title",
        category: "TRANSACTIONAL",
        channel: "IN_APP",
        language: "en",
        title: "Update for {{bookingNumber}}",
        body: "Hello",
        variables: {},
      }),
    ).toThrow(/undeclared variable/i);
  });

  it("accepts a template that declares everything it renders", () => {
    const id = `test.valid.${Date.now()}`;
    expect(() =>
      registerTemplate({
        templateId: id,
        version: 1,
        notificationType: "test.valid",
        category: "TRANSACTIONAL",
        channel: "IN_APP",
        language: "en",
        title: "Hello {{name}}",
        body: "Your booking {{bookingNumber}} is confirmed",
        variables: { name: "string", bookingNumber: "string" },
      }),
    ).not.toThrow();
  });
});

describe("a failing template bootstrap is contained", () => {
  it("registers the workflows and records a NOTIFICATION-scoped degradation, rather than aborting the bootstrap", async () => {
    __resetBootHealthForTests();
    const definitions = await import("../automation/registry/definitions");
    const templates = await import("../notifications/templates/definitions");
    const registry = await import("../automation/registry/workflow-registry");

    const { spyOn } = await import("bun:test");
    // Exactly what a malformed template produces at boot.
    const boom = spyOn(templates, "bootstrapTemplates").mockRejectedValue(
      new Error('Template x.v1 uses undeclared variable "zoneName"'),
    );
    // syncWorkflowDefinitions writes to the database; the contract under test is registration.
    const sync = spyOn(registry, "syncWorkflowDefinitions").mockResolvedValue({
      created: 0,
      updated: 0,
      skipped: 0,
    } as never);

    try {
      await definitions.bootstrapWorkflows();
    } finally {
      boom.mockRestore();
      sync.mockRestore();
    }

    // The workflow registry — which the outbox and scheduled-job processors depend on — is populated.
    expect(registry.listWorkflows().length).toBeGreaterThan(0);

    // And the failure is not silent: /ready reports degraded, naming notifications specifically.
    expect(isBootDegraded()).toBe(true);
    const degraded = getBootDegradations();
    expect(degraded.map((d) => d.component)).toContain("notification_templates");
    const entry = degraded.find((d) => d.component === "notification_templates");
    // The impact line must say what still works, or an operator cannot triage it.
    expect(entry?.impact).toContain("event delivery");
  });
});
