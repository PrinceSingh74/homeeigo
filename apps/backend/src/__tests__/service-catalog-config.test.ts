import { describe, expect, test } from "bun:test";
import {
  catalogConfigGaps,
  coverageAllowsAddress,
  hydrateCatalogConfig,
  parseCatalogConfig,
  publicCatalogConfig,
  resolveSelection,
  serviceCatalogConfigSchema,
  type ServiceCatalogConfig,
} from "../lib/service-catalog-config";

const svc = (over: Partial<{ basePrice: number; minPrice: number | null; maxPrice: number | null; estimatedDuration: number; pricingModel: string }> = {}) => ({
  basePrice: 399,
  minPrice: 399,
  maxPrice: 598,
  estimatedDuration: 60,
  pricingModel: "fixed",
  ...over,
});

const hourly: ServiceCatalogConfig = serviceCatalogConfigSchema.parse({
  bookingMode: "HOURLY",
  quantity: { type: "HOUR", unitLabel: "hour", unitLabelPlural: "hours", min: 1, max: 4, unitPrice: 199 },
});

const beauty: ServiceCatalogConfig = serviceCatalogConfigSchema.parse({
  audiences: ["women", "men", "girls"],
  variants: [
    { id: "classic", name: "Classic cut", price: 300, durationMin: 45 },
    { id: "kids", name: "Kids cut", price: 200, audiences: ["girls"] },
    { id: "retired", name: "Old option", price: 100, active: false },
  ],
  addons: [{ id: "wash", name: "Hair wash", price: 99, durationMin: 15 }],
  professionalPreferences: ["NO_PREFERENCE", "FEMALE"],
});

describe("legacy tiers (no config) stay byte-compatible", () => {
  test("default is base price", () => {
    const r = resolveSelection(svc(), null, {});
    expect(r.ok && r.servicePrice).toBe(399);
  });
  test("max tier accepted, out-of-range rejected", () => {
    expect(resolveSelection(svc(), null, { packagePrice: 598 }).ok).toBe(true);
    expect(resolveSelection(svc(), null, { packagePrice: 5 })).toEqual({ ok: false, error: "INVALID_PACKAGE_PRICE" });
    expect(resolveSelection(svc(), null, { packagePrice: 9999 })).toEqual({ ok: false, error: "INVALID_PACKAGE_PRICE" });
  });
  test("only exact configured tiers — a price between tiers is refused (Phase 6)", () => {
    const s = svc({ minPrice: 499, basePrice: 799, maxPrice: 999 });
    for (const tier of [499, 799, 999]) {
      const r = resolveSelection(s, null, { packagePrice: tier });
      expect(r.ok && r.servicePrice).toBe(tier);
    }
    for (const tampered of [650, 500, 998, 498, 1000, 799.5, 0, -799]) {
      expect(resolveSelection(s, null, { packagePrice: tampered })).toEqual({ ok: false, error: "INVALID_PACKAGE_PRICE" });
    }
  });
  test("shared add-ons priced server-side; unknown add-on rejected", () => {
    const r = resolveSelection(svc(), null, { addonIds: ["fridge", "sofa"] });
    expect(r.ok && r.addonTotal).toBe(248);
    // 2026-09-21: a repeated id is rejected, not silently de-duplicated (every client builds
    // addonIds from a Set, so only a tampered request can repeat one).
    expect(resolveSelection(svc(), null, { addonIds: ["fridge", "sofa", "fridge"] })).toEqual({ ok: false, error: "INVALID_ADDON" });
    expect(resolveSelection(svc(), null, { addonIds: ["free-gold"] })).toEqual({ ok: false, error: "INVALID_ADDON" });
  });
  test("quantity other than 1 is rejected without a quantity rule", () => {
    expect(resolveSelection(svc(), null, { quantity: 3 })).toEqual({ ok: false, error: "INVALID_QUANTITY" });
  });
});

