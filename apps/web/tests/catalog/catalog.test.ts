/**
 * Services catalogue invariants — run from apps/web: `bun test tests/catalog`.
 * Pure (no network, no database): exercises the taxonomy, the merge layer,
 * pricing labels, the content fallback rules, redirects and search safety.
 */
import { describe, expect, test } from "bun:test";
import redirectsJson from "@/lib/catalog/service-redirects.json";
import {
  CATEGORIES,
  CROSS_LISTINGS,
  SERVICE_DEFS,
  addonsFor,
  allServicePaths,
  buildCatalog,
  detailContent,
  serverQuantityPrice,
  isCustomerFacingService,
  normalize,
  priceText,
  PRICING_MODEL_LABEL,
  resolveServicesPath,
  searchServices,
  serviceRedirects,
  DETAILS_CONFIRMED_AT_BOOKING,
} from "@/lib/catalog";
import type { BackendService } from "@/types/backend";

const EXPECTED_CATEGORIES = [
  "Home Help",
  "Home Cleaning",
  "Event & Occasion",
  "Home Maintenance",
  "Appliance & Utility Care",
  "Specialized Care",
  "Laundry & Fabric Care",
  "Vehicle Care",
  "Beauty & Grooming",
  "Senior Care",
  "Pet Care",
  "Executive & Concierge",
  "Special & Future Services",
];

const svc = (over: Partial<BackendService>): BackendService => ({
  id: `c${Math.random().toString(36).slice(2).padEnd(24, "x")}`,
  name: "X",
  slug: "x",
  description: "A customer-facing description.",
  category: "cleaning",
  basePrice: 399,
  minPrice: 399,
  maxPrice: 598,
  estimatedDuration: 60,
  rating: null,
  reviewCount: 0,
  ...over,
});

const LIVE: BackendService[] = [
  svc({ slug: "bathroom-cleaning", name: "Bathroom Cleaning" }),
  svc({
    slug: "hourly-bookings",
    name: "Hourly Bookings",
    basePrice: 199,
    minPrice: 199,
    maxPrice: 318,
    pricingModel: "hourly",
    catalogConfig: {
      bookingMode: "HOURLY",
      quantity: { type: "HOUR", unitLabel: "hour", unitLabelPlural: "hours", min: 1, max: 4, step: 1, unitPrice: 199 },
    },
  }),
  svc({ slug: "salon-at-home", name: "Salon at Home", category: "beauty", basePrice: 699, minPrice: 699, maxPrice: 1048, rating: 4.6, reviewCount: 12 }),
  // Test fixtures that exist in the dev database — must never surface.
  svc({ slug: "adv-service-adv-chaos-mtonowzh", name: "Adv Service adv-chaos-mtonowzh" }),
  svc({ slug: "rc1781462361600", name: "rc1781462361600" }),
  svc({ slug: "phase2-phase2-cert-1786085479780", name: "Phase2 Cert Cleaning phase2-cert-1786085479780" }),
  svc({ slug: "fasade-cleaning", name: "fasade cleaning", description: "deep cleaning", category: "apartments", basePrice: 600, minPrice: 600, maxPrice: 900 }),
];

const catalog = buildCatalog(LIVE);

describe("taxonomy", () => {
  test("all 13 categories exist, in order, with no orphan services", () => {
    expect(CATEGORIES.map((c) => c.name)).toEqual(EXPECTED_CATEGORIES);
    const ids = new Set(CATEGORIES.map((c) => c.id));
    for (const d of SERVICE_DEFS) expect(ids.has(d.category)).toBe(true);
    for (const c of catalog.categories) expect(c.services.length).toBeGreaterThan(0);
  });

  test("slugs are unique, URL-safe; names are customer-ready", () => {
    const slugs = SERVICE_DEFS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const d of SERVICE_DEFS) {
      expect(d.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(d.name).toMatch(/^[A-Z]/);
      expect(isCustomerFacingService({ name: d.name, slug: d.slug })).toBe(true);
      expect(d.short.length).toBeGreaterThan(10);
    }
  });

  test("no two canonical services share a normalised name", () => {
    const names = catalog.services.map((s) => normalize(s.name));
    expect(new Set(names).size).toBe(names.length);
  });

  test("near-duplicates are explicitly consolidated (one canonical page)", () => {
    // Fridge vs Refrigerator, Laundry in two categories, Ironing/Folding: cross-listed, not duplicated.
    const refs = new Set(CROSS_LISTINGS.map((c) => c.ref));
    for (const r of refs) expect(catalog.bySlug.has(r)).toBe(true);
    expect(SERVICE_DEFS.some((d) => /refrigerator cleaning/i.test(d.name))).toBe(false);
    expect(SERVICE_DEFS.filter((d) => /^Laundry$/.test(d.name))).toHaveLength(1);
  });

  test("beauty: one record per treatment, audience-eligible, six audiences covered", () => {
    const beauty = catalog.services.filter((s) => s.category === "beauty");
    expect(new Set(beauty.map((s) => s.name)).size).toBe(beauty.length);
    for (const a of ["women", "men", "girls", "boys", "senior-women", "senior-men"] as const) {
      expect(beauty.some((s) => s.audiences.includes(a))).toBe(true);
    }
  });
});

