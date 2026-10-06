/**
 * Phases 01–02 (pure): lifecycle transitions, visibility flags, publish gate for content and
 * taxonomy, and the partner job brief projection.
 */
import { describe, expect, test } from "bun:test";
import {
  LIFECYCLE_TRANSITIONS,
  SERVICE_LIFECYCLE,
  canTransition,
  effectiveLifecycleTarget,
  lifecycleFlags,
  partnerJobBrief,
  validateForActivation,
} from "../lib/service-domain";
import { serviceCatalogConfigSchema } from "../lib/service-catalog-config";

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

describe("lifecycle transitions", () => {
  test("ARCHIVED is terminal", () => {
    expect(LIFECYCLE_TRANSITIONS.ARCHIVED).toEqual([]);
    for (const to of SERVICE_LIFECYCLE) if (to !== "ARCHIVED") expect(canTransition("ARCHIVED", to)).toBe(false);
  });
  test("DRAFT cannot jump to ACTIVE or review", () => {
    expect(canTransition("DRAFT", "ACTIVE")).toBe(false);
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(false);
    expect(canTransition("DRAFT", "READY_FOR_REVIEW")).toBe(false);
    expect(canTransition("DRAFT", "CONFIGURATION_REQUIRED")).toBe(true);
    expect(canTransition("CONFIGURATION_REQUIRED", "ACTIVE")).toBe(false);
    expect(canTransition("CONFIGURATION_REQUIRED", "READY_FOR_REVIEW")).toBe(true);
    expect(canTransition("READY_FOR_REVIEW", "ACTIVE")).toBe(true);
  });
  test("a live service must be paused or deprecated before it is archived", () => {
    expect(canTransition("ACTIVE", "ARCHIVED")).toBe(false);
    expect(canTransition("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransition("PAUSED", "ARCHIVED")).toBe(true);
    expect(canTransition("DEPRECATED", "ACTIVE")).toBe(false);
  });
  test("every state has a defined transition list and no self-loops", () => {
    for (const s of SERVICE_LIFECYCLE) {
      expect(Array.isArray(LIFECYCLE_TRANSITIONS[s])).toBe(true);
      expect(LIFECYCLE_TRANSITIONS[s]).not.toContain(s);
    }
  });
  test("ACTIVE on a coming-soon SKU lands on PUBLISHED (visible, not bookable)", () => {
    const soon = serviceCatalogConfigSchema.parse({ comingSoon: true });
    expect(effectiveLifecycleTarget("ACTIVE", soon)).toBe("PUBLISHED");
    expect(effectiveLifecycleTarget("ACTIVE", null)).toBe("ACTIVE");
    expect(lifecycleFlags("PUBLISHED")).toEqual({ isActive: true, isCustomerVisible: true, isBookable: false });
  });
  test("paused, deprecated, archived and draft are neither visible nor bookable", () => {
    for (const s of ["PAUSED", "DEPRECATED", "ARCHIVED", "DRAFT", "READY_FOR_REVIEW", "CONFIGURATION_REQUIRED"] as const) {
      expect(lifecycleFlags(s)).toEqual({ isActive: false, isCustomerVisible: false, isBookable: false });
    }
    expect(lifecycleFlags("ACTIVE")).toEqual({ isActive: true, isCustomerVisible: true, isBookable: true });
  });
});

describe("publish gate — content and taxonomy (phase-aware)", () => {
  test("a complete service passes", () => {
    expect(validateForActivation(core(), policies)).toEqual({ ok: true });
  });
  test("a blank description blocks going LIVE", () => {
    const r = validateForActivation(core({ description: "   " }), policies);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.map((i) => i.code)).toContain("CONTENT_DESCRIPTION_MISSING");
  });
  test("a blank name blocks going LIVE, even for a grandfathered row", () => {
    const r = validateForActivation(core({ name: "" }), policies, { grandfathered: true });
    expect(!r.ok && r.issues.map((i) => i.code)).toContain("CONTENT_TITLE_MISSING");
  });
  test("a new service outside the customer taxonomy cannot be published", () => {
    const r = validateForActivation(core({ categoryId: null }), policies);
    expect(!r.ok && r.issues.map((i) => i.code)).toContain("TAXONOMY_MISSING");
  });
  test("missing scope lists do not block (approved customer fallback exists)", () => {
    expect(validateForActivation(core({ includedServices: [], excludedServices: [] }), policies).ok).toBe(true);
  });
});

describe("partner job brief", () => {
  test("reads what was booked from the snapshot; no prices or config", () => {
    const brief = partnerJobBrief(
      {
        variant: { id: "leather", name: "Leather", price: 250 },
        quantity: 3,
        unitLabel: "seats",
        unitPrice: 250,
        audience: "senior-women",
        durationMinutes: 105,
        duration: { preparationMinutes: 10, serviceMinutes: 60, addonMinutes: 20, cleanupMinutes: 15, totalMinutes: 105 },
        addonQuantities: { deodorise: 2 },
      },
      [
        { id: "deodorise", name: "Deodorise", price: 98 },
        { id: "conditioner", name: "Leather conditioner", price: 149, quantity: 1 },
      ],
      105,
    );
    expect(brief).toEqual({
      variant: "Leather",
      audience: "Senior women",
      quantity: 3,
      unit: "seats",
      addons: [
        { name: "Deodorise", quantity: 2 },
        { name: "Leather conditioner", quantity: 1 },
      ],
      durationMinutes: 105,
      duration: { preparationMinutes: 10, serviceMinutes: 60, addonMinutes: 20, cleanupMinutes: 15, totalMinutes: 105 },
    });
    expect(JSON.stringify(brief)).not.toMatch(/price|catalogConfig|matching/i);
  });
  test("older bookings without a snapshot still produce a safe brief", () => {
    expect(partnerJobBrief(null, null, 60)).toEqual({
      variant: null,
      audience: null,
      quantity: 1,
      unit: null,
      addons: [],
      durationMinutes: 60,
      duration: null,
    });
  });
});
