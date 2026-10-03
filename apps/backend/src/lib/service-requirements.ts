/**
 * Phase 06 — materials, equipment and customer requirements.
 *
 * One domain, three audiences. A service assigns catalogue items (a material, a piece of equipment,
 * or a customer precondition) with three SEPARATE facts:
 *   responsibility  who has it on the day
 *   procurement     who buys it when it is missing (unset = whoever provides it)
 *   charge          how the customer pays for it — CHARGEABLE only through an add-on, so the Phase 05
 *                   quote stays the single pricing authority
 * and optional conditions (variant / add-on / minimum quantity).
 *
 * Nothing here invents a requirement: an unconfigured service resolves to an empty list, and every
 * customer sentence below is a translation of a configured value, never generic advice.
 *
 * Pure module (no I/O). Storage: service-catalog-store.ts. The DB CHECKs in migration
 * 20260922100000_service_requirements enforce the same shape rules as `requirementAssignmentSchema`.
 */
import { z } from "zod";
import type { ServiceCatalogConfig } from "./service-catalog-config";

export const REQUIREMENT_KINDS = ["MATERIAL", "EQUIPMENT", "CUSTOMER_PRECONDITION"] as const;
export const RESPONSIBILITIES = ["CUSTOMER", "PROFESSIONAL", "PLATFORM", "SHARED", "UNKNOWN"] as const;
export const PROCUREMENTS = ["CUSTOMER", "PROFESSIONAL", "PLATFORM"] as const;
export const CHARGES = ["INCLUDED", "CHARGEABLE", "SEPARATE_QUOTE", "NOT_APPLICABLE"] as const;
export const ENFORCEMENTS = ["INFORMATIONAL", "WARNING", "REQUIRED_BEFORE_BOOKING", "REQUIRED_BEFORE_ARRIVAL", "REQUIRED_AT_START"] as const;
export const VERIFICATIONS = ["NONE", "CUSTOMER_ATTESTATION", "PARTNER_CHECK"] as const;
export const QUANTITY_BASES = ["PER_BOOKING", "PER_SELECTED_UNIT"] as const;

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export type Responsibility = (typeof RESPONSIBILITIES)[number];
export type Charge = (typeof CHARGES)[number];
export type Enforcement = (typeof ENFORCEMENTS)[number];

/** Same rule as the DB CHECK: lowercase words joined by single hyphens. */
export const requirementCode = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase words joined by single hyphens");
const optionCode = z.string().trim().min(1).max(40).regex(/^[a-z0-9][a-z0-9-]*$/);
const note = (max: number) => z.string().trim().min(1).max(max);

/** A service's assignment of one catalogue item. Stored in catalog_config.requirements AND service_requirements. */
export const requirementAssignmentSchema = z
  .object({
    id: requirementCode,
    itemCode: requirementCode,
    responsibility: z.enum(RESPONSIBILITIES),
    procurement: z.enum(PROCUREMENTS).optional(),
    charge: z.enum(CHARGES).default("NOT_APPLICABLE"),
    optional: z.boolean().default(false),
    enforcement: z.enum(ENFORCEMENTS).default("INFORMATIONAL"),
    verification: z.enum(VERIFICATIONS).default("NONE"),
    quantity: z
      .number()
      .finite()
      .gt(0, "quantity must be greater than 0 — leave it unset when no quantity applies")
      .max(10_000)
      .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, "at most 3 decimal places")
      .optional(),
    unit: note(20).optional(),
    quantityBasis: z.enum(QUANTITY_BASES).optional(),
    when: z
      .object({
        variantIds: z.array(optionCode).max(30).optional(),
        addonIds: z.array(optionCode).max(20).optional(),
        minQuantity: z.number().int().min(1).max(10_000).optional(),
      })
      .strict()
      .optional(),
    customerNote: note(500).optional(),
    customerWarning: note(500).optional(),
    partnerInstructions: note(1000).optional(),
    handlingNote: note(500).optional(),
    internalNote: note(1000).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine((r, ctx) => {
    const hasQ = r.quantity != null, hasU = r.unit != null, hasB = r.quantityBasis != null;
    if (hasQ !== hasU || hasQ !== hasB) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "quantity, unit and quantityBasis are set together or not at all" });
    }
    if (r.responsibility === "CUSTOMER" && r.charge !== "NOT_APPLICABLE") {
      ctx.addIssue({ code: "custom", path: ["charge"], message: "an item the customer provides cannot be included in or charged by the service" });
    }
    if (r.charge === "CHARGEABLE" && !r.when?.addonIds?.length) {
      ctx.addIssue({ code: "custom", path: ["charge"], message: "a chargeable item must be tied to the add-on that prices it (when.addonIds)" });
    }
    if (r.enforcement === "REQUIRED_BEFORE_BOOKING" && r.verification !== "CUSTOMER_ATTESTATION") {
      ctx.addIssue({ code: "custom", path: ["verification"], message: "a requirement enforced before booking needs verification CUSTOMER_ATTESTATION" });
    }
  });
