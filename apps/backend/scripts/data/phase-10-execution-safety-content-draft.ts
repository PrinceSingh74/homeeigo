/**
 * Phase 10 — execution, safety and quality content for the 31 live services.
 *
 *   STATUS: OWNER-REVIEWABLE DRAFT. Validated by scripts/phase10-content-validate.ts. NOT applied to any
 *   database. scripts/phase10-content-apply-plan.ts prints the diff and applies only slugs an owner has
 *   approved in writing (status DRAFT_FOR_OWNER_REVIEW + an owner-approval file bound to the content hash).
 *
 * Sources (nothing else is used):
 *   - the service's own name and the Phase 06 FINAL requirement content (scripts/data/phase-06-requirement-content-final.ts):
 *     requirement codes, who provides what, enforcement, partner instructions, commercial and safety holds;
 *   - the live export (31 ACTIVE services, 2026-09-24): included/excluded are empty for every service and
 *     materialPolicy/equipmentPolicy are unset, so responsibility is read from the Phase 06 assignments.
 *
 * Never asserted anywhere in this file: chemical names, formulations, dilutions or mixing; certifications,
 * licences, insurance or legal claims; medical advice; any work-at-height method; any electrical or gas
 * procedure beyond "isolate / do not proceed / escalate"; guarantees; durations or quantities.
 *
 * Status meaning:
 *   DRAFT_FOR_OWNER_REVIEW  — complete plan; ready for an owner's yes/no.
 *   OWNER_APPROVAL_REQUIRED — safe execution depends on a specialist/regulated procedure or on a commercial
 *                              decision nobody has made; ONLY the non-procedural steps (arrival, scope, stop
 *                              conditions, closeout) are drafted. openQuestions names the decision.
 *   SAFETY_HOLD             — no safe operational definition exists (work at height). Non-procedural steps only.
 *
 * `customerRequirements`, `providerRequirements` and `whatToPrepare` are DERIVED from the Phase 06 assignments
 * (customerNote / catalogue labels / partnerInstructions), so they cannot drift from, or contradict, who
 * provides what.
 */
import type { z } from "zod";
import type { executionStepSchema } from "../../src/lib/service-execution";
import { CATALOGUE, CONTENT, type ContentAssignment } from "./phase-06-requirement-content-final";

/**
 * draft.3 (2026-10-05) adds only DERIVED fields — nothing new is asserted by hand (see `enrich` at the
 * end of this file): service-level PPE (the union of the steps' own PPE), the product restriction (who
 * provides the products, from Phase 06), the incident protocol (the app's own reporting path), the
 * completion criteria (the shape of the plan and the proof decision), and — where a plan has exactly
 * one WORK step — that step's materials and equipment (the Phase 06 items of the service). Every
 * authored string of draft.2 is unchanged. A new version changes every content hash, so each service
 * needs the owner's approval again before it is applied.
 */
export const DRAFT_VERSION = "2026-10-05.draft.3";

export type DraftStatus = "DRAFT_FOR_OWNER_REVIEW" | "OWNER_APPROVAL_REQUIRED" | "SAFETY_HOLD";
export type DraftStep = z.input<typeof executionStepSchema>;
export type DraftSafety = {
  information?: string;
  warnings?: string[];
  prohibitedConditions?: string[];
  customerRequirements?: string[];
  providerRequirements?: string[];
  medicalDisclaimer?: string;
  emergencyProtocol?: string;
  /** Derived by `enrich` — never authored per service. */
  ppe?: string[];
  chemicalRestrictions?: string[];
  incidentProtocol?: string;
};
export type DraftQuality = { checklist: string[]; proofRequired: boolean; beforeAfterPhotos: boolean; /** Derived by `enrich`. */ completionCriteria?: string[] };
export type ServiceDraft = {
  status: DraftStatus;
  execution?: { steps: DraftStep[] };
  safety?: DraftSafety;
  quality?: DraftQuality;
  customerSummary: { whatHappens: string[]; whatToPrepare: string[]; whatIsNotIncluded: string[]; whenWeStop: string[] };
  openQuestions: string[];
};

/* ------------------------------------------------------------------ */
/* Shared wording                                                      */
/* ------------------------------------------------------------------ */

/** Open questions every service shares (the live export has `excluded: null` everywhere). */
export const GLOBAL_OPEN_QUESTIONS: string[] = [
  "Exclusions: the live service has no `excluded` list. Confirm the 'not included' lines drafted here, or supply the service's own exclusion list.",
  "Emergency protocol: confirm 112 as the emergency number shown to partners and customers, and name the Homeeigo escalation contact the app should show after an incident report.",
  "PPE: where this draft lists gloves, confirm that is the PPE rule for the service (no other PPE is asserted).",
];

const EMERGENCY =
  "If anyone is hurt or in immediate danger: stop work, move people away from the hazard and call 112. Then report what happened in the app so the Homeeigo safety team can follow up. Do not restart until the safety team clears the job.";

/** Concrete, observable stop conditions. Each one says what the partner does. */
const PC = {
  gas: "Gas smell at the property — stop work, move away from the area and report it in the app",
  wiring: "Exposed or damaged wiring at the work area — stop, do not touch it and report it in the app",
  sparks: "Smoke, a burning smell or sparks from a socket, switch or appliance — stop, keep away and report it in the app",
  waterOnElectrics: "Water reaching sockets, switches or plugged-in appliances — stop, keep away and report it in the app",
  threat: "Anyone at the property behaves in a threatening or abusive way — stop, leave safely and report it in the app",
  animal: "An animal at the work area cannot be kept away from you — stop and report it in the app",
  unknownContainers: "Unlabelled or leaking containers of unknown substances at the work area — stop, do not handle them and report it in the app",
  sharps: "Needles, broken glass or other sharp waste loose at the work area — stop handling it and report it in the app",
  structural: "Structural damage to the surface to be worked on (deep cracks, loose or falling pieces) — stop and report it in the app",
  improvisedHeight: "The work would need standing on furniture, a window ledge or anything other than a standard step ladder — stop that part and report it in the app",
  leaningOut: "Reaching the area would need leaning out of a window, over a railing or climbing outside — stop that part and report it in the app",
  railing: "A balcony railing, grill or parapet is loose, broken or missing — stop work on the balcony and report it in the app",
  infestation: "Signs of rodent or pest infestation at the work area — stop and report it in the app",
  mould: "Heavy mould growth over the area to be worked on — stop and report it in the app",
  noPermission: "Society or building-manager permission for the external work is not available on site — do not start and report it in the app",
  occupiedTreatmentArea: "People or pets remain in the rooms to be treated — do not start there and report it in the app",
  foodUncovered: "Food, utensils or pet bowls are left uncovered in the rooms to be treated — do not start there and report it in the app",
  wetFloorTraffic: "Standing water on the floor that cannot be cleared before walking on it — stop and report it in the app",
  applianceDamaged: "The appliance has a damaged plug, cable or door seal that exposes wiring — do not switch it on and report it in the app",
  spoiledFood: "Ingredients are spoiled or unsafe to handle — stop that dish and report it in the app",
  vehicleUnsafe: "The vehicle is parked where it is not safe to work around it (moving traffic, a slope without the brake set) — stop and report it in the app",
  allergyConflict: "The customer reports an allergy or skin reaction to a product the service needs — do not use it and report it in the app",
  bloodOrBodyFluids: "Blood, vomit or other bodily fluids on the surfaces to be cleaned — stop and report it in the app",
  circuitCannotBeIsolated: "The circuit for the work cannot be switched off at the switchboard — do not proceed and report it in the app",
  waterCannotBeShutOff: "The water supply for the work cannot be shut off at the valve — do not open any joint and report it in the app",
  accessUnsafe: "The only way to reach the work area is unsafe (no stable standing surface, no protection from a fall) — do not start that part and report it in the app",
} as const;

const COMMON = [PC.gas, PC.wiring, PC.sparks, PC.threat];

/* ------------------------------------------------------------------ */
/* Derivation from Phase 06 (single source of truth for who provides what) */
/* ------------------------------------------------------------------ */

const label = new Map(CATALOGUE.map((i) => [i.code, i.customerLabel]));
const kind = new Map(CATALOGUE.map((i) => [i.code, i.kind]));
const assignments = (slug: string): ContentAssignment[] => CONTENT[slug]?.assignments.filter((a) => a.active !== false) ?? [];

/** Professional-provided, included items → one "bring" line; partner instructions of enforced lines. */
function providerRequirementsFor(slug: string, extra: string[] = []): string[] {
  const a = assignments(slug);
  const bring = a.filter((x) => x.responsibility === "PROFESSIONAL" && x.charge === "INCLUDED").map((x) => label.get(x.itemCode) ?? x.itemCode);
  const quoted = a.filter((x) => x.charge === "SEPARATE_QUOTE").map((x) => label.get(x.itemCode) ?? x.itemCode);
  const out: string[] = [];
  if (bring.length) out.push(`Bring: ${bring.join(", ")}.`);
  if (quoted.length) out.push(`Not in the fixed price, confirm with the customer before use: ${quoted.join(", ")}.`);
  for (const x of a) if (x.partnerInstructions && x.partnerInstructions.length <= 300) out.push(x.partnerInstructions);
  return [...out, ...extra];
}
/** What the customer must do — the Phase 06 customer copy for their own lines. */
function customerRequirementsFor(slug: string): string[] {
  return assignments(slug)
    .filter((x) => x.responsibility === "CUSTOMER" && x.customerNote)
    .map((x) => x.customerNote!);
}
/** Separate-quote lines are, truthfully, not included. */
function quotedExclusions(slug: string): string[] {
  return assignments(slug)
    .filter((x) => x.charge === "SEPARATE_QUOTE")
    .map((x) => `${label.get(x.itemCode) ?? x.itemCode}: not in the base price — confirmed with you before use.`);
}
export const derivedResponsibility = (slug: string, k: "MATERIAL" | "EQUIPMENT") => {
  const rs = new Set(assignments(slug).filter((x) => kind.get(x.itemCode) === k).map((x) => x.responsibility));
  if (!rs.size) return "NOT_SPECIFIED" as const;
  if (rs.size > 1) return "MIXED" as const;
  return rs.has("CUSTOMER") ? ("CUSTOMER_PROVIDED" as const) : ("PROFESSIONAL_PROVIDED" as const);
};

