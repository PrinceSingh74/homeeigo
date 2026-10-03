/**
 * Phase 06 FINAL content — the content engine is load-bearing. The final content passes with zero
 * errors, and every named rule fires on a bad input (defect reintroduction R1–R15 rely on these).
 */
import { describe, expect, test } from "bun:test";
import { CATALOGUE, CONTENT, CONTENT_VERSION, type ContentAssignment, type ServiceContent } from "../../scripts/data/phase-06-requirement-content-final";
import { validateContent } from "../../scripts/lib/requirement-content-validator";
import { canonicalAssignments, contentHash, planService } from "../../scripts/lib/requirement-content-apply-plan";
import { blockingRequirementCodes, buildRequirementsSnapshot, customerRequirementsView, partnerRequirementsFromSnapshot, resolveServiceRequirements } from "../lib/service-requirements";

/** The live customer-visible universe on 2026-09-22 (data_origin IS NULL). Pinned so a silent omission fails. */
const LIVE_31 = [
  "ac-service", "after-party-express-clean", "balcony-cleaning", "bathroom-cleaning", "car-surface-cleaning", "carpet-shampooing", "deep-cleaning", "dusting-wiping",
  "electrician", "fan-cleaning", "fasade-cleaning", "fridge-cleaning", "home-painting", "hourly-bookings", "ironing-folding", "kitchen-cabinet-cleaning", "kitchen-cleaning",
  "kitchen-prep", "laundry", "mattress-sanitization", "packing-unpacking", "pest-control", "plant-care", "plumbing", "pre-party-express-clean", "salon-at-home",
  "sofa-deep-cleaning", "sweeping-mopping", "utensil-washing", "wardrobe-cleaning", "window-cleaning",
];
const run = (content: Record<string, ServiceContent>, catalogue = CATALOGUE) => validateContent({ version: CONTENT_VERSION, catalogue, content, liveServices: LIVE_31 });
const rules = (r: ReturnType<typeof run>) => r.findings.filter((f) => f.severity === "ERROR").map((f) => f.rule);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const mutate = (slug: string, id: string, patch: (a: ContentAssignment) => void) => {
  const c = clone(CONTENT);
  const a = c[slug]!.assignments.find((x) => x.id === id)!;
  patch(a);
  return c;
};

describe("final content passes the engine", () => {
  test("31/31 live services covered, 0 errors, 0 warnings, one blocking confirmation", () => {
    const r = run(CONTENT);
    expect(r.errors).toBe(0);
    expect(r.warnings).toBe(0);
    expect(r.readiness.length).toBe(31);
    expect(r.readiness.filter((x) => x.status === "INVALID")).toEqual([]);
    expect(r.readiness.filter((x) => x.blocking.length).map((x) => x.service)).toEqual(["pest-control"]);
    // The only NOT_CONFIGURED kind in the whole catalogue is facade equipment, declared (with a reason) under its SAFETY_HOLD.
    const notConfigured = r.readiness.flatMap((x) => (["materials", "equipment", "preconditions"] as const).filter((k) => x[k] === "NOT_CONFIGURED").map((k) => `${x.service}:${k}`));
    expect(notConfigured).toEqual(["fasade-cleaning:equipment"]);
    expect(CONTENT["fasade-cleaning"]!.status).toBe("SAFETY_HOLD");
    expect(CONTENT["fasade-cleaning"]!.unconfigured?.EQUIPMENT).toBeTruthy();
  });
  test("nothing asserts a quantity, a chargeable price path or a condition on option-less services", () => {
    const all = Object.values(CONTENT).flatMap((s) => s.assignments);
    expect(all.some((a) => a.quantity != null)).toBe(false);
    expect(all.some((a) => a.charge === "CHARGEABLE")).toBe(false);
    expect(all.some((a) => a.when?.addonIds?.length || a.when?.variantIds?.length)).toBe(false);
  });
  test("holds are explicit: every SEPARATE_QUOTE item lives on a COMMERCIAL_HOLD service; SAFETY_HOLD content only on a SAFETY_HOLD service", () => {
    for (const [slug, s] of Object.entries(CONTENT)) {
      if (s.assignments.some((a) => a.charge === "SEPARATE_QUOTE")) expect(s.status, slug).toBe("COMMERCIAL_HOLD");
      if (s.assignments.some((a) => a.meta.provenance === "SAFETY_HOLD")) expect(s.status, slug).toBe("SAFETY_HOLD");
    }
  });
  test("content hash is stable and order-independent", () => {
    const h1 = contentHash({ version: CONTENT_VERSION, catalogue: CATALOGUE, content: CONTENT });
    const reordered = Object.fromEntries(Object.entries(CONTENT).reverse().map(([k, v]) => [k, { ...v, assignments: [...v.assignments].reverse() }]));
    expect(contentHash({ version: CONTENT_VERSION, catalogue: [...CATALOGUE].reverse(), content: reordered })).toBe(h1);
    const changed = mutate("plumbing", "running-water-access", (a) => { a.customerNote = "changed"; });
    expect(contentHash({ version: CONTENT_VERSION, catalogue: CATALOGUE, content: changed })).not.toBe(h1);
  });
});

