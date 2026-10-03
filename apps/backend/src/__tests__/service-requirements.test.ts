/**
 * Phase 06 — pure rules of the requirement domain: validation, deterministic resolution,
 * deduplication, conflicts, projections. No I/O.
 */
import { describe, expect, test } from "bun:test";
import {
  buildRequirementsSnapshot,
  customerRequirementsFromSnapshot,
  customerRequirementsView,
  partnerRequirementsFromSnapshot,
  requirementAssignmentSchema,
  resolveServiceRequirements,
  validateServiceRequirements,
  type RequirementAssignment,
  type RequirementItemInfo,
} from "../lib/service-requirements";
import { serviceCatalogConfigSchema } from "../lib/service-catalog-config";

const items: Record<string, RequirementItemInfo> = {
  "steam-cleaner": { code: "steam-cleaner", kind: "EQUIPMENT", name: "Steam cleaner", customerLabel: null, isActive: true },
  "upholstery-shampoo": { code: "upholstery-shampoo", kind: "MATERIAL", name: "Upholstery shampoo", customerLabel: "Cleaning shampoo", isActive: true },
  "power-socket": { code: "power-socket", kind: "CUSTOMER_PRECONDITION", name: "Working power socket within 5 m", customerLabel: "A working power socket near the sofa", isActive: true },
  "water-access": { code: "water-access", kind: "CUSTOMER_PRECONDITION", name: "Running water access", customerLabel: "Access to running water", isActive: true },
  "stain-guard-spray": { code: "stain-guard-spray", kind: "MATERIAL", name: "Stain guard spray", customerLabel: null, isActive: true },
  "old-ladder": { code: "old-ladder", kind: "EQUIPMENT", name: "Ladder", customerLabel: null, isActive: false },
};
const parse = (r: Record<string, unknown>) => requirementAssignmentSchema.parse(r);
const cfg = (reqs: RequirementAssignment[], extra: Record<string, unknown> = {}) =>
  ({
    variants: [{ id: "fabric", name: "Fabric", price: 250, active: true }, { id: "leather", name: "Leather", price: 400, active: true }],
    addons: [{ id: "stain-guard", name: "Stain guard", price: 99, active: true }, { id: "deodorise", name: "Deodorise", price: 49, active: true }],
    quantity: { type: "SOFA_SEAT", unitLabel: "seat", min: 1, max: 6, step: 1, default: 3 },
    requirements: reqs,
    requirementItems: items,
    ...extra,
  }) as never;

const base: RequirementAssignment[] = [
  parse({ id: "bring-steam-cleaner", itemCode: "steam-cleaner", responsibility: "PROFESSIONAL", charge: "INCLUDED", partnerInstructions: "Portable unit; check the hose seal.", internalNote: "Rental contract #A12", sortOrder: 2 }),
  parse({ id: "shampoo", itemCode: "upholstery-shampoo", responsibility: "PROFESSIONAL", charge: "INCLUDED", quantity: 0.25, unit: "litre", quantityBasis: "PER_SELECTED_UNIT", sortOrder: 1 }),
  parse({ id: "socket", itemCode: "power-socket", responsibility: "CUSTOMER", enforcement: "REQUIRED_BEFORE_ARRIVAL", verification: "PARTNER_CHECK", customerNote: "The steam cleaner needs a standard 3-pin socket.", sortOrder: 3 }),
  parse({ id: "water", itemCode: "water-access", responsibility: "CUSTOMER", enforcement: "REQUIRED_BEFORE_BOOKING", verification: "CUSTOMER_ATTESTATION", sortOrder: 4 }),
  parse({ id: "stain-guard-spray", itemCode: "stain-guard-spray", responsibility: "PROFESSIONAL", charge: "CHARGEABLE", when: { addonIds: ["stain-guard"] }, sortOrder: 5 }),
];

