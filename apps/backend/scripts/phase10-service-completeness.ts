/**
 * Phase 10 — READ-ONLY operational completeness audit of a service's `catalog_config`.
 *
 *   bun run scripts/phase10-service-completeness.ts --draft            # no database: the 31 drafted services
 *   bun run scripts/phase10-service-completeness.ts --mapping          # no database: concept → canonical path
 *   bun run scripts/phase10-service-completeness.ts --url "<postgres url>"   # read-only: live config + projection
 *
 * `assessService` is PURE: no database, no environment, no network. It maps each Phase 10 concept to the
 * typed location that ALREADY exists in the codebase and says, per concept, whether it is present:
 *
 *   src/lib/service-catalog-config.ts   serviceCatalogConfigSchema (safety / quality / warranty / rework /
 *                                       customerPolicy / trust / requirements / execution)
 *   src/lib/service-execution.ts        executionStepSchema, validateExecutionPlan, resolveExecutionPlan (execution.v1)
 *   src/lib/service-safety.ts           buildSafetySnapshot (safety.v1)
 *   src/lib/service-warranty.ts         buildWarrantySnapshot (warranty.v1)
 *   src/lib/service-runtime-policy.ts   qualitySnapshot (quality policy frozen per booking)
 *   src/lib/service-requirements.ts     requirementAssignmentSchema, validateServiceRequirements (Phase 06)
 *
 * Nothing is invented. A concept with no canonical field is reported with `canonicalPath: null`,
 * `present: false`, `required: false` and a note saying so.
 *
 * What is REQUIRED (everything else is reported, never gating):
 *   - the Phase 06 `requirements` (none at all = INVALID);
 *   - an execution plan whose steps have a number, a code and a title, that opens with the scope step
 *     (PREPARATION), carries a stop-condition check (SAFETY_CHECK), a professional quality check
 *     (QUALITY_CHECK) and ends with CLOSEOUT — the same shape scripts/phase10-content-validate.ts demands;
 *   - safety: the block itself, warnings, prohibited conditions, emergency protocol;
 *   - quality: the block itself, the checklist, and an EXPLICIT proofRequired / beforeAfterPhotos decision;
 *   - for a service that is not held: at least one WORK step, and materials + equipment resolved
 *     (assigned, or explicitly declared as not needed).
 * A HELD service (method facts do not exist) must carry everything above that does not depend on the
 * method, and must carry NO WORK step. Warranty, age policy, PPE, durations, customer confirmation and the
 * free-text policies have defined "unset" behaviour at runtime and are owner decisions: they are reported
 * per service and summarised, but they do not decide the status.
 */
import { serviceCatalogConfigSchema, type ServiceCatalogConfig } from "../src/lib/service-catalog-config";
import { resolveExecutionPlan, validateExecutionPlan } from "../src/lib/service-execution";
import { validateServiceRequirements } from "../src/lib/service-requirements";
import { buildSafetySnapshot } from "../src/lib/service-safety";
import { buildWarrantySnapshot } from "../src/lib/service-warranty";
import { qualitySnapshot } from "../src/lib/service-runtime-policy";
import { CATALOGUE, CONTENT } from "./data/phase-06-requirement-content-final";
import { DRAFT, type ServiceDraft } from "./data/phase-10-execution-safety-content-draft";
import { buildNextConfig } from "./phase10-content-apply-plan";
import { draftConfig } from "./phase10-content-validate";

export type Completeness = "COMPLETE" | "PARTIAL" | "HELD" | "INVALID";
export type FieldResult = { concept: string; canonicalPath: string | null; present: boolean; required: boolean; note?: string };
export type ServiceCompleteness = {
  slug: string;
  status: Completeness;
  heldReason?: string;
  fields: FieldResult[];
  missingRequired: string[];
  /** Why the status is INVALID (schema issues, contradictions). Empty / absent otherwise. */
  invalidReasons?: string[];
};
export type AssessOptions = {
  held?: { reason: string } | null;
  serviceRow?: { warrantyDays?: number | null; [k: string]: unknown };
};

/* ------------------------------------------------------------------ */
/* Concept → canonical path                                            */
/* ------------------------------------------------------------------ */

export type ConceptGroup = "STEP" | "RESOURCES" | "PROOF" | "SAFETY" | "QUALITY" | "WARRANTY";
export type ConceptMapping = { group: ConceptGroup; concept: string; canonicalPath: string | null; gating: "REQUIRED" | "REQUIRED_UNLESS_HELD" | "REPORTED" | "NO_CANONICAL_HOME"; basis: string };

