/**
 * Phase 10 §10 — the quality verdict: pure rules and structural wiring.
 *
 * The verdict is a pure function over durable facts (frozen policy, evidence rows, step state, safety
 * gate). Nothing the client claims is an input — there is no parameter for `checklistComplete`, and the
 * route discards it. The structural half pins the things a refactor could quietly undo: the migration
 * stays additive and append-only, every completion template variable is declared, the auto-confirm
 * sweep is registered behind the autonomous gate and cleared on stop, and the confirmation window a
 * service configures is frozen into the booking rather than read from the catalogue.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  customerVerdictView,
  deriveQualityVerdict,
  QUALITY_REASON_CODES,
  QUALITY_VERDICT_BLOCKED,
  QualityVerdictError,
  verdictAllowsCompletion,
  worstVerdict,
  type DeriveVerdictInput,
  type VerdictStep,
} from "../lib/quality-verdict";
import type { QualitySnapshot } from "../lib/service-runtime-policy";
import { qualityFromSnapshot, qualitySnapshot } from "../lib/service-runtime-policy";
import { serviceCatalogConfigSchema } from "../lib/service-catalog-config";
import { evaluateExecutionGate, type StepRow } from "../lib/service-execution";
import { evaluateSafetyGate } from "../lib/service-safety";
import { confirmationWindowHours, DEFAULT_CONFIRMATION_WINDOW_HOURS } from "../services/booking-completion.service";
import { BOOKING_COMPLETION_TEMPLATES } from "../notifications/templates/definitions";

const BACKEND = resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");

const policy = (over: Partial<QualitySnapshot> = {}): QualitySnapshot => ({
  proofRequired: false, beforeAfterPhotos: false, checklist: [], notApplicable: false, warrantyDays: 0, customerConfirmation: false, ...over,
});
const evidence = (over: Partial<NonNullable<DeriveVerdictInput["evidence"]>> = {}): NonNullable<DeriveVerdictInput["evidence"]> => ({
  photos: 0, hasBefore: false, hasAfter: false, checklistComplete: true, missingChecklistItems: [], evidenceIds: [], ...over,
});
const step = (code: string, state: VerdictStep["state"], mandatory = true): VerdictStep => ({ code, state, mandatory });
const row = (code: string, state: StepRow["state"], mandatory = true, n = 1): StepRow => ({
  code, stepNumber: n, mandatory, skipPolicy: mandatory ? "NOT_SKIPPABLE" : "SKIP_WITH_REASON", evidence: "NONE", dependsOn: [], safetyRequirement: null, state, version: 1,
});
const input = (over: Partial<DeriveVerdictInput> = {}): DeriveVerdictInput => ({
  qualityPolicy: null, evidence: null, executionSteps: [], executionGate: null, safetyGate: null, openIncidents: [], ...over,
});

describe("derive — most severe wins, every applicable code is reported", () => {
  test("policy satisfied + every mandatory step COMPLETED → PASS with no reason codes", () => {
    const v = deriveQualityVerdict(input({
      qualityPolicy: policy({ checklist: ["Wipe"], proofRequired: true, beforeAfterPhotos: true }),
      evidence: evidence({ photos: 2, hasBefore: true, hasAfter: true, evidenceIds: ["e1", "e2"] }),
      executionSteps: [step("work", "COMPLETED")],
      executionGate: evaluateExecutionGate([row("work", "COMPLETED")]),
      safetyGate: evaluateSafetyGate([], []),
    }));
    expect(v.verdict).toBe("PASS");
    expect(v.reasonCodes).toEqual([]);
    expect(v.evidenceRefs).toEqual({ evidenceIds: ["e1", "e2"], steps: [{ code: "work", state: "COMPLETED", mandatory: true }], holdIds: [], incidentIds: [], missingChecklistItems: [] });
    expect(verdictAllowsCompletion(v.verdict)).toBe(true);
  });

  test("an optional step SKIPPED_WITH_REASON (nothing worse) → PASS_WITH_EXCEPTION, which still allows completion", () => {
    const v = deriveQualityVerdict(input({
      executionSteps: [step("work", "COMPLETED"), step("tidy", "SKIPPED_WITH_REASON", false)],
      executionGate: evaluateExecutionGate([row("work", "COMPLETED"), row("tidy", "SKIPPED_WITH_REASON", false, 2)]),
    }));
    expect(v.verdict).toBe("PASS_WITH_EXCEPTION");
    expect(v.reasonCodes).toEqual(["EXECUTION_STEP_SKIPPED"]);
    expect(verdictAllowsCompletion("PASS_WITH_EXCEPTION")).toBe(true);
  });

  test("the exception never softens a worse verdict: a skipped optional step beside a missing mandatory one is REWORK_REQUIRED", () => {
    const v = deriveQualityVerdict(input({ executionSteps: [step("work", "PENDING"), step("tidy", "SKIPPED_WITH_REASON", false)] }));
    expect(v.verdict).toBe("REWORK_REQUIRED");
    expect(v.reasonCodes).toEqual(["EXECUTION_STEP_INCOMPLETE"]);
  });

  test("a FAILED mandatory step → REWORK_REQUIRED / EXECUTION_STEP_FAILED (no policy says a failed step is final)", () => {
    const v = deriveQualityVerdict(input({ executionSteps: [step("work", "FAILED")], executionGate: evaluateExecutionGate([row("work", "FAILED")]) }));
    expect(v.verdict).toBe("REWORK_REQUIRED");
    expect(v.reasonCodes).toEqual(["EXECUTION_STEP_FAILED"]);
    expect(verdictAllowsCompletion(v.verdict)).toBe(false);
  });

  test("a mandatory step not COMPLETED (PENDING / IN_PROGRESS) → REWORK_REQUIRED / EXECUTION_STEP_INCOMPLETE", () => {
    for (const state of ["PENDING", "IN_PROGRESS"] as const) {
      const v = deriveQualityVerdict(input({ executionSteps: [step("work", state)], executionGate: evaluateExecutionGate([row("work", state)]) }));
      expect(v.verdict).toBe("REWORK_REQUIRED");
      expect(v.reasonCodes).toEqual(["EXECUTION_STEP_INCOMPLETE"]);
    }
    // An optional step left PENDING is not a defect.
    expect(deriveQualityVerdict(input({ executionSteps: [step("tidy", "PENDING", false)] })).verdict).toBe("PASS");
  });

  test("missing proof → REWORK_REQUIRED / QUALITY_PROOF_REQUIRED (either half of before/after, or no photo at all)", () => {
    const none = deriveQualityVerdict(input({ qualityPolicy: policy({ proofRequired: true }), evidence: evidence({ photos: 0 }) }));
    expect(none.verdict).toBe("REWORK_REQUIRED");
    expect(none.reasonCodes).toEqual(["QUALITY_PROOF_REQUIRED"]);
    const afterOnly = deriveQualityVerdict(input({ qualityPolicy: policy({ beforeAfterPhotos: true }), evidence: evidence({ photos: 1, hasAfter: true }) }));
    expect(afterOnly.verdict).toBe("REWORK_REQUIRED");
    expect(afterOnly.reasonCodes).toEqual(["QUALITY_PROOF_REQUIRED"]);
    // No evidence object at all with a proof policy is the same refusal, never a crash.
    expect(deriveQualityVerdict(input({ qualityPolicy: policy({ proofRequired: true }), evidence: null })).reasonCodes).toEqual(["QUALITY_PROOF_REQUIRED"]);
  });

  test("a frozen checklist item not submitted → REWORK_REQUIRED / QUALITY_CHECKLIST_REQUIRED, naming what is missing", () => {
    const v = deriveQualityVerdict(input({
      qualityPolicy: policy({ checklist: ["Wipe surfaces", "Mop floor"] }),
      evidence: evidence({ checklistComplete: false, missingChecklistItems: ["Mop floor"] }),
    }));
    expect(v.verdict).toBe("REWORK_REQUIRED");
    expect(v.reasonCodes).toEqual(["QUALITY_CHECKLIST_REQUIRED"]);
    expect(v.evidenceRefs.missingChecklistItems).toEqual(["Mop floor"]);
    // No evidence object: every frozen item is missing.
    expect(deriveQualityVerdict(input({ qualityPolicy: policy({ checklist: ["A", "B"] }), evidence: null })).evidenceRefs.missingChecklistItems).toEqual(["A", "B"]);
  });

  test("an ACTIVE safety hold → ESCALATED / SAFETY_HOLD_ACTIVE with the hold id in the evidence refs", () => {
    const gate = evaluateSafetyGate([{ id: 7, condition: "Gas smell", source: "PARTNER", state: "ACTIVE", incidentId: null }], []);
    const v = deriveQualityVerdict(input({ safetyGate: gate, executionSteps: [step("work", "COMPLETED")] }));
    expect(v.verdict).toBe("ESCALATED");
    expect(v.reasonCodes).toEqual(["SAFETY_HOLD_ACTIVE"]);
    expect(v.evidenceRefs.holdIds).toEqual([7]);
    expect(verdictAllowsCompletion(v.verdict)).toBe(false);
  });

  test("an open safety incident → ESCALATED / SAFETY_INCIDENT_OPEN (reported once even when the gate lists it too)", () => {
    const inc = { id: "inc-1", type: "LOCATION_DANGER", status: "OPEN" };
    const v = deriveQualityVerdict(input({ safetyGate: evaluateSafetyGate([], [inc]), openIncidents: [inc] }));
    expect(v.verdict).toBe("ESCALATED");
    expect(v.reasonCodes).toEqual(["SAFETY_INCIDENT_OPEN"]);
    expect(v.evidenceRefs.incidentIds).toEqual(["inc-1"]);
  });

  test("an ESCALATED step → ESCALATED / EXECUTION_STEP_ESCALATED; every other applicable code is still listed", () => {
    const v = deriveQualityVerdict(input({
      qualityPolicy: policy({ proofRequired: true }),
      evidence: evidence({ photos: 0 }),
      executionSteps: [step("work", "ESCALATED"), step("prep", "PENDING")],
      executionGate: evaluateExecutionGate([row("work", "ESCALATED"), row("prep", "PENDING", true, 2)]),
    }));
    expect(v.verdict).toBe("ESCALATED");
    expect(v.reasonCodes).toEqual(["EXECUTION_STEP_ESCALATED", "EXECUTION_STEP_INCOMPLETE", "QUALITY_PROOF_REQUIRED"]);
  });

  test("severity order: FAILED > ESCALATED > REWORK_REQUIRED > PASS_WITH_EXCEPTION > PASS", () => {
    expect(worstVerdict("PASS", "PASS_WITH_EXCEPTION")).toBe("PASS_WITH_EXCEPTION");
    expect(worstVerdict("PASS_WITH_EXCEPTION", "REWORK_REQUIRED")).toBe("REWORK_REQUIRED");
    expect(worstVerdict("REWORK_REQUIRED", "ESCALATED")).toBe("ESCALATED");
    expect(worstVerdict("ESCALATED", "FAILED")).toBe("FAILED");
    expect(worstVerdict("FAILED", "PASS")).toBe("FAILED");
    expect(["REWORK_REQUIRED", "FAILED", "ESCALATED"].map((v) => verdictAllowsCompletion(v as never))).toEqual([false, false, false]);
  });

  test("NO_QUALITY_POLICY honesty: no policy and no plan is PASS that says nothing was checked; a plan alone is a real PASS", () => {
    const nothing = deriveQualityVerdict(input());
    expect(nothing.verdict).toBe("PASS");
    expect(nothing.reasonCodes).toEqual(["NO_QUALITY_POLICY"]);
    const planOnly = deriveQualityVerdict(input({ executionSteps: [step("work", "COMPLETED")] }));
    expect(planOnly.reasonCodes).toEqual([]);
    const policyOnly = deriveQualityVerdict(input({ qualityPolicy: policy({ checklist: ["Wipe"] }), evidence: evidence() }));
    expect(policyOnly.reasonCodes).toEqual([]);
  });

  test("every reason code the derivation can emit is in the published list", () => {
    const emitted = ["SAFETY_HOLD_ACTIVE", "SAFETY_INCIDENT_OPEN", "EXECUTION_STEP_ESCALATED", "EXECUTION_STEP_FAILED", "QUALITY_PROOF_REQUIRED", "QUALITY_CHECKLIST_REQUIRED", "EXECUTION_STEP_INCOMPLETE", "EXECUTION_STEP_SKIPPED", "NO_QUALITY_POLICY", "ADMIN_OVERRIDE"];
    for (const c of emitted) expect(QUALITY_REASON_CODES as readonly string[]).toContain(c);
  });
});

describe("the client's checklistComplete is never an input", () => {
  test("the derivation has no parameter for it, and the input type does not carry it", () => {
    // Type-level: an input object with the forged key does not type-check as DeriveVerdictInput.
    // @ts-expect-error — checklistComplete is not a derivation input
    const forged: DeriveVerdictInput = { ...input({ qualityPolicy: policy({ checklist: ["Wipe"] }), evidence: null }), checklistComplete: true };
    const v = deriveQualityVerdict(forged);
    expect(v.verdict).toBe("REWORK_REQUIRED");
    expect(v.reasonCodes).toEqual(["QUALITY_CHECKLIST_REQUIRED"]);
    const src = read("src/lib/quality-verdict.ts");
    // The only mention is the evidence field produced by the item-by-item resolver, never a top-level input.
    expect(src).not.toMatch(/opts\??\.checklistComplete|input\.checklistComplete/);
  });

  test("the completion route discards checklistComplete and the service never reads it", () => {
    const route = read("src/routes/bookings.ts");
    expect(route).toContain("void (raw as { checklistComplete?: unknown })?.checklistComplete;");
    const svc = read("src/services/booking.service.ts");
    // complete() declares no such option and no code path reads one (the only mention is a comment, in backticks).
    expect(svc).not.toMatch(/checklistComplete\??:\s*boolean/);
    expect(svc).not.toMatch(/[^`]opts\??\.checklistComplete/);
    const quality = read("src/services/booking-quality.service.ts");
    // The verdict service takes `completedChecklist` (matched item by item) and the professional's
    // attestation, which is asked for only where the frozen policy requires it and never replaces
    // proof (p11-profile-gates.test.ts). It never takes the checklist boolean.
    expect(quality).not.toMatch(/opts\??\.checklistComplete/);
    expect(quality).not.toMatch(/checklistComplete\??:\s*boolean/);
    expect(quality).toContain("export type CompletionSubmission = { completedChecklist?: readonly string[]; professionalConfirmed?: boolean };");
  });
});

describe("customer projection — plain words, no internals", () => {
  test("a blocking verdict shows a label and reasons in plain words; codes, ids and admin identity never appear", () => {
    const v = customerVerdictView({ verdict: "REWORK_REQUIRED", reasonCodes: ["QUALITY_PROOF_REQUIRED", "EXECUTION_STEP_INCOMPLETE", "ADMIN_OVERRIDE", "NO_QUALITY_POLICY"], createdAt: new Date("2026-09-26T10:00:00Z") });
    expect(v.verdict).toBe("REWORK_REQUIRED");
    expect(v.reasons).toEqual(["Completion photos are still pending", "Some required steps are not finished yet", "Reviewed by our team"]);
    const text = JSON.stringify(v);
    for (const leak of ["QUALITY_PROOF_REQUIRED", "EXECUTION_STEP", "evidenceIds", "holdIds", "NO_QUALITY_POLICY"]) expect(text).not.toContain(leak);
    expect(v.at).toBe("2026-09-26T10:00:00.000Z");
  });

  test("QualityVerdictError carries the blocked code the route maps to 409", () => {
    const e = new QualityVerdictError({ verdict: "ESCALATED", reasonCodes: ["SAFETY_HOLD_ACTIVE"] });
    expect(e.code).toBe(QUALITY_VERDICT_BLOCKED);
    expect(e.message).toBe("QUALITY_VERDICT_BLOCKED");
    expect(e.data.verdict).toBe("ESCALATED");
  });
});

describe("confirmation window — the booking's own, frozen at booking time", () => {
  test("a configured confirmationWindowHours is frozen into the quality snapshot and read back from it", () => {
    const cfg = serviceCatalogConfigSchema.parse({ quality: { proofRequired: true, confirmationWindowHours: 24 } });
    const snap = qualitySnapshot(cfg);
    expect(snap?.confirmationWindowHours).toBe(24);
    expect(confirmationWindowHours({ quality: snap })).toBe(24);
    expect(qualityFromSnapshot({ quality: snap })?.confirmationWindowHours).toBe(24);
  });

  test("absent or out-of-range values fall back to the published 48-hour window", () => {
    expect(DEFAULT_CONFIRMATION_WINDOW_HOURS).toBe(48);
    expect(confirmationWindowHours(null)).toBe(48);
    expect(confirmationWindowHours({ quality: { proofRequired: true } })).toBe(48);
    expect(confirmationWindowHours({ quality: { confirmationWindowHours: 0 } })).toBe(48);
    expect(confirmationWindowHours({ quality: { confirmationWindowHours: 721 } })).toBe(48);
    expect(confirmationWindowHours({ quality: { confirmationWindowHours: "24" } })).toBe(48);
    const snap = qualitySnapshot(serviceCatalogConfigSchema.parse({ quality: { proofRequired: true } }));
    expect(snap).not.toHaveProperty("confirmationWindowHours");
  });
});

describe("structural wiring", () => {
  const migration = read("prisma/migrations/20260924213000_quality_verdicts_completion/migration.sql");

  test("the migration is additive: three new tables, no ALTER/DROP of anything that already exists", () => {
    for (const t of ["booking_quality_verdicts", "booking_completions", "booking_completion_audit"]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "${t}"`);
    }
    expect(migration).not.toMatch(/ALTER TABLE/i);
    expect(migration).not.toMatch(/DROP (TABLE|COLUMN|INDEX)/i);
    expect(migration).not.toMatch(/TRUNCATE|DELETE FROM/i);
    expect(migration).not.toMatch(/UPDATE "?bookings"?/i);
  });

  test("verdicts and the completion audit are append-only by trigger; a resolved completion cannot change state", () => {
    expect(migration).toMatch(/CREATE TRIGGER "booking_quality_verdicts_no_update"\s+BEFORE UPDATE OR DELETE ON "booking_quality_verdicts"/);
    expect(migration).toMatch(/CREATE TRIGGER "booking_completion_audit_no_update"\s+BEFORE UPDATE OR DELETE ON "booking_completion_audit"/);
    expect(migration).toMatch(/CREATE TRIGGER "booking_completions_immutable_trg"\s+BEFORE UPDATE ON "booking_completions"/);
    expect(migration).toContain("IF OLD.state <> 'PENDING_CUSTOMER' AND NEW.state IS DISTINCT FROM OLD.state THEN");
    // The audit is trigger-written from the same GUCs booking_status_history uses.
    expect(migration).toContain("current_setting('homigo.actor_type', true)");
    expect(migration).toContain("current_setting('homigo.request_id', true)");
  });

  test("the table itself refuses an admin override without a reason of 3+ characters or a superseded verdict", () => {
    expect(migration).toMatch(/"actor_type" <> 'ADMIN' OR \("reason" IS NOT NULL AND length\("reason"\) >= 3 AND "supersedes_id" IS NOT NULL\)/);
    expect(migration).toContain('"verdict" IN (\'PASS\', \'PASS_WITH_EXCEPTION\', \'REWORK_REQUIRED\', \'FAILED\', \'ESCALATED\')');
    expect(migration).toContain('UNIQUE ("booking_id", "sequence")');
    expect(migration).toContain(`("state" = 'ISSUE_REPORTED') = ("case_id" IS NOT NULL)`);
  });

  test("every completion template placeholder is declared (an undeclared one stops the outbox at boot)", () => {
    expect(BOOKING_COMPLETION_TEMPLATES.length).toBe(4);
    for (const def of BOOKING_COMPLETION_TEMPLATES) {
      const used = [...`${def.title} ${def.body}`.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
      expect(used.length).toBeGreaterThan(0);
      for (const v of used) expect(Object.keys(def.variables)).toContain(v);
      expect(def.channel).toBe("IN_APP");
    }
    const types = new Set(BOOKING_COMPLETION_TEMPLATES.map((d) => d.notificationType));
    expect(types).toEqual(new Set(["booking.completion_confirm_request", "booking.completion_auto_confirmed"]));
  });

  test("the auto-confirm sweep is registered behind the autonomous gate, leader-locked exclusive, and cleared on stop", () => {
    const m = read("src/lib/maintenance.ts");
    expect(m).toMatch(/runWithLeaderLock\("maintenance:completion_auto_confirm", \d+, async \(\) => \{[\s\S]*?bookingCompletionService\.autoConfirmDue\(\)[\s\S]*?\}, \{ exclusive: true \}\)/);
    // Registered AFTER the autonomous gate's early return (the `if (!decision.enabled) { ... return; }` block).
    const gate = m.indexOf("if (!decision.enabled) {");
    const timer = m.indexOf("completionAutoConfirmTimer = setInterval(() => void runCompletionAutoConfirm(), COMPLETION_AUTO_CONFIRM_INTERVAL_MS)");
    expect(gate).toBeGreaterThan(0);
    expect(timer).toBeGreaterThan(gate);
    expect(m).toContain('"completion_auto_confirm"');
    const stop = m.slice(m.indexOf("export function stopMaintenance()"));
    expect(stop).toContain("completionAutoConfirmTimer,");
    expect(stop).toMatch(/completionAutoConfirmTimer =\s*\n?\s*null/);
  });

  test("the completion path evaluates the verdict inside the transaction and records refusals afterwards", () => {
    const svc = read("src/services/booking.service.ts");
    expect(svc).toContain("bookingQualityService.evaluateAndRecord(tx, id, verdictActor");
    expect(svc).toContain("if (v && !verdictAllowsCompletion(v.verdict)) {");
    expect(svc).toContain("throw new QualityVerdictError(");
    expect(svc).toContain("if (err instanceof QualityVerdictError) await recordCompletionRefusal(");
    expect(svc).toContain("else if (err instanceof SafetyGateError) await recordCompletionRefusal(");
    expect(svc).toContain("else if (err instanceof ExecutionGateError) await recordCompletionRefusal(");
    // A lost guarded update reports newly:false and the caller fires no post-commit side effects.
    expect(svc).toContain("if (raced) return { row: raced, newly: false };");
    expect(svc).toMatch(/if \(!newly\) \{[\s\S]*?newlyCompleted: false as const \};/);
    // The completion row and the warranty row are written in the SAME transaction as COMPLETED.
    expect(svc).toContain("completionWindow = await bookingCompletionService.recordRequested(tx, {");
    expect(svc).toContain('bookingCompletionService.startWarranty(tx, { bookingId: id, snapshot: existing.serviceConfigSnapshot, event: "COMPLETION", at: completedAt })');
  });

  test("the routes map every refusal explicitly and never fall through to success", () => {
    const route = read("src/routes/bookings.ts");
    const complete = route.slice(route.indexOf('"/:id/complete"'), route.indexOf('"/:id/complete"') + 6000);
    expect(complete).toContain("if (err instanceof QualityVerdictError) {");
    expect(complete).toContain("code: QUALITY_VERDICT_BLOCKED");
    expect(complete).toMatch(/set\.status = 500;\s*return \{ success: false, error: "Could not complete this job", code: "COMPLETE_FAILED" \};/);
    const confirm = route.slice(route.indexOf('"/:id/confirm-completion"'), route.indexOf('"/:id/confirm-completion"') + 2500);
    for (const c of ["NOT_FOUND", "COMPLETION_NOT_FOUND", "COMPLETION_ALREADY_RESOLVED", "COMPLETION_UNAVAILABLE"]) expect(confirm).toContain(`[COMPLETION_ERRORS.${c}]`);
    expect(confirm).toContain('table[r.error] ?? [400, "Unable to confirm this completion"]');
    const admin = read("src/routes/admin.ts");
    const override = admin.slice(admin.indexOf('"/bookings/:id/quality/override"'), admin.indexOf('"/bookings/:id/quality/override"') + 2000);
    for (const c of ["NOT_FOUND", "NOTHING_TO_SUPERSEDE", "INVALID_STATUS", "REASON_REQUIRED", "INVALID_VERDICT", "QUALITY_UNAVAILABLE"]) expect(override).toContain(`[QUALITY_ERRORS.${c}]`);
    expect(override).toContain("set.status = table[r.error] ?? 400;");
    expect(override).toContain("reason: t.String({ minLength: 3, maxLength: 500 })");
    const perms = read("src/lib/admin-route-permissions.ts");
    expect(perms).toContain('\\/quality\\/override$/, resource: "BOOKINGS", action: "APPROVE"');
  });
});
