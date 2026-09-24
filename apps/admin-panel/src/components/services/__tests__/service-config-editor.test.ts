/**
 * The service editor must round-trip configuration it does not edit. It used to rebuild
 * catalogConfig from `{}` on every save, silently deleting coverage, materials, equipment, variant
 * inclusions / quantity overrides, add-on compatibility and payment timing.
 *
 *   bun test src/components/services   (from apps/admin-panel)
 */
import { describe, expect, test } from "bun:test";
import { extrasFromRow, extrasToInput } from "../ServiceConfigEditor";
import type { AdminServiceRow, ServiceCatalogConfig } from "@/services/admin-api";

const STORED: ServiceCatalogConfig = {
  materialPolicy: "PROFESSIONAL_PROVIDED",
  equipmentPolicy: "CUSTOMER_PROVIDED",
  coverage: { pincodes: ["110001"] },
  materials: [{ name: "Shampoo", provider: "PROFESSIONAL" }],
  variants: [
    { id: "fabric", name: "Fabric", price: 150, inclusions: ["Vacuum"], quantity: { min: 1, max: 4 } },
  ],
  addons: [{ id: "guard", name: "Guard", price: 99, compatibleVariantIds: ["fabric"], description: "Protective coat" }],
  payment: { paymentTiming: "BEFORE_DISPATCH", walletAllowed: true },
  duration: { minMin: 30, maxMin: 90, serviceMin: 60 },
  safety: { warnings: ["Keep pets away"] },
};

const row = (cfg: ServiceCatalogConfig): AdminServiceRow =>
  ({
    id: "s1",
    name: "Sofa",
    slug: "sofa",
    description: "Sofa cleaning",
    detailedDescription: null,
    category: "cleaning",
    subcategory: null,
    basePrice: 150,
    minPrice: null,
    maxPrice: null,
    estimatedDuration: 60,
    icon: null,
    isActive: true,
    isFeatured: false,
    isPopular: false,
    bookingCount: 0,
    availableCities: [],
    createdAt: "2026-09-21T00:00:00Z",
    catalogConfig: cfg,
    taxonomy: { category: { slug: "home-cleaning", name: "Home Cleaning" }, subcategory: { slug: "furnishings", name: "Furnishings" } },
    serviceCode: "sofa",
  }) as AdminServiceRow;

describe("extrasToInput merges onto the stored configuration", () => {
  test("an untouched save keeps every field the form does not model", () => {
    const out = extrasToInput(extrasFromRow(row(STORED)), STORED).catalogConfig!;
    expect(out.coverage).toEqual({ pincodes: ["110001"] });
    expect(out.materials).toEqual([{ name: "Shampoo", provider: "PROFESSIONAL" }]);
    expect(out.safety).toEqual({ warnings: ["Keep pets away"] });
    expect(out.payment?.paymentTiming).toBe("BEFORE_DISPATCH");
    expect(out.duration).toMatchObject({ minMin: 30, maxMin: 90, serviceMin: 60 });
    expect(out.variants?.[0]).toMatchObject({ id: "fabric", inclusions: ["Vacuum"], quantity: { min: 1, max: 4 } });
    expect(out.addons?.[0]).toMatchObject({ id: "guard", compatibleVariantIds: ["fabric"], description: "Protective coat" });
  });
  test("a field the form owns can still be cleared", () => {
    const e = { ...extrasFromRow(row(STORED)), equipmentPolicy: "" };
    const out = extrasToInput(e, STORED).catalogConfig!;
    expect(out.equipmentPolicy).toBeUndefined();
    expect(out.materialPolicy).toBe("PROFESSIONAL_PROVIDED");
  });
  test("add-on dependency lists are owned by the form: set, kept, and cleared deliberately", () => {
    const e = extrasFromRow(row(STORED));
    expect(e.addons[0]!.compatible).toBe("fabric"); // loaded from the stored row
    e.addons = [{ ...e.addons[0]!, conflicts: "", requires: "", maxQuantity: "2" }];
    const kept = extrasToInput(e, STORED).catalogConfig!;
    expect(kept.addons?.[0]).toMatchObject({ compatibleVariantIds: ["fabric"], maxQuantity: 2, description: "Protective coat" });
    e.addons = [{ ...e.addons[0]!, compatible: "" }];
    const cleared = extrasToInput(e, STORED).catalogConfig!;
    expect(cleared.addons?.[0]?.compatibleVariantIds).toBeUndefined();
    expect(cleared.addons?.[0]?.description).toBe("Protective coat");
  });
  test("taxonomy and internal code travel to the API", () => {
    const e = { ...extrasFromRow(row(STORED)), internalServiceCode: "OPS.1" };
    const input = extrasToInput(e, STORED);
    expect(input.categorySlug).toBe("home-cleaning");
    expect(input.subcategorySlug).toBe("furnishings");
    expect(input.internalServiceCode).toBe("OPS.1");
  });
  test("editing only prices keeps coverage, materials and add-on compatibility (Phase 05)", () => {
    const e = { ...extrasFromRow(row(STORED)), minPrice: "120", maxPrice: "220" };
    e.variants = e.variants.map((v) => ({ ...v, price: "175" }));
    const input = extrasToInput(e, STORED);
    expect(input.minPrice).toBe(120);
    expect(input.maxPrice).toBe(220);
    const out = input.catalogConfig!;
    expect(out.variants?.[0]).toMatchObject({ id: "fabric", price: 175, inclusions: ["Vacuum"], quantity: { min: 1, max: 4 } });
    expect(out.coverage).toEqual({ pincodes: ["110001"] });
    expect(out.materials).toEqual([{ name: "Shampoo", provider: "PROFESSIONAL" }]);
    expect(out.addons?.[0]?.compatibleVariantIds).toEqual(["fabric"]);
  });
});

