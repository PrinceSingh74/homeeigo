import { describe, expect, test } from "bun:test";
import {
  parseCatalogConfig,
  publicCatalogConfig,
  resolveSelection,
  serviceCatalogConfigSchema,
} from "../lib/service-catalog-config";
import {
  assertBookable,
  blockingBookabilityIssues,
  bookingConfigSnapshot,
  configSections,
  customerIndexable,
  inferCapabilityProfile,
  isPartnerOperationalService,
  isServiceCustomerVisible,
  catalogPartnerBrief,
  evaluatePublishApproval,
  publishGateResults,
  scheduledActivationDecision,
  validateForActivation,
} from "../lib/service-domain";

const core = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  name: "Bathroom Cleaning",
  slug: "bathroom-cleaning",
  description: "Clean bathrooms",
  category: "cleaning",
  basePrice: 199,
  minPrice: 199,
  maxPrice: 199,
  estimatedDuration: 40,
  pricingModel: "fixed",
  isActive: true,
  ...over,
});

describe("capability profiles", () => {
  test("maps known categories and leaves others general", () => {
    expect(inferCapabilityProfile("cleaning")).toBe("CLEANING");
    expect(inferCapabilityProfile("beauty")).toBe("BEAUTY");
    expect(inferCapabilityProfile("repair")).toBe("REPAIR");
    expect(inferCapabilityProfile("home")).toBe("HOME_HELP");
    expect(inferCapabilityProfile("unknown-xyz")).toBe("GENERAL");
  });
});

describe("coming soon is visible but not bookable", () => {
  const cfg = serviceCatalogConfigSchema.parse({ comingSoon: true, materialPolicy: "NOT_REQUIRED", equipmentPolicy: "NOT_REQUIRED" });
  test("quote/booking gate", () => {
    expect(assertBookable(core(), cfg)).toEqual({ ok: false, error: "SERVICE_NOT_BOOKABLE" });
    expect(assertBookable(core({ isActive: true }), null).ok).toBe(true);
    expect(assertBookable(core({ isActive: false }), null).ok).toBe(false);
  });
  test("coming soon is not indexable", () => {
    expect(customerIndexable(core(), cfg)).toBe(false);
    expect(customerIndexable(core(), null)).toBe(true);
  });
});

describe("publish approval and schedule", () => {
  test("a missing price is a critical failure", () => {
    const gates = publishGateResults(core({ basePrice: 0, isActive: false }), null);
    expect(gates.some((g) => g.code === "PRICING_MISSING" && g.status === "FAIL" && g.severity === "critical")).toBe(true);
  });
  test("an already active service stays bookable when advisory policies are missing", () => {
    expect(validateForActivation(core({ isActive: true }), null, { grandfathered: true }).ok).toBe(true);
    const gates = publishGateResults(core({ isActive: true }), null, { grandfathered: true });
    expect(gates.some((g) => g.code === "MATERIALS_POLICY" && g.status === "WARNING")).toBe(true);
    expect(gates.some((g) => g.code === "MATERIALS_POLICY" && g.status === "FAIL")).toBe(false);
  });
  test("the last editor cannot approve their own change", () => {
    expect(
      evaluatePublishApproval({ approverId: "editor", editorId: "editor", approvedEditorId: "editor", approverHasApprove: true }),
    ).toEqual({ ok: false, code: "APPROVER_IS_EDITOR" });
  });
  test("a second approver can approve the current editor", () => {
    expect(
      evaluatePublishApproval({ approverId: "approver", editorId: "editor", approvedEditorId: "editor", approverHasApprove: true }),
    ).toEqual({ ok: true });
  });
  test("a future scheduled time does not activate", () => {
    const decision = scheduledActivationDecision({
      scheduledLiveAt: "2099-01-01T00:00:00+05:30",
      now: new Date("2026-10-05T12:00:00+05:30"),
      gateOk: true,
      approvalOk: true,
    });
    expect(decision).toEqual({ action: "wait" });
  });
  test("a due schedule with a failed gate does not activate", () => {
    const decision = scheduledActivationDecision({
      scheduledLiveAt: "2020-01-01T00:00:00+05:30",
      now: new Date("2026-10-05T12:00:00+05:30"),
      gateOk: false,
      approvalOk: true,
    });
    expect(decision).toEqual({ action: "fail" });
  });
  test("the partner brief does not carry internal fields", () => {
    const brief = catalogPartnerBrief(core(), null);
    expect(brief).toEqual({ objective: "Clean bathrooms", stepTitles: [] });
    expect(JSON.stringify(brief)).not.toMatch(/matching|riskScore|operationsNotes|price/i);
  });
});

