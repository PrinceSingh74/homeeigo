import { describe, expect, test } from "bun:test";
import { EVENT_TYPES } from "../events/catalog/event-types";
import { buildHomigoEvent } from "../events/core/event-publisher";
import {
  triggersFor,
  triggeredEventTypes,
} from "../automation/registry/trigger-registry";
import {
  PARTNER_APPROVAL_ESCALATION_WORKFLOW,
  PARTNER_APPROVED_NOTIFY_WORKFLOW,
  PARTNER_KYC_REMINDER_WORKFLOW,
  PARTNER_LEAD_FOLLOWUP_WORKFLOW,
  PARTNER_LEAD_INTAKE_WORKFLOW,
  PARTNER_ONBOARDING_NUDGE_WORKFLOW,
  PARTNER_TRAINING_REMINDER_WORKFLOW,
  PARTNER_WELCOME_WORKFLOW,
  PARTNER_CHANGES_REQUESTED_RESUME_WORKFLOW,
} from "../automation/registry/definitions/partner-acquisition-workflow-ids";

function sampleEvent(type: string, data: Record<string, unknown>, aggregateId: string) {
  return buildHomigoEvent({
    type,
    source: "homigo/partner-acquisition-service",
    data,
    homigo: { aggregateType: "partner_lead", aggregateId },
  });
}

describe("partner acquisition automation triggers", () => {
  test("registers partner acquisition event types", () => {
    const types = triggeredEventTypes();
    expect(types).toContain(EVENT_TYPES.PARTNER_LEAD_CREATED);
    expect(types).toContain(EVENT_TYPES.PARTNER_APPLICATION_STARTED);
    expect(types).toContain(EVENT_TYPES.PARTNER_APPLICATION_SUBMITTED);
    expect(types).toContain(EVENT_TYPES.PARTNER_APPLICATION_APPROVED);
    expect(types).toContain(EVENT_TYPES.PARTNER_APPLICATION_CHANGES_REQUESTED);
    expect(types).toContain(EVENT_TYPES.PARTNER_ACTIVATED);
  });

  test("PARTNER_LEAD_CREATED starts intake and follow-up workflows", () => {
    const event = sampleEvent(EVENT_TYPES.PARTNER_LEAD_CREATED, { leadId: "lead_1" }, "lead_1");
    const triggers = triggersFor(EVENT_TYPES.PARTNER_LEAD_CREATED);
    expect(triggers.map((t) => t.workflowId).sort()).toEqual(
      [PARTNER_LEAD_FOLLOWUP_WORKFLOW, PARTNER_LEAD_INTAKE_WORKFLOW].sort(),
    );
    for (const trigger of triggers) {
      expect(trigger.subjectType).toBe("partner_lead");
      expect(trigger.deriveSubjectId(event)).toBe("lead_1");
    }
  });

  test("PARTNER_APPLICATION_STARTED derives provider subject", () => {
    const event = sampleEvent(
      EVENT_TYPES.PARTNER_APPLICATION_STARTED,
      { providerId: "prov_1", userId: "user_1" },
      "prov_1",
    );
    const triggers = triggersFor(EVENT_TYPES.PARTNER_APPLICATION_STARTED);
    expect(triggers.map((t) => t.workflowId).sort()).toEqual(
      [PARTNER_KYC_REMINDER_WORKFLOW, PARTNER_ONBOARDING_NUDGE_WORKFLOW].sort(),
    );
    for (const trigger of triggers) {
      expect(trigger.subjectType).toBe("provider");
      expect(trigger.deriveSubjectId(event)).toBe("prov_1");
    }
  });

  test("PARTNER_APPLICATION_SUBMITTED starts training reminder and approval escalation", () => {
    const event = sampleEvent(
      EVENT_TYPES.PARTNER_APPLICATION_SUBMITTED,
      { providerId: "prov_2" },
      "prov_2",
    );
    const triggers = triggersFor(EVENT_TYPES.PARTNER_APPLICATION_SUBMITTED);
    expect(triggers.map((t) => t.workflowId).sort()).toEqual(
      [PARTNER_APPROVAL_ESCALATION_WORKFLOW, PARTNER_TRAINING_REMINDER_WORKFLOW].sort(),
    );
    expect(triggers.every((t) => t.deriveSubjectId(event) === "prov_2")).toBe(true);
  });

  test("approval and activation events map to notify workflows", () => {
    const approved = sampleEvent(
      EVENT_TYPES.PARTNER_APPLICATION_APPROVED,
      { providerId: "prov_3" },
      "prov_3",
    );
    const activated = sampleEvent(EVENT_TYPES.PARTNER_ACTIVATED, { providerId: "prov_3" }, "prov_3");

    expect(triggersFor(EVENT_TYPES.PARTNER_APPLICATION_APPROVED)[0]?.workflowId).toBe(
      PARTNER_APPROVED_NOTIFY_WORKFLOW,
    );
    expect(triggersFor(EVENT_TYPES.PARTNER_ACTIVATED)[0]?.workflowId).toBe(PARTNER_WELCOME_WORKFLOW);
    expect(triggersFor(EVENT_TYPES.PARTNER_APPLICATION_APPROVED)[0]?.deriveSubjectId(approved)).toBe("prov_3");
    expect(triggersFor(EVENT_TYPES.PARTNER_ACTIVATED)[0]?.deriveSubjectId(activated)).toBe("prov_3");
  });

  test("PARTNER_APPLICATION_CHANGES_REQUESTED starts resume nudge workflow", () => {
    const event = sampleEvent(
      EVENT_TYPES.PARTNER_APPLICATION_CHANGES_REQUESTED,
      { providerId: "prov_4", targetStep: "kyc" },
      "prov_4",
    );
    const triggers = triggersFor(EVENT_TYPES.PARTNER_APPLICATION_CHANGES_REQUESTED);
    expect(triggers.map((t) => t.workflowId)).toEqual([PARTNER_CHANGES_REQUESTED_RESUME_WORKFLOW]);
    expect(triggers[0]?.subjectType).toBe("provider");
    expect(triggers[0]?.deriveSubjectId(event)).toBe("prov_4");
  });

  test("returns null subject when payload is incomplete", () => {
    const event = sampleEvent(EVENT_TYPES.PARTNER_LEAD_CREATED, {}, "");
    const trigger = triggersFor(EVENT_TYPES.PARTNER_LEAD_CREATED)[0]!;
    expect(trigger.deriveSubjectId(event)).toBeNull();
  });
});

