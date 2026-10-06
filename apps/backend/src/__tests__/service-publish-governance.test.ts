/**
 * Service control plane (pure): the publish rail the admin sees and the gate the server enforces are
 * one function, and a publish approval is bound to the content that was approved.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  approvalContentHash,
  CONTROL_PLANE_STATES,
  contentDiff,
  controlPlaneState,
  evaluatePublishApproval,
  liveEditPolicyFor,
  liveEditRegressions,
  platformPolicyIssues,
  PUBLISH_GATES,
  publishGateResults,
  publishRequiredSections,
  validateForActivation,
} from "../lib/service-domain";
import { catalogConfigGaps, serviceCatalogConfigSchema } from "../lib/service-catalog-config";

const core = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  name: "Bathroom Cleaning",
  slug: "bathroom-cleaning",
  description: "Deep bathroom sanitisation and descaling",
  category: "cleaning",
  basePrice: 199,
  minPrice: 199,
  maxPrice: 199,
  estimatedDuration: 40,
  pricingModel: "fixed",
  isActive: false,
  capabilityProfile: "GENERAL",
  categoryId: "sc_home_cleaning",
  ...over,
});
const policies = serviceCatalogConfigSchema.parse({ materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED" });

const blockingCodes = (service: ReturnType<typeof core>, cfg: typeof policies | null, grandfathered: boolean) =>
  publishGateResults(service, cfg, { grandfathered })
    .filter((g) => g.severity === "critical" && (g.status === "FAIL" || g.status === "BLOCKED"))
    .map((g) => g.code)
    .sort();

describe("the enforced gate is the displayed gate", () => {
  const cases: [string, ReturnType<typeof core>, typeof policies | null, boolean][] = [
    ["a complete service", core(), policies, false],
    ["no description", core({ description: "  " }), policies, false],
    ["no price", core({ basePrice: 0 }), policies, false],
    ["no policies, first activation", core(), null, false],
    ["no policies, already live", core({ isActive: true }), null, true],
    ["no category", core({ categoryId: null }), policies, false],
  ];
  for (const [label, service, cfg, grandfathered] of cases) {
    test(`${label}: activation is refused exactly when the rail shows a critical failure`, () => {
      const shown = blockingCodes(service, cfg, grandfathered);
      const enforced = validateForActivation(service, cfg, { grandfathered });
      expect(enforced.ok).toBe(shown.length === 0);
      if (!enforced.ok) expect(enforced.issues.map((i) => i.code).sort()).toEqual(shown);
    });
  }

  test("a description that mentions matching is not reported as a partner brief leak", () => {
    const gates = publishGateResults(core({ description: "Colour matching and touch-up for painted walls" }), policies);
    expect(gates.some((g) => g.code === "PARTNER_BRIEF_LEAK")).toBe(false);
    expect(validateForActivation(core({ description: "Colour matching and touch-up for painted walls" }), policies).ok).toBe(true);
  });
});

describe("the nine control-plane states", () => {
  const at = new Date("2026-10-06T12:00:00+05:30");
  const state = (lifecycleStatus: string, approvalState: "NONE" | "VALID" | "STALE" = "NONE", scheduledLiveAt: string | null = null) =>
    controlPlaneState({ lifecycleStatus, approvalState, scheduledLiveAt, now: at });

  test("each stored lifecycle maps to exactly one of the nine states", () => {
    expect(CONTROL_PLANE_STATES).toEqual(["DRAFT", "VALIDATING", "REVIEW", "APPROVED", "SCHEDULED", "LIVE", "PAUSED", "DEPRECATED", "ARCHIVED"]);
    expect(state("DRAFT")).toBe("DRAFT");
    expect(state("CONFIGURATION_REQUIRED")).toBe("VALIDATING");
    expect(state("READY_FOR_REVIEW")).toBe("REVIEW");
    expect(state("ACTIVE")).toBe("LIVE");
    expect(state("PUBLISHED")).toBe("LIVE");
    expect(state("PAUSED")).toBe("PAUSED");
    expect(state("DEPRECATED")).toBe("DEPRECATED");
    expect(state("ARCHIVED")).toBe("ARCHIVED");
  });

  test("in review, a valid approval is APPROVED and a future go-live time is SCHEDULED", () => {
    expect(state("READY_FOR_REVIEW", "VALID")).toBe("APPROVED");
    expect(state("READY_FOR_REVIEW", "VALID", "2026-10-07T09:00:00+05:30")).toBe("SCHEDULED");
    // A go-live time that has passed is no longer a schedule: the service is approved and due.
    expect(state("READY_FOR_REVIEW", "VALID", "2026-10-05T09:00:00+05:30")).toBe("APPROVED");
  });

  test("a stale or missing approval is still REVIEW, whatever time is stored", () => {
    expect(state("READY_FOR_REVIEW", "STALE", "2026-10-07T09:00:00+05:30")).toBe("REVIEW");
    expect(state("READY_FOR_REVIEW", "NONE", "2026-10-07T09:00:00+05:30")).toBe("REVIEW");
  });

  test("an approval does not relabel a paused or live service", () => {
    expect(state("PAUSED", "VALID")).toBe("PAUSED");
    expect(state("ACTIVE", "VALID", "2026-10-07T09:00:00+05:30")).toBe("LIVE");
  });
});

describe("the eighteen publish gates", () => {
  const complete = serviceCatalogConfigSchema.parse({
    ...policies,
    safety: { prohibitedConditions: ["Gas smell in the room"], incidentProtocol: "Stop work, make the area safe and call support" },
    quality: { checklist: ["Work area left clean"], completionCriteria: ["Customer shown the finished work"] },
    execution: { steps: [{ id: "clean", title: "Clean the bathroom", kind: "WORK" }] },
    providerRequirements: { requiredSkills: ["cleaning"] },
    coverage: { cityIds: ["pune"] },
    availability: { operatingWindow: { start: "08:00", end: "20:00" } },
  });
  const byGate = (cfg: typeof policies | null, over: Record<string, unknown> = {}) => {
    const map = new Map<string, string[]>();
    for (const g of publishGateResults(core(over), cfg, { required: [] })) map.set(g.gate, [...(map.get(g.gate) ?? []), g.status]);
    return map;
  };

  test("every named gate reports a status for every service: none is silently absent", () => {
    for (const cfg of [complete, policies, null]) {
      const gates = byGate(cfg);
      for (const name of PUBLISH_GATES) expect({ gate: name, reported: gates.has(name) }).toEqual({ gate: name, reported: true });
    }
    expect(PUBLISH_GATES).toHaveLength(18);
  });

  test("the admin console lists the same eighteen gates, in the same order", () => {
    const panel = readFileSync(join(import.meta.dir, "../../../admin-panel/src/components/services/ServiceGovernancePanels.tsx"), "utf8");
    const listed = [...panel.matchAll(/^\s*\["([A-Z_]+)", "[^"]+"\],$/gm)].map((m) => m[1]);
    expect(listed).toEqual([...PUBLISH_GATES]);
  });

  test("a complete service passes every gate that applies to it", () => {
    const gates = byGate(complete);
    for (const [gate, statuses] of gates) {
      expect({ gate, bad: statuses.filter((s) => s === "FAIL" || s === "BLOCKED" || s === "WARNING") }).toEqual({ gate, bad: [] });
    }
    for (const name of ["PRICING", "DURATION", "MATERIALS", "EQUIPMENT", "CUSTOMER_CONTENT", "SAFETY", "QUALITY", "PARTNER_EXECUTION_BRIEF", "AVAILABILITY", "SERVICEABILITY", "PROVIDER_REQUIREMENTS", "BOOKING_POLICY", "CANCELLATION", "REFUND"]) {
      const statuses = gates.get(name) ?? [];
      expect({ gate: name, allPass: statuses.length > 0 && statuses.every((s) => s === "PASS") }).toEqual({ gate: name, allPass: true });
    }
  });

  test("availability that can never produce a slot blocks: closed window, same-day with a day of lead time, lead time beyond the booking horizon, nothing bookable", () => {
    const bad = [
      { operatingWindow: { start: "20:00", end: "08:00" } },
      { operatingWindow: { start: "09:00", end: "09:00" } },
      { sameDay: true, minimumLeadTimeMinutes: 60 * 24 },
      { minimumLeadTimeMinutes: 60 * 24 * 3, maximumAdvanceDays: 2 },
      { instant: false, scheduled: false },
      { allDay: true, operatingWindow: { start: "08:00", end: "20:00" } },
    ];
    for (const availability of bad) {
      const cfg = serviceCatalogConfigSchema.parse({ ...policies, availability });
      const r = validateForActivation(core(), cfg, { required: [] });
      expect({ availability, ok: r.ok, codes: r.ok ? [] : r.issues.map((i) => i.code) }).toEqual({ availability, ok: false, codes: ["AVAILABILITY_INVALID"] });
    }
  });

  test("a service that demands a serviceability check but names no area blocks", () => {
    const cfg = serviceCatalogConfigSchema.parse({ ...policies, coverage: { serviceabilityRequired: true } });
    const r = validateForActivation(core(), cfg, { required: [] });
    expect(r.ok ? [] : r.issues.map((i) => i.code)).toEqual(["COVERAGE_INVALID"]);
    const withArea = serviceCatalogConfigSchema.parse({ ...policies, coverage: { serviceabilityRequired: true, pincodes: ["411001"] } });
    expect(validateForActivation(core(), withArea, { required: [] }).ok).toBe(true);
    // City restriction on the row counts as an area too.
    expect(validateForActivation(core({ availableCities: ["Pune"] }), cfg, { required: [] }).ok).toBe(true);
  });

  test("matching weights that are all zero cannot rank anyone, and block", () => {
    const cfg = serviceCatalogConfigSchema.parse({ ...policies, matching: { distanceWeight: 0, ratingWeight: 0 } });
    const r = validateForActivation(core(), cfg, { required: [] });
    expect(r.ok ? [] : r.issues.map((i) => i.code)).toEqual(["MATCHING_INVALID"]);
    const ranked = serviceCatalogConfigSchema.parse({ ...policies, matching: { distanceWeight: 0.6, ratingWeight: 0 } });
    expect(validateForActivation(core(), ranked, { required: [] }).ok).toBe(true);
    // A flag alone (no weights) keeps the platform weights.
    const flag = serviceCatalogConfigSchema.parse({ ...policies, matching: { preferredProvider: true } });
    expect(validateForActivation(core(), flag, { required: [] }).ok).toBe(true);
  });

  test("a required training module that does not exist or is not published blocks: nobody could ever be matched", () => {
    const cfg = serviceCatalogConfigSchema.parse({ ...policies, providerRequirements: { trainingModules: ["deep-clean-basics", "ladder-safety"] } });
    const r = validateForActivation(core(), cfg, { required: [], unavailableTrainingModules: ["ladder-safety"] });
    expect(r.ok ? [] : r.issues.map((i) => i.code)).toEqual(["TRAINING_MODULE_UNAVAILABLE"]);
    const gate = publishGateResults(core(), cfg, { required: [], unavailableTrainingModules: ["ladder-safety"] }).find((g) => g.code === "TRAINING_MODULE_UNAVAILABLE");
    expect(gate).toMatchObject({ gate: "PROVIDER_REQUIREMENTS", status: "FAIL", severity: "critical" });
    expect(gate?.message).toContain("ladder-safety");
    expect(gate?.message).not.toContain("deep-clean-basics");
    // Every required module available: no finding.
    expect(validateForActivation(core(), cfg, { required: [], unavailableTrainingModules: [] }).ok).toBe(true);
  });

  test("on a live service the same finding is a warning that says it cannot be matched, not an unpublish", () => {
    const cfg = serviceCatalogConfigSchema.parse({ ...policies, providerRequirements: { trainingModules: ["ladder-safety"] } });
    const gates = publishGateResults(core({ isActive: true }), cfg, { grandfathered: true, required: [], unavailableTrainingModules: ["ladder-safety"] });
    expect(gates.find((g) => g.code === "TRAINING_MODULE_UNAVAILABLE")).toMatchObject({ status: "WARNING", severity: "warning" });
    expect(validateForActivation(core({ isActive: true }), cfg, { grandfathered: true, required: [], unavailableTrainingModules: ["ladder-safety"] }).ok).toBe(true);
  });

  test("booking policy, cancellation and refund are checked against the platform policy every booking freezes", () => {
    const gates = publishGateResults(core(), policies, { required: [] });
    for (const name of ["BOOKING_POLICY", "CANCELLATION", "REFUND"]) {
      const g = gates.find((x) => x.gate === name);
      expect(g?.status).toBe("PASS");
      expect(g?.message).toContain("cancellation.v2");
    }
  });

  test("a platform policy whose fee and refund do not add up blocks every publish", () => {
    const broken = { version: "cancellation.bad", tiers: [{ id: "free", feePercent: 10, refundPercent: 100, message: "x" }] };
    expect(platformPolicyIssues(broken).length).toBeGreaterThan(0);
    const gates = publishGateResults(core(), policies, { required: [], platformPolicy: broken });
    for (const name of ["CANCELLATION", "REFUND"]) {
      expect(gates.find((x) => x.gate === name)).toMatchObject({ status: "FAIL", severity: "critical", code: "PLATFORM_POLICY_INVALID" });
    }
    expect(validateForActivation(core(), policies, { required: [], platformPolicy: broken }).ok).toBe(false);
  });

  test("the platform policy in force is itself valid", () => {
    expect(platformPolicyIssues()).toEqual([]);
  });
});

describe("owner-required sections", () => {
  test("by default an absent safety, quality or execution section is a warning and does not block", () => {
    const gates = publishGateResults(core(), policies, { required: [] });
    expect(gates.find((g) => g.code === "SAFETY_ABSENT")?.status).toBe("WARNING");
    expect(validateForActivation(core(), policies, { required: [] }).ok).toBe(true);
  });

  test("a section the owner requires blocks a first publish when it is absent, and says which", () => {
    const r = validateForActivation(core(), policies, { required: ["safety", "quality", "execution"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code).sort()).toEqual(["EXECUTION_ABSENT", "QUALITY_ABSENT", "SAFETY_ABSENT"]);
    const gate = publishGateResults(core(), policies, { required: ["safety"] }).find((g) => g.code === "SAFETY_ABSENT");
    expect(gate).toMatchObject({ status: "BLOCKED", severity: "critical" });
  });

  test("a required section that is configured passes", () => {
    const cfg = serviceCatalogConfigSchema.parse({ ...policies, safety: { prohibitedConditions: ["Gas smell in the room"], incidentProtocol: "Stop work, make the area safe and call support" } });
    expect(validateForActivation(core(), cfg, { required: ["safety"] }).ok).toBe(true);
  });

  test("an already-live service is not unpublished by a newly required section", () => {
    expect(validateForActivation(core({ isActive: true }), policies, { grandfathered: true, required: ["safety", "quality"] }).ok).toBe(true);
  });

  test("the requirement list is read from SERVICE_PUBLISH_REQUIRES, whatever separates the names", () => {
    expect(publishRequiredSections("safety, quality ,EXECUTION")).toEqual(["safety", "quality", "execution"]);
    expect(publishRequiredSections("safety;quality execution")).toEqual(["safety", "quality", "execution"]);
    expect(publishRequiredSections(undefined)).toEqual([]);
  });

  test("a name it does not recognise never loosens the gate: the deployed defaults are required as well", () => {
    // A typo used to be dropped silently, so "saftey" alone required nothing at all.
    expect(publishRequiredSections("saftey", true)).toEqual(["safety", "quality", "execution"]);
    expect(publishRequiredSections("coverage,nonsense", true)).toEqual(["coverage", "safety", "quality", "execution"]);
    expect(publishRequiredSections("none", true)).toEqual([]);
  });

  test("the configuration status agrees with the gate that NOT_SPECIFIED is not a policy", () => {
    const gaps = catalogConfigGaps(core(), serviceCatalogConfigSchema.parse({ materialPolicy: "NOT_SPECIFIED", equipmentPolicy: "NOT_SPECIFIED" }));
    expect(gaps).toEqual(expect.arrayContaining(["Materials policy not specified", "Equipment policy not specified"]));
  });

  test("with nothing configured, a deployed environment requires safety, quality and an execution plan; a developer machine requires nothing", () => {
    expect(publishRequiredSections(undefined, false)).toEqual(["safety", "quality", "execution"]);
    expect(publishRequiredSections("", false)).toEqual(["safety", "quality", "execution"]);
    expect(publishRequiredSections(undefined, true)).toEqual([]);
  });

  test("the owner can require nothing, or something else, anywhere", () => {
    expect(publishRequiredSections("none", false)).toEqual([]);
    expect(publishRequiredSections("coverage", false)).toEqual(["coverage"]);
    expect(publishRequiredSections("safety", true)).toEqual(["safety"]);
  });
});

describe("who may change a live service", () => {
  test("an explicit setting wins everywhere", () => {
    expect(liveEditPolicyFor({ configured: "four-eyes", knownLocal: true, approverCount: 0 }).policy).toBe("four-eyes");
    expect(liveEditPolicyFor({ configured: "direct", knownLocal: false, approverCount: 9 }).policy).toBe("direct");
  });
  test("deployed with nothing configured: four-eyes as soon as two admins can approve", () => {
    expect(liveEditPolicyFor({ configured: undefined, knownLocal: false, approverCount: 2 })).toEqual({ policy: "four-eyes", source: "auto" });
    expect(liveEditPolicyFor({ configured: "", knownLocal: false, approverCount: 5 }).policy).toBe("four-eyes");
  });
  test("deployed with a single approver: direct, so the only admin is not locked out of the catalogue", () => {
    expect(liveEditPolicyFor({ configured: undefined, knownLocal: false, approverCount: 1 })).toEqual({ policy: "direct", source: "auto" });
    expect(liveEditPolicyFor({ configured: undefined, knownLocal: false, approverCount: 0 }).policy).toBe("direct");
  });
  test("a developer machine or test runner with nothing configured: direct", () => {
    expect(liveEditPolicyFor({ configured: undefined, knownLocal: true, approverCount: 9 })).toEqual({ policy: "direct", source: "local-default" });
  });
  test("an unrecognised setting is not treated as direct", () => {
    expect(liveEditPolicyFor({ configured: "foureyes", knownLocal: false, approverCount: 2 }).policy).toBe("four-eyes");
  });
});

describe("what changed between two versions", () => {
  test("lists each changed selling field and config section with before and after, and nothing else", () => {
    const changes = contentDiff(core(), policies, core({ basePrice: 249, description: "New words" }), { ...policies, materialPolicy: "CUSTOMER_PROVIDED" });
    expect(changes).toEqual([
      { field: "description", before: "Deep bathroom sanitisation and descaling", after: "New words" },
      { field: "basePrice", before: 199, after: 249 },
      { field: "config.materialPolicy", before: "PROFESSIONAL_PROVIDED", after: "CUSTOMER_PROVIDED" },
    ]);
  });
  test("identical content has no changes, whatever the approval record says", () => {
    expect(
      contentDiff(core(), policies, core(), { ...policies, publishApproval: { actorId: "a", editorId: "e", approvedAt: "2026-10-06T00:00:00Z", version: 1 } }),
    ).toEqual([]);
  });
});

describe("approval is bound to the approved content", () => {
  test("the hash ignores key order, the approval record and the schedule", () => {
    const a = approvalContentHash(core(), { ...policies, comingSoon: false });
    const b = approvalContentHash(core(), {
      comingSoon: false,
      equipmentPolicy: "PROFESSIONAL_PROVIDED",
      materialPolicy: "PROFESSIONAL_PROVIDED",
      scheduledLiveAt: "2099-01-01T00:00:00+05:30",
      publishApproval: { actorId: "a", editorId: "e", approvedAt: "2026-10-06T00:00:00Z", version: 1 },
    });
    expect(a).toBe(b);
  });

  test("a price, duration or description change gives a different hash", () => {
    const base = approvalContentHash(core(), policies);
    expect(approvalContentHash(core({ basePrice: 249 }), policies)).not.toBe(base);
    expect(approvalContentHash(core({ estimatedDuration: 45 }), policies)).not.toBe(base);
    expect(approvalContentHash(core({ description: "Something else" }), policies)).not.toBe(base);
    expect(approvalContentHash(core(), { ...policies, materialPolicy: "CUSTOMER_PROVIDED" })).not.toBe(base);
  });

  test("an approval of other content is stale", () => {
    const approved = approvalContentHash(core(), policies);
    const current = approvalContentHash(core({ basePrice: 249 }), policies);
    const input = { approverId: "approver", editorId: "editor", approvedEditorId: "editor", approverHasApprove: true };
    expect(evaluatePublishApproval({ ...input, approvedContentHash: approved, currentContentHash: approved })).toEqual({ ok: true });
    expect(evaluatePublishApproval({ ...input, approvedContentHash: approved, currentContentHash: current })).toEqual({ ok: false, code: "APPROVAL_STALE" });
    expect(evaluatePublishApproval({ ...input, approvedContentHash: null, currentContentHash: current })).toEqual({ ok: false, code: "APPROVAL_STALE" });
  });
});

/**
 * Audit of 2026-10-06: several gates answered PASS without looking at anything real — an empty
 * safety object, quality marked "not applicable", a materials policy of NOT_SPECIFIED, a ₹0
 * variant — and an edit to a live service ran a gate so lenient that the sections a first publish
 * requires could be deleted from it afterwards.
 */