describe("activation gate does not invent completeness", () => {
  test("hourly without quantity is blocked", () => {
    const issues = blockingBookabilityIssues(core({ pricingModel: "hourly", basePrice: 199 }), null);
    expect(issues.some((i) => i.code === "QUANTITY_MISSING")).toBe(true);
  });
  test("fixed with price and duration is not blocked", () => {
    expect(blockingBookabilityIssues(core(), null).filter((i) => i.code !== "COMING_SOON")).toEqual([]);
  });
  test("grandfathered active services are not unpublished for advisory gaps", () => {
    const r = validateForActivation(core({ pricingModel: "fixed" }), null, { grandfathered: true });
    expect(r.ok).toBe(true);
  });
});

describe("public projection never leaks matching weights", () => {
  test("matching is stripped; inactive variants stay hidden", () => {
    const cfg = serviceCatalogConfigSchema.parse({
      matching: { skillWeight: 0.9, distanceWeight: 0.1 },
      providerRequirements: { requiredSkills: ["ac-repair"], kycRequired: true, verifiedProfessionalRequired: true },
      variants: [
        { id: "live", name: "Live", price: 10 },
        { id: "old", name: "Old", price: 1, active: false },
      ],
    });
    const pub = publicCatalogConfig(cfg)!;
    expect(pub.matching).toBeUndefined();
    expect(pub.execution).toBeUndefined();
    expect(pub.safety).toBeUndefined();
    expect(pub.quality).toBeUndefined();
    expect(pub.warranty).toBeUndefined();
    expect(pub.trust).toBeUndefined();
    expect(pub.providerRequirements?.requiredSkills).toBeUndefined();
    expect(pub.providerRequirements?.kycRequired).toBeUndefined();
    expect(pub.providerRequirements?.verifiedProfessionalRequired).toBe(true);
    expect(pub.variants?.map((v) => v.id)).toEqual(["live"]);
  });
});

describe("add-on compatibility is server-side", () => {
  const cfg = serviceCatalogConfigSchema.parse({
    variants: [
      { id: "classic", name: "Classic", price: 300 },
      { id: "premium", name: "Premium", price: 500 },
    ],
    addons: [{ id: "head-massage", name: "Head massage", price: 99, compatibleVariantIds: ["premium"] }],
  });
  test("unknown variant on the add-on is a schema error", () => {
    expect(
      serviceCatalogConfigSchema.safeParse({
        addons: [{ id: "x", name: "X", price: 1, compatibleVariantIds: ["missing"] }],
      }).success,
    ).toBe(false);
  });
  test("incompatible add-on is rejected at price time", () => {
    expect(resolveSelection(core(), cfg, { variantId: "classic", addonIds: ["head-massage"] })).toEqual({
      ok: false,
      error: "INVALID_ADDON",
    });
    const ok = resolveSelection(core(), cfg, { variantId: "premium", addonIds: ["head-massage"] });
    expect(ok.ok && ok.addonTotal).toBe(99);
  });
});