export type RequirementAssignment = z.infer<typeof requirementAssignmentSchema>;

/** Catalogue item facts the assignment points at (server-populated on hydrate; never accepted from a client). */
export const requirementItemInfoSchema = z
  .object({
    code: requirementCode,
    kind: z.enum(REQUIREMENT_KINDS),
    name: note(120),
    customerLabel: note(160).nullable().optional(),
    description: note(1000).nullable().optional(),
    isActive: z.boolean(),
  })
  .strict();
export type RequirementItemInfo = z.infer<typeof requirementItemInfoSchema>;

/* ------------------------------------------------------------------ */
/* Static validation (publish / bookability gate)                      */
/* ------------------------------------------------------------------ */

export type RequirementIssue = { code: string; message: string; requirement?: string };

type Cfg = Pick<ServiceCatalogConfig, "requirements" | "requirementItems" | "variants" | "addons" | "quantity"> | null;

/** Would two assignments of the same item ever apply to the same booking? Conservative on purpose. */
function mayCoApply(a: RequirementAssignment, b: RequirementAssignment): boolean {
  const va = a.when?.variantIds ?? [], vb = b.when?.variantIds ?? [];
  if (va.length && vb.length && !va.some((v) => vb.includes(v))) return false; // disjoint variant sets
  return true;
}
const signature = (r: RequirementAssignment) =>
  JSON.stringify([r.responsibility, r.procurement ?? null, r.charge, r.optional, r.enforcement, r.verification, r.quantity ?? null, r.unit ?? null, r.quantityBasis ?? null]);

/**
 * Every rule is derived from the model — none is a business policy. An empty list means the
 * configured requirements are internally consistent; each issue blocks bookability (fail closed).
 */
