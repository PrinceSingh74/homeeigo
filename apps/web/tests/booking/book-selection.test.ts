/**
 * The booking page's selection controls (option, quantity, add-on units) send ids and counts only;
 * the server prices them. These rules decide WHAT is sent and how the stepper moves — never a price.
 *
 * Run from apps/web: `bun test tests/booking`.
 */
import { describe, expect, test } from "bun:test";
import {
  addonQuantityCap,
  addonQuantitiesPayload,
  bookQuantityRule,
  bookVariants,
  clampQuantity,
  effectiveBookSelection,
} from "@/lib/book-selection";
import { bookedSelectionLabel } from "@/lib/booking-summary";
import type { PublicCatalogConfig, QuantityRule } from "@/types/backend";

const RULE: QuantityRule = { type: "UNIT", unitLabel: "unit", unitLabelPlural: "units", min: 1, max: 8, step: 1, default: 2 };
const VARIANTS: NonNullable<PublicCatalogConfig["variants"]> = [
  { id: "split", name: "Split AC", price: 599, active: true },
  { id: "window", name: "Window AC", price: 499, active: true, quantity: { min: 1, max: 3 } },
];

describe("what the booking page sends", () => {
  test("a carried selection is sent as it came, even out of range — the server says no, the page never corrects it silently", () => {
    expect(effectiveBookSelection({ quantity: 99 }, { quantity: RULE })).toEqual({ quantity: 99 });
  });

  test("a quantity-priced service with nothing carried sends the rule's default, else its minimum", () => {
    expect(effectiveBookSelection(null, { quantity: RULE })).toEqual({ quantity: 2 });
    expect(effectiveBookSelection(null, { quantity: { ...RULE, default: undefined } })).toEqual({ quantity: 1 });
  });

  test("a service with options and nothing carried sends an empty selection: the server prices the base price or asks for an option", () => {
    expect(effectiveBookSelection(null, { variants: VARIANTS })).toEqual({});
  });

  test("a service with neither options nor a quantity rule sends no selection (a price tier applies)", () => {
    expect(effectiveBookSelection(null, {})).toBeNull();
    expect(effectiveBookSelection(null, null)).toBeNull();
    expect(effectiveBookSelection(null, { quantity: { ...RULE, type: "NONE" } })).toBeNull();
  });

  test("only active options are offered, and a NONE quantity rule is no rule", () => {
    expect(bookVariants({ variants: [...VARIANTS, { id: "old", name: "Old", price: 1, active: false }] }).map((v) => v.id)).toEqual(["split", "window"]);
    expect(bookVariants(null)).toEqual([]);
    expect(bookQuantityRule({ quantity: { ...RULE, type: "NONE" } })).toBeNull();
    expect(bookQuantityRule({ quantity: RULE })).toEqual(RULE);
  });
});

describe("the quantity stepper", () => {
  const bounds = { min: 2, max: 8, step: 2 };

  test("steps stay on the rule's grid and inside its bounds", () => {
    expect(clampQuantity(4, bounds)).toBe(4);
    expect(clampQuantity(5, bounds)).toBe(6);
    expect(clampQuantity(0, bounds)).toBe(2);
    expect(clampQuantity(10, bounds)).toBe(8);
  });

  test("a value the URL carried out of range comes back to the nearest bound on the first press", () => {
    expect(clampQuantity(99 - 2, bounds)).toBe(8);
    expect(clampQuantity(NaN, bounds)).toBe(2);
  });
});

describe("add-on units", () => {
  test("an add-on takes more than one unit only when the server's catalogue says so", () => {
    expect(addonQuantityCap({})).toBe(1);
    expect(addonQuantityCap({ maxQuantity: 4 })).toBe(4);
    expect(addonQuantityCap({ maxQuantity: 4, quantityAllowed: false })).toBe(1);
    expect(addonQuantityCap({ maxQuantity: 0 })).toBe(1);
  });

  test("only units above one, only for selected add-ons, never above the cap, are sent", () => {
    const caps: Record<string, number> = { fridge: 3, sofa: 1 };
    const payload = addonQuantitiesPayload(["fridge", "sofa"], { fridge: 2, sofa: 2, oven: 3 }, (id) => caps[id] ?? 1);
    expect(payload).toEqual({ fridge: 2 });
    expect(addonQuantitiesPayload(["fridge"], { fridge: 1 }, () => 3)).toBeUndefined();
    expect(addonQuantitiesPayload(["fridge"], { fridge: 9 }, () => 3)).toEqual({ fridge: 3 });
  });
});

describe("the booked selection, from the server's booking payload", () => {
  test("names the option, the quantity with its unit and who it is for — in the server's words", () => {
    expect(bookedSelectionLabel({ variant: "Split AC", audience: null, quantity: 3, unit: "unit", addons: [], durationMinutes: 90, duration: null })).toBe("Split AC · 3 unit");
    expect(bookedSelectionLabel({ variant: null, audience: "Women", quantity: 1, unit: null, addons: [], durationMinutes: null, duration: null })).toBe("Women");
  });

  test("a single-unit booking with no option names nothing: there is nothing to add to the service name", () => {
    expect(bookedSelectionLabel({ variant: null, audience: null, quantity: 1, unit: null, addons: [], durationMinutes: null, duration: null })).toBeNull();
    expect(bookedSelectionLabel(undefined)).toBeNull();
    expect(bookedSelectionLabel(null)).toBeNull();
  });

  test("a quantity above one with no unit label is still named", () => {
    expect(bookedSelectionLabel({ variant: null, audience: null, quantity: 2, unit: null, addons: [], durationMinutes: null, duration: null })).toBe("2");
  });
});
