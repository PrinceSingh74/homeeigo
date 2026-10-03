/**
 * Phase 06 — FINAL requirement content for the 31 live customer services (2026-09-22).
 *
 * This file is the source of truth the renderer, validator, tests and apply script all read. The
 * proposal that preceded it (phase-06-requirement-proposal.ts) is kept untouched as history.
 *
 * Every assignment answers, in structured fields, not prose:
 *   what (itemCode) · who provides (responsibility) · who procures (procurement) · charge · optional
 *   · when needed / verified (enforcement + verification) · condition (when) · customer copy
 *   (customerNote / customerWarning) · partner copy (partnerInstructions / handlingNote)
 *   · provenance + why (meta → internalNote, admin-only).
 *
 * Provenance statuses (invisible to customers and partners):
 *   EXISTING_AUTHORITATIVE — stated by the service's own description / legacy guidance
 *   OWNER_APPROVED         — ordinary content finalised under the owner's 2026-09-22 authorisation
 *   SYSTEM_INFERRED        — a conservative model assumption, listed in ASSUMPTIONS for the owner
 *   INSPECTION_DEPENDENT   — need is confirmed by the professional on site
 *   SAFETY_HOLD            — no safe operational definition exists; nothing is asserted
 *   COMMERCIAL_HOLD        — truthful non-inclusion, but no in-app quote → approval → payment chain
 *
 * Never asserted anywhere in this file: quantities, brands, chemical specifications, certifications,
 * suppliers, regulatory claims, medical guidance, prices.
 */
import type { RequirementAssignment, RequirementKind } from "../../src/lib/service-requirements";

/** v2 (2026-09-22): facade no longer promises access equipment (S2); A1–A3 promoted to OWNER_APPROVED. v1 is frozen in phase-06-requirement-content-final.v1.json. */
export const CONTENT_VERSION = "2026-09-22.final.2";
/** The first applied content version; lines untouched since then keep this tag. */
export const FIRST_CONTENT_VERSION = "2026-09-22.final";

export type Provenance = "EXISTING_AUTHORITATIVE" | "OWNER_APPROVED" | "SYSTEM_INFERRED" | "INSPECTION_DEPENDENT" | "SAFETY_HOLD" | "COMMERCIAL_HOLD";
export type PreconditionClass = "ACCESS" | "UTILITY" | "SPACE" | "PARKING" | "BUILDING_PERMISSION" | "CUSTOMER_PREPARATION" | "ITEM_PREPARATION" | "SAFETY" | "OCCUPANCY" | "VEHICLE_ACCESS" | "TASK_INFORMATION";
export type ItemClass = "STANDARD_REQUIRED" | "CONDITIONAL" | "OPTIONAL" | "CUSTOMER_PROVIDED" | "INSPECTION_DEPENDENT" | "SEPARATE_QUOTE" | "SPECIALIZED";
export type ServiceStatus = "READY" | "READY_WITH_INSPECTION" | "COMMERCIAL_HOLD" | "SAFETY_HOLD";

export type ContentItem = {
  code: string;
  kind: RequirementKind;
  name: string;
  customerLabel: string;
  /** Admin / AI-facing: class, synonyms for search, why it exists. Never rendered to customers or partners. */
  description: string;
  preconditionClass?: PreconditionClass;
  synonyms?: string[];
};

/** A finalised assignment = the persisted RequirementAssignment + admin-only meta folded into internalNote. */
/** promotion: the audit reason when a SYSTEM_INFERRED line was promoted; the assumption id is kept for traceability. */
export type Meta = { provenance: Provenance; itemClass: ItemClass; why: string; assumption?: string; promotion?: string; since?: string };
export type ContentAssignment = RequirementAssignment & { meta: Meta };

export type ServiceContent = {
  status: ServiceStatus;
  /** Why this status; what a support agent should know. */
  rationale: string;
  /** Kinds the business explicitly declares as needing nothing special (≠ not configured). */
  noSpecial?: Partial<Record<RequirementKind, string>>;
  /**
   * Kinds deliberately left NOT_CONFIGURED because no safe operational definition exists. Allowed only on a
   * SAFETY_HOLD service, always with a reason — the honest alternative to asserting equipment nobody defined.
   */
  unconfigured?: Partial<Record<RequirementKind, string>>;
  assignments: ContentAssignment[];
};

/* ------------------------------------------------------------------ */
/* Shared catalogue (55 items)                                         */
/* ------------------------------------------------------------------ */
const M = (code: string, name: string, customerLabel: string, description: string, synonyms: string[] = []): ContentItem => ({ code, kind: "MATERIAL", name, customerLabel, description: `${description}${synonyms.length ? ` Also: ${synonyms.join(", ")}.` : ""}`, synonyms });
const E = (code: string, name: string, customerLabel: string, description: string, synonyms: string[] = []): ContentItem => ({ code, kind: "EQUIPMENT", name, customerLabel, description: `${description}${synonyms.length ? ` Also: ${synonyms.join(", ")}.` : ""}`, synonyms });
const P = (code: string, cls: PreconditionClass, name: string, customerLabel: string, description: string, synonyms: string[] = []): ContentItem => ({ code, kind: "CUSTOMER_PRECONDITION", name, customerLabel, description: `Class: ${cls}. ${description}${synonyms.length ? ` Also: ${synonyms.join(", ")}.` : ""}`, preconditionClass: cls, synonyms });

