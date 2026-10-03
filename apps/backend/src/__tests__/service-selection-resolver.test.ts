/**
 * Phases 03–04: the ONE selection resolver (resolveServiceSelection) and the ONE duration calculator
 * (resolveServiceDuration). Pure — no database. Every rule asserted here is enforced server-side;
 * clients render the resolver's output.
 */
import { describe, expect, test } from "bun:test";
import {
  isSafeMediaUrl,
  resolveSelection,
  resolveServiceDuration,
  resolveServiceSelection,
  serviceCatalogConfigSchema,
  type ServiceCatalogConfig,
} from "../lib/service-catalog-config";

const svc = (over: Record<string, unknown> = {}) => ({
  basePrice: 500,
  minPrice: 500,
  maxPrice: 500,
  estimatedDuration: 60,
  pricingModel: "fixed",
  ...over,
});

const cfg = (raw: unknown): ServiceCatalogConfig => serviceCatalogConfigSchema.parse(raw);

/** A sofa-cleaning style service: seats × price, variants, add-ons with dependencies. */
const SOFA = cfg({
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 10, step: 1, durationPerUnitMin: 15 },
  variants: [
    { id: "fabric", name: "Fabric", price: 150, durationMin: 30 },
    { id: "leather", name: "Leather", price: 250, durationMin: 45 },
    { id: "retired", name: "Retired", price: 99, active: false },
  ],
  variantRequired: true,
  duration: { preparationMin: 10, cleanupMin: 15 },
  addons: [
    { id: "stain-guard", name: "Stain guard", price: 99, durationMin: 10, compatibleVariantIds: ["fabric"] },
    { id: "conditioner", name: "Leather conditioner", price: 149, durationMin: 20, compatibleVariantIds: ["leather"] },
    { id: "deodorise", name: "Deodorise", price: 49, durationMin: 5, maxQuantity: 3 },
    { id: "express", name: "Express", price: 199, conflictsWithAddonIds: ["deep-dry"] },
    { id: "deep-dry", name: "Deep dry", price: 99, durationMin: 30 },
    { id: "cushion", name: "Cushion wash", price: 59, requiresAddonIds: ["deodorise"] },
  ],
});