export const CONCEPTS: ConceptMapping[] = [
  { group: "STEP", concept: "step_number", canonicalPath: "execution.steps[].sortOrder → execution.v1 steps[].stepNumber", gating: "REQUIRED", basis: "authoring order; resolveExecutionPlan numbers the steps positionally (sortOrder, then id)" },
  { group: "STEP", concept: "step_code", canonicalPath: "execution.steps[].id", gating: "REQUIRED", basis: "executionStepSchema.id (frozen as steps[].code)" },
  { group: "STEP", concept: "step_title", canonicalPath: "execution.steps[].title", gating: "REQUIRED", basis: "executionStepSchema.title (schema-required)" },
  { group: "STEP", concept: "description", canonicalPath: "execution.steps[].description", gating: "REPORTED", basis: "executionStepSchema.description is optional" },
  { group: "STEP", concept: "estimated_time", canonicalPath: "execution.steps[].estimatedMinutes", gating: "REPORTED", basis: "optional per step; the service-level duration is services.estimated_duration / duration.*" },
  { group: "RESOURCES", concept: "materials", canonicalPath: "requirements[] where item kind = MATERIAL (kind: requirementItems[itemCode].kind / service_requirement_items)", gating: "REQUIRED_UNLESS_HELD", basis: "Phase 06 assignments; `materialPolicy: NOT_REQUIRED` or a Phase 06 noSpecial declaration resolves it" },
  { group: "RESOURCES", concept: "equipment", canonicalPath: "requirements[] where item kind = EQUIPMENT (kind: requirementItems[itemCode].kind / service_requirement_items)", gating: "REQUIRED_UNLESS_HELD", basis: "Phase 06 assignments; `equipmentPolicy: NOT_REQUIRED` or a Phase 06 noSpecial declaration resolves it" },
  { group: "PROOF", concept: "proof", canonicalPath: "execution.steps[].evidence (NONE | NOTE | PHOTO | BEFORE_AFTER_PHOTOS)", gating: "REPORTED", basis: "per-step evidence; schema default NONE is a valid authored value" },
  { group: "PROOF", concept: "proof_required", canonicalPath: "quality.proofRequired", gating: "REQUIRED", basis: "explicit boolean decision (qualitySnapshot reads it; unset silently means false)" },
  { group: "PROOF", concept: "before_after", canonicalPath: "quality.beforeAfterPhotos", gating: "REQUIRED", basis: "explicit boolean decision (qualitySnapshot reads it; unset silently means false)" },
  { group: "SAFETY", concept: "safety", canonicalPath: "safety (frozen per booking as safety.v1)", gating: "REQUIRED", basis: "buildSafetySnapshot" },
  { group: "SAFETY", concept: "warnings", canonicalPath: "safety.warnings[] (+ legacy safetyNotes[], both frozen as safety.v1 warnings)", gating: "REQUIRED", basis: "buildSafetySnapshot; step-level execution.steps[].warnings are partner-facing and do not replace it" },
  { group: "SAFETY", concept: "prohibited_conditions", canonicalPath: "safety.prohibitedConditions[]", gating: "REQUIRED", basis: "what a partner may raise as a safety hold (matchProhibitedCondition)" },
  { group: "SAFETY", concept: "PPE", canonicalPath: "execution.steps[].ppe[]", gating: "REPORTED", basis: "optional per step; not every service needs PPE" },
  { group: "SAFETY", concept: "chemical_restrictions", canonicalPath: null, gating: "NO_CANONICAL_HOME", basis: "no typed field exists; service-safety.ts states the platform invents no chemical rule" },
  { group: "SAFETY", concept: "age_restrictions", canonicalPath: "customerPolicy.age (mode + minimumAge / adultAge / guardianMinimumAge), customerPolicy.version", gating: "REPORTED", basis: "src/lib/customer-policy.ts; unset = NONE" },
  { group: "SAFETY", concept: "medical_disclaimer", canonicalPath: "safety.medicalDisclaimer", gating: "REPORTED", basis: "optional; frozen in safety.v1" },
  { group: "SAFETY", concept: "emergency_protocol", canonicalPath: "safety.emergencyProtocol", gating: "REQUIRED", basis: "frozen in safety.v1; the content validator fails a service without it" },
  { group: "SAFETY", concept: "incident_protocol", canonicalPath: null, gating: "NO_CANONICAL_HOME", basis: "no per-service field; incidents and holds are platform runtime (evaluateSafetyGate), the per-service text is safety.emergencyProtocol" },
  { group: "QUALITY", concept: "quality", canonicalPath: "quality (frozen per booking; policy version quality.v1)", gating: "REQUIRED", basis: "qualitySnapshot / deriveQualityVerdict" },
  { group: "QUALITY", concept: "quality_checklist", canonicalPath: "quality.checklist[]", gating: "REQUIRED", basis: "QUALITY_CHECKLIST_REQUIRED is derived from it" },
  { group: "QUALITY", concept: "completion_criteria", canonicalPath: "quality.completionCriteria[]", gating: "REPORTED", basis: "schema-only: not frozen by qualitySnapshot and not read by the verdict; completion is gated by mandatory steps + checklist + proof" },
  { group: "QUALITY", concept: "customer_confirmation", canonicalPath: "quality.customerConfirmation (+ quality.confirmationWindowHours)", gating: "REPORTED", basis: "optional; unset = false, window defaults to the platform's 48 h" },
  { group: "QUALITY", concept: "professional_confirmation", canonicalPath: "execution.steps[] where kind = QUALITY_CHECK and mandatory (equivalent — there is no dedicated boolean)", gating: "REQUIRED", basis: "the professional confirms the result by completing the mandatory quality-check step; the content validator demands one" },
  { group: "WARRANTY", concept: "warranty", canonicalPath: "warranty (frozen per booking as warranty.v1; legacy input quality.warrantyDays)", gating: "REPORTED", basis: "buildWarrantySnapshot; unset = no warranty" },
  { group: "WARRANTY", concept: "warranty_days", canonicalPath: "warranty.durationDays (legacy quality.warrantyDays)", gating: "REPORTED", basis: "buildWarrantySnapshot; `services` has no warranty column" },
  { group: "WARRANTY", concept: "conditions", canonicalPath: "warranty.eligibleIssueTypes[] / warranty.exclusions[] / warranty.startEvent / warranty.proofRequired", gating: "REPORTED", basis: "evaluateWarrantyEligibility" },
  { group: "WARRANTY", concept: "revisit", canonicalPath: "rework (fee, sameProviderPreferred, windowDays) + warranty.reworkFirst (legacy text quality.revisitPolicy)", gating: "REPORTED", basis: "Phase 10 §11 rework policy" },
  { group: "WARRANTY", concept: "complaint_window", canonicalPath: "quality.complaintWindowDays", gating: "REPORTED", basis: "frozen in warranty.v1; unset = 0 = NO_COMPLAINT_WINDOW" },
  { group: "WARRANTY", concept: "guarantee", canonicalPath: "trust.guarantee", gating: "REPORTED", basis: "free text (≤300), schema-only: nothing at runtime reads it" },
  { group: "WARRANTY", concept: "damage_policy", canonicalPath: null, gating: "NO_CANONICAL_HOME", basis: "no typed field; the nearest facts are warranty.eligibleIssueTypes containing DAMAGE and trust.insuranceSupported, neither states a damage policy" },
];

