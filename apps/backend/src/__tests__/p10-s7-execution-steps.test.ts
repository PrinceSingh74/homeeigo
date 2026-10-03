/**
 * Phase 10 §7/§8 — execution plan and steps: the pure rules and the structural wiring.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildExecutionSnapshot,
  canTransitionStep,
  effectiveStepState,
  evaluateExecutionGate,
  executionPlanSchema,
  executionStepsFromSnapshot,
  resolveExecutionPlan,
  stepBlock,
  validateExecutionPlan,
  type StepRow,
} from "../lib/service-execution";

const BACKEND = resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");

const cfg = (steps: unknown[], extra: Record<string, unknown> = {}) => ({
  execution: executionPlanSchema.parse({ steps }),
  requirements: [
    { id: "shutoff", active: true, enforcement: "REQUIRED_AT_START" },
    { id: "pets", active: true, enforcement: "INFORMATIONAL" },
  ],
  variants: [{ id: "fabric", active: true }, { id: "leather", active: true }],
  addons: [{ id: "stain-guard", active: true }],
  ...extra,
});
const sel = { variantId: "fabric", addonIds: [] as string[], quantity: 2 };
const row = (over: Partial<StepRow> & { code: string }): StepRow => ({
  stepNumber: 1, mandatory: true, skipPolicy: "NOT_SKIPPABLE", evidence: "NONE", dependsOn: [], safetyRequirement: null, state: "PENDING", version: 1, ...over,
});

describe("the plan is typed and fail-closed", () => {
  test("a mandatory step cannot be declared skippable (schema)", () => {
    expect(() => executionPlanSchema.parse({ steps: [{ id: "a", title: "A", kind: "WORK", mandatory: true, skipPolicy: "SKIP_WITH_REASON" }] })).toThrow();
  });

  test("structural issues make the plan invalid: unknown dependency, cycle, safety link to copy, bad condition", () => {
    const codes = (steps: unknown[]) => validateExecutionPlan(cfg(steps)).map((i) => i.code);
    expect(codes([{ id: "a", title: "A", kind: "WORK", dependsOn: ["ghost"] }])).toContain("EXECUTION_DEPENDENCY_UNKNOWN");
    expect(codes([{ id: "a", title: "A", kind: "WORK", dependsOn: ["b"] }, { id: "b", title: "B", kind: "WORK", dependsOn: ["a"] }])).toContain("EXECUTION_DEPENDENCY_CYCLE");
    expect(codes([{ id: "a", title: "A", kind: "SAFETY_CHECK", safetyRequirement: "pets" }])).toContain("EXECUTION_SAFETY_LINK_NOT_ENFORCED");
    expect(codes([{ id: "a", title: "A", kind: "SAFETY_CHECK", safetyRequirement: "nothing" }])).toContain("EXECUTION_SAFETY_LINK_UNKNOWN");
    expect(codes([{ id: "a", title: "A", kind: "WORK", when: { variantIds: ["velvet"] } }])).toContain("EXECUTION_CONDITION_INVALID");
    expect(codes([{ id: "c", title: "C", kind: "WORK", when: { variantIds: ["leather"] } }, { id: "d", title: "D", kind: "WORK", dependsOn: ["c"] }])).toContain("EXECUTION_DEPENDENCY_CONDITIONAL");
  });

  test("no plan → no steps, nothing gated (unrelated services are not blocked)", () => {
    expect(resolveExecutionPlan(null, sel)).toEqual({ ok: true, steps: [] });
    expect(evaluateExecutionGate([])).toEqual({ ok: true, blocking: [] });
  });

  test("resolution is server-side and deterministic: conditional steps follow the selection", () => {
    const c = cfg([
      { id: "prep", title: "Prep", kind: "PREPARATION", sortOrder: 1 },
      { id: "leather-oil", title: "Condition leather", kind: "WORK", when: { variantIds: ["leather"] }, sortOrder: 2 },
      { id: "tidy", title: "Tidy up", kind: "CLOSEOUT", mandatory: false, skipPolicy: "SKIP_WITH_REASON", sortOrder: 3 },
    ]);
    const fabric = resolveExecutionPlan(c, sel);
    const leather = resolveExecutionPlan(c, { ...sel, variantId: "leather" });
    expect(fabric.ok && fabric.steps.map((s) => [s.code, s.stepNumber])).toEqual([["prep", 1], ["tidy", 2]]);
    expect(leather.ok && leather.steps.map((s) => [s.code, s.stepNumber, s.source])).toEqual([["prep", 1, "BASE"], ["leather-oil", 2, "VARIANT"], ["tidy", 3, "BASE"]]);
  });

  test("the snapshot round-trips; a booking without one has no plan (nothing fabricated)", () => {
    const r = resolveExecutionPlan(cfg([{ id: "prep", title: "Prep", kind: "PREPARATION" }]), sel);
    const snap = buildExecutionSnapshot(r.ok ? r.steps : [], 7);
    expect(executionStepsFromSnapshot({ execution: snap })).toEqual(snap);
    expect(executionStepsFromSnapshot({})).toBeNull();
    expect(executionStepsFromSnapshot(null)).toBeNull();
  });
});

describe("step state machine", () => {
  test("START → COMPLETE only in order; mandatory steps can never be skipped", () => {
    expect(canTransitionStep(row({ code: "a" }), "COMPLETE", "PARTNER")).toEqual({ ok: false, error: "STEP_NOT_IN_PROGRESS" });
    expect(canTransitionStep(row({ code: "a" }), "START", "PARTNER")).toEqual({ ok: true, to: "IN_PROGRESS" });
    expect(canTransitionStep(row({ code: "a", state: "IN_PROGRESS" }), "COMPLETE", "PARTNER")).toEqual({ ok: true, to: "COMPLETED" });
    expect(canTransitionStep(row({ code: "a" }), "SKIP", "PARTNER")).toEqual({ ok: false, error: "STEP_NOT_SKIPPABLE" });
    expect(canTransitionStep(row({ code: "a", mandatory: false, skipPolicy: "SKIP_WITH_REASON" }), "SKIP", "PARTNER")).toEqual({ ok: true, to: "SKIPPED_WITH_REASON" });
  });

  test("admins can only RESET a failed/escalated step; partners cannot reset; admins cannot complete", () => {
    expect(canTransitionStep(row({ code: "a", state: "FAILED" }), "RESET", "ADMIN")).toEqual({ ok: true, to: "PENDING" });
    expect(canTransitionStep(row({ code: "a", state: "COMPLETED" }), "RESET", "ADMIN").ok).toBe(false);
    expect(canTransitionStep(row({ code: "a", state: "FAILED" }), "RESET", "PARTNER").ok).toBe(false);
    expect(canTransitionStep(row({ code: "a", state: "IN_PROGRESS" }), "COMPLETE", "ADMIN").ok).toBe(false);
  });

  test("READY / BLOCKED are derived: booking must be in progress, dependencies done, safety requirement satisfied", () => {
    const prep = row({ code: "prep" });
    const apply = row({ code: "apply", stepNumber: 2, dependsOn: ["prep"], safetyRequirement: "shutoff" });
    const ctx = (status: string, sat: string[] = []) => ({ bookingStatus: status, satisfiedRequirements: new Set(sat) });
    expect(stepBlock(prep, [prep, apply], ctx("ACCEPTED"))?.reason).toBe("BOOKING_NOT_IN_PROGRESS");
    expect(effectiveStepState(prep, [prep, apply], ctx("IN_PROGRESS"))).toBe("READY");
    expect(stepBlock(apply, [prep, apply], ctx("IN_PROGRESS"))).toEqual({ reason: "DEPENDENCY_INCOMPLETE", detail: ["prep"] });
    const done = { ...prep, state: "COMPLETED" as const };
    expect(stepBlock(apply, [done, apply], ctx("IN_PROGRESS"))).toEqual({ reason: "SAFETY_REQUIREMENT_UNMET", detail: ["shutoff"] });
    expect(effectiveStepState(apply, [done, apply], ctx("IN_PROGRESS", ["shutoff"]))).toBe("READY");
  });

  test("completion gate: mandatory incomplete, failed or escalated blocks; optional pending does not", () => {
    const g = evaluateExecutionGate([
      row({ code: "a", state: "COMPLETED" }),
      row({ code: "b", stepNumber: 2 }),
      row({ code: "c", stepNumber: 3, mandatory: false, skipPolicy: "SKIP_WITH_REASON" }),
      row({ code: "d", stepNumber: 4, mandatory: false, state: "FAILED" }),
    ]);
    expect(g.ok).toBe(false);
    expect(g.blocking.map((b) => [b.code, b.reason])).toEqual([["b", "MANDATORY_STEP_INCOMPLETE"], ["d", "STEP_FAILED"]]);
    expect(evaluateExecutionGate([row({ code: "a", state: "COMPLETED" }), row({ code: "c", mandatory: false })]).ok).toBe(true);
  });
});

describe("structure", () => {
  test("COMPLETE consults the execution gate inside its transaction before the status write", () => {
    const s = read("src/services/booking.service.ts");
    const gate = s.indexOf("await bookingExecutionService.assertCompletionAllowed(tx, id);");
    const write = s.indexOf('status: "COMPLETED",', gate);
    expect(gate).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(gate);
  });

  test("the plan is frozen into the booking snapshot and rows are born in the create transaction", () => {
    const s = read("src/services/booking.service.ts");
    expect(s).toContain("execution: executionSnapshot,");
    expect(s).toContain("await bookingExecutionService.materializeForNewBooking(tx, { bookingId: created.id, snapshot: { execution: executionSnapshot } });");
  });

  test("conditional applicability has ONE implementation shared with requirements", () => {
    expect(read("src/lib/service-execution.ts")).toContain("conditionApplies(s.when, sel)");
    expect(read("src/lib/service-requirements.ts")).toContain("return conditionApplies(r.when, sel);");
  });

  test("evidence comes from the one proof system (job_evidence), never from the request body alone", () => {
    const s = read("src/services/booking-execution.service.ts");
    expect(s).toContain("tx.jobEvidence.findMany({");
    expect(s).toContain("hasAuthoritativeMedia(e)");
  });

  test("migration is additive and enforces the non-skippable rule below the application", () => {
    const sql = read("prisma/migrations/20260924180000_execution_plan_steps/migration.sql");
    expect(sql).toContain("CHECK (NOT (\"is_mandatory\" AND \"state\" = 'SKIPPED_WITH_REASON'))");
    expect(sql).toContain("booking_execution_audit is append-only");
    expect(/\b(DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN)\b/i.test(sql)).toBe(false);
  });

  test("the create route can no longer turn an unmapped refusal into 201 success", () => {
    const r = read("src/routes/bookings.ts");
    const guard = r.indexOf('return { success: false, error: "This booking could not be created"');
    const ok = r.indexOf('return { success: true, message: "Booking created successfully", data: result };');
    expect(guard).toBeGreaterThan(0);
    expect(ok).toBeGreaterThan(guard);
  });
});
