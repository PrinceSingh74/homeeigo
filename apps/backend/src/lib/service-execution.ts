/**
 * Phase 10 §7/§8 — the execution plan of a service and its per-step rules. Pure module (no I/O).
 *
 * Hierarchy (no second versioning engine):
 *
 *   Service → ServiceVersion (services.version, service_config_versions)
 *           → ExecutionPlan = that version's `execution.steps`  (mirrored typed in service_execution_steps)
 *           → ExecutionStep
 *
 * A booking freezes the steps that apply to ITS selection into `service_config_snapshot.execution`
 * (`execution.v1`) and gets one state row per step (booking_execution_steps). A later admin edit
 * bumps the service version and can never reach an active or historical booking.
 *
 * Nothing here invents a procedure: a service with no configured plan resolves to an empty plan, and
 * an empty plan gates nothing (the §6 rule — unrelated services are not blocked).
 */
import { z } from "zod";
import { conditionApplies, requirementCode, type RequirementSelection } from "./service-requirements";

export const STEP_KINDS = ["PREPARATION", "WORK", "SAFETY_CHECK", "QUALITY_CHECK", "CLOSEOUT"] as const;
export const SKIP_POLICIES = ["NOT_SKIPPABLE", "SKIP_WITH_REASON"] as const;
export const STEP_EVIDENCE = ["NONE", "NOTE", "PHOTO", "BEFORE_AFTER_PHOTOS"] as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionCode = z.string().trim().min(1).max(40).regex(/^[a-z0-9][a-z0-9-]*$/);