describe("projections of the final content (the same functions the booking uses)", () => {
  const items = Object.fromEntries(CATALOGUE.map((i) => [i.code, { code: i.code, kind: i.kind, name: i.name, customerLabel: i.customerLabel, description: i.description, isActive: true }]));
  const project = (slug: string) => {
    const reqs = CONTENT[slug]!.assignments.map(({ meta: _m, ...a }) => a);
    const cfg = { requirements: reqs, requirementItems: items, variants: [], addons: [] } as never;
    const r = resolveServiceRequirements(cfg, { variantId: null, addonIds: [], quantity: 1 });
    if (!r.ok) throw new Error(`${slug}: ${r.error}`);
    const snap = buildRequirementsSnapshot(r.items, 1, blockingRequirementCodes(r.items));
    return { reqs, view: customerRequirementsView(r.items), brief: partnerRequirementsFromSnapshot({ requirements: snap })!, snap };
  };
  test("R4: every item the professional brings is in the partner brief; every customer item reaches the partner as 'customer provides' or a precondition", () => {
    for (const slug of Object.keys(CONTENT)) {
      const { reqs, brief } = project(slug);
      const bring = new Set([...brief.bringMaterials, ...brief.bringEquipment].map((x) => x.label));
      const customer = new Set([...brief.customerProvides, ...brief.preconditions].map((x) => x.label));
      for (const a of reqs) {
        const name = items[a.itemCode]!.name;
        if (a.responsibility === "PROFESSIONAL") expect(bring.has(name), `${slug}: professional brings ${name}`).toBe(true);
        if (a.responsibility === "CUSTOMER") expect(customer.has(name), `${slug}: customer item ${name}`).toBe(true);
      }
    }
  });
  test("customer view and partner brief carry no provenance, enum or partner-only text; the snapshot drops internal notes", () => {
    const forbidden = /OWNER_APPROVED|SYSTEM_INFERRED|EXISTING_AUTHORITATIVE|SAFETY_HOLD|COMMERCIAL_HOLD|Assumption A\d|Not asserted|REQUIRED_BEFORE|PARTNER_CHECK|CUSTOMER_ATTESTATION|undefined/;
    for (const slug of Object.keys(CONTENT)) {
      const { reqs, view, brief, snap } = project(slug);
      const customerText = JSON.stringify(view);
      expect(forbidden.test(customerText), `${slug} customer`).toBe(false);
      expect(forbidden.test(JSON.stringify(brief)), `${slug} partner`).toBe(false);
      expect(JSON.stringify(snap).includes("internalNote"), `${slug} snapshot`).toBe(false);
      for (const a of reqs) if (a.partnerInstructions) expect(customerText.includes(a.partnerInstructions), `${slug}: partner instruction leaked`).toBe(false);
      expect(view.empty, `${slug} has an empty customer view`).toBe(false);
    }
  });
  test("exactly the pest-control preparation blocks a booking; it reaches the partner as confirmed by the customer", () => {
    const blocking = Object.keys(CONTENT).filter((s) => project(s).view.beforeBooking.length);
    expect(blocking).toEqual(["pest-control"]);
    expect(project("pest-control").brief.preconditions.find((x) => x.label === "Home prepared for pest treatment")?.check).toBe("CONFIRMED_BY_CUSTOMER");
  });
});

