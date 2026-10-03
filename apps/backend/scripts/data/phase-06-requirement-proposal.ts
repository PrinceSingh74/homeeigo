/**
 * Phase 06 — requirement content PROPOSAL for the 31 live services (2026-09-22).
 *
 * Status: OWNER REVIEW PENDING. Drafted from each service's own description and the legacy category
 * guidance the web app used to show; nothing here is a measured fact about the business. It is applied
 * by `scripts/apply-requirement-proposal.ts` (audited admin path, versioned, idempotent), and every
 * assignment carries a PROVENANCE internal note so an admin can tell a proposal from an owner decision.
 *
 * Deliberately NOT in this file (OWNER INPUT REQUIRED — the model would be inventing them):
 *   - quantities, units, product brands, chemical or safety data sheets, supplier / procurement party
 *   - anything CHARGEABLE (no live service has add-ons yet, so nothing can price a chargeable item)
 *   - fasade-cleaning equipment (work at height — a safety specification, not a guess)
 *
 * Content rules used:
 *   - "We bring" items: PROFESSIONAL · INCLUDED · INFORMATIONAL.
 *   - Things quoted after a site visit (paint, refrigerant gas, spare parts, potting mix): SEPARATE_QUOTE —
 *     the fixed base price plainly cannot include them; the customer is told "quoted separately".
 *   - Physical prerequisites (water, power, access): REQUIRED_BEFORE_ARRIVAL + PARTNER_CHECK.
 *   - Safety prerequisites the professional must confirm before starting: REQUIRED_AT_START + PARTNER_CHECK.
 *   - Booking-blocking confirmation (REQUIRED_BEFORE_BOOKING + CUSTOMER_ATTESTATION): pest-control only.
 *   - Good-to-do preparation: WARNING (shown, never enforced).
 */
import type { RequirementAssignment, RequirementKind } from "../../src/lib/service-requirements";

export const PROPOSAL_VERSION = "2026-09-22.1";
export const PROVENANCE = `PROPOSAL ${PROPOSAL_VERSION} — AI-drafted from the service description; owner review pending. Quantities, product specs, safety data and supplier: OWNER INPUT.`;

export type ProposalItem = { code: string; kind: RequirementKind; name: string; customerLabel?: string; description?: string };

/* ------------------------------------------------------------------ */
/* Shared catalogue                                                    */
/* ------------------------------------------------------------------ */
const M = (code: string, name: string, customerLabel?: string, description?: string): ProposalItem => ({ code, kind: "MATERIAL", name, customerLabel, description });
const E = (code: string, name: string, customerLabel?: string, description?: string): ProposalItem => ({ code, kind: "EQUIPMENT", name, customerLabel, description });
const P = (code: string, name: string, customerLabel?: string, description?: string): ProposalItem => ({ code, kind: "CUSTOMER_PRECONDITION", name, customerLabel, description });

