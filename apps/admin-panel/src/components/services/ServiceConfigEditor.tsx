"use client";

import { useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AdminServiceRow, RequirementAssignment, RequirementItemRow, ServiceCatalogConfig, ServiceInput } from "@/services/admin-api";

/**
 * Structured editor for a service's booking + content configuration. Writes the
 * same `catalogConfig` JSON the backend validates (apps/backend
 * src/lib/service-catalog-config.ts) — no second admin data structure.
 */

const AUDIENCES = [
  ["women", "Women"],
  ["men", "Men"],
  ["girls", "Girls"],
  ["boys", "Boys"],
  ["senior-women", "Senior Women"],
  ["senior-men", "Senior Men"],
] as const;

const PRICING_MODELS = ["fixed", "hourly", "per-unit", "per-seat", "area", "package", "inspection", "quote"] as const;
const QUANTITY_TYPES = [
  "NONE",
  "HOUR",
  "UNIT",
  "SEAT",
  "ROOM",
  "BATHROOM",
  "SOFA_SEAT",
  "MATTRESS",
  "WINDOW",
  "FAN",
  "APPLIANCE",
  "SQ_FT",
  "AREA",
  "LOAD",
  "ITEM",
  "PACKAGE",
] as const;
const POLICIES = [
  ["", "Not set"],
  ["CUSTOMER_PROVIDED", "Customer provided"],
  ["PROFESSIONAL_PROVIDED", "Professional provided"],
  ["PACKAGE_INCLUDED", "Included in package"],
  ["MIXED", "Mixed"],
  ["NOT_REQUIRED", "Not required"],
  ["NOT_SPECIFIED", "Not specified"],
] as const;
const SPARE_PARTS = [
  ["", "Not set"],
  ["NOT_APPLICABLE", "Not applicable"],
  ["INCLUDED", "Included"],
  ["CUSTOMER_PAYS", "Customer pays"],
  ["APPROVAL_REQUIRED", "Charged with customer approval"],
] as const;

type Row = { id: string; name: string; price: string; durationMin: string; active: boolean };
type VariantRow = Row & { audiences: string[] };
/** Comma-separated ids for compatibility / dependency lists; the backend validates every reference. */
type AddonRow = Row & { compatible: string; requires: string; conflicts: string; maxQuantity: string };
/** Phase 06 assignment as edited (strings for inputs); `extrasToInput` converts and `clean` drops blanks. */
export type RequirementRow = {
  id: string;
  itemCode: string;
  responsibility: string;
  procurement: string;
  charge: string;
  optional: boolean;
  enforcement: string;
  verification: string;
  quantity: string;
  unit: string;
  quantityBasis: string;
  whenVariants: string;
  whenAddons: string;
  whenMinQuantity: string;
  customerNote: string;
  customerWarning: string;
  partnerInstructions: string;
  handlingNote: string;
  internalNote: string;
  active: boolean;
};

export type ServiceExtras = {
  slug: string;
  pricingModel: string;
  thumbnail: string;
  minPrice: string;
  maxPrice: string;
  detailedDescription: string;
  includedServices: string;
  excludedServices: string;
  requirements: string;
  bookingMode: "" | "STANDARD" | "HOURLY";
  comingSoon: boolean;
  sameDayAvailable: boolean;
  video: string;
  quantityEnabled: boolean;
  qType: string;
  qUnit: string;
  qUnitPlural: string;
  qMin: string;
  qMax: string;
  qStep: string;
  qDefault: string;
  qUnitPrice: string;
  qMinimumCharge: string;
  qDurationPerUnit: string;
  audiences: string[];
  eligibility: string;
  materialPolicy: string;
  equipmentPolicy: string;
  sparePartsPolicy: string;
  preparation: string;
  safetyNotes: string;
  faqs: { q: string; a: string }[];
  variants: VariantRow[];
  ownAddons: boolean;
  addons: AddonRow[];
  requirementAssignments: RequirementRow[];
  variantRequired: boolean;
  internalServiceCode: string;
  categorySlug: string;
  subcategorySlug: string;
  durationEstimated: string;
  durationMinRange: string;
  durationMaxRange: string;
  keyBenefits: string;
  limitations: string;
  importantNotes: string;
  customerDisclosures: string;
  heroImage: string;
  partnerSlotPolicy: "DURATION" | "FIXED";
  displayName: string;
  capabilityProfile: string;
  durationPrep: string;
  durationService: string;
  durationCleanup: string;
  durationSlot: string;
  minLeadTime: string;
  maxAdvanceDays: string;
  cancellationPolicy: string;
  reschedulePolicy: string;
  requiredSkills: string;
  couponAllowed: boolean;
  walletAllowed: boolean;
  splitPaymentAllowed: boolean;
  membershipAllowed: boolean;
  inspectionRequired: boolean;
  availableCities: string;
  customerSummary: string;
  valueProposition: string;
  highlights: string;
  process: string;
  qualityNotApplicable: boolean;
  qualityChecklist: string;
  proofRequired: boolean;
  beforeAfterPhotos: boolean;
  warrantyDays: string;
  ratingWeight: string;
  distanceWeight: string;
  availabilityWeight: string;
  responseWeight: string;
  completionWeight: string;
  seoNoindex: boolean;
  seoTitle: string;
  operationsNotes: string;
};

const lines = (xs?: string[] | null) => (xs ?? []).join("\n");
const str = (n?: number | null) => (n == null ? "" : String(n));

