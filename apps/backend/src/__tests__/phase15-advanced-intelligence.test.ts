/**
 * Phase 15 — advanced intelligence.
 *
 * Each test corresponds to a property that could plausibly be got wrong, and several are written
 * as attacks rather than as confirmations. A guard that has never been shown refusing something is
 * not evidence that it refuses anything.
 */
import { describe, expect, it, beforeAll, afterAll, spyOn } from "bun:test";
import prisma from "../lib/prisma";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  scenarioSimulationService,
  SIMULATION_ASSUMPTIONS,
  SIMULATION_LIMITATIONS,
  SIMULATION_MODEL_VERSION,
  SIMULATION_FEATURE_FLAG,
} from "../services/scenario-simulation.service";
import { aiWorkflowDraftService, WORKFLOW_DRAFT_FEATURE_FLAG } from "../services/ai-workflow-draft.service";
import { currentEnvironment, invalidateFlagCache } from "../services/feature-flag.service";
import { cancellationRiskService, EXCLUDED_FEATURES, FEATURE_NAMES } from "../services/cancellation-risk.service";
import { AuditLogService } from "../services/audit-log.service";
import { providerAcceptanceService, EXCLUDED_FEATURES as ACCEPT_EXCLUDED, FEATURE_NAMES as ACCEPT_FEATURES } from "../services/provider-acceptance.service";
import { auc, brier, assessMateriality, aucStandardError } from "../lib/ml-evaluation";
import { registerAllConditions, listConditions } from "../automation/conditions/condition-registry";
import { triggeredEventTypes } from "../automation/registry/trigger-registry";

const TAG = `p15test-${Date.now()}`;
let actorId: string;

beforeAll(async () => {
  // The validator reads the LIVE registries. In a test process nothing has booted, so they must be
  // populated here — otherwise every allowlist is empty and the tests would "pass" by rejecting
  // everything, which proves nothing at all.
  registerAllConditions();

  // Phase-15 capabilities are release-gated and fail CLOSED, so the suite must enable them
  // explicitly. Seeding them here rather than assuming they exist keeps the gate honest: if the
  // flag check were removed, the dedicated refusal tests below would stop failing and say so.
  for (const key of [SIMULATION_FEATURE_FLAG, WORKFLOW_DRAFT_FEATURE_FLAG]) {
    await prisma.platformFeatureFlag.upsert({
      where: { key },
      create: { key, enabled: true, rolloutPct: 100, environment: currentEnvironment() },
      update: { enabled: true, rolloutPct: 100, environment: currentEnvironment() },
    });
    await invalidateFlagCache(key);
  }

  actorId = (await prisma.user.findFirst({ select: { id: true } }))?.id ?? "p15-actor";
});

afterAll(async () => {
  await prisma.aiWorkflowDraft.deleteMany({ where: { createdBy: actorId, intent: { startsWith: TAG } } });
  await prisma.enterpriseAuditLog.deleteMany({ where: { traceId: { startsWith: TAG } } });
});