export const CATALOGUE: ProposalItem[] = [
  // Materials — professional
  M("cleaning-solutions", "Professional cleaning solutions", "Cleaning products"),
  M("microfibre-cloths", "Microfibre cloths and dusters", "Cloths and dusters"),
  M("floor-disinfectant", "Floor cleaner and disinfectant", "Floor cleaner and disinfectant"),
  M("bathroom-descaler", "Bathroom descaler and sanitiser", "Descaler and sanitiser"),
  M("kitchen-degreaser", "Kitchen degreaser", "Degreaser"),
  M("glass-cleaner", "Glass cleaner", "Glass cleaner"),
  M("upholstery-shampoo", "Upholstery shampoo and fabric sanitiser", "Upholstery shampoo and sanitiser"),
  M("carpet-shampoo", "Carpet shampoo and stain treatment", "Carpet shampoo and stain treatment"),
  M("laundry-detergent", "Laundry detergent and fabric conditioner", "Detergent and conditioner"),
  M("garbage-bags", "Garbage bags", "Garbage bags"),
  M("car-care-products", "Car shampoo, polish and interior cleaner", "Car shampoo, polish and interior cleaner"),
  M("pest-treatment-products", "Pest treatment products (applied as per label)", "Treatment products"),
  M("paint-and-primer", "Paint, primer and putty", "Paint, primer and putty"),
  M("masking-and-drop-sheets", "Masking tape and drop sheets", "Masking tape and floor covers"),
  M("ac-coil-cleaner", "AC coil cleaning solution", "Coil cleaning solution"),
  M("ac-refrigerant-gas", "Refrigerant gas (if a refill is needed)", "Refrigerant gas, if needed"),
  M("spare-parts-and-fittings", "Spare parts and fittings (as needed)", "Spare parts, if needed"),
  M("potting-mix-and-fertiliser", "Potting mix and fertiliser (if repotting)", "Potting mix and fertiliser, if needed"),
  M("salon-products", "Salon products and single-use disposables", "Salon products and disposables"),
  M("hygiene-kit", "Gloves, masks and hygiene kit", "Gloves and hygiene kit"),
  M("fan-dust-covers", "Fan dust covers", "Dust covers"),
  M("packaging-for-return", "Packaging for the returned items", "Packaging for return delivery"),
  // Materials — customer
  M("ingredients-and-menu", "Ingredients and the menu / recipes", "Ingredients and your menu"),
  M("dishwashing-supplies", "Dishwashing liquid and scrubber", "Dishwashing liquid and scrubber"),
  M("packing-material", "Packing boxes, bubble wrap and tape", "Boxes, bubble wrap and tape"),
  M("task-specific-supplies", "Task-specific supplies", "Supplies for your specific task"),
  // Equipment — professional
  E("vacuum-cleaner", "Vacuum cleaner", "Vacuum cleaner"),
  E("mop-and-bucket", "Mop and bucket", "Mop and bucket"),
  E("step-ladder", "Step ladder", "Step ladder"),
  E("upholstery-cleaning-machine", "Upholstery cleaning machine", "Upholstery cleaning machine"),
  E("carpet-shampoo-machine", "Carpet shampooing machine", "Carpet shampooing machine"),
  E("uv-sanitising-unit", "UV sanitising unit", "UV sanitiser"),
  E("glass-cleaning-kit", "Squeegee and glass cleaning kit", "Glass cleaning kit"),
  E("car-cleaning-kit", "Car cleaning kit (foam, microfibre, vacuum)", "Car cleaning kit"),
  E("pest-sprayer", "Sprayer and application equipment", "Application equipment"),
  E("painting-tools", "Rollers, brushes and painting tools", "Painting tools"),
  E("ac-service-tools", "AC servicing tools (jet pump, gauges)", "AC servicing tools"),
  E("electrician-toolkit", "Electrician's toolkit and tester", "Electrician's toolkit"),
  E("plumbing-toolkit", "Plumber's toolkit", "Plumber's toolkit"),
  E("gardening-tools", "Pruning shears and gardening tools", "Gardening tools"),
  E("salon-kit", "Salon kit with sterilised tools", "Salon kit"),
  // Customer preconditions
  P("running-water-access", "Running water access", "Access to running water"),
  P("power-socket-access", "Working power socket near the work area", "A working power socket near the work area"),
  P("access-to-all-areas", "Access to every area included in the service", "Access to all the areas to be covered"),
  P("loose-items-put-away", "Loose, fragile and valuable items put away", "Put away loose, fragile and valuable items"),
  P("adult-present", "An adult available at home during the visit", "An adult available at home during the visit"),
  P("society-entry-arranged", "Visitor entry arranged with building security", "Arrange gate / society entry for our professional"),
  P("society-permission-external-work", "Society / building permission for external work", "Society permission for work on the building exterior"),
  P("vehicle-access-and-parking", "Vehicle parked where washing is permitted, with water nearby", "Park where washing is allowed, with water access nearby"),
  P("fridge-emptied-and-off", "Fridge emptied and switched off", "Empty the fridge and switch it off beforehand"),
  P("bed-linen-removed", "Bed linen removed from the mattress", "Remove sheets and covers from the mattress"),
  P("furniture-away-from-walls", "Furniture moved away from the walls", "Move furniture away from the walls to be painted"),
  P("paint-shade-confirmed", "Paint shade and finish confirmed", "Confirm the paint shade and finish"),
  P("room-ventilation", "Rooms can be ventilated", "Windows can be opened for ventilation"),
  P("drying-time-allowed", "Drying time after the service", "Allow drying time after the service"),
  P("pest-treatment-preparation", "Home prepared for pest treatment", "Food covered; people and pets away from treated areas as advised"),
  P("ac-units-accessible", "Clear access to the indoor and outdoor units", "Clear access to the indoor and outdoor AC units"),
  P("switchboard-access", "Access to the main switchboard / MCB", "Access to the main switchboard"),
  P("water-shutoff-access", "Access to the main water shut-off valve", "Access to the main water shut-off"),
  P("garments-sorted", "Clothes sorted, pockets emptied, special-care items pointed out", "Sort the clothes, empty pockets, point out delicate items"),
  P("wardrobe-valuables-removed", "Valuables, cash and documents removed from the wardrobe", "Remove valuables and documents from the wardrobe"),
  P("fragile-items-identified", "Fragile and high-value items identified", "Point out fragile and high-value items"),
  P("priorities-shared", "Priority rooms / tasks shared with the professional", "Tell us your priorities"),
  P("allergies-disclosed", "Allergies or skin sensitivities disclosed", "Tell us about allergies or skin sensitivities"),
  P("lit-space-with-chair", "Well-lit space with a chair and basin access", "A well-lit space with a chair and access to a basin"),
  P("window-access", "Window grills unlocked; curtains and blinds removed", "Unlock grills; remove curtains and blinds"),
  P("balcony-cleared", "Balcony floor cleared of plants and loose items", "Clear the balcony floor of plants and loose items"),
  P("items-below-fans-covered", "Delicate items below the fans moved or covered", "Move or cover delicate items below the fans"),
  P("leftovers-put-away", "Leftover food and valuables put away", "Put away leftover food and valuables"),
  P("plants-accessible", "Plants accessible; known issues shared", "Plants accessible; tell us about known issues"),
  P("task-agenda-ready", "Task list ready for the professional", "Have your task list ready"),
];