describe("hourly quantity", () => {
  const s = svc({ basePrice: 199, minPrice: 199, maxPrice: 318, pricingModel: "hourly" });
  test.each([
    [1, 199, 60],
    [2, 398, 120],
    [4, 796, 240],
  ])("%i hour(s) = ₹%i, %i min", (q, price, mins) => {
    const r = resolveSelection(s, hourly, { quantity: q });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.servicePrice).toBe(price);
    expect(r.snapshot.durationMinutes).toBe(mins);
    expect(r.snapshot.quantityType).toBe("HOUR");
    expect(r.snapshot.unitLabel).toBe(q === 1 ? "hour" : "hours");
  });
  test("outside min..max, fractional, zero and package prices are rejected", () => {
    for (const q of [0, 5, 1.5, -1]) {
      expect(resolveSelection(s, hourly, { quantity: q })).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    }
    expect(resolveSelection(s, hourly, { quantity: 2, packagePrice: 1 })).toEqual({ ok: false, error: "INVALID_SELECTION" });
  });
  test("defaults to the minimum when no quantity is sent (legacy clients)", () => {
    const r = resolveSelection(s, hourly, {});
    expect(r.ok && r.servicePrice).toBe(199);
  });
});

describe("unit quantity with step, minimum charge and per-unit duration", () => {
  const cfg = serviceCatalogConfigSchema.parse({
    quantity: { type: "UNIT", unitLabel: "bathroom", unitLabelPlural: "bathrooms", min: 1, max: 5, unitPrice: 300, minimumCharge: 450, durationPerUnitMin: 30 },
  });
  test("minimum charge applies to one unit; scales after", () => {
    const one = resolveSelection(svc(), cfg, { quantity: 1 });
    const three = resolveSelection(svc(), cfg, { quantity: 3 });
    expect(one.ok && one.servicePrice).toBe(450);
    expect(three.ok && three.servicePrice).toBe(900);
    expect(three.ok && three.snapshot.durationMinutes).toBe(120);
  });
  test("step is enforced", () => {
    const stepped = serviceCatalogConfigSchema.parse({ quantity: { type: "AREA", unitLabel: "sq. ft.", min: 100, max: 1000, step: 100, unitPrice: 2 } });
    expect(resolveSelection(svc(), stepped, { quantity: 250 })).toEqual({ ok: false, error: "INVALID_QUANTITY" });
    const ok = resolveSelection(svc(), stepped, { quantity: 300 });
    expect(ok.ok && ok.servicePrice).toBe(600);
  });
});

describe("variants, audiences, preferences, service add-ons", () => {
  const s = svc({ basePrice: 699, minPrice: 699, maxPrice: 1048 });
  test("variant price replaces base; inactive variant rejected", () => {
    const r = resolveSelection(s, beauty, { variantId: "classic", audience: "women" });
    expect(r.ok && r.servicePrice).toBe(300);
    expect(resolveSelection(s, beauty, { variantId: "retired" })).toEqual({ ok: false, error: "INVALID_VARIANT" });
    expect(resolveSelection(s, beauty, { variantId: "nope" })).toEqual({ ok: false, error: "INVALID_VARIANT" });
  });
  test("variant audience restrictions", () => {
    expect(resolveSelection(s, beauty, { variantId: "kids", audience: "girls" }).ok).toBe(true);
    expect(resolveSelection(s, beauty, { variantId: "kids", audience: "men" })).toEqual({ ok: false, error: "INVALID_AUDIENCE" });
    expect(resolveSelection(s, beauty, { variantId: "kids" })).toEqual({ ok: false, error: "INVALID_AUDIENCE" });
    expect(resolveSelection(s, beauty, { audience: "boys" })).toEqual({ ok: false, error: "INVALID_AUDIENCE" });
    expect(resolveSelection(s, null, { audience: "women" })).toEqual({ ok: false, error: "INVALID_AUDIENCE" });
  });
  test("preference: only NO_PREFERENCE while assignment cannot honour gender", () => {
    expect(resolveSelection(s, beauty, { variantId: "classic", audience: "men", professionalPreference: "NO_PREFERENCE" }).ok).toBe(true);
    expect(resolveSelection(s, beauty, { variantId: "classic", audience: "men", professionalPreference: "FEMALE" })).toEqual({ ok: false, error: "INVALID_PREFERENCE" });
  });
  test("service add-on catalogue replaces the shared one", () => {
    const r = resolveSelection(s, beauty, { variantId: "classic", audience: "women", addonIds: ["wash"] });
    expect(r.ok && r.addonTotal).toBe(99);
    expect(r.ok && r.snapshot.durationMinutes).toBe(60);
    expect(resolveSelection(s, beauty, { variantId: "classic", audience: "women", addonIds: ["fridge"] })).toEqual({ ok: false, error: "INVALID_ADDON" });
  });
  test("variant + package price is an invalid combination", () => {
    expect(resolveSelection(s, beauty, { variantId: "classic", audience: "women", packagePrice: 699 })).toEqual({ ok: false, error: "INVALID_SELECTION" });
  });
});