describe("a gate passes on content, not on the presence of a key", () => {
  const parse = (extra: Record<string, unknown>) => serviceCatalogConfigSchema.parse({ ...policies, ...extra });
  const statusOf = (cfg: typeof policies, gate: string) => publishGateResults(core(), cfg, { required: [] }).filter((g) => g.gate === gate).map((g) => `${g.code}:${g.status}`);

  test("an empty safety object, or one holding only blank lists, is absent safety information", () => {
    expect(statusOf(parse({ safety: {} }), "SAFETY")).toEqual(["SAFETY_ABSENT:WARNING"]);
    expect(statusOf(parse({ safety: { warnings: [], ppe: [] } }), "SAFETY")).toEqual(["SAFETY_ABSENT:WARNING"]);
    expect(statusOf(parse({ safety: { prohibitedConditions: ["Gas smell in the room"], incidentProtocol: "Stop work, make the area safe and call support" } }), "SAFETY")).toEqual(["SAFETY:PASS"]);
    expect(validateForActivation(core(), parse({ safety: {} }), { required: ["safety"] }).ok).toBe(false);
  });

  test("quality marked not applicable, or holding only a warranty number, is not a quality standard", () => {
    expect(statusOf(parse({ quality: { notApplicable: true } }), "QUALITY")).toEqual(["QUALITY_ABSENT:WARNING"]);
    expect(statusOf(parse({ quality: { warrantyDays: 30 } }), "QUALITY")).toEqual(["QUALITY_ABSENT:WARNING"]);
    expect(statusOf(parse({ quality: { checklist: ["Work area left clean"], completionCriteria: ["Customer shown the finished work"] } }), "QUALITY")).toEqual(["QUALITY:PASS"]);
    expect(validateForActivation(core(), parse({ quality: { notApplicable: true } }), { required: ["quality"] }).ok).toBe(false);
  });

  test("NOT_SPECIFIED is not a materials or equipment policy", () => {
    const cfg = serviceCatalogConfigSchema.parse({ materialPolicy: "NOT_SPECIFIED", equipmentPolicy: "NOT_SPECIFIED" });
    const r = validateForActivation(core(), cfg, { required: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code).sort()).toEqual(["EQUIPMENT_POLICY", "MATERIALS_POLICY"]);
    // NOT_REQUIRED is a decision, and stays valid.
    expect(validateForActivation(core(), serviceCatalogConfigSchema.parse({ materialPolicy: "NOT_REQUIRED", equipmentPolicy: "NOT_REQUIRED" }), { required: [] }).ok).toBe(true);
  });

  test("every active variant must have a price: one priced variant does not cover a free one", () => {
    const cfg = parse({ variants: [{ id: "small", name: "Small", price: 199 }, { id: "large", name: "Large", price: 0 }] });
    const r = validateForActivation(core(), cfg, { required: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => `${i.code}@${i.path}`)).toEqual(["VARIANT_UNPRICED@variants.large"]);
    expect(publishGateResults(core(), cfg, { required: [] }).find((g) => g.gate === "VARIANT")?.status).toBe("FAIL");
    // An inactive variant is not on sale, and a coming-soon service is not priced yet.
    expect(validateForActivation(core(), parse({ variants: [{ id: "small", name: "Small", price: 199 }, { id: "large", name: "Large", price: 0, active: false }] }), { required: [] }).ok).toBe(true);
    expect(validateForActivation(core(), parse({ comingSoon: true, variants: [{ id: "large", name: "Large", price: 0 }] }), { required: [] }).ok).toBe(true);
  });

  test("the booking-policy gate fails with the platform policy it reports on, and flags per-service wording it cannot enforce", () => {
    const broken = { version: "cancellation.vX", tiers: [{ id: "t", feePercent: 30, refundPercent: 30 }] } as never;
    expect(publishGateResults(core(), policies, { required: [], platformPolicy: broken }).filter((g) => g.gate === "BOOKING_POLICY").map((g) => g.status)).toEqual(["FAIL"]);
    const worded = publishGateResults(core(), parse({ bookingRules: { cancellationPolicy: "Free cancellation any time" } }), { required: [] });
    expect(worded.find((g) => g.code === "POLICY_WORDING_NOT_ENFORCED")).toMatchObject({ status: "WARNING", gate: "CANCELLATION" });
  });
});