/* ------------------------------------------------------------------ */
/* Assignment builders                                                 */
/* ------------------------------------------------------------------ */
type A = Omit<RequirementAssignment, "charge" | "optional" | "enforcement" | "verification" | "active"> &
  Partial<Pick<RequirementAssignment, "charge" | "optional" | "enforcement" | "verification" | "active">>;
let order = 0;
const seq = () => ++order;
/** Professional brings it, included in the price. */
const bring = (itemCode: string, extra: Partial<A> = {}): A => ({ id: itemCode, itemCode, responsibility: "PROFESSIONAL", charge: "INCLUDED", enforcement: "INFORMATIONAL", sortOrder: seq(), internalNote: PROVENANCE, ...extra });
/** Professional supplies it, but it is quoted separately after assessment (never part of the fixed base price). */
const quoted = (itemCode: string, customerNote: string, extra: Partial<A> = {}): A => ({ id: itemCode, itemCode, responsibility: "PROFESSIONAL", charge: "SEPARATE_QUOTE", enforcement: "INFORMATIONAL", customerNote, sortOrder: seq(), internalNote: PROVENANCE + " Pricing of this item is a separate quote — confirm the quoting process with operations.", ...extra });
/** Customer provides a material. */
const provide = (itemCode: string, customerNote: string, extra: Partial<A> = {}): A => ({ id: itemCode, itemCode, responsibility: "CUSTOMER", charge: "NOT_APPLICABLE", enforcement: "REQUIRED_BEFORE_ARRIVAL", verification: "PARTNER_CHECK", customerNote, sortOrder: seq(), internalNote: PROVENANCE, ...extra });
/** Customer precondition. */
const pre = (itemCode: string, enforcement: RequirementAssignment["enforcement"], customerNote?: string, extra: Partial<A> = {}): A => ({
  id: itemCode,
  itemCode,
  responsibility: "CUSTOMER",
  charge: "NOT_APPLICABLE",
  enforcement,
  verification: enforcement === "REQUIRED_BEFORE_BOOKING" ? "CUSTOMER_ATTESTATION" : enforcement === "INFORMATIONAL" || enforcement === "WARNING" ? "NONE" : "PARTNER_CHECK",
  customerNote,
  sortOrder: seq(),
  internalNote: PROVENANCE,
  ...extra,
});

