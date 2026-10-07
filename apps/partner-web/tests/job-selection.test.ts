import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jobSelectionRows, SELECTION_WORD } from "../src/lib/job-selection";
import type { PartnerBooking, PartnerJobBrief } from "../src/types/partner";

/**
 * Phase 13 P2 — the job brief's selection summary: service, option, quantity, add-ons, slot, from the
 * partner projection of `GET /api/bookings/:id` (`job` = backend partnerJobBrief, `service`,
 * `scheduledDate`). Only what the payload carries is rendered; nothing is invented for a missing
 * field, and the customer's selection is named with the word the customer web and the server's own
 * sentences use ("option" — `apps/web/src/app/book/BookPageClient.tsx` `Row label="Option"`,
 * `service-catalog-config.ts` "Choose an option to continue").
 */
const job = (over: Partial<PartnerJobBrief> = {}): PartnerJobBrief => ({
  variant: "2 BHK",
  audience: null,
  quantity: 1,
  unit: null,
  addons: [],
  durationMinutes: 120,
  duration: null,
  ...over,
});

const booking = (over: Partial<PartnerBooking> = {}): Pick<PartnerBooking, "service" | "scheduledDate" | "job"> => ({
  service: { id: "s1", name: "Deep Cleaning", icon: null, basePrice: 999 },
  scheduledDate: "2026-10-09T04:30:00.000Z",
  job: job(),
  ...over,
});

describe("the selection summary names the customer's choice with one word", () => {
  test("the word is the customer web's and the server's: option", () => {
    expect(SELECTION_WORD).toBe("Option");
    const customerBook = readFileSync(join(import.meta.dir, "..", "..", "web", "src", "app", "book", "BookPageClient.tsx"), "utf8");
    expect(customerBook).toContain('label="Option"');
    const catalog = readFileSync(join(import.meta.dir, "..", "..", "backend", "src", "lib", "service-catalog-config.ts"), "utf8");
    expect(catalog).toContain("Choose an option to continue");
  });

  test("no partner-facing copy calls it a variant", () => {
    const src = join(import.meta.dir, "..", "src");
    for (const rel of ["components/requests/JobBrief.tsx", "lib/job-selection.ts"]) {
      const text = readFileSync(join(src, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      // Strings shown to the partner: quoted text; `job.variant` (the field name) is allowed.
      expect(text.replace(/\.variant\b/g, ".field")).not.toMatch(/["'`>][^"'`<]*\bvariants?\b[^"'`<]*["'`<]/i);
    }
  });
});

describe("jobSelectionRows — only what the payload carries", () => {
  test("service, option, quantity with its unit, add-ons with counts, and the slot", () => {
    const rows = jobSelectionRows(
      booking({
        job: job({
          variant: "2 BHK",
          quantity: 3,
          unit: "rooms",
          addons: [
            { name: "Fridge", quantity: 1 },
            { name: "Balcony", quantity: 2 },
          ],
        }),
      }),
    );
    expect(rows).toEqual([
      { key: "service", label: "Service", value: "Deep Cleaning" },
      { key: "option", label: "Option", value: "2 BHK" },
      { key: "quantity", label: "Quantity", value: "3 rooms" },
      { key: "addons", label: "Add-ons", value: "Fridge · Balcony × 2" },
      { key: "slot", label: "Slot", value: expect.stringMatching(/^\d{2} Oct 2026 · .*\d/) },
    ]);
  });

  test("a quantity of one with no unit is not a row; an audience is", () => {
    const rows = jobSelectionRows(booking({ job: job({ quantity: 1, unit: null, audience: "Women" }) }));
    expect(rows.map((r) => r.key)).toEqual(["service", "option", "audience", "slot"]);
    expect(rows.find((r) => r.key === "audience")).toEqual({ key: "audience", label: "For", value: "Women" });
  });

  test("a bare quantity above one is shown as a count", () => {
    const rows = jobSelectionRows(booking({ job: job({ quantity: 2, unit: null }) }));
    expect(rows.find((r) => r.key === "quantity")).toEqual({ key: "quantity", label: "Quantity", value: "× 2" });
  });

  test("no option, no add-ons, no job brief at all: the rows that exist, nothing invented", () => {
    expect(jobSelectionRows(booking({ job: job({ variant: null }) })).map((r) => r.key)).toEqual(["service", "slot"]);
    expect(jobSelectionRows(booking({ job: undefined })).map((r) => r.key)).toEqual(["service", "slot"]);
  });

  test("the slot is the booked start with the server's expected duration, when it has one", () => {
    const withDuration = jobSelectionRows(booking()).find((r) => r.key === "slot")!.value;
    expect(withDuration).toMatch(/· 2 hr$/);
    const without = jobSelectionRows(booking({ job: job({ durationMinutes: null }) })).find((r) => r.key === "slot")!.value;
    expect(without).not.toMatch(/hr|min/);
  });

  test("a booking with no scheduled date has no slot row", () => {
    expect(jobSelectionRows(booking({ scheduledDate: "" })).map((r) => r.key)).toEqual(["service", "option"]);
  });
});