describe("appointment duration is preparation + service + cleanup, never a silent override", () => {
  // Phase 04 (2026-09-21): this test used to assert that totalSlotMin=90 won over parts that sum to
  // 60. A declared total that disagrees with its parts is now rejected as DURATION_INCONSISTENT.
  test("a total that disagrees with its parts is rejected", () => {
    const r = serviceCatalogConfigSchema.safeParse({
      duration: { preparationMin: 10, serviceMin: 40, cleanupMin: 10, totalSlotMin: 90 },
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("DURATION_INCONSISTENT");
  });
  test("a consistent total resolves to the sum of its parts", () => {
    const cfg = serviceCatalogConfigSchema.parse({
      duration: { preparationMin: 10, serviceMin: 40, cleanupMin: 10, totalSlotMin: 60 },
    });
    const r = resolveSelection(core({ estimatedDuration: 40 }), cfg, {});
    expect(r.ok && r.snapshot.durationMinutes).toBe(60);
  });
});

describe("config sections surface completion without hiding the SKU", () => {
  test("sections are always returned", () => {
    const sections = configSections(core(), parseCatalogConfig({}));
    expect(sections.some((s) => s.id === "pricing")).toBe(true);
    expect(sections.some((s) => s.id === "identity" && s.status === "ok")).toBe(true);
    expect(sections.map((s) => s.id)).toEqual(expect.arrayContaining([
      "identity", "content", "audience", "booking", "pricing", "quantity", "duration",
      "variants", "addons", "materials", "equipment", "provider", "coverage", "availability",
      "bookingRules", "safety", "quality", "matching", "payment", "media", "trust",
      "reviews", "seo", "analytics", "operations",
    ]));
    expect(sections).toHaveLength(25);
  });
});

describe("catalogue visibility projections", () => {
  test("INTERNAL and DRAFT never appear to customers or partners", () => {
    const internal = core({ isActive: true, isBookable: true, isCustomerVisible: true, configStatus: "INTERNAL", lifecycleStatus: "ACTIVE" });
    const draft = core({ isActive: true, isBookable: true, isCustomerVisible: true, configStatus: "READY", lifecycleStatus: "DRAFT" });
    const live = core({ isActive: true, isBookable: true, isCustomerVisible: true, configStatus: "READY", lifecycleStatus: "ACTIVE" });
    expect(isServiceCustomerVisible(internal, null)).toBe(false);
    expect(isPartnerOperationalService(internal)).toBe(false);
    expect(isServiceCustomerVisible(draft, null)).toBe(false);
    expect(isPartnerOperationalService(draft)).toBe(false);
    expect(isServiceCustomerVisible(live, null)).toBe(true);
    expect(isPartnerOperationalService(live)).toBe(true);
  });
});

describe("booking configuration snapshot is versioned", () => {
  test("a stored v1 snapshot is unaffected by a later v2 catalogue", () => {
    const selection = { durationMinutes: 45, variant: { id: "classic", name: "Classic", price: 300 }, quantity: 1 };
    const cfgV1 = serviceCatalogConfigSchema.parse({
      materialPolicy: "PROFESSIONAL_PROVIDED",
      quality: { proofRequired: true, warrantyDays: 14 },
      payment: { walletAllowed: true },
    });
    const cfgV2 = serviceCatalogConfigSchema.parse({
      materialPolicy: "CUSTOMER_PROVIDED",
      quality: { proofRequired: false, warrantyDays: 0 },
      payment: { walletAllowed: false },
    });
    const v1 = bookingConfigSnapshot(core({ version: 1, includedServices: ["Wipe"] }), cfgV1, selection);
    const stored = structuredClone(v1);
    const v2 = bookingConfigSnapshot(core({ version: 2, includedServices: ["Steam"] }), cfgV2, selection);
    expect(stored.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(stored.inclusions).toEqual(["Wipe"]);
    expect(v2.inclusions).toEqual(["Steam"]);
    expect(stored.materialPolicy).toBe("PROFESSIONAL_PROVIDED");
    expect(v2.materialPolicy).toBe("CUSTOMER_PROVIDED");
    expect((stored.quality as { proofRequired: boolean } | null)?.proofRequired).toBe(true);
    expect(v2.quality).toBeNull();
    expect((stored.payment as { walletAllowed: boolean }).walletAllowed).toBe(true);
    expect((v2.payment as { walletAllowed: boolean }).walletAllowed).toBe(false);
  });
});
