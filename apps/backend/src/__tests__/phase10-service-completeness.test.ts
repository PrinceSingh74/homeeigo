/**
 * Phase 10 — service operational completeness audit (scripts/phase10-service-completeness.ts).
 * Pure unit test: no database, no network, nothing that imports Prisma.
 */
import { describe, expect, test } from "bun:test";
import { DRAFT } from "../../scripts/data/phase-10-execution-safety-content-draft";
import { CONCEPTS, assessAllDrafts, assessService, heldFromDraft, totals, type ServiceCompleteness } from "../../scripts/phase10-service-completeness";

/* ------------------------------------------------------------------ */
/* Fixture: a fully configured service (slug not in the Phase 06 content) */
/* ------------------------------------------------------------------ */

const REQUIREMENTS = [
  { id: "cleaning-solutions", itemCode: "cleaning-solutions", responsibility: "PROFESSIONAL", charge: "INCLUDED" },
  { id: "mop-and-bucket", itemCode: "mop-and-bucket", responsibility: "PROFESSIONAL", charge: "INCLUDED" },
  { id: "access-to-all-areas", itemCode: "access-to-all-areas", responsibility: "CUSTOMER", enforcement: "REQUIRED_BEFORE_ARRIVAL", verification: "PARTNER_CHECK" },
];

const SCOPE = { id: "confirm-scope", title: "Confirm the scope", kind: "PREPARATION", description: "Agree the rooms.", evidence: "NOTE", sortOrder: 10 };
const STOP = { id: "check-stop-conditions", title: "Check for stop conditions", kind: "SAFETY_CHECK", description: "Look for the listed conditions.", sortOrder: 20 };
const WORK = { id: "clean", title: "Clean the agreed rooms", kind: "WORK", description: "Top to bottom.", ppe: ["Gloves"], evidence: "BEFORE_AFTER_PHOTOS", sortOrder: 30 };
const WALK = { id: "quality-walkthrough", title: "Walk through the result", kind: "QUALITY_CHECK", description: "Show each room.", sortOrder: 40 };
const CLOSE = { id: "closeout", title: "Pack up", kind: "CLOSEOUT", description: "Leave the area tidy.", sortOrder: 50 };

const SAFETY = {
  information: "A whole-home clean.",
  warnings: ["Floors may be wet after mopping."],
  prohibitedConditions: ["Gas smell at the property — stop work and report it in the app"],
  emergencyProtocol: "If anyone is hurt: stop work and call 112, then report it in the app.",
};
const QUALITY = { checklist: ["Every agreed room cleaned"], proofRequired: true, beforeAfterPhotos: true };

function full(): Record<string, unknown> {
  return structuredClone({ requirements: REQUIREMENTS, execution: { steps: [SCOPE, STOP, WORK, WALK, CLOSE] }, safety: SAFETY, quality: QUALITY });
}
/** Drop one nested key from a copy of the full config. */
function without(path: string[]): Record<string, unknown> {
  const cfg = full();
  let cur: Record<string, unknown> = cfg;
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  delete cur[path[path.length - 1]!];
  return cfg;
}
const field = (r: ServiceCompleteness, concept: string) => r.fields.find((f) => f.concept === concept)!;
const HELD = { held: { reason: "OWNER_APPROVAL_REQUIRED: method facts do not exist" } };
const heldConfig = () => {
  const cfg = full();
  (cfg.execution as { steps: unknown[] }).steps = [SCOPE, STOP, WALK, CLOSE];
  (cfg.quality as { beforeAfterPhotos: boolean }).beforeAfterPhotos = false;
  return cfg;
};

/* ------------------------------------------------------------------ */