describe("data quality", () => {
  test("an admin-published plain name shows in its taxonomy group", () => {
    expect(isCustomerFacingService({ name: "spa", slug: "spa" })).toBe(true);
    const next = buildCatalog([
      svc({
        slug: "spa",
        name: "spa",
        description: "body massage",
        basePrice: 499,
        minPrice: 499,
        maxPrice: 499,
        taxonomy: {
          category: { slug: "home-help", name: "Home Help" },
          subcategory: { slug: "hourly", name: "Hourly help" },
        },
      }),
    ]);
    const spa = next.bySlug.get("spa");
    expect(spa?.name).toBe("Spa");
    expect(spa?.status).toBe("live");
    expect(spa?.category).toBe("home-help");
    expect(spa?.subgroup).toBe("hourly");
    expect(spa?.description.startsWith("B")).toBe(true);
    expect(spa?.href).toBe("/services/home-help/spa");
    const home = next.categories.find((c) => c.def.id === "home-help");
    expect(home?.services.some((s) => s.slug === "spa" && s.status === "live")).toBe(true);
  });

  test("internal / test records never become customer services", () => {
    const names = catalog.services.map((s) => s.name).join("|");
    expect(names).not.toMatch(/Adv Service|rc\d{6,}|Phase2|Cert Cleaning|fasade/i);
    expect(catalog.bySlug.get("facade-cleaning")?.status).toBe("live");
    expect(catalog.bySlug.get("facade-cleaning")?.name).toBe("Facade Cleaning");
  });

  test("search never returns internal records", () => {
    for (const q of ["adv service", "adv", "phase2", "rc178", "cert"]) {
      const hits = searchServices(catalog, q).map((r) => r.service.name).join("|");
      expect(hits).not.toMatch(/Adv Service|Phase2|rc\d{6,}/);
    }
  });

  test("status: live only with an active, priced backend record; admin comingSoon wins", () => {
    expect(catalog.bySlug.get("bathroom-cleaning")!.status).toBe("live");
    expect(catalog.bySlug.get("pet-walking")!.status).toBe("coming-soon");
    const held = buildCatalog([svc({ slug: "bathroom-cleaning", name: "Bathroom Cleaning", catalogConfig: { comingSoon: true } })]);
    expect(held.bySlug.get("bathroom-cleaning")!.status).toBe("coming-soon");
  });

  test("ratings only from real reviews", () => {
    expect(catalog.bySlug.get("bathroom-cleaning")!.rating).toBeNull();
    expect(catalog.bySlug.get("salon-at-home")!.rating).toEqual({ value: 4.6, count: 12 });
    const zero = buildCatalog([svc({ slug: "bathroom-cleaning", name: "Bathroom Cleaning", rating: 4.8, reviewCount: 0 })]);
    expect(zero.bySlug.get("bathroom-cleaning")!.rating).toBeNull();
  });
});

