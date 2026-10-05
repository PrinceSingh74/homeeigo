/**
 * Phase 10 — offline validator for the execution / safety / quality content DRAFT
 * (scripts/data/phase-10-execution-safety-content-draft.ts). Pure: no database, no network.
 *
 *   bun run scripts/phase10-content-validate.ts            # table + totals; exit 1 on any violation
 *   bun run scripts/phase10-content-validate.ts --json     # machine-readable report
 *
 * Every check uses the REAL runtime rules where they exist:
 *   - each service's execution/safety/quality is merged onto a minimal config (its Phase 06 requirements)
 *     and parsed with serviceCatalogConfigSchema — the same schema the admin write uses;
 *   - the plan goes through validateExecutionPlan (duplicates, cycles, unknown/unenforced safety links…)
 *     and resolveExecutionPlan (what a booking would freeze);
 *   - the safety block goes through buildSafetySnapshot (what a booking would freeze as safety.v1).
 * Plus content rules the runtime cannot know: requirement codes must exist in the Phase 06 content, no
 * step may contradict who provides materials/equipment, banned wording, concrete stop conditions, and
 * OWNER_APPROVAL_REQUIRED / SAFETY_HOLD services carry no WORK step.
 */
import { serviceCatalogConfigSchema } from "../src/lib/service-catalog-config";
import { resolveExecutionPlan, validateExecutionPlan } from "../src/lib/service-execution";
import { buildSafetySnapshot } from "../src/lib/service-safety";
import { CATALOGUE, CONTENT } from "./data/phase-06-requirement-content-final";
import { DRAFT, DRAFT_VERSION, GLOBAL_OPEN_QUESTIONS, STATUS_ORDER, derivedCompletionCriteria, derivedProductRestrictions, derivedResponsibility, type ServiceDraft } from "./data/phase-10-execution-safety-content-draft";

export type Violation = { service: string; rule: string; detail: string };
export type ServiceRow = {
  service: string;
  status: string;
  steps: number;
  work: number;
  safetyChecks: number;
  mandatory: number;
  evidence: string;
  safetyLinks: string[];
  prohibited: number;
  material: string;
  equipment: string;
  openQuestions: number;
  violations: number;
};
export type ValidationReport = { version: string; services: ServiceRow[]; violations: Violation[]; totals: Record<string, number> };

/* ------------------------------------------------------------------ */
/* Banned wording                                                      */
/* ------------------------------------------------------------------ */

/**
 * Chemical names, formulation / dilution / mixing wording, and measured quantities. "Refrigerant gas" is
 * deliberately NOT banned: it is the owner-approved Phase 06 category label (ac-refrigerant-gas), not a
 * chemical name; specific refrigerant designations (R22, R32, R410A, R134a) are.
 */
const CHEMICAL = [
  /bleach/i, /\bacid/i, /ammonia/i, /chlorin/i, /hypochlorite/i, /hydrochloric/i, /sul(ph|f)uric/i, /caustic/i, /\blye\b/i,
  /sodium/i, /potassium/i, /peroxide/i, /vinegar/i, /baking soda/i, /bicarbonate/i, /phenyl/i, /naphthalene/i, /kerosene/i,
  /turpentine/i, /thinner/i, /solvent/i, /white spirit/i, /methanol/i, /ethanol/i, /isopropyl/i, /alcohol/i, /formaldehyde/i, /glycol/i,
  /pesticide/i, /insecticide/i, /termiticide/i, /herbicide/i, /fungicide/i, /organophosph/i, /pyrethr/i, /cypermethrin/i,
  /chlorpyrifos/i, /imidacloprid/i, /fipronil/i, /deltamethrin/i, /boric/i, /\bR-?(22|32|410a?|134a)\b/i,
  /formula/i, /concentrat/i, /dilut/i, /mixing ratio/i, /\bmix with\b/i, /\bratio\b/i, /\bppm\b/i, /litre/i, /liter\b/i, /\bgrams?\b/i, /\bkg\b/i,
];
const CLAIMS = [/certif/i, /licen[cs]/i, /\binsur/i, /guarantee/i, /warrant/i, /\baccredit/i, /\bcomplian/i, /\blegal(ly)?\b/i];
const MEASURES = [/%/, /\bml\b/i];
const MEDICAL = [/diagnos/i, /\bcure/i, /prescri/i, /\bdos(e|age)\b/i, /therap/i, /symptom/i];
const HEIGHT_METHOD = [/scaffold/i, /harness/i, /rope access/i, /gondola/i, /cradle/i, /boom lift/i, /cherry picker/i, /abseil/i];
const ELECTRICAL_GAS_PROCEDURE = [/voltage/i, /\bvolts?\b/i, /multimeter/i, /megger/i, /earthing/i, /\brewir/i, /solder/i, /braz/i, /gas pressure/i, /recharge/i, /\bpurge/i, /live[- ]test/i];
/** Durations are allowed only in owner-facing openQuestions (which may quote the export). */
const DURATION = [/\b\d+(\.\d+)?\s*(secs?|seconds?|mins?|minutes?|hrs?|hours?|days?|weeks?)\b/i];