const WATER = () => pre("running-water-access", "REQUIRED_BEFORE_ARRIVAL", "Needed for cleaning and rinsing.");
const POWER = () => pre("power-socket-access", "REQUIRED_BEFORE_ARRIVAL", "Our equipment runs off a standard socket.");
const ENTRY = () => pre("society-entry-arranged", "WARNING", "Add our professional to the visitor list or inform the gate so they are not held up.");
const ADULT = () => pre("adult-present", "WARNING", "To let us in, answer questions and check the work.");
const LOOSE = () => pre("loose-items-put-away", "WARNING", "Anything small, fragile or valuable is safer put away before we start.");

/* ------------------------------------------------------------------ */
/* Per-service proposal (keyed by service slug)                        */
/* ------------------------------------------------------------------ */
function service(build: () => A[]): A[] {
  order = 0;
  return build();
}

export const PROPOSAL: Record<string, A[]> = {
  // ── Home cleaning ────────────────────────────────────────────────────────────
  "deep-cleaning": service(() => [
    bring("cleaning-solutions"), bring("floor-disinfectant"), bring("bathroom-descaler"), bring("kitchen-degreaser"), bring("microfibre-cloths"), bring("hygiene-kit"),
    bring("vacuum-cleaner"), bring("mop-and-bucket"), bring("step-ladder"),
    WATER(), POWER(),
    pre("access-to-all-areas", "REQUIRED_BEFORE_ARRIVAL", "Rooms that are locked or occupied cannot be cleaned."),
    LOOSE(), ENTRY(), ADULT(),
  ]),
  "bathroom-cleaning": service(() => [
    bring("bathroom-descaler"), bring("floor-disinfectant"), bring("microfibre-cloths"), bring("hygiene-kit"), bring("mop-and-bucket"),
    WATER(), pre("loose-items-put-away", "WARNING", "Please clear toiletries and personal items from the counters and shelves."), ENTRY(),
  ]),
  "kitchen-cleaning": service(() => [
    bring("kitchen-degreaser"), bring("cleaning-solutions"), bring("microfibre-cloths"), bring("hygiene-kit"), bring("mop-and-bucket"),
    WATER(), pre("loose-items-put-away", "WARNING", "Clear the counters of utensils and groceries so every surface can be degreased."), ENTRY(),
  ]),
  "kitchen-cabinet-cleaning": service(() => [
    bring("kitchen-degreaser"), bring("cleaning-solutions"), bring("microfibre-cloths"), bring("hygiene-kit"),
    WATER(),
    pre("fragile-items-identified", "WARNING", "We empty and re-layer the cabinets ourselves — point out glassware and anything fragile first."),
    ENTRY(),
  ]),
  "fridge-cleaning": service(() => [
    bring("cleaning-solutions"), bring("microfibre-cloths"), bring("hygiene-kit"),
    WATER(),
    pre("fridge-emptied-and-off", "REQUIRED_BEFORE_ARRIVAL", "Empty it and switch it off a few hours before the visit so the freezer defrosts and every shelf is reachable. We wipe up the defrost water.", { customerWarning: "Keep perishables in a cool bag while the fridge is off." }),
  ]),
  "fan-cleaning": service(() => [
    bring("fan-dust-covers"), bring("kitchen-degreaser"), bring("microfibre-cloths"), bring("step-ladder"),
    POWER(),
    pre("items-below-fans-covered", "WARNING", "We bring covers, but move anything delicate from directly below the fans."),
  ]),
  "sofa-deep-cleaning": service(() => [
    bring("upholstery-shampoo"), bring("upholstery-cleaning-machine"), bring("vacuum-cleaner"),
    WATER(), POWER(),
    pre("loose-items-put-away", "WARNING", "Clear cushions, throws and anything stored under or behind the sofa."),
    pre("drying-time-allowed", "INFORMATIONAL", "Plan to keep the sofa unused for a few hours afterwards while it dries."),
  ]),
  "carpet-shampooing": service(() => [
    bring("carpet-shampoo"), bring("carpet-shampoo-machine"), bring("vacuum-cleaner"),
    WATER(), POWER(),
    pre("loose-items-put-away", "WARNING", "Move light furniture and items off the carpet or rug."),
    pre("drying-time-allowed", "INFORMATIONAL", "Allow a few hours of drying time; keep the room ventilated."),
  ]),
  "mattress-sanitization": service(() => [
    bring("uv-sanitising-unit"), bring("vacuum-cleaner"), bring("upholstery-shampoo"),
    POWER(),
    pre("bed-linen-removed", "REQUIRED_BEFORE_ARRIVAL", "Strip the sheets, covers and mattress protector before we arrive."),
    pre("drying-time-allowed", "INFORMATIONAL", "Leave the mattress uncovered for a short while after the treatment."),
  ]),
  "wardrobe-cleaning": service(() => [
    bring("cleaning-solutions"), bring("microfibre-cloths"), bring("hygiene-kit"), bring("vacuum-cleaner"),
    pre("wardrobe-valuables-removed", "REQUIRED_BEFORE_ARRIVAL", "Remove cash, jewellery and documents before we declutter and re-organise."),
    pre("priorities-shared", "INFORMATIONAL", "Tell us how you would like things arranged, and what can be set aside for donation."),
    ADULT(),
  ]),
  "window-cleaning": service(() => [
    bring("glass-cleaner"), bring("glass-cleaning-kit"), bring("microfibre-cloths"), bring("step-ladder"),
    WATER(),
    pre("window-access", "WARNING", "Unlock the grills and take down curtains or blinds so the glass and tracks are reachable."),
  ]),
  "balcony-cleaning": service(() => [
    bring("cleaning-solutions"), bring("glass-cleaner"), bring("mop-and-bucket"), bring("microfibre-cloths"),
    WATER(),
    pre("balcony-cleared", "WARNING", "Move pots, furniture and loose items so the whole floor and railing can be cleaned."),
  ]),
  // ── Home help ────────────────────────────────────────────────────────────────
  "dusting-wiping": service(() => [
    bring("microfibre-cloths"), bring("cleaning-solutions"), bring("step-ladder"),
    pre("fragile-items-identified", "WARNING", "Point out delicate décor and anything that should not be moved."),
  ]),
  "sweeping-mopping": service(() => [
    bring("floor-disinfectant"), bring("mop-and-bucket"),
    WATER(), pre("loose-items-put-away", "WARNING", "Pick up cables, toys and small items from the floor."),
  ]),
  "utensil-washing": service(() => [
    bring("hygiene-kit"),
    provide("dishwashing-supplies", "We use the dishwashing liquid and scrubber in your kitchen."),
    WATER(),
  ]),
  "kitchen-prep": service(() => [
    bring("hygiene-kit"),
    provide("ingredients-and-menu", "Keep the ingredients out and tell us the menu or recipes to follow."),
    WATER(),
    pre("allergies-disclosed", "WARNING", "Tell us about any food allergies at home before we start."),
  ]),
  "packing-unpacking": service(() => [
    bring("hygiene-kit"),
    provide("packing-material", "Boxes, bubble wrap and tape are yours to provide — tell us in advance if you need us to arrange them.", { enforcement: "WARNING", verification: "NONE" }),
    pre("fragile-items-identified", "REQUIRED_AT_START", "Show us fragile and high-value items before packing starts so they are wrapped and labelled first."),
    pre("priorities-shared", "INFORMATIONAL", "Tell us which rooms to pack or unpack first."),
    ADULT(),
  ]),
  "hourly-bookings": service(() => [
    bring("cleaning-solutions"), bring("microfibre-cloths"), bring("hygiene-kit"),
    provide("task-specific-supplies", "We bring basic cleaning supplies; anything specific to your task (special products, tools) is yours to provide.", { optional: true, enforcement: "INFORMATIONAL", verification: "NONE" }),
    pre("task-agenda-ready", "INFORMATIONAL", "You set the agenda — a written list helps the professional make the most of the time."),
    ADULT(),
  ]),
  // ── Laundry & fabric ─────────────────────────────────────────────────────────
  laundry: service(() => [
    bring("laundry-detergent"), bring("packaging-for-return"),
    pre("garments-sorted", "WARNING", "Empty the pockets and point out delicate or special-care items; we follow the care labels."),
    ENTRY(),
  ]),
  "ironing-folding": service(() => [
    bring("packaging-for-return"),
    pre("garments-sorted", "WARNING", "Point out delicate fabrics and anything that needs special handling."),
    ENTRY(),
  ]),
  // ── Event & occasion ─────────────────────────────────────────────────────────
  "pre-party-express-clean": service(() => [
    bring("cleaning-solutions"), bring("floor-disinfectant"), bring("microfibre-cloths"), bring("mop-and-bucket"), bring("vacuum-cleaner"),
    WATER(), POWER(),
    pre("priorities-shared", "INFORMATIONAL", "Tell us the rooms your guests will use so they come first."),
    LOOSE(),
  ]),
  "after-party-express-clean": service(() => [
    bring("garbage-bags"), bring("cleaning-solutions"), bring("floor-disinfectant"), bring("microfibre-cloths"), bring("mop-and-bucket"), bring("hygiene-kit"),
    WATER(),
    pre("leftovers-put-away", "WARNING", "Put away leftover food you want to keep, and any valuables left out during the party."),
  ]),
  // ── Vehicle care ─────────────────────────────────────────────────────────────
  "car-surface-cleaning": service(() => [
    bring("car-care-products"), bring("car-cleaning-kit"), bring("vacuum-cleaner"),
    pre("vehicle-access-and-parking", "REQUIRED_BEFORE_ARRIVAL", "Park where washing is allowed by your building or society, with a water point and a socket nearby."),
    POWER(),
    pre("loose-items-put-away", "WARNING", "Remove valuables and personal items from the car before the interior vacuum."),
  ]),
  // ── Specialised care ─────────────────────────────────────────────────────────
  "pest-control": service(() => [
    bring("pest-treatment-products", { customerNote: "Applied as per the product label.", handlingNote: "Handle, store and apply strictly per the product label and the operations safety brief." }),
    bring("pest-sprayer"), bring("hygiene-kit"),
    pre("pest-treatment-preparation", "REQUIRED_BEFORE_BOOKING", "Cover food, utensils and pet bowls; keep people and pets away from treated areas during the treatment and for the time the professional advises afterwards.", {
      customerWarning: "Tell us in advance if anyone at home is pregnant, an infant, elderly, or has asthma, allergies or other respiratory conditions.",
      partnerInstructions: "Confirm the preparation on arrival; do not treat occupied rooms. Advise the customer of the re-entry time for the product used.",
    }),
    pre("access-to-all-areas", "REQUIRED_BEFORE_ARRIVAL", "Treatment covers the areas we can reach — unlock storerooms, lofts and cabinets under sinks."),
    ADULT(),
  ]),
  "plant-care": service(() => [
    bring("gardening-tools"), bring("hygiene-kit"),
    quoted("potting-mix-and-fertiliser", "Only if repotting or feeding is needed; the professional will tell you before using any."),
    WATER(),
    pre("plants-accessible", "INFORMATIONAL", "Bring hanging or high plants within reach if you can, and tell us about pests or yellowing you have noticed."),
  ]),
  "fasade-cleaning": service(() => [
    bring("cleaning-solutions"), bring("hygiene-kit"),
    pre("society-permission-external-work", "REQUIRED_BEFORE_ARRIVAL", "Work on the building exterior needs your society's or building manager's permission — please arrange it before the visit."),
    WATER(), POWER(),
    ADULT(),
    // Equipment (work at height): OWNER INPUT REQUIRED — a safety specification, not proposed here.
  ]),
  // ── Beauty ───────────────────────────────────────────────────────────────────
  "salon-at-home": service(() => [
    bring("salon-products"), bring("salon-kit"), bring("hygiene-kit"),
    pre("lit-space-with-chair", "REQUIRED_BEFORE_ARRIVAL", "A well-lit spot with a chair, a nearby socket and access to a wash basin."),
    pre("allergies-disclosed", "WARNING", "Tell us about allergies or skin sensitivities before any treatment."),
  ]),
  // ── Home maintenance ─────────────────────────────────────────────────────────
  "home-painting": service(() => [
    bring("masking-and-drop-sheets"), bring("painting-tools"), bring("step-ladder"),
    quoted("paint-and-primer", "Paint in the brand and shade of your choice is quoted after the site assessment; the base price covers the labour."),
    pre("paint-shade-confirmed", "REQUIRED_AT_START", "The professional confirms the shade and finish with you before the first coat."),
    pre("furniture-away-from-walls", "WARNING", "Move furniture away from the walls to be painted where possible; our team helps with light pieces."),
    pre("room-ventilation", "INFORMATIONAL", "Keep windows open while the paint dries."),
    WATER(), POWER(), ADULT(),
  ]),
  "ac-service": service(() => [
    bring("ac-service-tools"), bring("ac-coil-cleaner"), bring("hygiene-kit"),
    quoted("ac-refrigerant-gas", "Only if the pressure check shows a refill is needed; the professional confirms the cost with you first."),
    quoted("spare-parts-and-fittings", "Any part that needs replacing is confirmed with you before the work."),
    pre("ac-units-accessible", "REQUIRED_BEFORE_ARRIVAL", "Clear space below the indoor unit and a safe path to the outdoor unit."),
    POWER(), WATER(), ADULT(),
  ]),
  electrician: service(() => [
    bring("electrician-toolkit"), bring("hygiene-kit"),
    quoted("spare-parts-and-fittings", "Switches, wiring and fittings are confirmed with you before they are used."),
    pre("switchboard-access", "REQUIRED_AT_START", "The professional switches off the relevant circuit before working.", { partnerInstructions: "Isolate the circuit at the MCB and test before touching any wiring." }),
    ADULT(),
  ]),
  plumbing: service(() => [
    bring("plumbing-toolkit"), bring("hygiene-kit"),
    quoted("spare-parts-and-fittings", "Taps, pipes and fittings are confirmed with you before they are used."),
    pre("water-shutoff-access", "REQUIRED_AT_START", "The professional may need to shut off the water supply while working.", { partnerInstructions: "Locate the shut-off valve before opening any joint." }),
    WATER(), ADULT(),
  ]),
};

