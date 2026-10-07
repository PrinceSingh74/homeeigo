import { z } from "zod";
import { requirementAssignmentSchema, requirementCode, requirementItemInfoSchema } from "./service-requirements";
import { executionPlanSchema } from "./service-execution";
import { MoneyError, sumPaise, toPaise, toRupees } from "./pricing-policy";

/**
 * Admin-managed service configuration stored in `services.catalog_config`
 * (JSONB) plus the pure, DB-free resolution of a customer's selection into a
 * server price. Everything the booking flow charges is derived here from
 * server data — the client only ever sends ids, a quantity and an audience.
 */

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const QUANTITY_TYPES = [
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
export const AUDIENCES = ["women", "men", "girls", "boys", "senior-women", "senior-men"] as const;
export const RESPONSIBILITY_POLICIES = [
  "CUSTOMER_PROVIDED",
  "PROFESSIONAL_PROVIDED",
  "PACKAGE_INCLUDED",
  "MIXED",
  "NOT_REQUIRED",
  "NOT_SPECIFIED",
] as const;
export const SPARE_PARTS_POLICIES = ["NOT_APPLICABLE", "INCLUDED", "CUSTOMER_PAYS", "APPROVAL_REQUIRED"] as const;
export const PROFESSIONAL_PREFERENCES = ["NO_PREFERENCE", "FEMALE", "MALE"] as const;
export const PRICING_MODELS = ["fixed", "hourly", "per-unit", "per-seat", "area", "package", "inspection", "quote"] as const;
export const BOOKING_MODES = [
  "INSTANT",
  "SCHEDULED",
  "RECURRING",
  "HOURLY",
  "UNIT",
  "AREA",
  "PACKAGE",
  "INSPECTION",
  "CUSTOM_QUOTE",
] as const;
export const SERVICE_MODES = [
  "FIXED_SERVICE",
  "FLEXIBLE_TASK",
  "REPAIR",
  "INSPECTION",
  "QUOTE",
  "PACKAGE",
  "BEAUTY",
  "CARE",
  "CONCIERGE",
] as const;

export type QuantityType = (typeof QUANTITY_TYPES)[number];
export type Audience = (typeof AUDIENCES)[number];
export type ProfessionalPreference = (typeof PROFESSIONAL_PREFERENCES)[number];

/**
 * The assignment engine does not filter professionals by gender, so a
 * preference could not be honoured. Until it can, no preference other than
 * "no preference" is offered or accepted — whatever admins configure.
 */
export const PROFESSIONAL_PREFERENCE_SUPPORTED = false;

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

const text = (max: number) => z.string().trim().min(1).max(max);
const idText = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and hyphens");
const money = z
  .number()
  .finite()
  .min(0)
  .max(1_000_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "amount must have at most 2 decimal places (whole paise)");
const minutes = z.number().int().min(1).max(60 * 24 * 7);

/**
 * Media reference: an https URL or a site-relative path. `javascript:`, `data:`, `http:` and
 * protocol-relative `//host` URLs are refused — they are either unsafe to render or mixed content.
 * This is a reference to already-hosted media; there is no second upload system here.
 */
export const MEDIA_URL_RE = /^(https:\/\/[^\s]+|\/(?!\/)[^\s]*)$/i;
export function isSafeMediaUrl(v: string): boolean {
  return MEDIA_URL_RE.test(v.trim());
}
const mediaUrl = z
  .string()
  .trim()
  .max(500)
  .refine(isSafeMediaUrl, "media must be an https:// URL or a site-relative /path");

const quantityOverride = z
  .object({
    unitPrice: money.optional(),
    min: z.number().int().min(1).max(1000).optional(),
    max: z.number().int().min(1).max(1000).optional(),
  })
  .strict()
  .refine((q) => q.min == null || q.max == null || q.max >= q.min, { message: "max must be ≥ min", path: ["max"] });

export const quantityRuleSchema = z
  .object({
    type: z.enum(QUANTITY_TYPES),
    /** Singular customer label: "hour", "bathroom", "seat", "sq. ft.". */
    unitLabel: text(30),
    unitLabelPlural: text(30).optional(),
    min: z.number().int().min(1).max(1000),
    max: z.number().int().min(1).max(1000),
    step: z.number().int().min(1).max(1000).default(1),
    default: z.number().int().min(1).max(1000).optional(),
    /** Price per unit. Defaults to the variant price or the service base price. */
    unitPrice: money.optional(),
    /** Minimum charge for the whole line, if any. */
    minimumCharge: money.optional(),
    /** Extra minutes per additional unit (HOUR scales by the hour automatically). */
    durationPerUnitMin: minutes.optional(),
    /** The customer must choose a quantity explicitly; no default is applied. */
    required: z.boolean().optional(),
  })
  .strict()
  .refine((q) => q.max >= q.min, { message: "max must be ≥ min", path: ["max"] })
  .refine((q) => q.default == null || (q.default >= q.min && q.default <= q.max), {
    message: "default must be within min..max",
    path: ["default"],
  });

export const variantSchema = z
  .object({
    id: idText,
    name: text(80),
    price: money,
    durationMin: minutes.optional(),
    description: text(500).optional(),
    inclusions: z.array(text(200)).max(20).optional(),
    exclusions: z.array(text(200)).max(20).optional(),
    requirements: z.array(text(200)).max(20).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    /** Audiences allowed to book this variant (omit = every service audience). */
    audiences: z.array(z.enum(AUDIENCES)).max(AUDIENCES.length).optional(),
    professionalPreferences: z.array(z.enum(PROFESSIONAL_PREFERENCES)).max(3).optional(),
    quantity: quantityOverride.optional(),
    active: z.boolean().default(true),
  })
  .strict();

export const addonSchema = z
  .object({
    id: idText,
    name: text(80),
    price: money,
    durationMin: minutes.optional(),
    description: text(500).optional(),
    quantityAllowed: z.boolean().optional(),
    /** Most units of this add-on one booking may take. Unset = exactly one. */
    maxQuantity: z.number().int().min(1).max(100).optional(),
    compatibleVariantIds: z.array(idText).max(30).optional(),
    /** Add-ons that must also be selected with this one. */
    requiresAddonIds: z.array(idText).max(20).optional(),
    /** Add-ons that cannot be selected together with this one (symmetric). */
    conflictsWithAddonIds: z.array(idText).max(20).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().default(true),
  })
  .strict();

const faqSchema = z.object({ q: text(200), a: text(1000) }).strict();

const materialItemSchema = z
  .object({
    name: text(80),
    category: text(40).optional(),
    quantity: z.number().finite().min(0).max(10_000).optional(),
    unit: text(20).optional(),
    provider: z.enum(["CUSTOMER", "PROFESSIONAL", "PACKAGE"]).optional(),
    included: z.boolean().optional(),
    notes: text(300).optional(),
    consumable: z.boolean().optional(),
  })
  .strict();

const equipmentItemSchema = z
  .object({
    name: text(80),
    specialized: z.boolean().optional(),
    provider: z.enum(["CUSTOMER", "PROFESSIONAL", "PACKAGE"]).optional(),
    notes: text(300).optional(),
  })
  .strict();

export const serviceCatalogConfigSchema = z
  .object({
    bookingMode: z.enum(["STANDARD", "HOURLY"]).optional(),
    bookingModes: z.array(z.enum(BOOKING_MODES)).max(BOOKING_MODES.length).optional(),
    serviceMode: z.enum(SERVICE_MODES).optional(),
    instantBookable: z.boolean().optional(),
    scheduledBookable: z.boolean().optional(),
    recurringBookable: z.boolean().optional(),
    customRequestAvailable: z.boolean().optional(),
    inspectionRequired: z.boolean().optional(),
    comingSoon: z.boolean().optional(),
    /** ISO timestamp. No offset is interpreted as Asia/Kolkata. Set only after a publish approval. */
    scheduledLiveAt: z.string().trim().min(1).max(40).optional(),
    /** Written by the approve action. Editors must not invent this; a later content save drops it. */
    publishApproval: z
      .object({
        actorId: z.string().trim().min(1).max(80),
        editorId: z.string().trim().min(1).max(80),
        approvedAt: z.string().trim().min(1).max(40),
        version: z.number().int().min(1),
        /** sha256 of the approved content (`approvalContentHash`). An approval without it is stale. */
        contentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      })
      .strict()
      .optional(),
    sameDayAvailable: z.boolean().optional(),
    video: mediaUrl.optional(),
    quantity: quantityRuleSchema.optional(),
    variants: z.array(variantSchema).max(30).optional(),
    /** When variants exist, one must be chosen (no silent fallback to the base price). */
    variantRequired: z.boolean().optional(),
    audiences: z.array(z.enum(AUDIENCES)).max(AUDIENCES.length).optional(),
    eligibility: text(300).optional(),
    audienceRules: z.array(text(300)).max(15).optional(),
    propertyTypes: z.array(text(40)).max(15).optional(),
    ageMin: z.number().int().min(0).max(120).optional(),
    ageMax: z.number().int().min(0).max(120).optional(),
    professionalPreferences: z.array(z.enum(PROFESSIONAL_PREFERENCES)).max(3).optional(),
    materialPolicy: z.enum(RESPONSIBILITY_POLICIES).optional(),
    equipmentPolicy: z.enum(RESPONSIBILITY_POLICIES).optional(),
    sparePartsPolicy: z.enum(SPARE_PARTS_POLICIES).optional(),
    /** @deprecated free text (0 live uses) — Phase 06 `requirements` is the typed model. */
    materials: z.array(materialItemSchema).max(40).optional(),
    equipment: z.array(equipmentItemSchema).max(40).optional(),
    /** @deprecated free text (0 live uses) — Phase 06 CUSTOMER_PRECONDITION requirements replace it. */
    preparation: z.array(text(300)).max(15).optional(),
    /** Phase 06 assignments (mirrored in service_requirements). */
    requirements: z.array(requirementAssignmentSchema).max(60).optional(),
    /** Phase 10 §7: the execution plan (mirrored typed in service_execution_steps; versioned with the service). */
    execution: executionPlanSchema.optional(),
    /**
     * Catalogue facts for the assigned items, attached on hydrate from service_requirement_items.
     * Server-populated only: stripped from every admin write (catalogService.validateConfig).
     */
    requirementItems: z.record(requirementCode, requirementItemInfoSchema).optional(),
    safetyNotes: z.array(text(300)).max(15).optional(),
    faqs: z.array(faqSchema).max(20).optional(),
    addons: z.array(addonSchema).max(20).optional(),
    content: z
      .object({
        customerSummary: text(500).optional(),
        valueProposition: text(500).optional(),
        highlights: z.array(text(200)).max(12).optional(),
        keyBenefits: z.array(text(200)).max(12).optional(),
        limitations: z.array(text(300)).max(15).optional(),
        importantNotes: z.array(text(300)).max(15).optional(),
        /** Mandatory statements the customer must see before booking (shown verbatim). */
        customerDisclosures: z.array(text(500)).max(10).optional(),
        process: z.array(text(300)).max(15).optional(),
      })
      .strict()
      .optional(),
    duration: z
      .object({
        estimatedMin: minutes.optional(),
        minMin: minutes.optional(),
        maxMin: minutes.optional(),
        unit: z.enum(["MINUTE", "HOUR"]).optional(),
        preparationMin: z.number().int().min(0).max(60 * 24).optional(),
        serviceMin: minutes.optional(),
        cleanupMin: z.number().int().min(0).max(60 * 24).optional(),
        totalSlotMin: minutes.optional(),
      })
      .strict()
      .optional(),
    coverage: z
      .object({
        cityIds: z.array(text(40)).max(100).optional(),
        zoneIds: z.array(text(40)).max(200).optional(),
        pincodes: z.array(z.string().trim().regex(/^\d{6}$/)).max(500).optional(),
        radiusKm: z.number().finite().min(0).max(200).optional(),
        serviceabilityRequired: z.boolean().optional(),
      })
      .strict()
      .optional(),
    availability: z
      .object({
        instant: z.boolean().optional(),
        scheduled: z.boolean().optional(),
        recurring: z.boolean().optional(),
        sameDay: z.boolean().optional(),
        minimumLeadTimeMinutes: z.number().int().min(0).max(60 * 24 * 14).optional(),
        maximumAdvanceDays: z.number().int().min(1).max(365).optional(),
        slotBufferMinutes: z.number().int().min(0).max(240).optional(),
        /**
         * Wave 4 — the customer-facing slot grid (owner policy 2026-09-23).
         *
         * `operatingWindow` narrows or widens the platform default of 07:00-22:00 for this service.
         * `allDay` is round-the-clock operation and must be set EXPLICITLY: a service is not open at
         * 03:00 because nobody wrote down that it closes.
         */
        operatingWindow: z
          .object({
            start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
            end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
          })
          .strict()
          .optional(),
        allDay: z.boolean().optional(),
        blackoutDates: z.array(z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/)).max(100).optional(),
      })
      .strict()
      .optional(),
    bookingRules: z
      .object({
        minimumBooking: text(200).optional(),
        maximumBooking: text(200).optional(),
        cancellationPolicy: text(1000).optional(),
        reschedulePolicy: text(1000).optional(),
        noShowPolicy: text(1000).optional(),
        lateArrivalPolicy: text(1000).optional(),
        customerAbsentPolicy: text(1000).optional(),
        providerCancelPolicy: text(1000).optional(),
        paymentRequiredBeforeDispatch: z.boolean().optional(),
      })
      .strict()
      .optional(),
    safety: z
      .object({
        information: text(2000).optional(),
        warnings: z.array(text(300)).max(20).optional(),
        prohibitedConditions: z.array(text(300)).max(20).optional(),
        customerRequirements: z.array(text(300)).max(15).optional(),
        providerRequirements: z.array(text(300)).max(15).optional(),
        medicalDisclaimer: text(1000).optional(),
        emergencyProtocol: text(1000).optional(),
        /** Protective equipment the professional wears for the whole job (a step may add its own). */
        ppe: z.array(text(80)).max(15).optional(),
        /** Chemicals or products that must not be used, or only under a stated condition. */
        chemicalRestrictions: z.array(text(300)).max(15).optional(),
        /** What the professional does when something goes wrong on site (shown to the professional). */
        incidentProtocol: text(1000).optional(),
      })
      .strict()
      .optional(),
    quality: z
      .object({
        checklist: z.array(text(200)).max(30).optional(),
        completionCriteria: z.array(text(200)).max(20).optional(),
        proofRequired: z.boolean().optional(),
        beforeAfterPhotos: z.boolean().optional(),
        customerConfirmation: z.boolean().optional(),
        /** The professional must attest the completion criteria were met before the job can complete. */
        professionalConfirmation: z.boolean().optional(),
        warrantyDays: z.number().int().min(0).max(3650).optional(),
        /** @deprecated stored only — the enforced revisit rules are `rework` and the case engine. */
        revisitPolicy: text(500).optional(),
        complaintWindowDays: z.number().int().min(0).max(365).optional(),
        /** Phase 10 §10: hours the customer has to confirm or report an issue after completion (platform default 48). */
        confirmationWindowHours: z.number().int().min(1).max(720).optional(),
        notApplicable: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /**
     * Why a section does not apply to this service. A declaration, not an omission: it is part of
     * the configuration, so it is what the second admin approves and what the version history keeps.
     * Without a real reason here, an absent section is simply absent.
     */
    notApplicableReasons: z
      .object({
        safety: text(500).optional(),
        quality: text(500).optional(),
        materials: text(500).optional(),
        equipment: text(500).optional(),
      })
      .strict()
      .optional(),
    /**
     * Phase 10 §11 — versioned warranty policy, frozen per booking as `warranty.v1`
     * (src/lib/service-warranty.ts). `quality.warrantyDays` stays as the legacy input.
     */
    warranty: z
      .object({
        enabled: z.boolean().optional(),
        durationDays: z.number().int().min(0).max(3650).optional(),
        startEvent: z.enum(["COMPLETION", "CONFIRMATION"]).optional(),
        eligibleIssueTypes: z.array(z.enum(["QUALITY", "INCOMPLETE", "DAMAGE", "BEHAVIOUR", "NO_SHOW", "BILLING", "OTHER"])).max(7).optional(),
        exclusions: z.array(text(300)).max(20).optional(),
        proofRequired: z.boolean().optional(),
        reworkFirst: z.boolean().optional(),
        refundAllowed: z.boolean().optional(),
        /** Customer-facing: how damage caused during the visit is handled. Shown verbatim. */
        damagePolicy: text(1000).optional(),
        /** Customer-facing service guarantee. Shown verbatim; frozen with the booking. */
        guarantee: text(500).optional(),
      })
      .strict()
      .optional(),
    /** Phase 10 §11 — rework policy. The client never chooses a fee; the case decides from this. */
    rework: z
      .object({
        /** WAIVED: provider-fault rework costs the customer nothing. QUOTED: priced as a normal booking. */
        fee: z.enum(["WAIVED", "QUOTED"]).optional(),
        sameProviderPreferred: z.boolean().optional(),
        windowDays: z.number().int().min(0).max(365).optional(),
      })
      .strict()
      .optional(),
    /**
     * Phase 10 — customer policy (age). Backend-evaluated at booking (src/lib/customer-policy.ts).
     * No legal age is assumed: ADULT_ONLY needs an explicit `adultAge`, MINIMUM_AGE an explicit
     * `minimumAge`. Unset = NONE. Distinct from `ageMin`/`ageMax` above, which describe the
     * service recipient (e.g. a kids' class) and are informational.
     */
    customerPolicy: z
      .object({
        age: z
          .object({
            mode: z.enum(["NONE", "MINIMUM_AGE", "ADULT_ONLY", "GUARDIAN_REQUIRED"]),
            minimumAge: z.number().int().min(1).max(120).optional(),
            adultAge: z.number().int().min(1).max(120).optional(),
            guardianMinimumAge: z.number().int().min(1).max(120).optional(),
          })
          .strict()
          .optional(),
        version: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
    providerRequirements: z
      .object({
        requiredSkills: z.array(idText).max(20).optional(),
        /** @deprecated stored only — the enforced level is `skills[].minLevel`. */
        skillLevel: text(40).optional(),
        /** @deprecated display only — the enforced training gate is `trainingModules`. */
        trainingRequired: z.boolean().optional(),
        certifications: z.array(text(80)).max(15).optional(),
        kycRequired: z.boolean().optional(),
        verifiedProfessionalRequired: z.boolean().optional(),
        experienceYears: z.number().int().min(0).max(50).optional(),
        backgroundCheckRequired: z.boolean().optional(),
        /** Academy module slugs a professional must have completed to be matched. */
        trainingModules: z
          .array(z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use an academy module slug (lowercase letters, digits, single hyphens)"))
          .max(20)
          .optional(),
        /** Phase 11 typed requirements (src/lib/provider-capability.ts). Codes: ^[a-z0-9]+(-[a-z0-9]+)*$ */
        skills: z.array(z.object({ code: idText, minLevel: z.enum(["BASIC", "SKILLED", "EXPERT"]).optional(), verifiedOnly: z.boolean().optional() }).strict()).max(20).optional(),
        requiredCertifications: z.array(z.object({ type: idText, verificationRequired: z.boolean().optional() }).strict()).max(15).optional(),
        requiredEquipment: z.array(z.object({ type: idText, requirement: z.enum(["REQUIRED", "OPTIONAL", "NOT_REQUIRED", "CUSTOMER_PROVIDED"]) }).strict()).max(30).optional(),
        requiredInsurance: z.array(z.object({ type: idText }).strict()).max(10).optional(),
        languages: z.array(z.object({ code: z.string().regex(/^[a-z]{2}$/), minProficiency: z.enum(["BASIC", "CONVERSATIONAL", "FLUENT", "NATIVE"]).optional() }).strict()).max(10).optional(),
      })
      .strict()
      .optional(),
    matching: z
      .object({
        /** @deprecated stored only — there is one matcher. */
        strategy: text(40).optional(),
        /** @deprecated stored only — skill is a hard gate (`providerRequirements.skills`), not a ranking signal. */
        skillWeight: z.number().min(0).max(1).optional(),
        distanceWeight: z.number().min(0).max(1).optional(),
        ratingWeight: z.number().min(0).max(1).optional(),
        availabilityWeight: z.number().min(0).max(1).optional(),
        responseWeight: z.number().min(0).max(1).optional(),
        completionWeight: z.number().min(0).max(1).optional(),
        preferredProvider: z.boolean().optional(),
      })
      .strict()
      .optional(),
    payment: z
      .object({
        paymentRequired: z.boolean().optional(),
        paymentTiming: z.enum(["BEFORE_DISPATCH", "AFTER_COMPLETION", "SPLIT"]).optional(),
        walletAllowed: z.boolean().optional(),
        couponAllowed: z.boolean().optional(),
        membershipAllowed: z.boolean().optional(),
        splitPaymentAllowed: z.boolean().optional(),
        invoiceRequired: z.boolean().optional(),
        refundPolicy: text(1000).optional(),
      })
      .strict()
      .optional(),
    trust: z
      .object({
        verifiedProfessionalRequired: z.boolean().optional(),
        backgroundCheckRequired: z.boolean().optional(),
        insuranceSupported: z.boolean().optional(),
        /** @deprecated internal note, never shown — the customer-facing text is `warranty.guarantee`. */
        guarantee: text(300).optional(),
        supportPolicy: text(500).optional(),
        badges: z.array(text(40)).max(10).optional(),
      })
      .strict()
      .optional(),
    seo: z
      .object({
        noindex: z.boolean().optional(),
        canonicalUrl: z.string().trim().url().max(500).optional(),
      })
      .strict()
      .optional(),
    media: z
      .object({
        heroImage: mediaUrl.optional(),
        heroVideo: mediaUrl.optional(),
        gallery: z.array(mediaUrl).max(20).optional(),
        instructional: z.array(mediaUrl).max(10).optional(),
        beforeAfter: z
          .array(z.object({ before: mediaUrl, after: mediaUrl, caption: text(120).optional() }).strict())
          .max(10)
          .optional(),
        documents: z.array(z.object({ label: text(80), url: mediaUrl }).strict()).max(10).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const d = cfg.duration;
    if (d) {
      if (d.minMin != null && d.maxMin != null && d.minMin > d.maxMin) {
        ctx.addIssue({ code: "custom", path: ["duration", "maxMin"], message: "DURATION_RANGE_INVALID: minMin must be ≤ maxMin" });
      }
      if (d.estimatedMin != null && d.minMin != null && d.estimatedMin < d.minMin) {
        ctx.addIssue({ code: "custom", path: ["duration", "estimatedMin"], message: "DURATION_RANGE_INVALID: estimatedMin must be ≥ minMin" });
      }
      if (d.estimatedMin != null && d.maxMin != null && d.estimatedMin > d.maxMin) {
        ctx.addIssue({ code: "custom", path: ["duration", "estimatedMin"], message: "DURATION_RANGE_INVALID: estimatedMin must be ≤ maxMin" });
      }
      // total appointment = preparation + service + cleanup. totalSlotMin is a declared total that
      // must agree with its parts, never a silent override of them.
      if (d.totalSlotMin != null) {
        const parts = (d.preparationMin ?? 0) + (d.cleanupMin ?? 0);
        if (d.serviceMin != null && parts + d.serviceMin !== d.totalSlotMin) {
          ctx.addIssue({
            code: "custom",
            path: ["duration", "totalSlotMin"],
            message: `DURATION_INCONSISTENT: preparation + service + cleanup = ${parts + d.serviceMin}, not ${d.totalSlotMin}`,
          });
        }
        if (d.serviceMin == null && d.totalSlotMin - parts < 1) {
          ctx.addIssue({
            code: "custom",
            path: ["duration", "totalSlotMin"],
            message: "DURATION_INCONSISTENT: totalSlotMin leaves no service time after preparation and cleanup",
          });
        }
      }
    }
    const addonIds = new Set((cfg.addons ?? []).map((a) => a.id));
    const requires = new Map<string, string[]>();
    for (const a of cfg.addons ?? []) {
      for (const [list, label] of [
        [a.requiresAddonIds, "requires"],
        [a.conflictsWithAddonIds, "conflicts with"],
      ] as const) {
        for (const other of list ?? []) {
          if (other === a.id) ctx.addIssue({ code: "custom", path: ["addons"], message: `add-on "${a.id}" ${label} itself` });
          else if (!addonIds.has(other)) {
            ctx.addIssue({ code: "custom", path: ["addons"], message: `add-on "${a.id}" ${label} unknown add-on "${other}"` });
          }
        }
      }
      if (a.maxQuantity != null && a.maxQuantity > 1 && a.quantityAllowed === false) {
        ctx.addIssue({ code: "custom", path: ["addons"], message: `add-on "${a.id}" has maxQuantity but quantityAllowed is false` });
      }
      requires.set(a.id, a.requiresAddonIds ?? []);
    }
    // Everything an add-on pulls in (transitively) must not conflict with it or with each other,
    // and a requirement chain must not loop back on itself.
    const closure = (start: string): { set: Set<string>; cycle: boolean } => {
      const seen = new Set<string>();
      let cycle = false;
      const walk = (id: string, path: Set<string>) => {
        for (const next of requires.get(id) ?? []) {
          if (path.has(next)) {
            cycle = true;
            continue;
          }
          if (seen.has(next)) continue;
          seen.add(next);
          walk(next, new Set([...path, next]));
        }
      };
      walk(start, new Set([start]));
      return { set: seen, cycle };
    };
    const conflicts = (x: string, y: string) => {
      const ax = cfg.addons?.find((a) => a.id === x);
      const ay = cfg.addons?.find((a) => a.id === y);
      return Boolean(ax?.conflictsWithAddonIds?.includes(y) || ay?.conflictsWithAddonIds?.includes(x));
    };
    for (const a of cfg.addons ?? []) {
      const { set, cycle } = closure(a.id);
      if (cycle) ctx.addIssue({ code: "custom", path: ["addons"], message: `add-on "${a.id}" has a circular requirement` });
      const group = [a.id, ...set];
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          if (conflicts(group[i]!, group[j]!)) {
            ctx.addIssue({
              code: "custom",
              path: ["addons"],
              message: `add-on "${a.id}" requires "${group[i] === a.id ? group[j] : group[i]}" which conflicts with "${group[i] === a.id ? a.id : group[j]}"`,
            });
          }
        }
      }
    }
    if (cfg.variantRequired && !(cfg.variants ?? []).some((v) => v.active !== false)) {
      ctx.addIssue({ code: "custom", path: ["variantRequired"], message: "variantRequired needs at least one active variant" });
    }
    const dup = (ids: string[], path: string) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) ctx.addIssue({ code: "custom", path: [path], message: `duplicate id "${id}"` });
        seen.add(id);
      }
    };
    dup((cfg.variants ?? []).map((v) => v.id), "variants");
    dup((cfg.addons ?? []).map((a) => a.id), "addons");
    if ((cfg.bookingMode === "HOURLY" || cfg.bookingModes?.includes("HOURLY")) && cfg.quantity?.type !== "HOUR") {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "HOURLY booking mode needs an HOUR quantity rule" });
    }
    if (cfg.ageMin != null && cfg.ageMax != null && cfg.ageMax < cfg.ageMin) {
      ctx.addIssue({ code: "custom", path: ["ageMax"], message: "ageMax must be ≥ ageMin" });
    }
    const age = cfg.customerPolicy?.age;
    if (age?.mode === "MINIMUM_AGE" && age.minimumAge == null) {
      ctx.addIssue({ code: "custom", path: ["customerPolicy", "age", "minimumAge"], message: "MINIMUM_AGE needs an explicit minimumAge — no legal age is assumed" });
    }
    if (age?.mode === "ADULT_ONLY" && age.adultAge == null) {
      ctx.addIssue({ code: "custom", path: ["customerPolicy", "age", "adultAge"], message: "ADULT_ONLY needs an explicit adultAge — no legal age is assumed" });
    }
    if (age?.mode === "GUARDIAN_REQUIRED" && age.guardianMinimumAge == null) {
      ctx.addIssue({ code: "custom", path: ["customerPolicy", "age", "guardianMinimumAge"], message: "GUARDIAN_REQUIRED needs an explicit guardianMinimumAge" });
    }
    if (cfg.warranty?.enabled && !(cfg.warranty.durationDays && cfg.warranty.durationDays > 0)) {
      ctx.addIssue({ code: "custom", path: ["warranty", "durationDays"], message: "an enabled warranty needs a positive durationDays" });
    }
    const variantIds = new Set((cfg.variants ?? []).map((v) => v.id));
    for (const v of cfg.variants ?? []) {
      if (v.audiences && cfg.audiences && v.audiences.some((a) => !cfg.audiences!.includes(a))) {
        ctx.addIssue({ code: "custom", path: ["variants"], message: `variant "${v.id}" allows an audience the service does not` });
      }
    }
    for (const a of cfg.addons ?? []) {
      for (const vid of a.compatibleVariantIds ?? []) {
        if (!variantIds.has(vid)) {
          ctx.addIssue({ code: "custom", path: ["addons"], message: `add-on "${a.id}" references unknown variant "${vid}"` });
        }
      }
    }
  });