/* ------------------------------------------------------------------ */
/* Step builder                                                        */
/* ------------------------------------------------------------------ */

type StepSpec = Omit<DraftStep, "sortOrder" | "dependsOn"> & { dependsOn?: string[] | null };
/** Sequential plan: each step depends on the previous one unless it says otherwise; sortOrder is positional. */
function plan(...specs: StepSpec[]): { steps: DraftStep[] } {
  const steps: DraftStep[] = [];
  specs.forEach((s, i) => {
    const prev = steps[i - 1];
    const { dependsOn, ...rest } = s;
    const dep = dependsOn === null ? undefined : dependsOn ?? (prev ? [prev.id] : undefined);
    steps.push({ ...rest, ...(dep && dep.length ? { dependsOn: dep } : {}), sortOrder: (i + 1) * 10 });
  });
  return { steps };
}

const CONFIRM_SCOPE = (description: string, evidence: DraftStep["evidence"] = "NONE"): StepSpec => ({
  id: "confirm-scope",
  title: "Confirm the booked scope with the customer",
  kind: "PREPARATION",
  description,
  evidence,
});
const CHECK_STOP = (description = "Look over the work area for the stop conditions listed for this job. If any is present, do not start: raise it as a prohibited condition in the app and wait for the safety team."): StepSpec => ({
  id: "check-stop-conditions",
  title: "Check the work area for stop conditions",
  kind: "SAFETY_CHECK",
  description,
});
const WALKTHROUGH = (description: string): StepSpec => ({
  id: "quality-walkthrough",
  title: "Walk through the result with the customer",
  kind: "QUALITY_CHECK",
  description,
});
const CLOSEOUT = (description: string): StepSpec => ({
  id: "closeout",
  title: "Pack up and leave the area tidy",
  kind: "CLOSEOUT",
  description,
});
const GLOVES = ["Gloves"];

function draft(d: Omit<ServiceDraft, "openQuestions"> & { openQuestions?: string[] }): ServiceDraft {
  return { ...d, openQuestions: [...(d.openQuestions ?? []), ...GLOBAL_OPEN_QUESTIONS] };
}
const safety = (slug: string, s: Omit<DraftSafety, "customerRequirements" | "providerRequirements" | "emergencyProtocol"> & { providerExtra?: string[] }): DraftSafety => {
  const { providerExtra, ...rest } = s;
  const customerRequirements = customerRequirementsFor(slug);
  return {
    ...rest,
    ...(customerRequirements.length ? { customerRequirements } : {}),
    providerRequirements: providerRequirementsFor(slug, providerExtra),
    emergencyProtocol: EMERGENCY,
  };
};
const prepare = (slug: string, extra: string[] = []) => [...customerRequirementsFor(slug), ...extra];

/* ------------------------------------------------------------------ */
/* The 31 services                                                     */
/* ------------------------------------------------------------------ */