describe("Phase 06 requirements in the editor", () => {
  const WITH_REQS: ServiceCatalogConfig = {
    ...STORED,
    requirements: [
      { id: "steam", itemCode: "steam-cleaner", responsibility: "PROFESSIONAL", charge: "INCLUDED", partnerInstructions: "Check the hose", internalNote: "Rental #A12", sortOrder: 2, active: true },
      { id: "water", itemCode: "water-access", responsibility: "CUSTOMER", enforcement: "REQUIRED_BEFORE_BOOKING", verification: "CUSTOMER_ATTESTATION", active: true },
    ],
    requirementItems: { "steam-cleaner": { code: "steam-cleaner", kind: "EQUIPMENT", name: "Steam cleaner", isActive: true } },
  };

  test("untouched requirements round-trip exactly; server-owned requirementItems never goes back", () => {
    const out = extrasToInput(extrasFromRow(row(WITH_REQS)), WITH_REQS).catalogConfig as ServiceCatalogConfig;
    expect(out.requirements).toEqual(WITH_REQS.requirements);
    expect(out.requirementItems).toBeUndefined();
  });

  test("editing one requirement keeps every other piece of configuration (merge, not rebuild)", () => {
    const e = extrasFromRow(row(WITH_REQS));
    e.requirementAssignments = e.requirementAssignments.map((r) => (r.id === "steam" ? { ...r, responsibility: "CUSTOMER", charge: "NOT_APPLICABLE" } : r));
    const out = extrasToInput(e, WITH_REQS).catalogConfig as ServiceCatalogConfig;
    expect(out.requirements?.find((r) => r.id === "steam")).toMatchObject({ responsibility: "CUSTOMER", charge: "NOT_APPLICABLE", partnerInstructions: "Check the hose", internalNote: "Rental #A12" });
    expect(out.requirements?.find((r) => r.id === "water")).toEqual(WITH_REQS.requirements![1]);
    // Nothing stored is lost. (The editor also normalises variant `active` and payment booleans to explicit
    // values — pre-existing behaviour from Phase 00–04, recorded in the Phase 06 doc, not changed here.)
    for (const k of ["coverage", "materials", "variants", "addons", "payment", "duration", "safety"] as const) expect(out[k], k).toMatchObject(STORED[k] as object);
  });

  test("removing every requirement clears the key; a service without requirements stays without", () => {
    const e = extrasFromRow(row(WITH_REQS));
    e.requirementAssignments = [];
    expect((extrasToInput(e, WITH_REQS).catalogConfig as ServiceCatalogConfig).requirements).toBeUndefined();
    expect((extrasToInput(extrasFromRow(row(STORED)), STORED).catalogConfig as ServiceCatalogConfig).requirements).toBeUndefined();
  });
});