export const CATALOGUE: ContentItem[] = [
  // ── Materials the professional brings ──────────────────────────────────────
  M("cleaning-solutions", "Professional cleaning solutions", "Cleaning products", "Category-level: all-purpose surface and floor cleaning products. No brand or formulation is specified.", ["cleaning liquid", "cleaner", "surface cleaner"]),
  M("bathroom-descaler", "Bathroom descaler and sanitiser", "Descaler and sanitiser", "Category-level: limescale removal and sanitising products for bathroom fittings and tiles.", ["descaling agent", "toilet cleaner"]),
  M("kitchen-degreaser", "Kitchen degreaser", "Degreaser", "Category-level: grease removal for kitchen surfaces, cabinets, chimney exteriors and fan blades.", ["grease remover"]),
  M("glass-cleaner", "Glass cleaner", "Glass cleaner", "Category-level: streak-free glass and mirror cleaning product.", ["window cleaner"]),
  M("upholstery-shampoo", "Upholstery shampoo and fabric sanitiser", "Upholstery shampoo and sanitiser", "Fabric-safe cleaning and sanitising products for sofas and mattresses. Kept separate from carpet shampoo (different fabric handling).", ["sofa shampoo", "fabric cleaner"]),
  M("carpet-shampoo", "Carpet shampoo and stain treatment", "Carpet shampoo and stain treatment", "Products used with the carpet shampooing machine, including spot/stain treatment.", ["rug shampoo"]),
  M("laundry-detergent", "Laundry detergent and fabric conditioner", "Detergent and conditioner", "Stated by the service description ('premium detergents'). No brand specified.", ["washing powder", "softener"]),
  M("garbage-bags", "Garbage bags", "Garbage bags", "For post-event waste collection; disposal follows the building's normal waste route.", ["trash bags", "bin liners"]),
  M("car-care-products", "Car shampoo, polish and interior cleaner", "Car shampoo, polish and interior cleaner", "Category-level products for exterior wash, polish and interior surfaces (service description).", ["car wash liquid", "wax"]),
  M("pest-treatment-products", "Pest treatment products (applied as per label)", "Treatment products", "Category-level. Products are applied as per their label; no product, concentration or re-entry time is specified here — the professional advises per the product used.", ["pesticide", "insecticide", "termite treatment"]),
  M("paint-and-primer", "Paint, primer and putty", "Paint, primer and putty", "Customer-chosen brand and shade; not part of the fixed base price. Need and cost confirmed on site before use.", ["emulsion", "wall paint"]),
  M("masking-and-drop-sheets", "Masking tape and drop sheets", "Masking tape and floor covers", "Protection of floors, fittings and furniture during painting.", ["floor covering", "tarpaulin"]),
  M("ac-coil-cleaner", "AC coil cleaning solution", "Coil cleaning solution", "Category-level product for indoor/outdoor coil cleaning.", ["ac cleaner", "foam cleaner"]),
  M("ac-refrigerant-gas", "Refrigerant gas (if a refill is needed)", "Refrigerant gas, if needed", "Only when the pressure check shows a refill is needed. Not part of the fixed base price; confirmed on site before use.", ["ac gas", "gas refill", "gas top-up"]),
  M("spare-parts-and-fittings", "Spare parts and fittings (as needed)", "Spare parts, if needed", "Any replacement part identified during diagnosis. Not part of the fixed base price; confirmed with the customer before use.", ["replacement parts", "components", "fittings"]),
  M("fan-dust-covers", "Fan dust covers", "Dust covers", "Stated by the service description ('no dust showers, we bring covers').", ["dust sheets"]),
  M("salon-products", "Salon products and single-use disposables", "Salon products and disposables", "Category-level products and disposables for hair, grooming and beauty services. No brand specified; no audience-based variation.", ["beauty products", "disposable towels"]),
  M("food-safe-hygiene-kit", "Food-safe gloves and hair cover", "Food-safe gloves and hair cover", "Personal hygiene items for food preparation ('hygienic, trained kitchen helper').", ["gloves", "hair net"]),
  // ── Materials the customer provides ────────────────────────────────────────
  M("household-cleaning-supplies", "Household cleaning supplies", "Your regular cleaning supplies", "Customer-provided: the floor cleaner, dusting spray and cloths already used in the home. Applies to helper-style home-help services (assumption A1).", ["floor cleaner", "phenyl", "cloths"]),
  M("dishwashing-supplies", "Dishwashing liquid and scrubber", "Dishwashing liquid and scrubber", "Customer-provided kitchen supplies for utensil washing.", ["dish soap", "scrub pad"]),
  M("ingredients-and-menu", "Ingredients and the menu / recipes", "Ingredients and your menu", "Customer-provided: the food to be prepared and the instructions to follow.", ["groceries", "recipe"]),
  M("packing-material", "Packing boxes, bubble wrap and tape", "Boxes, bubble wrap and tape", "Customer-provided packing consumables (assumption A3).", ["cartons", "packing tape", "wrap"]),
  M("pot-and-potting-mix", "Pot and potting mix (if you want repotting)", "Pot and potting mix, if you want repotting", "Customer-provided, optional: only if the customer wants a plant repotted (assumption A2).", ["soil", "planter", "fertiliser"]),
  // ── Equipment the professional brings ──────────────────────────────────────
  E("vacuum-cleaner", "Vacuum cleaner", "Vacuum cleaner", "Standard dry vacuum for floors, upholstery and mattresses.", ["hoover"]),
  E("mop-and-bucket", "Mop and bucket", "Mop and bucket", "Professional mopping set for cleaning services (home-help services use the customer's tools — see household-cleaning-tools).", ["floor mop"]),
  E("step-ladder", "Step ladder (standard indoor reach)", "Step ladder", "Standard indoor step ladder for fans, high shelves and windows reachable from inside. Not work-at-height equipment.", ["ladder"]),
  E("upholstery-cleaning-machine", "Upholstery cleaning machine", "Upholstery cleaning machine", "Extraction/shampoo machine for sofas and upholstery.", ["sofa cleaning machine", "extractor"]),
  E("carpet-shampoo-machine", "Carpet shampooing machine", "Carpet shampooing machine", "Machine shampooing stated by the service description.", ["carpet cleaner"]),
  E("uv-sanitising-unit", "UV sanitising unit", "UV sanitiser", "UV treatment stated by the service description.", ["uv lamp"]),
  E("glass-cleaning-kit", "Squeegee and glass cleaning kit", "Glass cleaning kit", "Squeegee, applicator and track brushes.", ["squeegee"]),
  E("car-cleaning-kit", "Car cleaning kit (foam applicator, microfibre, vacuum)", "Car cleaning kit", "Doorstep exterior wash and interior vacuum kit. No pressure washer is asserted.", ["car wash kit"]),
  E("pest-application-equipment", "Sprayer and application equipment", "Application equipment", "Category-level application equipment for the treatment products used.", ["sprayer"]),
  E("painting-tools", "Rollers, brushes and painting tools", "Painting tools", "Rollers, brushes, trays and scrapers.", ["paint roller"]),
  E("ac-service-tools", "AC servicing tools (jet pump, gauges)", "AC servicing tools", "Jet pump for coil wash and gauges for the pressure check.", ["jet pump", "gauges"]),
  E("electrician-toolkit", "Electrician's toolkit and tester", "Electrician's toolkit", "Hand tools and a tester.", ["tester", "tools"]),
  E("plumbing-toolkit", "Plumber's toolkit", "Plumber's toolkit", "Hand tools for taps, joints and drainage.", ["wrench", "tools"]),
  E("gardening-tools", "Pruning shears and gardening tools", "Gardening tools", "Shears and hand tools for pruning and repotting.", ["secateurs"]),
  E("salon-kit", "Salon kit with sterilised tools", "Salon kit", "Tools for hair, grooming and beauty services; sterilised between customers.", ["scissors", "clippers"]),
  // ── Equipment the customer provides ────────────────────────────────────────
  E("household-cleaning-tools", "Household cleaning tools (broom, mop, bucket)", "Your broom, mop and bucket", "Customer-provided for helper-style home-help services (assumption A1).", ["jhadu", "pocha"]),
  // ── Customer preconditions ─────────────────────────────────────────────────
  P("running-water-access", "UTILITY", "Running water access", "Access to running water", "A tap the professional can use for cleaning and rinsing.", ["water", "tap"]),
  P("power-socket-access", "UTILITY", "Working power socket near the work area", "A working power socket near the work area", "For the professional's electrical equipment.", ["electricity", "plug point"]),
  P("access-to-all-areas", "ACCESS", "Access to every area included in the service", "Access to all the areas to be covered", "Rooms or spaces that are locked or occupied cannot be serviced.", ["entry", "rooms open"]),
  P("loose-items-put-away", "CUSTOMER_PREPARATION", "Loose, fragile and valuable items put away", "Put away loose, fragile and valuable items", "Prevents damage and disputes; advice, not a booking condition.", ["valuables", "clutter"]),
  P("adult-present", "OCCUPANCY", "An adult available during the visit", "An adult available at home during the visit", "Only for services where decisions are taken on site (parts, shade, scope, access).", ["someone at home"]),
  P("society-permission-external-work", "BUILDING_PERMISSION", "Society / building permission for external work", "Society permission for work on the building exterior", "External work on a building usually needs the society's or manager's consent.", ["RWA permission", "NOC"]),
  P("vehicle-access-and-parking", "VEHICLE_ACCESS", "Vehicle parked where washing is permitted, with water nearby", "Park where washing is allowed, with water access nearby", "Doorstep car cleaning depends on where the vehicle stands.", ["parking", "wash bay"]),
  P("fridge-emptied-and-off", "ITEM_PREPARATION", "Fridge emptied and switched off", "Empty the fridge and switch it off beforehand", "Legacy guidance ('if possible'): a defrosted, empty fridge gets a better clean.", ["defrost"]),
  P("bed-linen-removed", "ITEM_PREPARATION", "Bed linen removed from the mattress", "Remove sheets and covers from the mattress", "So the mattress surface is reachable.", ["strip the bed"]),
  P("furniture-away-from-walls", "SPACE", "Furniture moved away from the walls", "Move furniture away from the walls to be painted", "Legacy guidance ('where possible').", ["clear the walls"]),
  P("paint-shade-confirmed", "TASK_INFORMATION", "Paint shade and finish confirmed", "Confirm the paint shade and finish", "Confirmed with the professional before the first coat.", ["colour", "finish"]),
  P("room-ventilation", "CUSTOMER_PREPARATION", "Rooms can be ventilated", "Windows can be opened for ventilation", "Ventilation while paint dries.", ["airflow"]),
  P("drying-time-allowed", "CUSTOMER_PREPARATION", "Drying time after the service", "Allow drying time after the service", "Legacy guidance for shampooed fabrics.", ["dry time"]),
  P("pest-treatment-preparation", "SAFETY", "Home prepared for pest treatment", "Food covered; people and pets away from treated areas as advised", "The one booking-blocking confirmation. Re-entry time is advised by the professional per the product used — not specified here.", ["vacate", "cover food"]),
  P("ac-units-accessible", "ACCESS", "Clear access to the indoor and outdoor units", "Clear access to the indoor and outdoor AC units", "Space below the indoor unit and a safe path to the outdoor unit.", ["outdoor unit access"]),
  P("switchboard-access", "SAFETY", "Access to the main switchboard / MCB", "Access to the main switchboard", "The circuit is isolated before electrical work.", ["MCB", "mains"]),
  P("water-shutoff-access", "SAFETY", "Access to the main water shut-off valve", "Access to the main water shut-off", "The supply may need to be closed while working on joints.", ["stopcock", "main valve"]),
  P("garments-sorted", "ITEM_PREPARATION", "Clothes sorted, pockets emptied, special-care items pointed out", "Sort the clothes, empty pockets, point out delicate items", "Pickup-based fabric services.", ["laundry sorted"]),
  P("wardrobe-valuables-removed", "CUSTOMER_PREPARATION", "Valuables, cash and documents removed from the wardrobe", "Remove valuables and documents from the wardrobe", "Checked by the professional before touching the wardrobe (dispute prevention).", ["jewellery"]),
  P("fragile-items-identified", "TASK_INFORMATION", "Fragile and high-value items identified", "Point out fragile and high-value items", "So they are handled, wrapped or set aside first.", ["breakables"]),
  P("priorities-shared", "TASK_INFORMATION", "Priority rooms / tasks shared with the professional", "Tell us your priorities", "Time-boxed services do the most important areas first.", ["task list", "agenda"]),
  P("allergies-disclosed", "TASK_INFORMATION", "Allergies or sensitivities disclosed", "Tell us about allergies or sensitivities", "Skin/product sensitivities (salon) or food allergies (kitchen prep). Disclosure only — no medical guidance.", ["allergy"]),
  P("lit-space-with-chair", "SPACE", "Well-lit space with a chair, a socket and basin access", "A well-lit space with a chair, a nearby socket and access to a basin", "Salon-at-home workspace.", ["seating", "lighting"]),
  P("windows-reachable-from-inside", "SAFETY", "Windows reachable safely from inside; exterior faces assessed on site", "Windows reachable from inside; high or exterior glass is assessed on arrival", "INSPECTION_DEPENDENT: no work-at-height method exists. The professional decides on site what can be reached safely.", ["high windows", "exterior glass"]),
  P("window-access", "CUSTOMER_PREPARATION", "Window grills unlocked; curtains and blinds removed", "Unlock grills; remove curtains and blinds", "So glass, tracks and grills are reachable.", ["curtains"]),
  P("balcony-cleared", "SPACE", "Balcony floor cleared of plants and loose items", "Clear the balcony floor of plants and loose items", "So the floor and railing can be cleaned end to end.", ["pots moved"]),
  P("items-below-fans-covered", "CUSTOMER_PREPARATION", "Delicate items below the fans moved or covered", "Move or cover delicate items below the fans", "Covers are brought; delicate items are still safer moved.", ["furniture under fan"]),
  P("leftovers-put-away", "CUSTOMER_PREPARATION", "Leftover food and valuables put away", "Put away leftover food and valuables", "Post-event clean removes what is left out.", ["leftovers"]),
  P("plants-accessible", "ACCESS", "Plants accessible; known issues shared", "Plants within reach; tell us about known issues", "Hanging or high plants brought within reach; pests or yellowing mentioned.", ["hanging plants"]),
  P("safe-access-assessed-on-site", "SAFETY", "Safe access assessed by the professional before work starts", "Safe access checked before work starts", "SAFETY_HOLD / INSPECTION_DEPENDENT for facade and exterior work. No method is defined; the assessment is the rule.", ["site assessment", "risk check"]),
];

