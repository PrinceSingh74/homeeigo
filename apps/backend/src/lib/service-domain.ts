/**
 * Service Domain — lifecycle, capability profiles, publish validation, and
 * audience-specific views. Pricing still lives in service-catalog-config.ts
 * (`resolveSelection`); this module does not calculate money.
 *
 * Hybrid model:
 *   Relational columns on `services`  → identity, lifecycle, visibility, version
 *   `service_variants` / `service_addons` → queryable options (hydrate into resolveSelection)
 *   Typed JSON `catalog_config`       → quantity, policies, content, JSON fallback for options
 *   Derived at read time              → ratings, review counts, bookability
 */

import { validateServiceRequirements } from "./service-requirements";
import { validateExecutionPlan } from "./service-execution";
import { buildSafetySnapshot } from "./service-safety";
import { buildWarrantySnapshot } from "./service-warranty";
import {
  catalogConfigGaps,
  parseCatalogConfig,
  publicCatalogConfig,
  resolveServiceDuration,
  resolveServiceSelection,
  type ResolvedDuration,
  type ServiceCatalogConfig,
} from "./service-catalog-config";
import { SUPPORTED_CURRENCIES } from "./pricing-policy";
import { paymentCapabilities, qualitySnapshot } from "./service-runtime-policy";
import type { Prisma } from "@prisma/client";

export const SERVICE_LIFECYCLE = [
  "DRAFT",
  "CONFIGURATION_REQUIRED",
  "READY_FOR_REVIEW",
  "PUBLISHED",
  "ACTIVE",
  "PAUSED",
  "DEPRECATED",
  "ARCHIVED",
] as const;

export const SERVICE_CONFIG_STATUSES = [
  "READY",
  "CONFIGURATION_REQUIRED",
  "COMING_SOON",
  "PAUSED",
  "ARCHIVED",
  "INTERNAL",
] as const;

export const CAPABILITY_PROFILES = [
  "GENERAL",
  "HOME_HELP",
  "CLEANING",
  "REPAIR",
  "APPLIANCE",
  "BEAUTY",
  "SENIOR_CARE",
  "PET_CARE",
  "CONCIERGE",
  "VEHICLE",
] as const;

export type ServiceLifecycleStatus = (typeof SERVICE_LIFECYCLE)[number];
export type ServiceConfigStatus = (typeof SERVICE_CONFIG_STATUSES)[number];
export type CapabilityProfile = (typeof CAPABILITY_PROFILES)[number];