export function validateServiceRequirements(cfg: Cfg): RequirementIssue[] {
  const reqs = cfg?.requirements ?? [];
  if (!reqs.length) return [];
  const issues: RequirementIssue[] = [];
  const items = cfg?.requirementItems;
  if (!items) return [{ code: "REQUIREMENT_ITEMS_UNRESOLVED", message: "Requirement catalogue items were not loaded" }];
  const variants = new Map((cfg?.variants ?? []).map((v) => [v.id, v]));
  const addons = new Map((cfg?.addons ?? []).map((a) => [a.id, a]));
  const seen = new Set<string>();
  for (const r of reqs) {
    const at = r.id;
    if (seen.has(r.id)) issues.push({ code: "REQUIREMENT_DUPLICATE_ID", message: `Requirement "${r.id}" is assigned twice`, requirement: at });
    seen.add(r.id);
    if (!r.active) continue;
    const item = items[r.itemCode];
    if (!item) { issues.push({ code: "REQUIREMENT_ITEM_UNKNOWN", message: `Item "${r.itemCode}" does not exist in the requirement catalogue`, requirement: at }); continue; }
    if (!item.isActive) issues.push({ code: "REQUIREMENT_ITEM_INACTIVE", message: `Item "${item.name}" is inactive`, requirement: at });
    if (r.responsibility === "UNKNOWN") issues.push({ code: "REQUIREMENT_RESPONSIBILITY_UNKNOWN", message: `Who provides "${item.name}" is not decided`, requirement: at });
    if (item.kind === "CUSTOMER_PRECONDITION") {
      if (r.responsibility !== "CUSTOMER" || r.charge !== "NOT_APPLICABLE" || r.quantity != null || r.procurement != null) {
        issues.push({ code: "REQUIREMENT_KIND_INCONSISTENT", message: `"${item.name}" is a customer precondition: it is the customer's, has no charge, quantity or procurement`, requirement: at });
      }
    } else if (["PROFESSIONAL", "PLATFORM", "SHARED"].includes(r.responsibility) && r.charge === "NOT_APPLICABLE") {
      issues.push({ code: "REQUIREMENT_CHARGE_UNSPECIFIED", message: `"${item.name}" is supplied by the service: say whether it is included, chargeable or quoted separately`, requirement: at });
    }
    for (const v of r.when?.variantIds ?? []) {
      const found = variants.get(v);
      if (!found || !found.active) issues.push({ code: "REQUIREMENT_CONDITION_INVALID", message: `Condition references variant "${v}", which does not exist or is inactive`, requirement: at });
    }
    for (const a of r.when?.addonIds ?? []) {
      const found = addons.get(a);
      if (!found || !found.active) issues.push({ code: "REQUIREMENT_CONDITION_INVALID", message: `Condition references add-on "${a}", which does not exist or is inactive`, requirement: at });
      else if (r.charge === "CHARGEABLE" && !(found.price > 0)) {
        issues.push({ code: "REQUIREMENT_CHARGE_INVALID", message: `"${item.name}" is chargeable through add-on "${found.name}", which has no price`, requirement: at });
      }
    }
    if (r.when?.minQuantity != null && (!cfg?.quantity || cfg.quantity.type === "NONE" || r.when.minQuantity > cfg.quantity.max)) {
      issues.push({ code: "REQUIREMENT_CONDITION_INVALID", message: `Minimum-quantity condition cannot be met by the service's quantity rule`, requirement: at });
    }
    if (r.quantityBasis === "PER_SELECTED_UNIT" && (!cfg?.quantity || cfg.quantity.type === "NONE")) {
      issues.push({ code: "REQUIREMENT_QUANTITY_BASIS_INVALID", message: `"${item.name}" scales per selected unit but the service has no quantity rule`, requirement: at });
    }
  }
  const active = reqs.filter((r) => r.active);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!, b = active[j]!;
      if (a.itemCode === b.itemCode && mayCoApply(a, b) && signature(a) !== signature(b)) {
        issues.push({ code: "REQUIREMENT_CONFLICT", message: `"${a.id}" and "${b.id}" assign "${a.itemCode}" differently and can apply to the same booking`, requirement: a.id });
      }
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

export type RequirementSelection = { variantId: string | null; addonIds: string[]; quantity: number };

export type ResolvedRequirement = {
  code: string;
  itemCode: string;
  kind: RequirementKind;
  name: string;
  customerLabel: string | null;
  responsibility: Responsibility;
  procurement: (typeof PROCUREMENTS)[number] | null;
  charge: Charge;
  /** Add-ons (by id) whose price covers a CHARGEABLE item. */
  chargeAddonIds: string[];
  optional: boolean;
  enforcement: Enforcement;
  verification: (typeof VERIFICATIONS)[number];
  /** Resolved for this selection (per-unit bases multiplied); null = no quantity applies. */
  quantity: number | null;
  unit: string | null;
  quantityBasis: (typeof QUANTITY_BASES)[number] | null;
  source: "BASE" | "VARIANT" | "ADDON" | "QUANTITY";
  customerNote: string | null;
  customerWarning: string | null;
  partnerInstructions: string | null;
  handlingNote: string | null;
  internalNote: string | null;
  sortOrder: number;
};

export type RequirementResolution =
  | { ok: true; items: ResolvedRequirement[] }
  | { ok: false; error: "REQUIREMENT_CONFIGURATION_INVALID" | "REQUIREMENT_CONFLICT"; issues: RequirementIssue[] };

function applies(r: RequirementAssignment, sel: RequirementSelection): boolean {
  return conditionApplies(r.when, sel);
}

/**
 * The ONE conditional-applicability rule (variant / add-on / minimum quantity), shared by Phase 06
 * requirements and Phase 10 §7 execution steps so the two can never disagree about what a
 * selection includes.
 */
export function conditionApplies(
  w: { variantIds?: string[]; addonIds?: string[]; minQuantity?: number } | undefined,
  sel: RequirementSelection,
): boolean {
  if (!w) return true;
  if (w.variantIds?.length && (!sel.variantId || !w.variantIds.includes(sel.variantId))) return false;
  if (w.addonIds?.length && !w.addonIds.some((a) => sel.addonIds.includes(a))) return false;
  if (w.minQuantity != null && sel.quantity < w.minQuantity) return false;
  return true;
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The single authority: service configuration + selection → the requirements of THIS booking.
 * Deterministic (stable order: sortOrder, then code), deduplicated by catalogue item, and fail-closed:
 * an invalid configuration or two applicable assignments that disagree refuse instead of guessing.
 */
export function resolveServiceRequirements(cfg: Cfg, sel: RequirementSelection): RequirementResolution {
  const reqs = cfg?.requirements ?? [];
  if (!reqs.length) return { ok: true, items: [] };
  const issues = validateServiceRequirements(cfg);
  if (issues.length) return { ok: false, error: "REQUIREMENT_CONFIGURATION_INVALID", issues };
  const items = cfg!.requirementItems!;
  const applicable = reqs
    .filter((r) => r.active && applies(r, sel))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id));
  const byItem = new Map<string, { a: RequirementAssignment; resolved: ResolvedRequirement }>();
  for (const a of applicable) {
    const item = items[a.itemCode]!;
    const qty = a.quantity == null ? null : round3(a.quantityBasis === "PER_SELECTED_UNIT" ? a.quantity * sel.quantity : a.quantity);
    const source: ResolvedRequirement["source"] = a.when?.addonIds?.length
      ? "ADDON"
      : a.when?.variantIds?.length
        ? "VARIANT"
        : a.when?.minQuantity != null
          ? "QUANTITY"
          : "BASE";
    const chargeAddonIds = a.charge === "CHARGEABLE" ? (a.when?.addonIds ?? []).filter((x) => sel.addonIds.includes(x)) : [];
    const prev = byItem.get(a.itemCode);
    if (prev) {
      if (signature(prev.a) !== signature(a)) {
        return { ok: false, error: "REQUIREMENT_CONFLICT", issues: [{ code: "REQUIREMENT_CONFLICT", message: `"${prev.a.id}" and "${a.id}" disagree about "${item.name}"`, requirement: a.id }] };
      }
      prev.resolved.chargeAddonIds = [...new Set([...prev.resolved.chargeAddonIds, ...chargeAddonIds])].sort();
      continue;
    }
    byItem.set(a.itemCode, {
      a,
      resolved: {
        code: a.id,
        itemCode: item.code,
        kind: item.kind,
        name: item.name,
        customerLabel: item.customerLabel ?? null,
        responsibility: a.responsibility,
        procurement: a.procurement ?? null,
        charge: a.charge,
        chargeAddonIds: chargeAddonIds.sort(),
        optional: a.optional,
        enforcement: a.enforcement,
        verification: a.verification,
        quantity: qty,
        unit: a.unit ?? null,
        quantityBasis: a.quantityBasis ?? null,
        source,
        customerNote: a.customerNote ?? null,
        customerWarning: a.customerWarning ?? null,
        partnerInstructions: a.partnerInstructions ?? null,
        handlingNote: a.handlingNote ?? null,
        internalNote: a.internalNote ?? null,
        sortOrder: a.sortOrder ?? 0,
      },
    });
  }
  return { ok: true, items: [...byItem.values()].map((x) => x.resolved) };
}