const PATH = new Map(CONCEPTS.map((c) => [c.concept, c.canonicalPath]));

/* ------------------------------------------------------------------ */
/* Tolerant readers (a config that fails the schema is still described) */
/* ------------------------------------------------------------------ */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const hasText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const texts = (v: unknown): string[] => list(v).filter(hasText);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

type StepView = {
  id: string | null;
  title: string | null;
  description: string | null;
  kind: string | null;
  mandatory: boolean;
  evidence: string;
  estimatedMinutes: number | null;
  sortOrder: number | null;
  ppe: string[];
  warnings: string[];
  active: boolean;
};

function stepView(raw: unknown): StepView {
  const s = obj(raw);
  return {
    id: hasText(s.id) ? s.id.trim() : null,
    title: hasText(s.title) ? s.title.trim() : null,
    description: hasText(s.description) ? s.description.trim() : null,
    kind: hasText(s.kind) ? s.kind : null,
    mandatory: s.mandatory !== false,
    evidence: hasText(s.evidence) ? s.evidence : "NONE",
    estimatedMinutes: isInt(s.estimatedMinutes) ? s.estimatedMinutes : null,
    sortOrder: isInt(s.sortOrder) ? s.sortOrder : null,
    ppe: texts(s.ppe),
    warnings: texts(s.warnings),
    active: s.active !== false,
  };
}

const PHASE06_ITEMS = new Map(CATALOGUE.map((i) => [i.code, i]));
const label = (s: StepView, i: number) => s.id ?? `#${i + 1}`;

/* ------------------------------------------------------------------ */
/* The assessment                                                      */
/* ------------------------------------------------------------------ */

