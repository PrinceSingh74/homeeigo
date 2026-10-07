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
  declaredNotApplicable,
  deriveConfigStatus,
  evaluatePublishApproval,
  isMeaningfulText,
  NOT_APPLICABLE_REASON_RULE,
  notApplicableReason,
  readinessGaps,
  liveEditPolicyFor,
  liveEditRegressions,
  platformPolicyIssues,
  PUBLISH_GATES,
  publishGateResults,
  publishRequiredSections,
  validateForActivation,
} from "../lib/service-domain";
import { catalogConfigGaps, serviceCatalogConfigSchema } from "../lib/service-catalog-config";
import { qualitySnapshot } from "../lib/service-runtime-policy";
import { buildWarrantySnapshot } from "../lib/service-warranty";
import { visitConfirmationHours } from "../lib/customer-visit";

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
    // NOT_REQUIRED is a decision — and a decision says why (see "explicit states" below).
    const explained = serviceCatalogConfigSchema.parse({ materialPolicy: "NOT_REQUIRED", equipmentPolicy: "NOT_REQUIRED", notApplicableReasons: { materials: "A consultation: nothing is consumed", equipment: "A consultation: nothing is used" } });
    expect(validateForActivation(core(), explained, { required: [] }).ok).toBe(true);
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

/**
 * Owner instruction, 2026-10-07: a critical gate has an explicit, auditable state. Placeholder text
 * does not pass silently, and "not applicable" is a declaration with a reason — stored in the
 * configuration, so it is what the second admin approves and what the version history keeps.
 */