const AUTHORED: Record<string, ServiceDraft> = {
  /* ── Home cleaning ───────────────────────────────────────────────── */
  "deep-cleaning": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Walk through the home with the customer. Agree the kitchen, bathrooms and living areas to be cleaned. Record any room that is locked, occupied or excluded before you start.", "NOTE"),
      CHECK_STOP(),
      { id: "clear-and-protect", title: "Set aside loose items and protect the floor near the work area", kind: "PREPARATION", description: "Move small loose items only with the customer's agreement. Do not move fragile or valuable items yourself — ask the customer." },
      { id: "high-surfaces", title: "Clean high surfaces first: fans, shelves, cobwebs", kind: "WORK", description: "Work top to bottom. Use only the standard step ladder; skip and record anything that cannot be reached from it.", ppe: GLOVES, warnings: ["Switch fans off at the wall and wait for the blades to stop before touching them."] },
      { id: "kitchen", title: "Clean the kitchen surfaces", kind: "WORK", description: "Counters, splash-back, cabinet fronts, sink and hob surroundings as agreed.", ppe: GLOVES, evidence: "BEFORE_AFTER_PHOTOS" },
      { id: "bathrooms", title: "Clean and descale the bathrooms", kind: "WORK", description: "Fittings, tiles, mirror, basin, toilet and floor.", ppe: GLOVES, evidence: "BEFORE_AFTER_PHOTOS", warnings: ["Keep the bathroom ventilated while you work."] },
      { id: "living-areas", title: "Clean the living areas and floors", kind: "WORK", description: "Dust and wipe surfaces, vacuum, then mop floors last so you work out of each room." },
      WALKTHROUGH("Show each room to the customer. Fix anything missed that is in scope. Tell them what was excluded and why."),
      CLOSEOUT("Collect your equipment, empty your bucket down a drain the customer points out, and leave floors dry to walk on."),
    ),
    safety: safety("deep-cleaning", {
      information: "A whole-home clean of the kitchen, bathrooms and living areas using the professional's products and equipment. The professional works top to bottom and room by room.",
      warnings: ["Floors may be wet after mopping — walk carefully until they dry.", "Keep children and pets out of the room being cleaned."],
      prohibitedConditions: [...COMMON, PC.waterOnElectrics, PC.improvisedHeight, PC.mould, PC.bloodOrBodyFluids, PC.unknownContainers],
    }),
    quality: {
      checklist: ["Every agreed room cleaned top to bottom", "Kitchen counters, sink and splash-back free of grease and residue", "Bathroom fittings and tiles free of visible scale and stains", "Floors vacuumed and mopped", "Excluded rooms or areas recorded and explained to the customer"],
      proofRequired: true,
      beforeAfterPhotos: true,
    },
    customerSummary: {
      whatHappens: ["We walk through the home with you and agree the rooms.", "We clean high surfaces first, then the kitchen, bathrooms and living areas, and mop floors last.", "We show you the result before we leave."],
      whatToPrepare: prepare("deep-cleaning"),
      whatIsNotIncluded: ["Rooms that are locked or occupied during the visit.", "Anything that cannot be reached safely from the floor or a standard step ladder."],
      whenWeStop: ["A gas smell, exposed wiring, sparks or water on electrics.", "Heavy mould, bodily fluids or unknown leaking containers in the work area.", "Any threat to the professional's safety."],
    },
  }),

  "bathroom-cleaning": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Confirm which bathroom(s) are booked and anything the customer wants prioritised."),
      CHECK_STOP(),
      { id: "clear-counters", title: "Check counters and shelves are clear", kind: "PREPARATION", description: "Ask the customer to move toiletries and personal items if they are still out. Do not throw anything away." },
      { id: "descale-and-clean", title: "Descale and clean fittings, tiles, basin and toilet", kind: "WORK", description: "Work from the top of the walls down to the floor. Follow the product label for every product you use.", ppe: GLOVES, evidence: "BEFORE_AFTER_PHOTOS", warnings: ["Keep the door or window open for ventilation while you work.", "Never combine different cleaning products."] },
      { id: "floor", title: "Clean and mop the floor", kind: "WORK", description: "Finish at the door so you do not walk over the cleaned floor." },
      WALKTHROUGH("Show the customer the fittings, tiles and floor. Point out any stain or damage that cleaning could not remove."),
      CLOSEOUT("Take away your equipment and leave the floor as dry as possible."),
    ),
    safety: safety("bathroom-cleaning", {
      information: "Descaling and sanitising of one bathroom's fittings, tiles, basin, toilet and floor with the professional's products.",
      warnings: ["The floor may be slippery after cleaning.", "Keep the bathroom ventilated while it is being cleaned."],
      prohibitedConditions: [...COMMON, PC.waterOnElectrics, PC.mould, PC.bloodOrBodyFluids, PC.structural, PC.unknownContainers],
    }),
    quality: {
      checklist: ["Taps, shower and fittings free of visible scale", "Tiles and grout lines wiped clean", "Basin, toilet and mirror clean", "Floor mopped", "Damage or permanent stains pointed out to the customer"],
      proofRequired: true,
      beforeAfterPhotos: true,
    },
    customerSummary: {
      whatHappens: ["We confirm the bathroom with you.", "We descale and clean fittings, tiles, basin and toilet, then mop the floor.", "We show you the result."],
      whatToPrepare: prepare("bathroom-cleaning"),
      whatIsNotIncluded: ["Repairs to taps, pipes, tiles or fittings.", "Stains or damage that cleaning cannot remove."],
      whenWeStop: ["Water reaching sockets or electrics, a gas smell or exposed wiring.", "Heavy mould, bodily fluids or loose broken tiles in the work area."],
    },
  }),

  "kitchen-cleaning": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Confirm the kitchen surfaces to be degreased: counters, splash-back, chimney exterior and floor."),
      CHECK_STOP(),
      { id: "clear-counters", title: "Check the counters are clear", kind: "PREPARATION", description: "Ask the customer to move utensils and groceries if they are still out." },
      { id: "isolate-appliances", title: "Make sure the hob and chimney are switched off", kind: "SAFETY_CHECK", description: "Ask the customer to switch off the hob and chimney. If the gas supply valve is within easy reach, ask the customer to close it. Do not work on or behind any gas fitting." },
      { id: "degrease", title: "Degrease counters, splash-back and the chimney exterior", kind: "WORK", description: "Clean the outside surfaces only. Follow the product label.", ppe: GLOVES, evidence: "BEFORE_AFTER_PHOTOS", warnings: ["Keep products away from food and open containers.", "Never combine different cleaning products."] },
      { id: "floor", title: "Clean the kitchen floor", kind: "WORK" },
      WALKTHROUGH("Show the customer the degreased surfaces and floor."),
      CLOSEOUT("Take away your equipment and remind the customer to switch appliances back on only once surfaces are dry."),
    ),
    safety: safety("kitchen-cleaning", {
      information: "Degreasing of kitchen counters, splash-back and the chimney exterior, plus the floor, with the professional's products.",
      warnings: ["Appliances stay switched off while their surroundings are cleaned.", "Keep food covered or put away during the clean."],
      prohibitedConditions: [...COMMON, PC.waterOnElectrics, PC.infestation, PC.unknownContainers],
    }),
    quality: {
      checklist: ["Counters and splash-back free of grease film", "Chimney exterior wiped clean", "Sink and taps clean", "Floor mopped"],
      proofRequired: true,
      beforeAfterPhotos: true,
    },
    customerSummary: {
      whatHappens: ["We confirm the surfaces with you and make sure the hob and chimney are off.", "We degrease counters, splash-back and the chimney exterior, then clean the floor.", "We show you the result."],
      whatToPrepare: prepare("kitchen-cleaning"),
      whatIsNotIncluded: ["Inside of the chimney, hob burners or appliances.", "Any work on gas pipes or fittings."],
      whenWeStop: ["A gas smell, sparks or exposed wiring.", "Signs of pest infestation or unknown leaking containers in the kitchen."],
    },
    openQuestions: ["Confirm that chimney INTERIOR / filter cleaning is out of scope (the Phase 06 rationale says 'chimney exterior')."],
  }),

  "kitchen-cabinet-cleaning": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Confirm which cabinets and drawers are included. Ask the customer to point out glassware and fragile items before you empty anything."),
      CHECK_STOP(),
      { id: "empty-cabinets", title: "Empty the cabinets and set the contents aside safely", kind: "PREPARATION", description: "Handle fragile items first and place them where they cannot be knocked over. Keep the contents of each cabinet together so they go back in the same place." },
      { id: "clean-cabinets", title: "Degrease cabinet interiors, shelves and fronts", kind: "WORK", description: "Follow the product label. Let surfaces dry before re-layering.", ppe: GLOVES, evidence: "BEFORE_AFTER_PHOTOS", warnings: ["Never combine different cleaning products."] },
      { id: "re-layer", title: "Put the contents back in place", kind: "WORK", description: "Return items to the same cabinet. Ask the customer if they want anything arranged differently." },
      WALKTHROUGH("Open the cabinets with the customer and confirm everything is back and nothing is damaged."),
      CLOSEOUT("Take away your equipment and waste."),
    ),
    safety: safety("kitchen-cabinet-cleaning", {
      information: "The professional empties, degreases and re-layers the kitchen cabinets and drawers.",
      warnings: ["Fragile items are handled first — please point them out."],
      prohibitedConditions: [...COMMON, PC.infestation, PC.unknownContainers, PC.sharps],
    }),
    quality: {
      checklist: ["Every agreed cabinet emptied and cleaned inside", "Shelves and fronts free of grease film", "Contents returned to their own cabinet", "No breakage — or any breakage reported in the app"],
      proofRequired: true,
      beforeAfterPhotos: true,
    },
    customerSummary: {
      whatHappens: ["We agree the cabinets with you and handle fragile items first.", "We empty, clean and dry each cabinet, then put everything back.", "We open the cabinets with you to check."],
      whatToPrepare: prepare("kitchen-cabinet-cleaning"),
      whatIsNotIncluded: ["Repairs to hinges, doors or shelves."],
      whenWeStop: ["Signs of pest infestation, unknown leaking containers or loose broken glass inside the cabinets.", "A gas smell, sparks or exposed wiring."],
    },
  }),

  "fridge-cleaning": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Confirm the fridge to be cleaned and whether it is already empty and switched off."),
      CHECK_STOP(),
      { id: "switch-off-and-empty", title: "Make sure the fridge is switched off and emptied", kind: "SAFETY_CHECK", description: "Ask the customer to switch it off at the wall and to take out the food, or help them do so. Do not clean a fridge that is still switched on.", warnings: ["Do not pull the fridge out from the wall."] },
      { id: "clean-inside-out", title: "Clean shelves, trays, interior walls and the outside", kind: "WORK", description: "Remove loose shelves and trays and clean them at the sink. Wipe up defrost water.", ppe: GLOVES, evidence: "BEFORE_AFTER_PHOTOS" },
      { id: "dry-and-refit", title: "Dry and refit shelves and trays", kind: "WORK" },
      WALKTHROUGH("Show the customer the cleaned fridge and remind them when they can switch it back on and restock."),
      CLOSEOUT("Leave the floor around the fridge dry."),
    ),
    safety: safety("fridge-cleaning", {
      information: "An inside-out clean of the fridge, with the defrost water wiped up.",
      warnings: ["Keep perishables in a cool bag while the fridge is off.", "The fridge stays switched off while it is cleaned."],
      prohibitedConditions: [...COMMON, PC.applianceDamaged, PC.waterOnElectrics],
    }),
    quality: {
      checklist: ["Shelves, trays and drawers clean and refitted", "Interior walls and door seal wiped clean", "Outside of the fridge wiped", "Floor around the fridge dry"],
      proofRequired: true,
      beforeAfterPhotos: true,
    },
    customerSummary: {
      whatHappens: ["We check the fridge is off and empty.", "We clean shelves, trays, the inside and the outside, and wipe up the defrost water.", "We refit everything and show you the result."],
      whatToPrepare: prepare("fridge-cleaning"),
      whatIsNotIncluded: ["Repairs, gas or cooling problems.", "Moving the fridge away from the wall."],
      whenWeStop: ["A damaged plug, cable or seal that exposes wiring.", "Water reaching the socket, sparks or a burning smell."],
    },
  }),

  "fan-cleaning": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Confirm the number of fans and which rooms they are in."),
      CHECK_STOP(),
      { id: "switch-off-fan", title: "Switch the fan off and wait for the blades to stop", kind: "SAFETY_CHECK", description: "Switch the fan off at its wall switch. Do not touch the blades until they have fully stopped. Do not open the fan's electrical housing." },
      { id: "cover-below", title: "Lay dust covers below the fan", kind: "PREPARATION", description: "Ask the customer to move delicate items that are directly below the fan." },
      { id: "clean-blades", title: "Degrease and wipe the blades and the outer body", kind: "WORK", description: "Use the standard step ladder on a flat, dry floor. Follow the product label.", ppe: GLOVES, evidence: "BEFORE_AFTER_PHOTOS", warnings: ["Do not stand on furniture.", "Do not bend or force the blades."] },
      WALKTHROUGH("Show the customer the cleaned fan. Let the customer switch it on to check it runs as before."),
      CLOSEOUT("Fold the dust covers inwards so no dust falls, and take them away."),
    ),
    safety: safety("fan-cleaning", {
      information: "Blade degrease of ceiling fans, with dust covers laid below each fan.",
      warnings: ["The fan stays switched off while it is cleaned.", "Keep children away from the step ladder."],
      prohibitedConditions: [...COMMON, PC.improvisedHeight, "The fan is loose, wobbling or its mounting looks damaged — do not clean it and report it in the app"],
    }),
    quality: {
      checklist: ["Every agreed fan's blades clean on both sides", "Outer body wiped", "No dust left on the floor or furniture below", "Fan switched on by the customer and running as before"],
      proofRequired: true,
      beforeAfterPhotos: true,
    },
    customerSummary: {
      whatHappens: ["We switch the fan off and lay covers below it.", "We degrease and wipe the blades and the outer body from a step ladder.", "You switch the fan on to check it."],
      whatToPrepare: prepare("fan-cleaning"),
      whatIsNotIncluded: ["Electrical repairs, noise or speed problems.", "Fans that cannot be reached from a standard step ladder."],
      whenWeStop: ["A loose or wobbling fan, exposed wiring, or sparks.", "A fan that can only be reached by standing on furniture."],
    },
  }),

  "sofa-deep-cleaning": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Confirm the sofa(s) and number of seats. Check the fabric care label with the customer; if there is no label, agree a small hidden test spot first."),
      CHECK_STOP(),
      { id: "vacuum", title: "Vacuum the sofa, cushions and crevices", kind: "WORK" },
      { id: "shampoo", title: "Shampoo and sanitise the upholstery", kind: "WORK", description: "Use the upholstery machine as its manufacturer's instructions say. Follow the product label. Stop if the fabric bleeds colour on the test spot.", ppe: GLOVES, evidence: "BEFORE_AFTER_PHOTOS", warnings: ["Keep the machine cable away from the wet area."] },
      WALKTHROUGH("Show the customer the result and point out any stain that did not lift."),
      CLOSEOUT("Tell the customer the sofa needs drying time before use and to keep the room ventilated. Take away your equipment."),
    ),
    safety: safety("sofa-deep-cleaning", {
      information: "Vacuum, shampoo and sanitise the sofa upholstery with the professional's machine and products.",
      warnings: ["The sofa stays damp for a while — keep it unused until it is dry.", "Keep children and pets away from the machine and cables."],
      prohibitedConditions: [...COMMON, PC.waterOnElectrics, PC.infestation, PC.bloodOrBodyFluids],
    }),
    quality: {
      checklist: ["All agreed seats vacuumed and shampooed", "No soap residue left on the surface", "Stains that did not lift pointed out", "Drying advice given"],
      proofRequired: true,
      beforeAfterPhotos: true,
    },
    customerSummary: {
      whatHappens: ["We check the fabric with you.", "We vacuum, then shampoo and sanitise the upholstery.", "We show you the result and tell you how to let it dry."],
      whatToPrepare: prepare("sofa-deep-cleaning"),
      whatIsNotIncluded: ["Repairs to fabric, springs or frames.", "Stains or colour loss that cleaning cannot remove."],
      whenWeStop: ["Signs of bed bugs or other pests in the sofa.", "Water reaching sockets, exposed wiring or sparks."],
    },
  }),

  "carpet-shampooing": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Confirm the carpets or rugs to be shampooed and any stains the customer wants looked at."),
      CHECK_STOP(),
      { id: "clear-carpet", title: "Check the carpet is clear of furniture and items", kind: "PREPARATION", description: "Help move only light items with the customer's agreement." },
      { id: "vacuum", title: "Vacuum the carpet", kind: "WORK" },
      { id: "shampoo", title: "Machine-shampoo the carpet and treat stains", kind: "WORK", description: "Use the carpet machine as its manufacturer's instructions say and follow the product label. Try stain treatment on a hidden corner first.", ppe: GLOVES, evidence: "BEFORE_AFTER_PHOTOS", warnings: ["Keep the machine cable away from the wet area."] },
      WALKTHROUGH("Show the customer the result and point out any stain that did not lift."),
      CLOSEOUT("Tell the customer the carpet needs drying time and ventilation. Take away your equipment."),
    ),
    safety: safety("carpet-shampooing", {
      information: "Machine shampoo and stain treatment of carpets and rugs.",
      warnings: ["The carpet stays damp for a while — avoid walking on it until dry.", "Keep children and pets away from the machine and cables."],
      prohibitedConditions: [...COMMON, PC.waterOnElectrics, PC.infestation, PC.sharps],
    }),
    quality: {
      checklist: ["Whole agreed carpet area vacuumed and shampooed", "Treated stains checked with the customer", "No soap residue left", "Drying advice given"],
      proofRequired: true,
      beforeAfterPhotos: true,
    },
    customerSummary: {
      whatHappens: ["We agree the carpets with you.", "We vacuum, then machine-shampoo and treat stains.", "We show you the result and explain drying."],
      whatToPrepare: prepare("carpet-shampooing"),
      whatIsNotIncluded: ["Moving heavy furniture.", "Stains, burns or colour loss that cleaning cannot remove."],
      whenWeStop: ["Water reaching sockets, exposed wiring or sparks.", "Signs of pests or sharp objects in the carpet."],
    },
  }),

  "mattress-sanitization": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Confirm the mattress(es) and that sheets, covers and protectors are off."),
      CHECK_STOP(),
      { id: "vacuum", title: "Deep-vacuum both sides of the mattress", kind: "WORK", description: "Get help from the customer to turn a heavy mattress; do not lift it alone." },
      { id: "uv-treatment", title: "Run the UV sanitising unit over the mattress", kind: "WORK", description: "Operate the UV unit only as its manufacturer's instructions say.", evidence: "BEFORE_AFTER_PHOTOS", warnings: ["Follow the UV unit manufacturer's instructions on who may stay in the room while it runs."] },
      WALKTHROUGH("Show the customer the mattress."),
      CLOSEOUT("Empty the vacuum waste into a bag and take it away."),
    ),
    safety: safety("mattress-sanitization", {
      information: "Deep vacuum and UV treatment of mattresses. No products are used.",
      warnings: ["Please follow the professional's instructions on staying out of the room while the UV unit is on."],
      prohibitedConditions: [...COMMON, PC.infestation, PC.bloodOrBodyFluids],
    }),
    quality: {
      checklist: ["Both sides of each agreed mattress vacuumed", "UV treatment run over the whole surface", "Vacuum waste taken away"],
      proofRequired: true,
      beforeAfterPhotos: true,
    },
    customerSummary: {
      whatHappens: ["We check the bed is stripped.", "We deep-vacuum both sides and run the UV unit over the mattress.", "We show you the mattress and take the dust away."],
      whatToPrepare: prepare("mattress-sanitization"),
      whatIsNotIncluded: ["Washing sheets, covers or protectors.", "Stains that vacuuming and UV treatment cannot remove."],
      whenWeStop: ["Signs of bed bugs or other pests.", "Bodily fluids on the mattress, exposed wiring or sparks."],
    },
    openQuestions: ["UV unit: confirm the operating rule shown to partners and customers (who may stay in the room while it runs). The draft only says 'as the manufacturer's instructions say'."],
  }),

  "wardrobe-cleaning": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Confirm which wardrobes are included, how the customer wants things arranged, and what can be set aside for donation."),
      CHECK_STOP(),
      { id: "confirm-valuables-removed", title: "Confirm valuables, cash and documents are out", kind: "SAFETY_CHECK", description: "Ask the customer to confirm before you open the wardrobe. Do not proceed otherwise.", safetyRequirement: "wardrobe-valuables-removed" },
      { id: "declutter", title: "Take out the contents and sort them with the customer", kind: "WORK", description: "Only the customer decides what is kept, moved or set aside. Never discard anything yourself." },
      { id: "clean-wardrobe", title: "Vacuum and wipe the wardrobe inside", kind: "WORK", description: "Let the surfaces dry before putting items back.", ppe: GLOVES, evidence: "BEFORE_AFTER_PHOTOS" },
      { id: "reorganise", title: "Re-organise the contents as the customer asked", kind: "WORK" },
      WALKTHROUGH("Show the customer the arrangement and anything set aside."),
      CLOSEOUT("Leave set-aside items where the customer asked and take away your equipment."),
    ),
    safety: safety("wardrobe-cleaning", {
      information: "Declutter, clean and re-organise wardrobes. Valuables are confirmed out before the wardrobe is opened.",
      warnings: ["Only you decide what is kept, moved or set aside."],
      prohibitedConditions: [...COMMON, PC.infestation, PC.mould],
    }),
    quality: {
      checklist: ["Valuables confirmed out before starting", "Wardrobe interior vacuumed and wiped", "Contents arranged as the customer asked", "Set-aside items handed over as agreed"],
      proofRequired: true,
      beforeAfterPhotos: true,
    },
    customerSummary: {
      whatHappens: ["You confirm valuables are out.", "We sort the contents with you, clean the wardrobe and re-organise it your way.", "We show you the result."],
      whatToPrepare: prepare("wardrobe-cleaning"),
      whatIsNotIncluded: ["Washing or ironing clothes.", "Taking away items for donation or disposal."],
      whenWeStop: ["Valuables are still inside and cannot be removed.", "Signs of pests or heavy mould inside the wardrobe."],
    },
    openQuestions: ["The live service duration is 4320 minutes — confirm this is intended for a wardrobe clean (not changed by this draft)."],
  }),

  "window-cleaning": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Walk through each window with the customer. Agree which glass, tracks and grills can be reached safely from inside. Record any window or face that is excluded.", "NOTE"),
      CHECK_STOP(),
      { id: "assess-reach", title: "Confirm every window to be cleaned is reachable from inside", kind: "SAFETY_CHECK", description: "Do not lean out or climb outside. Exclude any glass that cannot be reached safely from inside and tell the customer.", safetyRequirement: "windows-reachable-from-inside" },
      { id: "clean-glass", title: "Clean the glass, frames, tracks and grills from inside", kind: "WORK", description: "Use the standard step ladder only on a flat, dry floor. Follow the product label.", ppe: GLOVES, evidence: "BEFORE_AFTER_PHOTOS", warnings: ["Never sit or stand on a window ledge."] },
      WALKTHROUGH("Show the customer each window and repeat which faces were excluded."),
      CLOSEOUT("Wipe up drips from sills and floors and take away your equipment."),
    ),
    safety: safety("window-cleaning", {
      information: "Glass, tracks and grills for windows that can be reached safely from inside. High or exterior glass is assessed on arrival and is left out if it cannot be reached safely.",
      warnings: ["Keep children away from open windows during the clean."],
      prohibitedConditions: [...COMMON, PC.leaningOut, PC.improvisedHeight, "Cracked or loose window glass — do not clean that pane and report it in the app"],
    }),
    quality: {
      checklist: ["Agreed glass clean and streak-free", "Tracks and grills cleaned", "Excluded windows or faces recorded and explained", "Sills and floor dry"],
      proofRequired: true,
      beforeAfterPhotos: true,
    },
    customerSummary: {
      whatHappens: ["We check each window with you and agree what can be reached safely from inside.", "We clean the glass, frames, tracks and grills.", "We show you the result and what was left out."],
      whatToPrepare: prepare("window-cleaning"),
      whatIsNotIncluded: ["Glass that cannot be reached safely from inside.", "Any work from outside the building."],
      whenWeStop: ["A window can only be reached by leaning out, climbing, or standing on a ledge or furniture.", "Cracked or loose glass."],
    },
  }),

  "balcony-cleaning": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Confirm the balcony floor, railing and glass to be cleaned."),
      CHECK_STOP("Check the railing, grill and floor before starting. If the railing is loose or the floor is damaged, do not start: raise it as a prohibited condition in the app."),
      { id: "clear-floor", title: "Check the floor is clear of plants and loose items", kind: "PREPARATION" },
      { id: "clean-railing-and-glass", title: "Clean the railing and glass from the balcony side", kind: "WORK", description: "Clean only what you can reach while standing on the balcony floor. Follow the product label.", ppe: GLOVES, warnings: ["Never lean over the railing or climb on it."] },
      { id: "clean-floor", title: "Clean and rinse the floor", kind: "WORK", description: "Check the drain is clear first so water does not collect. Do not let water run off the edge.", evidence: "BEFORE_AFTER_PHOTOS" },
      WALKTHROUGH("Show the customer the balcony."),
      CLOSEOUT("Take away your equipment and waste."),
    ),
    safety: safety("balcony-cleaning", {
      information: "Floor, railing and glass of the balcony, cleaned from the balcony side only.",
      warnings: ["Keep children away from the balcony while it is being cleaned."],
      prohibitedConditions: [...COMMON, PC.railing, PC.leaningOut, PC.structural, PC.waterOnElectrics],
    }),
    quality: {
      checklist: ["Floor cleaned end to end", "Railing wiped", "Glass clean on the balcony side", "No standing water left"],
      proofRequired: true,
      beforeAfterPhotos: true,
    },
    customerSummary: {
      whatHappens: ["We check the railing and floor.", "We clean the railing and glass from the balcony side, then the floor.", "We show you the result."],
      whatToPrepare: prepare("balcony-cleaning"),
      whatIsNotIncluded: ["The outer face of railings or glass that cannot be reached from the balcony floor."],
      whenWeStop: ["A loose or broken railing or grill.", "Cracks or loose pieces in the balcony floor or parapet."],
    },
  }),

  /* ── Home help (the home's own supplies and tools) ───────────────── */
  "dusting-wiping": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Agree the rooms and surfaces with the customer. Ask which of the home's supplies to use and which delicate items should not be moved."),
      CHECK_STOP(),
      { id: "dust-and-wipe", title: "Dust and wipe the agreed surfaces", kind: "WORK", description: "Work top to bottom with the home's supplies. Do not move delicate décor the customer pointed out.", ppe: GLOVES },
      WALKTHROUGH("Show the customer the rooms you covered."),
      CLOSEOUT("Put the home's supplies back where you found them."),
    ),
    safety: safety("dusting-wiping", {
      information: "Dusting and wiping with your home's own supplies.",
      warnings: ["Surfaces that cannot be reached from the floor or a standard step ladder are left, not climbed to.", "Point out delicate items that must not be moved before work starts."],
      prohibitedConditions: [...COMMON, PC.improvisedHeight, PC.unknownContainers],
    }),
    quality: { checklist: ["Agreed surfaces dusted and wiped", "Delicate items left in place", "Supplies put back"], proofRequired: false, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We agree the rooms and surfaces with you.", "We dust and wipe them using your supplies.", "We show you what we covered."],
      whatToPrepare: prepare("dusting-wiping"),
      whatIsNotIncluded: ["Cleaning products or tools — your own are used.", "Surfaces that cannot be reached from the floor."],
      whenWeStop: ["A gas smell, exposed wiring or sparks.", "Unknown leaking containers in the work area."],
    },
  }),

  "sweeping-mopping": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Agree the rooms with the customer and ask for the broom, mop, bucket and floor supplies to use."),
      CHECK_STOP(),
      { id: "sweep", title: "Sweep the agreed floors", kind: "WORK", description: "Ask before moving cables or small items off the floor." },
      { id: "mop", title: "Mop the agreed floors", kind: "WORK", description: "Work towards the door so you do not walk over wet floor.", ppe: GLOVES },
      WALKTHROUGH("Show the customer the floors and warn them if any are still wet."),
      CLOSEOUT("Empty the bucket where the customer points out and put the tools back."),
    ),
    safety: safety("sweeping-mopping", {
      information: "Sweeping and mopping with your home's own tools and supplies.",
      warnings: ["Floors are slippery while wet."],
      prohibitedConditions: [...COMMON, PC.waterOnElectrics, PC.sharps],
    }),
    quality: { checklist: ["Agreed floors swept", "Agreed floors mopped", "Customer told which floors are still wet", "Tools put back"], proofRequired: false, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We agree the rooms with you.", "We sweep, then mop, using your tools and supplies.", "We show you the floors."],
      whatToPrepare: prepare("sweeping-mopping"),
      whatIsNotIncluded: ["Cleaning tools or products — your own are used."],
      whenWeStop: ["Water reaching sockets, exposed wiring or sparks.", "Loose broken glass or needles on the floor."],
    },
  }),

  "utensil-washing": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Agree which utensils to wash and where they go afterwards. Ask for the dishwashing liquid and scrubber to use."),
      CHECK_STOP(),
      { id: "wash", title: "Wash and rinse the utensils", kind: "WORK", description: "Handle glass and sharp knives one at a time. Ask the customer before washing anything delicate or non-stick.", ppe: GLOVES, warnings: ["Keep water away from sockets near the sink."] },
      { id: "dry-and-shelve", title: "Dry and put the utensils away", kind: "WORK" },
      WALKTHROUGH("Show the customer the washed utensils and the sink area."),
      CLOSEOUT("Wipe the sink and counter and put the supplies back."),
    ),
    safety: safety("utensil-washing", {
      information: "Sink-to-shelf utensil washing with your kitchen's own supplies.",
      warnings: ["Keep water away from sockets near the sink.", "Glass and sharp knives are washed one at a time; point out anything delicate or non-stick before washing starts."],
      prohibitedConditions: [...COMMON, PC.waterOnElectrics, PC.sharps],
    }),
    quality: { checklist: ["Agreed utensils washed and rinsed", "Utensils dried and put away", "Sink and counter wiped"], proofRequired: false, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We agree what to wash with you.", "We wash, rinse, dry and put the utensils away with your supplies.", "We leave the sink area clean."],
      whatToPrepare: prepare("utensil-washing"),
      whatIsNotIncluded: ["Dishwashing supplies — your own are used.", "Cleaning appliances or the kitchen itself."],
      whenWeStop: ["Water reaching sockets, sparks or exposed wiring near the sink."],
    },
  }),

  "kitchen-prep": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Confirm the menu, recipes and quantities with the customer. Ask about food allergies at home and write down the ingredients to avoid.", "NOTE"),
      CHECK_STOP(),
      { id: "hygiene", title: "Wash hands and put on gloves and hair cover", kind: "PREPARATION", ppe: ["Food-safe gloves", "Hair cover"] },
      { id: "check-ingredients", title: "Check the ingredients laid out", kind: "SAFETY_CHECK", description: "Look for spoiled ingredients. Tell the customer about anything that looks spoiled before using it." },
      { id: "prep", title: "Chop, marinate and prepare as the customer asked", kind: "WORK", description: "Follow the customer's menu. Keep ingredients the customer is allergic to away from the other food and boards.", warnings: ["Handle knives with care and keep them away from the counter edge."] },
      WALKTHROUGH("Show the customer the prepared food and where it is stored."),
      CLOSEOUT("Clean the boards and counter you used and put the kitchen tools back."),
    ),
    safety: safety("kitchen-prep", {
      information: "Chopping, marination and meal prep with your ingredients, recipes and kitchen tools.",
      warnings: ["Tell the helper about every food allergy at home before work starts."],
      prohibitedConditions: [...COMMON, PC.spoiledFood, PC.infestation],
      medicalDisclaimer: "The helper avoids the ingredients you tell them about. The helper does not give medical or dietary advice.",
    }),
    quality: { checklist: ["Menu and quantities confirmed before starting", "Allergy ingredients kept separate", "Food prepared as asked and stored where the customer said", "Work surfaces cleaned"], proofRequired: false, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We confirm the menu and any food allergies with you.", "We prepare the food as you asked, using your ingredients and kitchen tools.", "We clean up the counter we used."],
      whatToPrepare: prepare("kitchen-prep"),
      whatIsNotIncluded: ["Ingredients or groceries.", "Cooking full meals unless you asked for it in the booking."],
      whenWeStop: ["Ingredients are spoiled or unsafe.", "A gas smell, sparks or exposed wiring in the kitchen."],
    },
    openQuestions: ["Confirm whether full cooking (not only prep) is in scope; the Phase 06 rationale says 'chopping, marination and meal prep'."],
  }),

  "packing-unpacking": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Agree which rooms to pack or unpack first. Check there is enough packing material."),
      CHECK_STOP(),
      { id: "fragile-identified", title: "Confirm fragile and high-value items are identified and labelled", kind: "SAFETY_CHECK", description: "Do not start packing until the customer has shown you fragile and high-value items.", safetyRequirement: "fragile-items-identified" },
      { id: "pack", title: "Pack or unpack room by room", kind: "WORK", description: "Wrap fragile items first. Label each box with its room and contents. Keep boxes to a weight you can lift safely.", warnings: ["Lift with bent knees; get help for anything heavy.", "Keep walkways and doors clear of boxes."] },
      WALKTHROUGH("Go through the packed or unpacked rooms with the customer and confirm the fragile items."),
      CLOSEOUT("Stack boxes where the customer asked and gather leftover packing waste."),
    ),
    safety: safety("packing-unpacking", {
      information: "Careful packing or unpacking help with your packing material; fragile items are handled first.",
      warnings: ["Keep walkways clear of boxes."],
      prohibitedConditions: [...COMMON, PC.sharps, PC.unknownContainers],
    }),
    quality: { checklist: ["Fragile items wrapped first", "Every box labelled with room and contents", "Boxes stacked where the customer asked", "Walkways left clear"], proofRequired: false, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We agree the order with you and you show us fragile items.", "We pack or unpack room by room and label every box.", "We stack the boxes where you want them."],
      whatToPrepare: prepare("packing-unpacking"),
      whatIsNotIncluded: ["Boxes, wrap or tape — your own are used.", "Moving or transporting the boxes."],
      whenWeStop: ["Unknown leaking containers or sharp waste among the items.", "A gas smell, sparks or exposed wiring."],
    },
  }),

  "hourly-bookings": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Ask for the customer's task list and the supplies and tools available. Agree the order of tasks.", "NOTE"),
      CHECK_STOP(),
      { id: "tasks", title: "Work through the customer's task list in order", kind: "WORK", description: "Do the most important tasks first. Ask before any task that needs products or tools the home does not have." },
      WALKTHROUGH("Go through the list with the customer and say which tasks were done and which were not."),
      CLOSEOUT("Put the home's supplies and tools back."),
    ),
    safety: safety("hourly-bookings", {
      information: "A professional by the hour. You set the agenda; your home's supplies and tools are used.",
      warnings: ["A task that needs climbing on furniture, or work near exposed wiring, gas or water on electrics, is stopped, not attempted.", "Repairs, electrical, plumbing and gas work are not part of an hourly booking."],
      prohibitedConditions: [...COMMON, PC.improvisedHeight, PC.waterOnElectrics, PC.unknownContainers],
    }),
    quality: { checklist: ["Task list agreed at the start", "Tasks done in the customer's order", "Tasks not done named to the customer"], proofRequired: false, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["You give us your task list.", "We work through it in your order using your supplies and tools.", "We tell you what was done."],
      whatToPrepare: prepare("hourly-bookings"),
      whatIsNotIncluded: ["Cleaning products or tools — your own are used.", "Repairs, electrical, plumbing or gas work."],
      whenWeStop: ["A task that needs climbing on furniture, or work near exposed wiring, gas or water on electrics."],
    },
    openQuestions: ["Confirm the list of task types an hourly professional may accept (the service description says only 'you set the agenda')."],
  }),

  /* ── Laundry & fabric (pickup-based) ─────────────────────────────── */
  laundry: draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Count the items with the customer at pickup and note delicate or special-care items and empty pockets.", "NOTE"),
      CHECK_STOP("Check the bag at pickup. If it contains sharp objects, unknown substances or soiled items that are unsafe to handle, do not take it: raise it in the app."),
      { id: "pickup-photo", title: "Photograph the items at pickup", kind: "PREPARATION", evidence: "PHOTO" },
      { id: "wash-dry-fold", title: "Wash, dry and fold following each care label", kind: "WORK", description: "Keep this customer's items separate from others. Follow the care labels; set aside any item you are unsure about and ask the customer." },
      { id: "count-at-return", title: "Count the items again at return", kind: "QUALITY_CHECK", description: "Count with the customer and hand over. Report any mismatch in the app.", evidence: "NOTE" },
      CLOSEOUT("Hand over the folded items and confirm the count with the customer."),
    ),
    safety: safety("laundry", {
      information: "Wash, dry and fold, collected and returned. Washing happens at the laundry facility.",
      warnings: ["Empty the pockets before pickup; a bag with sharp objects, bodily fluids or unknown substances is not taken.", "Items you are unsure about are set aside and you are asked before they are washed."],
      prohibitedConditions: [PC.threat, PC.sharps, PC.bloodOrBodyFluids, PC.unknownContainers],
    }),
    quality: { checklist: ["Items counted at pickup and at return", "Care labels followed", "Items folded and returned together"], proofRequired: true, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We count your items with you at pickup.", "We wash, dry and fold them following the care labels.", "We count them again with you when we return them."],
      whatToPrepare: prepare("laundry"),
      whatIsNotIncluded: ["Dry-clean-only items unless agreed.", "Stains or damage that washing cannot remove."],
      whenWeStop: ["Sharp objects, bodily fluids or unknown substances in the laundry."],
    },
    openQuestions: ["Confirm how dry-clean-only items are handled (refused, or a separate service)."],
  }),

  "ironing-folding": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Count the garments with the customer at pickup and note delicate fabrics.", "NOTE"),
      CHECK_STOP("Check the garments at pickup. If they contain sharp objects or are soiled in a way that is unsafe to handle, do not take them: raise it in the app."),
      { id: "pickup-photo", title: "Photograph the garments at pickup", kind: "PREPARATION", evidence: "PHOTO" },
      { id: "iron-fold", title: "Steam-iron and fold following each care label", kind: "WORK", description: "Set aside any garment whose care label says not to iron, and tell the customer." },
      { id: "count-at-return", title: "Count the garments again at return", kind: "QUALITY_CHECK", description: "Count with the customer and hand over. Report any mismatch in the app.", evidence: "NOTE" },
      CLOSEOUT("Hand over the ironed garments and confirm the count with the customer."),
    ),
    safety: safety("ironing-folding", {
      information: "Steam ironing and folding, collected and returned. Ironing happens at the facility.",
      warnings: ["Empty the pockets before pickup; garments with sharp objects or bodily fluids are not taken.", "Garments whose care label says not to iron are set aside and returned unironed."],
      prohibitedConditions: [PC.threat, PC.sharps, PC.bloodOrBodyFluids],
    }),
    quality: { checklist: ["Garments counted at pickup and at return", "Care labels followed", "Garments ironed and folded"], proofRequired: true, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We count your garments with you at pickup.", "We steam-iron and fold them following the care labels.", "We count them again with you when we return them."],
      whatToPrepare: prepare("ironing-folding"),
      whatIsNotIncluded: ["Washing.", "Garments whose care label says not to iron."],
      whenWeStop: ["Sharp objects or bodily fluids on the garments."],
    },
  }),

  /* ── Event & occasion ────────────────────────────────────────────── */
  "pre-party-express-clean": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Ask which rooms the guests will use and agree the order: those rooms first."),
      CHECK_STOP(),
      { id: "guest-rooms", title: "Refresh the guest rooms first", kind: "WORK", description: "Dust and wipe visible surfaces, vacuum and mop.", ppe: GLOVES, evidence: "BEFORE_AFTER_PHOTOS" },
      { id: "guest-bathroom", title: "Refresh the guest bathroom", kind: "WORK", description: "Basin, toilet, mirror and floor. Follow the product label.", ppe: GLOVES },
      WALKTHROUGH("Show the customer the refreshed rooms."),
      CLOSEOUT("Take away your equipment and leave floors dry for guests."),
    ),
    safety: safety("pre-party-express-clean", {
      information: "A quick whole-home refresh before guests, with the rooms guests will use done first.",
      warnings: ["Floors may be wet for a short while after mopping."],
      prohibitedConditions: [...COMMON, PC.waterOnElectrics, PC.unknownContainers],
    }),
    quality: { checklist: ["Guest rooms refreshed first", "Guest bathroom clean", "Floors dry before handover"], proofRequired: true, beforeAfterPhotos: true },
    customerSummary: {
      whatHappens: ["You tell us the rooms your guests will use.", "We refresh those rooms and the guest bathroom first.", "We show you the result."],
      whatToPrepare: prepare("pre-party-express-clean"),
      whatIsNotIncluded: ["Deep cleaning of rooms guests will not use, if time runs out."],
      whenWeStop: ["A gas smell, sparks, exposed wiring or water on electrics."],
    },
  }),

  "after-party-express-clean": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Agree the rooms with the customer. Confirm that leftover food and valuables they want to keep are put away."),
      CHECK_STOP(),
      { id: "collect-trash", title: "Collect trash into garbage bags", kind: "WORK", description: "Ask before throwing away anything that is not clearly waste. Handle bottles and glass carefully.", ppe: GLOVES, warnings: ["Do not push waste down into a bag with your hands."] },
      { id: "dishes", title: "Wash the party dishes", kind: "WORK" },
      { id: "floors", title: "Clean the floors", kind: "WORK", evidence: "BEFORE_AFTER_PHOTOS" },
      WALKTHROUGH("Show the customer the rooms."),
      CLOSEOUT("Leave the garbage bags where the customer or building asks for waste."),
    ),
    safety: safety("after-party-express-clean", {
      information: "Post-event cleanup: trash, dishes and floors.",
      warnings: ["Anything left out is treated as waste or clutter — please put away what you want to keep."],
      prohibitedConditions: [...COMMON, PC.sharps, PC.bloodOrBodyFluids, PC.waterOnElectrics],
    }),
    quality: { checklist: ["Trash collected and bagged", "Dishes washed", "Floors cleaned", "Bags left where the customer asked"], proofRequired: true, beforeAfterPhotos: true },
    customerSummary: {
      whatHappens: ["We agree the rooms with you.", "We collect trash, wash the dishes and clean the floors.", "We leave the bags where you ask."],
      whatToPrepare: prepare("after-party-express-clean"),
      whatIsNotIncluded: ["Taking waste away from the building."],
      whenWeStop: ["Broken glass or needles loose in the rooms, or bodily fluids on surfaces.", "A gas smell, sparks or exposed wiring."],
    },
  }),

  /* ── Vehicle care ────────────────────────────────────────────────── */
  "car-surface-cleaning": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Confirm the car and that washing is allowed where it is parked. Ask the customer to take valuables out of the car."),
      CHECK_STOP("Check the car is parked safely, away from moving traffic, with the engine off and the parking brake set. If not, do not start: raise it in the app."),
      { id: "note-existing-damage", title: "Photograph existing scratches and dents", kind: "PREPARATION", description: "Walk round the car with the customer and photograph any existing damage.", evidence: "PHOTO" },
      { id: "exterior", title: "Wash and polish the exterior", kind: "WORK", description: "Follow the product labels.", ppe: GLOVES, evidence: "BEFORE_AFTER_PHOTOS" },
      { id: "interior", title: "Vacuum and wipe the interior", kind: "WORK", description: "Do not move or open the customer's personal items." },
      WALKTHROUGH("Walk round the car with the customer."),
      CLOSEOUT("Clear water and waste from the parking spot and take away your equipment."),
    ),
    safety: safety("car-surface-cleaning", {
      information: "Doorstep exterior wash, polish and interior vacuum.",
      warnings: ["Keep the car's engine off during the clean."],
      prohibitedConditions: [PC.threat, PC.vehicleUnsafe, PC.waterOnElectrics, PC.sharps, "Fuel leaking from the vehicle — stop, keep away and report it in the app"],
    }),
    quality: { checklist: ["Existing damage photographed before starting", "Exterior washed and polished", "Interior vacuumed and wiped", "Parking spot left clean"], proofRequired: true, beforeAfterPhotos: true },
    customerSummary: {
      whatHappens: ["We check the car is parked where washing is allowed and photograph existing marks.", "We wash and polish the outside, then vacuum and wipe the inside.", "We walk round the car with you."],
      whatToPrepare: prepare("car-surface-cleaning"),
      whatIsNotIncluded: ["Engine bay cleaning, paint repair or scratch removal."],
      whenWeStop: ["The car is parked unsafely or fuel is leaking."],
    },
  }),

  /* ── Specialised care — OWNER APPROVAL REQUIRED ──────────────────── */
  "pest-control": draft({
    status: "OWNER_APPROVAL_REQUIRED",
    execution: plan(
      CONFIRM_SCOPE("Confirm the pest type and the rooms to be treated. Confirm the customer's preparation: food, utensils and pet bowls covered; people and pets away from the rooms to be treated.", "NOTE"),
      { ...CHECK_STOP(), safetyRequirement: "pest-treatment-preparation" },
      WALKTHROUGH("Tell the customer which rooms were treated and the re-entry advice for the product used, per its label."),
      CLOSEOUT("Take away all containers and equipment. Leave nothing behind in the home."),
    ),
    safety: safety("pest-control", {
      information: "Pest treatment of the agreed rooms. Products are applied as their label says; the professional tells you the re-entry time for the product used.",
      warnings: ["Keep people and pets away from treated rooms for the time the professional advises.", "Tell us in advance if anyone at home is pregnant, an infant, elderly, or has breathing conditions or allergies."],
      prohibitedConditions: [...COMMON, PC.occupiedTreatmentArea, PC.foodUncovered, PC.unknownContainers],
      medicalDisclaimer: "The professional does not give medical advice. If anyone feels unwell after the treatment, contact a doctor and tell us in the app.",
    }),
    quality: { checklist: ["Preparation confirmed before starting", "Only agreed rooms treated", "Re-entry advice given per the product label", "All containers and equipment taken away"], proofRequired: false, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We confirm the pest, the rooms and your preparation.", "The professional treats the agreed rooms.", "We tell you when you can go back into treated rooms."],
      whatToPrepare: prepare("pest-control"),
      whatIsNotIncluded: ["Rooms or spaces that are locked or cannot be reached."],
      whenWeStop: ["People or pets are still in the rooms to be treated, or food is left uncovered.", "A gas smell, sparks or exposed wiring."],
    },
    openQuestions: [
      "Pest treatment is a regulated activity: decide which provider capability / authorisation is required before a partner may be assigned (none is asserted here).",
      "Define the treatment procedure per pest type (cockroach, termite, general) or name the approved external method document the partner follows; until then the plan has no WORK step.",
      "Confirm the re-entry rule wording shown to customers (currently 'per the product label, advised by the professional').",
    ],
  }),

  "plant-care": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Agree the plants to be looked after, whether any should be repotted (only if the customer has a new pot and potting mix ready), and any problems the customer has noticed."),
      CHECK_STOP(),
      { id: "water", title: "Water the plants", kind: "WORK", description: "Avoid water running onto floors, sockets or furniture." },
      { id: "prune", title: "Prune dead or overgrown parts", kind: "WORK", description: "Only prune what the customer agreed to.", ppe: GLOVES },
      { id: "repot", title: "Repot the plants the customer chose", kind: "WORK", description: "Only when the customer has provided the pot and potting mix.", mandatory: false, skipPolicy: "SKIP_WITH_REASON", ppe: GLOVES },
      { id: "health-check", title: "Tell the customer what you noticed about plant health", kind: "QUALITY_CHECK", description: "Describe what you saw (yellowing, pests, dry soil). Do not apply any treatment products.", dependsOn: ["prune"] },
      CLOSEOUT("Sweep up soil and cuttings and take away the waste."),
    ),
    safety: safety("plant-care", {
      information: "Watering, pruning, repotting (with your pot and potting mix, if wanted) and a plant health check.",
      warnings: ["Plants that can only be reached by leaning out or over a railing are not looked after.", "No pest or disease treatment products are applied; you are told what was noticed."],
      prohibitedConditions: [...COMMON, PC.leaningOut, PC.improvisedHeight, PC.railing],
    }),
    quality: { checklist: ["Agreed plants watered", "Pruning limited to what was agreed", "Repotting done only where supplies were provided", "Soil and cuttings cleared"], proofRequired: false, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We agree the plants and any repotting with you.", "We water, prune and repot as agreed.", "We tell you what we noticed and clear up."],
      whatToPrepare: prepare("plant-care"),
      whatIsNotIncluded: ["Pots, potting mix or plant treatment products.", "Plants that can only be reached by leaning over a railing or climbing."],
      whenWeStop: ["A plant can only be reached by leaning out or over a railing.", "A loose or broken balcony railing."],
    },
    openQuestions: ["Confirm that no plant treatment (pest or disease products) is in scope; the draft only lets the partner report what they notice."],
  }),

  /* ── Exterior — SAFETY HOLD ──────────────────────────────────────── */
  "fasade-cleaning": draft({
    status: "SAFETY_HOLD",
    execution: plan(
      CONFIRM_SCOPE("Agree with the customer which exterior surfaces they expect. Record every area that is excluded.", "NOTE"),
      { id: "confirm-society-permission", title: "Confirm society or building-manager permission", kind: "SAFETY_CHECK", description: "Ask for the permission before starting; do not start without it.", safetyRequirement: "society-permission-external-work" },
      { id: "assess-safe-access", title: "Assess safe access before any work", kind: "SAFETY_CHECK", description: "Do not use improvised height access. Exclude anything that cannot be reached safely and record it.", safetyRequirement: "safe-access-assessed-on-site", evidence: "NOTE" },
      WALKTHROUGH("Tell the customer what was covered and what was excluded, and why."),
      CLOSEOUT("Take away your equipment and waste; leave shared areas clean."),
    ),
    safety: safety("fasade-cleaning", {
      information: "Exterior building cleaning of areas that can be reached safely. Society permission and an on-site safe-access assessment come first; areas that cannot be reached safely are not covered.",
      warnings: ["Keep people away from the area below the work."],
      prohibitedConditions: [PC.noPermission, PC.accessUnsafe, PC.leaningOut, PC.improvisedHeight, PC.structural, PC.wiring, PC.threat],
    }),
    quality: { checklist: ["Society permission confirmed before starting", "Safe-access assessment recorded", "Excluded areas recorded and explained"], proofRequired: true, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We confirm your society's permission.", "The professional checks what can be reached safely and agrees the areas with you.", "We clean the areas that can be reached safely and tell you what was left out."],
      whatToPrepare: prepare("fasade-cleaning"),
      whatIsNotIncluded: ["Any area that cannot be reached safely.", "Access equipment for work at height."],
      whenWeStop: ["No society permission on site.", "No safe way to reach the area, or damaged surfaces or wiring on the facade."],
    },
    openQuestions: [
      "SAFETY HOLD: define (or decide not to offer) a work-at-height method — equipment, provider capability, and scope. Until then the plan has no WORK step and no height work may be dispatched.",
      "Decide whether this service should stay bookable while on SAFETY_HOLD, or be paused until a method exists (Phase 06 left bookability unchanged).",
      "The live service name is spelled 'fasade cleaning' — confirm the customer-facing name (not changed by this draft).",
    ],
  }),

  /* ── Beauty ──────────────────────────────────────────────────────── */
  "salon-at-home": draft({
    status: "DRAFT_FOR_OWNER_REVIEW",
    execution: plan(
      CONFIRM_SCOPE("Confirm the treatments booked. Ask the customer about allergies or skin sensitivities before any product touches the skin or hair.", "NOTE"),
      CHECK_STOP(),
      { id: "set-up", title: "Set up in a well-lit spot with a chair", kind: "PREPARATION", description: "Lay out your salon kit and disposables. Use sterilised tools only. Keep cables away from water." },
      { id: "treatment", title: "Carry out the booked treatments", kind: "WORK", description: "Check with the customer before each new product or step. Stop at once if the customer reports discomfort or a reaction.", warnings: ["Do not use a product the customer has said they are sensitive to."] },
      WALKTHROUGH("Show the customer the result in a mirror and check they are happy."),
      CLOSEOUT("Dispose of single-use items, bag used towels and hair clippings, and wipe the area."),
    ),
    safety: safety("salon-at-home", {
      information: "Haircut, grooming and beauty treatments at home with the professional's products and sterilised tools.",
      warnings: ["Tell the professional about allergies or skin sensitivities before any treatment."],
      prohibitedConditions: [...COMMON, PC.allergyConflict, PC.waterOnElectrics],
      medicalDisclaimer: "Salon treatments are not medical treatments, and the professional does not give medical advice. If you have a skin condition or a reaction, please consult a doctor.",
    }),
    quality: { checklist: ["Allergies and sensitivities asked before starting", "Only sterilised tools and fresh disposables used", "Result checked with the customer", "Area cleaned and waste bagged"], proofRequired: false, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We confirm the treatments and ask about allergies or sensitivities.", "The professional carries out the treatments with sterilised tools.", "We check the result with you and clean up."],
      whatToPrepare: prepare("salon-at-home"),
      whatIsNotIncluded: ["Treatments not in your booking."],
      whenWeStop: ["You report a reaction or an allergy to a product the service needs.", "Water reaching sockets, sparks or exposed wiring."],
    },
    openQuestions: ["Decide whether a skin sensitivity test is required before specific treatments; no such procedure is asserted here."],
  }),

  /* ── Home maintenance — OWNER APPROVAL REQUIRED ──────────────────── */
  "home-painting": draft({
    status: "OWNER_APPROVAL_REQUIRED",
    execution: plan(
      CONFIRM_SCOPE("Agree the walls and rooms to be painted. Confirm that paint is not in the base price and agree it with the customer before using any. Record exterior areas that are excluded.", "NOTE"),
      CHECK_STOP(),
      { id: "assess-safe-access", title: "Assess safe access for any exterior or high wall", kind: "SAFETY_CHECK", description: "No improvised height access. Exclude anything that cannot be reached safely and tell the customer.", safetyRequirement: "safe-access-assessed-on-site" },
      { id: "confirm-shade", title: "Confirm the shade and finish before opening any paint", kind: "SAFETY_CHECK", safetyRequirement: "paint-shade-confirmed", evidence: "NOTE" },
      { id: "protect", title: "Protect floors, fittings and furniture", kind: "PREPARATION", description: "Mask and cover before any work. Help move only light furniture with the customer's agreement." },
      WALKTHROUGH("Walk through the painted rooms with the customer and point out anything excluded."),
      CLOSEOUT("Remove masking and covers, take away your tools and waste, and remind the customer to keep windows open while paint dries."),
    ),
    safety: safety("home-painting", {
      information: "Wall painting. Paint is not in the base price and is agreed with you before use. Exterior or high walls are assessed on site and are left out if they cannot be reached safely.",
      warnings: ["Keep windows open while the paint dries.", "Keep children and pets away from wet paint and ladders."],
      prohibitedConditions: [...COMMON, PC.structural, PC.accessUnsafe, PC.leaningOut, PC.improvisedHeight, PC.mould],
    }),
    quality: { checklist: ["Shade and finish confirmed before painting", "Floors and furniture protected", "Excluded areas recorded and explained", "Masking and covers removed at the end"], proofRequired: true, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We agree the walls, the paint and the shade with you.", "We check safe access, protect your floors and furniture and paint the agreed walls.", "We walk through the result with you and clear up."],
      whatToPrepare: prepare("home-painting"),
      whatIsNotIncluded: [...quotedExclusions("home-painting"), "Walls that cannot be reached safely."],
      whenWeStop: ["Cracks, dampness or loose plaster on the walls to be painted.", "A wall can only be reached without a safe standing surface."],
    },
    openQuestions: [
      "COMMERCIAL HOLD: paint is SEPARATE_QUOTE but there is no in-app quote → approval → payment chain. Decide how paint is agreed and paid before the painting WORK steps can be written.",
      "Exterior walls: decide whether exterior painting is offered at all without a work-at-height method, or restrict the service to interior walls.",
      "Define the surface preparation and coat sequence the partner follows (not asserted here); until then the plan has no WORK step.",
    ],
  }),

  "ac-service": draft({
    status: "OWNER_APPROVAL_REQUIRED",
    execution: plan(
      CONFIRM_SCOPE("Confirm the AC units booked and what the customer has noticed. Confirm that gas and parts are not in the base price and are agreed before any use.", "NOTE"),
      CHECK_STOP("Check both units can be reached safely. If the outdoor unit can only be reached by leaning out or climbing, exclude it and report it in the app."),
      { id: "isolate-power", title: "Switch off the AC at its switch before touching the unit", kind: "SAFETY_CHECK", description: "Do not open any electrical part or gas connection in this draft. If the power cannot be switched off, do not proceed and report it in the app." },
      WALKTHROUGH("Tell the customer what was done and anything that needs a separate decision."),
      CLOSEOUT("Wipe up water around the indoor unit and take away your equipment and waste."),
    ),
    safety: safety("ac-service", {
      information: "AC maintenance. Gas and spare parts are not in the base price and are agreed with you before use. The outdoor unit is serviced only if it can be reached safely.",
      warnings: ["Keep the area below the indoor unit clear.", "The AC stays switched off while it is serviced."],
      prohibitedConditions: [...COMMON, PC.circuitCannotBeIsolated, PC.leaningOut, PC.accessUnsafe, PC.waterOnElectrics],
    }),
    quality: { checklist: ["Power switched off before work", "Gas or parts agreed with the customer before use", "Outdoor unit excluded if not safely reachable", "Area below the indoor unit left dry"], proofRequired: true, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We confirm the units and anything you have noticed.", "We switch the AC off and service the units that can be reached safely.", "We tell you what was done and agree any gas or parts with you first."],
      whatToPrepare: prepare("ac-service"),
      whatIsNotIncluded: [...quotedExclusions("ac-service"), "An outdoor unit that cannot be reached safely."],
      whenWeStop: ["The AC's power cannot be switched off.", "The outdoor unit can only be reached by leaning out or climbing.", "A gas smell, sparks or exposed wiring."],
    },
    openQuestions: [
      "COMMERCIAL HOLD: gas refill and spare parts are SEPARATE_QUOTE with no in-app quote → approval → payment chain. Decide the approval flow before the service WORK steps can be written.",
      "Gas handling and electrical work on the unit are specialist procedures: decide the provider capability / authorisation required and the approved method document; none is asserted here.",
      "Outdoor units mounted outside a window or wall: decide whether they are in scope without a work-at-height method.",
    ],
  }),

  electrician: draft({
    status: "OWNER_APPROVAL_REQUIRED",
    execution: plan(
      CONFIRM_SCOPE("Confirm the job the customer booked (wiring, switch, fan or appliance installation). Confirm that parts are not in the base price and are agreed before use.", "NOTE"),
      CHECK_STOP(),
      { id: "isolate-circuit", title: "Isolate the circuit at the switchboard before touching any wiring", kind: "SAFETY_CHECK", description: "If the circuit cannot be isolated, do not proceed and report it in the app.", safetyRequirement: "switchboard-access" },
      WALKTHROUGH("Show the customer what was done and anything that needs a separate decision."),
      CLOSEOUT("Take away old parts only with the customer's agreement, and all your tools and waste."),
    ),
    safety: safety("electrician", {
      information: "Electrical work on wiring, switches, fans and appliance installation. The circuit is switched off at the switchboard before any work. Parts are not in the base price and are agreed with you before use.",
      warnings: ["Do not switch the circuit back on until the professional says so."],
      prohibitedConditions: [PC.gas, PC.sparks, PC.threat, PC.circuitCannotBeIsolated, PC.waterOnElectrics, "Scorch marks, melted sockets or a hot switchboard — do not proceed and report it in the app"],
    }),
    quality: { checklist: ["Circuit isolated before work", "Parts agreed with the customer before use", "Work shown to the customer"], proofRequired: true, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We confirm the job with you.", "We switch off the circuit at the switchboard before any work.", "We show you what was done and agree any parts with you first."],
      whatToPrepare: prepare("electrician"),
      whatIsNotIncluded: quotedExclusions("electrician"),
      whenWeStop: ["The circuit cannot be switched off.", "Scorch marks, melted sockets, sparks or water on electrics.", "A gas smell."],
    },
    openQuestions: [
      "Electrical work is regulated: decide the provider capability / authorisation required before a partner may be assigned (none is asserted here).",
      "Define the work method per job type or name the approved method document; until then the plan has no WORK step.",
      "COMMERCIAL HOLD: parts are SEPARATE_QUOTE with no in-app quote → approval → payment chain.",
    ],
  }),

  plumbing: draft({
    status: "OWNER_APPROVAL_REQUIRED",
    execution: plan(
      CONFIRM_SCOPE("Confirm the job the customer booked (leak, tap installation or drainage). Confirm that parts are not in the base price and are agreed before use.", "NOTE"),
      CHECK_STOP(),
      { id: "locate-shutoff", title: "Locate the water shut-off before opening any joint", kind: "SAFETY_CHECK", description: "If the supply cannot be shut off, do not open any joint and report it in the app.", safetyRequirement: "water-shutoff-access" },
      WALKTHROUGH("Show the customer the work with the water running and check for leaks together."),
      CLOSEOUT("Dry the work area, and take away old parts only with the customer's agreement."),
    ),
    safety: safety("plumbing", {
      information: "Leak fixes, tap installation and drainage. The water supply may be shut off while the professional works. Parts are not in the base price and are agreed with you before use.",
      warnings: ["Water may be off for part of the visit."],
      prohibitedConditions: [...COMMON, PC.waterCannotBeShutOff, PC.waterOnElectrics, PC.structural],
    }),
    quality: { checklist: ["Shut-off located before opening any joint", "Parts agreed with the customer before use", "Work checked for leaks with the water running", "Work area dry"], proofRequired: true, beforeAfterPhotos: false },
    customerSummary: {
      whatHappens: ["We confirm the job with you.", "We locate the water shut-off before opening any joint.", "We check the work with you with the water running, and agree any parts with you first."],
      whatToPrepare: prepare("plumbing"),
      whatIsNotIncluded: quotedExclusions("plumbing"),
      whenWeStop: ["The water supply cannot be shut off.", "Water reaching sockets or electrics, or structural damage around the pipes."],
    },
    openQuestions: [
      "COMMERCIAL HOLD: parts are SEPARATE_QUOTE with no in-app quote → approval → payment chain. Decide the approval flow before the repair WORK steps can be written.",
      "Define the repair method per job type (leak, tap, drainage) or name the approved method document; until then the plan has no WORK step.",
    ],
  }),
};