const BANNED: Array<[string, RegExp[]]> = [
  ["CHEMICAL_OR_FORMULATION", CHEMICAL],
  ["CLAIM", CLAIMS],
  ["MEASURE", MEASURES],
  ["MEDICAL", MEDICAL],
  ["HEIGHT_METHOD", HEIGHT_METHOD],
  ["ELECTRICAL_GAS_PROCEDURE", ELECTRICAL_GAS_PROCEDURE],
];

/** Every string in a value, with its path. */
function strings(v: unknown, path: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof v === "string") out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) strings(x, path ? `${path}.${k}` : k, out);
  return out;
}

/* ------------------------------------------------------------------ */
/* Responsibility (who provides what) — never contradicted             */
/* ------------------------------------------------------------------ */

/** Partner-addressed text ("you" = the professional). */
const PARTNER_SAYS_OWN_MATERIAL = /\byour (own )?(products|supplies|detergent|salon products)\b/i;
const PARTNER_SAYS_OWN_EQUIPMENT = /\b(your (own )?(equipment|machine|kit|salon kit)|take away your equipment)\b/i;
const PARTNER_SAYS_CUSTOMER_MATERIAL = /\b(customer'?s|home'?s|kitchen'?s) (own )?(products|supplies|detergent)\b/i;
const PARTNER_SAYS_CUSTOMER_EQUIPMENT = /\b(customer'?s|home'?s) (own )?(tools|equipment|machine|broom|mop|bucket)\b/i;
/** Customer-addressed text ("you" = the customer). */
const CUSTOMER_SAYS_THEIR_MATERIAL = /\byour (own )?(cleaning )?(products|supplies|detergent)\b|your own are used/i;
const CUSTOMER_SAYS_PRO_MATERIAL = /\b(professional'?s (own )?products|we bring (the )?products)\b/i;
const CUSTOMER_SAYS_THEIR_EQUIPMENT = /\byour (own )?(tools|broom|mop|bucket|equipment|machine)\b/i;
const CUSTOMER_SAYS_PRO_EQUIPMENT = /\b(professional'?s (own )?(equipment|machine|tools)|we bring (the )?(equipment|tools|machine))\b/i;

function policyViolations(slug: string, d: ServiceDraft): Violation[] {
  const out: Violation[] = [];
  const material = derivedResponsibility(slug, "MATERIAL");
  const equipment = derivedResponsibility(slug, "EQUIPMENT");
  const partnerText = strings(d.execution ?? {}, "execution");
  const customerText = [
    ...strings(d.customerSummary, "customerSummary"),
    ...strings({ information: d.safety?.information, warnings: d.safety?.warnings, chemicalRestrictions: d.safety?.chemicalRestrictions }, "safety"),
  ];
  const flag = (list: Array<[string, string]>, re: RegExp, rule: string, why: string) => {
    for (const [p, s] of list) if (re.test(s)) out.push({ service: slug, rule, detail: `${p}: "${s.slice(0, 90)}" — ${why}` });
  };
  if (material === "CUSTOMER_PROVIDED") {
    flag(partnerText, PARTNER_SAYS_OWN_MATERIAL, "POLICY_CONTRADICTION", "materials are customer-provided (Phase 06)");
    flag(customerText, CUSTOMER_SAYS_PRO_MATERIAL, "POLICY_CONTRADICTION", "materials are customer-provided (Phase 06)");
  }
  if (material === "PROFESSIONAL_PROVIDED") {
    flag(partnerText, PARTNER_SAYS_CUSTOMER_MATERIAL, "POLICY_CONTRADICTION", "materials are professional-provided (Phase 06)");
    flag(customerText, CUSTOMER_SAYS_THEIR_MATERIAL, "POLICY_CONTRADICTION", "materials are professional-provided (Phase 06)");
  }
  if (equipment === "CUSTOMER_PROVIDED") {
    flag(partnerText, PARTNER_SAYS_OWN_EQUIPMENT, "POLICY_CONTRADICTION", "equipment is customer-provided (Phase 06)");
    flag(customerText, CUSTOMER_SAYS_PRO_EQUIPMENT, "POLICY_CONTRADICTION", "equipment is customer-provided (Phase 06)");
  }
  if (equipment === "PROFESSIONAL_PROVIDED") {
    flag(partnerText, PARTNER_SAYS_CUSTOMER_EQUIPMENT, "POLICY_CONTRADICTION", "equipment is professional-provided (Phase 06)");
    flag(customerText, CUSTOMER_SAYS_THEIR_EQUIPMENT, "POLICY_CONTRADICTION", "equipment is professional-provided (Phase 06)");
  }
  // Equipment deliberately NOT_CONFIGURED on a hold (facade): nothing may promise it.
  if (CONTENT[slug]?.unconfigured?.EQUIPMENT) {
    flag(customerText, /\b(we bring|is included|are included|included equipment)\b/i, "POLICY_CONTRADICTION", "equipment is NOT_CONFIGURED on this service");
  }
  // Separate-quote items are never presented as included: each must be named under whatIsNotIncluded.
  const label = new Map(CATALOGUE.map((i) => [i.code, i.customerLabel]));
  for (const a of CONTENT[slug]?.assignments ?? []) {
    if (a.charge !== "SEPARATE_QUOTE") continue;
    const l = label.get(a.itemCode) ?? a.itemCode;
    if (!d.customerSummary.whatIsNotIncluded.some((x) => x.includes(l))) out.push({ service: slug, rule: "QUOTED_ITEM_NOT_DISCLOSED", detail: `"${l}" is SEPARATE_QUOTE but not listed under whatIsNotIncluded` });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Per-service validation                                              */
/* ------------------------------------------------------------------ */

const STATUSES = new Set(STATUS_ORDER as string[]);
const SAFETY_CLASS = new Set(CATALOGUE.filter((i) => i.preconditionClass === "SAFETY").map((i) => i.code));
const ENFORCED = new Set(["REQUIRED_BEFORE_BOOKING", "REQUIRED_BEFORE_ARRIVAL", "REQUIRED_AT_START"]);

/** The Phase 06 assignments of a service, as persisted (admin-only meta stripped). */
export function phase06Requirements(slug: string): Array<Record<string, unknown>> {
  return (CONTENT[slug]?.assignments ?? []).map(({ meta: _m, ...a }) => a as Record<string, unknown>);
}

/** Minimal valid config for a service: its Phase 06 requirements + the drafted keys. */
export function draftConfig(slug: string, d: ServiceDraft): Record<string, unknown> {
  return {
    requirements: phase06Requirements(slug),
    ...(d.execution ? { execution: d.execution } : {}),
    ...(d.safety ? { safety: d.safety } : {}),
    ...(d.quality ? { quality: d.quality } : {}),
  };
}

function validateService(slug: string, d: ServiceDraft): { row: ServiceRow; violations: Violation[] } {
  const v: Violation[] = [];
  const add = (rule: string, detail: string) => v.push({ service: slug, rule, detail });
  if (!STATUSES.has(d.status)) add("STATUS_INVALID", d.status);

  // 1. Real schema.
  const parsed = serviceCatalogConfigSchema.safeParse(draftConfig(slug, d));
  if (!parsed.success) for (const i of parsed.error.issues) add("SCHEMA", `${i.path.join(".")}: ${i.message}`);
  const cfg = parsed.success ? parsed.data : null;

  // 2. Real execution-plan validation + resolution (empty selection: no variants/add-ons on these services).
  const steps = cfg?.execution?.steps ?? [];
  if (cfg) {
    for (const i of validateExecutionPlan(cfg as never)) add(i.code, `${i.step ?? ""} ${i.message}`.trim());
    const res = resolveExecutionPlan(cfg as never, { variantId: null, addonIds: [], quantity: 1 } as never);
    if (!res.ok) add("RESOLVE", res.error);
    else if (res.steps.length !== steps.filter((s) => s.active).length) add("RESOLVE", `resolved ${res.steps.length} of ${steps.length} steps (conditional steps are not expected here)`);
    buildSafetySnapshot(cfg as never); // must not throw
  }
  if (!d.execution || !steps.length) add("EXECUTION_MISSING", "every service needs at least the non-procedural steps");

  // 3. Plan shape.
  const kinds = steps.map((s) => s.kind);
  if (steps.length) {
    if (steps[0]!.kind !== "PREPARATION") add("PLAN_SHAPE", "the first step must confirm scope (PREPARATION)");
    if (!kinds.includes("SAFETY_CHECK")) add("PLAN_SHAPE", "no SAFETY_CHECK step");
    if (!kinds.includes("QUALITY_CHECK")) add("PLAN_SHAPE", "no QUALITY_CHECK step");
    if (kinds[kinds.length - 1] !== "CLOSEOUT") add("PLAN_SHAPE", "the last step must be CLOSEOUT");
  }
  for (const s of steps) {
    if (s.mandatory && s.skipPolicy !== "NOT_SKIPPABLE") add("MANDATORY_SKIPPABLE", s.id);
    if (s.evidence === "BEFORE_AFTER_PHOTOS" && s.kind !== "WORK") add("EVIDENCE_MISPLACED", `${s.id}: before/after photos belong on a WORK step`);
    if (s.estimatedMinutes != null) add("DURATION_ASSERTED", `${s.id}: estimatedMinutes is not in the export`);
    if (s.when) add("CONDITION_UNSUPPORTED", `${s.id}: live services have no variants/add-ons to condition on`);
  }
  if (d.status !== "DRAFT_FOR_OWNER_REVIEW") {
    for (const s of steps) if (s.kind === "WORK") add("PROCEDURE_ON_HOLD", `${s.id}: a ${d.status} service carries no WORK step until the owner decides`);
    const own = d.openQuestions.filter((q) => !GLOBAL_OPEN_QUESTIONS.includes(q));
    if (!own.length) add("OPEN_QUESTION_MISSING", `${d.status} needs a service-specific open question naming the decision`);
  }
  if (d.quality?.beforeAfterPhotos && !steps.some((s) => s.evidence === "BEFORE_AFTER_PHOTOS")) {
    add("EVIDENCE_INCONSISTENT", "quality.beforeAfterPhotos is on but no step collects before/after photos");
  }

  // 4. Requirement codes: every link is a Phase 06 code of THIS service, enforced; every SAFETY-class gate is linked.
  const reqs = CONTENT[slug]?.assignments ?? [];
  const byId = new Map(reqs.map((a) => [a.id, a]));
  const links = steps.map((s) => s.safetyRequirement).filter((x): x is string => !!x);
  for (const l of links) {
    const a = byId.get(l);
    if (!a) add("REQUIREMENT_UNKNOWN", `${l} is not a Phase 06 requirement of ${slug}`);
    else if (!ENFORCED.has(a.enforcement ?? "")) add("REQUIREMENT_NOT_ENFORCED", `${l} is ${a.enforcement}`);
  }
  for (const a of reqs) {
    if (SAFETY_CLASS.has(a.itemCode) && ENFORCED.has(a.enforcement ?? "") && !links.includes(a.id)) add("SAFETY_GATE_UNLINKED", `${a.id} (SAFETY precondition) is not linked by any step`);
  }

  // 5. Safety block.
  const pcs = d.safety?.prohibitedConditions ?? [];
  if (!pcs.length) add("SAFETY_MISSING", "no prohibited conditions");
  if (!d.safety?.emergencyProtocol) add("SAFETY_MISSING", "no emergency protocol");
  if (!d.safety?.incidentProtocol) add("SAFETY_MISSING", "no incident protocol");
  // Derived fields must agree with what they are derived from — a hand edit that drifts is refused.
  const stepPpe = new Set(steps.flatMap((s) => s.ppe ?? []));
  const servicePpe = new Set(d.safety?.ppe ?? []);
  for (const p of stepPpe) if (!servicePpe.has(p)) add("SAFETY_PPE_INCOMPLETE", `a step asks for "${p}" but the service-level PPE list does not`);
  for (const p of servicePpe) if (!stepPpe.has(p)) add("SAFETY_PPE_UNSOURCED", `"${p}" is on the service-level PPE list but no step asks for it`);
  const expectedRestrictions = derivedProductRestrictions(slug, pcs);
  if (JSON.stringify(d.safety?.chemicalRestrictions ?? []) !== JSON.stringify(expectedRestrictions)) add("PRODUCT_RESTRICTION_DRIFT", "the product restriction does not match who provides the products (Phase 06)");
  if (d.quality && d.status === "DRAFT_FOR_OWNER_REVIEW") {
    const expected = derivedCompletionCriteria(d.execution?.steps ?? [], d.quality);
    if (JSON.stringify(d.quality.completionCriteria ?? []) !== JSON.stringify(expected)) add("COMPLETION_CRITERIA_DRIFT", "the completion criteria do not match the plan and the proof decision");
  }
  const workSteps = steps.filter((s) => s.kind === "WORK");
  for (const s of steps) {
    const claims = (s.materials?.length ?? 0) + (s.equipment?.length ?? 0) > 0;
    if (claims && !(workSteps.length === 1 && s.kind === "WORK")) add("STEP_ITEMS_UNSOURCED", `${s.id}: per-step materials/equipment are only derivable when the plan has exactly one WORK step`);
  }
  const seen = new Set<string>();
  for (const c of pcs) {
    if (seen.has(c.toLowerCase())) add("PROHIBITED_DUPLICATE", c);
    seen.add(c.toLowerCase());
    if (!/\b(stop|do not (start|proceed|touch|switch|open|clean|take|use))\b/i.test(c) || !/report it in the app/i.test(c)) add("PROHIBITED_NOT_ACTIONABLE", `"${c}" must say stop / do not proceed AND report it in the app`);
    if (!/ — /.test(c)) add("PROHIBITED_NOT_CONCRETE", `"${c}" must name an observable condition before the action`);
  }

  // 6. Customer summary.
  for (const k of ["whatHappens", "whatToPrepare", "whatIsNotIncluded", "whenWeStop"] as const) {
    if (!d.customerSummary?.[k]?.length) add("SUMMARY_MISSING", k);
  }

  // 7. Wording.
  for (const [p, s] of strings(d, "")) {
    for (const [rule, res] of BANNED) for (const re of res) if (re.test(s)) add(`BANNED_${rule}`, `${p}: ${re} in "${s.slice(0, 100)}"`);
    if (!p.startsWith("openQuestions")) for (const re of DURATION) if (re.test(s)) add("BANNED_DURATION", `${p}: "${s.slice(0, 100)}"`);
  }

  // 8. Responsibility.
  v.push(...policyViolations(slug, d));

  const ev = new Map<string, number>();
  for (const s of steps) ev.set(s.evidence ?? "NONE", (ev.get(s.evidence ?? "NONE") ?? 0) + 1);
  return {
    violations: v,
    row: {
      service: slug,
      status: d.status,
      steps: steps.length,
      work: kinds.filter((k) => k === "WORK").length,
      safetyChecks: kinds.filter((k) => k === "SAFETY_CHECK").length,
      mandatory: steps.filter((s) => s.mandatory).length,
      evidence: [...ev].filter(([k]) => k !== "NONE").map(([k, n]) => `${k}×${n}`).join(" ") || "-",
      safetyLinks: links,
      prohibited: pcs.length,
      material: derivedResponsibility(slug, "MATERIAL"),
      equipment: derivedResponsibility(slug, "EQUIPMENT"),
      openQuestions: d.openQuestions.length,
      violations: v.length,
    },
  };
}

export function validateDraft(draft: Record<string, ServiceDraft> = DRAFT): ValidationReport {
  const violations: Violation[] = [];
  const services: ServiceRow[] = [];
  const expected = Object.keys(CONTENT).sort();
  const got = Object.keys(draft).sort();
  for (const s of expected) if (!got.includes(s)) violations.push({ service: s, rule: "COVERAGE", detail: "live service has no draft entry" });
  for (const s of got) if (!expected.includes(s)) violations.push({ service: s, rule: "COVERAGE", detail: "draft entry for a service that is not in the Phase 06 content" });
  for (const slug of got) {
    const r = validateService(slug, draft[slug]!);
    services.push(r.row);
    violations.push(...r.violations);
  }
  const totals: Record<string, number> = { services: services.length, violations: violations.length };
  for (const st of STATUS_ORDER) totals[st] = services.filter((s) => s.status === st).length;
  totals.steps = services.reduce((n, s) => n + s.steps, 0);
  totals.prohibitedConditions = services.reduce((n, s) => n + s.prohibited, 0);
  return { version: DRAFT_VERSION, services, violations, totals };
}

if (import.meta.main) {
  const report = validateDraft();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[phase10-content] draft ${report.version} — offline validation (no database)\n`);
    console.log("| service | status | steps | work | safety checks | mandatory | evidence | safety links | prohibited | material | equipment | open Qs | violations |");
    console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of report.services) {
      console.log(`| ${r.service} | ${r.status} | ${r.steps} | ${r.work} | ${r.safetyChecks} | ${r.mandatory} | ${r.evidence} | ${r.safetyLinks.join(", ") || "-"} | ${r.prohibited} | ${r.material} | ${r.equipment} | ${r.openQuestions} | ${r.violations} |`);
    }
    console.log("");
    for (const x of report.violations) console.log(`VIOLATION ${x.service} ${x.rule}: ${x.detail}`);
    console.log(`\n[phase10-content] totals: ${Object.entries(report.totals).map(([k, n]) => `${k}=${n}`).join(" · ")}`);
  }
  process.exit(report.violations.length ? 1 : 0);
}