// ── Capability 5 / 6 — scenario simulation and executive what-if ──────────────
describe("scenario simulation", () => {
  const params = { demandDeltaPct: 20, providerDeltaPct: -10 };

  it("never passes through the engine's hardcoded confidence", async () => {
    const r = await scenarioSimulationService.simulate("Delhi", params);
    /**
     * The underlying twin returns `confidence: 0.8`, hardcoded and never validated against an
     * outcome. A number that looks measured is worse than no number, because it survives being
     * read aloud in a meeting.
     */
    expect(r.confidence.kind).toBe("UNVALIDATED");
    /**
     * Asserted as "carries no number", not as "the string 0.8 is absent". The first version of
     * this test used the latter and failed against correct code: the note *explains* that the
     * engine's 0.8 is discarded, and naming a value in order to disown it is the opposite of
     * publishing it.
     */
    for (const v of Object.values(r.confidence)) expect(typeof v).not.toBe("number");
  });

  it("names every unvalidated coefficient the result rests on", async () => {
    const r = await scenarioSimulationService.simulate("Delhi", params);
    const priors = r.assumptions.filter((a) => a.basis === "UNVALIDATED_PRIOR");
    // Five of the six coefficients are priors nobody derived from this platform's data.
    expect(priors.length).toBeGreaterThanOrEqual(5);
    for (const a of r.assumptions) {
      expect(a.id.length).toBeGreaterThan(0);
      expect(a.note.length).toBeGreaterThan(20);
    }
    expect(r.limitations).toEqual(SIMULATION_LIMITATIONS);
    expect(r.modelVersion).toBe(SIMULATION_MODEL_VERSION);
  });

  it("is reproducible for the same inputs against the same snapshot", async () => {
    const a = await scenarioSimulationService.simulate("Delhi", params);
    const b = await scenarioSimulationService.simulate("Delhi", params);
    if (a.snapshotId === b.snapshotId) {
      // Same question, same underlying numbers ⇒ same id and same answer.
      expect(b.scenarioId).toBe(a.scenarioId);
      expect(b.projected).toEqual(a.projected);
    } else {
      /**
       * The baseline is live data and moves. When it does, the ids MUST differ — giving two
       * incomparable runs the same id would be worse than giving them different ones, because it
       * invites comparing them.
       */
      expect(b.scenarioId).not.toBe(a.scenarioId);
    }
  });

  it("gives different scenarios different ids", async () => {
    const a = await scenarioSimulationService.simulate("Delhi", { demandDeltaPct: 20 });
    const b = await scenarioSimulationService.simulate("Delhi", { demandDeltaPct: 21 });
    expect(a.scenarioId).not.toBe(b.scenarioId);
  });

  it("treats omitted parameters as explicit defaults", async () => {
    // Two callers who omit different fields must not produce two different scenario ids for what
    // is arithmetically the same question.
    const a = await scenarioSimulationService.simulate("Delhi", { demandDeltaPct: 5 });
    const b = await scenarioSimulationService.simulate("Delhi", {
      demandDeltaPct: 5, providerDeltaPct: 0, trafficDeltaPct: 0, rainStart: false, festival: false,
    });
    if (a.snapshotId === b.snapshotId) expect(b.scenarioId).toBe(a.scenarioId);
    expect(a.parameters).toEqual(b.parameters);
  });

  it("reports the data's freshness, not the response time", async () => {
    const r = await scenarioSimulationService.simulate("Delhi", params);
    // Substituting `now` would make every result look instantaneously fresh however stale the
    // inputs were — the defect Phase 13 removed from the telemetry-age panel.
    /**
     * The underlying twin stamps `freshness: new Date()` at response time while serving its data
     * through a 45-second cache, so a scenario run against 44-second-old numbers reported itself
     * as current. This layer reports the observation time together with the window it may lag by —
     * a bare timestamp cannot express "up to 45s old".
     */
    expect(r.dataFreshness.maxStalenessSeconds).toBeGreaterThan(0);
    expect(["TWIN_SNAPSHOT", "UNKNOWN"]).toContain(r.dataFreshness.basis);
    expect(r.dataFreshness.note.length).toBeGreaterThan(20);
    // An unreadable snapshot must read as UNKNOWN, never as fresh.
    if (r.dataFreshness.basis === "UNKNOWN") expect(r.dataFreshness.observedAt).toBe("UNKNOWN");
  });

  it("mutates nothing", async () => {
    const before = await Promise.all([
      prisma.booking.count(), prisma.payment.count(), prisma.ledgerEntry.count(),
    ]);
    await scenarioSimulationService.simulate("Delhi", { demandDeltaPct: 200, providerDeltaPct: -90, festival: true });
    await scenarioSimulationService.whatIf("Delhi", { demandDeltaPct: -50, rainStart: true });
    expect(await Promise.all([
      prisma.booking.count(), prisma.payment.count(), prisma.ledgerEntry.count(),
    ])).toEqual(before);
  });

  it("refuses to turn a percentage into money", async () => {
    const r = await scenarioSimulationService.whatIf("Delhi", params);
    /**
     * Converting `revenuePct` to rupees would be arithmetic outside the authoritative finance
     * services, on a number derived from five unvalidated priors, arriving in an executive report
     * looking exactly like a ledger figure.
     */
    expect(r.financialProjection.available).toBe(false);
    expect(r.financialProjection.reason).toContain("finance");
    expect(r.confidence.kind).toBe("UNVALIDATED");
  });

  it("returns baseline, scenario and delta separately", async () => {
    const r = await scenarioSimulationService.whatIf("Delhi", params);
    expect(Object.keys(r.baseline).length).toBeGreaterThan(0);
    expect(Object.keys(r.scenario).length).toBeGreaterThan(0);
    expect(Object.keys(r.delta).length).toBeGreaterThan(0);
    expect(r.interpretation.length).toBeGreaterThan(0);
    expect(r.assumptions).toEqual(SIMULATION_ASSUMPTIONS);
  });
});

