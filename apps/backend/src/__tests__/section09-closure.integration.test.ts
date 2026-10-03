/**
 * Section 09 — final operational closure loop.
 *
 * Covers the gaps the certification pass left open: the preference surfaces that wrote booleans
 * nothing read, the legacy notification paths that would have doubled up the moment their
 * replacements went live, and the workflows that must stay in SHADOW until a human certifies them.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  clearWorkflows,
  listWorkflows,
  registerWorkflow,
} from "../automation/registry/workflow-registry";
import { isSupersededByLiveWorkflow } from "../automation/registry/legacy-path-guard";
/** Registers every workflow the platform has, Section 09's included. */
import { registerAllWorkflows } from "../automation/registry/definitions";
import { REVIEW_REQUEST_JOB_TYPE } from "../events/jobs/review-request.job";
import { isMandatory, categoryDefaultChannels } from "../notifications/preferences.service";
import { quietHoursApply } from "../notifications/governance/policy";
import { listCanonicalPartnerEvents } from "../events/catalog/partner-event-catalog";
import { OUTBOX_PUBLISHER_SOURCE } from "../events/core/outbox-processor";
import type { NotificationCategory } from "@prisma/client";

const ALL_CATEGORIES: NotificationCategory[] = ["TRANSACTIONAL", "SECURITY", "OPTIONAL"];

beforeEach(() => {
  clearWorkflows();
});

afterEach(() => {
  clearWorkflows();
});

describe("no workflow may act without deliberate certification", () => {
  /**
   * Asserted against the *effective* mode, not the declared one.
   *
   * `startWorkflowInstance` resolves `definition.executionMode ?? "LIVE"`, so a definition that
   * simply omits the field acts for real. Checking only for an explicit `"LIVE"` would pass while
   * an omission quietly did the opposite of what this test claims to guarantee.
   */
  test("no workflow resolves to LIVE, including by omission", () => {
    registerAllWorkflows();

    const acting = listWorkflows().filter((w) => (w.executionMode ?? "LIVE") === "LIVE");
    expect(acting.map((w) => `${w.workflowId}.v${w.version}`)).toEqual([]);
  });

  test("every registered workflow declares a non-certified status", () => {
    registerAllWorkflows();

    const certified = listWorkflows().filter((w) => w.certificationStatus === "CERTIFIED");
    expect(certified.map((w) => w.workflowId)).toEqual([]);
  });

  test("every workflow names an owner, so a live action is attributable", () => {
    registerAllWorkflows();

    const unowned = listWorkflows().filter(
      (w) => !(w.metadata as { owner?: unknown } | undefined)?.owner,
    );
    expect(unowned.map((w) => w.workflowId)).toEqual([]);
  });
});

describe("legacy imperative paths retire when their replacement goes live", () => {
  test("the legacy review-request job keeps running while its replacement is SHADOW", () => {
    registerAllWorkflows();
    expect(isSupersededByLiveWorkflow(REVIEW_REQUEST_JOB_TYPE)).toBe(false);
  });

  test("the legacy review-request job stands down once its replacement is LIVE", () => {
    registerWorkflow({
      workflowId: "review_request",
      version: 99,
      name: "Review request (certified)",
      trigger: "homigo.booking.completed",
      executionMode: "LIVE",
      certificationStatus: "CERTIFIED",
      riskClass: "LOW",
      steps: [{ id: "done", type: "STOP", reasonCode: "TEST" }],
      maxAgeMs: 3_600_000,
      maxSteps: 4,
      metadata: { owner: "growth", replaces: REVIEW_REQUEST_JOB_TYPE },
    });

    expect(isSupersededByLiveWorkflow(REVIEW_REQUEST_JOB_TYPE)).toBe(true);
  });

  test("a LIVE workflow only retires the path it actually names", () => {
    registerWorkflow({
      workflowId: "review_request",
      version: 99,
      name: "Review request (certified)",
      trigger: "homigo.booking.completed",
      executionMode: "LIVE",
      certificationStatus: "CERTIFIED",
      riskClass: "LOW",
      steps: [{ id: "done", type: "STOP", reasonCode: "TEST" }],
      maxAgeMs: 3_600_000,
      maxSteps: 4,
      metadata: { owner: "growth", replaces: REVIEW_REQUEST_JOB_TYPE },
    });

    expect(isSupersededByLiveWorkflow("automation.some_other_job")).toBe(false);
  });

  test("a SHADOW workflow never retires the path it will eventually replace", () => {
    registerWorkflow({
      workflowId: "review_request",
      version: 98,
      name: "Review request (rehearsing)",
      trigger: "homigo.booking.completed",
      executionMode: "SHADOW",
      certificationStatus: "DRAFT",
      riskClass: "LOW",
      steps: [{ id: "done", type: "STOP", reasonCode: "TEST" }],
      maxAgeMs: 3_600_000,
      maxSteps: 4,
      metadata: { owner: "growth", replaces: REVIEW_REQUEST_JOB_TYPE },
    });

    expect(isSupersededByLiveWorkflow(REVIEW_REQUEST_JOB_TYPE)).toBe(false);
  });
});

describe("preference policy is the same wherever it is asked", () => {
  test("transactional and security cannot be refused", () => {
    expect(isMandatory("TRANSACTIONAL")).toBe(true);
    expect(isMandatory("SECURITY")).toBe(true);
    expect(isMandatory("OPTIONAL")).toBe(false);
  });

  test("every category resolves to at least one default channel", () => {
    for (const category of ALL_CATEGORIES) {
      expect(categoryDefaultChannels(category).length).toBeGreaterThan(0);
    }
  });

  /**
   * The legacy bridge writes into OPTIONAL only. This asserts the shape that rule depends on: if a
   * fourth, refusable category were ever added, the bridge would silently stop covering it.
   */
  test("OPTIONAL is the only refusable category", () => {
    const refusable = ALL_CATEGORIES.filter((c) => !isMandatory(c));
    expect(refusable).toEqual(["OPTIONAL"]);
  });
});

describe("demand.spike stays registered and inert", () => {
  test("catalog marks demand.spike as POLICY_PENDING with no live producer claim", () => {
    const spike = listCanonicalPartnerEvents().find((e) => e.canonical === "demand.spike");
    expect(spike?.producerStatus).toBe("POLICY_PENDING");
    expect(spike?.producer).toMatch(/no producer/i);
  });
});

describe("publisher DLQ is replayable", () => {
  test("outbox.publisher is a sentinel, not a registered consumer name", () => {
    expect(OUTBOX_PUBLISHER_SOURCE).toBe("outbox.publisher");
  });
});

describe("quiet hours do not delay mandatory security traffic", () => {
  test("SECURITY and TRANSACTIONAL are exempt from quiet hours by default", () => {
    expect(quietHoursApply("OPTIONAL")).toBe(true);
    expect(quietHoursApply("SECURITY")).toBe(false);
    expect(quietHoursApply("TRANSACTIONAL")).toBe(false);
  });
});


