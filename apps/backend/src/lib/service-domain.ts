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

import { createHash } from "node:crypto";
import { validateServiceRequirements, type Enforcement } from "./service-requirements";
import { validateExecutionPlan, type ExecutionStep } from "./service-execution";
import { buildSafetySnapshot } from "./service-safety";
import { buildWarrantySnapshot } from "./service-warranty";
import {
  parseCatalogConfig,
  PROFESSIONAL_PREFERENCE_SUPPORTED,
  publicCatalogConfig,
  resolveServiceDuration,
  resolveServiceSelection,
  type ResolvedDuration,
  type ServiceCatalogConfig,
} from "./service-catalog-config";
import { SUPPORTED_CURRENCIES } from "./pricing-policy";
import { isKnownLocalEnvironment } from "./deployed-environment";
import { CANCELLATION_POLICY } from "../services/cancellation-policy.service";
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
  gates: PublishGateResult[];
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

/**
 * Active variants the resolver cannot price. `pricingReadiness` asks whether the service can be
 * sold at all (one priced variant is enough); this asks whether everything on sale can be.
 */
function unpricedVariants(
  service: Pick<ServiceDomainCore, "basePrice" | "minPrice" | "maxPrice" | "estimatedDuration" | "pricingModel" | "currency">,
  cfg: ServiceCatalogConfig | null,
): string[] {
  const rule = cfg?.quantity && cfg.quantity.type !== "NONE" ? cfg.quantity : null;
  const quantity = rule ? (rule.default ?? rule.min) : undefined;
  const out: string[] = [];
  for (const v of (cfg?.variants ?? []).filter((x) => x.active !== false)) {
    const r = resolveServiceSelection(service, cfg, { variantId: v.id, quantity, audience: v.audiences?.[0] ?? cfg?.audiences?.[0] });
    if (r.ok ? !(r.servicePricePaise > 0) : r.issues.some((i) => i.code === "PRICING_CONFIG_MISSING")) out.push(v.id);
  }
  return out;
}

/** Words people type to get past a required field. They are not content. */
const PLACEHOLDER_TEXT = new Set(["na", "n/a", "n.a.", "nil", "none", "null", "tbd", "tba", "todo", "test", "xx", "xxx", "ok", "yes", "no"]);

/**
 * Does this text say something? Not blank, not punctuation, not a placeholder word, and at least
 * three letters or digits. It cannot judge whether what is said is right — the second admin's
 * approval does that — only whether anything was said at all.
 */
export function isMeaningfulText(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim().toLowerCase();
  if (PLACEHOLDER_TEXT.has(text)) return false;
  const chars = text.match(/[\p{L}\p{N}]/gu) ?? [];
  if (chars.length < 3) return false;
  // One key held down ("aaaa") says nothing. A number ("100") can be content, so only letters are judged.
  return !(/\p{L}/u.test(text) && new Set(chars).size === 1);
}
/** A string was entered, and it is a placeholder or says nothing. */
const isPlaceholderText = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0 && !isMeaningfulText(value);

const filled = (v: unknown): boolean => (typeof v === "string" ? isMeaningfulText(v) : Array.isArray(v) ? v.some(filled) : false);
const hasPlaceholder = (v: unknown): boolean => (typeof v === "string" ? isPlaceholderText(v) : Array.isArray(v) ? v.some(hasPlaceholder) : false);

/** Fewest letters and digits for a "not applicable" reason to be a reason (the same floor as an admin's waiver reason). */
const MIN_REASON_CHARS = 10;
export type NotApplicableSection = "safety" | "quality" | "materials" | "equipment";

/**
 * Words that only restate "this does not apply" or name the section. A reason made of nothing else
 * is the label again, not a reason. Kept in step with the admin editor (lib/not-applicable-reasons.ts).
 */
const REASON_FILLER_WORDS = new Set([
  "not", "applicable", "apply", "applies", "na", "none", "nil", "nothing", "no", "null", "tbd", "todo", "test", "ok", "yes",
  "safety", "quality", "material", "materials", "equipment", "required", "needed", "need", "needs",
  "is", "are", "does", "do", "the", "this", "it", "to", "for", "of", "an", "here", "service",
]);

/** The one sentence that says what a reason must be. Shown wherever a reason is refused. */
export const NOT_APPLICABLE_REASON_RULE =
  "A reason needs at least three different words (ten letters or more) that say why; “not applicable”, “none”, “not needed” and the section's own name are not a reason.";

/**
 * Is this text a reason? At least ten letters or digits, at least three different words of two or
 * more characters, and at least one of them something other than the label words above. It cannot
 * judge whether the reason is true — the approver does that — only that one was written.
 */
export function isRealReason(value: unknown): value is string {
  if (!isMeaningfulText(value)) return false;
  const text = (value as string).trim().toLowerCase();
  if ((text.match(/[\p{L}\p{N}]/gu) ?? []).length < MIN_REASON_CHARS) return false;
  // Marks are kept inside a word so scripts that write vowels as marks (Devanagari) are not split.
  const words = new Set(text.split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => /\p{L}/u.test(w) && new Set(w).size >= 2));
  if (words.size < 3) return false;
  return [...words].some((w) => !REASON_FILLER_WORDS.has(w));
}

/** What the "not applicable" predicates read. Narrow on purpose, so the job-time readers can call them. */
export type NotApplicableConfig = {
  notApplicableReasons?: Partial<Record<NotApplicableSection, string>>;
  safety?: { prohibitedConditions?: string[]; incidentProtocol?: string };
  quality?: { notApplicable?: boolean; checklist?: string[]; completionCriteria?: string[] };
  materialPolicy?: string;
  equipmentPolicy?: string;
} | null | undefined;

/** The reason written for a section, or null when none was really given. It does not decide whether the section is off: `declaredNotApplicable` does. */
export function notApplicableReason(cfg: NotApplicableConfig, section: NotApplicableSection): string | null {
  const reason = cfg?.notApplicableReasons?.[section];
  return isRealReason(reason) ? reason.trim() : null;
}

/**
 * What a service's safety section is missing before it can stand behind a job. The minimum is what
 * the job runs on: a prohibited condition is what stops work on site (the partner reports it and a
 * hold follows), and the incident protocol is what the professional then does. Notes, warnings and
 * protective equipment are welcome and are not the minimum. Empty = the minimum is met.
 */
export function safetyGaps(cfg: NotApplicableConfig): string[] {
  const gaps: string[] = [];
  if (!filled(cfg?.safety?.prohibitedConditions)) gaps.push("a prohibited condition");
  if (!filled(cfg?.safety?.incidentProtocol)) gaps.push("an incident protocol");
  return gaps;
}

/**
 * What a service's quality section is missing: the checklist is what completion is held to, and the
 * completion criteria are what "done" means. A proof flag, a warranty length, a complaint window or
 * "not applicable" is not a standard. Empty = the minimum is met.
 */
export function qualityGaps(cfg: NotApplicableConfig): string[] {
  const gaps: string[] = [];
  if (!filled(cfg?.quality?.checklist)) gaps.push("a checklist item");
  if (!filled(cfg?.quality?.completionCriteria)) gaps.push("a completion criterion");
  return gaps;
}

export const hasSafetyContent = (cfg: ServiceCatalogConfig | null): boolean => safetyGaps(cfg).length === 0;
export const hasQualityContent = (cfg: ServiceCatalogConfig | null): boolean => qualityGaps(cfg).length === 0;

/**
 * THE question "is this section declared not applicable?", for the publish gate and for the running
 * job alike. Returns the declared reason, or null. A section is declared not applicable only when a
 * real reason is written AND the section is actually switched off:
 *
 *   quality    the "switch off quality checks" flag is on. Stored checklist and criteria are kept
 *              and not enforced while it is. The flag without a reason switches nothing off, and a
 *              reason without the flag declares nothing.
 *   safety     the minimum (a prohibited condition and an incident protocol) is not there. Safety
 *              has no switch: content that exists is always frozen onto the booking.
 *   materials  the policy is NOT_REQUIRED.
 *   equipment  the policy is NOT_REQUIRED.
 *
 * Nothing else may decide this. A reader that looked at `quality.notApplicable` on its own ran jobs
 * with quality checks off on a service the gate was reporting as incomplete.
 */
