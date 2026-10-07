/**
 * The customer's booking payload names what was booked from the booking's own frozen selection
 * (`bookings.service_selection` + `bookings.addons`), never from the service's current catalogue.
 * The web client mirrors the shape by hand (apps/web/src/types/backend.ts `BookedSelection`).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { customerSelectionSummary } from "../lib/customer-selection-summary";

const repo = join(import.meta.dir, "../../../..");
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");

describe("customerSelectionSummary", () => {
  test("names the option, quantity, unit, audience and add-on units the booking froze", () => {
    const out = customerSelectionSummary(
      {
        variant: { id: "split", name: "Split AC", price: 599 },
        quantity: 3,
        quantityType: "UNIT",
        unitLabel: "unit",
        unitPrice: 599,
        audience: "women",
        professionalPreference: null,
        durationMinutes: 150,
        addonQuantities: { fridge: 2 },
      },
      [
        { id: "fridge", name: "Fridge Cleaning", price: 198, unitPrice: 99, quantity: 2 },
        { id: "sofa", name: "Sofa Cleaning", price: 149 },
      ],
      150,
    );
    expect(out).toMatchObject({
      variant: "Split AC",
      audience: "Women",
      quantity: 3,
      unit: "unit",
      durationMinutes: 150,
      addons: [
        { name: "Fridge Cleaning", quantity: 2 },
        { name: "Sofa Cleaning", quantity: 1 },
      ],
    });
  });

  test("a booking with no frozen selection (older rows) is one unit of the service with no option", () => {
    expect(customerSelectionSummary(null, null, null)).toMatchObject({ variant: null, audience: null, quantity: 1, unit: null, addons: [], durationMinutes: null });
  });

  test("the web client declares every field of the summary", () => {
    const keys = Object.keys(customerSelectionSummary(null, null, 1));
    const web = read("apps/web/src/types/backend.ts");
    const start = web.indexOf("export type BookedSelection =");
    expect(start).toBeGreaterThan(-1);
    const block = web.slice(start, web.indexOf("};", start));
    for (const k of keys) expect(block).toContain(`${k}:`);
  });
});
