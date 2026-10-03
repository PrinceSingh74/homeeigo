/**
 * Service-domain race semantics. These are pure: the quote engine never mixes
 * an old variant id with a new price. Live booking races are covered by
 * release-concurrency once the isolated test DB is migrated.
 */
import { describe, expect, test } from "bun:test";
import { hydrateCatalogConfig, resolveSelection, serviceCatalogConfigSchema } from "../lib/service-catalog-config";

const svc = {
  basePrice: 399,
  minPrice: 399,
  maxPrice: 598,
  estimatedDuration: 45,
  pricingModel: "fixed",
};

describe("price update || quote", () => {
  test("a quote sees either the old published price or the new one, never a blend", () => {
    const oldCfg = serviceCatalogConfigSchema.parse({ variants: [{ id: "classic", name: "Classic", price: 300 }] });
    const newCfg = serviceCatalogConfigSchema.parse({ variants: [{ id: "classic", name: "Classic", price: 450 }] });
    const before = resolveSelection(svc, oldCfg, { variantId: "classic" });
    const after = resolveSelection(svc, newCfg, { variantId: "classic" });
    expect(before.ok && before.servicePrice).toBe(300);
    expect(after.ok && after.servicePrice).toBe(450);
  });
});

describe("variant disable || quote", () => {
  test("inactive / missing variants cannot be priced", () => {
    const live = hydrateCatalogConfig({}, {
      variants: [{ code: "classic", name: "Classic", price: 300, isActive: true }],
    });
    const paused = hydrateCatalogConfig({}, {
      variants: [{ code: "classic", name: "Classic", price: 300, isActive: false }],
    });
    expect(resolveSelection(svc, live, { variantId: "classic" }).ok).toBe(true);
    expect(resolveSelection(svc, paused, { variantId: "classic" })).toEqual({ ok: false, error: "INVALID_VARIANT" });
  });
});

describe("addon disable || quote", () => {
  test("disabled add-ons are rejected; compatible lists are enforced", () => {
    const cfg = serviceCatalogConfigSchema.parse({
      variants: [{ id: "classic", name: "Classic", price: 300 }],
      addons: [
        { id: "head-massage", name: "Head massage", price: 99, compatibleVariantIds: ["classic"] },
        { id: "old", name: "Old", price: 10, active: false },
      ],
    });
    expect(resolveSelection(svc, cfg, { variantId: "classic", addonIds: ["head-massage"] }).ok).toBe(true);
    expect(resolveSelection(svc, cfg, { variantId: "classic", addonIds: ["old"] })).toEqual({ ok: false, error: "INVALID_ADDON" });
    expect(resolveSelection(svc, cfg, { addonIds: ["head-massage"] })).toEqual({ ok: false, error: "INVALID_ADDON" });
  });
});