/* ------------------------------------------------------------------ */
/* Derived fields (draft.3)                                            */
/* ------------------------------------------------------------------ */

/**
 * What a professional does when something goes wrong that is not an emergency. It names only what the
 * app already does: a stop condition raises a safety hold, a step can be escalated, evidence takes a photo.
 */
export const INCIDENT_PROTOCOL =
  "If something goes wrong that is not an emergency — something is broken, spilled or nearly causes an injury, or the customer disputes the work: stop that part of the job, make the area safe and tell the customer. Report it in the app, as a stop condition or by escalating the step you are on, and add a photo. Do not carry on with that part until the Homeeigo team responds.";

const unique = (xs: string[]) => [...new Set(xs)];

/** Who provides the products, said as a restriction. Nothing about what any product is. */
export function derivedProductRestrictions(slug: string, prohibited: readonly string[]): string[] {
  const out: string[] = [];
  const material = derivedResponsibility(slug, "MATERIAL");
  if (material === "PROFESSIONAL_PROVIDED") out.push("Products other than the ones the professional brings are not used on this job.");
  else if (material === "CUSTOMER_PROVIDED") out.push("Products other than the ones the customer provides are not used on this job.");
  else if (material === "MIXED") out.push("Products other than the ones listed for this job are not used.");
  if (prohibited.includes(PC.allergyConflict)) out.push("A product the customer reports an allergy or skin reaction to is not used.");
  return out;
}