/** Services in the proposal that still need an owner decision before publishing them as-is. */
export const OWNER_DECISIONS: Array<{ service: string; decision: string }> = [
  { service: "home-painting", decision: "Paint is proposed as SEPARATE_QUOTE (base price = labour). Confirm, or state that paint is included." },
  { service: "ac-service", decision: "Refrigerant gas and spare parts proposed as SEPARATE_QUOTE. Confirm the quoting process." },
  { service: "electrician", decision: "Spare parts proposed as SEPARATE_QUOTE." },
  { service: "plumbing", decision: "Spare parts proposed as SEPARATE_QUOTE." },
  { service: "plant-care", decision: "Potting mix / fertiliser proposed as SEPARATE_QUOTE." },
  { service: "packing-unpacking", decision: "Packing material proposed as customer-provided. Confirm, or make it a chargeable add-on (needs a Phase 03 add-on first)." },
  { service: "utensil-washing", decision: "Dishwashing supplies proposed as customer-provided." },
  { service: "pest-control", decision: "The ONLY booking-blocking confirmation. Confirm the wording, and supply the product safety brief / re-entry times for the handling note." },
  { service: "fasade-cleaning", decision: "Equipment for work at height NOT proposed (safety specification). Supply it, or mark the kind as not applicable." },
  { service: "laundry", decision: "Care-label policy: the note says 'we follow the care labels' — confirm the liability wording for unlabelled items." },
  { service: "*", decision: "Quantities/units, product brands, safety data sheets and the supplier/procurement party are not proposed anywhere." },
];