describe("every rule fires on a bad input", () => {
  test("R1 responsibility inversion: a precondition given to the professional", () => {
    expect(rules(run(mutate("deep-cleaning", "running-water-access", (a) => { a.responsibility = "PROFESSIONAL"; a.charge = "INCLUDED"; })))).toContain("PRECONDITION_NOT_CUSTOMER");
  });
  test("R2 chargeability inversion: customer-provided item marked INCLUDED is refused by the schema; professional item with no charge semantics is refused by the engine", () => {
    expect(rules(run(mutate("kitchen-prep", "ingredients-and-menu", (a) => { a.charge = "INCLUDED"; })))).toContain("SCHEMA");
    expect(rules(run(mutate("deep-cleaning", "vacuum-cleaner", (a) => { a.charge = "NOT_APPLICABLE"; })))).toContain("PROFESSIONAL_ITEM_WITHOUT_CHARGE_SEMANTICS");
  });
  test("R3 hidden customer requirement: partner copy imposes a duty the customer is never told", () => {
    expect(rules(run(mutate("plumbing", "water-shutoff-access", (a) => { a.customerNote = undefined; a.partnerInstructions = "Customer must have the valve exposed."; })))).toContain("HIDDEN_CUSTOMER_OBLIGATION");
  });
  test("R5 copy/data mismatch in both directions and money in a separately quoted line", () => {
    expect(rules(run(mutate("sweeping-mopping", "household-cleaning-tools", (a) => { a.customerNote = "We bring the mop."; })))).toContain("COPY_SAYS_WE_BRING_BUT_CUSTOMER_PROVIDES");
    expect(rules(run(mutate("deep-cleaning", "vacuum-cleaner", (a) => { a.customerNote = "Please keep your vacuum ready."; })))).toContain("COPY_SAYS_YOU_PROVIDE_BUT_PROFESSIONAL_PROVIDES");
    expect(rules(run(mutate("ac-service", "ac-refrigerant-gas", (a) => { a.customerNote = "Gas refill ₹1500, confirmed with you first."; })))).toContain("SEPARATE_QUOTE_COPY_STATES_MONEY");
    expect(rules(run(mutate("deep-cleaning", "vacuum-cleaner", (a) => { a.customerNote = "Extra charge applies."; })))).toContain("INCLUDED_COPY_MENTIONS_CHARGE");
  });
  test("R7 duplicate requirement: the same item twice in one service", () => {
    const c = clone(CONTENT);
    c["deep-cleaning"]!.assignments.push({ ...c["deep-cleaning"]!.assignments[0]!, id: "again" });
    expect(rules(run(c))).toContain("DUPLICATE_ITEM_IN_SERVICE");
  });
  test("R8 conflicting assignment: same item, different responsibility, both applicable", () => {
    const c = clone(CONTENT);
    const first = c["deep-cleaning"]!.assignments[0]!;
    c["deep-cleaning"]!.assignments.push({ ...first, id: "conflict", responsibility: "CUSTOMER", charge: "NOT_APPLICABLE", customerNote: "Bring your own." });
    expect(rules(run(c))).toContain("GATE_REQUIREMENT_CONFLICT");
  });
  test("R11 unsafe customer requirement hidden: a SAFETY precondition merely advised, or with no customer copy", () => {
    expect(rules(run(mutate("electrician", "switchboard-access", (a) => { a.enforcement = "WARNING"; a.verification = "NONE"; })))).toContain("SAFETY_PRECONDITION_NOT_VERIFIED");
    expect(rules(run(mutate("electrician", "switchboard-access", (a) => { a.customerNote = undefined; })))).toContain("SAFETY_PRECONDITION_HIDDEN");
  });
  test("R12 commercial path missing but chargeable: CHARGEABLE without an add-on is refused by schema and engine; SEPARATE_QUOTE on a READY service is refused", () => {
    expect(rules(run(mutate("deep-cleaning", "vacuum-cleaner", (a) => { a.charge = "CHARGEABLE"; })))).toEqual(expect.arrayContaining(["SCHEMA"]));
    const c = clone(CONTENT); c["ac-service"]!.status = "READY";
    expect(rules(run(c))).toContain("SEPARATE_QUOTE_WITHOUT_COMMERCIAL_HOLD");
  });
  test("R15 field leakage: enum or provenance token in customer or partner copy", () => {
    expect(rules(run(mutate("deep-cleaning", "running-water-access", (a) => { a.customerNote = "Enforcement REQUIRED_BEFORE_ARRIVAL."; })))).toContain("LEAK_ENUM_OR_INTERNAL_IN_COPY");
    expect(rules(run(mutate("deep-cleaning", "running-water-access", (a) => { a.partnerInstructions = "See internalNote for provenance OWNER_APPROVED."; })))).toContain("LEAK_ENUM_OR_INTERNAL_IN_COPY");
  });
  test("universe: a live service with no content entry is an error, not a silent gap", () => {
    const c = clone(CONTENT); delete c["plumbing"];
    expect(rules(run(c))).toContain("SERVICE_NOT_COVERED");
  });
  test("a kind that is neither configured nor explicitly declared 'no special requirement' is an error", () => {
    const c = clone(CONTENT); delete c["ironing-folding"]!.noSpecial;
    expect(rules(run(c))).toContain("KIND_NOT_DECIDED");
  });
  test("duplicate catalogue concepts are caught", () => {
    expect(rules(run(CONTENT, [...CATALOGUE, { code: "cleaning-solution-2", kind: "MATERIAL", name: "Professional cleaning solution", customerLabel: "Cleaning products", description: "dup" }]))).toContain("CATALOGUE_SEMANTIC_DUPLICATE");
  });
  test("provenance must be present and carried in the internal note; inference needs an assumption id", () => {
    expect(rules(run(mutate("deep-cleaning", "vacuum-cleaner", (a) => { a.internalNote = "no tag"; })))).toContain("PROVENANCE_NOT_IN_INTERNAL_NOTE");
    // an inference must cite its assumption; a promotion must name the assumption it resolved
    expect(rules(run(mutate("dusting-wiping", "household-cleaning-tools", (a) => { a.meta.provenance = "SYSTEM_INFERRED"; a.meta.promotion = undefined; a.meta.assumption = undefined; })))).toContain("INFERENCE_WITHOUT_ASSUMPTION");
    expect(rules(run(mutate("dusting-wiping", "household-cleaning-tools", (a) => { a.meta.assumption = undefined; })))).toContain("PROMOTION_WITHOUT_ASSUMPTION");
  });
});