/** Codes the customer must confirm before the booking is accepted (backend-enforced). */
export function blockingRequirementCodes(items: ResolvedRequirement[]): string[] {
  return items.filter((r) => r.enforcement === "REQUIRED_BEFORE_BOOKING").map((r) => r.code);
}

/* ------------------------------------------------------------------ */
/* Projections                                                         */
/* ------------------------------------------------------------------ */

const TIMING: Record<Enforcement, string | null> = {
  INFORMATIONAL: null,
  WARNING: null,
  REQUIRED_BEFORE_BOOKING: "Confirm before booking",
  REQUIRED_BEFORE_ARRIVAL: "Before your professional arrives",
  REQUIRED_AT_START: "When the service starts",
};
const PROCURE: Record<string, string> = {
  CUSTOMER: "If it is missing, you arrange it.",
  PROFESSIONAL: "If it is missing, your professional arranges it.",
  PLATFORM: "If it is missing, Homeeigo arranges it.",
};
function quantityText(r: Pick<ResolvedRequirement, "quantity" | "unit">): string | null {
  return r.quantity == null || !r.unit ? null : `${r.quantity} ${r.unit}`;
}

export type CustomerRequirement = {
  /** Only used to confirm blocking requirements on booking; never rendered. */
  code: string;
  label: string;
  quantity: string | null;
  note: string | null;
  warning: string | null;
  chargeText: string | null;
  procurementText: string | null;
  timingText: string | null;
  mustConfirm: boolean;
};
export type CustomerRequirementsView = {
  weBring: CustomerRequirement[];
  youProvide: CustomerRequirement[];
  shared: CustomerRequirement[];
  beforeArrival: CustomerRequirement[];
  beforeBooking: CustomerRequirement[];
  optional: CustomerRequirement[];
  empty: boolean;
};