describe("assessService — classification", () => {
  test("a fully configured service is COMPLETE", () => {
    const r = assessService("test-service", full());
    expect(r.invalidReasons).toBeUndefined();
    expect(r.missingRequired).toEqual([]);
    expect(r.status).toBe("COMPLETE");
  });

  test.each([
    [["safety"], ["safety", "warnings", "prohibited_conditions", "emergency_protocol"]],
    [["safety", "warnings"], ["warnings"]],
    [["safety", "prohibitedConditions"], ["prohibited_conditions"]],
    [["safety", "emergencyProtocol"], ["emergency_protocol"]],
    [["quality"], ["quality", "quality_checklist", "proof_required", "before_after"]],
    [["quality", "checklist"], ["quality_checklist"]],
    [["quality", "proofRequired"], ["proof_required"]],
    [["execution"], ["step_number", "step_code", "step_title", "plan_scope_step", "plan_stop_check_step", "plan_closeout_step", "plan_work_step", "professional_confirmation"]],
  ])("removing %j → PARTIAL naming %j", (path, concepts) => {
    const r = assessService("test-service", without(path as string[]));
    expect(r.status).toBe("PARTIAL");
    for (const c of concepts) expect(r.missingRequired).toContain(c);
    expect(r.missingRequired.sort()).toEqual([...concepts].sort());
  });

  test("removing each plan-shape step names it", () => {
    const drop = (id: string) => {
      const cfg = full();
      (cfg.execution as { steps: Array<{ id: string }> }).steps = (cfg.execution as { steps: Array<{ id: string }> }).steps.filter((s) => s.id !== id);
      return cfg;
    };
    expect(assessService("t", drop("confirm-scope")).missingRequired).toEqual(["plan_scope_step"]);
    expect(assessService("t", drop("check-stop-conditions")).missingRequired).toEqual(["plan_stop_check_step"]);
    expect(assessService("t", drop("closeout")).missingRequired).toEqual(["plan_closeout_step"]);
    expect(assessService("t", drop("quality-walkthrough")).missingRequired).toEqual(["professional_confirmation"]);
    // Dropping the WORK step also removes the only BEFORE_AFTER_PHOTOS evidence while quality still demands it.
    const noWork = assessService("t", drop("clean"));
    expect(noWork.status).toBe("INVALID");
    expect(noWork.invalidReasons?.join("\n")).toContain("EVIDENCE_INCONSISTENT");
    const noWorkNoPhotos = drop("clean");
    (noWorkNoPhotos.quality as { beforeAfterPhotos: boolean }).beforeAfterPhotos = false;
    expect(assessService("t", noWorkNoPhotos).missingRequired).toEqual(["plan_work_step"]);
  });

  test("removing the MATERIAL / EQUIPMENT assignments → PARTIAL naming materials / equipment", () => {
    const only = (codes: string[]) => ({ ...full(), requirements: REQUIREMENTS.filter((r) => codes.includes(r.itemCode)) });
    expect(assessService("t", only(["mop-and-bucket", "access-to-all-areas"])).missingRequired).toEqual(["materials"]);
    expect(assessService("t", only(["cleaning-solutions", "access-to-all-areas"])).missingRequired).toEqual(["equipment"]);
    const none = assessService("t", only(["access-to-all-areas"]));
    expect(none.status).toBe("PARTIAL");
    expect(none.missingRequired.sort()).toEqual(["equipment", "materials"]);
  });

  test("an explicit NOT_REQUIRED policy resolves a resource; a Phase 06 noSpecial declaration does too", () => {
    const cfg = { ...full(), requirements: REQUIREMENTS.filter((r) => r.itemCode !== "mop-and-bucket"), equipmentPolicy: "NOT_REQUIRED" };
    expect(assessService("t", cfg).status).toBe("COMPLETE");
    // kitchen-cleaning declares EQUIPMENT as "nothing special" in the Phase 06 content.
    const r = assessService("kitchen-cleaning", { ...full(), requirements: REQUIREMENTS.filter((x) => x.itemCode !== "mop-and-bucket") });
    expect(field(r, "equipment").present).toBe(true);
    expect(field(r, "equipment").note).toContain("Phase 06");
  });

  test("held: safety + quality + non-method steps and no WORK step → HELD", () => {
    const r = assessService("t", heldConfig(), HELD);
    expect(r.status).toBe("HELD");
    expect(r.heldReason).toBe(HELD.held.reason);
    expect(r.missingRequired).toEqual([]);
    expect(field(r, "plan_work_step").required).toBe(false);
    expect(field(r, "materials").required).toBe(false);
  });

  test("held + a WORK step → INVALID", () => {
    const r = assessService("t", full(), HELD);
    expect(r.status).toBe("INVALID");
    expect(r.invalidReasons?.join("\n")).toContain("WORK_STEP_ON_HELD_SERVICE");
  });

  test("held but missing prohibited conditions → PARTIAL (never HELD)", () => {
    const cfg = heldConfig();
    delete (cfg.safety as Record<string, unknown>).prohibitedConditions;
    const r = assessService("t", cfg, HELD);
    expect(r.status).toBe("PARTIAL");
    expect(r.missingRequired).toEqual(["prohibited_conditions"]);
  });

  test("empty / missing / non-object config → INVALID (no requirements)", () => {
    for (const cfg of [{}, null, undefined, "x", [], { execution: { steps: [] } }]) {
      const r = assessService("t", cfg);
      expect(r.status).toBe("INVALID");
      expect(r.invalidReasons?.some((x) => x.startsWith("REQUIREMENTS_MISSING") || x.startsWith("CONFIG_"))).toBe(true);
    }
  });

  test("schema-invalid content → INVALID, named", () => {
    const noTitle = full();
    (noTitle.execution as { steps: Array<Record<string, unknown>> }).steps[2] = { ...WORK, title: "" };
    expect(assessService("t", noTitle).status).toBe("INVALID");
    expect(assessService("t", noTitle).invalidReasons?.join("\n")).toContain("EXECUTION_STEP_TITLE_MISSING");

    const dupCode = full();
    (dupCode.execution as { steps: unknown[] }).steps.push({ ...WORK, sortOrder: 35 });
    expect(assessService("t", dupCode).invalidReasons?.join("\n")).toContain("EXECUTION_STEP_CODE_DUPLICATE");

    const dupNumber = full();
    (dupNumber.execution as { steps: unknown[] }).steps.push({ ...WORK, id: "clean-2", sortOrder: 30 });
    expect(assessService("t", dupNumber).invalidReasons?.join("\n")).toContain("EXECUTION_STEP_NUMBER_DUPLICATE");

    const unknownKey = { ...full(), somethingNew: true };
    expect(assessService("t", unknownKey).status).toBe("INVALID");

    const badSafetyLink = full();
    (badSafetyLink.execution as { steps: Array<Record<string, unknown>> }).steps[1] = { ...STOP, safetyRequirement: "not-a-requirement" };
    expect(assessService("t", badSafetyLink).invalidReasons?.join("\n")).toContain("EXECUTION_SAFETY_LINK_UNKNOWN");

    const skippableMandatory = full();
    (skippableMandatory.execution as { steps: Array<Record<string, unknown>> }).steps[2] = { ...WORK, mandatory: true, skipPolicy: "SKIP_WITH_REASON" };
    expect(assessService("t", skippableMandatory).status).toBe("INVALID");
  });

  test("quality.notApplicable never lets a service pass", () => {
    const cfg = full();
    (cfg.quality as Record<string, unknown>).notApplicable = true;
    const r = assessService("t", cfg);
    expect(r.status).toBe("PARTIAL");
    expect(r.missingRequired).toEqual(["quality", "quality_checklist"]);
  });
});