/** One step as authored in catalog_config.execution.steps (and mirrored typed). */
export const executionStepSchema = z
  .object({
    id: requirementCode,
    title: text(120),
    description: text(1000).optional(),
    kind: z.enum(STEP_KINDS),
    mandatory: z.boolean().default(true),
    skipPolicy: z.enum(SKIP_POLICIES).default("NOT_SKIPPABLE"),
    evidence: z.enum(STEP_EVIDENCE).default("NONE"),
    estimatedMinutes: z.number().int().min(1).max(600).optional(),
    dependsOn: z.array(requirementCode).max(10).optional(),
    /** A Phase 06 requirement (by assignment id) that must be SATISFIED before this step may start. */
    safetyRequirement: requirementCode.optional(),
    ppe: z.array(text(80)).max(10).optional(),
    warnings: z.array(text(300)).max(10).optional(),
    when: z
      .object({
        variantIds: z.array(optionCode).max(30).optional(),
        addonIds: z.array(optionCode).max(20).optional(),
        minQuantity: z.number().int().min(1).max(10_000).optional(),
      })
      .strict()
      .optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine((s, ctx) => {
    // P10.4: a mandatory step cannot be skipped. Said by the schema, not left to the UI.
    if (s.mandatory && s.skipPolicy !== "NOT_SKIPPABLE") {
      ctx.addIssue({ code: "custom", path: ["skipPolicy"], message: "a mandatory step cannot be skippable" });
    }
    if (s.dependsOn?.includes(s.id)) ctx.addIssue({ code: "custom", path: ["dependsOn"], message: "a step cannot depend on itself" });
  });
export type ExecutionStep = z.infer<typeof executionStepSchema>;

export const executionPlanSchema = z.object({ steps: z.array(executionStepSchema).max(40) }).strict();
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

export type ExecutionIssue = { code: string; message: string; step?: string };

type Cfg = {
  execution?: ExecutionPlan;
  requirements?: Array<{ id: string; active: boolean; enforcement: string }>;
  variants?: Array<{ id: string; active: boolean }>;
  addons?: Array<{ id: string; active: boolean }>;
} | null;

/**
 * Static validation — every rule is structural, none is a business policy. Any issue makes the
 * service unbookable (fail closed), exactly like invalid requirements.
 */
export function validateExecutionPlan(cfg: Cfg): ExecutionIssue[] {
  const steps = cfg?.execution?.steps ?? [];
  if (!steps.length) return [];
  const issues: ExecutionIssue[] = [];
  const active = steps.filter((s) => s.active);
  const ids = new Set<string>();
  for (const s of steps) {
    if (ids.has(s.id)) issues.push({ code: "EXECUTION_STEP_DUPLICATE", message: `Step "${s.id}" is defined twice`, step: s.id });
    ids.add(s.id);
  }
  const activeIds = new Set(active.map((s) => s.id));
  const gatedRequirements = new Map((cfg?.requirements ?? []).filter((r) => r.active).map((r) => [r.id, r.enforcement]));
  const variants = new Set((cfg?.variants ?? []).filter((v) => v.active).map((v) => v.id));
  const addons = new Set((cfg?.addons ?? []).filter((a) => a.active).map((a) => a.id));
  for (const s of active) {
    for (const d of s.dependsOn ?? []) {
      if (!activeIds.has(d)) issues.push({ code: "EXECUTION_DEPENDENCY_UNKNOWN", message: `"${s.id}" depends on "${d}", which is not an active step`, step: s.id });
    }
    if (s.safetyRequirement) {
      const enf = gatedRequirements.get(s.safetyRequirement);
      // A safety link must point at something that is actually enforced; linking to copy would make
      // the step LOOK safety-gated while gating nothing.
      if (!enf) issues.push({ code: "EXECUTION_SAFETY_LINK_UNKNOWN", message: `"${s.id}" requires "${s.safetyRequirement}", which is not an active requirement`, step: s.id });
      else if (enf !== "REQUIRED_BEFORE_ARRIVAL" && enf !== "REQUIRED_AT_START" && enf !== "REQUIRED_BEFORE_BOOKING") {
        issues.push({ code: "EXECUTION_SAFETY_LINK_NOT_ENFORCED", message: `"${s.id}" requires "${s.safetyRequirement}", which is informational only`, step: s.id });
      }
    }
    for (const v of s.when?.variantIds ?? []) if (!variants.has(v)) issues.push({ code: "EXECUTION_CONDITION_INVALID", message: `"${s.id}" references variant "${v}", which does not exist or is inactive`, step: s.id });
    for (const a of s.when?.addonIds ?? []) if (!addons.has(a)) issues.push({ code: "EXECUTION_CONDITION_INVALID", message: `"${s.id}" references add-on "${a}", which does not exist or is inactive`, step: s.id });
    // A mandatory unconditional step that depends on a conditional one would be unsatisfiable for
    // selections where the dependency does not apply.
    if (s.mandatory && !s.when) {
      for (const d of s.dependsOn ?? []) {
        const dep = active.find((x) => x.id === d);
        if (dep?.when) issues.push({ code: "EXECUTION_DEPENDENCY_CONDITIONAL", message: `mandatory "${s.id}" depends on conditional "${d}"`, step: s.id });
      }
    }
  }
  // Cycles.
  const graph = new Map(active.map((s) => [s.id, s.dependsOn ?? []]));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      issues.push({ code: "EXECUTION_DEPENDENCY_CYCLE", message: `steps depend on each other: ${[...path, id].join(" → ")}`, step: id });
      return;
    }
    state.set(id, 1);
    for (const d of graph.get(id) ?? []) if (graph.has(d)) visit(d, [...path, id]);
    state.set(id, 2);
  };
  for (const id of graph.keys()) visit(id, []);
  return issues;
}

export type ResolvedStep = {
  code: string;
  stepNumber: number;
  title: string;
  description: string | null;
  kind: (typeof STEP_KINDS)[number];
  mandatory: boolean;
  skipPolicy: (typeof SKIP_POLICIES)[number];
  evidence: (typeof STEP_EVIDENCE)[number];
  estimatedMinutes: number | null;
  dependsOn: string[];
  safetyRequirement: string | null;
  ppe: string[];
  warnings: string[];
  source: "BASE" | "VARIANT" | "ADDON" | "QUANTITY";
};

export type ExecutionResolution = { ok: true; steps: ResolvedStep[] } | { ok: false; error: "EXECUTION_CONFIGURATION_INVALID"; issues: ExecutionIssue[] };

/**
 * Service configuration + selection → the steps of THIS booking. Deterministic (sortOrder, then id),
 * fail-closed on an invalid plan. Dependencies on steps that do not apply to the selection are
 * dropped only when the dependency is conditional (validated above).
 */