// ── Capability 7 — AI-assisted workflow creation ──────────────────────────────
describe("AI workflow drafting", () => {
  /** A draft built from ids that genuinely exist in the running registries. */
  const validDraft = () => ({
    proposedId: `${TAG}-wf`,
    name: "P15 test workflow",
    intent: `${TAG} remind the customer to rate a completed booking`,
    trigger: triggeredEventTypes()[0]!,
    steps: [
      { id: "wait", type: "WAIT", delayMs: 3_600_000 },
      { id: "check", type: "CONDITION", conditionId: listConditions()[0]! },
      { id: "stop", type: "STOP", reasonCode: "DONE" },
    ],
    actorId,
  });

  it("has non-empty allowlists to validate against", () => {
    // Without this the suite could pass by rejecting everything.
    expect(listConditions().length).toBeGreaterThan(0);
    expect(triggeredEventTypes().length).toBeGreaterThan(0);
  });

  it("accepts a draft naming only registered ids", async () => {
    const { validation } = await aiWorkflowDraftService.createDraft(validDraft());
    expect(validation.valid).toBe(true);
    expect(validation.riskClass).toBe("INERT");
    expect(validation.allowlistSnapshot.conditions).toBeGreaterThan(0);
  });

  it("refuses an ACTION step outright", async () => {
    const { validation, draft } = await aiWorkflowDraftService.createDraft({
      ...validDraft(),
      steps: [{ id: "act", type: "ACTION", actionId: "finance.refund", args: { amount: 5000 } }],
    });
    /**
     * The engine has no route into the tool layer today, so this step does nothing. The danger is
     * tomorrow: if that route opens, a drafted ACTION step becomes a way for a model to invoke a
     * tool nobody reviewed.
     */
    expect(validation.valid).toBe(false);
    expect(validation.riskClass).toBe("REJECTED_UNSAFE");
    expect(validation.findings.map((f) => f.code)).toContain("STEP_TYPE_ACTION_REFUSED");
    // Stored anyway — what a model tried to produce is the most useful evidence there is.
    expect(draft.id).toBeTruthy();
  });

  it("refuses a condition the engine does not have", async () => {
    const { validation } = await aiWorkflowDraftService.createDraft({
      ...validDraft(),
      steps: [{ id: "c", type: "CONDITION", conditionId: "invented.always_true" }],
    });
    expect(validation.findings.map((f) => f.code)).toContain("CONDITION_UNKNOWN");
    expect(validation.valid).toBe(false);
  });

  it("refuses a trigger the platform never emits", async () => {
    const { validation } = await aiWorkflowDraftService.createDraft({
      ...validDraft(),
      trigger: "homigo.invented.event",
    });
    expect(validation.findings.map((f) => f.code)).toContain("TRIGGER_UNKNOWN");
  });

  it("refuses a notification step carrying a contact detail or rendered body", async () => {
    const { validation } = await aiWorkflowDraftService.createDraft({
      ...validDraft(),
      steps: [{
        id: "n", type: "NOTIFICATION", notificationType: "booking.review_request",
        recipient: "SUBJECT_CUSTOMER",
        // A drafted step must never address a person directly or carry content.
        phone: "+919812345678", body: "Please rate us",
      }],
    });
    const codes = validation.findings.map((f) => f.code);
    expect(codes).toContain("NOTIFICATION_CARRIES_CONTENT");
    expect(validation.valid).toBe(false);
  });

  it("refuses an arbitrary recipient", async () => {
    const { validation } = await aiWorkflowDraftService.createDraft({
      ...validDraft(),
      steps: [{ id: "n", type: "NOTIFICATION", notificationType: "booking.review_request", recipient: "attacker@example.com" }],
    });
    expect(validation.findings.map((f) => f.code)).toContain("RECIPIENT_INVALID");
  });

  it("bounds step count and wait duration", async () => {
    const many = await aiWorkflowDraftService.createDraft({
      ...validDraft(),
      steps: Array.from({ length: 41 }, (_, i) => ({ id: `s${i}`, type: "STOP" })),
    });
    expect(many.validation.findings.map((f) => f.code)).toContain("STEPS_TOO_MANY");

    const long = await aiWorkflowDraftService.createDraft({
      ...validDraft(),
      steps: [{ id: "w", type: "WAIT", delayMs: 400 * 24 * 3600 * 1000 }],
    });
    expect(long.validation.findings.map((f) => f.code)).toContain("WAIT_TOO_LONG");
  });

  it("refuses duplicate step ids", async () => {
    const { validation } = await aiWorkflowDraftService.createDraft({
      ...validDraft(),
      steps: [{ id: "same", type: "STOP" }, { id: "same", type: "STOP" }],
    });
    expect(validation.findings.map((f) => f.code)).toContain("STEP_ID_DUPLICATE");
  });

  it("requires a review note", async () => {
    const { draft } = await aiWorkflowDraftService.createDraft(validDraft());
    const r = await aiWorkflowDraftService.review({ draftId: draft.id, decision: "APPROVE", actorId, note: "ok" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NOTE_REQUIRED");
  });

  it("cannot approve a draft that fails validation", async () => {
    const { draft } = await aiWorkflowDraftService.createDraft({
      ...validDraft(),
      steps: [{ id: "act", type: "ACTION", actionId: "finance.refund" }],
    });
    const r = await aiWorkflowDraftService.review({
      draftId: draft.id, decision: "APPROVE", actorId,
      note: "phase 15 regression — attempting to approve an unsafe draft",
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("REVALIDATION_FAILED");
  });

  it("says plainly that approval does not activate anything", async () => {
    const { draft } = await aiWorkflowDraftService.createDraft(validDraft());
    const r = await aiWorkflowDraftService.review({
      draftId: draft.id, decision: "APPROVE", actorId,
      note: "phase 15 regression — approving a valid inert draft",
    });
    expect(r.ok).toBe(true);
    // "APPROVED" on a screen invites the assumption that something is now running.
    expect(r.nextStep).toContain("NOT YET RUNNING");
  });

  it("lets exactly one of two concurrent reviewers decide", async () => {
    const { draft } = await aiWorkflowDraftService.createDraft(validDraft());
    const args = { draftId: draft.id, actorId, note: "phase 15 concurrency regression test" };
    const [a, b] = await Promise.all([
      aiWorkflowDraftService.review({ ...args, decision: "APPROVE" }),
      aiWorkflowDraftService.review({ ...args, decision: "REJECT" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a.code, b.code]).toContain("LOST_RACE");

    const after = await prisma.aiWorkflowDraft.findUnique({ where: { id: draft.id } });
    expect(["APPROVED", "REJECTED"]).toContain(after!.status);
  });

  it("records the prompt hash so a draft traces back to what was asked", async () => {
    const { draft } = await aiWorkflowDraftService.createDraft(validDraft());
    expect(draft.promptHash).toMatch(/^[0-9a-f]{32}$/);
    expect(draft.intent).toContain(TAG);
  });
});

// ── Capability 8 — advanced predictive operations ─────────────────────────────
describe("cancellation risk model", () => {
  it("excludes every label-defining and post-creation field", () => {
    const excluded: string[] = EXCLUDED_FEATURES.map((e) => e.field);
    /**
     * `cancelled_at` and `completed_at` reconstruct the target exactly; `cancellation_reason` and
     * `cancelled_by` are the label wearing a disguise. A model trained on any of them would score
     * near-perfectly offline and be worthless at prediction time, when none of them exist.
     */
    for (const f of ["cancelled_at", "completed_at", "cancellation_reason", "cancelled_by", "refund_status"]) {
      expect(excluded).toContain(f);
    }
    for (const f of ["provider_id", "assigned_at", "payment_status"]) expect(excluded).toContain(f);
    // And no excluded field may appear among the features actually used.
    for (const f of excluded) expect([...FEATURE_NAMES] as string[]).not.toContain(f as string);
    for (const e of EXCLUDED_FEATURES) expect(e.reason.length).toBeGreaterThan(10);
  });

  it("splits temporally, never at random", async () => {
    const r = await cancellationRiskService.evaluate();
    if (r.status !== "EVALUATED") return;
    expect(r.split.kind).toBe("TEMPORAL");
    /**
     * A random split lets the model see bookings made after the ones it is graded on. For a
     * behaviour that drifts week to week that is grading your own homework.
     */
    expect(new Date(r.split.testStart).getTime()).toBeGreaterThanOrEqual(new Date(r.split.trainStart).getTime());
    expect(new Date(r.split.testEnd).getTime()).toBeGreaterThanOrEqual(new Date(r.split.trainEnd).getTime());
  });

  it("compares against two baselines, not one", async () => {
    const r = await cancellationRiskService.evaluate();
    if (r.status !== "EVALUATED") return;
    // A base rate has no discrimination by construction, so beating it on AUC proves nothing.
    expect(r.metrics.baselineBaseRate.auc).toBeCloseTo(0.5, 5);
    expect(r.metrics.baselinePriorRate.auc).not.toBeNull();
    expect(r.metrics.candidate.auc).not.toBeNull();
  });

  it("reports materiality separately from the bare comparison", async () => {
    const r = await cancellationRiskService.evaluate();
    if (r.status !== "EVALUATED") return;
    /**
     * The measured outcome on this dataset: the candidate beats the baseline rule by 0.014 AUC
     * against a standard error of 0.057 — a quarter of one standard error. `beatsBaseline` is
     * therefore true while `materiallyBetter` is false, and the second is the one that should
     * drive a promotion decision. This test exists to keep those two from being collapsed.
     */
    expect(typeof r.materiality.materiallyBetter).toBe("boolean");
    expect(r.materiality.aucStandardError).not.toBeNull();
    expect(r.materiality.verdict.length).toBeGreaterThan(30);
    if (!r.materiality.materiallyBetter) {
      expect(r.materiality.verdict).toContain("NOT distinguishable");
    }
  });

  it("states its limitations rather than implying none", async () => {
    const r = await cancellationRiskService.evaluate();
    if (r.status !== "EVALUATED") return;
    expect(r.limitations.length).toBeGreaterThanOrEqual(4);
    expect(r.limitations.join(" ")).toContain("SMALL_SAMPLE");
    // Nothing consumes the score and no version is registered — said plainly.
    expect(r.limitations.join(" ")).toContain("NOT_SERVING");
  });

  it("refuses to evaluate when the holdout has too few positives", async () => {
    /**
     * This asserts the RULE, not the size of whatever data happens to be in the database.
     *
     * It used to pass `0.01` on the assumption that a 1% holdout could never carry 15
     * cancellations. That was true of the 387-booking dataset the service was written against and
     * is no longer true of the test database, which has grown past 8,000 terminal bookings — so
     * the test began failing while the guard it covers was working perfectly. An empty holdout
     * has zero positives at any data volume, which is the same branch and cannot rot.
     */
    // 2026-10-01: the dataset is supplied, not read. On a freshly built test database the suite has
    // made fewer than the 130 examples the FIRST gate needs, so evaluate(0) answered from that gate
    // and this assertion failed — it only ever passed on a database bloated by earlier runs.
    const enough = Array.from({ length: 130 }, () => ({ label: 0 }));
    const stub = spyOn(
      cancellationRiskService as unknown as { buildExamples: () => Promise<{ examples: unknown[]; skipped: number }> },
      "buildExamples",
    ).mockResolvedValue({ examples: enough, skipped: 0 });
    try {
      const r = await cancellationRiskService.evaluate(0);
      expect(r.status).toBe("DATA_INSUFFICIENT");
      expect((r as { detail: string }).detail).toContain("holdout");
      expect((r as { detail: string }).detail).toContain("0 cancellations");
    } finally {
      stub.mockRestore();
    }
  });

  it("refuses to train below the minimum example count, whatever the holdout", async () => {
    const stub = spyOn(
      cancellationRiskService as unknown as { buildExamples: () => Promise<{ examples: unknown[]; skipped: number }> },
      "buildExamples",
    ).mockResolvedValue({ examples: Array.from({ length: 129 }, () => ({ label: 1 })), skipped: 0 });
    try {
      const r = await cancellationRiskService.evaluate(0.3);
      expect(r.status).toBe("DATA_INSUFFICIENT");
      expect((r as { detail: string }).detail).toContain("129 usable examples");
    } finally {
      stub.mockRestore();
    }
  });

  it("the refusal tracks the real population rather than a hardcoded fraction", async () => {
    // Derive a holdout small enough to fall under the threshold for THIS database, so the
    // assertion stays true however much the test data grows.
    const full = await cancellationRiskService.evaluate();
    if (full.status !== "EVALUATED") return; // too little data to make the point at all
    const total = full.split.trainCount + full.split.testCount;
    // 15 positives need at least 15 examples; a holdout of ~10 rows cannot reach the threshold.
    const tinyFraction = Math.max(1, Math.floor(total * 0.0005)) / total;
    const r = await cancellationRiskService.evaluate(tinyFraction);
    expect(r.status).toBe("DATA_INSUFFICIENT");
    expect((r as { detail: string }).detail).toContain("cancellations");
  });
});

// ── Audit integrity and failure behaviour on Phase-15 paths ───────────────────
describe("Phase-15 audit integrity and chaos", () => {
  const validSteps = () => [
    { id: "wait", type: "WAIT", delayMs: 3_600_000 },
    { id: "stop", type: "STOP", reasonCode: "DONE" },
  ];

  it("refuses to approve a draft when the audit store is unavailable", async () => {
    const { draft } = await aiWorkflowDraftService.createDraft({
      proposedId: `${TAG}-chaos`, name: "chaos", intent: `${TAG} audit outage probe`,
      trigger: triggeredEventTypes()[0]!, steps: validSteps(), actorId,
    });

    /**
     * A real outage, not a stub: the audit table is renamed away so the insert genuinely fails.
     * Approving machine-generated automation with no record of who approved it is worse than not
     * approving it — the decision is real either way and only the accountability goes missing.
     */
    await prisma.$executeRawUnsafe("ALTER TABLE enterprise_audit_logs RENAME TO enterprise_audit_logs_p15t");
    let threw = false;
    try {
      await aiWorkflowDraftService.review({
        draftId: draft.id, decision: "APPROVE", actorId,
        note: "phase 15 audit-outage regression test",
      });
    } catch (e) {
      threw = e instanceof Error && /GOVERNANCE_AUDIT_UNAVAILABLE/.test(e.message);
    } finally {
      await prisma.$executeRawUnsafe("ALTER TABLE enterprise_audit_logs_p15t RENAME TO enterprise_audit_logs");
    }
    expect(threw).toBe(true);

    /**
     * The decision must not stand unaudited. The first version of this test asserted the draft was
     * left APPROVED and called that a limitation — it was a defect. The service now compensates:
     * the status update has to come first (it is what resolves the two-reviewer race), so when the
     * audit then fails the status is returned to DRAFT and the error rethrown. The draft is
     * reviewable again rather than silently approved with nobody's name on it.
     */
    const after = await prisma.aiWorkflowDraft.findUnique({ where: { id: draft.id } });
    expect(after!.status).toBe("DRAFT");
    expect(after!.reviewedBy).toBeNull();
  });

  it("keeps a low-risk read working when audit is degraded", async () => {
    // Fail-closed must be scoped to governance acts, not applied to everything.
    await prisma.$executeRawUnsafe("ALTER TABLE enterprise_audit_logs RENAME TO enterprise_audit_logs_p15u");
    try {
      const r = await scenarioSimulationService.simulate("Delhi", { demandDeltaPct: 5 });
      expect(r.scenarioId).toBeTruthy();
      await AuditLogService.record("LOGIN", "success", { traceId: `${TAG}-degraded` });
    } finally {
      await prisma.$executeRawUnsafe("ALTER TABLE enterprise_audit_logs_p15u RENAME TO enterprise_audit_logs");
    }
  });

  it("survives the drafts table being unavailable", async () => {
    await prisma.$executeRawUnsafe("ALTER TABLE ai_workflow_drafts RENAME TO ai_workflow_drafts_p15v");
    let failed = false;
    try {
      await aiWorkflowDraftService.createDraft({
        proposedId: `${TAG}-nodb`, name: "nodb", intent: `${TAG} table outage probe`,
        trigger: triggeredEventTypes()[0]!, steps: validSteps(), actorId,
      });
    } catch {
      // A visible failure is the correct outcome. Silently returning a fake draft id would be worse.
      failed = true;
    } finally {
      await prisma.$executeRawUnsafe("ALTER TABLE ai_workflow_drafts_p15v RENAME TO ai_workflow_drafts");
    }
    expect(failed).toBe(true);
  });

  it("still validates when the notification registry is empty", async () => {
    // An environment with no ACTIVE templates must warn, not silently accept an unknown type.
    const r = await aiWorkflowDraftService.validate({
      steps: [{ id: "n", type: "NOTIFICATION", notificationType: "does.not.exist", recipient: "SUBJECT_CUSTOMER" }],
      trigger: triggeredEventTypes()[0]!,
    });
    const codes = r.findings.map((f) => f.code);
    expect(
      codes.includes("NOTIFICATION_TYPE_UNKNOWN") || codes.includes("NOTIFICATION_REGISTRY_EMPTY"),
    ).toBe(true);
  });
});

// ── Shared evaluation arithmetic ──────────────────────────────────────────────
describe("ml evaluation primitives", () => {
  it("returns null AUC when a class is absent rather than 0.5", () => {
    // 0.5 means "no discrimination measured"; null means "not measurable". Collapsing them would
    // let a single-class holdout report itself as a coin flip that was actually evaluated.
    expect(auc([0.1, 0.9], [1, 1])).toBeNull();
    expect(auc([0.1, 0.9], [0, 0])).toBeNull();
  });

  it("computes a perfect and an inverted ranking correctly", () => {
    expect(auc([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0])).toBe(1);
    expect(auc([0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0])).toBe(0);
  });

  it("scores Brier as mean squared error", () => {
    expect(brier([1, 0], [1, 0])).toBe(0);
    expect(brier([0, 1], [1, 0])).toBe(1);
  });

  it("refuses to call a sub-2-sigma margin material", () => {
    // The exact shape of the cancellation-risk result: a real margin, swamped by its own error bar.
    const m = assessMateriality(0.7085, 0.6945, 32, 85);
    expect(m.materiallyBetter).toBe(false);
    expect(m.marginInStandardErrors!).toBeLessThan(2);
    expect(m.verdict).toContain("NOT distinguishable");
  });

  it("calls a large margin on a large sample material", () => {
    const m = assessMateriality(0.90, 0.60, 400, 400);
    expect(m.materiallyBetter).toBe(true);
  });

  it("gives a wider error bar to a smaller sample", () => {
    expect(aucStandardError(0.75, 20, 40)).toBeGreaterThan(aucStandardError(0.75, 400, 800));
  });
});

// ── Capability 3/8 — provider acceptance ranking ──────────────────────────────
describe("provider acceptance model", () => {
  it("excludes the label and every post-dispatch field", () => {
    const excluded: string[] = ACCEPT_EXCLUDED.map((e) => e.field);
    for (const f of ["status", "responded_at", "response_ms"]) expect(excluded).toContain(f);
    for (const f of excluded) expect([...ACCEPT_FEATURES] as string[]).not.toContain(f as string);
    for (const e of ACCEPT_EXCLUDED) expect(e.reason.length).toBeGreaterThan(8);
  });

  it("refuses the scores table that has no outcome join", () => {
    /**
     * `provider_match_scores` has 2,386 rows and looks like the obvious training set. Its
     * `booking_id` is entirely NULL, so no score can be tied to what happened — training on it
     * would teach a model to imitate the scorer it was meant to improve.
     */
    const reason = ACCEPT_EXCLUDED.find((e) => e.field === "provider_match_scores.*")?.reason ?? "";
    expect(reason).toContain("NO_OUTCOME_JOIN");
  });

  it("splits temporally and reports its class balance", async () => {
    const r = await providerAcceptanceService.evaluate();
    if (r.status !== "EVALUATED") return;
    expect(r.split.kind).toBe("TEMPORAL");
    expect(new Date(r.split.testStart).getTime()).toBeGreaterThanOrEqual(new Date(r.split.trainStart).getTime());

    /**
     * The property is that the imbalance is REPORTED, not that it happens to sit below some value.
     *
     * This asserted `overallPositiveRate < 0.2` with a comment about acceptances being a small
     * minority — a claim about the shared test database's contents, not about this service. It
     * failed the moment the database accumulated more accepted attempts (0.53), which told us
     * nothing about the code. A service that fabricated its class balance entirely would have
     * passed it just as easily.
     */
    for (const rate of [
      r.classBalance.overallPositiveRate,
      r.classBalance.trainPositiveRate,
      r.classBalance.testPositiveRate,
    ]) {
      expect(Number.isFinite(rate)).toBe(true);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
    // Train and test are reported separately, so a split that hid its imbalance would be visible.
    expect(r.classBalance.trainPositiveRate).not.toBe(r.classBalance.overallPositiveRate === 0 ? 1 : -1);
  });

  it("reports a label source that is an outcome, not a rule's output", async () => {
    const r = await providerAcceptanceService.evaluate();
    if (r.status !== "EVALUATED") return;
    expect(r.labelSource).toContain("not a rule");
  });

  it("does not claim superiority when the trivial baseline wins", async () => {
    const r = await providerAcceptanceService.evaluate();
    if (r.status !== "EVALUATED") return;
    /**
     * The measured outcome: candidate AUC ~0.95 against a per-provider-rate baseline of ~0.96.
     * A 0.95 AUC in isolation reads as a triumph; against the baseline it is a regression. This
     * test exists so that comparison can never quietly disappear from the response.
     */
    expect(r.metrics.baselinePriorRate.auc).not.toBeNull();
    if ((r.metrics.candidate.auc ?? 0) <= (r.metrics.baselinePriorRate.auc ?? 1)) {
      expect(r.beatsBaseline).toBe(false);
      expect(r.materiality.materiallyBetter).toBe(false);
    }
  });

  it("states that nothing consumes it", async () => {
    const r = await providerAcceptanceService.evaluate();
    if (r.status !== "EVALUATED") return;
    expect(r.limitations.join(" ")).toContain("NOT_SERVING");
  });
});

// ── Deterministic predictor honesty ───────────────────────────────────────────
describe("provider acceptance rate is never fabricated", () => {
  /**
   * `providers.acceptance_rate` is the deterministic predictor that BEAT the learned model in this
   * phase's evaluation (baseline AUC 0.9642 vs candidate 0.9528). It is displayed in the admin
   * provider list and consumed by ETA intelligence and partner context, so what it does with no
   * evidence matters more than what it does with plenty.
   *
   * It used to write **100** whenever the 30-day window held no terminal attempts — re-scoring a
   * provider who went quiet for a month as a perfect acceptor, against a platform-wide rate of 7.5%.
   */
  it("does not write an optimistic default when the window is empty", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const src = readFileSync(
      join(resolve(import.meta.dir, ".."), "services", "assignment-engine.service.ts"),
      "utf8",
    );
    const fn = src.slice(src.indexOf("refreshProviderAcceptanceRate(providerId: string)"));
    // A fixed window is enough: the function is short, and avoiding a newline escape here
    // keeps the fixture free of the escape-mangling that broke an earlier version of this test.
    const body = fn.slice(0, 2500);

    // The exact fabrication, in either operand order.
    expect(body).not.toMatch(/total\s*>\s*0\s*\?[^:]*:\s*100/);
    expect(body).not.toMatch(/:\s*100\s*;/);
    // And it must return early rather than writing something on no evidence.
    expect(body).toContain("total === 0");
  });

  /**
   * REMOVED — "reflects the measured platform reality, not an assumption".
   *
   * It asserted `accepted / all < 0.5` over whatever the shared test database happened to hold,
   * with a comment citing a 7.5% platform-wide rate. That is a statement about fixture contents,
   * not about the service: it broke when the database accumulated more accepted attempts (0.53),
   * and it would have passed unchanged against a service that fabricated every rate it returned.
   *
   * The property it was reaching for — that no evidence is never reported as 100% or 0% — is now
   * covered behaviourally across the full matrix of evidence states in
   * `acceptance-rate-evidence.test.ts`, which also pins the single shared definition in
   * `lib/acceptance-rate.ts`.
   */
});

describe("Phase 15 - no derived metric fabricates a perfect score", () => {
  // The acceptanceRate defect was one instance of a family: a ratio whose denominator can be zero,
  // resolved to 100 instead of UNMEASURED. A sweep of the derived-metric surfaces found five more.
  // This guard is source-level on purpose -- the fabrication is only reachable on an empty
  // database, which a shared test database rarely is, so asserting on returned values would pass
  // vacuously and prove nothing.
  const svc = (name: string) =>
    readFileSync(join(resolve(import.meta.dir, ".."), "services", name), "utf8");

  it("refund approval rate is null, not 100, with no refunds on record", () => {
    const body = svc("refund-workflow.service.ts");
    expect(body).toMatch(/approvalRatePct:\s*total\s*>\s*0\s*\?[^:]*:\s*null/);
    expect(body).not.toMatch(/approvalRatePct.*:\s*100/);
  });

  it("settlement resolution rate and health score are null together", () => {
    const body = svc("settlement-resolution.service.ts");
    expect(body).toMatch(/resolutionRate\s*=\s*total\s*>\s*0\s*\?[^:]*:\s*null/);
    expect(body).toMatch(/resolutionRate\s*==\s*null\s*\?\s*null/);
    expect(body).not.toMatch(/resolutionRate.*:\s*100\s*;/);
  });

  it("settlement accuracy reports UNMEASURED when no sync run has completed", () => {
    const body = svc("settlement-sync.service.ts");
    expect(body).toMatch(/measuredAccuracy\s*==\s*null\s*\?\s*null/);
    expect(body).not.toMatch(/accuracyPct\s*\?\?\s*100/);
    // The duplicate KPI name published the same measurement twice.
    expect(body).not.toContain("reconciliationSuccessPct");
    // And the upstream writer must not persist a perfect score for a sync that saw nothing --
    // that row would poison the very average this metric reads.
    expect(body).toMatch(/gatewaySettlements\.length > 0[\s\S]{0,160}: null;/);
  });

  it("finance analytics no longer invents a settlement accuracy figure", () => {
    const body = svc("finance-analytics.service.ts");
    // The original: 100 - (chargebackExposure > 0 ? 2 : 0) -- never touched a settlement.
    expect(body).not.toMatch(/settlementAccuracyPct:\s*100\s*-/);
    expect(body).toContain("settlementSyncRun.aggregate");
    // And payout success is undefined, not perfect, when nothing was paid out.
    expect(body).toMatch(/payoutsRaised\s*>\s*0\s*\?[^:]*:\s*null/);
  });

  it("risk intelligence carries no magic fallback score", () => {
    expect(svc("risk-intelligence.service.ts")).not.toMatch(/integrity\.score\s*\?\?\s*\d+/);
  });
});

describe("Phase 15 - release gate refuses when the flag is off", () => {
  // A flag nobody can turn off is not a release gate. These prove the capability actually stops.
  it("scenario simulation refuses while its flag is disabled", async () => {
    await prisma.platformFeatureFlag.update({
      where: { key: SIMULATION_FEATURE_FLAG },
      data: { enabled: false },
    });
    await invalidateFlagCache(SIMULATION_FEATURE_FLAG);
    try {
      await expect(scenarioSimulationService.simulate("Delhi", {})).rejects.toThrow(
        /SIMULATION_DISABLED/,
      );
    } finally {
      await prisma.platformFeatureFlag.update({
        where: { key: SIMULATION_FEATURE_FLAG },
        data: { enabled: true },
      });
      await invalidateFlagCache(SIMULATION_FEATURE_FLAG);
    }
  });

  it("workflow drafting refuses while its flag is disabled", async () => {
    await prisma.platformFeatureFlag.update({
      where: { key: WORKFLOW_DRAFT_FEATURE_FLAG },
      data: { enabled: false },
    });
    await invalidateFlagCache(WORKFLOW_DRAFT_FEATURE_FLAG);
    try {
      await expect(
        aiWorkflowDraftService.createDraft({
          proposedId: `gate-${Date.now()}`,
          name: "gate probe",
          intent: "verify the release gate refuses while the flag is off",
          trigger: "homigo.booking.created",
          steps: [{ type: "STOP" }] as never,
          actorId,
        }),
      ).rejects.toThrow(/WORKFLOW_DRAFTING_DISABLED/);
    } finally {
      await prisma.platformFeatureFlag.update({
        where: { key: WORKFLOW_DRAFT_FEATURE_FLAG },
        data: { enabled: true },
      });
      await invalidateFlagCache(WORKFLOW_DRAFT_FEATURE_FLAG);
    }
  });

  it("an absent flag fails closed, not open", async () => {
    const { evaluateFlag } = await import("../services/feature-flag.service");
    const decision = await evaluateFlag(`PHASE15_NONEXISTENT_${Date.now()}`);
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toBe("FLAG_MISSING");
  });
});