describe("variant selection", () => {
  test("valid variant prices server-side: seats × variant price", () => {
    const r = resolveServiceSelection(svc(), SOFA, { variantId: "fabric", quantity: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.servicePrice).toBe(450);
      expect(r.snapshot.variant).toEqual({ id: "fabric", name: "Fabric", price: 150 });
      expect(r.snapshot.unitLabel).toBe("seats");
    }
  });
  test("missing required variant → VARIANT_REQUIRED (no silent base-price fallback)", () => {
    const r = resolveServiceSelection(svc(), SOFA, { quantity: 2 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.map((i) => i.code)).toContain("VARIANT_REQUIRED");
    expect(!r.ok && r.error).toBe("INVALID_VARIANT");
  });
  test("unknown variant → INVALID_VARIANT; disabled variant → VARIANT_UNAVAILABLE", () => {
    const unknown = resolveServiceSelection(svc(), SOFA, { variantId: "velvet", quantity: 1 });
    const disabled = resolveServiceSelection(svc(), SOFA, { variantId: "retired", quantity: 1 });
    expect(!unknown.ok && unknown.issues[0]!.code).toBe("INVALID_VARIANT");
    expect(!disabled.ok && disabled.issues[0]!.code).toBe("VARIANT_UNAVAILABLE");
    expect(!disabled.ok && disabled.error).toBe("INVALID_VARIANT");
  });
});

describe("add-on compatibility and dependencies (backend-authoritative)", () => {
  test("compatible add-on is accepted and priced", () => {
    const r = resolveServiceSelection(svc(), SOFA, { variantId: "fabric", quantity: 2, addonIds: ["stain-guard"] });
    expect(r.ok && r.addonTotal).toBe(99);
  });
  test("incompatible add-on → ADDON_INCOMPATIBLE", () => {
    const r = resolveServiceSelection(svc(), SOFA, { variantId: "leather", quantity: 2, addonIds: ["stain-guard"] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues).toEqual([
      expect.objectContaining({ code: "ADDON_INCOMPATIBLE", id: "stain-guard", field: "addonIds" }),
    ]);
  });
  test("duplicate add-on → ADDON_DUPLICATE (never silently de-duplicated)", () => {
    const r = resolveServiceSelection(svc(), SOFA, { variantId: "fabric", quantity: 1, addonIds: ["deep-dry", "deep-dry"] });
    expect(!r.ok && r.issues.map((i) => i.code)).toEqual(["ADDON_DUPLICATE"]);
  });
  test("conflicting add-ons → ADDON_CONFLICT", () => {
    const r = resolveServiceSelection(svc(), SOFA, { variantId: "fabric", quantity: 1, addonIds: ["express", "deep-dry"] });
    expect(!r.ok && r.issues.map((i) => i.code)).toEqual(["ADDON_CONFLICT"]);
  });
  test("missing required add-on → ADDON_REQUIRES; satisfied requirement passes", () => {
    const missing = resolveServiceSelection(svc(), SOFA, { variantId: "fabric", quantity: 1, addonIds: ["cushion"] });
    expect(!missing.ok && missing.issues.map((i) => i.code)).toEqual(["ADDON_REQUIRES"]);
    const ok = resolveServiceSelection(svc(), SOFA, { variantId: "fabric", quantity: 1, addonIds: ["cushion", "deodorise"] });
    expect(ok.ok).toBe(true);
  });
  test("every issue is reported, not only the first", () => {
    const r = resolveServiceSelection(svc(), SOFA, {
      variantId: "leather",
      quantity: 0,
      addonIds: ["stain-guard", "nope", "express", "deep-dry"],
    });
    const got: string[] = r.ok ? [] : r.issues.map((i) => i.code).sort();
    expect(got).toEqual(["ADDON_CONFLICT", "ADDON_INCOMPATIBLE", "ADDON_UNKNOWN", "QUANTITY_BELOW_MIN"]);
  });
  test("add-on availability reflects the current selection", () => {
    const r = resolveServiceSelection(svc(), SOFA, { variantId: "leather", quantity: 1, addonIds: ["express"] });
    const byId = Object.fromEntries(r.addonAvailability.map((a) => [a.id, a]));
    expect(byId["stain-guard"]).toEqual({ id: "stain-guard", available: false, reason: "ADDON_INCOMPATIBLE" });
    expect(byId["conditioner"]!.available).toBe(true);
    expect(byId["deep-dry"]).toEqual({ id: "deep-dry", available: false, reason: "ADDON_CONFLICT" });
  });
  test("add-on units: only up to maxQuantity; the line total is price × units", () => {
    const ok = resolveServiceSelection(svc(), SOFA, {
      variantId: "fabric",
      quantity: 1,
      addonIds: ["deodorise"],
      addonQuantities: { deodorise: 3 },
    });
    expect(ok.ok && ok.addons).toEqual([{ id: "deodorise", name: "Deodorise", unitPrice: 49, quantity: 3, price: 147, unitPaise: 4900, pricePaise: 14700 }]);
    const tooMany = resolveServiceSelection(svc(), SOFA, {
      variantId: "fabric",
      quantity: 1,
      addonIds: ["deodorise"],
      addonQuantities: { deodorise: 4 },
    });
    expect(!tooMany.ok && tooMany.issues.map((i) => i.code)).toEqual(["ADDON_QUANTITY"]);
    const single = resolveServiceSelection(svc(), SOFA, {
      variantId: "fabric",
      quantity: 1,
      addonIds: ["deep-dry"],
      addonQuantities: { "deep-dry": 2 },
    });
    expect(!single.ok && single.issues[0]!.message).toContain("only be added once");
  });
  test("normalization: add-ons in catalogue order, ids only, no prices from the client", () => {
    const r = resolveServiceSelection(svc(), SOFA, { variantId: "fabric", quantity: 1, addonIds: ["deodorise", "stain-guard"] });
    expect(r.normalized.addonIds).toEqual(["stain-guard", "deodorise"]);
    expect(r.normalized.variantId).toBe("fabric");
  });
});

describe("quantity validation (adversarial)", () => {
  const Q = cfg({ quantity: { type: "UNIT", unitLabel: "room", min: 2, max: 8, step: 2, unitPrice: 100 } });
  const codes = (quantity: number) => {
    const r = resolveServiceSelection(svc(), Q, { quantity });
    return r.ok ? [] : r.issues.map((i) => i.code);
  };
  test("min / max / step", () => {
    expect(codes(1)).toEqual(["QUANTITY_BELOW_MIN"]);
    expect(codes(10)).toEqual(["QUANTITY_ABOVE_MAX"]);
    expect(codes(3)).toEqual(["QUANTITY_STEP"]);
    expect(codes(4)).toEqual([]);
  });
  test("NaN, Infinity, decimals, negatives and huge values are rejected, never priced", () => {
    for (const q of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2.0000001, 4.5]) {
      expect(codes(q)).toEqual(["QUANTITY_NOT_INTEGER"]);
    }
    expect(codes(-4)).toEqual(["QUANTITY_BELOW_MIN"]);
    expect(codes(1e15)).toEqual(["QUANTITY_ABOVE_MAX"]);
    expect(codes(Number.MAX_SAFE_INTEGER)).toEqual(["QUANTITY_ABOVE_MAX"]);
  });
  test("a quantity on a service with no quantity rule is QUANTITY_NOT_ALLOWED", () => {
    const r = resolveServiceSelection(svc(), null, { quantity: 3 });
    expect(!r.ok && r.issues.map((i) => i.code)).toEqual(["QUANTITY_NOT_ALLOWED"]);
    expect(!r.ok && r.error).toBe("INVALID_QUANTITY");
  });
  test("required quantity has no default", () => {
    const R = cfg({ quantity: { type: "UNIT", unitLabel: "room", min: 1, max: 5, default: 2, required: true } });
    const r = resolveServiceSelection(svc(), R, {});
    expect(!r.ok && r.issues.map((i) => i.code)).toEqual(["QUANTITY_REQUIRED"]);
  });
  test("variant-specific quantity bounds win over the service rule", () => {
    const V = cfg({
      quantity: { type: "UNIT", unitLabel: "room", min: 1, max: 10 },
      variants: [{ id: "studio", name: "Studio", price: 100, quantity: { min: 1, max: 2 } }],
    });
    const r = resolveServiceSelection(svc(), V, { variantId: "studio", quantity: 3 });
    expect(!r.ok && r.issues.map((i) => i.code)).toEqual(["QUANTITY_ABOVE_MAX"]);
  });
  test("schema: variant quantity override with max < min is rejected", () => {
    const r = serviceCatalogConfigSchema.safeParse({
      quantity: { type: "UNIT", unitLabel: "room", min: 1, max: 10 },
      variants: [{ id: "x", name: "X", price: 1, quantity: { min: 5, max: 2 } }],
    });
    expect(r.success).toBe(false);
  });
});

describe("duration — one calculator", () => {
  test("service × quantity + add-ons + preparation + cleanup = total", () => {
    const r = resolveServiceSelection(svc(), SOFA, { variantId: "fabric", quantity: 3, addonIds: ["stain-guard", "deodorise"], addonQuantities: { deodorise: 2 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // fabric 30 min + 15 min per extra seat (×2) = 60; add-ons 10 + 5×2 = 20; prep 10; cleanup 15
    expect(r.duration).toMatchObject({ serviceMinutes: 60, addonMinutes: 20, preparationMinutes: 10, cleanupMinutes: 15, totalMinutes: 105 });
    expect(r.snapshot.durationMinutes).toBe(105);
  });
  test("HOUR scales the service time only — preparation and cleanup are not multiplied", () => {
    const H = cfg({
      bookingMode: "HOURLY",
      quantity: { type: "HOUR", unitLabel: "hour", min: 1, max: 4, unitPrice: 199 },
      duration: { preparationMin: 10, cleanupMin: 5 },
    });
    const d = resolveServiceDuration(svc({ estimatedDuration: 60 }), H, { quantity: 3 });
    expect(d).toMatchObject({ serviceMinutes: 180, preparationMinutes: 10, cleanupMinutes: 5, totalMinutes: 195 });
  });
  test("no duration config: the service estimate is the whole appointment (live data unchanged)", () => {
    const H = cfg({ bookingMode: "HOURLY", quantity: { type: "HOUR", unitLabel: "hour", min: 1, max: 4, unitPrice: 199 } });
    expect(resolveServiceDuration(svc({ estimatedDuration: 60 }), H, { quantity: 3 }).totalMinutes).toBe(180);
    expect(resolveServiceDuration(svc({ estimatedDuration: 45 }), null).totalMinutes).toBe(45);
  });
  test("customer estimate is the customer-facing range, distinct from operational service time", () => {
    const C = cfg({ duration: { estimatedMin: 90, minMin: 60, maxMin: 120, serviceMin: 100, preparationMin: 10 } });
    const d = resolveServiceDuration(svc(), C);
    expect(d.customerEstimate).toEqual({ estimatedMinutes: 90, minMinutes: 60, maxMinutes: 120 });
    expect(d.serviceMinutes).toBe(100);
    expect(d.totalMinutes).toBe(110);
  });
  test("schema: min ≤ estimated ≤ max, positive integers, totals consistent", () => {
    const bad = (duration: unknown) => serviceCatalogConfigSchema.safeParse({ duration }).success === false;
    expect(bad({ minMin: 120, maxMin: 60 })).toBe(true);
    expect(bad({ estimatedMin: 30, minMin: 60 })).toBe(true);
    expect(bad({ estimatedMin: 200, maxMin: 120 })).toBe(true);
    expect(bad({ serviceMin: 0 })).toBe(true);
    expect(bad({ serviceMin: -30 })).toBe(true);
    expect(bad({ serviceMin: Number.NaN })).toBe(true);
    expect(bad({ serviceMin: Number.POSITIVE_INFINITY })).toBe(true);
    expect(bad({ serviceMin: 12.5 })).toBe(true);
    expect(bad({ preparationMin: -1 })).toBe(true);
    expect(bad({ preparationMin: 10, serviceMin: 40, cleanupMin: 10, totalSlotMin: 90 })).toBe(true);
    expect(bad({ preparationMin: 30, cleanupMin: 30, totalSlotMin: 60 })).toBe(true);
    expect(bad({ preparationMin: 10, serviceMin: 40, cleanupMin: 10, totalSlotMin: 60 })).toBe(false);
  });
  test("add-on and variant durations must be positive whole minutes", () => {
    expect(serviceCatalogConfigSchema.safeParse({ addons: [{ id: "a", name: "A", price: 1, durationMin: -5 }] }).success).toBe(false);
    expect(serviceCatalogConfigSchema.safeParse({ variants: [{ id: "v", name: "V", price: 1, durationMin: 0 }] }).success).toBe(false);
  });
});

describe("admin configuration validation", () => {
  test("dependency references must exist and cannot point at themselves", () => {
    expect(serviceCatalogConfigSchema.safeParse({ addons: [{ id: "a", name: "A", price: 1, requiresAddonIds: ["ghost"] }] }).success).toBe(false);
    expect(serviceCatalogConfigSchema.safeParse({ addons: [{ id: "a", name: "A", price: 1, conflictsWithAddonIds: ["a"] }] }).success).toBe(false);
  });
  test("circular requirements are rejected", () => {
    const r = serviceCatalogConfigSchema.safeParse({
      addons: [
        { id: "a", name: "A", price: 1, requiresAddonIds: ["b"] },
        { id: "b", name: "B", price: 1, requiresAddonIds: ["c"] },
        { id: "c", name: "C", price: 1, requiresAddonIds: ["a"] },
      ],
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("circular");
  });
  test("an add-on that requires something it conflicts with (transitively) is rejected", () => {
    const r = serviceCatalogConfigSchema.safeParse({
      addons: [
        { id: "a", name: "A", price: 1, requiresAddonIds: ["b"] },
        { id: "b", name: "B", price: 1, requiresAddonIds: ["c"] },
        { id: "c", name: "C", price: 1, conflictsWithAddonIds: ["a"] },
      ],
    });
    expect(r.success).toBe(false);
  });
  test("duplicate variant / add-on codes and orphan compatibility references are rejected", () => {
    expect(serviceCatalogConfigSchema.safeParse({ variants: [{ id: "x", name: "X", price: 1 }, { id: "x", name: "Y", price: 2 }] }).success).toBe(false);
    expect(serviceCatalogConfigSchema.safeParse({ addons: [{ id: "a", name: "A", price: 1, compatibleVariantIds: ["missing"] }] }).success).toBe(false);
  });
  test("variantRequired needs an active variant", () => {
    expect(serviceCatalogConfigSchema.safeParse({ variantRequired: true }).success).toBe(false);
  });
  test("media: https or site-relative only", () => {
    for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "http://x.test/a.png", "//evil.test/a.png", "ftp://x/y"]) {
      expect(isSafeMediaUrl(bad)).toBe(false);
      expect(serviceCatalogConfigSchema.safeParse({ media: { gallery: [bad] } }).success).toBe(false);
    }
    expect(isSafeMediaUrl("https://cdn.example.com/a.jpg")).toBe(true);
    expect(isSafeMediaUrl("/images/services/a.jpg")).toBe(true);
    expect(serviceCatalogConfigSchema.safeParse({ video: "javascript:alert(1)" }).success).toBe(false);
  });
  test("content: oversized content is rejected", () => {
    expect(serviceCatalogConfigSchema.safeParse({ content: { customerDisclosures: ["x".repeat(501)] } }).success).toBe(false);
    expect(serviceCatalogConfigSchema.safeParse({ content: { keyBenefits: Array.from({ length: 13 }, (_, i) => `b${i}`) } }).success).toBe(false);
    expect(serviceCatalogConfigSchema.safeParse({ content: { limitations: [""] } }).success).toBe(false);
  });
});

describe("legacy first-error view is the same resolver", () => {
  test("resolveSelection returns the first issue's family with the original shape", () => {
    expect(resolveSelection(svc(), SOFA, { quantity: 2 })).toEqual({ ok: false, error: "INVALID_VARIANT" });
    const ok = resolveSelection(svc(), SOFA, { variantId: "fabric", quantity: 2 });
    const full = resolveServiceSelection(svc(), SOFA, { variantId: "fabric", quantity: 2 });
    expect(ok.ok && full.ok && ok.servicePrice === full.servicePrice && ok.snapshot.durationMinutes === full.duration.totalMinutes).toBe(true);
  });
});