/* ------------------------------------------------------------------ */
/* Assignment builders                                                 */
/* ------------------------------------------------------------------ */
type Partial_ = Partial<RequirementAssignment>;
let order = 0;
const seq = () => ++order;
function note(meta: Meta): string {
  // The tag names the content version in which THIS line last changed, so an unrelated line never churns a service version.
  const parts = [`[${meta.provenance} ${meta.since ?? FIRST_CONTENT_VERSION}]`, `Why: ${meta.why}`];
  if (meta.assumption) parts.push(`Assumption ${meta.assumption} (owner may override).`);
  if (meta.promotion) parts.push(meta.promotion);
  parts.push("Not asserted: quantity, brand, specification, supplier.");
  return parts.join(" ");
}
function make(base: RequirementAssignment, meta: Meta): ContentAssignment {
  return { ...base, internalNote: note(meta), sortOrder: seq(), meta };
}
/** Professional brings it, included in the price. */
const bring = (itemCode: string, why: string, extra: Partial_ = {}, meta: Partial<Meta> = {}): ContentAssignment =>
  make({ id: itemCode, itemCode, responsibility: "PROFESSIONAL", charge: "INCLUDED", optional: false, enforcement: "INFORMATIONAL", verification: "NONE", active: true, ...extra } as RequirementAssignment, { provenance: "OWNER_APPROVED", itemClass: "STANDARD_REQUIRED", why, ...meta });