export function declaredNotApplicable(cfg: NotApplicableConfig, section: NotApplicableSection): string | null {
  const reason = notApplicableReason(cfg, section);
  if (!reason) return null;
  if (section === "quality") return cfg?.quality?.notApplicable === true ? reason : null;
  if (section === "safety") return safetyGaps(cfg).length > 0 ? reason : null;
  if (section === "materials") return cfg?.materialPolicy === "NOT_REQUIRED" ? reason : null;
  return cfg?.equipmentPolicy === "NOT_REQUIRED" ? reason : null;
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
  if (!cfg?.comingSoon) {
    for (const id of unpricedVariants(service, cfg)) {
      push("VARIANT_UNPRICED", `variants.${id}`, `Variant "${id}" is on sale and has no price, so a customer who picks it cannot be quoted`);
    }
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
  const activeVariants = new Set((cfg?.variants ?? []).filter((v) => v.active !== false).map((v) => v.id));
  for (const addon of cfg?.addons ?? []) {
    if (addon.active === false) continue;
    for (const vid of addon.compatibleVariantIds ?? []) {
      if (!activeVariants.has(vid)) {
        push("ADDON_VARIANT_INACTIVE", `addons.${addon.id}`, `Add-on "${addon.id}" requires variant "${vid}", which is not an active variant`);
      }
    }
  }
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
  // NOT_SPECIFIED is the absence of a decision, stored. NOT_REQUIRED is a decision, and a decision says why.
  if (!cfg?.materialPolicy || cfg.materialPolicy === "NOT_SPECIFIED") push("MATERIALS_POLICY", "materialPolicy", "Materials policy not specified");
  else if (cfg.materialPolicy === "NOT_REQUIRED" && !declaredNotApplicable(cfg, "materials")) {
    push("MATERIALS_NOT_REQUIRED_UNEXPLAINED", "materialPolicy", `Materials are marked not required, ${unexplained(cfg, "materials")}`);
  }
  if (!cfg?.equipmentPolicy || cfg.equipmentPolicy === "NOT_SPECIFIED") push("EQUIPMENT_POLICY", "equipmentPolicy", "Equipment policy not specified");
  else if (cfg.equipmentPolicy === "NOT_REQUIRED" && !declaredNotApplicable(cfg, "equipment")) {
    push("EQUIPMENT_NOT_REQUIRED_UNEXPLAINED", "equipmentPolicy", `Equipment is marked not required, ${unexplained(cfg, "equipment")}`);
  }
  return issues;
}

/** Something was typed as the reason for a section, and it is not one. */
const reasonRefused = (cfg: NotApplicableConfig, section: NotApplicableSection): boolean => {
  const raw = cfg?.notApplicableReasons?.[section];
  return typeof raw === "string" && raw.trim().length > 0 && !isRealReason(raw);
};
/** How a "not required" policy lacks its reason: none written, or one written that is not a reason (then the rule is stated). */
const unexplained = (cfg: NotApplicableConfig, section: NotApplicableSection): string =>
  reasonRefused(cfg, section) ? `and the reason written does not count. ${NOT_APPLICABLE_REASON_RULE}` : "with no reason given";

/**
 * Gate for first-time activation. Advisory profile gaps do not un-publish a
 * grandfathered ACTIVE row — only blocking bookability issues do that.
 */
export function validateForActivation(
  service: ServiceDomainCore,
  cfg: ServiceCatalogConfig | null,
  opts: { grandfathered?: boolean; required?: readonly PublishRequiredSection[]; platformPolicy?: PlatformPolicyShape; unavailableTrainingModules?: readonly string[] } = {},
): { ok: true } | { ok: false; code: "SERVICE_NOT_BOOKABLE"; issues: PublishIssue[] } {
  // One gate: whatever the admin's publish rail shows as a critical failure is what refuses activation.
  const issues = publishGateResults(service, cfg, opts)
    .filter(isBlockingGate)
    .map((g) => ({ code: g.code, path: g.path, message: g.message }));
  if (issues.length) return { ok: false, code: "SERVICE_NOT_BOOKABLE", issues };
  return { ok: true };
}

/**
 * What an edit to a LIVE service must not do: make it worse.
 *
 * A live service keeps the gaps it already has as warnings, so that a new requirement never
 * unpublishes it. That leniency used to cover the edit as well, so the sections a first publish
 * requires could be deleted from a service the day after it went live. The rule now: anything that
 * blocks even a live service still blocks, and so does every finding a first publish would refuse
 * that the service did not already have before this edit.
 */
export function liveEditRegressions(input: {
  before: { service: ServiceDomainCore; cfg: ServiceCatalogConfig | null };
  after: { service: ServiceDomainCore; cfg: ServiceCatalogConfig | null };
  required?: readonly PublishRequiredSection[];
  platformPolicy?: PlatformPolicyShape;
  unavailableTrainingModules?: readonly string[];
}): PublishIssue[] {
  const shared = { required: input.required, platformPolicy: input.platformPolicy, unavailableTrainingModules: input.unavailableTrainingModules };
  const key = (g: Pick<PublishGateResult, "code" | "path">) => `${g.code}@${g.path}`;
  const strict = (x: { service: ServiceDomainCore; cfg: ServiceCatalogConfig | null }) => publishGateResults(x.service, x.cfg, { ...shared, grandfathered: false }).filter(isBlockingGate);
  const already = new Set(strict(input.before).map(key));
  const always = publishGateResults(input.after.service, input.after.cfg, { ...shared, grandfathered: true }).filter(isBlockingGate);
  const out = new Map<string, PublishIssue>();
  for (const g of always) out.set(key(g), { code: g.code, path: g.path, message: g.message });
  for (const g of strict(input.after)) {
    if (!already.has(key(g))) out.set(key(g), { code: g.code, path: g.path, message: `${g.message} This edit would introduce it on a live service.` });
  }
  // A declaration passes the gate (the approver of a first publish reads the reason with the
  // version), so the comparison above cannot see content being traded for one. On a live service
  // that trade removes a protection, and nobody approves a direct edit.
  for (const swap of notApplicableSwaps(input.before.cfg, input.after.cfg)) out.set(key(swap), swap);
  // The same protections can be taken away with no declaration at all (proof no longer asked for,
  // a warranty cut to nothing, a section emptied where nothing is listed as required).
  const reported = [...out.values()];
  for (const cut of protectionReductions(input.before.cfg, input.after.cfg)) {
    // Said once: a finding about the whole section (absent, or swapped for a declaration) covers
    // every cut inside it, and so does one at the cut's own path. A finding about a different rule,
    // step or field of the same section does not, and neither does another cut — each is reported.
    const section = cut.path.split(".")[0]!;
    if (reported.some((i) => i.path === section || i.path === cut.path)) continue;
    out.set(key(cut), cut);
  }
  return [...out.values()];
}

const LIVE_REDUCTION_HOW = "It is not accepted as an edit to a live service: pause the service, make the change, and publish it again so a second admin approves it.";

type ProtectedSection = "SAFETY" | "QUALITY" | "WARRANTY" | "REWORK" | "REQUIREMENTS" | "EXECUTION" | "CUSTOMER_POLICY";

/** One reduction. `change` is the sentence that says what would happen on the live service. */
const reduction = (section: ProtectedSection, kind: "REDUCED" | "REMOVED", path: string, change: string): PublishIssue => ({
  code: `${section}_PROTECTION_${kind}`,
  path,
  message: `${change}. ${LIVE_REDUCTION_HOW}`,
});

/**
 * Protections an edit takes off a service that bookings are being made under, without declaring
 * anything. Each reader below compares what a booking would freeze before and after the edit:
 * safety and quality content, the warranty, the rework policy, requirement rules, execution steps
 * and the age rule. Rewording or adding to content is never a reduction, and a list that is
 * shortened but still has an entry is not judged here.
 */
function protectionReductions(before: ServiceCatalogConfig | null, after: ServiceCatalogConfig | null): PublishIssue[] {
  return [
    ...contentReductions(before, after),
    ...qualityRuleReductions(before, after),
    ...warrantyReductions(before, after),
    ...reworkReductions(before, after),
    ...requirementReductions(before, after),
    ...executionReductions(before, after),
    ...customerPolicyReductions(before, after),
  ];
}

/** Every safety field is content a job runs under. A field added to the schema must be named here. */
const SAFETY_FIELDS: Record<keyof NonNullable<ServiceCatalogConfig["safety"]>, string> = {
  information: "The safety information",
  warnings: "The safety warnings",
  prohibitedConditions: "The prohibited conditions",
  customerRequirements: "The customer's safety requirements",
  providerRequirements: "The professional's safety requirements",
  medicalDisclaimer: "The medical disclaimer",
  emergencyProtocol: "The emergency protocol",
  ppe: "The protective equipment list",
  chemicalRestrictions: "The chemical restrictions",
  incidentProtocol: "The incident protocol",
};
const QUALITY_LISTS = { checklist: "The quality checklist", completionCriteria: "The completion criteria" } as const;

/**
 * Safety and quality content: the whole section emptied, or one field that said something left
 * saying nothing (deleted, emptied, or replaced by a dash) while the rest of the section stays.
 */
function contentReductions(before: ServiceCatalogConfig | null, after: ServiceCatalogConfig | null): PublishIssue[] {
  const out: PublishIssue[] = [];
  for (const section of ["safety", "quality"] as const) {
    // A declaration in place of content is the swap, reported by `notApplicableSwaps`.
    if (!sectionProtects(before, section) || declaredNotApplicable(after, section)) continue;
    const SECTION = section === "safety" ? "SAFETY" : "QUALITY";
    if (!sectionProtects(after, section)) {
      out.push(reduction(SECTION, "REMOVED", section, `${section === "safety" ? "Safety information" : "Quality checks"} would be removed from this live service`));
      continue;
    }
    const was = (before?.[section] ?? {}) as Record<string, unknown>;
    const now = (after?.[section] ?? {}) as Record<string, unknown>;
    for (const [field, label] of Object.entries(section === "safety" ? SAFETY_FIELDS : QUALITY_LISTS)) {
      if (filled(was[field]) && !filled(now[field])) out.push(reduction(SECTION, "REDUCED", `${section}.${field}`, `${label} would be emptied on this live service`));
    }
  }
  return out;
}

/** The window a customer has to confirm or report when the service sets none (customer-visit, booking-completion). */
const DEFAULT_CONFIRMATION_WINDOW_HOURS = 48;

/** Quality rules that are switches and windows rather than content. */
function qualityRuleReductions(before: ServiceCatalogConfig | null, after: ServiceCatalogConfig | null): PublishIssue[] {
  // Quality declared off, or emptied, is reported as the whole section.
  if (declaredNotApplicable(after, "quality") || (sectionProtects(before, "quality") && !sectionProtects(after, "quality"))) return [];
  const out: PublishIssue[] = [];
  const was = before?.quality;
  const now = after?.quality;
  if (was) {
    const switches = { proofRequired: "Photo proof", beforeAfterPhotos: "Before and after photos", professionalConfirmation: "The professional's confirmation", customerConfirmation: "The customer's confirmation" } as const;
    for (const [field, label] of Object.entries(switches) as [keyof typeof switches, string][]) {
      if (was[field] === true && now?.[field] !== true) out.push(reduction("QUALITY", "REDUCED", `quality.${field}`, `${label} would no longer be required on this live service`));
    }
    const windows = { warrantyDays: "The warranty", complaintWindowDays: "The complaint window" } as const;
    for (const [field, label] of Object.entries(windows) as [keyof typeof windows, string][]) {
      const from = was[field] ?? 0;
      const to = now?.[field] ?? 0;
      if (from > 0 && to < from) out.push(reduction("QUALITY", "REDUCED", `quality.${field}`, `${label} would be shortened from ${from} to ${to} days on this live service`));
    }
  }
  // Read as the booking freezes it: unset is the platform default, not zero.
  const hours = (cfg: ServiceCatalogConfig | null) => qualitySnapshot(cfg)?.confirmationWindowHours ?? DEFAULT_CONFIRMATION_WINDOW_HOURS;
  if (hours(after) < hours(before)) {
    out.push(reduction("QUALITY", "REDUCED", "quality.confirmationWindowHours", `The customer's confirmation window would be shortened from ${hours(before)} to ${hours(after)} hours on this live service`));
  }
  return out;
}

/**
 * The warranty, compared as `buildWarrantySnapshot` freezes it onto a booking: the typed block wins
 * over `quality.warrantyDays`, so a block that is present and not enabled switches a legacy warranty
 * off. With no typed block on either side the legacy days are the whole warranty, and those are
 * judged with the quality rules above.
 */
function warrantyReductions(before: ServiceCatalogConfig | null, after: ServiceCatalogConfig | null): PublishIssue[] {
  if (!before?.warranty && !after?.warranty) return [];
  const was = buildWarrantySnapshot(before);
  const now = buildWarrantySnapshot(after);
  if (!was.enabled) return [];
  if (!now.enabled) {
    return after?.warranty
      ? [reduction("WARRANTY", "REDUCED", "warranty.enabled", "The warranty would be switched off on this live service")]
      : [reduction("WARRANTY", "REMOVED", "warranty", "The warranty would no longer be offered on this live service")];
  }
  const out: PublishIssue[] = [];
  if (now.durationDays < was.durationDays) {
    out.push(reduction("WARRANTY", "REDUCED", "warranty.durationDays", `The warranty would be shortened from ${was.durationDays} to ${now.durationDays} days on this live service`));
  }
  if (was.refundAllowed && !now.refundAllowed) {
    out.push(reduction("WARRANTY", "REDUCED", "warranty.refundAllowed", "A refund under the warranty would no longer be allowed on this live service"));
  }
  const dropped = was.eligibleIssueTypes.filter((t) => !now.eligibleIssueTypes.includes(t));
  if (dropped.length) {
    out.push(reduction("WARRANTY", "REDUCED", "warranty.eligibleIssueTypes", `The warranty would no longer cover ${dropped.join(", ")} issues on this live service`));
  }
  // Exclusions are free text, so a reworded one cannot be told from a replaced one: only more of them is judged.
  if (now.exclusions.length > was.exclusions.length) {
    out.push(reduction("WARRANTY", "REDUCED", "warranty.exclusions", `The warranty would have ${now.exclusions.length} exclusions instead of ${was.exclusions.length} on this live service`));
  }
  return out;
}

/**
 * Rework. Only a waived fee is a promise (`followUpFeeDecision` refuses to create a follow-up visit
 * for anything else), and its window is "no limit" when unset or zero, exactly as that reader has it.
 */
function reworkReductions(before: ServiceCatalogConfig | null, after: ServiceCatalogConfig | null): PublishIssue[] {
  const was = before?.rework;
  const now = after?.rework;
  if (was?.fee !== "WAIVED") return [];
  if (!now) return [reduction("REWORK", "REMOVED", "rework", "The free follow-up visit would no longer be offered on this live service")];
  if (now.fee !== "WAIVED") {
    return [reduction("REWORK", "REDUCED", "rework.fee", `The follow-up visit fee would change from waived to ${now.fee === "QUOTED" ? "quoted" : "not decided"} on this live service`)];
  }
  const limit = (days: number | undefined) => (days && days > 0 ? days : null);
  const from = limit(was.windowDays);
  const to = limit(now.windowDays);
  if (to !== null && (from === null || to < from)) {
    return [reduction("REWORK", "REDUCED", "rework.windowDays", `The window to report a problem for a free follow-up visit would be shortened from ${from === null ? "no limit" : `${from} days`} to ${to} days on this live service`)];
  }
  return [];
}

type Condition = { variantIds?: string[]; addonIds?: string[]; minQuantity?: number } | undefined;
/** Does this rule or step apply to some bookings only? */
const conditional = (when: Condition): boolean => Boolean(when?.variantIds?.length || when?.addonIds?.length || when?.minQuantity != null);

/** The three "required" points are different moments, not a ladder: moving between them is not judged. */
const ENFORCEMENT_STRENGTH: Record<Enforcement, number> = { INFORMATIONAL: 0, WARNING: 1, REQUIRED_BEFORE_BOOKING: 2, REQUIRED_BEFORE_ARRIVAL: 2, REQUIRED_AT_START: 2 };

/** Requirement rules, matched by their id: one removed or switched off, or one that asks for less. */
function requirementReductions(before: ServiceCatalogConfig | null, after: ServiceCatalogConfig | null): PublishIssue[] {
  const out: PublishIssue[] = [];
  const kept = new Map((after?.requirements ?? []).filter((r) => r.active).map((r) => [r.id, r]));
  for (const was of (before?.requirements ?? []).filter((r) => r.active)) {
    const path = `requirements.${was.id}`;
    const name = `Requirement "${was.id}"`;
    const now = kept.get(was.id);
    if (!now) {
      out.push(reduction("REQUIREMENTS", "REMOVED", path, `${name} would no longer apply on this live service`));
      continue;
    }
    if (!was.optional && now.optional) out.push(reduction("REQUIREMENTS", "REDUCED", `${path}.optional`, `${name} would become optional on this live service`));
    if (ENFORCEMENT_STRENGTH[now.enforcement] < ENFORCEMENT_STRENGTH[was.enforcement]) {
      out.push(reduction("REQUIREMENTS", "REDUCED", `${path}.enforcement`, `${name} would be enforced as ${now.enforcement} instead of ${was.enforcement} on this live service`));
    }
    if (was.verification !== "NONE" && now.verification === "NONE") {
      out.push(reduction("REQUIREMENTS", "REDUCED", `${path}.verification`, `${name} would no longer be verified on this live service`));
    }
    if (!conditional(was.when) && conditional(now.when)) {
      out.push(reduction("REQUIREMENTS", "REDUCED", `${path}.when`, `${name} would apply to some bookings only, instead of every booking, on this live service`));
    }
  }
  return out;
}

/** What a step asks the professional to record, weakest first. */
const EVIDENCE_STRENGTH: Record<ExecutionStep["evidence"], number> = { NONE: 0, NOTE: 1, PHOTO: 2, BEFORE_AFTER_PHOTOS: 3 };

/**
 * Execution steps, matched by their id. A mandatory step is what completion waits for, so removing
 * it, switching it off, making it optional or conditional is a reduction; so is any step asking for
 * less evidence or no longer waiting for its safety requirement. An optional step may be removed.
 */
function executionReductions(before: ServiceCatalogConfig | null, after: ServiceCatalogConfig | null): PublishIssue[] {
  const active = (cfg: ServiceCatalogConfig | null) => (cfg?.execution?.steps ?? []).filter((s) => s.active);
  const steps = active(before);
  const kept = new Map(active(after).map((s) => [s.id, s]));
  if (!steps.length) return [];
  if (!kept.size) return [reduction("EXECUTION", "REMOVED", "execution", "Every execution step would be removed on this live service")];
  const out: PublishIssue[] = [];
  for (const was of steps) {
    const path = `execution.${was.id}`;
    const name = `Step "${was.id}"`;
    const now = kept.get(was.id);
    if (!now) {
      if (was.mandatory) out.push(reduction("EXECUTION", "REMOVED", path, `Mandatory step "${was.id}" would no longer be part of the job on this live service`));
      continue;
    }
    if (was.mandatory && !now.mandatory) out.push(reduction("EXECUTION", "REDUCED", `${path}.mandatory`, `${name} would become optional on this live service`));
    if (EVIDENCE_STRENGTH[now.evidence] < EVIDENCE_STRENGTH[was.evidence]) {
      out.push(reduction("EXECUTION", "REDUCED", `${path}.evidence`, `${name} would ask for ${now.evidence} instead of ${was.evidence} as evidence on this live service`));
    }
    if (was.safetyRequirement && !now.safetyRequirement) {
      out.push(reduction("EXECUTION", "REDUCED", `${path}.safetyRequirement`, `${name} would no longer wait for safety requirement "${was.safetyRequirement}" on this live service`));
    }
    if (was.mandatory && !conditional(was.when) && conditional(now.when)) {
      out.push(reduction("EXECUTION", "REDUCED", `${path}.when`, `${name} would be part of some bookings only, instead of every booking, on this live service`));
    }
  }
  return out;
}

/**
 * The age rule as `evaluateAgePolicy` applies it, reduced to two ages: the youngest customer who may
 * book alone, and the youngest who may book at all. MINIMUM_AGE and ADULT_ONLY refuse below their
 * age; GUARDIAN_REQUIRED lets anyone below its age book with a guardian's attestation. A mode with
 * no age configured refuses everyone.
 */
function ageGate(cfg: ServiceCatalogConfig | null): { alone: number; atAll: number } {
  const age = cfg?.customerPolicy?.age;
  if (!age || age.mode === "NONE") return { alone: 0, atAll: 0 };
  if (age.mode === "GUARDIAN_REQUIRED") return { alone: age.guardianMinimumAge ?? Infinity, atAll: 0 };
  const threshold = (age.mode === "MINIMUM_AGE" ? age.minimumAge : age.adultAge) ?? Infinity;
  return { alone: threshold, atAll: threshold };
}

/** The age rule removed, or changed so that someone younger may book (alone, or at all). */
function customerPolicyReductions(before: ServiceCatalogConfig | null, after: ServiceCatalogConfig | null): PublishIssue[] {
  const was = ageGate(before);
  const now = ageGate(after);
  if (was.alone === 0) return [];
  if (now.alone === 0) return [reduction("CUSTOMER_POLICY", "REMOVED", "customerPolicy.age", "The age rule would no longer apply on this live service")];
  if (now.alone < was.alone || now.atAll < was.atAll) {
    return [reduction("CUSTOMER_POLICY", "REDUCED", "customerPolicy.age", "The age rule would let younger customers book on this live service")];
  }
  return [];
}

const NOT_APPLICABLE_SWAP: Record<NotApplicableSection, { code: string; path: string; what: string }> = {
  safety: { code: "SAFETY_DECLARED_NOT_APPLICABLE", path: "safety", what: "Safety information" },
  quality: { code: "QUALITY_DECLARED_NOT_APPLICABLE", path: "quality", what: "Quality checks" },
  materials: { code: "MATERIALS_DECLARED_NOT_APPLICABLE", path: "materialPolicy", what: "The materials policy" },
  equipment: { code: "EQUIPMENT_DECLARED_NOT_APPLICABLE", path: "equipmentPolicy", what: "The equipment policy" },
};

const isRealPolicy = (policy: string | undefined): boolean => Boolean(policy) && policy !== "NOT_SPECIFIED" && policy !== "NOT_REQUIRED";

/** Does this section currently give a job anything to run under? Any of it counts, not only the publish minimum. */
function sectionProtects(cfg: ServiceCatalogConfig | null, section: NotApplicableSection): boolean {
  if (section === "safety") return Object.values(cfg?.safety ?? {}).some(filled);
  if (section === "materials") return isRealPolicy(cfg?.materialPolicy);
  if (section === "equipment") return isRealPolicy(cfg?.equipmentPolicy);
  const q = cfg?.quality;
  if (!q) return false;
  return (
    filled(q.checklist) || filled(q.completionCriteria) || q.proofRequired === true || q.beforeAfterPhotos === true ||
    q.professionalConfirmation === true || q.customerConfirmation === true || (q.warrantyDays ?? 0) > 0 || (q.complaintWindowDays ?? 0) > 0
  );
}

/**
 * Sections an edit moves from "has content" to "declared not applicable". Each is reported as a
 * regression, so the one mechanism that refuses a live edit that makes a service worse refuses
 * this as well. A section that was already declared, or that never had content, is not a swap.
 */
function notApplicableSwaps(before: ServiceCatalogConfig | null, after: ServiceCatalogConfig | null): PublishIssue[] {
  const out: PublishIssue[] = [];
  for (const section of Object.keys(NOT_APPLICABLE_SWAP) as NotApplicableSection[]) {
    const reason = declaredNotApplicable(after, section);
    if (!reason || declaredNotApplicable(before, section) || !sectionProtects(before, section)) continue;
    const { code, path, what } = NOT_APPLICABLE_SWAP[section];
    out.push({
      code,
      path,
      message: `${what} on this live service would be replaced by a "not applicable" declaration ("${reason}"). That removes a protection its bookings are made under, so it is not accepted as an edit to a live service: pause the service, make the change, and publish it again so that a second admin approves the reason.`,
    });
  }
  return out;
}

/** A rail entry that stops publication. Warnings and not-applicable entries never do. */
export function isBlockingGate(g: Pick<PublishGateResult, "status" | "severity">): boolean {
  return g.severity === "critical" && (g.status === "FAIL" || g.status === "BLOCKED");
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

export type PublishGateStatus = "PASS" | "WARNING" | "FAIL" | "BLOCKED" | "NOT_APPLICABLE";

export type PublishGateResult = {
  code: string;
  status: PublishGateStatus;
  severity: "critical" | "warning" | "info";
  message: string;
  remediation: string;
  path: string;
  version: number | null;
  /** Which of the eighteen publish gates this finding belongs to (set by `publishGateResults`). */
  gate: PublishGate | "OTHER";
};

const GATE_REMEDIATION: Record<string, string> = {
  PRICING_MISSING: "Set a positive base price, or use the quote or inspection pricing model.",
  PRICING_INCOMPLETE: "Complete the price, variant, and quantity configuration the resolver needs.",
  DURATION_MISSING: "Set a positive duration.",
  QUANTITY_MISSING: "Add the quantity rule this pricing model requires.",
  QUANTITY_TYPE: "Set the quantity type this pricing model requires.",
  CONTENT_TITLE_MISSING: "Enter the customer-facing service name.",
  CONTENT_DESCRIPTION_MISSING: "Enter the customer-facing description.",
  TAXONOMY_MISSING: "Place the service in a customer category.",
  MATERIALS_POLICY: "Choose a materials policy. Do not invent a materials list.",
  EQUIPMENT_POLICY: "Choose an equipment policy. Do not invent an equipment list.",
  MATERIALS_NOT_REQUIRED_UNEXPLAINED: "Say why this service needs no materials, or choose who provides them.",
  EQUIPMENT_NOT_REQUIRED_UNEXPLAINED: "Say why this service needs no equipment, or choose who provides it.",
  ADDON_VARIANT_INACTIVE: "Point the add-on at an active variant, or remove the compatibility rule.",
  VARIANT_UNPRICED: "Give the variant a price, or switch it off.",
};

function gateResult(
  service: Pick<ServiceDomainCore, "version">,
  code: string,
  status: PublishGateStatus,
  severity: PublishGateResult["severity"],
  path: string,
  message: string,
  remediation: string,
): PublishGateResult {
  return { code, status, severity, message, remediation, path, version: service.version ?? null, gate: "OTHER" };
}

/**
 * Structured publish rail. FAIL/BLOCKED on a critical gate stops the next activation.
 * Already-active rows keep profile and taxonomy gaps as warnings so they are not unpublished.
 * Absence of safety, quality, or execution steps is a warning: this function does not invent them.
 */
export function publishGateResults(
  service: ServiceDomainCore,
  cfg: ServiceCatalogConfig | null,
  opts: { grandfathered?: boolean; required?: readonly PublishRequiredSection[]; platformPolicy?: PlatformPolicyShape; unavailableTrainingModules?: readonly string[] } = {},
): PublishGateResult[] {
  const results: PublishGateResult[] = [];
  const fail = (code: string, path: string, message: string) =>
    results.push(gateResult(service, code, "FAIL", "critical", path, message, GATE_REMEDIATION[code] ?? "Fix the configuration this gate names."));
  const warn = (code: string, path: string, message: string, remediation: string) =>
    results.push(gateResult(service, code, "WARNING", "warning", path, message, remediation));
  const pass = (code: string, path: string, message: string) =>
    results.push(gateResult(service, code, "PASS", "info", path, message, ""));
  const na = (code: string, path: string, message: string) =>
    results.push(gateResult(service, code, "NOT_APPLICABLE", "info", path, message, ""));

  for (const issue of [...blockingBookabilityIssues(service, cfg), ...contentIssues(service)]) fail(issue.code, issue.path, issue.message);
  const profile = parseProfile(service.capabilityProfile, service.category);
  for (const issue of [...profileIssues(profile, service, cfg), ...taxonomyIssues(service)]) {
    if (opts.grandfathered) {
      warn(issue.code, issue.path, issue.message, "This live service stays bookable. Fix this before the next activation.");
    } else {
      fail(issue.code, issue.path, issue.message);
    }
  }

  const cities = (service.availableCities?.length ?? 0) > 0 || (cfg?.coverage?.cityIds?.length ?? 0) > 0;
  const pins = (cfg?.coverage?.pincodes?.length ?? 0) > 0;
  const zones = (cfg?.coverage?.zoneIds?.length ?? 0) > 0 || (cfg?.coverage?.radiusKm ?? 0) > 0;
  if (cfg?.coverage?.serviceabilityRequired && !(cities || pins || zones)) {
    results.push(gateResult(service, "COVERAGE_INVALID", "FAIL", "critical", "coverage", "This service requires a serviceability check but names no city, zone, PIN code or radius, so no address can pass it.", "Add the area this service covers, or turn off the serviceability requirement."));
  } else if (cities || pins || zones) pass("COVERAGE", "coverage", "Coverage is limited to the configured cities, zones or PIN codes.");
  else warn("COVERAGE_UNSPECIFIED", "coverage", "Coverage is unspecified and is treated as nationwide.", "Set cities or PIN codes if this service is not nationwide.");

  // "Not applicable" is asked through `declaredNotApplicable` — the same call the running job makes.
  const safetyMissing = safetyGaps(cfg);
  const safetyDeclared = declaredNotApplicable(cfg, "safety");
  const safetyPlaceholder = hasPlaceholder(cfg?.safety?.prohibitedConditions) || hasPlaceholder(cfg?.safety?.incidentProtocol);
  const safetyReasonRefused = reasonRefused(cfg, "safety");
  if (safetyMissing.length === 0) pass("SAFETY", "safety", "Safety information names what stops the job and what the professional then does.");
  else if (safetyDeclared) results.push(gateResult(service, "SAFETY_NOT_APPLICABLE", "NOT_APPLICABLE", "info", "safety", `Safety is declared not applicable to this service: "${safetyDeclared}". The declaration is approved with this version.`, ""));
  else {
    const notes = `${safetyPlaceholder ? " A dash or a placeholder word does not count." : ""}${safetyReasonRefused ? ` The reason written for "not applicable" does not count. ${NOT_APPLICABLE_REASON_RULE}` : ""}`;
    warn(
      "SAFETY_ABSENT",
      "safety",
      `Safety information is incomplete: it has no ${safetyMissing.join(" and no ").replace(/\b(a|an) /g, "")}.${notes}`,
      notes
        ? "Write the approved prohibited conditions and incident protocol, or declare with a reason why safety does not apply. Do not invent them."
        : "Add the approved prohibited conditions and incident protocol, or leave the service unpublished until they exist. Do not invent them.",
    );
  }

  const qualityMissing = qualityGaps(cfg);
  const qualityDeclared = declaredNotApplicable(cfg, "quality");
  const qualitySwitchOn = cfg?.quality?.notApplicable === true;
  const qualityPlaceholder = hasPlaceholder(cfg?.quality?.checklist) || hasPlaceholder(cfg?.quality?.completionCriteria);
  const qualityReasonRefused = reasonRefused(cfg, "quality");
  // The switch and its reason are one declaration. Half of it declares nothing, and says so here.
  const qualityHalfDeclared = qualitySwitchOn
    ? ` The "switch off quality checks" switch is on with no accepted reason, so it switches nothing off.${qualityReasonRefused ? ` ${NOT_APPLICABLE_REASON_RULE}` : ""}`
    : qualityReasonRefused
      ? ` The reason written for "not applicable" does not count. ${NOT_APPLICABLE_REASON_RULE}`
      : notApplicableReason(cfg, "quality")
        ? ' A reason is written, but the "switch off quality checks" switch is off, so nothing is declared not applicable.'
        : "";
  if (qualityDeclared) {
    // Declared wins over stored content: the job does not enforce it, so "pass" would describe checks that do not run.
    const kept = qualityMissing.length === 0 ? " The stored checklist and completion criteria are kept and are not enforced while this stands." : "";
    results.push(gateResult(service, "QUALITY_NOT_APPLICABLE", "NOT_APPLICABLE", "info", "quality", `Quality criteria are declared not applicable to this service: "${qualityDeclared}".${kept} The declaration is approved with this version.`, ""));
  } else if (qualityMissing.length === 0) {
    pass("QUALITY", "quality", `Quality criteria name what completion is checked against and what done means.${qualitySwitchOn ? `${qualityHalfDeclared} These checks are enforced.` : ""}`);
  } else {
    const notes = `${qualityPlaceholder ? " A dash or a placeholder word does not count." : ""}${qualityHalfDeclared}`;
    warn(
      "QUALITY_ABSENT",
      "quality",
      `Quality criteria are incomplete: there is no ${qualityMissing.join(" and no ").replace(/\b(a|an) /g, "")}.${notes}`,
      notes
        ? "Write the approved checklist and completion criteria, or switch quality checks off and give the reason they do not apply. Do not invent a checklist."
        : "Add the approved checklist and completion criteria, or leave them unset. Do not invent a checklist.",
    );
  }

  // Advisory, and on the rail so that the readiness view can be the gate and lose nothing it used to say.
  if (cfg?.audiences?.length && !cfg.variants?.length) {
    warn("AUDIENCE_WITHOUT_VARIANTS", "audiences", "Audiences are set but there are no variants to price them.", "Add a variant for each audience, or remove the audiences.");
  }
  if (cfg?.professionalPreferences?.some((p) => p !== "NO_PREFERENCE") && !PROFESSIONAL_PREFERENCE_SUPPORTED) {
    warn("PROFESSIONAL_PREFERENCE_UNSUPPORTED", "professionalPreferences", "Professional preference is configured but assignment cannot honour it yet — hidden from customers.", "Remove the preference until assignment can honour it.");
  }

  if ((cfg?.execution?.steps?.length ?? 0) > 0 && !results.some((g) => g.path.startsWith("execution") && g.status === "FAIL")) {
    pass("EXECUTION", "execution", "The execution plan is structurally valid.");
  } else if (!results.some((g) => g.path.startsWith("execution") && g.status === "FAIL")) {
    warn("EXECUTION_ABSENT", "execution", "No execution steps are configured.", "Add an approved execution plan, or leave steps empty. An empty plan does not invent a method.");
  }

  const brief = catalogPartnerBrief(service, cfg);
  // Structural, not textual: a description may say "matching"; a field outside the allow-list may not exist.
  const leaked = Object.keys(brief).some((k) => !(CATALOG_PARTNER_BRIEF_FIELDS as readonly string[]).includes(k));
  if (leaked) fail("PARTNER_BRIEF_LEAK", "partnerBrief", "The partner brief includes a field outside its allow-list.");
  else if (!brief.objective) {
    // The missing description is already the critical failure; the brief is blocked by it, not a second cause.
    results.push(gateResult(service, "PARTNER_BRIEF_BLOCKED", "BLOCKED", "info", "partnerBrief", "The partner brief has no objective until the description exists.", "Enter the customer-facing description."));
  } else if (brief.stepTitles.length === 0) warn("PARTNER_BRIEF_NO_STEPS", "partnerBrief", "The partner brief has an objective and no execution steps.", "Add approved steps when a method exists.");
  else pass("PARTNER_BRIEF", "partnerBrief", "The partner brief is limited to the objective and step titles.");

  if ((cfg?.addons?.length ?? 0) === 0) {
    na("ADDONS_NONE", "addons", "This service has no add-ons. Customers are not offered a shared add-on list.");
  } else if (!results.some((g) => g.code === "ADDON_VARIANT_INACTIVE")) {
    pass("ADDONS", "addons", "Add-on compatibility references active variants.");
  }

  const availabilityProblems = availabilityIssues(cfg);
  if (availabilityProblems.length) {
    results.push(gateResult(service, "AVAILABILITY_INVALID", "FAIL", "critical", "availability", `These availability rules can never offer a slot: ${availabilityProblems.join("; ")}.`, "Correct the operating window, lead time or booking modes so at least one slot can exist."));
  } else if (cfg?.availability) pass("AVAILABILITY", "availability", "Availability rules are configured and can offer a slot.");
  else warn("AVAILABILITY_DEFAULT", "availability", "No availability window is configured. The platform default of 07:00–22:00 applies.", "Set an operating window, all-day, or blackout dates when this service differs from the default.");

  // Booking, cancellation and refund money is one platform policy, frozen onto each booking at
  // creation. There is no per-service fee table to validate, so the gate validates the policy a
  // booking of this service would freeze today. If that policy is malformed, nothing may publish.
  const policy = opts.platformPolicy ?? CANCELLATION_POLICY;
  const policyProblems = platformPolicyIssues(policy);
  if (policyProblems.length) {
    results.push(gateResult(service, "PLATFORM_POLICY_INVALID", "FAIL", "critical", "bookingRules", `A booking of this service would freeze platform policy ${policy.version}, which is inconsistent (${policyProblems.join("; ")}).`, "Fix the platform cancellation policy. No service can be published until it is consistent."));
  } else {
    pass("BOOKING_POLICY", "bookingRules", `A booking of this service freezes platform policy ${policy.version} at creation; later policy changes do not re-price it.`);
  }
  // Wording on the service is shown to customers, and nothing enforces it: the money follows the
  // platform policy. The gate cannot read prose, so it says so instead of passing it.
  const wording: [string, string, unknown][] = [
    ["cancellation", "cancellation", cfg?.bookingRules?.cancellationPolicy],
    ["refund", "refund", cfg?.payment?.refundPolicy],
  ];
  for (const [path, what, text] of wording) {
    if (!filled(text)) continue;
    warn("POLICY_WORDING_NOT_ENFORCED", path, `This service carries its own ${what} wording. It is shown as written; fees and refunds follow platform policy ${policy.version}.`, `Check the wording against platform policy ${policy.version}, or remove it.`);
  }
  for (const [code, path, what] of [["CANCELLATION_POLICY", "cancellation", "Cancellation"], ["REFUND_POLICY", "refund", "Refund"]] as const) {
    if (policyProblems.length) {
      results.push(gateResult(service, "PLATFORM_POLICY_INVALID", "FAIL", "critical", path, `${what} terms cannot be relied on: platform policy ${policy.version} is inconsistent (${policyProblems.join("; ")}).`, "Fix the platform cancellation policy. No service can be published until it is consistent."));
    } else {
      pass(code, path, `${what} terms come from platform policy ${policy.version}: ${policy.tiers.length} tiers, each with a fee and a refund that add up to the amount paid.`);
    }
  }
  na("PROVIDER_EARNINGS", "earnings", "Provider commission stays on the volume commission schedule, not on this service.");
  na("CAPACITY", "capacity", "Capacity stays on the partner capacity settings, not on this service.");

  // A required training module that is missing or unpublished can be completed by nobody, so the
  // TRAINING_INCOMPLETE gate would refuse every professional. The caller supplies the fact (a
  // database read); without it this check is silent rather than guessed.
  const trainingGaps = (opts.unavailableTrainingModules ?? []).filter((slug) => (cfg?.providerRequirements?.trainingModules ?? []).includes(slug));
  if (trainingGaps.length > 0) {
    const message = `Required training ${trainingGaps.length === 1 ? "module" : "modules"} ${trainingGaps.map((s) => `"${s}"`).join(", ")} ${trainingGaps.length === 1 ? "is" : "are"} not published, so no professional can qualify for this service.`;
    const remediation = "Publish the training module, or remove it from this service's provider requirements.";
    if (opts.grandfathered) warn("TRAINING_MODULE_UNAVAILABLE", "providerRequirements", `${message} This live service cannot currently be matched to anyone.`, remediation);
    else results.push(gateResult(service, "TRAINING_MODULE_UNAVAILABLE", "FAIL", "critical", "providerRequirements", message, remediation));
  } else if (cfg?.providerRequirements?.requiredSkills?.length) pass("PROVIDER_REQUIREMENTS", "providerRequirements", "Provider skill requirements are configured.");
  else warn("PROVIDER_REQUIREMENTS_EMPTY", "providerRequirements", "No provider skill requirement is configured, so matching does not gate on skill.", "Add skills only when they are real requirements.");

  const weights = MATCHING_WEIGHT_FIELDS.map((k) => cfg?.matching?.[k]).filter((w): w is number => typeof w === "number");
  if (weights.length > 0 && weights.every((w) => w === 0)) {
    results.push(gateResult(service, "MATCHING_INVALID", "FAIL", "critical", "matching", "Every matching weight on this service is zero, so eligible professionals cannot be ranked.", "Give at least one ranking signal a weight above zero, or remove the weights to use the platform defaults."));
  } else if (weights.length > 0) pass("MATCHING", "matching", "Matching weights on this service can rank eligible professionals.");
  else na("MATCHING_DEFAULT", "matching", "No weights are set on this service; the platform ranking weights apply.");

  na("REVIEWS", "reviews", "Reviews are aggregated from ratings. They are not catalogue configuration.");
  if (cfg?.faqs?.length) pass("FAQ", "faqs", "FAQs are configured.");
  else na("FAQ_NONE", "faqs", "FAQs are optional.");

  // Owner policy: a section named as required blocks a first publish while it is absent. A live
  // service keeps its warning — a new requirement never unpublishes what is already bookable.
  if (!opts.grandfathered) {
    for (const section of opts.required ?? publishRequiredSections()) {
      const absent = results.find((g) => g.code === REQUIRED_SECTION_ABSENT_CODE[section] && g.status === "WARNING");
      if (!absent) continue;
      absent.status = "BLOCKED";
      absent.severity = "critical";
      absent.message = `${absent.message} This section is required before a service can be published.`;
    }
  }

  // Every named gate answers for every service. A gate with no finding above has passed, or does
  // not apply; saying so is the difference between "checked and fine" and "never looked".
  for (const r of results) r.gate = gateOf(r.code, r.path);
  const reported = new Set(results.map((r) => r.gate));
  const silent = (gate: PublishGate, status: "PASS" | "NOT_APPLICABLE", path: string, message: string) => {
    if (!reported.has(gate)) results.push({ ...gateResult(service, gate, status, "info", path, message, ""), gate });
  };
  silent("PRICING", "PASS", "pricing", "The price, quantity rule and currency resolve to a positive amount.");
  silent("DURATION", "PASS", "duration", "The duration is set and internally consistent.");
  if ((cfg?.variants ?? []).some((v) => v.active !== false)) silent("VARIANT", "PASS", "variants", "Every active variant resolves to a price.");
  else silent("VARIANT", "NOT_APPLICABLE", "variants", "This service has no variants.");
  if (cfg?.audiences?.length || cfg?.customerPolicy?.age) silent("ELIGIBILITY", "PASS", "audiences", "Audience and age rules are set and consistent.");
  else silent("ELIGIBILITY", "NOT_APPLICABLE", "audiences", "This service has no audience or age restriction.");
  const noMaterials = declaredNotApplicable(cfg, "materials");
  const noEquipment = declaredNotApplicable(cfg, "equipment");
  if (noMaterials && !reported.has("MATERIALS")) results.push({ ...gateResult(service, "MATERIALS_NOT_APPLICABLE", "NOT_APPLICABLE", "info", "materialPolicy", `No materials are needed for this service: "${noMaterials}". The declaration is approved with this version.`, ""), gate: "MATERIALS" });
  else silent("MATERIALS", "PASS", "materialPolicy", "The materials policy is set and its requirements are consistent.");
  if (noEquipment && !reported.has("EQUIPMENT")) results.push({ ...gateResult(service, "EQUIPMENT_NOT_APPLICABLE", "NOT_APPLICABLE", "info", "equipmentPolicy", `No equipment is needed for this service: "${noEquipment}". The declaration is approved with this version.`, ""), gate: "EQUIPMENT" });
  else silent("EQUIPMENT", "PASS", "equipmentPolicy", "The equipment policy is set.");
  silent("CUSTOMER_CONTENT", "PASS", "description", "The service has a name, a description and a place in the customer catalogue.");

  return results;
}

/**
 * The control-plane vocabulary: DRAFT → VALIDATING → REVIEW → APPROVED → SCHEDULED → LIVE → PAUSED →
 * DEPRECATED → ARCHIVED. Seven are the stored lifecycle under these names. APPROVED and SCHEDULED
 * are not stored states: a service in review is APPROVED while a second admin's approval of its
 * current content stands, and SCHEDULED while that approval carries a go-live time still ahead.
 * Deriving them means they cannot disagree with the approval they describe.
 */
export const CONTROL_PLANE_STATES = ["DRAFT", "VALIDATING", "REVIEW", "APPROVED", "SCHEDULED", "LIVE", "PAUSED", "DEPRECATED", "ARCHIVED"] as const;
export type ControlPlaneState = (typeof CONTROL_PLANE_STATES)[number];

export function controlPlaneState(input: {
  lifecycleStatus: string | null | undefined;
  approvalState: "NONE" | "VALID" | "STALE";
  scheduledLiveAt: string | null | undefined;
  now: Date;
}): ControlPlaneState {
  const lifecycle = parseLifecycle(input.lifecycleStatus);
  if (lifecycle === "DRAFT") return "DRAFT";
  if (lifecycle === "CONFIGURATION_REQUIRED") return "VALIDATING";
  if (lifecycle === "ACTIVE" || lifecycle === "PUBLISHED") return "LIVE";
  if (lifecycle === "PAUSED" || lifecycle === "DEPRECATED" || lifecycle === "ARCHIVED") return lifecycle;
  if (input.approvalState !== "VALID") return "REVIEW";
  const at = scheduledLiveInstant(input.scheduledLiveAt);
  return at && at.getTime() > input.now.getTime() ? "SCHEDULED" : "APPROVED";
}

/** Lifecycle targets that take a service off sale. Each needs a reason on record. */
export const OFF_SALE_LIFECYCLES: readonly ServiceLifecycleStatus[] = ["PAUSED", "DEPRECATED", "ARCHIVED"];

/** The eighteen gates of the publish rule. Every one reports for every service. */
export const PUBLISH_GATES = [
  "PRICING",
  "VARIANT",
  "ADDON_COMPATIBILITY",
  "DURATION",
  "ELIGIBILITY",
  "SERVICEABILITY",
  "AVAILABILITY",
  "MATERIALS",
  "EQUIPMENT",
  "PROVIDER_REQUIREMENTS",
  "MATCHING",
  "BOOKING_POLICY",
  "CANCELLATION",
  "REFUND",
  "SAFETY",
  "QUALITY",
  "CUSTOMER_CONTENT",
  "PARTNER_EXECUTION_BRIEF",
] as const;
export type PublishGate = (typeof PUBLISH_GATES)[number];

const MATCHING_WEIGHT_FIELDS = ["skillWeight", "distanceWeight", "ratingWeight", "availabilityWeight", "responseWeight", "completionWeight"] as const;

/** Which of the eighteen gates a finding belongs to. OTHER is information outside the publish rule. */
function gateOf(code: string, path: string): PublishGate | "OTHER" {
  if (code.startsWith("CANCELLATION") || path === "cancellation") return "CANCELLATION";
  if (code.startsWith("REFUND") || path === "refund") return "REFUND";
  if (code.startsWith("PRICING") || code.startsWith("QUANTITY") || path === "basePrice" || path === "pricing" || path.startsWith("quantity")) return "PRICING";
  if (code === "VARIANT_MISSING" || path.startsWith("variant")) return "VARIANT";
  if (path.startsWith("addons")) return "ADDON_COMPATIBILITY";
  if (code.startsWith("DURATION") || path === "estimatedDuration" || path.startsWith("duration")) return "DURATION";
  if (code.startsWith("AUDIENCE") || path === "audiences") return "ELIGIBILITY";
  if (path === "coverage") return "SERVICEABILITY";
  if (path === "availability") return "AVAILABILITY";
  if (path === "materialPolicy" || path.startsWith("requirements")) return "MATERIALS";
  if (path === "equipmentPolicy") return "EQUIPMENT";
  if (path === "providerRequirements") return "PROVIDER_REQUIREMENTS";
  if (path === "matching") return "MATCHING";
  if (path === "bookingRules" || path === "bookingModes") return "BOOKING_POLICY";
  if (path === "safety") return "SAFETY";
  if (path === "quality") return "QUALITY";
  if (path === "name" || path === "description" || path === "categoryId") return "CUSTOMER_CONTENT";
  if (path.startsWith("execution") || path === "partnerBrief") return "PARTNER_EXECUTION_BRIEF";
  return "OTHER";
}

/** Availability rules that contradict each other so that no slot can ever be offered. */
function availabilityIssues(cfg: ServiceCatalogConfig | null): string[] {
  const a = cfg?.availability;
  if (!a) return [];
  const out: string[] = [];
  if (a.operatingWindow && a.allDay) out.push("it is both all-day and limited to an operating window");
  else if (a.operatingWindow && a.operatingWindow.start >= a.operatingWindow.end) out.push(`the operating window closes (${a.operatingWindow.end}) at or before it opens (${a.operatingWindow.start})`);
  const lead = a.minimumLeadTimeMinutes ?? 0;
  if ((a.sameDay || cfg?.sameDayAvailable) && lead >= 24 * 60) out.push("same-day booking is on but the lead time is a day or more");
  if (a.maximumAdvanceDays != null && lead >= a.maximumAdvanceDays * 24 * 60) out.push("the lead time is longer than the furthest day that can be booked");
  if (a.instant === false && a.scheduled === false) out.push("neither instant nor scheduled booking is allowed");
  return out;
}

/** What the gate needs to know about the platform money policy a booking freezes. */
export type PlatformPolicyShape = { version: string; tiers: ReadonlyArray<{ id: string; feePercent: number; refundPercent: number; message: string }> };

/**
 * Whether the platform cancellation policy is one a customer can be held to: it has a version and
 * tiers, each tier has a message, and in each the fee and the refund are percentages that add up
 * to the whole amount. Empty means consistent.
 */
export function platformPolicyIssues(policy: PlatformPolicyShape = CANCELLATION_POLICY): string[] {
  const out: string[] = [];
  if (!policy.version?.trim()) out.push("the policy has no version");
  if (!policy.tiers.length) out.push("the policy has no tiers");
  const seen = new Set<string>();
  for (const t of policy.tiers) {
    if (seen.has(t.id)) out.push(`tier "${t.id}" is defined twice`);
    seen.add(t.id);
    const inRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;
    if (!inRange(t.feePercent) || !inRange(t.refundPercent)) out.push(`tier "${t.id}" has a percentage outside 0–100`);
    else if (t.feePercent + t.refundPercent !== 100) out.push(`tier "${t.id}": fee ${t.feePercent}% and refund ${t.refundPercent}% do not add up to 100%`);
    if (!t.message?.trim()) out.push(`tier "${t.id}" has no customer message`);
  }
  return out;
}

export type LiveEditPolicy = "direct" | "four-eyes";

/**
 * Who may change the approved content of a LIVE service.
 *
 * "four-eyes": the change is held as a pending revision until a different admin approves it.
 * "direct": it applies at once, versioned and audited.
 *
 * Owner decision (2026-10-06): on a deployed environment four-eyes is the rule as soon as it can
 * work, which is when at least two admins can approve. With a single approver it would stop every
 * live edit, so the policy is direct until a second approver exists. SERVICE_LIVE_EDIT_POLICY sets
 * it explicitly. A developer machine or test runner defaults to direct. A value that is neither
 * "direct" nor "four-eyes" is ignored, never read as direct.
 */
export function liveEditPolicyFor(input: {
  configured: string | undefined;
  knownLocal: boolean;
  approverCount: number;
}): { policy: LiveEditPolicy; source: "configured" | "auto" | "local-default" } {
  const configured = (input.configured ?? "").trim().toLowerCase();
  if (configured === "direct" || configured === "four-eyes") return { policy: configured, source: "configured" };
  if (input.knownLocal && !configured) return { policy: "direct", source: "local-default" };
  return { policy: input.approverCount >= 2 ? "four-eyes" : "direct", source: "auto" };
}

/** Sections the owner may require before a first publish, and the gate that reports each as absent. */
const REQUIRED_SECTION_ABSENT_CODE = {
  safety: "SAFETY_ABSENT",
  quality: "QUALITY_ABSENT",
  execution: "EXECUTION_ABSENT",
  providerRequirements: "PROVIDER_REQUIREMENTS_EMPTY",
  coverage: "COVERAGE_UNSPECIFIED",
  availability: "AVAILABILITY_DEFAULT",
} as const;
export type PublishRequiredSection = keyof typeof REQUIRED_SECTION_ABSENT_CODE;

/** Required before a first publish on a deployed environment when the owner configured nothing. */
const DEPLOYED_REQUIRED_SECTIONS: readonly PublishRequiredSection[] = ["safety", "quality", "execution"];

/**
 * Which sections must exist before a service is first published.
 *
 * Owner decision (2026-10-06): a service with no approved safety information, quality criteria or
 * execution plan stays unpublished rather than going live without them, and the platform never
 * invents them. So a deployed environment requires those three unless SERVICE_PUBLISH_REQUIRES says
 * otherwise ("none" requires nothing; a list replaces the default). A developer machine or test
 * runner requires nothing by default, so fixtures can publish minimal services. A live service is
 * never unpublished by this list (see `publishGateResults`).
 */
export function publishRequiredSections(
  raw: string | undefined = process.env.SERVICE_PUBLISH_REQUIRES,
  knownLocal: boolean = isKnownLocalEnvironment(),
): PublishRequiredSection[] {
  const text = (raw ?? "").trim();
  if (!text) return knownLocal ? [] : [...DEPLOYED_REQUIRED_SECTIONS];
  if (text.toLowerCase() === "none") return [];
  const known = Object.keys(REQUIRED_SECTION_ABSENT_CODE) as PublishRequiredSection[];
  const out: PublishRequiredSection[] = [];
  let unrecognised = false;
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const match = known.find((k) => k.toLowerCase() === part.toLowerCase());
    if (!match) unrecognised = true;
    else if (!out.includes(match)) out.push(match);
  }
  // A name this function does not know is a mistake in the setting, and a mistake must not loosen
  // the gate: the sections a deployed environment requires by default are required as well.
  if (unrecognised) for (const section of DEPLOYED_REQUIRED_SECTIONS) if (!out.includes(section)) out.push(section);
  return out;
}

/** Every field `catalogPartnerBrief` may return. The publish gate fails on anything else. */
export const CATALOG_PARTNER_BRIEF_FIELDS = ["objective", "stepTitles"] as const;

/** What a partner may see from the live catalogue before a booking snapshot exists. No prices or internals. */
export function catalogPartnerBrief(
  service: Pick<ServiceDomainCore, "description">,
  cfg: ServiceCatalogConfig | null,
): { objective: string | null; stepTitles: string[] } {
  const steps = cfg?.execution?.steps ?? [];
  return {
    objective: service.description?.trim() || null,
    stepTitles: steps.filter((s) => s.active !== false).map((s) => s.title),
  };
}

export type PublishApprovalDecision =
  | { ok: true }
  | { ok: false; code: "APPROVAL_REQUIRED" | "APPROVER_IS_EDITOR" | "APPROVAL_STALE" | "APPROVE_PERMISSION_REQUIRED" };

/**
 * A second admin with APPROVE must have approved the current editor's version. When the caller
 * passes `currentContentHash`, the approval must also be of exactly that content: an approval
 * recorded without a hash, or of other content, is stale.
 */
export function evaluatePublishApproval(input: {
  approverId: string | null;
  editorId: string | null;
  approvedEditorId: string | null;
  approverHasApprove: boolean;
  approvedContentHash?: string | null;
  currentContentHash?: string;
}): PublishApprovalDecision {
  if (!input.approverHasApprove || !input.approverId) return { ok: false, code: "APPROVE_PERMISSION_REQUIRED" };
  if (!input.editorId || !input.approvedEditorId) return { ok: false, code: "APPROVAL_REQUIRED" };
  if (input.approverId === input.editorId) return { ok: false, code: "APPROVER_IS_EDITOR" };
  if (input.approvedEditorId !== input.editorId) return { ok: false, code: "APPROVAL_STALE" };
  if (input.currentContentHash !== undefined && input.approvedContentHash !== input.currentContentHash) {
    return { ok: false, code: "APPROVAL_STALE" };
  }
  return { ok: true };
}

/** Row fields that decide what a customer is sold and shown. Workflow and bookkeeping columns are absent on purpose. */
const APPROVAL_CONTENT_FIELDS = [
  "name",
  "displayName",
  "shortName",
  "description",
  "detailedDescription",
  "category",
  "subcategory",
  "categoryId",
  "subcategoryId",
  "basePrice",
  "minPrice",
  "maxPrice",
  "currency",
  "estimatedDuration",
  "pricingModel",
  "capabilityProfile",
  "partnerSlotPolicy",
  "premiumOnly",
  "includedServices",
  "excludedServices",
  "requirements",
  "availableCities",
  "thumbnail",
  "images",
] as const;

function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Fingerprint of what an approver approves: the selling columns plus the catalogue configuration,
 * minus the approval record, the schedule and server-attached catalogue facts. Any later change to
 * price, duration, content or configuration yields another hash, whoever makes it.
 */
export function approvalContentHash(service: object, cfg: ServiceCatalogConfig | null): string {
  const row = service as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const key of APPROVAL_CONTENT_FIELDS) fields[key] = row[key] ?? null;
  const { publishApproval: _approval, scheduledLiveAt: _when, requirementItems: _facts, ...config } = (cfg ?? {}) as Record<string, unknown>;
  return createHash("sha256").update(canonicalJson({ fields, config })).digest("hex");
}