describe("config validation, public projection, gaps", () => {
  test("rejects bad rules and duplicates", () => {
    expect(serviceCatalogConfigSchema.safeParse({ quantity: { type: "HOUR", unitLabel: "hour", min: 4, max: 1 } }).success).toBe(false);
    expect(serviceCatalogConfigSchema.safeParse({ bookingMode: "HOURLY" }).success).toBe(false);
    expect(serviceCatalogConfigSchema.safeParse({ variants: [{ id: "a", name: "A", price: 1 }, { id: "a", name: "B", price: 2 }] }).success).toBe(false);
    expect(serviceCatalogConfigSchema.safeParse({ unknownField: 1 }).success).toBe(false);
    expect(serviceCatalogConfigSchema.safeParse({ materialPolicy: "WE_BRING_EVERYTHING" }).success).toBe(false);
  });
  test("invalid stored JSON is never trusted", () => {
    expect(parseCatalogConfig({ quantity: "lots" })).toBeNull();
    expect(parseCatalogConfig(null)).toBeNull();
  });
  test("public view hides inactive items and unsupported preferences", () => {
    const pub = publicCatalogConfig(beauty)!;
    expect(pub.variants!.map((v) => v.id)).toEqual(["classic", "kids"]);
    expect(pub.professionalPreferences).toBeUndefined();
  });
  test("gaps surface missing configuration instead of hiding the service", () => {
    const gaps = catalogConfigGaps(svc({ pricingModel: "hourly" }), null);
    expect(gaps.some((g) => g.includes("no quantity rule"))).toBe(true);
    expect(gaps).toContain("Materials policy not specified");
    expect(catalogConfigGaps(svc({ basePrice: 199, pricingModel: "hourly" }), { ...hourly, materialPolicy: "CUSTOMER_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED" })).toEqual([]);
  });
});

describe("relational hydrate overrides JSON when rows exist", () => {
  test("table price wins over stale JSON; empty tables keep JSON", () => {
    const json = serviceCatalogConfigSchema.parse({
      variants: [{ id: "classic", name: "JSON classic", price: 300 }],
    });
    const hydrated = hydrateCatalogConfig(json, {
      variants: [{ code: "classic", name: "DB classic", price: 450, isActive: true }],
    });
    expect(hydrated?.variants?.[0]).toMatchObject({ id: "classic", name: "DB classic", price: 450 });
    const r = resolveSelection(svc(), hydrated, { variantId: "classic" });
    expect(r.ok && r.servicePrice).toBe(450);
    expect(hydrateCatalogConfig(json, { variants: [] })?.variants?.[0]?.price).toBe(300);
  });
  test("inactive relational variants are rejected by resolveSelection", () => {
    const cfg = hydrateCatalogConfig({}, {
      variants: [{ code: "old", name: "Old", price: 100, isActive: false }],
    });
    expect(resolveSelection(svc(), cfg, { variantId: "old" })).toEqual({ ok: false, error: "INVALID_VARIANT" });
  });
});

describe("coverage is unspecified until cities or pincodes are configured", () => {
  test("empty lists do not reject", () => {
    expect(coverageAllowsAddress({ availableCities: [] }, null, { city: "Pune", zipCode: "411001" }).ok).toBe(true);
  });
  test("configured cities reject other cities; pincodes are exact", () => {
    const cfg = serviceCatalogConfigSchema.parse({ coverage: { cityIds: ["mumbai"], pincodes: ["400001"] } });
    expect(coverageAllowsAddress({ availableCities: ["Mumbai"] }, cfg, { city: "mumbai", zipCode: "400001" }).ok).toBe(true);
    expect(coverageAllowsAddress({ availableCities: ["Mumbai"] }, cfg, { city: "Pune", zipCode: "400001" }).ok).toBe(false);
    expect(coverageAllowsAddress({ availableCities: [] }, cfg, { city: "Mumbai", zipCode: "400020" }).ok).toBe(false);
  });
});