describe("safety holds are structural, not labels (S1–S4)", () => {
  test("S1 safety-hold bypass: facade forced to READY is refused", () => {
    const c = clone(CONTENT); c["fasade-cleaning"]!.status = "READY";
    expect(rules(run(c))).toEqual(expect.arrayContaining(["STATUS_SAFETY_HOLD_EXPECTED"]));
  });
  test("S1b declaring a kind unconfigured outside a safety hold is refused", () => {
    const c = clone(CONTENT); c["deep-cleaning"]!.unconfigured = { EQUIPMENT: "no reason" };
    expect(rules(run(c))).toEqual(expect.arrayContaining(["UNCONFIGURED_OUTSIDE_SAFETY_HOLD"]));
  });
  test("S2 unsupported equipment claim: an inspection/safety-dependent item shown as brought and included is refused", () => {
    const c = clone(CONTENT);
    c["fasade-cleaning"]!.assignments.push({ id: "access-kit", itemCode: "step-ladder", responsibility: "PROFESSIONAL", charge: "INCLUDED", optional: false, enforcement: "INFORMATIONAL", verification: "NONE", active: true, internalNote: "[SAFETY_HOLD x] Why: test", meta: { provenance: "SAFETY_HOLD", itemClass: "INSPECTION_DEPENDENT", why: "test" } } as ContentAssignment);
    expect(rules(run(c))).toEqual(expect.arrayContaining(["UNSUPPORTED_EQUIPMENT_PROMISE"]));
  });
  test("S3 unsafe method claim: customer or partner copy naming an undefined method/certification is refused", () => {
    expect(rules(run(mutate("fasade-cleaning", "safe-access-assessed-on-site", (a) => { a.customerNote = "We use rope access and a certified harness; areas not reached safely are not covered."; })))).toContain("METHOD_CLAIM_UNSUPPORTED");
    expect(rules(run(mutate("fasade-cleaning", "safe-access-assessed-on-site", (a) => { a.partnerInstructions = "Set up the scaffolding before starting."; })))).toContain("METHOD_CLAIM_UNSUPPORTED");
  });
  test("S4 customer safety copy mismatch: an assessment-dependent precondition that stops saying so is refused", () => {
    expect(rules(run(mutate("fasade-cleaning", "safe-access-assessed-on-site", (a) => { a.customerNote = "We clean the whole facade."; })))).toContain("SAFETY_COPY_MUST_STATE_ASSESSMENT");
    expect(rules(run(mutate("window-cleaning", "windows-reachable-from-inside", (a) => { a.customerNote = "Every window, inside and out."; })))).toContain("SAFETY_COPY_MUST_STATE_ASSESSMENT");
  });
  test("customer copy that repeats the item label is refused (the customer would read one sentence twice)", () => {
    expect(rules(run(mutate("packing-unpacking", "packing-material", (a) => { a.customerNote = "Boxes, bubble wrap and tape are yours to provide."; })))).toContain("COPY_DUPLICATES_LABEL");
  });
  test("the live facade customer view promises no equipment at all", () => {
    const items = Object.fromEntries(CATALOGUE.map((i) => [i.code, { code: i.code, kind: i.kind, name: i.name, customerLabel: i.customerLabel, description: i.description, isActive: true }]));
    const reqs = CONTENT["fasade-cleaning"]!.assignments.map(({ meta: _m, ...a }) => a);
    const r = resolveServiceRequirements({ requirements: reqs, requirementItems: items, variants: [], addons: [] } as never, { variantId: null, addonIds: [], quantity: 1 });
    if (!r.ok) throw new Error("resolve");
    const v = customerRequirementsView(r.items);
    expect(r.items.filter((x) => x.kind === "EQUIPMENT")).toEqual([]);
    expect(JSON.stringify(v)).not.toMatch(/access equipment|scaffold|harness|rope access/i);
    expect(v.beforeArrival.some((x) => /not covered/.test(x.note ?? ""))).toBe(true);
  });
});