describe("explicit states: placeholder text and declared not-applicable", () => {
  const parse = (extra: Record<string, unknown>) => serviceCatalogConfigSchema.parse({ ...policies, ...extra });
  const gate = (cfg: typeof policies, name: string, required: readonly string[] = []) => publishGateResults(core(), cfg, { required: required as never }).find((g) => g.gate === name);

  test("a dash, 'n/a', 'none', 'tbd' or punctuation is not safety or quality content", () => {
    for (const junk of ["-", "--", ".", "n/a", "N/A", "na", "none", "nil", "tbd", "TODO", "test", "xx", "  -  "]) {
      const cfg = parse({ safety: { prohibitedConditions: [junk], incidentProtocol: junk }, quality: { checklist: [junk], completionCriteria: [junk] } });
      expect({ junk, safety: gate(cfg, "SAFETY")?.code, quality: gate(cfg, "QUALITY")?.code }).toEqual({ junk, safety: "SAFETY_ABSENT", quality: "QUALITY_ABSENT" });
    }
    expect(gate(parse({ safety: { prohibitedConditions: ["-"], incidentProtocol: "-" } }), "SAFETY")?.message).toContain("placeholder");
  });

  test("real sentences pass, including short ones", () => {
    const cfg = parse({ safety: { prohibitedConditions: ["Gas smell"], incidentProtocol: "Stop and call support" }, quality: { checklist: ["Floor dry"], completionCriteria: ["Tap runs clear"] } });
    expect([gate(cfg, "SAFETY")?.status, gate(cfg, "QUALITY")?.status]).toEqual(["PASS", "PASS"]);
  });

  test("safety or quality declared not applicable, with a reason, is its own state — shown, not a pass", () => {
    // Quality has a switch, and the declaration is the switch plus its reason (audit 1 below): the
    // reason alone would have the gate say "not applicable" while the job still ran the checks.
    const cfg = parse({ quality: { notApplicable: true }, notApplicableReasons: { safety: "Remote video consultation: nobody is on site", quality: "Advice only: there is no finished work to inspect" } });
    const safety = gate(cfg, "SAFETY", ["safety", "quality"]);
    const quality = gate(cfg, "QUALITY", ["safety", "quality"]);
    expect(safety).toMatchObject({ code: "SAFETY_NOT_APPLICABLE", status: "NOT_APPLICABLE" });
    expect(safety?.message).toContain("Remote video consultation");
    expect(quality).toMatchObject({ code: "QUALITY_NOT_APPLICABLE", status: "NOT_APPLICABLE" });
    // A declared reason satisfies an owner requirement; the second admin approves it with the content.
    expect(validateForActivation(core(), cfg, { required: ["safety", "quality"] }).ok).toBe(true);
  });

  test("a reason that is a placeholder, or too short to say anything, declares nothing", () => {
    for (const reason of ["-", "n/a", "none", "ok", "not needed"]) {
      const cfg = parse({ notApplicableReasons: { safety: reason } });
      expect({ reason, code: gate(cfg, "SAFETY")?.code }).toEqual({ reason, code: "SAFETY_ABSENT" });
    }
    expect(validateForActivation(core(), parse({ notApplicableReasons: { safety: "n/a" } }), { required: ["safety"] }).ok).toBe(false);
  });

  test("the old quality 'not applicable' tick carries no reason and declares nothing", () => {
    expect(gate(parse({ quality: { notApplicable: true } }), "QUALITY")?.code).toBe("QUALITY_ABSENT");
  });

  test("materials or equipment 'not required' needs its reason; with one it is shown as not applicable", () => {
    const bare = serviceCatalogConfigSchema.parse({ materialPolicy: "NOT_REQUIRED", equipmentPolicy: "NOT_REQUIRED" });
    const r = validateForActivation(core(), bare, { required: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code).sort()).toEqual(["EQUIPMENT_NOT_REQUIRED_UNEXPLAINED", "MATERIALS_NOT_REQUIRED_UNEXPLAINED"]);
    const explained = serviceCatalogConfigSchema.parse({ materialPolicy: "NOT_REQUIRED", equipmentPolicy: "PROFESSIONAL_PROVIDED", notApplicableReasons: { materials: "A consultation: nothing is consumed" } });
    const gates = publishGateResults(core(), explained, { required: [] });
    expect(gates.find((g) => g.gate === "MATERIALS")).toMatchObject({ code: "MATERIALS_NOT_APPLICABLE", status: "NOT_APPLICABLE" });
    expect(gates.find((g) => g.gate === "MATERIALS")?.message).toContain("nothing is consumed");
    expect(gates.find((g) => g.gate === "EQUIPMENT")?.status).toBe("PASS");
  });

  test("a live service that already says 'not required' without a reason keeps selling, with a warning", () => {
    const bare = serviceCatalogConfigSchema.parse({ materialPolicy: "NOT_REQUIRED", equipmentPolicy: "NOT_REQUIRED" });
    expect(validateForActivation(core({ isActive: true }), bare, { grandfathered: true, required: [] }).ok).toBe(true);
    expect(publishGateResults(core({ isActive: true }), bare, { grandfathered: true, required: [] }).find((g) => g.code === "MATERIALS_NOT_REQUIRED_UNEXPLAINED")?.status).toBe("WARNING");
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

/**
 * Adversarial audit, 2026-10-07. Five findings; each block below fails without its fix.
 */
const REAL_REASON = "Advice only: there is no finished work to inspect";

describe("audit 1: the running job and the gate ask ONE question about 'not applicable'", () => {
  const parse = (extra: Record<string, unknown>) => serviceCatalogConfigSchema.parse({ ...policies, ...extra });
  const gate = (cfg: typeof policies) => publishGateResults(core(), cfg, { required: [] }).find((g) => g.gate === "QUALITY");
  const content = { checklist: ["Work area left clean"], completionCriteria: ["Customer shown the finished work"], proofRequired: true, warrantyDays: 30, complaintWindowDays: 5, confirmationWindowHours: 12 };

  test("the bare switch, with no reason, switches nothing off: the job keeps its checks", () => {
    const cfg = parse({ quality: { ...content, notApplicable: true } });
    expect(declaredNotApplicable(cfg, "quality")).toBeNull();
    expect(qualitySnapshot(cfg)).toMatchObject({ checklist: ["Work area left clean"], proofRequired: true, warrantyDays: 30 });
    expect(buildWarrantySnapshot(cfg)).toMatchObject({ enabled: true, durationDays: 30, complaintWindowDays: 5 });
    expect(visitConfirmationHours(cfg)).toBe(12);
    // …and the gate describes the same service: its quality content is there and is enforced.
    expect(gate(cfg)?.code).toBe("QUALITY");
  });

  test("the switch with a real reason switches the checks off, and the gate says not applicable — never 'pass'", () => {
    const cfg = parse({ quality: { ...content, notApplicable: true }, notApplicableReasons: { quality: REAL_REASON } });
    expect(declaredNotApplicable(cfg, "quality")).toBe(REAL_REASON);
    expect(qualitySnapshot(cfg)).toBeNull();
    expect(buildWarrantySnapshot(cfg)).toMatchObject({ enabled: false, durationDays: 0, complaintWindowDays: 0 });
    expect(visitConfirmationHours(cfg)).toBe(48);
    expect(gate(cfg)).toMatchObject({ code: "QUALITY_NOT_APPLICABLE", status: "NOT_APPLICABLE" });
  });

  test("a reason without the switch declares nothing: the gate does not call a service 'not applicable' while its job runs the checks", () => {
    const withContent = parse({ quality: content, notApplicableReasons: { quality: REAL_REASON } });
    expect(qualitySnapshot(withContent)).not.toBeNull();
    expect(gate(withContent)?.code).toBe("QUALITY");
    const proofOnly = parse({ quality: { proofRequired: true }, notApplicableReasons: { quality: REAL_REASON } });
    expect(qualitySnapshot(proofOnly)).toMatchObject({ proofRequired: true });
    expect(gate(proofOnly)?.code).toBe("QUALITY_ABSENT");
    expect(gate(proofOnly)?.message).toContain("switch");
  });

  const table: [string, Record<string, unknown>][] = [
    ["nothing", {}],
    ["content", { quality: content }],
    ["switch", { quality: { notApplicable: true } }],
    ["switch + content", { quality: { ...content, notApplicable: true } }],
    ["switch + junk reason + content", { quality: { ...content, notApplicable: true }, notApplicableReasons: { quality: "quality not applicable" } }],
    ["reason", { notApplicableReasons: { quality: REAL_REASON } }],
    ["reason + content", { quality: content, notApplicableReasons: { quality: REAL_REASON } }],
    ["switch + reason", { quality: { notApplicable: true }, notApplicableReasons: { quality: REAL_REASON } }],
    ["switch + reason + content", { quality: { ...content, notApplicable: true }, notApplicableReasons: { quality: REAL_REASON } }],
  ];
  for (const [label, extra] of table) {
    test(`${label}: gate 'not applicable' ⇔ declared ⇔ the job's checks are off`, () => {
      const cfg = parse(extra);
      const declared = declaredNotApplicable(cfg, "quality") !== null;
      expect(gate(cfg)?.code === "QUALITY_NOT_APPLICABLE").toBe(declared);
      const configured = Boolean((extra.quality as Record<string, unknown> | undefined)?.checklist);
      // With something to enforce, the job enforces it exactly when the section is not declared off.
      if (configured) {
        expect(qualitySnapshot(cfg) === null).toBe(declared);
        expect(buildWarrantySnapshot(cfg).enabled).toBe(!declared);
        expect(visitConfirmationHours(cfg)).toBe(declared ? 48 : 12);
      } else if (declared) {
        expect(qualitySnapshot(cfg)).toBeNull();
      }
      // A gate that passes quality is describing checks that really run.
      if (gate(cfg)?.code === "QUALITY") expect(qualitySnapshot(cfg)).not.toBeNull();
    });
  }
});

/**
 * Re-audit of 2026-10-07: the swap rule above was right and beside the point. The same protections
 * could be taken off a live service with no declaration at all — proof no longer required, the
 * warranty set to zero days, a section simply emptied where nothing is listed as required.
 */
describe("a live service's protections cannot be reduced by an edit", () => {
  const parse = (extra: Record<string, unknown>) => serviceCatalogConfigSchema.parse({ ...policies, ...extra });
  const live = core({ isActive: true });
  const quality = { checklist: ["Work area left clean"], completionCriteria: ["Customer shown the finished work"], proofRequired: true, beforeAfterPhotos: true, warrantyDays: 7, complaintWindowDays: 3 };
  const full = parse({ safety: { prohibitedConditions: ["Gas smell in the room"], incidentProtocol: "Stop work, make the area safe and call support" }, quality });
  const codes = (after: typeof policies | null, required: readonly ("safety" | "quality" | "execution")[] = []) =>
    liveEditRegressions({ before: { service: live, cfg: full }, after: { service: live, cfg: after }, required }).map((i) => `${i.code}@${i.path}`).sort();

  test("switching off photo proof, or before/after photos, is refused", () => {
    expect(codes(parse({ ...full, quality: { ...quality, proofRequired: false } }))).toEqual(["QUALITY_PROTECTION_REDUCED@quality.proofRequired"]);
    expect(codes(parse({ ...full, quality: { ...quality, beforeAfterPhotos: false } }))).toEqual(["QUALITY_PROTECTION_REDUCED@quality.beforeAfterPhotos"]);
  });

  test("shortening the warranty or the complaint window is refused; lengthening them is not", () => {
    expect(codes(parse({ ...full, quality: { ...quality, warrantyDays: 0 } }))).toEqual(["QUALITY_PROTECTION_REDUCED@quality.warrantyDays"]);
    expect(codes(parse({ ...full, quality: { ...quality, complaintWindowDays: 1 } }))).toEqual(["QUALITY_PROTECTION_REDUCED@quality.complaintWindowDays"]);
    expect(codes(parse({ ...full, quality: { ...quality, warrantyDays: 30, complaintWindowDays: 7 } }))).toEqual([]);
  });

  test("emptying a section with nothing declared is refused, even where no section is listed as required", () => {
    expect(codes(parse({ ...full, safety: {} }))).toEqual(["SAFETY_PROTECTION_REMOVED@safety"]);
    expect(codes(parse({ ...full, quality: {} }))).toContain("QUALITY_PROTECTION_REMOVED@quality");
  });

  test("control: rewording content, adding to it, or an edit elsewhere is not a reduction", () => {
    expect(codes(parse({ ...full, quality: { ...quality, checklist: ["Work area left clean and dry", "Tools removed"] } }))).toEqual([]);
    expect(codes(parse({ ...full, safety: { prohibitedConditions: ["Gas smell in the room", "Exposed wiring"], incidentProtocol: "Stop work, make the area safe and call support" } }))).toEqual([]);
    expect(codes(full)).toEqual([]);
  });
});

describe("audit 2: a live service's content cannot be swapped for a 'not applicable' declaration", () => {
  const parse = (extra: Record<string, unknown>) => serviceCatalogConfigSchema.parse({ ...policies, ...extra });
  const live = core({ isActive: true });
  const full = parse({ safety: { prohibitedConditions: ["Gas smell in the room"], incidentProtocol: "Stop work, make the area safe and call support" }, quality: { checklist: ["Work area left clean"], completionCriteria: ["Customer shown the finished work"] }, execution: { steps: [{ id: "work", title: "Do the work", kind: "WORK", sortOrder: 1 }] } });
  const reasons = { safety: "Remote video consultation: nobody is on site", quality: REAL_REASON, materials: "A consultation: nothing is consumed", equipment: "A consultation: nothing is used" };
  for (const required of [["safety", "quality", "execution"], []] as const) {
    const codes = (before: typeof policies | null, after: typeof policies | null) => liveEditRegressions({ before: { service: live, cfg: before }, after: { service: live, cfg: after }, required }).map((i) => i.code).sort();
    const under = required.length ? "with the sections required" : "with nothing required";

    test(`${under}: replacing safety content with a declared reason is a regression`, () => {
      expect(codes(full, parse({ ...full, safety: {}, notApplicableReasons: { safety: reasons.safety } }))).toEqual(["SAFETY_DECLARED_NOT_APPLICABLE"]);
      // Partly emptied is the same swap: the declaration replaces a protection that was there.
      expect(codes(full, parse({ ...full, safety: { prohibitedConditions: ["Gas smell in the room"] }, notApplicableReasons: { safety: reasons.safety } }))).toEqual(["SAFETY_DECLARED_NOT_APPLICABLE"]);
    });

    test(`${under}: switching quality checks off with a reason is a regression, whether the checklist is kept or deleted`, () => {
      expect(codes(full, parse({ ...full, quality: { ...full.quality, notApplicable: true }, notApplicableReasons: { quality: reasons.quality } }))).toEqual(["QUALITY_DECLARED_NOT_APPLICABLE"]);
      expect(codes(full, parse({ ...full, quality: { notApplicable: true }, notApplicableReasons: { quality: reasons.quality } }))).toEqual(["QUALITY_DECLARED_NOT_APPLICABLE"]);
      // A proof rule or a warranty is a protection too, even when the checklist was never complete.
      const proofOnly = parse({ ...full, quality: { proofRequired: true, warrantyDays: 30 } });
      expect(codes(proofOnly, parse({ ...proofOnly, quality: { proofRequired: true, warrantyDays: 30, notApplicable: true }, notApplicableReasons: { quality: reasons.quality } }))).toEqual(["QUALITY_DECLARED_NOT_APPLICABLE"]);
    });

    test(`${under}: replacing a materials or equipment policy with an explained 'not required' is a regression`, () => {
      expect(codes(full, parse({ ...full, materialPolicy: "NOT_REQUIRED", notApplicableReasons: { materials: reasons.materials } }))).toEqual(["MATERIALS_DECLARED_NOT_APPLICABLE"]);
      expect(codes(full, parse({ ...full, equipmentPolicy: "NOT_REQUIRED", notApplicableReasons: { equipment: reasons.equipment } }))).toEqual(["EQUIPMENT_DECLARED_NOT_APPLICABLE"]);
    });

    test(`${under}: the refusal says what to do instead`, () => {
      const [issue] = liveEditRegressions({ before: { service: live, cfg: full }, after: { service: live, cfg: parse({ ...full, safety: {}, notApplicableReasons: { safety: reasons.safety } }) }, required });
      expect(issue).toMatchObject({ code: "SAFETY_DECLARED_NOT_APPLICABLE", path: "safety" });
      expect(issue.message).toContain("live service");
      expect(issue.message.toLowerCase()).toContain("pause");
    });

    test(`${under}: control — a service that was already declared, or never had the content, stays editable`, () => {
      const declared = parse({ materialPolicy: "NOT_REQUIRED", equipmentPolicy: "NOT_REQUIRED", quality: { notApplicable: true }, execution: full.execution, notApplicableReasons: reasons });
      expect(codes(declared, parse({ ...declared, faqs: [{ q: "How long does it take?", a: "About forty minutes." }] }))).toEqual([]);
      // Rewording a reason that already stood is not a swap.
      expect(codes(declared, parse({ ...declared, notApplicableReasons: { ...reasons, safety: "Video call only: the professional never visits" } }))).toEqual([]);
      // Going the other way — content replacing a declaration — adds a protection.
      expect(codes(declared, full)).toEqual([]);
    });
  }

  test("control — a first publish of a draft with declared reasons is still allowed: the approver sees the reasons with the version", () => {
    const draft = parse({ quality: { notApplicable: true }, notApplicableReasons: { safety: reasons.safety, quality: reasons.quality } });
    expect(validateForActivation(core(), draft, { required: ["safety", "quality"] }).ok).toBe(true);
  });
});

describe("audit 3: a reason has to be a reason", () => {
  const parse = (extra: Record<string, unknown>) => serviceCatalogConfigSchema.parse({ ...policies, ...extra });
  const gate = (cfg: typeof policies, name: string) => publishGateResults(core(), cfg, { required: [] }).find((g) => g.gate === name);
  const JUNK = [
    "aaaaaaaaaaaa", "aaaa aaaa aaaa", "1234567890", "12345 67890 12345", "not applicable", "Not Applicable.", "n/a n/a n/a n/a n/a", "safety not applicable",
    "quality is not applicable", "not applicable to this service", "none none none none", "materials not required", "no equipment needed", "nothing needed here",
    "abcdefghij", "ab ab ab ab ab ab", "a b c d e f g h i j k l",
  ];
  const REAL = [
    "Remote video consultation: nobody is on site", REAL_REASON, "A consultation: nothing is consumed", "A consultation: nothing is used", "Remote consultation only",
    "Advice by phone, no tools", "Nothing is delivered on site", "केवल फ़ोन पर सलाह दी जाती है", "No materials: the customer supplies the paint",
  ];

  test("repeated characters, digits only, and the label said again are refused", () => {
    for (const reason of JUNK) {
      const cfg = parse({ notApplicableReasons: { safety: reason } });
      expect({ reason, accepted: notApplicableReason(cfg, "safety") }).toEqual({ reason, accepted: null });
      expect({ reason, code: gate(cfg, "SAFETY")?.code }).toEqual({ reason, code: "SAFETY_ABSENT" });
    }
  });

  test("a real reason is accepted, in English or Hindi", () => {
    for (const reason of REAL) expect({ reason, accepted: notApplicableReason(parse({ notApplicableReasons: { safety: reason } }), "safety") }).toEqual({ reason, accepted: reason });
  });

  test("the blocker states the rule, in one sentence, wherever a written reason was refused", () => {
    expect(NOT_APPLICABLE_REASON_RULE.split(/[.!?]\s/).length).toBe(1);
    expect(gate(parse({ notApplicableReasons: { safety: "safety not applicable" } }), "SAFETY")?.message).toContain(NOT_APPLICABLE_REASON_RULE);
    expect(gate(parse({ quality: { notApplicable: true }, notApplicableReasons: { quality: "aaaaaaaaaaaa" } }), "QUALITY")?.message).toContain(NOT_APPLICABLE_REASON_RULE);
    const policiesOff = serviceCatalogConfigSchema.parse({ materialPolicy: "NOT_REQUIRED", equipmentPolicy: "NOT_REQUIRED", notApplicableReasons: { materials: "materials not required", equipment: "1234567890" } });
    const r = validateForActivation(core(), policiesOff, { required: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((i) => i.code).sort()).toEqual(["EQUIPMENT_NOT_REQUIRED_UNEXPLAINED", "MATERIALS_NOT_REQUIRED_UNEXPLAINED"]);
      for (const i of r.issues) expect(i.message).toContain(NOT_APPLICABLE_REASON_RULE);
    }
    // With no reason written at all there is nothing to correct, so the rule is not recited.
    const bare = validateForActivation(core(), serviceCatalogConfigSchema.parse({ materialPolicy: "NOT_REQUIRED", equipmentPolicy: "PROFESSIONAL_PROVIDED" }), { required: [] });
    if (!bare.ok) expect(bare.issues[0].message).not.toContain(NOT_APPLICABLE_REASON_RULE);
  });

  test("short real content is still content; one key held down is not", () => {
    for (const text of ["Gas", "Wet floor", "Floor dry", "100", "5 kg"]) expect({ text, ok: isMeaningfulText(text) }).toEqual({ text, ok: true });
    for (const text of ["aaa", "AAAAaaaa", "zzzzzzzzzzzz", "-", "n/a"]) expect({ text, ok: isMeaningfulText(text) }).toEqual({ text, ok: false });
  });
});

describe("audit 4: the readiness view and the gate cannot disagree", () => {
  const parse = (extra: Record<string, unknown>) => serviceCatalogConfigSchema.parse(extra);
  const fullSections = { safety: { prohibitedConditions: ["Gas smell in the room"], incidentProtocol: "Stop work, make the area safe and call support" }, quality: { checklist: ["Work area left clean"], completionCriteria: ["Customer shown the finished work"] }, execution: { steps: [{ id: "work", title: "Do the work", kind: "WORK", sortOrder: 1 }] } };
  const both = { materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED" };
  type Opts = { required?: readonly ("safety" | "quality" | "execution")[]; unavailableTrainingModules?: string[] };
  const cases: [string, ReturnType<typeof core>, ReturnType<typeof parse> | null, Opts][] = [
    ["complete", core(), parse(both), { required: [] }],
    ["complete, sections required and present", core(), parse({ ...both, ...fullSections }), { required: ["safety", "quality", "execution"] }],
    ["no configuration at all", core(), null, { required: [] }],
    ["materials NOT_REQUIRED, unexplained", core(), parse({ ...both, materialPolicy: "NOT_REQUIRED" }), { required: [] }],
    ["equipment NOT_REQUIRED, unexplained", core(), parse({ ...both, equipmentPolicy: "NOT_REQUIRED" }), { required: [] }],
    ["both NOT_REQUIRED, explained", core(), parse({ materialPolicy: "NOT_REQUIRED", equipmentPolicy: "NOT_REQUIRED", notApplicableReasons: { materials: "A consultation: nothing is consumed", equipment: "A consultation: nothing is used" } }), { required: [] }],
    ["NOT_REQUIRED with a junk reason", core(), parse({ ...both, materialPolicy: "NOT_REQUIRED", notApplicableReasons: { materials: "materials not required" } }), { required: [] }],
    ["NOT_SPECIFIED", core(), parse({ materialPolicy: "NOT_SPECIFIED", equipmentPolicy: "NOT_SPECIFIED" }), { required: [] }],
    ["a required section is absent", core(), parse(both), { required: ["safety"] }],
    ["required quality absent, safety present", core(), parse({ ...both, safety: fullSections.safety }), { required: ["safety", "quality"] }],
    ["required sections declared not applicable", core(), parse({ ...both, quality: { notApplicable: true }, notApplicableReasons: { safety: "Remote video consultation: nobody is on site", quality: REAL_REASON } }), { required: ["safety", "quality"] }],
    ["required quality: the switch with no reason", core(), parse({ ...both, quality: { notApplicable: true } }), { required: ["quality"] }],
    ["no price", core({ basePrice: 0 }), parse(both), { required: [] }],
    ["quote model with no base price", core({ basePrice: 0, minPrice: null, maxPrice: null, pricingModel: "quote" }), parse(both), { required: [] }],
    ["no description", core({ description: " " }), parse(both), { required: [] }],
    ["no category", core({ categoryId: null }), parse(both), { required: [] }],
    ["hourly with no quantity rule", core({ pricingModel: "hourly" }), parse(both), { required: [] }],
    ["audiences with no variants", core(), parse({ ...both, audiences: ["women"] }), { required: [] }],
    ["an unpriced variant", core(), parse({ ...both, variants: [{ id: "small", name: "Small", price: 199 }, { id: "large", name: "Large", price: 0 }] }), { required: [] }],
    ["a training module nobody can complete", core(), parse({ ...both, providerRequirements: { trainingModules: ["deep-clean-basics"] } }), { required: [], unavailableTrainingModules: ["deep-clean-basics"] }],
    ["live, no policies (grandfathered)", core({ isActive: true, lifecycleStatus: "ACTIVE" }), null, { required: [] }],
    ["live, required section absent (grandfathered)", core({ isActive: true, lifecycleStatus: "ACTIVE" }), parse(both), { required: ["safety", "quality", "execution"] }],
    ["live, no price (blocks even a live service)", core({ isActive: true, lifecycleStatus: "ACTIVE", basePrice: 0 }), parse(both), { required: [] }],
  ];
  for (const [label, service, cfg, opts] of cases) {
    test(`${label}: READY ⇔ the gate that applies to this service has no blocker`, () => {
      const enforced = validateForActivation(service, cfg, { ...opts, grandfathered: service.isActive });
      const gaps = readinessGaps(service, cfg, opts);
      expect({ label, ready: deriveConfigStatus(service, cfg, opts) === "READY" }).toEqual({ label, ready: enforced.ok });
      expect({ label, noGaps: gaps.length === 0 }).toEqual({ label, noGaps: enforced.ok });
      // Not just the same verdict: the same findings, in the gate's own words.
      expect(gaps).toEqual(enforced.ok ? [] : enforced.issues.map((i) => i.message));
    });
  }

  test("the table holds both verdicts, so the equivalence is not vacuous", () => {
    const verdicts = cases.map(([, service, cfg, opts]) => deriveConfigStatus(service, cfg, opts));
    expect(verdicts.filter((v) => v === "READY").length).toBeGreaterThanOrEqual(5);
    expect(verdicts.filter((v) => v === "CONFIGURATION_REQUIRED").length).toBeGreaterThanOrEqual(10);
  });

  test("the two the audit named: an unexplained NOT_REQUIRED and an absent required section are not READY", () => {
    expect(deriveConfigStatus(core(), parse({ ...both, materialPolicy: "NOT_REQUIRED" }), { required: [] })).toBe("CONFIGURATION_REQUIRED");
    expect(deriveConfigStatus(core(), parse(both), { required: ["safety"] })).toBe("CONFIGURATION_REQUIRED");
    expect(readinessGaps(core(), parse(both), { required: ["safety"] }).join(" ")).toContain("required before a service can be published");
  });

  test("what the old list said and the gate did not is now on the rail as a warning, not lost", () => {
    const rail = publishGateResults(core(), parse({ ...both, audiences: ["women"], professionalPreferences: ["FEMALE"] }), { required: [] });
    expect(rail.find((g) => g.code === "AUDIENCE_WITHOUT_VARIANTS")).toMatchObject({ status: "WARNING" });
    expect(rail.find((g) => g.code === "PROFESSIONAL_PREFERENCE_UNSUPPORTED")).toMatchObject({ status: "WARNING" });
    expect(catalogConfigGaps(core(), parse({ ...both, audiences: ["women"] }))).toEqual(["Audiences are set but there are no variants to price them"]);
  });

  test("status words that are not about configuration are unchanged", () => {
    expect(deriveConfigStatus(core({ lifecycleStatus: "ARCHIVED" }), null)).toBe("ARCHIVED");
    expect(deriveConfigStatus(core({ lifecycleStatus: "PAUSED" }), null)).toBe("PAUSED");
    expect(deriveConfigStatus(core(), parse({ comingSoon: true }))).toBe("COMING_SOON");
  });
});