/** Professional supplies it, need confirmed on site, not in the fixed price. COMMERCIAL_HOLD: no in-app quote chain yet. */
const quoted = (itemCode: string, customerNote: string, why: string, extra: Partial_ = {}): ContentAssignment =>
  make({ id: itemCode, itemCode, responsibility: "PROFESSIONAL", procurement: "PROFESSIONAL", charge: "SEPARATE_QUOTE", optional: true, enforcement: "INFORMATIONAL", verification: "NONE", customerNote, active: true, ...extra } as RequirementAssignment, { provenance: "COMMERCIAL_HOLD", itemClass: "SEPARATE_QUOTE", why: `${why} No in-app quote → approval → payment chain exists (Phase 09); the professional confirms need and cost on site before use.` });
/** Customer provides a material or tool. */
const provide = (itemCode: string, customerNote: string, why: string, extra: Partial_ = {}, meta: Partial<Meta> = {}): ContentAssignment =>
  make({ id: itemCode, itemCode, responsibility: "CUSTOMER", charge: "NOT_APPLICABLE", optional: false, enforcement: "REQUIRED_BEFORE_ARRIVAL", verification: "PARTNER_CHECK", customerNote, active: true, ...extra } as RequirementAssignment, { provenance: "OWNER_APPROVED", itemClass: "CUSTOMER_PROVIDED", why, ...meta });
/** Customer precondition. */
const pre = (itemCode: string, enforcement: RequirementAssignment["enforcement"], customerNote: string, why: string, extra: Partial_ = {}, meta: Partial<Meta> = {}): ContentAssignment =>
  make(
    {
      id: itemCode,
      itemCode,
      responsibility: "CUSTOMER",
      charge: "NOT_APPLICABLE",
      optional: false,
      enforcement,
      verification: enforcement === "REQUIRED_BEFORE_BOOKING" ? "CUSTOMER_ATTESTATION" : enforcement === "INFORMATIONAL" || enforcement === "WARNING" ? "NONE" : "PARTNER_CHECK",
      customerNote,
      active: true,
      ...extra,
    } as RequirementAssignment,
    { provenance: "OWNER_APPROVED", itemClass: "STANDARD_REQUIRED", why, ...meta },
  );

const WATER = (why = "Cleaning and rinsing need a tap the professional can use.") => pre("running-water-access", "REQUIRED_BEFORE_ARRIVAL", "Please keep a tap available for cleaning and rinsing.", why, { partnerInstructions: "Confirm a usable tap on arrival before unpacking." });
const POWER = (why = "The equipment runs off a standard socket.") => pre("power-socket-access", "REQUIRED_BEFORE_ARRIVAL", "Please keep a working power socket free near the work area.", why, { partnerInstructions: "Confirm a working socket on arrival; carry your extension lead." });
const LOOSE = (customerNote: string) => pre("loose-items-put-away", "WARNING", customerNote, "Prevents damage to small or fragile items and the disputes that follow.");
const ADULT = (why: string) => pre("adult-present", "WARNING", "Please have an adult at home during the visit to take decisions with the professional.", why);
const HOME_HELP_SUPPLIES = () => [
  provide("household-cleaning-supplies", "We use your regular cleaning supplies — floor cleaner, dusting spray and cloths.", "Helper-style service: the home's own supplies are used.", { partnerInstructions: "Ask which products the customer prefers; report anything missing before starting." }, { provenance: "OWNER_APPROVED", assumption: "A1", promotion: "Promoted under owner's Phase 06 content authorization (2026-09-22).", since: "2026-09-22.final.2" }),
  provide("household-cleaning-tools", "We use your broom, mop and bucket.", "Helper-style service: the home's own tools are used.", {}, { provenance: "OWNER_APPROVED", assumption: "A1", promotion: "Promoted under owner's Phase 06 content authorization (2026-09-22).", since: "2026-09-22.final.2" }),
];

function service(status: ServiceStatus, rationale: string, build: () => ContentAssignment[], noSpecial?: ServiceContent["noSpecial"], unconfigured?: ServiceContent["unconfigured"]): ServiceContent {
  order = 0;
  return { status, rationale, noSpecial, unconfigured, assignments: build() };
}