describe("A1–A3 provenance (promoted under the owner's Phase 06 authorization)", () => {
  const assumptionLines = Object.entries(CONTENT).flatMap(([slug, s]) => s.assignments.filter((a) => a.meta.assumption).map((a) => ({ slug, a })));
  test("exactly the 8 assumption lines are OWNER_APPROVED with the promotion reason in meta and in the audit note; ids kept", () => {
    expect(assumptionLines.map(({ slug, a }) => `${slug}/${a.id}:${a.meta.assumption}`).sort()).toEqual([
      "dusting-wiping/household-cleaning-supplies:A1", "dusting-wiping/household-cleaning-tools:A1", "hourly-bookings/household-cleaning-supplies:A1",
      "packing-unpacking/packing-material:A3", "plant-care/pot-and-potting-mix:A2", "sweeping-mopping/household-cleaning-supplies:A1",
      "sweeping-mopping/household-cleaning-tools:A1", "utensil-washing/dishwashing-supplies:A1",
    ]);
    for (const { a } of assumptionLines) {
      expect(a.meta.provenance).toBe("OWNER_APPROVED");
      expect(a.internalNote).toContain("Promoted under owner's Phase 06 content authorization");
      expect(a.internalNote).toContain(`Assumption ${a.meta.assumption}`);
    }
    expect(Object.values(CONTENT).flatMap((s) => s.assignments).some((a) => a.meta.provenance === "SYSTEM_INFERRED")).toBe(false);
  });
  test("A1/A2/A3 provenance overwrite: an assumption line relabelled as another provenance is refused", () => {
    for (const [slug, id] of [["dusting-wiping", "household-cleaning-supplies"], ["plant-care", "pot-and-potting-mix"], ["packing-unpacking", "packing-material"]] as const) {
      expect(rules(run(mutate(slug, id, (a) => { a.meta.provenance = "EXISTING_AUTHORITATIVE"; })))).toContain("ASSUMPTION_PROVENANCE_OVERWRITTEN");
    }
  });
  test("a promotion whose audit trace is stripped is refused", () => {
    expect(rules(run(mutate("utensil-washing", "dishwashing-supplies", (a) => { a.meta.promotion = undefined; })))).toContain("PROMOTION_WITHOUT_TRACE");
    expect(rules(run(mutate("utensil-washing", "dishwashing-supplies", (a) => { a.internalNote = "[OWNER_APPROVED x] Why: y"; })))).toContain("PROMOTION_WITHOUT_TRACE");
  });
});