/**
 * Customer-safe: labels, customer notes and configured facts translated into sentences. Never
 * partner instructions, handling notes, internal notes, item codes or raw enums.
 */
export function customerRequirementsView(items: ResolvedRequirement[], addonNames: Record<string, string> = {}): CustomerRequirementsView {
  const view: CustomerRequirementsView = { weBring: [], youProvide: [], shared: [], beforeArrival: [], beforeBooking: [], optional: [], empty: true };
  for (const r of items) {
    const chargeText =
      r.charge === "INCLUDED"
        ? "Included in the price"
        : r.charge === "CHARGEABLE"
          ? `Charged with ${r.chargeAddonIds.map((a) => addonNames[a] ?? "the add-on").join(", ")}`
          : r.charge === "SEPARATE_QUOTE"
            ? "Not included — quoted separately"
            : null;
    const entry: CustomerRequirement = {
      code: r.code,
      label: r.customerLabel ?? r.name,
      quantity: quantityText(r),
      note: r.customerNote,
      warning: r.customerWarning,
      chargeText,
      procurementText: r.procurement && r.procurement !== r.responsibility ? (PROCURE[r.procurement] ?? null) : null,
      timingText: TIMING[r.enforcement],
      mustConfirm: r.enforcement === "REQUIRED_BEFORE_BOOKING",
    };
    if (entry.mustConfirm) view.beforeBooking.push(entry);
    else if (r.optional) view.optional.push(entry);
    else if (r.kind === "CUSTOMER_PRECONDITION") view.beforeArrival.push(entry);
    else if (r.responsibility === "CUSTOMER") view.youProvide.push(entry);
    else if (r.responsibility === "SHARED") view.shared.push(entry);
    else view.weBring.push(entry);
  }
  view.empty = !items.length;
  return view;
}

export type PartnerRequirement = {
  label: string;
  quantity: string | null;
  instructions: string | null;
  handling: string | null;
  customerWasTold: string | null;
  optional: boolean;
  chargeable: boolean;
};
export type PartnerRequirementsBrief = {
  bringMaterials: PartnerRequirement[];
  bringEquipment: PartnerRequirement[];
  customerProvides: PartnerRequirement[];
  preconditions: Array<PartnerRequirement & { check: "CONFIRMED_BY_CUSTOMER" | "VERIFY_ON_ARRIVAL" | "VERIFY_AT_START" | "INFORMATIONAL" }>;
  empty: boolean;
};

