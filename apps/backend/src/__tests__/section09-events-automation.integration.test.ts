/**
 * Section 09 — Events, Notifications & Automation integration tests.
 *
 * Validates catalog completeness, workflow registration, trigger wiring, and PII-safe payloads.
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { EVENT_TYPES } from "../events/catalog/event-types";
import {
  CANONICAL_PARTNER_EVENTS,
  lookupCanonicalEvent,
} from "../events/catalog/partner-event-catalog";
import {
  buildPartnerPayoutFailedEvent,
  buildPartnerRatingReceivedEvent,
  buildPartnerCreatedEvent,
} from "../events/catalog/partner.events";
import { assertNoProhibitedPii, sanitizeEventPayload } from "../events/core/pii";
import { validateEventEnvelope } from "../events/core/validation";
import { triggersFor, listTriggers } from "../automation/registry/trigger-registry";
import { getWorkflow, listWorkflows } from "../automation/registry/workflow-registry";
import { getCondition, listConditions } from "../automation/conditions/condition-registry";
import {
  COMPLIANCE_KYC_D30_WORKFLOW,
  DISPATCH_STALL_WORKFLOW,
  PAYOUT_FAILED_RECOVERY_WORKFLOW,
  PARTNER_OFFLINE_REENGAGEMENT_WORKFLOW,
} from "../automation/registry/definitions/section-09-workflow-ids";
import { registerAllConditions } from "../automation/conditions/condition-registry";
import { registerSection09Workflows } from "../automation/registry/definitions/section-09-workflows";
import { registerDispatchStallWorkflow } from "../automation/registry/definitions/dispatch-stall-workflow";
import { clearWorkflows } from "../automation/registry/workflow-registry";

beforeAll(() => {
  clearWorkflows();
  registerAllConditions();
  registerSection09Workflows();
  registerDispatchStallWorkflow();
});

describe("Section 09 canonical event catalog", () => {
  test("covers required partner lifecycle events", () => {
    const canonicals = CANONICAL_PARTNER_EVENTS.map((e) => e.canonical);
    for (const name of [
      "partner.created",
      "partner.application.created",
      "partner.verified",
      "partner.activated",
      "partner.online",
      "partner.offline",
      "partner.job.completed",
      "partner.payout.failed",
      "partner.kyc.expiring",
      "partner.sos.created",
      "partner.referral.qualified",
    ]) {
      expect(canonicals).toContain(name);
    }
  });

  test("partner.job.* maps to existing runtime types without duplicate producers", () => {
    const jobCompleted = lookupCanonicalEvent("partner.job.completed");
    expect(jobCompleted?.runtimeType).toBe(EVENT_TYPES.BOOKING_COMPLETED);
    const jobOffered = lookupCanonicalEvent("partner.job.offered");
    expect(jobOffered?.runtimeType).toBe(EVENT_TYPES.PARTNER_DISPATCHED);
  });

  test("new event builders are PII-safe and versioned", () => {
    const event = buildPartnerPayoutFailedEvent({
      providerId: "pro_1",
      withdrawalId: "wd_1",
      withdrawalNumber: "WD-100",
      amount: 500,
      netAmount: 500,
      failureReason: "bank_rejected",
    });
    expect(event.homigo.version).toBe("1.0");
    expect(validateEventEnvelope(event).type).toBe(EVENT_TYPES.PARTNER_PAYOUT_FAILED);
    assertNoProhibitedPii(sanitizeEventPayload(event.data as Record<string, unknown>));
    expect(JSON.stringify(event.data)).not.toContain("account");
  });

  test("partner.created builder uses aggregate id only", () => {
    const event = buildPartnerCreatedEvent({ providerId: "pro_1" });
    expect(event.type).toBe(EVENT_TYPES.PARTNER_CREATED);
    expect(event.homigo.aggregateId).toBe("pro_1");
  });

  test("rating event carries stars not review text", () => {
    const event = buildPartnerRatingReceivedEvent({
      providerId: "pro_1",
      bookingId: "bk_1",
      ratingId: "rt_1",
      stars: 2,
      previousRating: 4.5,
    });
    expect(event.data).not.toHaveProperty("reviewText");
    expect((event.data as { stars: number }).stars).toBe(2);
  });
});

describe("Section 09 workflow registration", () => {
  test("registers all Section 09 workflows in SHADOW", () => {
    for (const id of [
      COMPLIANCE_KYC_D30_WORKFLOW,
      PAYOUT_FAILED_RECOVERY_WORKFLOW,
      PARTNER_OFFLINE_REENGAGEMENT_WORKFLOW,
      DISPATCH_STALL_WORKFLOW,
    ]) {
      const wf = getWorkflow(id, 1);
      expect(wf).toBeDefined();
      expect(wf!.executionMode).toBe("SHADOW");
      expect(wf!.certificationStatus).toBe("DRAFT");
    }
  });

  test("dispatch_stall trigger resolves to registered workflow", () => {
    const triggers = triggersFor(EVENT_TYPES.BOOKING_ASSIGNED);
    expect(triggers.some((t) => t.workflowId === DISPATCH_STALL_WORKFLOW)).toBe(true);
    expect(getWorkflow(DISPATCH_STALL_WORKFLOW, 1)).toBeDefined();
  });

  test("compliance expiring starts both D30 and D7 workflows", () => {
    const triggers = triggersFor(EVENT_TYPES.PARTNER_COMPLIANCE_EXPIRING);
    expect(triggers.length).toBeGreaterThanOrEqual(2);
  });

  test("Section 09 conditions are registered", () => {
    expect(getCondition("provider.compliance_d30")).toBeDefined();
    expect(getCondition("provider.still_offline")).toBeDefined();
    expect(getCondition("provider.payout_still_failed")).toBeDefined();
    expect(getCondition("provider.rating_needs_coaching")).toBeDefined();
  });

  test("registering the same condition twice is a no-op, not a throw", () => {
    const before = listConditions();
    expect(() => registerAllConditions()).not.toThrow();
    expect(() => registerAllConditions()).not.toThrow();
    expect(listConditions()).toEqual(before);
    expect(new Set(listConditions()).size).toBe(listConditions().length);
  });

  test("concurrent registerAllConditions does not duplicate active ids", async () => {
    await Promise.all([registerAllConditions(), registerAllConditions(), registerAllConditions()]);
    const ids = listConditions();
    expect(new Set(ids).size).toBe(ids.length);
    expect(getCondition("booking.completed_and_unrated")).toBeDefined();
  });

  test("re-registering the same workflow version is one effective registration", () => {
    const before = listWorkflows().map((w) => `${w.workflowId}:${w.version}`).sort();
    expect(() => registerSection09Workflows()).not.toThrow();
    expect(() => registerDispatchStallWorkflow()).not.toThrow();
    const after = listWorkflows().map((w) => `${w.workflowId}:${w.version}`).sort();
    expect(after).toEqual(before);
  });

  test("no workflow registers as LIVE without certification", () => {
    for (const wf of listWorkflows()) {
      if (wf.riskClass && wf.executionMode === "LIVE") {
        expect(wf.certificationStatus).toBe("CERTIFIED");
      }
    }
  });

  test("trigger registry has no orphan dispatch_stall string id", () => {
    for (const t of listTriggers()) {
      if (t.workflowId.includes("dispatch")) {
        expect(getWorkflow(t.workflowId, 1)).toBeDefined();
      }
    }
  });
});