export function extrasFromRow(s?: AdminServiceRow): ServiceExtras {
  const c: ServiceCatalogConfig = s?.catalogConfig ?? {};
  const q = c.quantity;
  return {
    slug: s?.slug ?? "",
    pricingModel: s?.pricingModel ?? "fixed",
    thumbnail: s?.thumbnail ?? "",
    minPrice: str(s?.minPrice),
    maxPrice: str(s?.maxPrice),
    detailedDescription: s?.detailedDescription ?? "",
    includedServices: lines(s?.includedServices),
    excludedServices: lines(s?.excludedServices),
    requirements: lines(s?.requirements),
    bookingMode: c.bookingMode ?? "",
    comingSoon: Boolean(c.comingSoon),
    sameDayAvailable: Boolean(c.sameDayAvailable),
    video: c.video ?? "",
    quantityEnabled: Boolean(q),
    qType: q?.type ?? "UNIT",
    qUnit: q?.unitLabel ?? "",
    qUnitPlural: q?.unitLabelPlural ?? "",
    qMin: str(q?.min ?? 1),
    qMax: str(q?.max ?? 1),
    qStep: str(q?.step ?? 1),
    qDefault: str(q?.default),
    qUnitPrice: str(q?.unitPrice),
    qMinimumCharge: str(q?.minimumCharge),
    qDurationPerUnit: str(q?.durationPerUnitMin),
    audiences: c.audiences ?? [],
    eligibility: c.eligibility ?? "",
    materialPolicy: c.materialPolicy ?? "",
    equipmentPolicy: c.equipmentPolicy ?? "",
    sparePartsPolicy: c.sparePartsPolicy ?? "",
    preparation: lines(c.preparation),
    safetyNotes: lines(c.safetyNotes),
    faqs: c.faqs ?? [],
    variants: (c.variants ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      price: str(v.price),
      durationMin: str(v.durationMin),
      active: v.active !== false,
      audiences: v.audiences ?? [],
    })),
    ownAddons: Boolean(c.addons),
    addons: (c.addons ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      price: str(a.price),
      durationMin: str(a.durationMin),
      active: a.active !== false,
      compatible: (a.compatibleVariantIds ?? []).join(", "),
      requires: (a.requiresAddonIds ?? []).join(", "),
      conflicts: (a.conflictsWithAddonIds ?? []).join(", "),
      maxQuantity: str(a.maxQuantity),
    })),
    requirementAssignments: (c.requirements ?? []).map((r) => ({
      id: r.id,
      itemCode: r.itemCode,
      responsibility: r.responsibility,
      procurement: r.procurement ?? "",
      charge: r.charge ?? "NOT_APPLICABLE",
      optional: r.optional === true,
      enforcement: r.enforcement ?? "INFORMATIONAL",
      verification: r.verification ?? "NONE",
      quantity: str(r.quantity),
      unit: r.unit ?? "",
      quantityBasis: r.quantityBasis ?? "",
      whenVariants: (r.when?.variantIds ?? []).join(", "),
      whenAddons: (r.when?.addonIds ?? []).join(", "),
      whenMinQuantity: str(r.when?.minQuantity),
      customerNote: r.customerNote ?? "",
      customerWarning: r.customerWarning ?? "",
      partnerInstructions: r.partnerInstructions ?? "",
      handlingNote: r.handlingNote ?? "",
      internalNote: r.internalNote ?? "",
      active: r.active !== false,
    })),
    variantRequired: Boolean(c.variantRequired),
    internalServiceCode: s?.internalServiceCode ?? "",
    categorySlug: s?.taxonomy?.category?.slug ?? "",
    subcategorySlug: s?.taxonomy?.subcategory?.slug ?? "",
    durationEstimated: str(c.duration?.estimatedMin),
    durationMinRange: str(c.duration?.minMin),
    durationMaxRange: str(c.duration?.maxMin),
    keyBenefits: lines(c.content?.keyBenefits),
    limitations: lines(c.content?.limitations),
    importantNotes: lines(c.content?.importantNotes),
    customerDisclosures: lines(c.content?.customerDisclosures),
    heroImage: c.media?.heroImage ?? "",
    partnerSlotPolicy: s?.partnerSlotPolicy ?? "DURATION",
    displayName: s?.displayName ?? s?.name ?? "",
    capabilityProfile: s?.capabilityProfile ?? "GENERAL",
    durationPrep: str(c.duration?.preparationMin),
    durationService: str(c.duration?.serviceMin),
    durationCleanup: str(c.duration?.cleanupMin),
    durationSlot: str(c.duration?.totalSlotMin),
    minLeadTime: str(c.availability?.minimumLeadTimeMinutes),
    maxAdvanceDays: str(c.availability?.maximumAdvanceDays),
    cancellationPolicy: c.bookingRules?.cancellationPolicy ?? "",
    reschedulePolicy: c.bookingRules?.reschedulePolicy ?? "",
    requiredSkills: (c.providerRequirements?.requiredSkills ?? []).join(", "),
    couponAllowed: c.payment?.couponAllowed !== false,
    walletAllowed: c.payment?.walletAllowed !== false,
    splitPaymentAllowed: c.payment?.splitPaymentAllowed !== false,
    membershipAllowed: c.payment?.membershipAllowed !== false,
    inspectionRequired: Boolean(c.inspectionRequired),
    availableCities: lines(s?.availableCities),
    customerSummary: c.content?.customerSummary ?? "",
    valueProposition: c.content?.valueProposition ?? "",
    highlights: lines(c.content?.highlights),
    process: lines(c.content?.process),
    qualityNotApplicable: Boolean(c.quality?.notApplicable),
    qualityChecklist: lines(c.quality?.checklist),
    proofRequired: Boolean(c.quality?.proofRequired),
    beforeAfterPhotos: Boolean(c.quality?.beforeAfterPhotos),
    warrantyDays: str(c.quality?.warrantyDays),
    ratingWeight: str(c.matching?.ratingWeight),
    distanceWeight: str(c.matching?.distanceWeight),
    availabilityWeight: str(c.matching?.availabilityWeight),
    responseWeight: str(c.matching?.responseWeight),
    completionWeight: str(c.matching?.completionWeight),
    seoNoindex: Boolean(c.seo?.noindex),
    seoTitle: s?.seoTitle ?? "",
    operationsNotes: s?.operationsNotes ?? "",
  };
}

const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
const list = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

/** Drop undefined keys; an object left with no keys becomes undefined (so the key is removed). */
function clean<T extends Record<string, unknown>>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(out).length ? out : undefined;
}
const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

/**
 * Form → API body fields.
 *
 * The saved document is MERGED onto the stored configuration (`base`), not rebuilt from nothing.
 * Rebuilding used to wipe every field this form does not edit — coverage, materials, equipment,
 * variant inclusions and quantity overrides, add-on compatibility, payment timing — on every save.
 * A key this form owns is set or removed; everything else is carried through untouched. Variants and
 * add-ons are merged by id for the same reason.
 */