describe("pricing honesty", () => {
  test("unit labels only when a quantity rule makes them true", () => {
    const hourly = catalog.bySlug.get("hourly-home-help")!;
    expect(priceText(hourly).label).toBe("₹199 / hour");
    expect(hourly.pricingModel).toBe("hourly");
    // Catalogue expects per-unit, but no rule configured → sold and labelled as fixed.
    const legacyHourly = buildCatalog([svc({ slug: "hourly-bookings", name: "Hourly Bookings", basePrice: 199 })]).bySlug.get("hourly-home-help")!;
    expect(legacyHourly.pricingModel).toBe("fixed");
    expect(legacyHourly.gaps.some((g) => g.includes("no quantity rule"))).toBe(true);
  });

  test("every backend quantity type resolves to a display model (never 'undefined · ₹…')", () => {
    // Backend QUANTITY_TYPES minus NONE; SOFA_SEAT is what a real sofa rule uses.
    const types = ["HOUR", "UNIT", "SEAT", "ROOM", "BATHROOM", "SOFA_SEAT", "MATTRESS", "WINDOW", "FAN", "APPLIANCE", "SQ_FT", "AREA", "LOAD", "ITEM", "PACKAGE"];
    for (const type of types) {
      const view = buildCatalog([
        svc({
          slug: "sofa-deep-cleaning", name: "Sofa Deep Cleaning", basePrice: 250,
          catalogConfig: { quantity: { type, unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1 } } as BackendService["catalogConfig"],
        }),
      ]).bySlug.get("sofa-deep-cleaning")!;
      expect(view.pricingModel, type).toBeDefined();
      expect(PRICING_MODEL_LABEL[view.pricingModel], type).toBeDefined();
      expect(priceText(view).label, type).not.toMatch(/undefined/);
    }
    const sofa = buildCatalog([
      svc({ slug: "sofa-deep-cleaning", name: "Sofa Deep Cleaning", basePrice: 250, catalogConfig: { quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1 } } as BackendService["catalogConfig"] }),
    ]).bySlug.get("sofa-deep-cleaning")!;
    expect(sofa.pricingModel).toBe("per-unit");
    expect(priceText(sofa).label).toBe("₹250 / seat");
  });

  test("coming-soon services never show an amount", () => {
    for (const s of catalog.services.filter((x) => x.status !== "live")) {
      expect(priceText(s).label).not.toMatch(/₹/);
    }
  });

  test("quantity prices come from the server table — the client never multiplies (Phase 05)", () => {
    const withTable = buildCatalog([
      svc({
        slug: "hourly-bookings",
        name: "Hourly Bookings",
        category: "cleaning",
        catalogConfig: { quantity: { type: "HOUR", unitLabel: "hour", min: 1, max: 4, step: 1, unitPrice: 199 } },
        quantityPrices: [
          { quantity: 1, servicePrice: 199, servicePricePaise: 19900 },
          { quantity: 4, servicePrice: 796, servicePricePaise: 79600 },
        ],
      }),
    ]).bySlug.get("hourly-home-help")!;
    expect(serverQuantityPrice(withTable, 4)).toBe(796);
    // A quantity the server did not price is unknown, not computed.
    expect(serverQuantityPrice(withTable, 2)).toBeNull();
  });

  test("shared add-ons only where the taxonomy allows; config add-ons replace them", () => {
    expect(addonsFor(catalog.bySlug.get("bathroom-cleaning")!).map((a) => a.id)).toEqual(["fridge", "sofa", "microwave"]);
    expect(addonsFor(catalog.bySlug.get("salon-at-home")!)).toEqual([]);
    const own = buildCatalog([
      svc({ slug: "salon-at-home", name: "Salon at Home", category: "beauty", catalogConfig: { addons: [{ id: "wash", name: "Hair wash", price: 99, active: true }] } }),
    ]).bySlug.get("salon-at-home")!;
    expect(addonsFor(own).map((a) => a.id)).toEqual(["wash"]);
  });
});

describe("content rules", () => {
  test("no approved fallback + no backend content → confirmed during booking", () => {
    const c = detailContent(catalog.bySlug.get("bathroom-cleaning")!, null);
    expect(c.scope).toBeNull();
    expect(c.policies).toEqual([]);
    expect(DETAILS_CONFIRMED_AT_BOOKING).toBe("Details will be confirmed during booking.");
  });

  test("backend content wins; policy enums become human labels (NOT_SPECIFIED hidden)", () => {
    const s = catalog.bySlug.get("bathroom-cleaning")!;
    const c = detailContent(s, {
      ...LIVE[0]!,
      includedServices: ["Toilet and basin"],
      excludedServices: [],
      catalogConfig: { materialPolicy: "CUSTOMER_PROVIDED", equipmentPolicy: "NOT_SPECIFIED", sparePartsPolicy: "APPROVAL_REQUIRED" },
    });
    expect(c.scope).toEqual({ includes: ["Toilet and basin"], excludes: [] });
    expect(c.policies).toEqual([
      { label: "Materials & products", value: "Provided by you" },
      { label: "Spare parts", value: "Charged separately, only with your approval" },
    ]);
    expect(JSON.stringify(c)).not.toMatch(/CUSTOMER_PROVIDED|APPROVAL_REQUIRED|undefined|NaN/);
  });
});

describe("routing & redirects", () => {
  test("generated redirect map matches the taxonomy (regenerate if this fails)", () => {
    expect(redirectsJson).toEqual(serviceRedirects(buildCatalog(null)));
  });

  test("every redirect lands on a canonical, resolvable page", () => {
    const cat = buildCatalog(null);
    for (const r of redirectsJson) {
      const [path] = r.destination.split("?");
      const kind = resolveServicesPath(cat, path!.replace(/^\/services\//, "").split("/")).kind;
      expect({ r, kind }).toEqual({ r, kind: expect.stringMatching(/^(service|category|audience)$/) });
    }
  });

  test("canonical paths are unique and never redirects", () => {
    const cat = buildCatalog(null);
    const sources = new Set(redirectsJson.map((r) => r.source));
    const canonical = allServicePaths(cat).filter((p) => !sources.has(p));
    expect(new Set(canonical).size).toBe(canonical.length);
    expect(canonical.length).toBe(13 + 6 + cat.services.length);
  });
});