/* ------------------------------------------------------------------ */
/* The 31 live services                                                */
/* ------------------------------------------------------------------ */
export const CONTENT: Record<string, ServiceContent> = {
  // ── Home cleaning ────────────────────────────────────────────────────────────
  "deep-cleaning": service("READY", "Whole-home professional clean: all products and machines are brought; the customer opens every area and clears small items.", () => [
    bring("cleaning-solutions", "All-purpose surfaces and floors across the home."),
    bring("bathroom-descaler", "Bathrooms are part of a whole-home deep clean."),
    bring("kitchen-degreaser", "Kitchen surfaces are part of a whole-home deep clean."),
    bring("vacuum-cleaner", "Floors, upholstery and corners."),
    bring("mop-and-bucket", "Professional mopping set."),
    bring("step-ladder", "Fans, high shelves and cobwebs.", {}, { itemClass: "STANDARD_REQUIRED" }),
    WATER(), POWER(),
    pre("access-to-all-areas", "REQUIRED_BEFORE_ARRIVAL", "Please keep every room to be cleaned open and accessible.", "A locked or occupied room cannot be cleaned and becomes a scope dispute.", { partnerInstructions: "Walk through with the customer on arrival; note any room that is unavailable before starting." }),
    LOOSE("Please put away small, fragile or valuable items before we start."),
  ]),
  "bathroom-cleaning": service("READY", "Single-area sanitisation and descaling.", () => [
    bring("bathroom-descaler", "Descaling and sanitising are the service."),
    bring("mop-and-bucket", "Floor finish."),
    WATER(),
    LOOSE("Please clear toiletries and personal items from the counters and shelves."),
  ]),
  "kitchen-cleaning": service("READY", "Kitchen degrease, chimney exterior and counters.", () => [
    bring("kitchen-degreaser", "Degreasing is the service."),
    bring("cleaning-solutions", "Counters and floor."),
    WATER(),
    LOOSE("Please clear the counters of utensils and groceries so every surface can be degreased."),
  ], { EQUIPMENT: "Hand tools, cloths and scrubbers are part of the professional's basic kit; no machine is needed." }),
  "kitchen-cabinet-cleaning": service("READY", "The professional empties, degreases and re-layers the cabinets; the customer only flags fragile items.", () => [
    bring("kitchen-degreaser", "Cabinet interiors and fronts."),
    bring("cleaning-solutions", "Shelf liners and drawers."),
    WATER(),
    pre("fragile-items-identified", "WARNING", "We empty and re-layer the cabinets ourselves — please point out glassware and anything fragile first.", "Breakage prevention; the professional handles the contents."),
  ], { EQUIPMENT: "Hand tools and cloths are part of the professional's basic kit; no machine is needed." }),
  "fridge-cleaning": service("READY", "Inside-out fridge clean with defrost wipe-down (service description).", () => [
    bring("cleaning-solutions", "Interior shelves and seals."),
    WATER(),
    pre("fridge-emptied-and-off", "WARNING", "If you can, empty the fridge and switch it off a few hours before we arrive — a defrosted, empty fridge gets a better clean. We wipe up the defrost water.", "Legacy guidance said 'if possible'; the professional can work around a stocked fridge, so this is advice, not a condition.", { customerWarning: "Keep perishables in a cool bag while the fridge is off." }, { provenance: "EXISTING_AUTHORITATIVE" }),
  ], { EQUIPMENT: "Hand tools and cloths are part of the professional's basic kit; no machine is needed." }),
  "fan-cleaning": service("READY", "Blade degrease with dust covers, as the service description states.", () => [
    bring("fan-dust-covers", "Stated by the description: 'we bring covers'.", {}, { provenance: "EXISTING_AUTHORITATIVE" }),
    bring("kitchen-degreaser", "Blade grease."),
    bring("step-ladder", "Ceiling fans are reached with a standard step ladder."),
    POWER("Fans are switched off at the wall; a socket is not needed — but light is."),
    pre("items-below-fans-covered", "WARNING", "Covers go on every fan, but please move anything delicate from directly below them.", "Dust and drips land below the fan."),
  ]),
  "sofa-deep-cleaning": service("READY", "Shampoo, vacuum and sanitise upholstery; drying time is legacy guidance.", () => [
    bring("upholstery-shampoo", "Fabric-safe shampoo and sanitiser are the service."),
    bring("upholstery-cleaning-machine", "Extraction/shampoo machine."),
    bring("vacuum-cleaner", "Pre-clean and crevices."),
    WATER(), POWER(),
    LOOSE("Please clear cushions, throws and anything stored under or behind the sofa."),
    pre("drying-time-allowed", "INFORMATIONAL", "Plan to keep the sofa unused for a few hours afterwards while it dries.", "Legacy guidance; sets expectations.", {}, { provenance: "EXISTING_AUTHORITATIVE" }),
  ]),
  "carpet-shampooing": service("READY", "Machine shampoo and stain treatment (service description).", () => [
    bring("carpet-shampoo", "Shampoo and stain treatment are the service."),
    bring("carpet-shampoo-machine", "Machine shampooing is stated by the description.", {}, { provenance: "EXISTING_AUTHORITATIVE" }),
    bring("vacuum-cleaner", "Pre-clean."),
    WATER(), POWER(),
    LOOSE("Please move light furniture and items off the carpet or rug."),
    pre("drying-time-allowed", "INFORMATIONAL", "Allow a few hours of drying time and keep the room ventilated.", "Sets expectations after shampooing."),
  ]),
  "mattress-sanitization": service("READY", "UV treatment and deep vacuum (service description).", () => [
    bring("uv-sanitising-unit", "UV treatment is stated by the description.", {}, { provenance: "EXISTING_AUTHORITATIVE" }),
    bring("vacuum-cleaner", "Deep vacuum is stated by the description.", {}, { provenance: "EXISTING_AUTHORITATIVE" }),
    POWER(),
    pre("bed-linen-removed", "WARNING", "Please strip the sheets, covers and mattress protector before we arrive.", "The professional can strip a bed, so this is preparation advice."),
  ], { MATERIAL: "UV treatment and deep vacuum use no consumable products (service description)." }),
  "wardrobe-cleaning": service("READY", "Declutter, clean and re-organise; valuables are checked before anything is touched.", () => [
    bring("cleaning-solutions", "Shelf and interior wipe-down."),
    bring("vacuum-cleaner", "Dust and lint."),
    pre("wardrobe-valuables-removed", "REQUIRED_BEFORE_ARRIVAL", "Please remove cash, jewellery and documents before we declutter and re-organise.", "Dispute prevention: confirmed before the wardrobe is touched.", { partnerInstructions: "Ask the customer to confirm valuables are out before opening the wardrobe; do not proceed otherwise." }),
    pre("priorities-shared", "INFORMATIONAL", "Tell us how you would like things arranged, and what can be set aside for donation.", "Re-organisation follows the customer's preference."),
    ADULT("Decisions about what to keep, move or set aside are taken on site."),
  ]),
  "window-cleaning": service("READY_WITH_INSPECTION", "Glass, tracks and grills for every window — reachable from inside with a standard ladder. High or exterior glass has no defined work-at-height method, so the professional assesses on site.", () => [
    bring("glass-cleaner", "Streak-free glass is the service."),
    bring("glass-cleaning-kit", "Squeegee and track brushes."),
    bring("step-ladder", "Windows reachable from inside."),
    WATER(),
    pre("window-access", "WARNING", "Please unlock the grills and take down curtains or blinds so the glass and tracks are reachable.", "Reachability."),
    pre("windows-reachable-from-inside", "REQUIRED_AT_START", "We clean what can be reached safely from inside; high or exterior glass is assessed when we arrive.", "No work-at-height method is defined; the professional's on-site judgement is the rule.", { partnerInstructions: "Assess each window before starting. Do not lean out or climb externally; exclude any glass that cannot be reached safely from inside and tell the customer." }, { provenance: "INSPECTION_DEPENDENT", itemClass: "INSPECTION_DEPENDENT" }),
  ]),
  "balcony-cleaning": service("READY", "Floor, railing and glass.", () => [
    bring("cleaning-solutions", "Floor and railing."),
    bring("glass-cleaner", "Balcony glass."),
    bring("mop-and-bucket", "Floor finish."),
    WATER(),
    pre("balcony-cleared", "WARNING", "Please move pots, furniture and loose items so the whole floor and railing can be cleaned.", "Coverage."),
  ]),
  // ── Home help (helper-style: the home's own supplies and tools are used — assumption A1) ──
  "dusting-wiping": service("READY", "Helper-style dusting and wiping with the home's supplies.", () => [
    ...HOME_HELP_SUPPLIES(),
    pre("fragile-items-identified", "WARNING", "Please point out delicate décor and anything that should not be moved.", "Breakage prevention."),
  ]),
  "sweeping-mopping": service("READY", "Helper-style sweeping and mopping with the home's tools.", () => [
    ...HOME_HELP_SUPPLIES(),
    WATER(),
    LOOSE("Please pick up cables, toys and small items from the floor."),
  ]),
  "utensil-washing": service("READY", "Sink-to-shelf utensil washing with the kitchen's supplies.", () => [
    provide("dishwashing-supplies", "We use the dishwashing liquid and scrubber in your kitchen.", "Helper-style service; the kitchen's own supplies.", {}, { provenance: "OWNER_APPROVED", assumption: "A1", promotion: "Promoted under owner's Phase 06 content authorization (2026-09-22).", since: "2026-09-22.final.2" }),
    WATER(),
  ], { EQUIPMENT: "The kitchen sink and drying rack are used; no equipment is brought." }),
  "kitchen-prep": service("READY", "Chopping, marination and meal prep by a hygienic kitchen helper.", () => [
    bring("food-safe-hygiene-kit", "'Hygienic' is stated by the description.", {}, { provenance: "EXISTING_AUTHORITATIVE" }),
    provide("ingredients-and-menu", "Please keep the ingredients out and tell us the menu or recipes to follow.", "Nothing can be prepared without them.", { partnerInstructions: "Confirm the menu and quantities with the customer before starting." }),
    WATER(),
    pre("allergies-disclosed", "WARNING", "Please tell us about any food allergies at home before we start.", "Disclosure only; the helper avoids the ingredient."),
  ], { EQUIPMENT: "The kitchen's own knives, boards and appliances are used; no equipment is brought." }),
  "packing-unpacking": service("READY", "Careful packing/unpacking help; consumables are the customer's (assumption A3); fragile items are confirmed before packing starts.", () => [
    provide("packing-material", "Please keep enough of these ready before we arrive; we pack with what you provide.", "Consumables are not part of the fixed price and no supply flow exists.", { partnerInstructions: "Check the material is sufficient on arrival; agree with the customer what to pack first." }, { provenance: "OWNER_APPROVED", assumption: "A3", promotion: "Promoted under owner's Phase 06 content authorization (2026-09-22).", since: "2026-09-22.final.2" }),
    pre("fragile-items-identified", "REQUIRED_AT_START", "Please show us fragile and high-value items before packing starts so they are wrapped and labelled first.", "Breakage and dispute prevention; confirmed before work starts.", { partnerInstructions: "Do not start until fragile and high-value items are identified and labelled." }),
    pre("priorities-shared", "INFORMATIONAL", "Tell us which rooms to pack or unpack first.", "Time-boxed work."),
    ADULT("What goes where is decided on site."),
  ], { EQUIPMENT: "Packing is manual; no equipment is brought." }),
  "hourly-bookings": service("READY", "A trained pro by the hour; the customer sets the agenda and the home's supplies are used.", () => [
    pre("priorities-shared", "INFORMATIONAL", "You set the agenda — a written list helps the professional make the most of the time.", "Stated by the description: 'you set the agenda'.", {}, { provenance: "EXISTING_AUTHORITATIVE" }),
    provide("household-cleaning-supplies", "We work with the supplies and tools already in your home.", "Helper-style service.", { enforcement: "WARNING", verification: "NONE", partnerInstructions: "Ask for the task list and the supplies available before starting the clock." }, { provenance: "OWNER_APPROVED", assumption: "A1", promotion: "Promoted under owner's Phase 06 content authorization (2026-09-22).", since: "2026-09-22.final.2" }),
    ADULT("The customer directs the work."),
  ], { EQUIPMENT: "Tools depend on the task the customer sets; the home's own tools are used (assumption A1)." }),
  // ── Laundry & fabric (pickup-based; work happens off site) ────────────────────
  laundry: service("READY", "Wash, dry and fold with premium detergents (description); pickup-based.", () => [
    bring("laundry-detergent", "Stated by the description: 'premium detergents'.", {}, { provenance: "EXISTING_AUTHORITATIVE" }),
    pre("garments-sorted", "WARNING", "Please empty the pockets and point out delicate or special-care items; we follow the care labels.", "Care-label handling and pocket contents are the usual dispute sources."),
  ], { EQUIPMENT: "Washing and drying happen at the laundry facility; no equipment is needed at the customer's home." }),
  "ironing-folding": service("READY", "Steam ironing and folding, delivered back (description); pickup-based.", () => [
    pre("garments-sorted", "WARNING", "Please point out delicate fabrics and anything that needs special handling.", "Fabric care."),
  ], { MATERIAL: "No consumables are used at the customer's home; ironing happens at the facility.", EQUIPMENT: "Ironing equipment is at the facility; nothing is needed at the customer's home." }),
  // ── Event & occasion ─────────────────────────────────────────────────────────
  "pre-party-express-clean": service("READY", "Rapid whole-home refresh before guests; priorities first.", () => [
    bring("cleaning-solutions", "Surfaces and floors."),
    bring("mop-and-bucket", "Floors."),
    bring("vacuum-cleaner", "Floors and upholstery."),
    WATER(), POWER(),
    pre("priorities-shared", "INFORMATIONAL", "Tell us the rooms your guests will use so they come first.", "Time-boxed refresh."),
  ]),
  "after-party-express-clean": service("READY", "Post-event cleanup: trash, dishes, floors (description).", () => [
    bring("garbage-bags", "Trash removal is stated by the description.", {}, { provenance: "EXISTING_AUTHORITATIVE" }),
    bring("cleaning-solutions", "Surfaces and floors."),
    bring("mop-and-bucket", "Floors."),
    WATER(),
    pre("leftovers-put-away", "WARNING", "Please put away leftover food you want to keep, and any valuables left out during the party.", "Everything left out is treated as waste or clutter."),
  ]),
  // ── Vehicle care ─────────────────────────────────────────────────────────────
  "car-surface-cleaning": service("READY", "Doorstep exterior wash, polish and interior vacuum (description).", () => [
    bring("car-care-products", "Wash, polish and interior products are the service."),
    bring("car-cleaning-kit", "Doorstep kit."),
    bring("vacuum-cleaner", "Interior vacuum is stated by the description.", {}, { provenance: "EXISTING_AUTHORITATIVE" }),
    pre("vehicle-access-and-parking", "REQUIRED_BEFORE_ARRIVAL", "Please park where washing is allowed by your building or society, with a water point and a socket nearby.", "A doorstep wash depends on where the car stands and whether washing is permitted there.", { partnerInstructions: "Confirm the wash location is permitted and has water before starting." }),
    POWER("The vacuum needs a socket."),
    LOOSE("Please remove valuables and personal items from the car before the interior vacuum."),
  ]),
  // ── Specialised care ─────────────────────────────────────────────────────────
  "pest-control": service("READY", "Cockroach, termite and general pest treatment. Products are applied per label; the customer's preparation is the one booking-blocking confirmation.", () => [
    bring("pest-treatment-products", "Treatment products are the service; applied per label.", { customerNote: "Applied as per the product label.", handlingNote: "Handle, store and apply strictly per the product label; keep the label available for the customer." }),
    bring("pest-application-equipment", "Application equipment."),
    pre("pest-treatment-preparation", "REQUIRED_BEFORE_BOOKING", "Please cover food, utensils and pet bowls, and keep people and pets away from treated areas during the treatment and for the time the professional advises afterwards.", "Treatment cannot proceed safely in an occupied, unprepared home; this is the only confirmation that blocks a booking.", {
      customerWarning: "Tell us in advance if anyone at home is pregnant, an infant, elderly, or has asthma, allergies or other respiratory conditions.",
      partnerInstructions: "Confirm the preparation on arrival; do not treat occupied rooms. Tell the customer the re-entry time for the product used, per its label.",
    }),
    pre("access-to-all-areas", "REQUIRED_BEFORE_ARRIVAL", "Please unlock storerooms, lofts and the cabinets under sinks — treatment covers the areas we can reach.", "Coverage gaps are the main complaint driver."),
    ADULT("Re-entry advice and treated-area decisions are given on site."),
  ]),
  "plant-care": service("READY", "Watering, pruning, repotting and plant health check (description). Repotting supplies are the customer's, only if wanted (assumption A2).", () => [
    bring("gardening-tools", "Pruning and repotting tools."),
    provide("pot-and-potting-mix", "If you would like a plant repotted, please keep the new pot and potting mix ready.", "Repotting is in scope but the pot and soil are the customer's choice; no supply flow exists.", { optional: true, enforcement: "WARNING", verification: "NONE" }, { provenance: "OWNER_APPROVED", itemClass: "OPTIONAL", assumption: "A2", promotion: "Promoted under owner's Phase 06 content authorization (2026-09-22).", since: "2026-09-22.final.2" }),
    WATER("Watering is part of the service."),
    pre("plants-accessible", "INFORMATIONAL", "Bring hanging or high plants within reach if you can, and tell us about pests or yellowing you have noticed.", "Coverage and diagnosis."),
  ]),
  "fasade-cleaning": service("SAFETY_HOLD", "Exterior building cleaning has no defined work-at-height method in HOMEEIGO. No equipment is asserted (equipment is NOT_CONFIGURED, not 'included'); society permission and an on-site safety assessment are the rules. Bookability is unchanged.", () => [
    bring("cleaning-solutions", "Exterior surfaces."),
    pre("society-permission-external-work", "REQUIRED_BEFORE_ARRIVAL", "Work on the building exterior needs your society's or building manager's permission — please arrange it before the visit.", "External work without consent is stopped by security.", { partnerInstructions: "Ask for the society's permission before starting; do not start without it." }),
    pre("safe-access-assessed-on-site", "REQUIRED_AT_START", "Our professional assesses safe access before starting; areas that cannot be reached safely are not covered.", "No work-at-height method exists; the assessment is the rule.", { partnerInstructions: "Assess access before any work. Do not use improvised height access. Exclude anything that cannot be reached safely and record it." }, { provenance: "SAFETY_HOLD", itemClass: "INSPECTION_DEPENDENT" }),
    WATER(), POWER(),
    ADULT("Scope exclusions are agreed on site."),
  ], undefined, { EQUIPMENT: "No work-at-height method, equipment specification or provider capability exists in HOMEEIGO (0 providers hold any certification). Asserting any access equipment — or that it is included — would be a safety and price promise nobody can keep. Left NOT_CONFIGURED until an owner-defined method exists." }),
  // ── Beauty ───────────────────────────────────────────────────────────────────
  "salon-at-home": service("READY", "Haircut, grooming and beauty at home; no audience-based variation.", () => [
    bring("salon-products", "Products and disposables are the service."),
    bring("salon-kit", "Sterilised tools."),
    pre("lit-space-with-chair", "WARNING", "Please keep a well-lit spot with a chair, a nearby socket and access to a wash basin.", "Workspace; the professional can adapt, so this is advice."),
    pre("allergies-disclosed", "WARNING", "Please tell us about allergies or skin sensitivities before any treatment.", "Disclosure only; no medical guidance."),
  ]),
  // ── Home maintenance ─────────────────────────────────────────────────────────
  "home-painting": service("COMMERCIAL_HOLD", "Interior and exterior wall painting. Paint is not in the fixed price and is confirmed on site — but no in-app quote → approval → payment chain exists. Exterior work is assessed on site (no work-at-height method).", () => [
    bring("masking-and-drop-sheets", "Protection of floors and fittings."),
    bring("painting-tools", "Rollers, brushes and trays."),
    bring("step-ladder", "Interior walls and ceilings."),
    quoted("paint-and-primer", "Paint in the brand and shade of your choice is not included in the base price; the professional confirms the need and the cost with you before using any.", "The fixed base price covers labour; paint is a customer choice."),
    pre("paint-shade-confirmed", "REQUIRED_AT_START", "The professional confirms the shade and finish with you before the first coat.", "Rework prevention.", { partnerInstructions: "Get the shade and finish confirmed before opening any paint." }),
    pre("furniture-away-from-walls", "WARNING", "Please move furniture away from the walls to be painted where possible; our team helps with light pieces.", "Legacy guidance.", {}, { provenance: "EXISTING_AUTHORITATIVE" }),
    pre("room-ventilation", "INFORMATIONAL", "Keep windows open while the paint dries.", "Ventilation."),
    pre("safe-access-assessed-on-site", "REQUIRED_AT_START", "For exterior walls, our professional assesses safe access first; areas that cannot be reached safely are not painted.", "No work-at-height method exists for exterior walls.", { partnerInstructions: "Exterior: assess access before starting; no improvised height access." }, { provenance: "INSPECTION_DEPENDENT", itemClass: "INSPECTION_DEPENDENT" }),
    ADULT("Shade, scope and paint decisions are taken on site."),
  ]),
  "ac-service": service("COMMERCIAL_HOLD", "AC maintenance, gas refill and repair (description). Gas and parts are confirmed on site and are not in the fixed price; no in-app quote chain exists.", () => [
    bring("ac-service-tools", "Jet pump and gauges for the service and pressure check."),
    bring("ac-coil-cleaner", "Coil wash."),
    quoted("ac-refrigerant-gas", "Only if the pressure check shows a refill is needed; the professional confirms the cost with you before proceeding.", "Gas refill is in scope by the description but cannot be part of a fixed base price.", { partnerInstructions: "Show the gauge reading to the customer and confirm the cost before any refill." }),
    quoted("spare-parts-and-fittings", "Any part that needs replacing is confirmed with you before the work.", "Repair scope."),
    pre("ac-units-accessible", "REQUIRED_BEFORE_ARRIVAL", "Please clear the space below the indoor unit and a safe path to the outdoor unit.", "Both units must be reachable.", { partnerInstructions: "Confirm access to both units on arrival." }),
    POWER("The unit and tools need power."), WATER("The coil wash needs water."),
    ADULT("Gas and part decisions are taken on site."),
  ]),
  electrician: service("COMMERCIAL_HOLD", "Wiring, switches, fans and appliance installation. Parts are confirmed on site and are not in the fixed price; no in-app quote chain exists.", () => [
    bring("electrician-toolkit", "Tools and tester."),
    quoted("spare-parts-and-fittings", "Switches, wiring and fittings are confirmed with you before they are used.", "Repair and installation scope."),
    pre("switchboard-access", "REQUIRED_AT_START", "Please keep the main switchboard reachable — the professional switches off the circuit before working.", "Electrical isolation is confirmed before work starts.", { partnerInstructions: "Isolate the circuit at the MCB and test before touching any wiring." }),
    ADULT("Part and scope decisions are taken on site."),
  ]),
  plumbing: service("COMMERCIAL_HOLD", "Leak fixes, tap installation and drainage. Parts are confirmed on site and are not in the fixed price; no in-app quote chain exists.", () => [
    bring("plumbing-toolkit", "Hand tools."),
    quoted("spare-parts-and-fittings", "Taps, pipes and fittings are confirmed with you before they are used.", "Repair and installation scope."),
    pre("water-shutoff-access", "REQUIRED_AT_START", "Please keep the main water shut-off reachable — the professional may close the supply while working.", "Confirmed before any joint is opened.", { partnerInstructions: "Locate the shut-off valve before opening any joint." }),
    WATER("Testing the repair needs running water."),
    ADULT("Part and scope decisions are taken on site."),
  ]),
};