export function resolveExecutionPlan(cfg: Cfg, sel: RequirementSelection): ExecutionResolution {
  const steps = cfg?.execution?.steps ?? [];
  if (!steps.length) return { ok: true, steps: [] };
  const issues = validateExecutionPlan(cfg);
  if (issues.length) return { ok: false, error: "EXECUTION_CONFIGURATION_INVALID", issues };
  const applicable = steps
    .filter((s) => s.active && conditionApplies(s.when, sel))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id));
  const present = new Set(applicable.map((s) => s.id));
  return {
    ok: true,
    steps: applicable.map((s, i) => ({
      code: s.id,
      stepNumber: i + 1,
      title: s.title,
      description: s.description ?? null,
      kind: s.kind,
      mandatory: s.mandatory,
      skipPolicy: s.skipPolicy,
      evidence: s.evidence,
      estimatedMinutes: s.estimatedMinutes ?? null,
      dependsOn: (s.dependsOn ?? []).filter((d) => present.has(d)),
      safetyRequirement: s.safetyRequirement ?? null,
      ppe: s.ppe ?? [],
      warnings: s.warnings ?? [],
      source: s.when?.addonIds?.length ? "ADDON" : s.when?.variantIds?.length ? "VARIANT" : s.when?.minQuantity != null ? "QUANTITY" : "BASE",
    })),
  };
}

export type ExecutionSnapshot = { schema: "execution.v1"; serviceVersion: number; steps: ResolvedStep[] };

export function buildExecutionSnapshot(steps: ResolvedStep[], serviceVersion: number): ExecutionSnapshot {
  return { schema: "execution.v1", serviceVersion, steps };
}

/** The frozen steps of a booking; null for bookings made before §7 (nothing is fabricated for them). */
export function executionStepsFromSnapshot(bookingSnapshot: unknown): ExecutionSnapshot | null {
  const rec = bookingSnapshot && typeof bookingSnapshot === "object" ? (bookingSnapshot as { execution?: unknown }).execution : null;
  if (!rec || typeof rec !== "object") return null;
  const r = rec as Partial<ExecutionSnapshot>;
  return r.schema === "execution.v1" && Array.isArray(r.steps) ? (r as ExecutionSnapshot) : null;
}

/* ------------------------------------------------------------------ */
/* Runtime state                                                       */
/* ------------------------------------------------------------------ */

/** Stored states. READY and BLOCKED are derived (dependencies / safety / booking status). */
export const STEP_STATES = ["PENDING", "IN_PROGRESS", "COMPLETED", "SKIPPED_WITH_REASON", "FAILED", "ESCALATED"] as const;
export type StepState = (typeof STEP_STATES)[number];
export type EffectiveStepState = StepState | "READY" | "BLOCKED";

export type StepRow = {
  code: string;
  stepNumber: number;
  mandatory: boolean;
  skipPolicy: string;
  evidence: string;
  dependsOn: string[];
  safetyRequirement: string | null;
  state: StepState;
  version: number;
};

const DONE: ReadonlySet<string> = new Set(["COMPLETED", "SKIPPED_WITH_REASON"]);

export type StepBlock = { reason: "BOOKING_NOT_IN_PROGRESS" | "DEPENDENCY_INCOMPLETE" | "SAFETY_REQUIREMENT_UNMET"; detail: string[] };

/**
 * Why a step cannot start now (null = it can). The safety link reads the §6 requirement state:
 * `satisfiedRequirements` is the set of requirement codes whose effective state is SATISFIED.
 */
export function stepBlock(row: StepRow, all: StepRow[], ctx: { bookingStatus: string; satisfiedRequirements: ReadonlySet<string> }): StepBlock | null {
  if (ctx.bookingStatus !== "IN_PROGRESS") return { reason: "BOOKING_NOT_IN_PROGRESS", detail: [] };
  const byCode = new Map(all.map((r) => [r.code, r]));
  const pending = row.dependsOn.filter((d) => !DONE.has(byCode.get(d)?.state ?? "PENDING"));
  if (pending.length) return { reason: "DEPENDENCY_INCOMPLETE", detail: pending };
  if (row.safetyRequirement && !ctx.satisfiedRequirements.has(row.safetyRequirement)) return { reason: "SAFETY_REQUIREMENT_UNMET", detail: [row.safetyRequirement] };
  return null;
}