describe("assignment schema", () => {
  test("quantity, unit and basis travel together — no fake 1", () => {
    expect(() => parse({ id: "a", itemCode: "upholstery-shampoo", responsibility: "PROFESSIONAL", charge: "INCLUDED", quantity: 1 })).toThrow();
    expect(() => parse({ id: "a", itemCode: "upholstery-shampoo", responsibility: "PROFESSIONAL", charge: "INCLUDED", quantity: 0, unit: "l", quantityBasis: "PER_BOOKING" })).toThrow();
    expect(() => parse({ id: "a", itemCode: "upholstery-shampoo", responsibility: "PROFESSIONAL", charge: "INCLUDED", quantity: 20000, unit: "l", quantityBasis: "PER_BOOKING" })).toThrow();
    expect(parse({ id: "a", itemCode: "upholstery-shampoo", responsibility: "PROFESSIONAL", charge: "INCLUDED", quantity: 0.5, unit: "litre", quantityBasis: "PER_BOOKING" }).quantity).toBe(0.5);
  });
  test("a customer-provided item is never included or charged; chargeable needs its add-on; blocking needs attestation", () => {
    expect(() => parse({ id: "a", itemCode: "x", responsibility: "CUSTOMER", charge: "INCLUDED" })).toThrow();
    expect(() => parse({ id: "a", itemCode: "x", responsibility: "PROFESSIONAL", charge: "CHARGEABLE" })).toThrow();
    expect(() => parse({ id: "a", itemCode: "x", responsibility: "CUSTOMER", enforcement: "REQUIRED_BEFORE_BOOKING" })).toThrow();
    expect(() => parse({ id: "a", itemCode: "x", responsibility: "CUSTOMER", enforcement: "REQUIRED_BEFORE_BOOKING", verification: "CUSTOMER_ATTESTATION" })).not.toThrow();
  });
  test("codes and long / Unicode text are bounded, unknown keys refused", () => {
    expect(() => parse({ id: "Bad Code", itemCode: "x", responsibility: "CUSTOMER" })).toThrow();
    expect(() => parse({ id: "a", itemCode: "x", responsibility: "CUSTOMER", customerNote: "x".repeat(501) })).toThrow();
    expect(parse({ id: "a", itemCode: "x", responsibility: "CUSTOMER", customerNote: "कृपया पानी की व्यवस्था रखें — 请准备好水 🙏" }).customerNote).toContain("🙏");
    expect(() => parse({ id: "a", itemCode: "x", responsibility: "CUSTOMER", secretField: 1 })).toThrow();
  });
  test("the catalogue config accepts requirements and requirementItems", () => {
    const parsed = serviceCatalogConfigSchema.parse({ requirements: [base[2]], requirementItems: { "power-socket": items["power-socket"] } });
    expect(parsed.requirements?.[0]?.itemCode).toBe("power-socket");
  });
});