describe("assessService — concept mapping", () => {
  const ALL = [
    "step_number", "step_code", "step_title", "description", "estimated_time",
    "materials", "equipment",
    "proof", "proof_required", "before_after",
    "safety", "warnings", "prohibited_conditions", "PPE", "chemical_restrictions", "age_restrictions", "medical_disclaimer", "emergency_protocol", "incident_protocol",
    "quality", "quality_checklist", "completion_criteria", "customer_confirmation", "professional_confirmation",
    "warranty", "warranty_days", "conditions", "revisit", "complaint_window", "guarantee", "damage_policy",
  ];

  test("every concept is reported once, with its canonical path", () => {
    const r = assessService("test-service", full());
    for (const c of ALL) expect(r.fields.filter((f) => f.concept === c)).toHaveLength(1);
    expect(CONCEPTS.map((c) => c.concept)).toEqual(ALL);
  });

  test("concepts with no canonical home are never present and never required", () => {
    const r = assessService("test-service", full());
    for (const c of ["chemical_restrictions", "incident_protocol", "damage_policy"]) {
      const f = field(r, c);
      expect(f.canonicalPath).toBeNull();
      expect(f.present).toBe(false);
      expect(f.required).toBe(false);
      expect(f.note).toContain("NO CANONICAL HOME");
    }
  });

  test("optional policies are reported when present and do not gate the status", () => {
    const cfg = {
      ...full(),
      warranty: { enabled: true, durationDays: 7, eligibleIssueTypes: ["QUALITY"], exclusions: ["Normal wear"] },
      rework: { fee: "WAIVED" },
      trust: { guarantee: "Rework first." },
      customerPolicy: { age: { mode: "NONE" }, version: 1 },
      quality: { ...QUALITY, complaintWindowDays: 3, customerConfirmation: true, completionCriteria: ["Rooms clean"] },
    };
    const r = assessService("test-service", cfg);
    expect(r.status).toBe("COMPLETE");
    for (const c of ["warranty", "warranty_days", "conditions", "revisit", "complaint_window", "guarantee", "age_restrictions", "customer_confirmation", "completion_criteria"]) {
      expect(field(r, c).present).toBe(true);
      expect(field(r, c).required).toBe(false);
    }
    const bare = assessService("test-service", full());
    for (const c of ["warranty", "warranty_days", "complaint_window", "age_restrictions"]) expect(field(bare, c).present).toBe(false);
  });
});

describe("the 31 drafts", () => {
  const rows = assessAllDrafts();
  const byStatus = totals(rows);

  test("31 drafts, none INVALID", () => {
    expect(rows).toHaveLength(31);
    expect(Object.keys(DRAFT)).toHaveLength(31);
    expect(rows.filter((r) => r.status === "INVALID").map((r) => `${r.slug}: ${r.invalidReasons?.join("; ")}`)).toEqual([]);
  });

  test("the six held drafts (OWNER_APPROVAL_REQUIRED / SAFETY_HOLD) are HELD", () => {
    const held = Object.keys(DRAFT).filter((s) => heldFromDraft(DRAFT[s]) != null).sort();
    expect(held).toEqual(["ac-service", "electrician", "fasade-cleaning", "home-painting", "pest-control", "plumbing"]);
    for (const slug of held) expect(`${slug}=${rows.find((r) => r.slug === slug)!.status}`).toBe(`${slug}=HELD`);
    expect(byStatus.HELD).toBe(6);
  });

  test("every draft is COMPLETE or HELD (25 COMPLETE / 6 HELD)", () => {
    const notOk = rows.filter((r) => r.status !== "COMPLETE" && r.status !== "HELD").map((r) => `${r.slug} ${r.status} missing=[${r.missingRequired.join(", ")}]`);
    expect(notOk).toEqual([]);
    expect(byStatus.COMPLETE).toBe(25);
  });
});