export function effectiveStepState(row: StepRow, all: StepRow[], ctx: { bookingStatus: string; satisfiedRequirements: ReadonlySet<string> }): EffectiveStepState {
  if (row.state !== "PENDING") return row.state;
  return stepBlock(row, all, ctx) ? "BLOCKED" : "READY";
}

export type StepAction = "START" | "COMPLETE" | "SKIP" | "FAIL" | "ESCALATE" | "RESET";

/**
 * The step state machine. Partner actions need the assigned partner; RESET is admin-only (returns a
 * FAILED/ESCALATED step to PENDING for a re-attempt). A mandatory step can never be skipped.
 */
export function canTransitionStep(row: StepRow, action: StepAction, actor: "PARTNER" | "ADMIN"): { ok: true; to: StepState } | { ok: false; error: string } {
  const bad = (e = "STEP_TRANSITION_FORBIDDEN") => ({ ok: false as const, error: e });
  if (action === "RESET") {
    if (actor !== "ADMIN") return bad();
    return row.state === "FAILED" || row.state === "ESCALATED" ? { ok: true, to: "PENDING" } : bad("STEP_NOT_RESETTABLE");
  }
  if (actor !== "PARTNER") return bad();
  switch (action) {
    case "START":
      return row.state === "PENDING" ? { ok: true, to: "IN_PROGRESS" } : bad("STEP_NOT_STARTABLE");
    case "COMPLETE":
      return row.state === "IN_PROGRESS" ? { ok: true, to: "COMPLETED" } : bad("STEP_NOT_IN_PROGRESS");
    case "SKIP":
      if (row.mandatory || row.skipPolicy !== "SKIP_WITH_REASON") return bad("STEP_NOT_SKIPPABLE");
      return row.state === "PENDING" || row.state === "IN_PROGRESS" ? { ok: true, to: "SKIPPED_WITH_REASON" } : bad("STEP_NOT_SKIPPABLE");
    case "FAIL":
      return row.state === "IN_PROGRESS" ? { ok: true, to: "FAILED" } : bad("STEP_NOT_IN_PROGRESS");
    case "ESCALATE":
      return row.state === "PENDING" || row.state === "IN_PROGRESS" || row.state === "FAILED" ? { ok: true, to: "ESCALATED" } : bad();
    default:
      return bad();
  }
}

export const EXECUTION_GATE_BLOCKED = "EXECUTION_GATE_BLOCKED";

export type ExecutionGate = {
  ok: boolean;
  blocking: Array<{ code: string; stepNumber: number; state: StepState; reason: "MANDATORY_STEP_INCOMPLETE" | "STEP_FAILED" | "STEP_ESCALATED" }>;
};

/**
 * Completion gate: every mandatory step COMPLETED; no step (mandatory or not) FAILED or ESCALATED.
 * Optional steps left PENDING do not block. No steps → not blocked.
 */
export function evaluateExecutionGate(rows: StepRow[]): ExecutionGate {
  const blocking: ExecutionGate["blocking"] = [];
  for (const r of [...rows].sort((a, b) => a.stepNumber - b.stepNumber)) {
    if (r.state === "FAILED") blocking.push({ code: r.code, stepNumber: r.stepNumber, state: r.state, reason: "STEP_FAILED" });
    else if (r.state === "ESCALATED") blocking.push({ code: r.code, stepNumber: r.stepNumber, state: r.state, reason: "STEP_ESCALATED" });
    else if (r.mandatory && r.state !== "COMPLETED") blocking.push({ code: r.code, stepNumber: r.stepNumber, state: r.state, reason: "MANDATORY_STEP_INCOMPLETE" });
  }
  return { ok: blocking.length === 0, blocking };
}

export class ExecutionGateError extends Error {
  readonly code = EXECUTION_GATE_BLOCKED;
  constructor(readonly gate: ExecutionGate) {
    super(EXECUTION_GATE_BLOCKED);
    this.name = "ExecutionGateError";
  }
}