/** What "done" means, read off the plan's own shape and the proof decision. */
export function derivedCompletionCriteria(steps: readonly DraftStep[], quality: DraftQuality): string[] {
  const kinds = new Set(steps.map((s) => s.kind));
  const out: string[] = [];
  if (steps.length) out.push("Every step of the work plan is completed.");
  if (quality.checklist.length) out.push("Every item on the quality checklist is met.");
  if (quality.beforeAfterPhotos) out.push("Before and after photos of the work are uploaded.");
  else if (quality.proofRequired) out.push("A photo of the finished work is uploaded.");
  if (kinds.has("QUALITY_CHECK")) out.push("The result has been shown to the customer.");
  if (kinds.has("CLOSEOUT")) out.push("The work area is left tidy.");
  return out;
}

/** The Phase 06 items of a service by kind, as their catalogue labels. */
function itemLabels(slug: string, k: "MATERIAL" | "EQUIPMENT"): string[] {
  return unique(assignments(slug).filter((a) => kind.get(a.itemCode) === k).map((a) => label.get(a.itemCode) ?? a.itemCode)).slice(0, 15);
}

/**
 * Adds the derived fields to one authored draft. Held services (no WORK step) get the safety fields —
 * a professional on site still needs them — but no completion criteria, since there is no work to finish.
 */
