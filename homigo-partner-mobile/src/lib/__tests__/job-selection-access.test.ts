/**
 * The job brief: what was booked (service, option, quantity, audience, add-ons, slot) and what the
 * partner needs to reach the door (the customer's note and the address's access fields) — from the
 * partner projection of `GET /api/bookings/:id`. Only what the payload carries becomes a row.
 *
 * Ported from apps/partner-web/tests/job-selection.test.ts and job-access.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { jobSelectionRows, SELECTION_WORD } from "../job-selection.ts";
import { jobAccessDetails, offerBringList } from "../job-access.ts";
import type { PartnerJobBrief, PartnerRequirementLine, PartnerRequirementsBrief } from "../../types/partner.ts";

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

type Source = Parameters<typeof jobSelectionRows>[0];
const booking = (over: Partial<Source> = {}): Source => ({
  service: { name: "Deep Cleaning" },
  scheduledDate: "2026-10-09T04:30:00.000Z",
  job: job(),
  ...over,
});

test("the customer's choice is named with one word: Option", () => {
  assert.equal(SELECTION_WORD, "Option");
});

test("service, option, quantity with its unit, add-ons with counts, and the slot", () => {
  const rows = jobSelectionRows(
    booking({
      job: job({
        quantity: 3,
        unit: "rooms",
        addons: [
          { name: "Fridge", quantity: 1 },
          { name: "Balcony", quantity: 2 },
        ],
      }),
    }),
  );
  assert.deepEqual(rows.slice(0, 4), [
    { key: "service", label: "Service", value: "Deep Cleaning" },
    { key: "option", label: "Option", value: "2 BHK" },
    { key: "quantity", label: "Quantity", value: "3 rooms" },
    { key: "addons", label: "Add-ons", value: "Fridge · Balcony × 2" },
  ]);
  assert.equal(rows[4]!.key, "slot");
  assert.match(rows[4]!.value, /^\d{2} Oct 2026 · .*\d/);
});

test("a quantity of one with no unit is not a row; an audience is", () => {
  const rows = jobSelectionRows(booking({ job: job({ quantity: 1, unit: null, audience: "Women" }) }));
  assert.deepEqual(rows.map((r) => r.key), ["service", "option", "audience", "slot"]);
  assert.deepEqual(rows.find((r) => r.key === "audience"), { key: "audience", label: "For", value: "Women" });
});

test("a bare quantity above one is shown as a count", () => {
  const rows = jobSelectionRows(booking({ job: job({ quantity: 2, unit: null }) }));
  assert.deepEqual(rows.find((r) => r.key === "quantity"), { key: "quantity", label: "Quantity", value: "× 2" });
});

test("no option, no add-ons, no job brief at all: the rows that exist, nothing invented", () => {
  assert.deepEqual(jobSelectionRows(booking({ job: job({ variant: null }) })).map((r) => r.key), ["service", "slot"]);
  assert.deepEqual(jobSelectionRows(booking({ job: undefined })).map((r) => r.key), ["service", "slot"]);
  assert.deepEqual(jobSelectionRows(booking({ job: null, service: null })).map((r) => r.key), ["slot"]);
});

test("the slot is the booked start with the server's expected duration, when it has one", () => {
  const withDuration = jobSelectionRows(booking()).find((r) => r.key === "slot")!.value;
  assert.match(withDuration, /· 2 hr$/);
  const without = jobSelectionRows(booking({ job: job({ durationMinutes: null }) })).find((r) => r.key === "slot")!.value;
  assert.doesNotMatch(without, /hr|min/);
  assert.match(jobSelectionRows(booking({ job: job({ durationMinutes: 90 }) })).find((r) => r.key === "slot")!.value, /· 1 hr 30 min$/);
});

test("a booking with no scheduled date, or one that is not a date, has no slot row", () => {
  assert.deepEqual(jobSelectionRows(booking({ scheduledDate: "" })).map((r) => r.key), ["service", "option"]);
  assert.deepEqual(jobSelectionRows(booking({ scheduledDate: "not a date" })).map((r) => r.key), ["service", "option"]);
});

/* ---- access details ---- */

test("every access field the payload carries, labelled, in reading order", () => {
  const rows = jobAccessDetails({
    description: "Ring twice, baby sleeping",
    address: { flatNumber: "4B", buildingName: "Lake View", landmark: "Opp. SBI ATM", specialInstructions: "Gate code 1234" },
  });
  assert.deepEqual(rows.map((r) => [r.key, r.label, r.value]), [
    ["note", "Customer's note", "Ring twice, baby sleeping"],
    ["flat", "Flat / unit", "4B"],
    ["building", "Building", "Lake View"],
    ["landmark", "Landmark", "Opp. SBI ATM"],
    ["instructions", "Access instructions", "Gate code 1234"],
  ]);
});

test("null, missing and blank fields produce no row — nothing is invented", () => {
  assert.deepEqual(jobAccessDetails({ description: null, address: { flatNumber: null, buildingName: "  ", landmark: undefined } }), []);
  assert.deepEqual(jobAccessDetails({ description: "  ", address: null }), []);
  assert.deepEqual(jobAccessDetails({}), []);
});

test("values are trimmed, not rewritten", () => {
  assert.deepEqual(jobAccessDetails({ description: "  Side gate  " }), [{ key: "note", label: "Customer's note", value: "Side gate" }]);
});

/* ---- what to bring, on an offer ---- */

const item = (label: string, extra: Partial<PartnerRequirementLine> = {}): PartnerRequirementLine => ({
  label, quantity: null, instructions: null, handling: null, customerWasTold: null, optional: false, chargeable: false, ...extra,
});
const brief = (over: Partial<PartnerRequirementsBrief>): PartnerRequirementsBrief => ({
  bringMaterials: [], bringEquipment: [], customerProvides: [], preconditions: [], empty: false, ...over,
});

test("materials and equipment by name, with the quantity the snapshot recorded", () => {
  assert.deepEqual(
    offerBringList(brief({ bringMaterials: [item("Descaler", { quantity: "500 ml" }), item("Cloths")], bringEquipment: [item("Ladder", { optional: true })] })),
    { materials: ["Descaler (500 ml)", "Cloths"], equipment: ["Ladder (optional)"] },
  );
});

test("no snapshot, or an empty one, lists nothing", () => {
  assert.equal(offerBringList(null), null);
  assert.equal(offerBringList(undefined), null);
  assert.equal(offerBringList(brief({ empty: true })), null);
  assert.equal(offerBringList(brief({ customerProvides: [item("Water")] })), null);
});