describe("partner acquisition workflow certification", () => {
  test("nine workflow ids are defined for live certification", async () => {
    const ids = await import("../automation/registry/definitions/partner-acquisition-workflow-ids");
    const workflowIds = Object.values(ids).filter((v) => typeof v === "string");
    expect(workflowIds.length).toBe(9);
    expect(workflowIds).toContain("partner_lead_intake");
  });

  test("maintenance awaits workflow bootstrap before the job processor", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../lib/maintenance.ts"), "utf8");
    const bootstrap = src.indexOf("await bootstrapWorkflows()");
    const jobs = src.lastIndexOf("startScheduledJobProcessor()");
    const outbox = src.lastIndexOf("startOutboxProcessor()");
    expect(bootstrap).toBeGreaterThan(0);
    expect(jobs).toBeGreaterThan(bootstrap);
    expect(outbox).toBeGreaterThan(bootstrap);
  });
});

describe("partner acquisition event catalog", () => {
  test("includes canonical lifecycle events from spec", () => {
    expect(EVENT_TYPES.PARTNER_LEAD_INTERESTED).toBe("homigo.partner.lead.interested");
    expect(EVENT_TYPES.PARTNER_APPLICATION_CREATED).toBe("homigo.partner.application.created");
    expect(EVENT_TYPES.PARTNER_KYC_REJECTED).toBe("homigo.partner.kyc.rejected");
    expect(EVENT_TYPES.PARTNER_TRAINING_COMPLETED).toBe("homigo.partner.training.completed");
  });
});