export function assessService(slug: string, catalogConfig: unknown, opts: AssessOptions = {}): ServiceCompleteness {
  const held = opts.held ?? null;
  const invalid: string[] = [];
  const fields: FieldResult[] = [];
  const add = (concept: string, present: boolean, required: boolean, note?: string, canonicalPath: string | null = PATH.get(concept) ?? null) =>
    fields.push({ concept, canonicalPath, present, required, ...(note ? { note } : {}) });

  /* ---- 0. shape + canonical schema ---- */
  const raw: Obj | null = isObj(catalogConfig) ? catalogConfig : null;
  if (catalogConfig == null) invalid.push("CONFIG_MISSING: the service has no catalog_config");
  else if (!raw) invalid.push("CONFIG_SHAPE: catalog_config is not a JSON object");
  const parsed = raw ? serviceCatalogConfigSchema.safeParse(raw) : null;
  if (parsed && !parsed.success) for (const i of parsed.error.issues) invalid.push(`SCHEMA ${i.path.join(".") || "(root)"}: ${i.message}`);
  const cfg: ServiceCatalogConfig | null = parsed?.success ? parsed.data : null;
  /** Schema-normalised when valid; the raw object otherwise, read tolerantly. */
  const view: Obj = cfg ? (cfg as unknown as Obj) : (raw ?? {});

  /* ---- 1. Phase 06 requirements ---- */
  const requirements = list(view.requirements).map(obj);
  const activeRequirements = requirements.filter((r) => r.active !== false);
  if (!requirements.length) invalid.push("REQUIREMENTS_MISSING: the config carries no Phase 06 `requirements` at all");
  add("requirements", requirements.length > 0, true, requirements.length ? `${activeRequirements.length} active of ${requirements.length}` : "no Phase 06 assignment", "requirements[]");

  const configItems = isObj(view.requirementItems) ? view.requirementItems : null;
  const kindOf = (itemCode: unknown): string | null => {
    if (!hasText(itemCode)) return null;
    const fromConfig = configItems ? obj(configItems[itemCode]).kind : undefined;
    if (hasText(fromConfig)) return fromConfig;
    return PHASE06_ITEMS.get(itemCode)?.kind ?? null;
  };
  const itemSource = configItems ? "catalog_config.requirementItems" : "Phase 06 content catalogue (the config carries no requirementItems)";
  const unknownItems = [...new Set(activeRequirements.map((r) => r.itemCode).filter((c) => kindOf(c) == null).map(String))];

  // The platform's own consistency rules for requirements (fail closed at booking time).
  if (cfg && requirements.length) {
    const items: Obj = {};
    for (const r of cfg.requirements ?? []) {
      const fromConfig = cfg.requirementItems?.[r.itemCode];
      const fromContent = PHASE06_ITEMS.get(r.itemCode);
      if (fromConfig) items[r.itemCode] = fromConfig;
      else if (fromContent) items[r.itemCode] = { code: fromContent.code, kind: fromContent.kind, name: fromContent.name, isActive: true };
    }
    for (const i of validateServiceRequirements({ ...cfg, requirementItems: items } as never)) invalid.push(`${i.code}: ${i.message} (item facts: ${itemSource})`);
  }

  /* ---- 2. execution plan ---- */
  const steps = list(obj(view.execution).steps).map(stepView);
  const active = steps.filter((s) => s.active);
  const ordered = [...active].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.id ?? "").localeCompare(b.id ?? ""));

  steps.forEach((s, i) => {
    if (!s.id) invalid.push(`EXECUTION_STEP_CODE_MISSING: step ${label(s, i)} has no id`);
    if (!s.title) invalid.push(`EXECUTION_STEP_TITLE_MISSING: step ${label(s, i)} has no title`);
  });
  const dup = (values: Array<string | number>) => [...new Set(values.filter((v, i) => values.indexOf(v) !== i))];
  for (const d of dup(steps.map((s) => s.id).filter((x): x is string => x != null))) invalid.push(`EXECUTION_STEP_CODE_DUPLICATE: step code "${d}" is used more than once`);
  for (const d of dup(active.map((s) => s.sortOrder).filter((x): x is number => x != null))) invalid.push(`EXECUTION_STEP_NUMBER_DUPLICATE: sortOrder ${d} is used by more than one active step`);

  let resolvedCount: number | null = null;
  if (cfg && steps.length) {
    for (const i of validateExecutionPlan(cfg as never)) if (i.code !== "EXECUTION_STEP_DUPLICATE") invalid.push(`${i.code}: ${i.message}`);
    const res = resolveExecutionPlan(cfg as never, { variantId: null, addonIds: [], quantity: 1 });
    if (res.ok) resolvedCount = res.steps.length;
  }

  const workSteps = steps.filter((s) => s.kind === "WORK");
  if (held && workSteps.length) {
    invalid.push(`WORK_STEP_ON_HELD_SERVICE: a held service carries method step(s) ${workSteps.map((s, i) => label(s, i)).join(", ")} — the method facts they need do not exist`);
  }

  const n = active.length;
  const unnumbered = active.filter((s) => s.sortOrder == null);
  add("step_number", n > 0 && unnumbered.length === 0, true, !n ? "no active step" : unnumbered.length ? `${unnumbered.length} of ${n} active steps have no sortOrder (order would fall back to the step id)` : `${n} steps numbered${resolvedCount != null ? `; ${resolvedCount} resolve for the base selection` : ""}`);
  add("step_code", n > 0 && active.every((s) => s.id), true, n ? undefined : "no active step");
  add("step_title", n > 0 && active.every((s) => s.title), true, n ? undefined : "no active step");
  const undescribed = active.filter((s) => !s.description);
  add("description", n > 0 && undescribed.length === 0, false, !n ? "no active step" : undescribed.length ? `no description on: ${undescribed.map(label).join(", ")}` : undefined);
  const timed = active.filter((s) => s.estimatedMinutes != null).length;
  const rowDuration = opts.serviceRow?.estimatedDuration;
  add("estimated_time", n > 0 && timed === n, false, `${timed} of ${n} active steps carry estimatedMinutes${typeof rowDuration === "number" ? `; services.estimated_duration = ${rowDuration} min` : ""}`);

  add("plan_scope_step", ordered[0]?.kind === "PREPARATION", true, !n ? "no active step" : ordered[0]?.kind === "PREPARATION" ? `opens with "${ordered[0]!.id}"` : `the plan opens with a ${ordered[0]?.kind ?? "?"} step`, "execution.steps[] — first step, kind PREPARATION (arrival / scope)");
  const stopChecks = active.filter((s) => s.kind === "SAFETY_CHECK");
  add("plan_stop_check_step", stopChecks.length > 0, true, stopChecks.length ? stopChecks.map(label).join(", ") : "no SAFETY_CHECK step", "execution.steps[] — kind SAFETY_CHECK (stop conditions)");
  add("plan_closeout_step", n > 0 && ordered[n - 1]?.kind === "CLOSEOUT", true, !n ? "no active step" : ordered[n - 1]?.kind === "CLOSEOUT" ? undefined : `the plan ends with a ${ordered[n - 1]?.kind ?? "?"} step`, "execution.steps[] — last step, kind CLOSEOUT");
  const activeWork = active.filter((s) => s.kind === "WORK");
  add(
    "plan_work_step",
    activeWork.length > 0,
    !held,
    held ? (workSteps.length ? "a held service must not carry a WORK step" : "withheld on purpose: the method facts do not exist") : activeWork.length ? `${activeWork.length} WORK step(s)` : "no WORK step",
    "execution.steps[] — kind WORK (method)",
  );

  /* ---- 3. resources ---- */
  const resource = (concept: "materials" | "equipment", kind: "MATERIAL" | "EQUIPMENT", policyKey: "materialPolicy" | "equipmentPolicy") => {
    const assigned = activeRequirements.filter((r) => kindOf(r.itemCode) === kind);
    const declaredInConfig = view[policyKey] === "NOT_REQUIRED";
    const declaredInContent = CONTENT[slug]?.noSpecial?.[kind];
    const withheld = CONTENT[slug]?.unconfigured?.[kind];
    const present = assigned.length > 0 || declaredInConfig || !!declaredInContent;
    const note = assigned.length
      ? `${assigned.length} assignment(s): ${assigned.map((r) => r.itemCode).join(", ")} (kind from ${itemSource})`
      : declaredInConfig
        ? `${policyKey} = NOT_REQUIRED`
        : declaredInContent
          ? `declared as needing nothing special in the Phase 06 content (not stored in catalog_config): ${declaredInContent}`
          : withheld
            ? `deliberately NOT_CONFIGURED in the Phase 06 content: ${withheld}`
            : `no ${kind} assignment and no NOT_REQUIRED declaration${unknownItems.length ? `; item code(s) of unknown kind: ${unknownItems.join(", ")}` : ""}`;
    add(concept, present, !held, held ? `${note} — not gating on a held service (depends on the method)` : note);
  };
  resource("materials", "MATERIAL", "materialPolicy");
  resource("equipment", "EQUIPMENT", "equipmentPolicy");

  /* ---- 4. proof ---- */
  const quality = obj(view.quality);
  const qualityOff = quality.notApplicable === true;
  const collecting = active.filter((s) => s.evidence !== "NONE");
  add("proof", collecting.length > 0, false, collecting.length ? collecting.map((s) => `${s.id}:${s.evidence}`).join(", ") : "no step collects evidence");
  add("proof_required", typeof quality.proofRequired === "boolean", true, typeof quality.proofRequired === "boolean" ? `= ${quality.proofRequired}` : "not decided (runtime reads unset as false)");
  add("before_after", typeof quality.beforeAfterPhotos === "boolean", true, typeof quality.beforeAfterPhotos === "boolean" ? `= ${quality.beforeAfterPhotos}` : "not decided (runtime reads unset as false)");
  if (quality.beforeAfterPhotos === true && n > 0 && !active.some((s) => s.evidence === "BEFORE_AFTER_PHOTOS")) {
    invalid.push("EVIDENCE_INCONSISTENT: quality.beforeAfterPhotos is on but no step collects BEFORE_AFTER_PHOTOS");
  }

  /* ---- 5. safety ---- */
  const safety = obj(view.safety);
  const frozenSafety = buildSafetySnapshot({ safety: isObj(view.safety) ? (safety as never) : undefined, safetyNotes: texts(view.safetyNotes) });
  const safetyHasContent = Object.values(safety).some((v) => hasText(v) || texts(v).length > 0);
  add("safety", safetyHasContent, true, safetyHasContent ? undefined : isObj(view.safety) ? "the safety block is empty" : "no safety block");
  const stepWarnings = active.reduce((k, s) => k + s.warnings.length, 0);
  add("warnings", frozenSafety.warnings.length > 0, true, frozenSafety.warnings.length ? `${frozenSafety.warnings.length} frozen warning(s)` : `none${stepWarnings ? ` (${stepWarnings} partner-facing step warning(s) exist, which safety.v1 does not carry)` : ""}`);
  add("prohibited_conditions", frozenSafety.prohibitedConditions.length > 0, true, `${frozenSafety.prohibitedConditions.length} condition(s)`);
  const ppeSteps = active.filter((s) => s.ppe.length);
  add("PPE", ppeSteps.length > 0, false, ppeSteps.length ? `${ppeSteps.length} step(s): ${[...new Set(ppeSteps.flatMap((s) => s.ppe))].join(", ")}` : "no step lists PPE");
  add("chemical_restrictions", false, false, "NO CANONICAL HOME: no typed field exists for chemical restrictions. Free text in safety.warnings / safety.prohibitedConditions is the only place such wording could live.");
  const age = obj(obj(view.customerPolicy).age);
  add("age_restrictions", hasText(age.mode), false, hasText(age.mode) ? `mode = ${age.mode}, version = ${obj(view.customerPolicy).version ?? "unset"}` : "no explicit customerPolicy.age (runtime reads unset as NONE)");
  add("medical_disclaimer", frozenSafety.medicalDisclaimer != null, false);
  add("emergency_protocol", frozenSafety.emergencyProtocol != null, true);
  add("incident_protocol", false, false, "NO CANONICAL HOME: there is no per-service incident protocol field. Incidents and safety holds are platform runtime; the per-service guidance is safety.emergencyProtocol.");

  /* ---- 6. quality ---- */
  const frozenQuality = cfg ? qualitySnapshot(cfg) : null;
  const checklist = texts(quality.checklist);
  const qualityHasContent = Object.keys(quality).some((k) => k !== "notApplicable");
  add("quality", qualityHasContent && !qualityOff, true, qualityOff ? "quality.notApplicable is true: no quality policy is frozen for a booking" : qualityHasContent ? undefined : "no quality block");
  add("quality_checklist", checklist.length > 0 && !qualityOff, true, qualityOff ? "ignored at runtime: quality.notApplicable is true" : `${checklist.length} item(s)${cfg && checklist.length && !frozenQuality ? " — but nothing is frozen" : ""}`);
  add("completion_criteria", texts(quality.completionCriteria).length > 0, false, "schema-only field: not frozen per booking, not read by the quality verdict");
  add("customer_confirmation", typeof quality.customerConfirmation === "boolean", false, typeof quality.customerConfirmation === "boolean" ? `= ${quality.customerConfirmation}${isInt(quality.confirmationWindowHours) ? `, window ${quality.confirmationWindowHours} h` : ""}` : "not set (runtime reads unset as false)");
  const proChecks = active.filter((s) => s.kind === "QUALITY_CHECK" && s.mandatory);
  add("professional_confirmation", proChecks.length > 0, true, proChecks.length ? `mandatory QUALITY_CHECK step: ${proChecks.map(label).join(", ")} (equivalent — no dedicated field)` : "no mandatory QUALITY_CHECK step (no dedicated field exists either)");

  /* ---- 7. warranty ---- */
  const warranty = obj(view.warranty);
  const rework = obj(view.rework);
  const frozenWarranty = buildWarrantySnapshot({ warranty: isObj(view.warranty) ? (warranty as never) : undefined, quality: isObj(view.quality) ? (quality as never) : undefined });
  const warrantyDecided = typeof warranty.enabled === "boolean" || typeof quality.warrantyDays === "number";
  add("warranty", warrantyDecided, false, warrantyDecided ? `frozen as enabled=${frozenWarranty.enabled}, ${frozenWarranty.durationDays} day(s)` : "not configured (a booking freezes enabled=false)");
  const days = typeof warranty.durationDays === "number" ? warranty.durationDays : typeof quality.warrantyDays === "number" ? quality.warrantyDays : null;
  const rowDays = opts.serviceRow?.warrantyDays;
  add("warranty_days", days != null, false, `${days != null ? `${days} day(s)` : "not set"}${rowDays != null ? `; a service-row value (${rowDays}) was supplied but \`services\` has no warranty column — it is not the canonical source` : ""}`);
  add("conditions", list(warranty.eligibleIssueTypes).length > 0 || texts(warranty.exclusions).length > 0 || hasText(warranty.startEvent) || typeof warranty.proofRequired === "boolean", false);
  add("revisit", Object.keys(rework).length > 0 || typeof warranty.reworkFirst === "boolean" || hasText(quality.revisitPolicy), false);
  add("complaint_window", typeof quality.complaintWindowDays === "number", false, typeof quality.complaintWindowDays === "number" ? `${quality.complaintWindowDays} day(s)` : "not set: a booking freezes 0 and a complaint resolves to NO_COMPLAINT_WINDOW");
  add("guarantee", hasText(obj(view.trust).guarantee), false, "free text, schema-only: nothing at runtime reads trust.guarantee");
  add("damage_policy", false, false, "NO CANONICAL HOME: no typed damage-policy field exists. Nearest facts: warranty.eligibleIssueTypes containing DAMAGE, trust.insuranceSupported.");

  /* ---- 8. classification ---- */
  const missingRequired = fields.filter((f) => f.required && !f.present).map((f) => f.concept);
  const status: Completeness = invalid.length ? "INVALID" : missingRequired.length ? "PARTIAL" : held ? "HELD" : "COMPLETE";
  return {
    slug,
    status,
    ...(held ? { heldReason: held.reason } : {}),
    fields,
    missingRequired,
    ...(invalid.length ? { invalidReasons: invalid } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Draft helpers (pure)                                                */
/* ------------------------------------------------------------------ */

/** A draft whose status is not DRAFT_FOR_OWNER_REVIEW is held: its method-dependent WORK steps are withheld. */
export function heldFromDraft(d: ServiceDraft | undefined): { reason: string } | null {
  if (!d || d.status === "DRAFT_FOR_OWNER_REVIEW") return null;
  return { reason: `${d.status}: ${d.openQuestions[0] ?? "method facts do not exist"}` };
}

/** The draft as it would stand on an EMPTY config (its Phase 06 requirements + execution / safety / quality). */
export function assessDraft(slug: string, d: ServiceDraft = DRAFT[slug]!): ServiceCompleteness {
  return assessService(slug, { ...{}, ...draftConfig(slug, d) }, { held: heldFromDraft(d) });
}

export function assessAllDrafts(): ServiceCompleteness[] {
  return Object.keys(DRAFT).sort().map((slug) => assessDraft(slug));
}

export function totals(rows: Array<{ status: Completeness }>): Record<Completeness, number> {
  const t: Record<Completeness, number> = { COMPLETE: 0, PARTIAL: 0, HELD: 0, INVALID: 0 };
  for (const r of rows) t[r.status] += 1;
  return t;
}

const line = (r: ServiceCompleteness) => `${r.status.padEnd(8)}  ${r.slug.padEnd(28)}  missing=[${r.missingRequired.join(", ")}]`;
const totalsLine = (rows: ServiceCompleteness[]) => {
  const t = totals(rows);
  return `TOTAL ${rows.length} services: COMPLETE=${t.COMPLETE} HELD=${t.HELD} PARTIAL=${t.PARTIAL} INVALID=${t.INVALID}`;
};

/** Concepts that do not gate the status, with the number of services that do not carry them. */
function reportedAbsent(rows: ServiceCompleteness[]): string[] {
  const out: string[] = [];
  for (const c of CONCEPTS.filter((x) => x.gating !== "REQUIRED")) {
    const absent = rows.filter((r) => r.fields.some((f) => f.concept === c.concept && !f.present && !f.required));
    if (absent.length) out.push(`  ${c.concept.padEnd(24)} absent on ${String(absent.length).padStart(2)} of ${rows.length}  ${c.canonicalPath ?? "(no canonical home)"}`);
  }
  return out;
}

function printInvalid(r: ServiceCompleteness, indent = "          ") {
  for (const x of r.invalidReasons ?? []) console.log(`${indent}! ${x}`);
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function runDraft(): number {
  console.log("[phase10-completeness] DRAFT mode — no database. Each draft is assessed on an empty config.\n");
  const rows = assessAllDrafts();
  for (const r of rows) {
    console.log(line(r));
    printInvalid(r);
  }
  console.log(`\n${totalsLine(rows)}`);
  console.log("\nNot gating the status (reported only):");
  for (const l of reportedAbsent(rows)) console.log(l);
  return rows.every((r) => r.status === "COMPLETE" || r.status === "HELD") ? 0 : 1;
}

function runMapping(): number {
  console.log("| group | concept | canonical path | gating | basis |");
  console.log("|---|---|---|---|---|");
  for (const c of CONCEPTS) console.log(`| ${c.group} | ${c.concept} | ${c.canonicalPath ?? "— none —"} | ${c.gating} | ${c.basis} |`);
  console.log(`\n${CONCEPTS.length} concepts · ${CONCEPTS.filter((c) => c.canonicalPath == null).length} with no canonical home`);
  return 0;
}

/**
 * READ-ONLY. One connection, `default_transaction_read_only = on` set and verified before any table is
 * read. `services` has no warranty column: warranty lives in catalog_config (`warranty`, legacy
 * `quality.warrantyDays`), so nothing but catalog_config is selected for it.
 */
async function runUrl(url: string): Promise<number> {
  const target = new URL(url);
  target.searchParams.set("connection_limit", "1"); // the session setting below must cover every query
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: target.toString() } } });
  try {
    await prisma.$executeRawUnsafe("SET default_transaction_read_only = on");
    const [ro] = await prisma.$queryRawUnsafe<Array<{ default_transaction_read_only: string }>>("SHOW default_transaction_read_only");
    if (ro?.default_transaction_read_only !== "on") {
      console.error("[phase10-completeness] REFUSING: the session is not read-only");
      return 2;
    }
    const [{ db }] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    console.log(`[phase10-completeness] LIVE mode — "${db}", read-only session. Nothing is written.\n`);

    const services = await prisma.service.findMany({
      where: { isActive: true, dataOrigin: null },
      select: { slug: true, version: true, catalogConfig: true, estimatedDuration: true },
      orderBy: { slug: "asc" },
    });
    const items = await prisma.serviceRequirementItem.findMany({ select: { code: true, kind: true, name: true, isActive: true } });
    const itemByCode = new Map(items.map((i) => [i.code, i]));
    /** Same hydration the server does: catalogue facts of the assigned items, attached as requirementItems. */
    const hydrate = (cfg: unknown): unknown => {
      if (!isObj(cfg)) return cfg;
      const facts: Obj = {};
      for (const r of list(cfg.requirements).map(obj)) {
        const it = hasText(r.itemCode) ? itemByCode.get(r.itemCode) : undefined;
        if (it) facts[it.code] = { code: it.code, kind: it.kind, name: it.name, isActive: it.isActive };
      }
      const { requirementItems: _stored, ...rest } = cfg;
      return Object.keys(facts).length ? { ...rest, requirementItems: facts } : rest;
    };

    const liveRows: ServiceCompleteness[] = [];
    const projectedRows: ServiceCompleteness[] = [];
    let noDraft = 0;
    for (const s of services) {
      const d = DRAFT[s.slug];
      const held = heldFromDraft(d);
      const serviceRow = { estimatedDuration: s.estimatedDuration };
      const live = assessService(s.slug, hydrate(s.catalogConfig), { held, serviceRow });
      liveRows.push(live);
      let projection: string;
      let projected: ServiceCompleteness | null = null;
      if (!d) {
        noDraft += 1;
        projection = "projected=NO_DRAFT";
      } else {
        // The same merge both apply paths use (buildNextConfig): phase10-content-apply-plan.ts for the 25
        // DRAFT_FOR_OWNER_REVIEW services, phase10-apply-held-safety.ts for the six held ones (safety +
        // quality + non-WORK execution steps; that script refuses a held draft carrying a WORK step).
        projected = assessService(s.slug, hydrate(buildNextConfig(s.catalogConfig, d)), { held, serviceRow });
        projectedRows.push(projected);
        projection = `projected=${projected.status} missing=[${projected.missingRequired.join(", ")}]${held ? " (via phase10-apply-held-safety.ts)" : ""}`;
      }
      console.log(`${live.status.padEnd(8)}  ${s.slug.padEnd(32)}  v${s.version}  missing=[${live.missingRequired.join(", ")}]  ${projection}`);
      printInvalid(live);
      if (projected?.invalidReasons?.length) for (const x of projected.invalidReasons) console.log(`          ! (projected) ${x}`);
    }
    const missingLive = Object.keys(DRAFT).filter((slug) => !services.some((s) => s.slug === slug));
    console.log(`\nLIVE       ${totalsLine(liveRows)}`);
    console.log(`PROJECTED  ${totalsLine(projectedRows)} · NO_DRAFT=${noDraft}`);
    if (missingLive.length) console.log(`Drafted but not an active non-fixture service: ${missingLive.join(", ")}`);
    console.log("\nNot gating the status (reported only) — LIVE:");
    for (const l of reportedAbsent(liveRows)) console.log(l);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const urlIdx = args.indexOf("--url");
  const url = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
  if (args.includes("--draft")) process.exit(runDraft());
  else if (args.includes("--mapping")) process.exit(runMapping());
  else if (urlIdx >= 0) {
    if (!url) {
      console.error("[phase10-completeness] REFUSING: --url needs a postgres url");
      process.exit(2);
    }
    runUrl(url).then((code) => process.exit(code)).catch((e) => {
      console.error(e);
      process.exit(1);
    });
  } else {
    console.error('usage: bun run scripts/phase10-service-completeness.ts --draft | --mapping | --url "<postgres url>"');
    process.exit(2);
  }
}