/** Conservative model assumptions the owner may override — each is tagged on the assignments it drives. */
export const ASSUMPTIONS: Record<string, string> = {
  A1: "Home-help services (dusting-wiping, sweeping-mopping, utensil-washing, hourly-bookings) are helper-style: the home's own supplies and tools are used. Over-preparing is the smaller harm than a professional arriving without a mop.",
  A2: "Plant-care repotting uses the customer's pot and potting mix, only if the customer wants a plant repotted.",
  A3: "Packing consumables (boxes, tape, wrap) are the customer's; no supply or charge flow exists in the app.",
};

/** Holds that are business follow-ups, not content defects. */
export const HOLDS: Array<{ kind: "COMMERCIAL_HOLD" | "SAFETY_HOLD"; services: string[]; what: string; unblockedBy: string }> = [
  { kind: "COMMERCIAL_HOLD", services: ["home-painting", "ac-service", "electrician", "plumbing"], what: "Paint, refrigerant gas and spare parts are truthfully shown as not included and confirmed on site, but the quote → customer approval → payment chain is not in the app.", unblockedBy: "Phase 09 commercial workflow (in-app quote + approval + payment), or an owner policy that on-site quotes are settled outside the app." },
  { kind: "SAFETY_HOLD", services: ["fasade-cleaning"], what: "No work-at-height method is defined. Only society permission and an on-site safety assessment are asserted; no equipment is guaranteed.", unblockedBy: "An owner-defined operational method (equipment, provider capability, scope) or a separate assessed-service category." },
];