describe("apply planning (R13 owner edits, R14 version discipline)", () => {
  test("supersede: stored rows equal to the frozen previous artifact are replaced; anything else is still an owner edit", async () => {
    const v1 = JSON.parse(await Bun.file(new URL("../../scripts/data/phase-06-requirement-content-final.v1.json", import.meta.url)).text()) as { contentHash: string; services: Record<string, unknown[]> };
    expect(v1.contentHash).toBe("c19f8ab1ab12b5070465c7edcda4b20f9d6bc95b1b1b4d0acb0c61b305250b06");
    const target = CONTENT["plant-care"]!.assignments.map(({ meta: _m, ...a }) => a);
    expect(planService({ current: v1.services["plant-care"]!, target, overwrite: false, previous: v1.services["plant-care"] }).action).toBe("SUPERSEDE");
    const edited = clone(v1.services["plant-care"]!) as Array<Record<string, unknown>>; edited[0]!.customerNote = "Owner edit.";
    expect(planService({ current: edited, target, overwrite: false, previous: v1.services["plant-care"] }).action).toBe("REFUSED_OWNER_EDIT");
    // unchanged services are identical to v1 — no version churn
    const unchanged = Object.keys(CONTENT).filter((k) => canonicalAssignments(CONTENT[k]!.assignments.map(({ meta: _m, ...a }) => a)) === canonicalAssignments(v1.services[k]!));
    expect(unchanged.length).toBe(24);
  });
  const target = CONTENT["plumbing"]!.assignments.map(({ meta: _m, ...a }) => a);
  test("identical stored content is skipped (no version bump), regardless of order", () => {
    expect(planService({ current: [...target].reverse(), target, overwrite: false }).action).toBe("SKIP_IDENTICAL");
  });
  test("an empty service is applied", () => {
    expect(planService({ current: [], target, overwrite: false }).action).toBe("APPLY");
  });
  test("a service the owner edited is refused unless overwrite is explicit", () => {
    const edited = clone(target); edited[0]!.customerNote = "Owner edited this.";
    expect(planService({ current: edited, target, overwrite: false }).action).toBe("REFUSED_OWNER_EDIT");
    expect(planService({ current: edited, target, overwrite: true }).action).toBe("APPLY");
  });
  test("canonical form applies schema defaults so an explicit default equals an omitted one", () => {
    const a = clone(target[0]!) as Record<string, unknown>; delete a.active; delete a.optional;
    expect(canonicalAssignments([a])).toBe(canonicalAssignments([target[0]!]));
  });
});