export type ServiceCatalogConfig = z.infer<typeof serviceCatalogConfigSchema>;
export type ServiceVariant = z.infer<typeof variantSchema>;
export type ServiceAddon = z.infer<typeof addonSchema>;

/** Stored JSON → config. Invalid stored data is treated as "no config", never trusted. */
export function parseCatalogConfig(raw: unknown): ServiceCatalogConfig | null {
  if (raw == null) return null;
  const r = serviceCatalogConfigSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Queryable catalogue rows. `code` is the id customers send (`variantId` / addon id). */
export type RelationalVariant = {
  code: string;
  name: string;
  description?: string | null;
  price: number;
  durationMin?: number | null;
  audiences?: string[] | null;
  inclusions?: string[] | null;
  exclusions?: string[] | null;
  requirements?: string[] | null;
  quantityOverride?: unknown;
  sortOrder?: number | null;
  isActive: boolean;
};

export type RelationalAddon = {
  code: string;
  name: string;
  description?: string | null;
  price: number;
  durationMin?: number | null;
  quantityAllowed?: boolean | null;
  maxQuantity?: number | null;
  compatibleVariantCodes?: string[] | null;
  requiresAddonCodes?: string[] | null;
  conflictsWithAddonCodes?: string[] | null;
  sortOrder?: number | null;
  isActive: boolean;
};

function mapRelationalVariant(row: RelationalVariant): ServiceVariant | null {
  const parsed = variantSchema.safeParse({
    id: row.code,
    name: row.name,
    price: row.price,
    durationMin: row.durationMin ?? undefined,
    description: row.description || undefined,
    inclusions: row.inclusions?.length ? row.inclusions : undefined,
    exclusions: row.exclusions?.length ? row.exclusions : undefined,
    requirements: row.requirements?.length ? row.requirements : undefined,
    sortOrder: row.sortOrder ?? undefined,
    audiences: row.audiences?.length ? row.audiences : undefined,
    quantity: row.quantityOverride ?? undefined,
    active: row.isActive,
  });
  return parsed.success ? parsed.data : null;
}

function mapRelationalAddon(row: RelationalAddon): ServiceAddon | null {
  const parsed = addonSchema.safeParse({
    id: row.code,
    name: row.name,
    price: row.price,
    durationMin: row.durationMin ?? undefined,
    description: row.description || undefined,
    quantityAllowed: row.quantityAllowed ?? undefined,
    maxQuantity: row.maxQuantity ?? undefined,
    compatibleVariantIds: row.compatibleVariantCodes?.length ? row.compatibleVariantCodes : undefined,
    requiresAddonIds: row.requiresAddonCodes?.length ? row.requiresAddonCodes : undefined,
    conflictsWithAddonIds: row.conflictsWithAddonCodes?.length ? row.conflictsWithAddonCodes : undefined,
    sortOrder: row.sortOrder ?? undefined,
    active: row.isActive,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Relational variant/add-on rows override JSON when present. Empty tables fall back to
 * `catalog_config` so quote still works before migrate and for SKUs with no options.
 * Result is re-validated; invalid rows are dropped, never invented.
 */
export function hydrateCatalogConfig(
  raw: unknown,
  rel?: {
    variants?: RelationalVariant[];
    addons?: RelationalAddon[];
    /** Phase 06: assignment rows (mapped) and the catalogue facts of every item they reference. */
    requirements?: unknown[];
    requirementItems?: Record<string, unknown>;
  },
): ServiceCatalogConfig | null {
  const json = parseCatalogConfig(raw);
  const relVariants = (rel?.variants ?? []).map(mapRelationalVariant).filter((v): v is ServiceVariant => v != null);
  const relAddons = (rel?.addons ?? []).map(mapRelationalAddon).filter((a): a is ServiceAddon => a != null);
  const relRequirements = rel?.requirements ?? [];
  const hasItems = rel?.requirementItems !== undefined;
  if (relVariants.length === 0 && relAddons.length === 0 && relRequirements.length === 0 && !hasItems) return json;
  const merged = {
    ...(json ?? {}),
    ...(relVariants.length ? { variants: relVariants } : {}),
    ...(relAddons.length ? { addons: relAddons } : {}),
    // Rows win over the JSON copy, as for variants/add-ons: a failed sync can never leave a stale authority.
    ...(relRequirements.length ? { requirements: relRequirements } : {}),
    ...(hasItems ? { requirementItems: rel!.requirementItems } : {}),
  };
  return parseCatalogConfig(merged) ?? json;
}

/** Empty city/pincode lists mean unspecified (nationwide / not configured) — not "nowhere". */
export function coverageAllowsAddress(
  service: { availableCities?: string[] | null },
  cfg: ServiceCatalogConfig | null,
  address: { city: string; zipCode?: string | null },
): { ok: true } | { ok: false; error: string } {
  const cities = [...(service.availableCities ?? []), ...(cfg?.coverage?.cityIds ?? [])]
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (cities.length > 0 && !cities.includes(address.city.trim().toLowerCase())) {
    return { ok: false, error: "Service is not available in this city" };
  }
  const pins = cfg?.coverage?.pincodes ?? [];
  const zip = (address.zipCode ?? "").trim();
  if (pins.length > 0 && !pins.includes(zip)) {
    return { ok: false, error: "Service is not available at this pincode" };
  }
  return { ok: true };
}

/**
 * What customers may see. Inactive options, matching weights and partner-only blocks are removed.
 * The customer visit promise (safety warnings, proof, warranty, age) is a separate projection
 * (`customerVisitPromise`) — these blocks stay off the catalogue payload so a client cannot
 * read the partner SOP, the checklist, or a guarantee the runtime does not enforce.
 */
export function publicCatalogConfig(cfg: ServiceCatalogConfig | null): ServiceCatalogConfig | null {
  if (!cfg) return null;
  const {
    matching: _matching,
    requirements: _requirements,
    requirementItems: _items,
    execution: _execution,
    safety: _safety,
    quality: _quality,
    warranty: _warranty,
    rework: _rework,
    trust: _trust,
    customerPolicy: _customerPolicy,
    ...rest
  } = cfg;
  return {
    ...rest,
    variants: cfg.variants?.filter((v) => v.active).map((v) => ({ ...v, professionalPreferences: undefined })),
    addons: cfg.addons?.filter((a) => a.active),
    professionalPreferences: PROFESSIONAL_PREFERENCE_SUPPORTED ? cfg.professionalPreferences : undefined,
    providerRequirements: cfg.providerRequirements
      ? { verifiedProfessionalRequired: cfg.providerRequirements.verifiedProfessionalRequired }
      : undefined,
    matching: undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Configuration gaps (admin / development visibility)                 */
/* ------------------------------------------------------------------ */

type ServiceCore = {
  basePrice: number;
  minPrice: number | null;
  maxPrice: number | null;
  estimatedDuration: number;
  pricingModel: string;
};

/** Human-readable reasons a service's configuration is incomplete. Empty = complete. */
export function catalogConfigGaps(service: ServiceCore, cfg: ServiceCatalogConfig | null): string[] {
  const gaps: string[] = [];
  const model = service.pricingModel;
  if (!(service.basePrice > 0)) gaps.push("Base price is not set");
  if (["hourly", "per-unit", "per-seat", "area"].includes(model) && !cfg?.quantity) {
    gaps.push(`Pricing model "${model}" has no quantity rule, so customers cannot choose a quantity`);
  }
  if (model === "hourly" && cfg?.quantity && cfg.quantity.type !== "HOUR") {
    gaps.push('Pricing model "hourly" needs an HOUR quantity rule');
  }
  if (cfg?.audiences?.length && !cfg.variants?.length) {
    gaps.push("Audiences are set but there are no variants to price them");
  }
  // NOT_SPECIFIED is the absence of a decision, stored (the publish gate reads it the same way).
  if (!cfg?.materialPolicy || cfg.materialPolicy === "NOT_SPECIFIED") gaps.push("Materials policy not specified");
  if (!cfg?.equipmentPolicy || cfg.equipmentPolicy === "NOT_SPECIFIED") gaps.push("Equipment policy not specified");
  if (cfg?.professionalPreferences?.some((p) => p !== "NO_PREFERENCE") && !PROFESSIONAL_PREFERENCE_SUPPORTED) {
    gaps.push("Professional preference is configured but assignment cannot honour it yet — hidden from customers");
  }
  return gaps;
}

/* ------------------------------------------------------------------ */
/* Legacy pricing (kept byte-compatible with existing clients)         */
/* ------------------------------------------------------------------ */

export function resolvePackagePrice(
  service: { basePrice: number; minPrice: number | null; maxPrice: number | null },
  requested?: number,
): { ok: true; price: number } | { ok: false; error: "INVALID_PACKAGE_PRICE" } {
  const min = service.minPrice ?? service.basePrice;
  const max = service.maxPrice ?? Math.max(service.basePrice, min);
  const tiers = [...new Set([min, service.basePrice, max])].sort((a, b) => a - b);
  if (requested == null || requested === service.basePrice) return { ok: true, price: service.basePrice };
  // Exact tiers only. "Anywhere between min and max" let a client pay any price it liked inside the
  // range (₹650 for a ₹499/₹799/₹999 service) and left no way to say which package was bought.
  const match = tiers.find((t) => t === requested);
  if (match != null) return { ok: true, price: match };
  return { ok: false, error: "INVALID_PACKAGE_PRICE" };
}

/* ------------------------------------------------------------------ */
/* Selection → server price                                            */
/* ------------------------------------------------------------------ */

export type SelectionInput = {
  variantId?: string;
  quantity?: number;
  packagePrice?: number;
  audience?: string;
  professionalPreference?: string;
  addonIds?: string[];
  /** Units per selected add-on id. Omitted ids mean one unit. Only add-ons with maxQuantity > 1 accept more. */
  addonQuantities?: Record<string, number>;
};

/** Legacy error families. Existing API consumers switch on these; they are never renamed. */
export type SelectionError =
  | "INVALID_PACKAGE_PRICE"
  | "INVALID_VARIANT"
  | "INVALID_QUANTITY"
  | "INVALID_ADDON"
  | "INVALID_AUDIENCE"
  | "INVALID_PREFERENCE"
  | "INVALID_SELECTION"
  /** The service (or chosen option) has no usable price configured — never invented. */
  | "PRICING_CONFIG_MISSING";

/** Specific reasons. Every reason belongs to exactly one legacy family (see ISSUE_FAMILY). */
export type SelectionIssueCode =
  | SelectionError
  | "VARIANT_REQUIRED"
  | "VARIANT_UNAVAILABLE"
  | "QUANTITY_REQUIRED"
  | "QUANTITY_NOT_INTEGER"
  | "QUANTITY_BELOW_MIN"
  | "QUANTITY_ABOVE_MAX"
  | "QUANTITY_STEP"
  | "QUANTITY_NOT_ALLOWED"
  | "ADDON_UNKNOWN"
  | "ADDON_DUPLICATE"
  | "ADDON_INCOMPATIBLE"
  | "ADDON_CONFLICT"
  | "ADDON_REQUIRES"
  | "ADDON_QUANTITY";

export type SelectionIssue = {
  code: SelectionIssueCode;
  field: "variantId" | "quantity" | "addonIds" | "addonQuantities" | "audience" | "professionalPreference" | "packagePrice" | "selection";
  /** The offending id (variant / add-on), when there is one. */
  id?: string;
  message: string;
};

const ISSUE_FAMILY: Record<SelectionIssueCode, SelectionError> = {
  INVALID_PACKAGE_PRICE: "INVALID_PACKAGE_PRICE",
  INVALID_VARIANT: "INVALID_VARIANT",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  INVALID_ADDON: "INVALID_ADDON",
  INVALID_AUDIENCE: "INVALID_AUDIENCE",
  INVALID_PREFERENCE: "INVALID_PREFERENCE",
  INVALID_SELECTION: "INVALID_SELECTION",
  PRICING_CONFIG_MISSING: "PRICING_CONFIG_MISSING",
  VARIANT_REQUIRED: "INVALID_VARIANT",
  VARIANT_UNAVAILABLE: "INVALID_VARIANT",
  QUANTITY_REQUIRED: "INVALID_QUANTITY",
  QUANTITY_NOT_INTEGER: "INVALID_QUANTITY",
  QUANTITY_BELOW_MIN: "INVALID_QUANTITY",
  QUANTITY_ABOVE_MAX: "INVALID_QUANTITY",
  QUANTITY_STEP: "INVALID_QUANTITY",
  QUANTITY_NOT_ALLOWED: "INVALID_QUANTITY",
  ADDON_UNKNOWN: "INVALID_ADDON",
  ADDON_DUPLICATE: "INVALID_ADDON",
  ADDON_INCOMPATIBLE: "INVALID_ADDON",
  ADDON_CONFLICT: "INVALID_ADDON",
  ADDON_REQUIRES: "INVALID_ADDON",
  ADDON_QUANTITY: "INVALID_ADDON",
};

export function selectionIssueFamily(code: SelectionIssueCode): SelectionError {
  return ISSUE_FAMILY[code];
}

/* ------------------------------------------------------------------ */
/* Duration — the one calculator                                       */
/* ------------------------------------------------------------------ */

/**
 * Minutes for one resolved selection.
 *
 *   serviceMinutes      — execution time for the chosen variant × quantity
 *   addonMinutes        — add-on execution time × add-on units
 *   preparationMinutes  — once per booking
 *   cleanupMinutes      — once per booking
 *   totalMinutes        — preparation + service + add-ons + cleanup  (= booking.estimatedDuration)
 *   customerEstimate    — the customer-facing estimate of the service time, scaled the same way
 *
 * Travel time is NOT computed here: nothing in the platform models travel per service, and the
 * partner calendar reserves a fixed slot ([start − 30 min, start + 30 min), trigger
 * bookings_sync_conflict_slots) that is deliberately independent of this duration until the owner
 * decides otherwise (docs/business-decision-scheduling.md, D1).
 */
export type ResolvedDuration = {
  serviceMinutes: number;
  addonMinutes: number;
  preparationMinutes: number;
  cleanupMinutes: number;
  totalMinutes: number;
  customerEstimate: { estimatedMinutes: number; minMinutes: number | null; maxMinutes: number | null };
};

type DurationRule = Pick<QuantityRule, "type" | "durationPerUnitMin"> | null;
type QuantityRule = z.infer<typeof quantityRuleSchema>;

function scaleByQuantity(unitMinutes: number, rule: DurationRule, quantity: number): number {
  if (!rule) return unitMinutes;
  if (rule.type === "HOUR") return unitMinutes * quantity;
  if (rule.durationPerUnitMin) return unitMinutes + rule.durationPerUnitMin * (quantity - 1);
  return unitMinutes;
}

export function resolveServiceDuration(
  service: { estimatedDuration: number },
  cfg: ServiceCatalogConfig | null,
  selection: {
    variant?: { durationMin?: number | null } | null;
    quantity?: number;
    addons?: { durationMin?: number | null; quantity?: number }[];
  } = {},
): ResolvedDuration {
  const d = cfg?.duration;
  const prep = d?.preparationMin ?? 0;
  const cleanup = d?.cleanupMin ?? 0;
  const unitService =
    selection.variant?.durationMin ??
    d?.serviceMin ??
    (d?.totalSlotMin != null ? d.totalSlotMin - prep - cleanup : undefined) ??
    service.estimatedDuration;
  const rule = cfg?.quantity && cfg.quantity.type !== "NONE" ? cfg.quantity : null;
  const q = rule ? (selection.quantity ?? rule.default ?? rule.min) : 1;
  const serviceMinutes = scaleByQuantity(unitService, rule, q);
  const addonMinutes = (selection.addons ?? []).reduce((s, a) => s + (a.durationMin ?? 0) * (a.quantity ?? 1), 0);
  const est = selection.variant?.durationMin ?? d?.estimatedMin ?? unitService;
  return {
    serviceMinutes,
    addonMinutes,
    preparationMinutes: prep,
    cleanupMinutes: cleanup,
    totalMinutes: prep + serviceMinutes + addonMinutes + cleanup,
    customerEstimate: {
      estimatedMinutes: scaleByQuantity(est, rule, q),
      minMinutes: d?.minMin != null && !selection.variant?.durationMin ? scaleByQuantity(d.minMin, rule, q) : null,
      maxMinutes: d?.maxMin != null && !selection.variant?.durationMin ? scaleByQuantity(d.maxMin, rule, q) : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Selection → server price                                            */
/* ------------------------------------------------------------------ */

/** `price` / `unitPrice` are rupees for the legacy contract; the *Paise fields are the exact values. */
export type SelectedAddon = {
  id: string;
  name: string;
  price: number;
  unitPrice: number;
  quantity: number;
  pricePaise: number;
  unitPaise: number;
};

export type ServiceSelectionSnapshot = {
  variant: { id: string; name: string; price: number } | null;
  quantity: number;
  quantityType: QuantityType | null;
  unitLabel: string | null;
  unitPrice: number | null;
  audience: Audience | null;
  professionalPreference: ProfessionalPreference | null;
  durationMinutes: number;
  /** Breakdown behind durationMinutes (added 2026-09-21; absent on older snapshots). */
  duration?: ResolvedDuration;
  /** Add-on units, when any add-on was taken more than once (price in bookings.addons is the line total). */
  addonQuantities?: Record<string, number>;
};

export type NormalizedSelection = {
  variantId: string | null;
  audience: Audience | null;
  professionalPreference: ProfessionalPreference | null;
  quantity: number;
  /** Add-on ids in catalogue order, de-duplicated only after a duplicate was reported. */
  addonIds: string[];
  addonQuantities: Record<string, number>;
  packagePrice: number | null;
};

export type ResolvedSelection = {
  ok: true;
  /** Service line after variant × quantity, before add-ons. */
  servicePrice: number;
  servicePricePaise: number;
  addons: SelectedAddon[];
  addonTotal: number;
  addonTotalPaise: number;
  snapshot: ServiceSelectionSnapshot;
};

export type AddonAvailability = { id: string; available: boolean; reason: SelectionIssueCode | null };

export type ServiceSelectionResolution =
  | (ResolvedSelection & { issues: []; normalized: NormalizedSelection; duration: ResolvedDuration; addonAvailability: AddonAvailability[] })
  | { ok: false; error: SelectionError; issues: SelectionIssue[]; normalized: NormalizedSelection; addonAvailability: AddonAvailability[] };

/** A stored price as paise, or null when it is not a valid money amount (never coerced). */
function safePaise(v: number | null | undefined): number | null {
  if (v == null) return null;
  try {
    return toPaise(v);
  } catch (e) {
    if (e instanceof MoneyError) return null;
    throw e;
  }
}

type AddonCatalogueItem = {
  id: string;
  name: string;
  price: number;
  durationMin?: number;
  maxQuantity?: number;
  quantityAllowed?: boolean;
  compatibleVariantIds?: string[];
  requiresAddonIds?: string[];
  conflictsWithAddonIds?: string[];
  sortOrder?: number;
};

/** The add-ons a service offers. A service with no add-ons offers none. */
export function effectiveAddonCatalogue(cfg: ServiceCatalogConfig | null): AddonCatalogueItem[] {
  return (cfg?.addons ?? []).filter((a) => a.active);
}

/**
 * THE service selection resolver. Pure and DB-free: quote, booking, the public resolve endpoint and
 * the admin preview all call this — there is no second implementation anywhere (clients render its
 * output). It reports every problem it finds instead of the first, so a customer can be told all
 * the reasons a selection cannot be booked, and it never silently drops or changes a choice.
 */
export function resolveServiceSelection(
  service: ServiceCore,
  cfg: ServiceCatalogConfig | null,
  input: SelectionInput,
): ServiceSelectionResolution {
  const issues: SelectionIssue[] = [];
  const add = (code: SelectionIssueCode, field: SelectionIssue["field"], message: string, id?: string) =>
    issues.push({ code, field, message, ...(id ? { id } : {}) });

  const activeVariants = (cfg?.variants ?? []).filter((v) => v.active);

  // Variant
  let variant: ServiceVariant | null = null;
  if (input.variantId != null) {
    variant = activeVariants.find((v) => v.id === input.variantId) ?? null;
    if (!variant) {
      const inactive = (cfg?.variants ?? []).some((v) => v.id === input.variantId);
      add(inactive ? "VARIANT_UNAVAILABLE" : "INVALID_VARIANT", "variantId", inactive ? "This option is no longer available" : "Unknown option", input.variantId);
    }
    if (input.packagePrice != null) add("INVALID_SELECTION", "packagePrice", "A package price cannot be combined with an option");
  } else if (cfg?.variantRequired && activeVariants.length > 0) {
    add("VARIANT_REQUIRED", "variantId", "Choose an option to continue");
  }

  // Audience — only for services configured with audiences
  let audience: Audience | null = null;
  if (input.audience != null) {
    const allowed = variant?.audiences ?? cfg?.audiences;
    if (!allowed?.includes(input.audience as Audience)) {
      add("INVALID_AUDIENCE", "audience", variant ? "This option is not available for the selected person" : "This service is not available for the selected person");
    } else audience = input.audience as Audience;
  } else if (variant?.audiences?.length && cfg?.audiences?.length) {
    // A variant restricted to some audiences must be booked for one of them.
    add("INVALID_AUDIENCE", "audience", "Choose who this option is for");
  }

  // Professional preference — only what assignment can honour
  let preference: ProfessionalPreference | null = null;
  if (input.professionalPreference != null) {
    const offered = PROFESSIONAL_PREFERENCE_SUPPORTED
      ? (variant?.professionalPreferences ?? cfg?.professionalPreferences ?? [])
      : [];
    if (input.professionalPreference !== "NO_PREFERENCE" && !offered.includes(input.professionalPreference as ProfessionalPreference)) {
      add("INVALID_PREFERENCE", "professionalPreference", "That professional preference is not available");
    } else preference = input.professionalPreference as ProfessionalPreference;
  }

  // Quantity + service line
  const rule = cfg?.quantity && cfg.quantity.type !== "NONE" ? cfg.quantity : null;
  let quantity = 1;
  let unitPrice: number | null = null;
  let servicePrice = 0;
  let servicePricePaise = 0;

  if (rule) {
    if (input.packagePrice != null && input.variantId == null) add("INVALID_SELECTION", "packagePrice", "This service is priced by quantity, not by package");
    const min = variant?.quantity?.min ?? rule.min;
    const max = variant?.quantity?.max ?? rule.max;
    if (input.quantity == null && rule.required) {
      add("QUANTITY_REQUIRED", "quantity", `Choose how many ${rule.unitLabelPlural ?? rule.unitLabel}`);
    }
    quantity = input.quantity ?? rule.default ?? min;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || !Number.isInteger(quantity)) {
      add("QUANTITY_NOT_INTEGER", "quantity", "Quantity must be a whole number");
      quantity = min;
    } else if (quantity < min) add("QUANTITY_BELOW_MIN", "quantity", `Minimum is ${min} ${rule.unitLabelPlural ?? rule.unitLabel}`);
    else if (quantity > max) add("QUANTITY_ABOVE_MAX", "quantity", `Maximum is ${max} ${rule.unitLabelPlural ?? rule.unitLabel}`);
    else if ((quantity - min) % rule.step !== 0) add("QUANTITY_STEP", "quantity", `Choose a quantity in steps of ${rule.step}`);
    unitPrice = variant?.quantity?.unitPrice ?? variant?.price ?? rule.unitPrice ?? service.basePrice;
    const unitPaise = safePaise(unitPrice);
    if (unitPaise == null || unitPaise <= 0) add("PRICING_CONFIG_MISSING", "selection", "Pricing unavailable for this configuration");
    else {
      const minPaise = safePaise(rule.minimumCharge ?? 0) ?? 0;
      servicePricePaise = Math.max(unitPaise * quantity, minPaise);
      servicePrice = toRupees(servicePricePaise);
    }
  } else {
    if (input.quantity != null && input.quantity !== 1) add("QUANTITY_NOT_ALLOWED", "quantity", "This service is not sold by quantity");
    if (variant) {
      servicePricePaise = safePaise(variant.price) ?? 0;
    } else if (!(input.variantId != null)) {
      const pkg = resolvePackagePrice(service, input.packagePrice);
      if (!pkg.ok) add("INVALID_PACKAGE_PRICE", "packagePrice", "That package is not available");
      else servicePricePaise = safePaise(pkg.price) ?? 0;
    }
    servicePrice = toRupees(servicePricePaise);
  }
  if (issues.length === 0 && !(servicePricePaise > 0)) {
    add("PRICING_CONFIG_MISSING", "selection", "Pricing unavailable for this configuration");
  }

  // Add-ons — compatibility, duplicates, dependencies and units, all server-side.
  const catalogue = effectiveAddonCatalogue(cfg);
  const requested = input.addonIds ?? [];
  const seen = new Set<string>();
  const picked: AddonCatalogueItem[] = [];
  for (const id of requested) {
    if (seen.has(id)) {
      add("ADDON_DUPLICATE", "addonIds", "An add-on was selected twice", id);
      continue;
    }
    seen.add(id);
    const a = catalogue.find((x) => x.id === id);
    if (!a) {
      add("ADDON_UNKNOWN", "addonIds", "This add-on is not available for this service", id);
      continue;
    }
    if (a.compatibleVariantIds?.length && (!variant || !a.compatibleVariantIds.includes(variant.id))) {
      add("ADDON_INCOMPATIBLE", "addonIds", variant ? `${a.name} is not available with ${variant.name}` : `${a.name} needs a specific option`, id);
      continue;
    }
    picked.push(a);
  }
  const pickedIds = new Set(picked.map((a) => a.id));
  for (const a of picked) {
    for (const other of a.conflictsWithAddonIds ?? []) {
      if (pickedIds.has(other) && a.id < other) {
        add("ADDON_CONFLICT", "addonIds", `${a.name} cannot be combined with ${catalogue.find((x) => x.id === other)?.name ?? other}`, a.id);
      }
    }
    for (const b of picked) {
      if (b.id !== a.id && b.conflictsWithAddonIds?.includes(a.id) && !a.conflictsWithAddonIds?.includes(b.id) && a.id < b.id) {
        add("ADDON_CONFLICT", "addonIds", `${a.name} cannot be combined with ${b.name}`, a.id);
      }
    }
    for (const need of a.requiresAddonIds ?? []) {
      if (!pickedIds.has(need)) {
        add("ADDON_REQUIRES", "addonIds", `${a.name} requires ${catalogue.find((x) => x.id === need)?.name ?? need}`, a.id);
      }
    }
  }
  const addonQuantities: Record<string, number> = {};
  for (const [id, raw] of Object.entries(input.addonQuantities ?? {})) {
    if (!pickedIds.has(id)) {
      if (!seen.has(id)) add("ADDON_QUANTITY", "addonQuantities", "A quantity was sent for an add-on that is not selected", id);
      continue;
    }
    const a = picked.find((x) => x.id === id)!;
    const cap = a.quantityAllowed === false ? 1 : (a.maxQuantity ?? 1);
    if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 1) {
      add("ADDON_QUANTITY", "addonQuantities", `${a.name}: quantity must be a whole number of at least 1`, id);
    } else if (raw > cap) {
      add("ADDON_QUANTITY", "addonQuantities", cap === 1 ? `${a.name} can only be added once` : `${a.name}: at most ${cap}`, id);
    } else if (raw > 1) addonQuantities[id] = raw;
  }

  // Availability of every offered add-on for the CURRENT selection, so a client can render
  // "unavailable / incompatible / needs X" from server truth instead of re-deriving the rules.
  const addonAvailability: AddonAvailability[] = catalogue.map((a) => {
    if (a.compatibleVariantIds?.length && (!variant || !a.compatibleVariantIds.includes(variant.id))) {
      return { id: a.id, available: false, reason: "ADDON_INCOMPATIBLE" };
    }
    const clash = picked.some(
      (p) => p.id !== a.id && (p.conflictsWithAddonIds?.includes(a.id) || a.conflictsWithAddonIds?.includes(p.id)),
    );
    return clash ? { id: a.id, available: false, reason: "ADDON_CONFLICT" } : { id: a.id, available: true, reason: null };
  });

  const ordered = [...picked].sort(
    (x, y) => catalogue.findIndex((c) => c.id === x.id) - catalogue.findIndex((c) => c.id === y.id),
  );
  const normalized: NormalizedSelection = {
    variantId: variant?.id ?? null,
    audience,
    professionalPreference: preference,
    quantity,
    addonIds: ordered.map((a) => a.id),
    addonQuantities,
    packagePrice: !rule && !variant && input.packagePrice != null ? input.packagePrice : null,
  };

  if (issues.length > 0) {
    return { ok: false, error: ISSUE_FAMILY[issues[0]!.code], issues, normalized, addonAvailability };
  }

  const addons: SelectedAddon[] = [];
  for (const a of ordered) {
    const q = addonQuantities[a.id] ?? 1;
    const unitPaise = safePaise(a.price);
    if (unitPaise == null) {
      return {
        ok: false,
        error: "PRICING_CONFIG_MISSING",
        issues: [{ code: "PRICING_CONFIG_MISSING", field: "addonIds", id: a.id, message: `${a.name}: pricing unavailable` }],
        normalized,
        addonAvailability,
      };
    }
    addons.push({ id: a.id, name: a.name, unitPrice: a.price, quantity: q, price: toRupees(unitPaise * q), unitPaise, pricePaise: unitPaise * q });
  }
  const addonTotalPaise = sumPaise(addons.map((a) => a.pricePaise));
  const addonTotal = toRupees(addonTotalPaise);
  const duration = resolveServiceDuration(service, cfg, {
    variant,
    quantity,
    addons: ordered.map((a) => ({ durationMin: a.durationMin, quantity: addonQuantities[a.id] ?? 1 })),
  });

  return {
    ok: true,
    servicePrice,
    servicePricePaise,
    addons,
    addonTotal,
    addonTotalPaise,
    issues: [],
    normalized,
    duration,
    addonAvailability,
    snapshot: {
      variant: variant ? { id: variant.id, name: variant.name, price: variant.price } : null,
      quantity,
      quantityType: rule?.type ?? null,
      unitLabel: rule ? (quantity === 1 ? rule.unitLabel : (rule.unitLabelPlural ?? rule.unitLabel)) : null,
      unitPrice,
      audience,
      professionalPreference: preference,
      durationMinutes: duration.totalMinutes,
      duration,
      ...(Object.keys(addonQuantities).length ? { addonQuantities } : {}),
    },
  };
}

/**
 * First-error form kept for existing callers (quote, booking): same codes and shape as before.
 * It is a view of resolveServiceSelection, not a second resolver.
 */
export function resolveSelection(
  service: ServiceCore,
  cfg: ServiceCatalogConfig | null,
  input: SelectionInput,
): ResolvedSelection | { ok: false; error: SelectionError } {
  const r = resolveServiceSelection(service, cfg, input);
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    servicePrice: r.servicePrice,
    servicePricePaise: r.servicePricePaise,
    addons: r.addons,
    addonTotal: r.addonTotal,
    addonTotalPaise: r.addonTotalPaise,
    snapshot: r.snapshot,
  };
}

/**
 * Service-line price for every selectable quantity, computed by THE resolver — so a client can label
 * "2 hours · ₹398" without re-implementing unit price × quantity, minimum charges or steps.
 * Only for quantity-priced services without variants (variants change the unit price); capped at 50
 * options. Before tax, fees and discounts — the quote adds those.
 */
export function quantityPriceTable(
  service: ServiceCore,
  cfg: ServiceCatalogConfig | null,
): { quantity: number; servicePrice: number; servicePricePaise: number }[] | null {
  const rule = cfg?.quantity && cfg.quantity.type !== "NONE" ? cfg.quantity : null;
  if (!rule || (cfg?.variants ?? []).some((v) => v.active)) return null;
  const out: { quantity: number; servicePrice: number; servicePricePaise: number }[] = [];
  for (let q = rule.min; q <= rule.max && out.length < 50; q += rule.step || 1) {
    const r = resolveServiceSelection(service, cfg, { quantity: q });
    if (r.ok) out.push({ quantity: q, servicePrice: r.servicePrice, servicePricePaise: r.servicePricePaise });
  }
  return out.length ? out : null;
}