export type ContentChange = { field: string; before: unknown; after: unknown };

/**
 * What a reviewer is asked to approve: each selling column and each top-level configuration section
 * that differs, with both values. Covers exactly what `approvalContentHash` covers, so an empty
 * list and an equal hash are the same statement.
 */
export function contentDiff(prev: object, prevCfg: ServiceCatalogConfig | null, next: object, nextCfg: ServiceCatalogConfig | null): ContentChange[] {
  const changes: ContentChange[] = [];
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  for (const key of APPROVAL_CONTENT_FIELDS) {
    if (canonicalJson(a[key]) !== canonicalJson(b[key])) changes.push({ field: key, before: a[key] ?? null, after: b[key] ?? null });
  }
  const strip = (cfg: ServiceCatalogConfig | null) => {
    const { publishApproval: _approval, scheduledLiveAt: _when, requirementItems: _facts, ...config } = (cfg ?? {}) as Record<string, unknown>;
    return config;
  };
  const ca = strip(prevCfg);
  const cb = strip(nextCfg);
  for (const key of [...new Set([...Object.keys(ca), ...Object.keys(cb)])].sort()) {
    if (canonicalJson(ca[key]) !== canonicalJson(cb[key])) changes.push({ field: `config.${key}`, before: ca[key] ?? null, after: cb[key] ?? null });
  }
  return changes;
}