type SnapshotItem = Omit<ResolvedRequirement, "internalNote"> & { attested: boolean };
export type RequirementsSnapshot = {
  schema: "requirements.v1";
  serviceVersion: number;
  items: SnapshotItem[];
  blocking: string[];
  /** Phase 11 contract: what the professional must have for this job. No matching behaviour yet. */
  professionalNeeds: Array<{ itemCode: string; kind: "MATERIAL" | "EQUIPMENT"; quantity: number | null; unit: string | null }>;
};

/** Immutable booking record: what the customer was told and what the professional was expected to bring. */
export function buildRequirementsSnapshot(items: ResolvedRequirement[], serviceVersion: number, attested: string[]): RequirementsSnapshot {
  return {
    schema: "requirements.v1",
    serviceVersion,
    items: items.map(({ internalNote: _internal, ...r }) => ({ ...r, attested: attested.includes(r.code) })),
    blocking: blockingRequirementCodes(items),
    professionalNeeds: items
      .filter((r) => r.kind !== "CUSTOMER_PRECONDITION" && (r.responsibility === "PROFESSIONAL" || r.responsibility === "SHARED"))
      .map((r) => ({ itemCode: r.itemCode, kind: r.kind as "MATERIAL" | "EQUIPMENT", quantity: r.quantity, unit: r.unit })),
  };
}

function snapshotItems(snapshot: unknown): SnapshotItem[] | null {
  const rec = snapshot && typeof snapshot === "object" ? (snapshot as { requirements?: unknown }).requirements : null;
  if (!rec || typeof rec !== "object") return null;
  const r = rec as Partial<RequirementsSnapshot>;
  return r.schema === "requirements.v1" && Array.isArray(r.items) ? (r.items as SnapshotItem[]) : null;
}

/** Partner projection of a BOOKING — always from its snapshot, never the current service. */
export function partnerRequirementsFromSnapshot(bookingSnapshot: unknown): PartnerRequirementsBrief | null {
  const items = snapshotItems(bookingSnapshot);
  if (!items) return null;
  const brief: PartnerRequirementsBrief = { bringMaterials: [], bringEquipment: [], customerProvides: [], preconditions: [], empty: items.length === 0 };
  for (const r of items) {
    const entry: PartnerRequirement = {
      label: r.name,
      quantity: quantityText(r),
      instructions: r.partnerInstructions,
      handling: r.handlingNote,
      customerWasTold: r.customerNote,
      optional: r.optional,
      chargeable: r.charge === "CHARGEABLE",
    };
    if (r.kind === "CUSTOMER_PRECONDITION") {
      const check =
        r.enforcement === "REQUIRED_BEFORE_BOOKING" && r.attested
          ? "CONFIRMED_BY_CUSTOMER"
          : r.enforcement === "REQUIRED_AT_START"
            ? "VERIFY_AT_START"
            : r.enforcement === "REQUIRED_BEFORE_ARRIVAL" || r.verification === "PARTNER_CHECK"
              ? "VERIFY_ON_ARRIVAL"
              : "INFORMATIONAL";
      brief.preconditions.push({ ...entry, check });
    } else if (r.responsibility === "CUSTOMER") brief.customerProvides.push(entry);
    else if (r.kind === "MATERIAL") brief.bringMaterials.push(entry);
    else brief.bringEquipment.push(entry);
  }
  return brief;
}

/** Customer projection of a BOOKING (what they were told), from the snapshot. */
export function customerRequirementsFromSnapshot(bookingSnapshot: unknown, addonNames: Record<string, string> = {}): CustomerRequirementsView | null {
  const items = snapshotItems(bookingSnapshot);
  if (!items) return null;
  return customerRequirementsView(items.map((r) => ({ ...r, internalNote: null })), addonNames);
}