export function extrasToInput(e: ServiceExtras, base?: ServiceCatalogConfig | null): Partial<ServiceInput> {
  const cfg: ServiceCatalogConfig = { ...(base ?? {}) };
  const put = <K extends keyof ServiceCatalogConfig>(k: K, v: ServiceCatalogConfig[K] | undefined) => {
    if (v === undefined) delete cfg[k];
    else cfg[k] = v;
  };

  put("bookingMode", e.bookingMode || undefined);
  put("comingSoon", e.comingSoon ? true : undefined);
  put("sameDayAvailable", e.sameDayAvailable ? true : undefined);
  put("video", e.video.trim() || undefined);
  put(
    "quantity",
    e.quantityEnabled
      ? clean({
          ...(base?.quantity ?? {}),
          type: e.qType as NonNullable<ServiceCatalogConfig["quantity"]>["type"],
          unitLabel: e.qUnit.trim(),
          unitLabelPlural: e.qUnitPlural.trim() || undefined,
          min: num(e.qMin) ?? 1,
          max: num(e.qMax) ?? 1,
          step: num(e.qStep) ?? 1,
          default: num(e.qDefault),
          unitPrice: num(e.qUnitPrice),
          minimumCharge: num(e.qMinimumCharge),
          durationPerUnitMin: num(e.qDurationPerUnit),
        }) as ServiceCatalogConfig["quantity"]
      : undefined,
  );
  put("audiences", e.audiences.length ? (e.audiences as ServiceCatalogConfig["audiences"]) : undefined);
  put("eligibility", e.eligibility.trim() || undefined);
  put("materialPolicy", (e.materialPolicy || undefined) as ServiceCatalogConfig["materialPolicy"]);
  put("equipmentPolicy", (e.equipmentPolicy || undefined) as ServiceCatalogConfig["equipmentPolicy"]);
  put("sparePartsPolicy", (e.sparePartsPolicy || undefined) as ServiceCatalogConfig["sparePartsPolicy"]);
  put("preparation", list(e.preparation).length ? list(e.preparation) : undefined);
  put("safetyNotes", list(e.safetyNotes).length ? list(e.safetyNotes) : undefined);
  const faqs = e.faqs.filter((f) => f.q.trim() && f.a.trim()).map((f) => ({ q: f.q.trim(), a: f.a.trim() }));
  put("faqs", faqs.length ? faqs : undefined);

  const prevVariants = new Map((base?.variants ?? []).map((v) => [v.id, v]));
  put(
    "variants",
    e.variants.length
      ? e.variants.map(
          (v) =>
            clean({
              ...(prevVariants.get(v.id.trim()) ?? {}),
              id: v.id.trim(),
              name: v.name.trim(),
              price: num(v.price) ?? 0,
              durationMin: num(v.durationMin),
              audiences: v.audiences.length ? (v.audiences as ServiceCatalogConfig["audiences"]) : undefined,
              active: v.active,
            })!,
        )
      : undefined,
  );
  put("variantRequired", e.variantRequired && e.variants.length ? true : undefined);

  // Phase 06: rows → assignments. Unknown keys a newer backend added to an assignment survive via the merge base.
  const prevReqs = new Map((base?.requirements ?? []).map((r) => [r.id, r]));
  // A backend default is written only if it was stored explicitly or the admin chose it over another
  // value — otherwise an untouched save would rewrite the JSON (same meaning) and bump the version.
  const unlessDefault = <T,>(prev: Record<string, unknown> | undefined, key: string, value: T, dflt: T): T | undefined =>
    value === dflt && !(prev && key in prev) ? undefined : value;
  const when = (r: RequirementRow) =>
    clean({
      variantIds: csv(r.whenVariants).length ? csv(r.whenVariants) : undefined,
      addonIds: csv(r.whenAddons).length ? csv(r.whenAddons) : undefined,
      minQuantity: num(r.whenMinQuantity),
    });
  put(
    "requirements",
    e.requirementAssignments.length
      ? e.requirementAssignments.map(
          (r) =>
            clean({
              ...(prevReqs.get(r.id.trim()) ?? {}),
              id: r.id.trim(),
              itemCode: r.itemCode.trim(),
              responsibility: r.responsibility as RequirementAssignment["responsibility"],
              procurement: (r.procurement || undefined) as RequirementAssignment["procurement"],
              charge: unlessDefault(prevReqs.get(r.id.trim()), "charge", r.charge, "NOT_APPLICABLE") as RequirementAssignment["charge"],
              optional: unlessDefault(prevReqs.get(r.id.trim()), "optional", r.optional, false),
              enforcement: unlessDefault(prevReqs.get(r.id.trim()), "enforcement", r.enforcement, "INFORMATIONAL") as RequirementAssignment["enforcement"],
              verification: unlessDefault(prevReqs.get(r.id.trim()), "verification", r.verification, "NONE") as RequirementAssignment["verification"],
              quantity: num(r.quantity),
              unit: r.unit.trim() || undefined,
              quantityBasis: (r.quantityBasis || undefined) as RequirementAssignment["quantityBasis"],
              when: when(r),
              customerNote: r.customerNote.trim() || undefined,
              customerWarning: r.customerWarning.trim() || undefined,
              partnerInstructions: r.partnerInstructions.trim() || undefined,
              handlingNote: r.handlingNote.trim() || undefined,
              internalNote: r.internalNote.trim() || undefined,
              active: r.active,
            })!,
        )
      : undefined,
  );
  // Server-owned facts never round-trip from the editor.
  delete cfg.requirementItems;

  const prevAddons = new Map((base?.addons ?? []).map((a) => [a.id, a]));
  put(
    "addons",
    e.ownAddons
      ? e.addons.map(
          (a) =>
            clean({
              ...(prevAddons.get(a.id.trim()) ?? {}),
              id: a.id.trim(),
              name: a.name.trim(),
              price: num(a.price) ?? 0,
              durationMin: num(a.durationMin),
              maxQuantity: num(a.maxQuantity),
              compatibleVariantIds: csv(a.compatible).length ? csv(a.compatible) : undefined,
              requiresAddonIds: csv(a.requires).length ? csv(a.requires) : undefined,
              conflictsWithAddonIds: csv(a.conflicts).length ? csv(a.conflicts) : undefined,
              active: a.active,
            })!,
        )
      : undefined,
  );

  put(
    "duration",
    clean({
      ...(base?.duration ?? {}),
      estimatedMin: num(e.durationEstimated),
      minMin: num(e.durationMinRange),
      maxMin: num(e.durationMaxRange),
      preparationMin: num(e.durationPrep),
      serviceMin: num(e.durationService),
      cleanupMin: num(e.durationCleanup),
      totalSlotMin: num(e.durationSlot),
    }),
  );
  put(
    "availability",
    clean({
      ...(base?.availability ?? {}),
      minimumLeadTimeMinutes: num(e.minLeadTime),
      maximumAdvanceDays: num(e.maxAdvanceDays),
      sameDay: e.sameDayAvailable || undefined,
    }),
  );
  put(
    "bookingRules",
    clean({
      ...(base?.bookingRules ?? {}),
      cancellationPolicy: e.cancellationPolicy.trim() || undefined,
      reschedulePolicy: e.reschedulePolicy.trim() || undefined,
    }),
  );
  const skills = csv(e.requiredSkills);
  put("providerRequirements", clean({ ...(base?.providerRequirements ?? {}), requiredSkills: skills.length ? skills : undefined }));
  put("inspectionRequired", e.inspectionRequired ? true : undefined);
  put("payment", {
    ...(base?.payment ?? {}),
    couponAllowed: e.couponAllowed,
    walletAllowed: e.walletAllowed,
    splitPaymentAllowed: e.splitPaymentAllowed,
    membershipAllowed: e.membershipAllowed,
  });
  if (e.qualityNotApplicable) {
    put("quality", { notApplicable: true });
  } else {
    const checklist = list(e.qualityChecklist);
    const { notApplicable: _na, ...prevQuality } = base?.quality ?? {};
    put(
      "quality",
      clean({
        ...prevQuality,
        checklist: checklist.length ? checklist : undefined,
        proofRequired: e.proofRequired || undefined,
        beforeAfterPhotos: e.beforeAfterPhotos || undefined,
        warrantyDays: num(e.warrantyDays),
      }),
    );
  }
  put(
    "matching",
    clean({
      ...(base?.matching ?? {}),
      ratingWeight: num(e.ratingWeight),
      distanceWeight: num(e.distanceWeight),
      availabilityWeight: num(e.availabilityWeight),
      responseWeight: num(e.responseWeight),
      completionWeight: num(e.completionWeight),
    }),
  );
  const lines = (s: string) => (list(s).length ? list(s) : undefined);
  put(
    "content",
    clean({
      ...(base?.content ?? {}),
      customerSummary: e.customerSummary.trim() || undefined,
      valueProposition: e.valueProposition.trim() || undefined,
      highlights: lines(e.highlights),
      keyBenefits: lines(e.keyBenefits),
      limitations: lines(e.limitations),
      importantNotes: lines(e.importantNotes),
      customerDisclosures: lines(e.customerDisclosures),
      process: lines(e.process),
    }),
  );
  put("media", clean({ ...(base?.media ?? {}), heroImage: e.heroImage.trim() || undefined }));
  put("seo", clean({ ...(base?.seo ?? {}), noindex: e.seoNoindex || undefined }));

  return {
    slug: e.slug.trim() || undefined,
    displayName: e.displayName.trim() || undefined,
    capabilityProfile: e.capabilityProfile || undefined,
    pricingModel: e.pricingModel,
    thumbnail: e.thumbnail.trim() || undefined,
    minPrice: num(e.minPrice),
    maxPrice: num(e.maxPrice),
    detailedDescription: e.detailedDescription.trim() || undefined,
    includedServices: list(e.includedServices),
    excludedServices: list(e.excludedServices),
    requirements: list(e.requirements),
    availableCities: list(e.availableCities),
    seoTitle: e.seoTitle.trim() || undefined,
    operationsNotes: e.operationsNotes.trim() || undefined,
    internalServiceCode: e.internalServiceCode.trim() || undefined,
    categorySlug: e.categorySlug || null,
    subcategorySlug: e.subcategorySlug || null,
    partnerSlotPolicy: e.partnerSlotPolicy,
    catalogConfig: Object.keys(cfg).length ? cfg : null,
  };
}

/* ------------------------------------------------------------------ */

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode; open?: boolean }) {
  return (
    <section className="sv-config-section">
      <header className="sv-config-section__head">
        <h3>{title}</h3>
        {hint ? <p>{hint}</p> : null}
      </header>
      <div className="sv-config-section__body">{children}</div>
    </section>
  );
}