describe("validateServiceRequirements", () => {
  test("no requirements → no issues; consistent configuration → no issues", () => {
    expect(validateServiceRequirements(null)).toEqual([]);
    expect(validateServiceRequirements(cfg([]))).toEqual([]);
    expect(validateServiceRequirements(cfg(base))).toEqual([]);
  });
  test("unknown item, inactive item, undecided responsibility, unspecified charge", () => {
    const codes = (reqs: RequirementAssignment[]) => validateServiceRequirements(cfg(reqs)).map((i) => i.code);
    expect(codes([parse({ id: "a", itemCode: "missing-thing", responsibility: "PROFESSIONAL", charge: "INCLUDED" })])).toContain("REQUIREMENT_ITEM_UNKNOWN");
    expect(codes([parse({ id: "a", itemCode: "old-ladder", responsibility: "PROFESSIONAL", charge: "INCLUDED" })])).toContain("REQUIREMENT_ITEM_INACTIVE");
    expect(codes([parse({ id: "a", itemCode: "steam-cleaner", responsibility: "UNKNOWN", charge: "INCLUDED" })])).toContain("REQUIREMENT_RESPONSIBILITY_UNKNOWN");
    expect(codes([parse({ id: "a", itemCode: "steam-cleaner", responsibility: "PROFESSIONAL" })])).toContain("REQUIREMENT_CHARGE_UNSPECIFIED");
  });
  test("a precondition is the customer's and carries no charge / quantity; duplicate ids; bad conditions", () => {
    const codes = (reqs: RequirementAssignment[]) => validateServiceRequirements(cfg(reqs)).map((i) => i.code);
    expect(codes([parse({ id: "a", itemCode: "power-socket", responsibility: "PROFESSIONAL", charge: "INCLUDED" })])).toContain("REQUIREMENT_KIND_INCONSISTENT");
    expect(codes([base[0]!, base[0]!])).toContain("REQUIREMENT_DUPLICATE_ID");
    expect(codes([parse({ id: "a", itemCode: "steam-cleaner", responsibility: "PROFESSIONAL", charge: "INCLUDED", when: { variantIds: ["velvet"] } })])).toContain("REQUIREMENT_CONDITION_INVALID");
    expect(codes([parse({ id: "a", itemCode: "steam-cleaner", responsibility: "PROFESSIONAL", charge: "INCLUDED", when: { addonIds: ["polish"] } })])).toContain("REQUIREMENT_CONDITION_INVALID");
    expect(codes([parse({ id: "a", itemCode: "steam-cleaner", responsibility: "PROFESSIONAL", charge: "INCLUDED", when: { minQuantity: 7 } })])).toContain("REQUIREMENT_CONDITION_INVALID");
    expect(codes([parse({ id: "a", itemCode: "stain-guard-spray", responsibility: "PROFESSIONAL", charge: "CHARGEABLE", when: { addonIds: ["free"] } })])).toContain("REQUIREMENT_CONDITION_INVALID");
  });
  test("a chargeable item needs a priced add-on; per-unit quantity needs a quantity rule", () => {
    const withFreeAddon = cfg([parse({ id: "a", itemCode: "stain-guard-spray", responsibility: "PROFESSIONAL", charge: "CHARGEABLE", when: { addonIds: ["free"] } })], {
      addons: [{ id: "free", name: "Free thing", price: 0, active: true }],
    });
    expect(validateServiceRequirements(withFreeAddon).map((i) => i.code)).toContain("REQUIREMENT_CHARGE_INVALID");
    const noRule = cfg([base[1]!], { quantity: undefined });
    expect(validateServiceRequirements(noRule).map((i) => i.code)).toContain("REQUIREMENT_QUANTITY_BASIS_INVALID");
  });
  test("conflicting assignments of one item that can apply together are refused; disjoint variants are not", () => {
    const conflict = [
      base[0]!,
      parse({ id: "customer-steam", itemCode: "steam-cleaner", responsibility: "CUSTOMER" }),
    ];
    expect(validateServiceRequirements(cfg(conflict)).map((i) => i.code)).toContain("REQUIREMENT_CONFLICT");
    const disjoint = [
      parse({ id: "steam-fabric", itemCode: "steam-cleaner", responsibility: "PROFESSIONAL", charge: "INCLUDED", when: { variantIds: ["fabric"] } }),
      parse({ id: "steam-leather", itemCode: "steam-cleaner", responsibility: "CUSTOMER", when: { variantIds: ["leather"] } }),
    ];
    expect(validateServiceRequirements(cfg(disjoint))).toEqual([]);
  });
  test("items not loaded is itself an issue (fail closed), inactive assignments are ignored", () => {
    expect(validateServiceRequirements({ requirements: base } as never).map((i) => i.code)).toEqual(["REQUIREMENT_ITEMS_UNRESOLVED"]);
    const inactive = [parse({ id: "a", itemCode: "missing-thing", responsibility: "PROFESSIONAL", charge: "INCLUDED", active: false })];
    expect(validateServiceRequirements(cfg(inactive))).toEqual([]);
  });
});

