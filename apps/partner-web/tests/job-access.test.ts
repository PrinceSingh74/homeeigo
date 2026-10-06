import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jobAccessDetails, offerBringList } from "../src/lib/job-access";
import type { PartnerRequirement, PartnerRequirementsBrief } from "../src/types/partner";

/**
 * The job page printed only `fullAddress`, 2026-10-06: the customer's note, the flat and building, the
 * landmark and the access instructions were in the payload and nowhere on the screen — the partner
 * reached the right street and then had to call. Only what the payload carries is shown; the server
 * sends these non-null only while the partner holds the job.
 */
const root = join(import.meta.dir, "..", "src");
const page = readFileSync(join(root, "app", "(partner)", "requests", "[id]", "page.tsx"), "utf8");
const api = readFileSync(join(root, "services", "partner-api.ts"), "utf8");

describe("the labelled access details of a job", () => {
  test("every field the payload carries, labelled, in reading order", () => {
    const rows = jobAccessDetails({
      description: "Ring twice, baby sleeping",
      address: { flatNumber: "4B", buildingName: "Lake View", landmark: "Opp. SBI ATM", specialInstructions: "Gate code 1234" },
    });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Customer's note", "Ring twice, baby sleeping"],
      ["Flat / unit", "4B"],
      ["Building", "Lake View"],
      ["Landmark", "Opp. SBI ATM"],
      ["Access instructions", "Gate code 1234"],
    ]);
  });

  test("null, missing and blank fields produce no row — nothing is invented", () => {
    expect(jobAccessDetails({ description: null, address: { flatNumber: null, buildingName: "  ", landmark: undefined } })).toEqual([]);
    expect(jobAccessDetails({ description: "  ", address: null })).toEqual([]);
    expect(jobAccessDetails({})).toEqual([]);
  });

  test("values are trimmed, not rewritten", () => {
    expect(jobAccessDetails({ description: "  Side gate  " })).toEqual([{ key: "note", label: "Customer's note", value: "Side gate" }]);
  });
});

describe("the job page and its mapper", () => {
  test("the page renders the rows in the job summary", () => {
    expect(page).toContain("jobAccessDetails(booking)");
    expect(page).toContain('data-testid="job-access-details"');
  });

  test("the mapper carries the note explicitly", () => {
    expect(api).toContain("description: b.description ?? null");
  });
});

describe("what to bring, on an offer", () => {
  const item = (label: string, extra: Partial<PartnerRequirement> = {}): PartnerRequirement => ({
    label, quantity: null, instructions: null, handling: null, customerWasTold: null, optional: false, chargeable: false, ...extra,
  });
  const brief = (over: Partial<PartnerRequirementsBrief>): PartnerRequirementsBrief => ({
    bringMaterials: [], bringEquipment: [], customerProvides: [], preconditions: [], empty: false, ...over,
  });

  test("materials and equipment by name, with the quantity the snapshot recorded", () => {
    expect(offerBringList(brief({ bringMaterials: [item("Descaler", { quantity: "500 ml" }), item("Cloths")], bringEquipment: [item("Ladder", { optional: true })] }))).toEqual({
      materials: ["Descaler (500 ml)", "Cloths"],
      equipment: ["Ladder (optional)"],
    });
  });

  test("no snapshot, or an empty one, lists nothing", () => {
    expect(offerBringList(null)).toBeNull();
    expect(offerBringList(undefined)).toBeNull();
    expect(offerBringList(brief({ empty: true }))).toBeNull();
    expect(offerBringList(brief({ customerProvides: [item("Water")] }))).toBeNull();
  });
});