const EDITOR_NAV = [
  {
    group: "Storefront",
    items: [
      ["identity", "Identity", ["identity"]],
      ["content", "Content & safety", ["content", "safety"]],
      ["audience", "Audience", ["audience"]],
      ["media", "Media", ["media"]],
      ["trust", "Trust", ["trust"]],
      ["reviews", "Reviews", ["reviews"]],
      ["seo", "Search", ["seo"]],
    ],
  },
  {
    group: "Commercial",
    items: [
      ["pricing", "Pricing & time", ["pricing", "quantity", "duration"]],
      ["variants", "Variants & add-ons", ["variants", "addons"]],
      ["payment", "Payment", ["payment"]],
    ],
  },
  {
    group: "Operations",
    items: [
      ["booking", "Booking", ["booking", "availability"]],
      ["coverage", "Coverage", ["coverage"]],
      ["requirements", "Requirements", ["requirements"]],
      ["materials", "Fulfilment", ["materials", "equipment", "provider", "bookingRules"]],
      ["quality", "Quality", ["quality"]],
      ["matching", "Matching", ["matching"]],
      ["operations", "Operations", ["operations"]],
      ["analytics", "Analytics", ["analytics"]],
    ],
  },
] as const;

function Field({ label, children, consumer }: { label: string; children: ReactNode; consumer?: string }) {
  return (
    <label className="sv-field">
      <span>
        {label}
        {consumer ? (
          <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-[var(--color-biz-muted)]">
            {consumer}
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

export function ServiceConfigEditor({
  value: e,
  onChange,
  gaps,
  sections,
  requirementItems,
  onCreateRequirementItem,
  lead,
  footer,
}: {
  value: ServiceExtras;
  onChange: (next: ServiceExtras) => void;
  gaps?: string[];
  sections?: { id: string; label: string; status: "ok" | "warn" | "missing" }[];
  /** Phase 06 catalogue (active items) for the assignment picker. */
  requirementItems?: RequirementItemRow[];
  onCreateRequirementItem?: (input: { code: string; kind: RequirementItemRow["kind"]; name: string; customerLabel?: string | null }) => Promise<void>;
  /** Full-page "Offer" canvas: name, price, shelf flags. */
  lead?: ReactNode;
  /** Shown on every canvas — audit reason, errors, version. */
  footer?: ReactNode;
}) {
  const set = <K extends keyof ServiceExtras>(k: K, v: ServiceExtras[K]) => onChange({ ...e, [k]: v });
  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const [tab, setTab] = useState(lead ? "offer" : "identity");
  const active = tab === "offer" && !lead ? "identity" : tab;

  const worst = (marks: readonly string[]) => {
    const statuses = marks.map((id) => sections?.find((s) => s.id === id)?.status).filter(Boolean);
    if (statuses.includes("missing")) return "missing" as const;
    if (statuses.includes("warn")) return "warn" as const;
    if (statuses.includes("ok")) return "ok" as const;
    return null;
  };

  return (
    <div className="sv-editor">
      <nav className="sv-nav" aria-label="Service sections">
        {lead ? (
          <div className="sv-nav__group">
            <p className="sv-nav__label">Offer</p>
            <button type="button" className={active === "offer" ? "is-on" : ""} onClick={() => setTab("offer")}>
              <span>Basics</span>
            </button>
          </div>
        ) : null}
        {EDITOR_NAV.map((group) => (
          <div key={group.group} className="sv-nav__group">
            <p className="sv-nav__label">{group.group}</p>
            {group.items.map(([id, label, marks]) => {
              const status = worst(marks);
              return (
                <button key={id} type="button" className={active === id ? "is-on" : ""} onClick={() => setTab(id)}>
                  <span>{label}</span>
                  {status === "missing" ? <i className="is-missing" aria-label="Missing" /> : null}
                  {status === "warn" ? <i className="is-warn" aria-label="Needs review" /> : null}
                  {status === "ok" ? <i className="is-ok" aria-label="Complete" /> : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sv-canvas">
      {gaps && gaps.length ? (
        <div className="sv-gaps" role="status">
          <p>Configuration gaps</p>
          <ul>
            {gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {active === "offer" && lead ? (
        <Section title="Offer" hint="What customers see on the shelf: name, price, duration, and whether the SKU is live.">
          {lead}
        </Section>
      ) : null}

      {active === "identity" && (
      <Section title="General" hint="Slug is the public URL and the catalogue binding — change it deliberately." open>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Slug">
            <input className="sv-input" value={e.slug} onChange={(x) => set("slug", x.target.value)} />
          </Field>
          <Field label="Display name">
            <input className="sv-input" value={e.displayName} onChange={(x) => set("displayName", x.target.value)} />
          </Field>
          <Field label="Pricing model">
            <select className="sv-input" value={e.pricingModel} onChange={(x) => set("pricingModel", x.target.value)}>
              {PRICING_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Capability profile">
            <select className="sv-input" value={e.capabilityProfile} onChange={(x) => set("capabilityProfile", x.target.value)}>
              {["GENERAL", "HOME_HELP", "CLEANING", "REPAIR", "APPLIANCE", "BEAUTY", "SENIOR_CARE", "PET_CARE", "CONCIERGE", "VEHICLE"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Customer image (thumbnail URL)">
          <input className="sv-input" value={e.thumbnail} onChange={(x) => set("thumbnail", x.target.value)} placeholder="https://… or /services/…" />
        </Field>
        <Field label="Video URL">
          <input className="sv-input" value={e.video} onChange={(x) => set("video", x.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Detailed description">
          <textarea className="sv-input sv-textarea" rows={3} value={e.detailedDescription} onChange={(x) => set("detailedDescription", x.target.value)} />
        </Field>
      </Section>
      )}

      {active === "pricing" ? (
      <Section title="Pricing & quantity" hint="Customers are always charged what the server calculates from these values.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minimum tier price (₹)">
            <input className="sv-input" type="number" min={0} value={e.minPrice} onChange={(x) => set("minPrice", x.target.value)} />
          </Field>
          <Field label="Maximum tier price (₹)">
            <input className="sv-input" type="number" min={0} value={e.maxPrice} onChange={(x) => set("maxPrice", x.target.value)} />
          </Field>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={e.quantityEnabled} onChange={(x) => set("quantityEnabled", x.target.checked)} />
          Customers choose a quantity (hours, units, seats, area…)
        </label>
        {e.quantityEnabled ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity type">
              <select className="sv-input" value={e.qType} onChange={(x) => set("qType", x.target.value)}>
                {QUANTITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Unit price (₹)">
              <input className="sv-input" type="number" min={0} value={e.qUnitPrice} onChange={(x) => set("qUnitPrice", x.target.value)} placeholder="defaults to base price" />
            </Field>
            <Field label="Unit label (singular)">
              <input className="sv-input" value={e.qUnit} onChange={(x) => set("qUnit", x.target.value)} placeholder="hour, bathroom, seat" />
            </Field>
            <Field label="Unit label (plural)">
              <input className="sv-input" value={e.qUnitPlural} onChange={(x) => set("qUnitPlural", x.target.value)} placeholder="hours, bathrooms" />
            </Field>
            <Field label="Minimum">
              <input className="sv-input" type="number" min={1} value={e.qMin} onChange={(x) => set("qMin", x.target.value)} />
            </Field>
            <Field label="Maximum">
              <input className="sv-input" type="number" min={1} value={e.qMax} onChange={(x) => set("qMax", x.target.value)} />
            </Field>
            <Field label="Step">
              <input className="sv-input" type="number" min={1} value={e.qStep} onChange={(x) => set("qStep", x.target.value)} />
            </Field>
            <Field label="Default">
              <input className="sv-input" type="number" min={1} value={e.qDefault} onChange={(x) => set("qDefault", x.target.value)} />
            </Field>
            <Field label="Minimum charge (₹)">
              <input className="sv-input" type="number" min={0} value={e.qMinimumCharge} onChange={(x) => set("qMinimumCharge", x.target.value)} />
            </Field>
            <Field label="Extra minutes per unit">
              <input className="sv-input" type="number" min={1} value={e.qDurationPerUnit} onChange={(x) => set("qDurationPerUnit", x.target.value)} />
            </Field>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prep minutes (slot)">
            <input className="sv-input" type="number" min={0} value={e.durationPrep} onChange={(x) => set("durationPrep", x.target.value)} />
          </Field>
          <Field label="Service minutes">
            <input className="sv-input" type="number" min={1} value={e.durationService} onChange={(x) => set("durationService", x.target.value)} />
          </Field>
          <Field label="Cleanup minutes">
            <input className="sv-input" type="number" min={0} value={e.durationCleanup} onChange={(x) => set("durationCleanup", x.target.value)} />
          </Field>
          <Field label="Total appointment minutes">
            <input className="sv-input" type="number" min={1} value={e.durationSlot} onChange={(x) => set("durationSlot", x.target.value)} placeholder="must equal prep + service + cleanup" />
          </Field>
          <Field label="Customer estimate (min)">
            <input className="sv-input" type="number" min={1} value={e.durationEstimated} onChange={(x) => set("durationEstimated", x.target.value)} />
          </Field>
          <Field label="Estimate range — shortest / longest">
            <div className="grid grid-cols-2 gap-2">
              <input className="sv-input" type="number" min={1} value={e.durationMinRange} onChange={(x) => set("durationMinRange", x.target.value)} aria-label="Shortest minutes" />
              <input className="sv-input" type="number" min={1} value={e.durationMaxRange} onChange={(x) => set("durationMaxRange", x.target.value)} aria-label="Longest minutes" />
            </div>
          </Field>
        </div>
        <Field label="Partner calendar">
          <select className="sv-input" value={e.partnerSlotPolicy} onChange={(x) => set("partnerSlotPolicy", x.target.value as ServiceExtras["partnerSlotPolicy"])}>
            <option value="DURATION">Block the appointment time (+30 min before and after)</option>
            <option value="FIXED">Fixed 60-minute visit (duration is a turnaround time, e.g. laundry)</option>
          </select>
        </Field>
      </Section>
      ) : null}

      {active === "booking" ? (
      <Section title="Booking">
        <Field label="Booking mode">
          <select className="sv-input" value={e.bookingMode} onChange={(x) => set("bookingMode", x.target.value as ServiceExtras["bookingMode"])}>
            <option value="">Standard (default)</option>
            <option value="STANDARD">Standard</option>
            <option value="HOURLY">Hourly (needs an HOUR quantity)</option>
          </select>
        </Field>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={e.comingSoon} onChange={(x) => set("comingSoon", x.target.checked)} />
          Show as “Coming soon” even while active (Notify me, no booking)
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={e.sameDayAvailable} onChange={(x) => set("sameDayAvailable", x.target.checked)} />
          Same-day available
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={e.inspectionRequired} onChange={(x) => set("inspectionRequired", x.target.checked)} />
          Inspection required
        </label>
        <Field label="Minimum lead time (minutes)">
          <input className="sv-input" type="number" min={0} value={e.minLeadTime} onChange={(x) => set("minLeadTime", x.target.value)} />
        </Field>
        <Field label="Maximum advance days">
          <input className="sv-input" type="number" min={1} value={e.maxAdvanceDays} onChange={(x) => set("maxAdvanceDays", x.target.value)} />
        </Field>
      </Section>
      ) : null}

      {active === "audience" && (
      <Section title="Audience & eligibility" hint="Leave empty for services that are not audience-specific.">
        <div className="flex flex-wrap gap-3">
          {AUDIENCES.map(([id, name]) => (
            <label key={id} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={e.audiences.includes(id)} onChange={() => set("audiences", toggleIn(e.audiences, id))} />
              {name}
            </label>
          ))}
        </div>
        <Field label="Eligibility note">
          <input className="sv-input" value={e.eligibility} onChange={(x) => set("eligibility", x.target.value)} />
        </Field>
        <p className="text-xs text-[var(--color-biz-muted)]">
          Professional preference is not offered: the assignment engine cannot honour a gender preference yet, so customers are never shown one.
        </p>
      </Section>
      )}

      {active === "content" ? (
      <Section title="Content" hint="One item per line. Only what the service really includes — customers see this verbatim.">
        <Field label="Customer summary">
          <textarea className="sv-input sv-textarea" rows={2} value={e.customerSummary} onChange={(x) => set("customerSummary", x.target.value)} />
        </Field>
        <Field label="Value proposition">
          <textarea className="sv-input sv-textarea" rows={2} value={e.valueProposition} onChange={(x) => set("valueProposition", x.target.value)} />
        </Field>
        <Field label="Highlights (one per line)">
          <textarea className="sv-input sv-textarea" rows={3} value={e.highlights} onChange={(x) => set("highlights", x.target.value)} />
        </Field>
        <Field label="Key benefits (one per line)">
          <textarea className="sv-input sv-textarea" rows={3} value={e.keyBenefits} onChange={(x) => set("keyBenefits", x.target.value)} />
        </Field>
        <Field label="Limitations (one per line)">
          <textarea className="sv-input sv-textarea" rows={2} value={e.limitations} onChange={(x) => set("limitations", x.target.value)} />
        </Field>
        <Field label="Important notes (one per line)">
          <textarea className="sv-input sv-textarea" rows={2} value={e.importantNotes} onChange={(x) => set("importantNotes", x.target.value)} />
        </Field>
        <Field label="Customer disclosures — shown verbatim before booking (one per line)">
          <textarea className="sv-input sv-textarea" rows={2} value={e.customerDisclosures} onChange={(x) => set("customerDisclosures", x.target.value)} />
        </Field>
        <Field label="Service process (one per line)">
          <textarea className="sv-input sv-textarea" rows={3} value={e.process} onChange={(x) => set("process", x.target.value)} />
        </Field>
        <Field label="What's included">
          <textarea className="sv-input sv-textarea" rows={4} value={e.includedServices} onChange={(x) => set("includedServices", x.target.value)} />
        </Field>
        <Field label="What's not included">
          <textarea className="sv-input sv-textarea" rows={3} value={e.excludedServices} onChange={(x) => set("excludedServices", x.target.value)} />
        </Field>
        <Field label="Requirements">
          <textarea className="sv-input sv-textarea" rows={3} value={e.requirements} onChange={(x) => set("requirements", x.target.value)} />
        </Field>
        <Field label="Preparation instructions">
          <textarea className="sv-input sv-textarea" rows={3} value={e.preparation} onChange={(x) => set("preparation", x.target.value)} />
        </Field>
        <Field label="Safety notes">
          <textarea className="sv-input sv-textarea" rows={2} value={e.safetyNotes} onChange={(x) => set("safetyNotes", x.target.value)} />
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold">FAQs</span>
          {e.faqs.map((f, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-[var(--color-biz-border)] p-2">
              <input className="sv-input" placeholder="Question" value={f.q} onChange={(x) => set("faqs", e.faqs.map((g, j) => (j === i ? { ...g, q: x.target.value } : g)))} />
              <textarea className="sv-input sv-textarea" rows={2} placeholder="Answer" value={f.a} onChange={(x) => set("faqs", e.faqs.map((g, j) => (j === i ? { ...g, a: x.target.value } : g)))} />
              <button type="button" className="biz-btn self-start text-xs" onClick={() => set("faqs", e.faqs.filter((_, j) => j !== i))}>
                <Trash2 className="h-3 w-3" /> Remove
              </button>
            </div>
          ))}
          <button type="button" className="biz-btn self-start text-xs" onClick={() => set("faqs", [...e.faqs, { q: "", a: "" }])}>
            <Plus className="h-3 w-3" /> Add FAQ
          </button>
        </div>
      </Section>
      ) : null}

      {active === "materials" ? (
      <Section title="Fulfilment" hint="Leave “Not set” unless operations has confirmed it — customers then see “confirmed during booking”.">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Materials" consumer="Customer + partner instructions">
            <select className="sv-input" value={e.materialPolicy} onChange={(x) => set("materialPolicy", x.target.value)}>
              {POLICIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Equipment" consumer="Customer + partner instructions">
            <select className="sv-input" value={e.equipmentPolicy} onChange={(x) => set("equipmentPolicy", x.target.value)}>
              {POLICIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Spare parts">
            <select className="sv-input" value={e.sparePartsPolicy} onChange={(x) => set("sparePartsPolicy", x.target.value)}>
              {SPARE_PARTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Required provider skills (comma-separated slugs)" consumer="Matching + eligibility">
          <input className="sv-input" value={e.requiredSkills} onChange={(x) => set("requiredSkills", x.target.value)} placeholder="ac-repair, electrician" />
        </Field>
        <Field label="Cancellation policy">
          <textarea className="sv-input sv-textarea" rows={2} value={e.cancellationPolicy} onChange={(x) => set("cancellationPolicy", x.target.value)} />
        </Field>
        <Field label="Reschedule policy">
          <textarea className="sv-input sv-textarea" rows={2} value={e.reschedulePolicy} onChange={(x) => set("reschedulePolicy", x.target.value)} />
        </Field>
      </Section>
      ) : null}

      {active === "payment" ? (
      <Section title="Payment" hint="These switches are read by the quote and payment engines. Leave them on unless finance has a reason to block a tender.">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={e.couponAllowed} onChange={(x) => set("couponAllowed", x.target.checked)} />
          Coupons allowed
          <span className="text-[10px] uppercase text-[var(--color-biz-muted)]">Quote engine</span>
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={e.walletAllowed} onChange={(x) => set("walletAllowed", x.target.checked)} />
          Wallet allowed
          <span className="text-[10px] uppercase text-[var(--color-biz-muted)]">Payment engine</span>
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={e.splitPaymentAllowed} onChange={(x) => set("splitPaymentAllowed", x.target.checked)} />
          Split payment allowed
          <span className="text-[10px] uppercase text-[var(--color-biz-muted)]">Payment engine</span>
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={e.membershipAllowed} onChange={(x) => set("membershipAllowed", x.target.checked)} />
          Membership discounts allowed
          <span className="text-[10px] uppercase text-[var(--color-biz-muted)]">Quote engine</span>
        </label>
      </Section>
      ) : null}

      {active === "requirements" ? (
        <RequirementsTab
          rows={e.requirementAssignments}
          items={requirementItems ?? []}
          variantIds={e.variants.map((v) => v.id)}
          addonIds={e.addons.map((a) => a.id)}
          onChange={(rows) => set("requirementAssignments", rows)}
          onCreateItem={onCreateRequirementItem}
        />
      ) : null}

      {active === "variants" ? (
      <>
      <Section title={`Variants (${e.variants.length})`} hint="Each variant has its own price, duration and allowed audiences. Ids: lowercase-with-hyphens.">
        {e.variants.map((v, i) => {
          const upd = (patch: Partial<VariantRow>) => set("variants", e.variants.map((w, j) => (j === i ? { ...w, ...patch } : w)));
          return (
            <div key={i} className="grid gap-2 rounded-lg border border-[var(--color-biz-border)] p-2">
              <div className="grid grid-cols-4 gap-2">
                <input className="sv-input" placeholder="id" value={v.id} onChange={(x) => upd({ id: x.target.value })} aria-label="Variant id" />
                <input className="sv-input col-span-2" placeholder="Name" value={v.name} onChange={(x) => upd({ name: x.target.value })} aria-label="Variant name" />
                <input className="sv-input" type="number" min={0} placeholder="₹" value={v.price} onChange={(x) => upd({ price: x.target.value })} aria-label="Variant price" />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <input className="sv-input w-28" type="number" min={1} placeholder="minutes" value={v.durationMin} onChange={(x) => upd({ durationMin: x.target.value })} aria-label="Variant duration" />
                {AUDIENCES.map(([id, name]) => (
                  <label key={id} className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={v.audiences.includes(id)} onChange={() => upd({ audiences: toggleIn(v.audiences, id) })} />
                    {name}
                  </label>
                ))}
                <label className="inline-flex items-center gap-1">
                  <input type="checkbox" checked={v.active} onChange={(x) => upd({ active: x.target.checked })} /> Active
                </label>
                <button type="button" className="biz-btn text-xs" onClick={() => set("variants", e.variants.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className="biz-btn self-start text-xs"
          onClick={() => set("variants", [...e.variants, { id: "", name: "", price: "", durationMin: "", active: true, audiences: [] }])}
        >
          <Plus className="h-3 w-3" /> Add variant
        </button>
        {e.variants.length > 0 ? (
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={e.variantRequired} onChange={(x) => set("variantRequired", x.target.checked)} />
            Customers must choose a variant (no base-price fallback)
          </label>
        ) : null}
      </Section>

      <Section title="Add-ons" hint="Off = the shared add-on catalogue applies. On = only these add-ons can be booked with this service.">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={e.ownAddons} onChange={(x) => set("ownAddons", x.target.checked)} />
          Use this service’s own add-ons
        </label>
        {e.ownAddons ? (
          <>
            {e.addons.map((a, i) => {
              const upd = (patch: Partial<AddonRow>) => set("addons", e.addons.map((w, j) => (j === i ? { ...w, ...patch } : w)));
              return (
                <div key={i} className="grid gap-2 rounded-lg border border-[var(--color-biz-border)] p-2">
                <div className="grid grid-cols-6 items-center gap-2">
                  <input className="sv-input" placeholder="id" value={a.id} onChange={(x) => upd({ id: x.target.value })} aria-label="Add-on id" />
                  <input className="sv-input col-span-2" placeholder="Name" value={a.name} onChange={(x) => upd({ name: x.target.value })} aria-label="Add-on name" />
                  <input className="sv-input" type="number" min={0} placeholder="₹" value={a.price} onChange={(x) => upd({ price: x.target.value })} aria-label="Add-on price" />
                  <input className="sv-input" type="number" min={1} placeholder="min" value={a.durationMin} onChange={(x) => upd({ durationMin: x.target.value })} aria-label="Add-on minutes" />
                  <div className="flex items-center gap-2 text-xs">
                    <label className="inline-flex items-center gap-1">
                      <input type="checkbox" checked={a.active} onChange={(x) => upd({ active: x.target.checked })} /> Active
                    </label>
                    <button type="button" className="biz-btn text-xs" onClick={() => set("addons", e.addons.filter((_, j) => j !== i))} aria-label="Remove add-on">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <input className="sv-input" placeholder="only with variants (ids)" value={a.compatible} onChange={(x) => upd({ compatible: x.target.value })} aria-label="Compatible variant ids" />
                  <input className="sv-input" placeholder="requires add-ons (ids)" value={a.requires} onChange={(x) => upd({ requires: x.target.value })} aria-label="Required add-on ids" />
                  <input className="sv-input" placeholder="conflicts with (ids)" value={a.conflicts} onChange={(x) => upd({ conflicts: x.target.value })} aria-label="Conflicting add-on ids" />
                  <input className="sv-input" type="number" min={1} max={100} placeholder="max units" value={a.maxQuantity} onChange={(x) => upd({ maxQuantity: x.target.value })} aria-label="Maximum units" />
                </div>
                </div>
              );
            })}
            <button
              type="button"
              className="biz-btn self-start text-xs"
              onClick={() => set("addons", [...e.addons, { id: "", name: "", price: "", durationMin: "", active: true, compatible: "", requires: "", conflicts: "", maxQuantity: "" }])}
            >
              <Plus className="h-3 w-3" /> Add add-on
            </button>
          </>
        ) : null}
      </Section>
      </>
      ) : null}

      {active === "coverage" ? (
        <Section title="Coverage" hint="Empty means coverage is not restricted here — the geo engine still decides serviceability at booking." open>
          <Field label="Available cities (one per line)">
            <textarea className="sv-input sv-textarea" rows={4} value={e.availableCities} onChange={(x) => set("availableCities", x.target.value)} />
          </Field>
        </Section>
      ) : null}

      {active === "quality" ? (
        <Section title="Quality" hint="Enforced at partner job completion for FUTURE bookings. Historical jobs keep their snapshot." open>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={e.qualityNotApplicable} onChange={(x) => set("qualityNotApplicable", x.target.checked)} />
            Warranty / revisit not applicable
          </label>
          <Field label="Completion checklist (one item per line)" consumer="Partner job execution">
            <textarea className="sv-input sv-textarea" rows={4} value={e.qualityChecklist} onChange={(x) => set("qualityChecklist", x.target.value)} />
          </Field>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={e.proofRequired} onChange={(x) => set("proofRequired", x.target.checked)} />
            Proof required
            <span className="text-[10px] uppercase text-[var(--color-biz-muted)]">Completion gate</span>
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={e.beforeAfterPhotos} onChange={(x) => set("beforeAfterPhotos", x.target.checked)} />
            Before / after photos
            <span className="text-[10px] uppercase text-[var(--color-biz-muted)]">Completion gate</span>
          </label>
          <Field label="Warranty days" consumer="Booking snapshot">
            <input className="sv-input" type="number" min={0} value={e.warrantyDays} onChange={(x) => set("warrantyDays", x.target.value)} />
          </Field>
        </Section>
      ) : null}

      {active === "matching" ? (
        <Section title="Matching" hint="Weights apply only when at least one is set. Unset keeps the historical 30/25/20/15/10 points. Skill is a hard eligibility filter, not a score weight." open>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rating weight (0–1)" consumer="Matching engine">
              <input className="sv-input" type="number" min={0} max={1} step={0.05} value={e.ratingWeight} onChange={(x) => set("ratingWeight", x.target.value)} />
            </Field>
            <Field label="Distance weight (0–1)" consumer="Matching engine">
              <input className="sv-input" type="number" min={0} max={1} step={0.05} value={e.distanceWeight} onChange={(x) => set("distanceWeight", x.target.value)} />
            </Field>
            <Field label="Availability weight (0–1)" consumer="Matching engine">
              <input className="sv-input" type="number" min={0} max={1} step={0.05} value={e.availabilityWeight} onChange={(x) => set("availabilityWeight", x.target.value)} />
            </Field>
            <Field label="Response weight (0–1)" consumer="Matching engine">
              <input className="sv-input" type="number" min={0} max={1} step={0.05} value={e.responseWeight} onChange={(x) => set("responseWeight", x.target.value)} />
            </Field>
            <Field label="Completion weight (0–1)" consumer="Matching engine">
              <input className="sv-input" type="number" min={0} max={1} step={0.05} value={e.completionWeight} onChange={(x) => set("completionWeight", x.target.value)} />
            </Field>
          </div>
        </Section>
      ) : null}

      {active === "media" ? (
        <Section title="Media" hint="Customer thumbnail and video. Missing media keeps the existing visual fallback." open>
          <Field label="Customer image (thumbnail URL)">
            <input className="sv-input" value={e.thumbnail} onChange={(x) => set("thumbnail", x.target.value)} />
          </Field>
          <Field label="Hero image URL (https:// or /path)">
            <input className="sv-input" value={e.heroImage} onChange={(x) => set("heroImage", x.target.value)} />
          </Field>
          <Field label="Video URL (https:// or /path)">
            <input className="sv-input" value={e.video} onChange={(x) => set("video", x.target.value)} />
          </Field>
        </Section>
      ) : null}

      {active === "trust" ? (
        <Section title="Trust" hint="Badges are only shown when real verification data exists. Do not type marketing claims here." open>
          <p className="text-sm text-[var(--color-biz-muted)]">
            Background-verified and similar badges are derived from partner KYC / compliance, not from this form.
          </p>
        </Section>
      ) : null}

      {active === "reviews" ? (
        <Section title="Reviews" hint="Read-only. Rating is the aggregate of real booking reviews." open>
          <p className="text-sm text-[var(--color-biz-muted)]">
            Average rating and review count come from the ratings table. Services with no reviews show no rating — never a placeholder 4.8.
          </p>
        </Section>
      ) : null}

      {active === "seo" ? (
        <Section title="SEO" open>
          <Field label="SEO title">
            <input className="sv-input" value={e.seoTitle} onChange={(x) => set("seoTitle", x.target.value)} />
          </Field>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={e.seoNoindex} onChange={(x) => set("seoNoindex", x.target.checked)} />
            noindex (coming soon / incomplete stay noindex by default)
          </label>
        </Section>
      ) : null}

      {active === "analytics" ? (
        <Section title="Analytics" hint="Read-only. Derived from bookings and events, not editable SKU fields." open>
          <p className="text-sm text-[var(--color-biz-muted)]">
            Conversion, cancellation and revenue stay in the booking/payment metrics. They are not stored as catalogue truth.
          </p>
        </Section>
      ) : null}

      {active === "operations" ? (
        <Section title="Operations" open>
          <Field label="Capability profile">
            <select className="sv-input" value={e.capabilityProfile} onChange={(x) => set("capabilityProfile", x.target.value)}>
              {["GENERAL", "HOME_HELP", "CLEANING", "REPAIR", "APPLIANCE", "BEAUTY", "SENIOR_CARE", "PET_CARE", "CONCIERGE", "VEHICLE"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Operations notes (internal — never sent to customers)">
            <textarea className="sv-input sv-textarea" rows={3} value={e.operationsNotes} onChange={(x) => set("operationsNotes", x.target.value)} />
          </Field>
        </Section>
      ) : null}
      {footer ? <div className="sv-canvas__foot">{footer}</div> : null}
      </div>
    </div>
  );
}

const RESPONSIBILITIES = ["PROFESSIONAL", "CUSTOMER", "PLATFORM", "SHARED", "UNKNOWN"] as const;
const CHARGES = ["NOT_APPLICABLE", "INCLUDED", "CHARGEABLE", "SEPARATE_QUOTE"] as const;
const ENFORCEMENTS = ["INFORMATIONAL", "WARNING", "REQUIRED_BEFORE_BOOKING", "REQUIRED_BEFORE_ARRIVAL", "REQUIRED_AT_START"] as const;
const VERIFICATIONS = ["NONE", "CUSTOMER_ATTESTATION", "PARTNER_CHECK"] as const;
const KIND_LABEL: Record<RequirementItemRow["kind"], string> = { MATERIAL: "Material", EQUIPMENT: "Equipment", CUSTOMER_PRECONDITION: "Customer precondition" };

const emptyRequirement = (item: RequirementItemRow): RequirementRow => ({
  id: item.code,
  itemCode: item.code,
  responsibility: item.kind === "CUSTOMER_PRECONDITION" ? "CUSTOMER" : "UNKNOWN",
  procurement: "",
  charge: "NOT_APPLICABLE",
  optional: false,
  enforcement: "INFORMATIONAL",
  verification: "NONE",
  quantity: "",
  unit: "",
  quantityBasis: "",
  whenVariants: "",
  whenAddons: "",
  whenMinQuantity: "",
  customerNote: "",
  customerWarning: "",
  partnerInstructions: "",
  handlingNote: "",
  internalNote: "",
  active: true,
});

/**
 * Phase 06 — assignments of catalogue items to this service. Nothing is pre-filled: a new assignment
 * starts as responsibility UNKNOWN (the publish gate refuses it until an admin decides), and the
 * catalogue only contains items an admin created.
 */
function RequirementsTab({
  rows,
  items,
  variantIds,
  addonIds,
  onChange,
  onCreateItem,
}: {
  rows: RequirementRow[];
  items: RequirementItemRow[];
  variantIds: string[];
  addonIds: string[];
  onChange: (rows: RequirementRow[]) => void;
  onCreateItem?: (input: { code: string; kind: RequirementItemRow["kind"]; name: string; customerLabel?: string | null }) => Promise<void>;
}) {
  const [pick, setPick] = useState("");
  const [draft, setDraft] = useState({ code: "", kind: "MATERIAL" as RequirementItemRow["kind"], name: "", customerLabel: "" });
  const [creating, setCreating] = useState(false);
  const byCode = new Map(items.map((i) => [i.code, i]));
  const upd = (i: number, patch: Partial<RequirementRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-3">
      <Section title="Requirements" hint="What this service needs: materials, equipment and customer preconditions, each with who provides it, who procures it and how it is charged. Only configured requirements are shown to customers and partners." open>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select className="sv-input" value={pick} onChange={(x) => setPick(x.target.value)} aria-label="Catalogue item">
            <option value="">Add from catalogue…</option>
            {items.filter((i) => i.isActive).map((i) => (
              <option key={i.code} value={i.code}>
                {KIND_LABEL[i.kind]} · {i.name} ({i.code})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="biz-btn text-xs"
            disabled={!pick}
            onClick={() => {
              const item = byCode.get(pick);
              if (!item) return;
              const id = rows.some((r) => r.id === item.code) ? item.code + "-" + (rows.length + 1) : item.code;
              onChange([...rows, { ...emptyRequirement(item), id }]);
              setPick("");
            }}
            aria-label="Add requirement"
          >
            <Plus className="h-3 w-3" /> Assign
          </button>
        </div>
        {rows.length === 0 ? <p className="text-xs text-[var(--color-biz-muted)]">No requirements configured. Customers see no preparation section for this service.</p> : null}
        {rows.map((r, i) => {
          const item = byCode.get(r.itemCode);
          const precondition = item?.kind === "CUSTOMER_PRECONDITION";
          return (
            <div key={i} className="grid gap-2 rounded-lg border border-[var(--color-biz-border)] p-2 text-xs" data-testid="requirement-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {item ? KIND_LABEL[item.kind] + " · " + item.name : "Unknown item " + r.itemCode}
                  {item && !item.isActive ? <span className="ml-2 text-[var(--color-biz-warning,#d97706)]">archived item</span> : null}
                </p>
                <div className="flex items-center gap-2">
                  <input className="sv-input w-40" value={r.id} onChange={(x) => upd(i, { id: x.target.value })} aria-label="Requirement id" />
                  <label className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={r.active} onChange={(x) => upd(i, { active: x.target.checked })} /> Active
                  </label>
                  <button type="button" className="biz-btn text-xs" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove requirement">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Field label="Who provides it">
                  <select className="sv-input" value={r.responsibility} onChange={(x) => upd(i, { responsibility: x.target.value })} aria-label="Responsibility" disabled={precondition}>
                    {RESPONSIBILITIES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Field>
                {!precondition ? (
                  <>
                    <Field label="Who procures it if missing">
                      <select className="sv-input" value={r.procurement} onChange={(x) => upd(i, { procurement: x.target.value })} aria-label="Procurement">
                        <option value="">Same as provider</option>
                        {["CUSTOMER", "PROFESSIONAL", "PLATFORM"].map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </Field>
                    <Field label="Charge">
                      <select className="sv-input" value={r.charge} onChange={(x) => upd(i, { charge: x.target.value })} aria-label="Charge">
                        {CHARGES.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </Field>
                  </>
                ) : null}
                <Field label="Enforcement">
                  <select className="sv-input" value={r.enforcement} onChange={(x) => upd(i, { enforcement: x.target.value, ...(x.target.value === "REQUIRED_BEFORE_BOOKING" ? { verification: "CUSTOMER_ATTESTATION" } : {}) })} aria-label="Enforcement">
                    {ENFORCEMENTS.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Verification">
                  <select className="sv-input" value={r.verification} onChange={(x) => upd(i, { verification: x.target.value })} aria-label="Verification">
                    {VERIFICATIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Field>
                <label className="inline-flex items-center gap-1 self-end">
                  <input type="checkbox" checked={r.optional} onChange={(x) => upd(i, { optional: x.target.checked })} /> Optional
                </label>
              </div>
              {!precondition ? (
                <div className="grid grid-cols-3 gap-2">
                  <input className="sv-input" type="number" min={0} step="0.001" placeholder="quantity" value={r.quantity} onChange={(x) => upd(i, { quantity: x.target.value })} aria-label="Requirement quantity" />
                  <input className="sv-input" placeholder="unit (e.g. litre)" value={r.unit} onChange={(x) => upd(i, { unit: x.target.value })} aria-label="Requirement unit" />
                  <select className="sv-input" value={r.quantityBasis} onChange={(x) => upd(i, { quantityBasis: x.target.value })} aria-label="Quantity basis">
                    <option value="">no quantity basis</option>
                    <option value="PER_BOOKING">PER_BOOKING</option>
                    <option value="PER_SELECTED_UNIT">PER_SELECTED_UNIT</option>
                  </select>
                </div>
              ) : null}
              <div className="grid grid-cols-3 gap-2">
                <input className="sv-input" placeholder={"only with variants (" + (variantIds.join(", ") || "none") + ")"} value={r.whenVariants} onChange={(x) => upd(i, { whenVariants: x.target.value })} aria-label="Condition variant ids" />
                <input className="sv-input" placeholder={"only with add-ons (" + (addonIds.join(", ") || "none") + ")"} value={r.whenAddons} onChange={(x) => upd(i, { whenAddons: x.target.value })} aria-label="Condition add-on ids" />
                <input className="sv-input" type="number" min={1} placeholder="only from quantity" value={r.whenMinQuantity} onChange={(x) => upd(i, { whenMinQuantity: x.target.value })} aria-label="Condition minimum quantity" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className="sv-input" placeholder="Customer note (shown to customers)" value={r.customerNote} onChange={(x) => upd(i, { customerNote: x.target.value })} aria-label="Customer note" />
                <input className="sv-input" placeholder="Customer warning (shown to customers)" value={r.customerWarning} onChange={(x) => upd(i, { customerWarning: x.target.value })} aria-label="Customer warning" />
                <input className="sv-input" placeholder="Partner instructions (partners only)" value={r.partnerInstructions} onChange={(x) => upd(i, { partnerInstructions: x.target.value })} aria-label="Partner instructions" />
                <input className="sv-input" placeholder="Handling note (partners only)" value={r.handlingNote} onChange={(x) => upd(i, { handlingNote: x.target.value })} aria-label="Handling note" />
                <input className="sv-input col-span-2" placeholder="Internal note (admins only)" value={r.internalNote} onChange={(x) => upd(i, { internalNote: x.target.value })} aria-label="Internal note" />
              </div>
            </div>
          );
        })}
      </Section>
      {onCreateItem ? (
        <Section title="New catalogue item" hint="Items are reusable across services. Archive, never delete.">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <input className="sv-input" placeholder="code (e.g. steam-cleaner)" value={draft.code} onChange={(x) => setDraft({ ...draft, code: x.target.value })} aria-label="Item code" />
            <select className="sv-input" value={draft.kind} onChange={(x) => setDraft({ ...draft, kind: x.target.value as RequirementItemRow["kind"] })} aria-label="Item kind">
              {(Object.keys(KIND_LABEL) as RequirementItemRow["kind"][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <input className="sv-input" placeholder="Name (partners see this)" value={draft.name} onChange={(x) => setDraft({ ...draft, name: x.target.value })} aria-label="Item name" />
            <input className="sv-input" placeholder="Customer label (optional)" value={draft.customerLabel} onChange={(x) => setDraft({ ...draft, customerLabel: x.target.value })} aria-label="Item customer label" />
            <button
              type="button"
              className="biz-btn text-xs"
              disabled={creating || !draft.code.trim() || !draft.name.trim()}
              onClick={async () => {
                setCreating(true);
                try {
                  await onCreateItem({ code: draft.code.trim(), kind: draft.kind, name: draft.name.trim(), customerLabel: draft.customerLabel.trim() || null });
                  setDraft({ code: "", kind: draft.kind, name: "", customerLabel: "" });
                } finally {
                  setCreating(false);
                }
              }}
              aria-label="Create catalogue item"
            >
              <Plus className="h-3 w-3" /> Create item
            </button>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