function enrich(slug: string, d: ServiceDraft): ServiceDraft {
  const steps = d.execution?.steps ?? [];
  const work = steps.filter((s) => s.kind === "WORK");
  const materials = itemLabels(slug, "MATERIAL");
  const equipment = itemLabels(slug, "EQUIPMENT");
  // With one WORK step the service's items are that step's items. With several, which item belongs to
  // which step is not recorded anywhere, so no step claims any — the brief shows them for the job.
  const execution = d.execution
    ? {
        steps: steps.map((s) =>
          work.length === 1 && s.kind === "WORK"
            ? { ...s, ...(materials.length ? { materials } : {}), ...(equipment.length ? { equipment } : {}) }
            : s,
        ),
      }
    : undefined;
  const ppe = unique(steps.flatMap((s) => s.ppe ?? []));
  const restrictions = d.safety ? derivedProductRestrictions(slug, d.safety.prohibitedConditions ?? []) : [];
  const safety = d.safety
    ? { ...d.safety, ...(ppe.length ? { ppe } : {}), ...(restrictions.length ? { chemicalRestrictions: restrictions } : {}), incidentProtocol: INCIDENT_PROTOCOL }
    : undefined;
  const quality = d.quality && d.status === "DRAFT_FOR_OWNER_REVIEW" ? { ...d.quality, completionCriteria: derivedCompletionCriteria(steps, d.quality) } : d.quality;
  return { ...d, ...(execution ? { execution } : {}), ...(safety ? { safety } : {}), ...(quality ? { quality } : {}) };
}

export const DRAFT: Record<string, ServiceDraft> = Object.fromEntries(Object.entries(AUTHORED).map(([slug, d]) => [slug, enrich(slug, d)]));

/** Short owner-facing digest per status (the validator prints it). */
export const STATUS_ORDER: DraftStatus[] = ["DRAFT_FOR_OWNER_REVIEW", "OWNER_APPROVAL_REQUIRED", "SAFETY_HOLD"];
