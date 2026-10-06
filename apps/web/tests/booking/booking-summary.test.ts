/**
 * The booking summary names what the SERVER is pricing. It used to print "{tier} Package ₹{tier
 * price}" for every booking, so a customer who arrived with a variant and a quantity saw a tier
 * they never chose next to a price the server was not charging.
 *
 * Run from apps/web: `bun test tests/booking`.
 */
import { describe, expect, test } from "bun:test";
import { bookingSummaryLine } from "@/lib/booking-summary";
import type { ServiceSelectionSnapshot } from "@/types/backend";

const snapshot = (over: Partial<ServiceSelectionSnapshot> = {}): ServiceSelectionSnapshot => ({
  variant: null,
  quantity: 1,
  quantityType: null,
  unitLabel: null,
  unitPrice: null,
  audience: null,
  professionalPreference: null,
  durationMinutes: 60,
  ...over,
});

const TIER = { name: "Standard", price: 499 };

describe("bookingSummaryLine", () => {
  test("a variant and quantity selection shows the variant, the quantity with its unit, and the server's figure", () => {
    const line = bookingSummaryLine({
      hasSelection: true,
      selection: snapshot({ variant: { id: "v1", name: "Split AC", price: 599 }, quantity: 3, quantityType: "UNIT", unitLabel: "unit", unitPrice: 599 }),
      serverPrice: 1797,
      tier: TIER,
    });
    expect(line).toEqual({ label: "Split AC · 3 unit", amount: 1797 });
  });

  test("a quantity-only selection shows the quantity, never the tier", () => {
    const line = bookingSummaryLine({
      hasSelection: true,
      selection: snapshot({ quantity: 2, quantityType: "HOUR", unitLabel: "hour", unitPrice: 199 }),
      serverPrice: 398,
      tier: TIER,
    });
    expect(line.label).toBe("2 hour");
    expect(line.amount).toBe(398);
    expect(line.label).not.toContain("Standard");
  });

  test("until the server has priced the selection there is no label and no amount — not the tier's", () => {
    const line = bookingSummaryLine({ hasSelection: true, selection: undefined, serverPrice: null, tier: TIER });
    expect(line).toEqual({ label: null, amount: null });
  });

  test("a legacy tier is shown only when the tier really is the selection", () => {
    const line = bookingSummaryLine({ hasSelection: false, selection: snapshot(), serverPrice: 499, tier: TIER });
    expect(line).toEqual({ label: "Standard Package", amount: 499 });
  });

  test("a service with no priced tier names no tier and invents no amount", () => {
    expect(bookingSummaryLine({ hasSelection: false, selection: undefined, serverPrice: null, tier: null })).toEqual({ label: null, amount: null });
  });

  test("the tier line prefers the server's quoted figure over the catalogue price", () => {
    const line = bookingSummaryLine({ hasSelection: false, selection: undefined, serverPrice: 520, tier: TIER });
    expect(line.amount).toBe(520);
    const unquoted = bookingSummaryLine({ hasSelection: false, selection: undefined, serverPrice: null, tier: TIER });
    expect(unquoted.amount).toBe(499);
  });
});