describe("resolveServiceRequirements", () => {
  test("base selection: unconditional requirements only, stable order, per-unit quantity multiplied", () => {
    const r = resolveServiceRequirements(cfg(base), { variantId: "fabric", addonIds: [], quantity: 3 });
    if (!r.ok) throw new Error(r.error);
    expect(r.items.map((i) => i.code)).toEqual(["shampoo", "bring-steam-cleaner", "socket", "water"]);
    expect(r.items[0]).toMatchObject({ quantity: 0.75, unit: "litre", source: "BASE" });
    expect(r.items.find((i) => i.code === "bring-steam-cleaner")?.quantity).toBeNull();
  });
  test("conditional add-on requirement appears only with the add-on, tagged with its source and charge add-on", () => {
    const without = resolveServiceRequirements(cfg(base), { variantId: "fabric", addonIds: ["deodorise"], quantity: 1 });
    const withAddon = resolveServiceRequirements(cfg(base), { variantId: "fabric", addonIds: ["stain-guard", "deodorise"], quantity: 1 });
    if (!without.ok || !withAddon.ok) throw new Error("resolve");
    expect(without.items.some((i) => i.code === "stain-guard-spray")).toBe(false);
    const spray = withAddon.items.find((i) => i.code === "stain-guard-spray");
    expect(spray).toMatchObject({ source: "ADDON", charge: "CHARGEABLE", chargeAddonIds: ["stain-guard"] });
  });
  test("equivalent selections resolve identically (add-on order, omitted vs default quantity)", () => {
    const a = resolveServiceRequirements(cfg(base), { variantId: "fabric", addonIds: ["stain-guard", "deodorise"], quantity: 3 });
    const b = resolveServiceRequirements(cfg(base), { variantId: "fabric", addonIds: ["deodorise", "stain-guard"], quantity: 3 });
    expect(a).toEqual(b);
  });
  test("two add-ons needing the same item → one requirement (deduplicated by item); differing ones → conflict", () => {
    const same = [
      parse({ id: "spray-a", itemCode: "stain-guard-spray", responsibility: "PROFESSIONAL", charge: "CHARGEABLE", when: { addonIds: ["stain-guard"] } }),
      parse({ id: "spray-b", itemCode: "stain-guard-spray", responsibility: "PROFESSIONAL", charge: "CHARGEABLE", when: { addonIds: ["deodorise"] } }),
    ];
    const r = resolveServiceRequirements(cfg(same), { variantId: null, addonIds: ["stain-guard", "deodorise"], quantity: 1 });
    if (!r.ok) throw new Error(r.error);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.chargeAddonIds).toEqual(["deodorise", "stain-guard"]);
    const differ = [
      parse({ id: "spray-a", itemCode: "stain-guard-spray", responsibility: "PROFESSIONAL", charge: "INCLUDED", when: { addonIds: ["stain-guard"] } }),
      parse({ id: "spray-b", itemCode: "stain-guard-spray", responsibility: "CUSTOMER", when: { addonIds: ["deodorise"] } }),
    ];
    // Add-on conditions may co-occur, so static validation already refuses this (publish gate) and the
    // resolver fails closed for EVERY selection — even one where only one of them applies.
    expect(validateServiceRequirements(cfg(differ)).map((i) => i.code)).toContain("REQUIREMENT_CONFLICT");
    const bad = resolveServiceRequirements(cfg(differ), { variantId: null, addonIds: ["stain-guard", "deodorise"], quantity: 1 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe("REQUIREMENT_CONFIGURATION_INVALID");
    expect(resolveServiceRequirements(cfg(differ), { variantId: null, addonIds: ["stain-guard"], quantity: 1 }).ok).toBe(false);
  });
  test("an invalid configuration fails closed; no configuration resolves to nothing", () => {
    const r = resolveServiceRequirements(cfg([parse({ id: "a", itemCode: "missing-thing", responsibility: "PROFESSIONAL", charge: "INCLUDED" })]), { variantId: null, addonIds: [], quantity: 1 });
    expect(r.ok).toBe(false);
    expect(resolveServiceRequirements(null, { variantId: null, addonIds: [], quantity: 1 })).toEqual({ ok: true, items: [] });
  });
  test("minimum-quantity and variant conditions", () => {
    const reqs = [
      parse({ id: "big-job", itemCode: "steam-cleaner", responsibility: "PROFESSIONAL", charge: "INCLUDED", when: { minQuantity: 4 } }),
      parse({ id: "leather-kit", itemCode: "upholstery-shampoo", responsibility: "PROFESSIONAL", charge: "INCLUDED", when: { variantIds: ["leather"] } }),
    ];
    const small = resolveServiceRequirements(cfg(reqs), { variantId: "fabric", addonIds: [], quantity: 2 });
    const large = resolveServiceRequirements(cfg(reqs), { variantId: "leather", addonIds: [], quantity: 5 });
    if (!small.ok || !large.ok) throw new Error("resolve");
    expect(small.items).toEqual([]);
    expect(large.items.map((i) => [i.code, i.source])).toEqual([["big-job", "QUANTITY"], ["leather-kit", "VARIANT"]]);
  });
});

describe("projections", () => {
  const resolved = () => {
    const r = resolveServiceRequirements(cfg(base), { variantId: "fabric", addonIds: ["stain-guard"], quantity: 2 });
    if (!r.ok) throw new Error(r.error);
    return r.items;
  };
  test("customer view: grouped, labelled, translated — never partner instructions, internal notes or enums", () => {
    const v = customerRequirementsView(resolved(), { "stain-guard": "Stain guard" });
    expect(v.weBring.map((x) => x.label)).toEqual(["Cleaning shampoo", "Steam cleaner", "Stain guard spray"]);
    expect(v.weBring[2]).toMatchObject({ chargeText: "Charged with Stain guard" });
    expect(v.weBring[0]).toMatchObject({ quantity: "0.5 litre", chargeText: "Included in the price" });
    expect(v.beforeArrival[0]).toMatchObject({ label: "A working power socket near the sofa", note: "The steam cleaner needs a standard 3-pin socket.", timingText: "Before your professional arrives", mustConfirm: false });
    expect(v.beforeBooking[0]).toMatchObject({ label: "Access to running water", mustConfirm: true, timingText: "Confirm before booking" });
    expect(v.optional).toEqual([]);
    expect(v.empty).toBe(false);
    const json = JSON.stringify(v);
    expect(json).not.toContain("Portable unit");
    expect(json).not.toContain("Rental contract");
    expect(json).not.toMatch(/PROFESSIONAL|INCLUDED|REQUIRED_BEFORE|PARTNER_CHECK|itemCode/);
    expect(json).toContain("Charged with Stain guard");
  });
  test("empty customer view is explicit", () => {
    expect(customerRequirementsView([]).empty).toBe(true);
  });
  test("snapshot: immutable record without internal notes; partner brief comes from it", () => {
    const snap = buildRequirementsSnapshot(resolved(), 7, ["water"]);
    expect(snap.schema).toBe("requirements.v1");
    expect(snap.serviceVersion).toBe(7);
    expect(snap.blocking).toEqual(["water"]);
    expect(JSON.stringify(snap)).not.toContain("Rental contract");
    expect(snap.professionalNeeds).toEqual([
      { itemCode: "upholstery-shampoo", kind: "MATERIAL", quantity: 0.5, unit: "litre" },
      { itemCode: "steam-cleaner", kind: "EQUIPMENT", quantity: null, unit: null },
      { itemCode: "stain-guard-spray", kind: "MATERIAL", quantity: null, unit: null },
    ]);
    const brief = partnerRequirementsFromSnapshot({ requirements: snap });
    expect(brief?.bringEquipment[0]).toMatchObject({ label: "Steam cleaner", instructions: "Portable unit; check the hose seal." });
    expect(brief?.bringMaterials.map((m) => [m.label, m.quantity, m.chargeable])).toEqual([["Upholstery shampoo", "0.5 litre", false], ["Stain guard spray", null, true]]);
    expect(brief?.preconditions.map((p) => [p.label, p.check])).toEqual([["Working power socket within 5 m", "VERIFY_ON_ARRIVAL"], ["Running water access", "CONFIRMED_BY_CUSTOMER"]]);
    const customer = customerRequirementsFromSnapshot({ requirements: snap });
    expect(customer?.beforeBooking[0]?.label).toBe("Access to running water");
    expect(JSON.stringify(customer)).not.toContain("Portable unit");
  });
  test("a booking without a requirements snapshot (pre-Phase 06) projects null, never a guess", () => {
    expect(partnerRequirementsFromSnapshot({ materialPolicy: "PROFESSIONAL_PROVIDED" })).toBeNull();
    expect(customerRequirementsFromSnapshot(null)).toBeNull();
  });
});