/** No offset is Asia/Kolkata. An unparseable value is null. */
export function scheduledLiveInstant(raw: string | null | undefined): Date | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  const hasZone = /(?:z|[+-]\d{2}:\d{2})$/i.test(value);
  const date = new Date(hasZone ? value : `${value}+05:30`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * No timestamp means publish may proceed immediately once approval and the gate pass.
 * A future timestamp waits. A due timestamp with a failed gate or approval does not activate.
 */
export function scheduledActivationDecision(input: {
  scheduledLiveAt: string | null | undefined;
  now: Date;
  gateOk: boolean;
  approvalOk: boolean;
}): { action: "immediate" | "wait" | "activate" | "fail" } {
  if (!input.scheduledLiveAt) {
    if (!input.approvalOk || !input.gateOk) return { action: "fail" };
    return { action: "immediate" };
  }
  const at = scheduledLiveInstant(input.scheduledLiveAt);
  if (!at) return { action: "fail" };
  if (at.getTime() > input.now.getTime()) return { action: "wait" };
  if (!input.gateOk || !input.approvalOk) return { action: "fail" };
  return { action: "activate" };
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
 * Allowed lifecycle moves. Mapping to the requested vocabulary:
 *   DRAFT = DRAFT, VALIDATING = CONFIGURATION_REQUIRED, REVIEW = READY_FOR_REVIEW,
 *   LIVE = ACTIVE (bookable) or PUBLISHED (visible, coming soon; derived from comingSoon),
 *   PAUSED, DEPRECATED, ARCHIVED unchanged.
 * APPROVED is an audit row plus SETTINGS/APPROVE, not an enum value.
 * SCHEDULED is `catalogConfig.scheduledLiveAt`, applied by the retention tick, not an enum value.
 * DRAFT cannot jump to ACTIVE. ARCHIVED is terminal.
 */
export const LIFECYCLE_TRANSITIONS: Readonly<Record<ServiceLifecycleStatus, readonly ServiceLifecycleStatus[]>> = {
  DRAFT: ["CONFIGURATION_REQUIRED", "ARCHIVED"],
  CONFIGURATION_REQUIRED: ["DRAFT", "READY_FOR_REVIEW", "ARCHIVED"],
  READY_FOR_REVIEW: ["DRAFT", "CONFIGURATION_REQUIRED", "ACTIVE", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ACTIVE", "PAUSED", "DEPRECATED"],
  ACTIVE: ["PUBLISHED", "PAUSED", "DEPRECATED"],
  PAUSED: ["ACTIVE", "PUBLISHED", "DEPRECATED", "ARCHIVED"],
  DEPRECATED: ["ARCHIVED"],
  ARCHIVED: [],
};

/** Targets an admin may request directly. PUBLISHED is reached by requesting ACTIVE on a coming-soon SKU. */
export const REQUESTABLE_LIFECYCLES = ["DRAFT", "CONFIGURATION_REQUIRED", "READY_FOR_REVIEW", "PUBLISHED", "ACTIVE", "PAUSED", "DEPRECATED", "ARCHIVED"] as const;
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

export type ReadinessOptions = { required?: readonly PublishRequiredSection[]; platformPolicy?: PlatformPolicyShape; unavailableTrainingModules?: readonly string[] };

/**
 * Why a service is not ready, in the gate's own words. This IS the gate: the findings that would
 * refuse this service — a first publish for one that is not live, the grandfathered rule for one
 * that is. It used to be a separate, shorter list (`catalogConfigGaps`), which called a service
 * READY while the gate refused it for an unexplained "not required" or an absent required section.
 * Empty = `validateForActivation` with the same options passes.
 */
export function readinessGaps(service: ServiceDomainCore, cfg: ServiceCatalogConfig | null, opts: ReadinessOptions = {}): string[] {
  return publishGateResults(service, cfg, { ...opts, grandfathered: service.isActive === true })
    .filter(isBlockingGate)
    .map((g) => g.message);
}

/** READY exactly when `readinessGaps` is empty. Pass the same options the gate is given (training-module facts especially). */
export function deriveConfigStatus(service: ServiceDomainCore, cfg: ServiceCatalogConfig | null, opts: ReadinessOptions = {}): ServiceConfigStatus {
  const lifecycle = parseLifecycle(service.lifecycleStatus);
  if (lifecycle === "ARCHIVED") return "ARCHIVED";
  if (lifecycle === "PAUSED" || lifecycle === "DEPRECATED") return "PAUSED";
  if (cfg?.comingSoon) return "COMING_SOON";
  if (readinessGaps(service, cfg, opts).length > 0) return "CONFIGURATION_REQUIRED";
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

const SECTION_PATHS: Record<string, string[]> = {
  identity: ["name", "slug"],
  content: ["description", "name"],
  audience: ["audiences"],
  booking: ["comingSoon"],
  pricing: ["basePrice", "pricing"],
  quantity: ["quantity"],
  duration: ["estimatedDuration", "duration"],
  variants: ["variants"],
  addons: ["addons"],
  materials: ["materialPolicy", "requirements"],
  equipment: ["equipmentPolicy"],
  provider: ["providerRequirements"],
  coverage: ["coverage"],
  availability: ["availability"],
  bookingRules: ["bookingRules"],
  safety: ["safety"],
  quality: ["quality"],
  matching: ["matching"],
  payment: ["payment"],
  partnerBrief: ["partnerBrief"],
  reviews: ["reviews"],
  faqs: ["faqs"],
  earnings: ["earnings"],
  capacity: ["capacity"],
};

function sectionStatus(gates: PublishGateResult[], fallback: SectionStatus): SectionStatus {
  if (gates.some((g) => g.status === "FAIL" || g.status === "BLOCKED")) return "missing";
  if (gates.some((g) => g.status === "WARNING")) return "warn";
  return fallback;
}

export function configSections(service: ServiceDomainCore, cfg: ServiceCatalogConfig | null): ConfigSection[] {
  const gates = publishGateResults(service, cfg, { grandfathered: service.isActive });
  const forPaths = (paths: string[]) => gates.filter((g) => paths.some((p) => g.path === p || g.path.startsWith(`${p}.`)));
  const section = (id: string, label: string, fallback: SectionStatus, extra: string[] = []): ConfigSection => {
    const own = forPaths(SECTION_PATHS[id] ?? [id]);
    const issues = [...own.filter((g) => g.status !== "PASS").map((g) => g.message), ...extra];
    return { id, label, status: sectionStatus(own, fallback), issues, gates: own };
  };
  const identityOk = Boolean(service.name && service.slug && service.category);
  return [
    section("identity", "Identity", identityOk ? "ok" : "missing", identityOk ? [] : ["name, slug or category missing"]),
    section("content", "Content", service.description ? "ok" : "warn"),
    section("audience", "Audience", "ok"),
    section("booking", "Booking", cfg?.comingSoon ? "warn" : "ok", cfg?.comingSoon ? ["Coming soon — not bookable"] : []),
    section("pricing", "Pricing", service.basePrice > 0 || service.pricingModel === "quote" ? "ok" : "missing"),
    section("quantity", "Quantity", "ok"),
    section("duration", "Duration", service.estimatedDuration > 0 ? "ok" : "missing"),
    section("variants", "Variants", "ok"),
    section("addons", "Add-ons", "ok"),
    section("materials", "Materials", "ok"),
    section("equipment", "Equipment", "ok"),
    section("provider", "Provider requirements", "ok"),
    section("coverage", "Coverage", "ok"),
    section("availability", "Availability", "ok"),
    section("bookingRules", "Booking rules", "ok"),
    section("safety", "Safety", "ok"),
    section("quality", "Quality", "ok"),
    section("matching", "Matching", "ok"),
    section("payment", "Payment", "ok"),
    section("media", "Media", "ok"),
    section("trust", "Trust", "ok"),
    section("reviews", "Reviews", "ok"),
    section("seo", "SEO", "ok"),
    section("analytics", "Analytics", "ok"),
    section("operations", "Operations", "ok"),
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