/**
 * Owner decision, 2026-10-06: the minimum is what the job actually runs on. A prohibited condition
 * is what stops a job on site and the incident protocol is what the professional then does; the
 * checklist is what completion is held to and the completion criteria are what "done" means. All 25
 * live services carried all four on that day. No count above one is required: a number would be an
 * average of today's catalogue, not a rule.
 */
describe("the safety and quality a first publish requires", () => {
  const parse = (extra: Record<string, unknown>) => serviceCatalogConfigSchema.parse({ ...policies, ...extra });
  const gate = (cfg: typeof policies, name: string) => publishGateResults(core(), cfg, { required: [] }).find((g) => g.gate === name);

  test("safety needs a prohibited condition and an incident protocol, and says which one is missing", () => {
    const onlyCondition = gate(parse({ safety: { prohibitedConditions: ["Gas smell in the room"] } }), "SAFETY");
    expect(onlyCondition).toMatchObject({ code: "SAFETY_ABSENT", status: "WARNING" });
    expect(onlyCondition?.message).toContain("incident protocol");
    expect(onlyCondition?.message).not.toContain("prohibited condition");
    const onlyProtocol = gate(parse({ safety: { incidentProtocol: "Stop work and call support" } }), "SAFETY");
    expect(onlyProtocol?.message).toContain("prohibited condition");
    // General notes and warnings are welcome and are not the minimum.
    expect(gate(parse({ safetyNotes: ["Keep children away from wet floors"], safety: { warnings: ["Wet floor"] } }), "SAFETY")?.code).toBe("SAFETY_ABSENT");
    expect(gate(parse({ safety: { prohibitedConditions: ["Gas smell in the room"], incidentProtocol: "Stop work, make the area safe and call support" } }), "SAFETY")?.status).toBe("PASS");
  });

  test("quality needs a checklist item and a completion criterion; a proof flag alone is not a standard", () => {
    expect(gate(parse({ quality: { proofRequired: true, beforeAfterPhotos: true } }), "QUALITY")).toMatchObject({ code: "QUALITY_ABSENT", status: "WARNING" });
    const onlyChecklist = gate(parse({ quality: { checklist: ["Work area left clean"] } }), "QUALITY");
    expect(onlyChecklist?.message).toContain("completion criterion");
    expect(gate(parse({ quality: { completionCriteria: ["Customer shown the finished work"] } }), "QUALITY")?.message).toContain("checklist item");
    expect(gate(parse({ quality: { checklist: ["Work area left clean"], completionCriteria: ["Customer shown the finished work"] } }), "QUALITY")?.status).toBe("PASS");
  });

  test("when the owner requires the sections, the same minimum blocks a first publish", () => {
    const partial = parse({ safety: { prohibitedConditions: ["Gas smell in the room"] }, quality: { checklist: ["Work area left clean"] } });
    const r = validateForActivation(core(), partial, { required: ["safety", "quality"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code).sort()).toEqual(["QUALITY_ABSENT", "SAFETY_ABSENT"]);
    expect(validateForActivation(core(), parse({ safety: { prohibitedConditions: ["Gas smell in the room"], incidentProtocol: "Stop work, make the area safe and call support" }, quality: { checklist: ["Work area left clean"], completionCriteria: ["Customer shown the finished work"] } }), { required: ["safety", "quality"] }).ok).toBe(true);
  });
});

describe("an edit to a live service may not make it worse", () => {
  const parse = (extra: Record<string, unknown>) => serviceCatalogConfigSchema.parse({ ...policies, ...extra });
  const live = core({ isActive: true });
  const full = parse({ safety: { prohibitedConditions: ["Gas smell in the room"], incidentProtocol: "Stop work, make the area safe and call support" }, quality: { checklist: ["Work area left clean"], completionCriteria: ["Customer shown the finished work"] }, execution: { steps: [{ id: "work", title: "Do the work", kind: "WORK", sortOrder: 1 }] } });
  const required = ["safety", "quality", "execution"] as const;
  const codes = (before: typeof policies | null, after: typeof policies | null, s = live) => liveEditRegressions({ before: { service: live, cfg: before }, after: { service: s, cfg: after }, required }).map((i) => i.code).sort();

  test("deleting safety, quality or the work plan from a live service is refused", () => {
    expect(codes(full, parse({ quality: full.quality, execution: full.execution }))).toEqual(["SAFETY_ABSENT"]);
    expect(codes(full, policies)).toEqual(["EXECUTION_ABSENT", "QUALITY_ABSENT", "SAFETY_ABSENT"]);
    expect(codes(full, parse({ ...full, materialPolicy: "NOT_SPECIFIED" }))).toEqual(["MATERIALS_POLICY"]);
  });

  test("a gap the live service already had does not block an unrelated edit, so it is not frozen or unpublished", () => {
    expect(codes(policies, policies, core({ isActive: true, description: "A better description of the same service" }))).toEqual([]);
    expect(codes(policies, parse({ faqs: [{ q: "How long does it take?", a: "About forty minutes." }] }))).toEqual([]);
  });

  test("an edit that fixes a gap is accepted, and one that breaks pricing is refused whatever was there before", () => {
    expect(codes(policies, full)).toEqual([]);
    expect(codes(full, full, core({ isActive: true, basePrice: 0 }))).toContain("PRICING_MISSING");
  });
});