export type ServiceDomainCore = {
  id: string;
  name: string;
  slug: string;
  description: string;
  detailedDescription?: string | null;
  category: string;
  subcategory?: string | null;
  basePrice: number;
  minPrice: number | null;
  maxPrice: number | null;
  estimatedDuration: number;
  pricingModel: string;
  isActive: boolean;
  includedServices?: string[];
  excludedServices?: string[];
  requirements?: string[];
  availableCities?: string[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoKeywords?: string | null;
  catalogConfig?: unknown;
  serviceCode?: string | null;
  internalServiceCode?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  dataOrigin?: string | null;
  currency?: string | null;
  displayName?: string | null;
  capabilityProfile?: string | null;
  lifecycleStatus?: string | null;
  configStatus?: string | null;
  isCustomerVisible?: boolean | null;
  isBookable?: boolean | null;
  version?: number | null;
  ownerTeam?: string | null;
  operationsNotes?: string | null;
  lastReviewedAt?: Date | null;
  publishedAt?: Date | null;
  createdBy?: string | null;
  updatedBy?: string | null;
};

export type PublishIssue = { code: string; path: string; message: string };

export type SectionStatus = "ok" | "warn" | "missing";

export type ConfigSection = {
  id: string;
  label: string;
  status: SectionStatus;
  issues: string[];
};

const PROFILE_BY_CATEGORY: Record<string, CapabilityProfile> = {
  cleaning: "CLEANING",
  beauty: "BEAUTY",
  salon: "BEAUTY",
  repair: "REPAIR",
  appliance: "APPLIANCE",
  "appliance-repair": "APPLIANCE",
  care: "SENIOR_CARE",
  "senior-care": "SENIOR_CARE",
  pet: "PET_CARE",
  "pet-care": "PET_CARE",
  concierge: "CONCIERGE",
  vehicle: "VEHICLE",
  home: "HOME_HELP",
  "home-help": "HOME_HELP",
};

export function inferCapabilityProfile(category: string): CapabilityProfile {
  return PROFILE_BY_CATEGORY[category.trim().toLowerCase()] ?? "GENERAL";
}

export function parseLifecycle(raw: string | null | undefined): ServiceLifecycleStatus {
  if (raw && (SERVICE_LIFECYCLE as readonly string[]).includes(raw)) return raw as ServiceLifecycleStatus;
  return "DRAFT";
}

/** Lifecycles that must never appear in customer search, partner onboarding, or matching catalogues. */
export const NON_PUBLIC_LIFECYCLES = ["ARCHIVED", "DEPRECATED", "DRAFT", "CONFIGURATION_REQUIRED"] as const;

/**
 * Provenance labels that are never commercial truth: fixture, test, certification and synthetic
 * rows (declared or inferred). NULL means unknown and is treated as real, as everywhere else.
 */
export const NON_COMMERCIAL_ORIGINS = [
  "FIXTURE",
  "TEST",
  "CERTIFICATION",
  "SYNTHETIC",
  "INFERRED_FIXTURE",
  "INFERRED_TEST",
  "INFERRED_CERTIFICATION",
  "INFERRED_SYNTHETIC",
] as const;

/** Under AND so callers that set their own top-level OR (search, city filters) do not replace it. */
// Frozen: every guard below shares this AND array by reference, so a caller's `where.AND.push(…)`
// would silently change the filter for every other caller. Frozen, it throws instead.
const COMMERCIAL_ORIGIN_ONLY: Prisma.ServiceWhereInput = {
  AND: Object.freeze([
    Object.freeze({ OR: [{ dataOrigin: null }, { dataOrigin: { notIn: [...NON_COMMERCIAL_ORIGINS] } }] }),
  ]) as Prisma.ServiceWhereInput[],
};

export function isCommercialOrigin(origin: string | null | undefined): boolean {
  return origin == null || !(NON_COMMERCIAL_ORIGINS as readonly string[]).includes(origin);
}

/**
 * Prisma `where` for customer-facing catalogue reads. Keep this the only public filter —
 * list, detail, search, featured, recommendations, and AI context must all use it.
 */
export const CUSTOMER_CATALOG_WHERE: Prisma.ServiceWhereInput = {
  ...COMMERCIAL_ORIGIN_ONLY,
  isActive: true,
  isCustomerVisible: true,
  lifecycleStatus: { notIn: [...NON_PUBLIC_LIFECYCLES] },
  configStatus: { not: "INTERNAL" },
};

/**
 * Prisma `where` for partner capability / onboarding. Partners need bookable operational
 * SKUs, including ones that are not yet customer-visible, but never INTERNAL / draft / archived.
 */
export const PARTNER_OPERATIONAL_WHERE: Prisma.ServiceWhereInput = {
  ...COMMERCIAL_ORIGIN_ONLY,
  isActive: true,
  isBookable: true,
  lifecycleStatus: { notIn: [...NON_PUBLIC_LIFECYCLES] },
  configStatus: { not: "INTERNAL" },
};

export function isPartnerOperationalService(
  service: Pick<ServiceDomainCore, "isActive" | "isBookable" | "lifecycleStatus" | "configStatus" | "dataOrigin">,
): boolean {
  if (!isCommercialOrigin(service.dataOrigin)) return false;
  if (service.isActive === false) return false;
  if (service.isBookable === false) return false;
  if (service.configStatus === "INTERNAL") return false;
  const lifecycle = parseLifecycle(service.lifecycleStatus ?? (service.isActive ? "ACTIVE" : "PAUSED"));
  return !(NON_PUBLIC_LIFECYCLES as readonly string[]).includes(lifecycle);
}

export function parseProfile(raw: string | null | undefined, category: string): CapabilityProfile {
  if (raw && (CAPABILITY_PROFILES as readonly string[]).includes(raw)) return raw as CapabilityProfile;
  return inferCapabilityProfile(category);
}

/**
 * Can this service actually be priced from its authoritative configuration? Asked through THE
 * resolver (never a parallel check): the default selection must resolve to a positive price — or,
 * when the service sells variants, at least one active variant must. Missing configuration is
 * reported, never filled in: an unpriced service is simply not bookable.
 */
export function pricingReadiness(
  service: Pick<ServiceDomainCore, "basePrice" | "minPrice" | "maxPrice" | "estimatedDuration" | "pricingModel" | "currency">,
  cfg: ServiceCatalogConfig | null,
): { ok: true } | { ok: false; missing: string[] } {
  if (service.currency != null && !SUPPORTED_CURRENCIES.includes(service.currency)) {
    return { ok: false, missing: [`currency ${service.currency} is not supported`] };
  }
  const rule = cfg?.quantity && cfg.quantity.type !== "NONE" ? cfg.quantity : null;
  const quantity = rule ? (rule.default ?? rule.min) : undefined;
  const variants = (cfg?.variants ?? []).filter((v) => v.active);
  const candidates = variants.length
    ? variants.map((v) => ({ variantId: v.id, quantity, audience: v.audiences?.[0] ?? cfg?.audiences?.[0] }))
    : [{ quantity }];
  const missing = new Set<string>();
  for (const c of candidates) {
    const r = resolveServiceSelection(service, cfg, c);
    if (r.ok && r.servicePricePaise > 0) return { ok: true };
    if (!r.ok) for (const i of r.issues) missing.add(i.code === "PRICING_CONFIG_MISSING" ? "price" : `${i.field}: ${i.code}`);
  }
  return { ok: false, missing: [...missing] };
}

/** Reasons a customer must not be charged / booked. Empty = bookable from a config standpoint. */
export function blockingBookabilityIssues(service: ServiceDomainCore, cfg: ServiceCatalogConfig | null): PublishIssue[] {
  const issues: PublishIssue[] = [];
  const push = (code: string, path: string, message: string) => issues.push({ code, path, message });

  if (!(service.basePrice > 0) && service.pricingModel !== "quote" && service.pricingModel !== "inspection") {
    push("PRICING_MISSING", "basePrice", "pricingModel missing a positive base price");
  }
  if (!(service.estimatedDuration > 0) && !cfg?.duration?.totalSlotMin && !cfg?.duration?.serviceMin) {
    push("DURATION_MISSING", "estimatedDuration", "duration missing");
  }
  if (["hourly", "per-unit", "per-seat", "area"].includes(service.pricingModel) && !cfg?.quantity) {
    push("QUANTITY_MISSING", "quantity", `Pricing model "${service.pricingModel}" has no quantity rule`);
  }
  // A coming-soon service may be published without prices; anything bookable must price.
  if (!cfg?.comingSoon) {
    const pr = pricingReadiness(service, cfg);
    if (!pr.ok) push("PRICING_INCOMPLETE", "pricing", `Pricing is incomplete: ${pr.missing.join(", ")}`);
  }
  if (service.pricingModel === "hourly" && cfg?.quantity && cfg.quantity.type !== "HOUR") {
    push("QUANTITY_TYPE", "quantity.type", 'Pricing model "hourly" needs an HOUR quantity rule');
  }
  if (cfg?.bookingMode === "HOURLY" && cfg.quantity?.type !== "HOUR") {
    push("QUANTITY_TYPE", "quantity", "HOURLY booking mode needs an HOUR quantity rule");
  }
  // Phase 06: configured requirements must be internally consistent (unset requirements are fine).
  for (const r of validateServiceRequirements(cfg)) push(r.code, r.requirement ? `requirements.${r.requirement}` : "requirements", r.message);
  // Phase 10 §7: an execution plan must be structurally sound (unset plans are fine).
  for (const e of validateExecutionPlan(cfg)) push(e.code, e.step ? `execution.${e.step}` : "execution", e.message);
  return issues;
}

function profileIssues(profile: CapabilityProfile, service: ServiceDomainCore, cfg: ServiceCatalogConfig | null): PublishIssue[] {
  const issues: PublishIssue[] = [];
  const push = (code: string, path: string, message: string) => issues.push({ code, path, message });

  if (profile === "BEAUTY") {
    if (!cfg?.audiences?.length) push("AUDIENCE_MISSING", "audiences", "BEAUTY_PROFILE requires audience eligibility");
    if (!cfg?.variants?.some((v) => v.active !== false)) push("VARIANT_MISSING", "variants", "BEAUTY_PROFILE requires at least one active variant");
  }
  if (profile === "HOME_HELP") {
    if (cfg?.quantity?.type !== "HOUR") push("QUANTITY_TYPE", "quantity", "HOME_HELP_PROFILE requires an HOUR quantity rule");
  }
  if (profile === "CLEANING") {
    if (!cfg?.quantity && service.pricingModel !== "fixed" && service.pricingModel !== "package") {
      push("QUANTITY_MISSING", "quantity", "CLEANING_PROFILE needs a quantity rule for this pricing model");
    }
  }
  if (profile === "REPAIR" || profile === "APPLIANCE") {
    const modes = cfg?.bookingModes ?? [];
    const inspection = cfg?.inspectionRequired || service.pricingModel === "inspection" || service.pricingModel === "quote" || modes.includes("INSPECTION") || modes.includes("CUSTOM_QUOTE");
    if (!inspection && service.pricingModel !== "fixed") {
      push("INSPECTION_OR_QUOTE", "bookingModes", "REPAIR_PROFILE should declare inspection or custom quote when not a fixed price");
    }
  }
  if (profile === "SENIOR_CARE" || profile === "PET_CARE") {
    if (cfg?.quantity?.type !== "HOUR" && service.pricingModel !== "fixed") {
      push("QUANTITY_TYPE", "quantity", "CARE_PROFILE needs duration (HOUR) when not a fixed visit");
    }
  }
  if (!cfg?.materialPolicy) push("MATERIALS_POLICY", "materialPolicy", "Materials policy not specified");
  if (!cfg?.equipmentPolicy) push("EQUIPMENT_POLICY", "equipmentPolicy", "Equipment policy not specified");
  return issues;
}

/**
 * Gate for first-time activation. Advisory profile gaps do not un-publish a
 * grandfathered ACTIVE row — only blocking bookability issues do that.
 */
export function validateForActivation(
  service: ServiceDomainCore,
  cfg: ServiceCatalogConfig | null,
  opts: { grandfathered?: boolean } = {},
): { ok: true } | { ok: false; code: "SERVICE_NOT_BOOKABLE"; issues: PublishIssue[] } {
  const blocking = [...blockingBookabilityIssues(service, cfg), ...contentIssues(service)];
  const profile = parseProfile(service.capabilityProfile, service.category);
  const extra = opts.grandfathered ? [] : [...profileIssues(profile, service, cfg), ...taxonomyIssues(service)];
  const issues = [...blocking, ...extra];
  if (issues.length) return { ok: false, code: "SERVICE_NOT_BOOKABLE", issues };
  return { ok: true };
}

/**
 * Customer content a LIVE service cannot be without. Only what the product already treats as
 * mandatory: a name and a description (both required on create). Scope lists are NOT required —
 * the customer detail page has an approved fallback ("Details will be confirmed during booking").
 */
export function contentIssues(service: Pick<ServiceDomainCore, "name" | "description">): PublishIssue[] {
  const issues: PublishIssue[] = [];
  if (!service.name?.trim()) issues.push({ code: "CONTENT_TITLE_MISSING", path: "name", message: "Service name is missing" });
  if (!service.description?.trim()) {
    issues.push({ code: "CONTENT_DESCRIPTION_MISSING", path: "description", message: "Customer description is missing" });
  }
  return issues;
}

/** A newly published service must sit somewhere in the customer taxonomy. */
export function taxonomyIssues(service: Pick<ServiceDomainCore, "categoryId">): PublishIssue[] {
  if (service.categoryId === undefined) return []; // caller did not load taxonomy; the DB trigger still derives it
  return service.categoryId
    ? []
    : [{ code: "TAXONOMY_MISSING", path: "categoryId", message: "Service is not in any customer category" }];
}

/* ------------------------------------------------------------------ */
/* Lifecycle transitions                                               */
/* ------------------------------------------------------------------ */

/**
 * Allowed lifecycle moves. Mapping to the requested lifecycle vocabulary:
 *   DRAFT = DRAFT, VALIDATING = CONFIGURATION_REQUIRED, REVIEW = READY_FOR_REVIEW,
 *   LIVE = ACTIVE (bookable) or PUBLISHED (visible, coming soon; derived from comingSoon),
 *   PAUSED, DEPRECATED, ARCHIVED unchanged.
 * APPROVED and SCHEDULED have no workflow in this codebase (no approver role, no scheduled
 * publisher); they are not invented. Publishing from DRAFT/REVIEW is gated by
 * validateForActivation, so skipping a review step can never skip validation.
 * ARCHIVED is terminal: an archived SKU is never silently revived.
 */
export const LIFECYCLE_TRANSITIONS: Readonly<Record<ServiceLifecycleStatus, readonly ServiceLifecycleStatus[]>> = {
  DRAFT: ["CONFIGURATION_REQUIRED", "READY_FOR_REVIEW", "ACTIVE", "PUBLISHED", "ARCHIVED"],
  CONFIGURATION_REQUIRED: ["DRAFT", "READY_FOR_REVIEW", "ACTIVE", "PUBLISHED", "ARCHIVED"],
  READY_FOR_REVIEW: ["DRAFT", "CONFIGURATION_REQUIRED", "ACTIVE", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ACTIVE", "PAUSED", "DEPRECATED"],
  ACTIVE: ["PUBLISHED", "PAUSED", "DEPRECATED"],
  PAUSED: ["ACTIVE", "PUBLISHED", "DEPRECATED", "ARCHIVED"],
  DEPRECATED: ["ARCHIVED"],
  ARCHIVED: [],
};

/** Targets an admin may request directly. PUBLISHED is reached by requesting ACTIVE on a coming-soon SKU. */
export const REQUESTABLE_LIFECYCLES = ["DRAFT", "READY_FOR_REVIEW", "ACTIVE", "PAUSED", "DEPRECATED", "ARCHIVED"] as const;
export type RequestableLifecycle = (typeof REQUESTABLE_LIFECYCLES)[number];

export function canTransition(from: ServiceLifecycleStatus, to: ServiceLifecycleStatus): boolean {
  return from === to || LIFECYCLE_TRANSITIONS[from].includes(to);
}

/** The lifecycle a request actually lands on (ACTIVE on a coming-soon SKU is PUBLISHED). */
export function effectiveLifecycleTarget(to: ServiceLifecycleStatus, cfg: ServiceCatalogConfig | null): ServiceLifecycleStatus {
  if ((to === "ACTIVE" || to === "PUBLISHED") && cfg?.comingSoon) return "PUBLISHED";
  if (to === "PUBLISHED" && !cfg?.comingSoon) return "ACTIVE";
  return to;
}

/** Visibility flags that go with a lifecycle. `isActive` stays the switch existing clients read. */
export function lifecycleFlags(status: ServiceLifecycleStatus): {
  isActive: boolean;
  isCustomerVisible: boolean;
  isBookable: boolean;
} {
  if (status === "ACTIVE") return { isActive: true, isCustomerVisible: true, isBookable: true };
  if (status === "PUBLISHED") return { isActive: true, isCustomerVisible: true, isBookable: false };
  return { isActive: false, isCustomerVisible: false, isBookable: false };
}

/* ------------------------------------------------------------------ */
/* Partner job brief                                                   */
/* ------------------------------------------------------------------ */

export type PartnerJobBrief = {
  variant: string | null;
  audience: string | null;
  quantity: number;
  unit: string | null;
  addons: { name: string; quantity: number }[];
  /** Total appointment minutes the customer booked (booking.estimatedDuration). */
  durationMinutes: number | null;
  /** Breakdown when the booking was made after 2026-09-21; null on older bookings. */
  duration: Pick<ResolvedDuration, "preparationMinutes" | "serviceMinutes" | "addonMinutes" | "cleanupMinutes" | "totalMinutes"> | null;
};

const AUDIENCE_LABEL: Record<string, string> = {
  women: "Women",
  men: "Men",
  girls: "Girls",
  boys: "Boys",
  "senior-women": "Senior women",
  "senior-men": "Senior men",
};

/**
 * What the partner needs to execute the job, read from the booking's immutable selection snapshot —
 * never from the live catalogue, so an admin edit after booking cannot change the brief. Prices,
 * matching rules and catalogue configuration are deliberately absent.
 */
export function partnerJobBrief(selection: unknown, addons: unknown, estimatedDuration: number | null | undefined): PartnerJobBrief {
  const rec =
    selection && typeof selection === "object" && !Array.isArray(selection) ? (selection as Record<string, unknown>) : {};
  const variant = rec.variant && typeof rec.variant === "object" ? (rec.variant as { name?: unknown }) : null;
  const qty = typeof rec.quantity === "number" && rec.quantity > 0 ? rec.quantity : 1;
  const addonQuantities =
    rec.addonQuantities && typeof rec.addonQuantities === "object" ? (rec.addonQuantities as Record<string, unknown>) : {};
  const list: unknown[] = Array.isArray(addons) ? addons : [];
  const d = rec.duration && typeof rec.duration === "object" ? (rec.duration as Record<string, unknown>) : null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const brief: PartnerJobBrief["addons"] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as { id?: unknown; name?: unknown; quantity?: unknown };
    if (typeof a.name !== "string") continue;
    const fromMap = typeof a.id === "string" ? addonQuantities[a.id] : undefined;
    brief.push({
      name: a.name,
      quantity: typeof a.quantity === "number" ? a.quantity : typeof fromMap === "number" ? fromMap : 1,
    });
  }
  return {
    variant: typeof variant?.name === "string" ? variant.name : null,
    audience: typeof rec.audience === "string" ? (AUDIENCE_LABEL[rec.audience] ?? rec.audience) : null,
    quantity: qty,
    unit: typeof rec.unitLabel === "string" ? rec.unitLabel : null,
    addons: brief,
    durationMinutes:
      typeof estimatedDuration === "number" && estimatedDuration > 0 ? estimatedDuration : num(rec.durationMinutes) || null,
    duration: d
      ? {
          preparationMinutes: num(d.preparationMinutes),
          serviceMinutes: num(d.serviceMinutes),
          addonMinutes: num(d.addonMinutes),
          cleanupMinutes: num(d.cleanupMinutes),
          totalMinutes: num(d.totalMinutes),
        }
      : null,
  };
}

export function deriveConfigStatus(service: ServiceDomainCore, cfg: ServiceCatalogConfig | null): ServiceConfigStatus {
  const lifecycle = parseLifecycle(service.lifecycleStatus);
  if (lifecycle === "ARCHIVED") return "ARCHIVED";
  if (lifecycle === "PAUSED" || lifecycle === "DEPRECATED") return "PAUSED";
  if (cfg?.comingSoon) return "COMING_SOON";
  if (catalogConfigGaps(service, cfg).length > 0) return "CONFIGURATION_REQUIRED";
  return "READY";
}

export function deriveLifecycleOnWrite(input: {
  isActive: boolean;
  comingSoon?: boolean;
  previous?: ServiceLifecycleStatus;
  bookable: boolean;
}): ServiceLifecycleStatus {
  if (!input.isActive) {
    if (input.previous === "ARCHIVED" || input.previous === "DEPRECATED") return input.previous;
    if (input.previous === "DRAFT" || input.previous === "CONFIGURATION_REQUIRED" || input.previous === "READY_FOR_REVIEW") {
      return input.previous;
    }
    return "PAUSED";
  }
  if (input.comingSoon) return "PUBLISHED";
  if (input.bookable) return "ACTIVE";
  return "PUBLISHED";
}

export function isServiceCustomerVisible(service: ServiceDomainCore, cfg: ServiceCatalogConfig | null): boolean {
  if (!isCommercialOrigin(service.dataOrigin)) return false;
  if (service.isCustomerVisible === false) return false;
  if (service.configStatus === "INTERNAL") return false;
  const lifecycle = parseLifecycle(service.lifecycleStatus ?? (service.isActive ? "ACTIVE" : "PAUSED"));
  if ((NON_PUBLIC_LIFECYCLES as readonly string[]).includes(lifecycle)) {
    return false;
  }
  // Coming soon remains visible so customers can discover it.
  if (cfg?.comingSoon) return service.isActive;
  return service.isActive;
}

export function isServiceBookable(service: ServiceDomainCore, cfg: ServiceCatalogConfig | null): boolean {
  if (!service.isActive) return false;
  if (service.isBookable === false) return false;
  if (cfg?.comingSoon) return false;
  const lifecycle = parseLifecycle(service.lifecycleStatus ?? "ACTIVE");
  if (lifecycle === "PAUSED" || lifecycle === "ARCHIVED" || lifecycle === "DEPRECATED" || lifecycle === "DRAFT" || lifecycle === "CONFIGURATION_REQUIRED") {
    return false;
  }
  return blockingBookabilityIssues({ ...service, catalogConfig: cfg }, cfg).filter((i) => i.code !== "COMING_SOON").length === 0
    ? true
    : lifecycle === "ACTIVE";
}

/**
 * Runtime bookability used by quote + booking. Grandfathered ACTIVE rows stay
 * bookable even with advisory gaps; coming-soon and paused never are.
 */
export function assertBookable(
  service: ServiceDomainCore,
  cfg: ServiceCatalogConfig | null,
): { ok: true } | { ok: false; error: "SERVICE_NOT_BOOKABLE" | "PRICING_CONFIG_MISSING" | "REQUIREMENTS_CONFIG_INVALID" | "EXECUTION_CONFIG_INVALID" } {
  if (!service.isActive) return { ok: false, error: "SERVICE_NOT_BOOKABLE" };
  if (cfg?.comingSoon) return { ok: false, error: "SERVICE_NOT_BOOKABLE" };
  const lifecycle = parseLifecycle(service.lifecycleStatus ?? (service.isActive ? "ACTIVE" : "PAUSED"));
  if (lifecycle === "PAUSED" || lifecycle === "ARCHIVED" || lifecycle === "DEPRECATED" || lifecycle === "DRAFT") {
    return { ok: false, error: "SERVICE_NOT_BOOKABLE" };
  }
  if (service.isBookable === false) return { ok: false, error: "SERVICE_NOT_BOOKABLE" };
  // Fail closed: a service whose authoritative pricing is incomplete is never bookable, whatever
  // its lifecycle flags say (e.g. a grandfathered row or a direct database edit).
  if (!pricingReadiness(service, cfg).ok) return { ok: false, error: "PRICING_CONFIG_MISSING" };
  // Phase 06, same fail-closed rule: requirements that are unknown, inactive, conflicting or
  // undecided (responsibility UNKNOWN) make the service unbookable rather than guessed at.
  if (validateServiceRequirements(cfg).length) return { ok: false, error: "REQUIREMENTS_CONFIG_INVALID" };
  // Phase 10 §7, same fail-closed rule: a broken work plan (cycle, unknown dependency, safety link to
  // nothing) makes the service unbookable rather than letting a job start with an undefined procedure.
  if (validateExecutionPlan(cfg).length) return { ok: false, error: "EXECUTION_CONFIG_INVALID" };
  return { ok: true };
}

/**
 * A customer may only be quoted / charged for a service the customer catalogue would show: visible,
 * in a public lifecycle, not INTERNAL, and commercially real (never a fixture or test row).
 * Bookability (paused / coming soon) is assertBookable's job and is checked separately.
 */
export function assertCustomerSellable(
  service: ServiceDomainCore,
  cfg: ServiceCatalogConfig | null,
): { ok: true } | { ok: false; error: "SERVICE_UNAVAILABLE" } {
  return isServiceCustomerVisible(service, cfg) ? { ok: true } : { ok: false, error: "SERVICE_UNAVAILABLE" };
}

/**
 * Minutes a selection occupies, from the ONE duration calculator (resolveServiceDuration in
 * service-catalog-config.ts). Kept as a named export for callers that only need the total; it is
 * not a second implementation.
 */
export function selectionDurationMinutes(
  service: Pick<ServiceDomainCore, "estimatedDuration">,
  cfg: ServiceCatalogConfig | null,
  selection: Parameters<typeof resolveServiceDuration>[2] = {},
): number {
  return resolveServiceDuration(service, cfg, selection).totalMinutes;
}

export function configSections(service: ServiceDomainCore, cfg: ServiceCatalogConfig | null): ConfigSection[] {
  const gaps = catalogConfigGaps(service, cfg);
  const has = (needle: string) => gaps.some((g) => g.toLowerCase().includes(needle));
  const section = (id: string, label: string, status: SectionStatus, issues: string[] = []): ConfigSection => ({
    id,
    label,
    status,
    issues,
  });
  const identityOk = Boolean(service.name && service.slug && service.category);
  return [
    section("identity", "Identity", identityOk ? "ok" : "missing", identityOk ? [] : ["name, slug or category missing"]),
    section("content", "Content", service.description ? "ok" : "warn", service.description ? [] : ["short description missing"]),
    section("audience", "Audience", cfg?.audiences?.length ? "ok" : "ok", []),
    section("booking", "Booking", cfg?.comingSoon ? "warn" : "ok", cfg?.comingSoon ? ["Coming soon — not bookable"] : []),
    section("pricing", "Pricing", service.basePrice > 0 || service.pricingModel === "quote" ? "ok" : "missing", has("base price") ? ["Base price is not set"] : []),
    section("quantity", "Quantity", has("quantity") ? "missing" : "ok", gaps.filter((g) => g.toLowerCase().includes("quantity"))),
    section("duration", "Duration", service.estimatedDuration > 0 ? "ok" : "missing", service.estimatedDuration > 0 ? [] : ["duration missing"]),
    section("variants", "Variants", cfg?.audiences?.length && !cfg.variants?.length ? "warn" : "ok", gaps.filter((g) => g.toLowerCase().includes("variant") || g.toLowerCase().includes("audience"))),
    section("addons", "Add-ons", "ok", []),
    section("materials", "Materials", cfg?.materialPolicy ? "ok" : "warn", has("materials") ? ["Materials policy not specified"] : []),
    section("equipment", "Equipment", cfg?.equipmentPolicy ? "ok" : "warn", has("equipment") ? ["Equipment policy not specified"] : []),
    section("provider", "Provider requirements", cfg?.providerRequirements?.requiredSkills?.length ? "ok" : "ok", []),
    section("coverage", "Coverage", (service.availableCities?.length ?? 0) > 0 || (cfg?.coverage?.cityIds?.length ?? 0) > 0 ? "ok" : "warn", []),
    section("availability", "Availability", cfg?.availability ? "ok" : "ok", []),
    section("bookingRules", "Booking rules", cfg?.bookingRules ? "ok" : "ok", []),
    section("safety", "Safety", cfg?.safetyNotes?.length || cfg?.safety ? "ok" : "warn", cfg?.safetyNotes?.length || cfg?.safety ? [] : ["No safety information configured — nothing can be reported as a prohibited condition"]),
    section("quality", "Quality", cfg?.quality ? "ok" : "warn", cfg?.quality ? [] : ["No quality criteria configured"]),
    section("matching", "Matching", cfg?.matching ? "ok" : "ok", []),
    section("payment", "Payment", cfg?.payment ? "ok" : "ok", []),
    section("media", "Media", "ok", []),
    section("trust", "Trust", cfg?.trust ? "ok" : "ok", []),
    section("reviews", "Reviews", "ok", []),
    section("seo", "SEO", service.seoTitle ? "ok" : "ok", []),
    section("analytics", "Analytics", "ok", []),
    section("operations", "Operations", "ok", []),
  ];
}

export function customerIndexable(service: ServiceDomainCore, cfg: ServiceCatalogConfig | null): boolean {
  if (!isServiceCustomerVisible(service, cfg)) return false;
  const lifecycle = parseLifecycle(service.lifecycleStatus ?? (service.isActive ? "ACTIVE" : "PAUSED"));
  if (lifecycle === "ARCHIVED" || lifecycle === "DEPRECATED" || lifecycle === "DRAFT" || lifecycle === "CONFIGURATION_REQUIRED") return false;
  if (cfg?.comingSoon) return false;
  if (cfg?.seo?.noindex) return false;
  return true;
}

/** Immutable slice stored on the booking so later catalogue edits cannot rewrite history. */
export function bookingConfigSnapshot(
  service: ServiceDomainCore,
  cfg: ServiceCatalogConfig | null,
  selection: { durationMinutes: number; variant: { id: string; name: string; price: number } | null; quantity: number },
): Record<string, unknown> {
  return {
    serviceId: service.id,
    slug: service.slug,
    name: service.name,
    version: service.version ?? 1,
    pricingModel: service.pricingModel,
    variantId: selection.variant?.id ?? null,
    variantName: selection.variant?.name ?? null,
    quantity: selection.quantity,
    durationMinutes: selection.durationMinutes,
    inclusions: service.includedServices ?? [],
    exclusions: service.excludedServices ?? [],
    materialPolicy: cfg?.materialPolicy ?? null,
    equipmentPolicy: cfg?.equipmentPolicy ?? null,
    cancellationPolicy: cfg?.bookingRules?.cancellationPolicy ?? null,
    reschedulePolicy: cfg?.bookingRules?.reschedulePolicy ?? null,
    payment: cfg?.payment ?? null,
    quality: qualitySnapshot(cfg),
    // Phase 10 §9: the safety rules that applied at booking time (prohibited conditions, warnings, disclaimers).
    safety: buildSafetySnapshot(cfg),
    // Phase 10 §11: the warranty policy that applied at booking time (warranty.v1); never re-read from the catalogue.
    warranty: buildWarrantySnapshot(cfg),
    // Phase D: the customer age policy that applied at booking time (the decision row records the outcome).
    customerPolicy: cfg?.customerPolicy?.age ? { age: cfg.customerPolicy.age, version: cfg.customerPolicy.version ?? null } : null,
    paymentCapabilities: paymentCapabilities(cfg),
    matchingWeights: cfg?.matching
      ? {
          skillWeight: cfg.matching.skillWeight ?? null,
          distanceWeight: cfg.matching.distanceWeight ?? null,
          ratingWeight: cfg.matching.ratingWeight ?? null,
          availabilityWeight: cfg.matching.availabilityWeight ?? null,
          responseWeight: cfg.matching.responseWeight ?? null,
          completionWeight: cfg.matching.completionWeight ?? null,
        }
      : null,
  };
}

export function publicCatalogProjection(cfg: ServiceCatalogConfig | null): ServiceCatalogConfig | null {
  const pub = publicCatalogConfig(cfg);
  if (!pub) return null;
  // `matching` is internal: it rides along in `rest` and is overwritten with undefined below.
  const { providerRequirements, ...rest } = pub;
  return {
    ...rest,
    providerRequirements: providerRequirements
      ? {
          verifiedProfessionalRequired: providerRequirements.verifiedProfessionalRequired,
        }
      : undefined,
    matching: undefined,
  };
}

export function parseServiceConfig(raw: unknown): ServiceCatalogConfig | null {
  return parseCatalogConfig(raw);
}
