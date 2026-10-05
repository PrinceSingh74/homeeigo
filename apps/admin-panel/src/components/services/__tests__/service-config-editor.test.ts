/**
 * The service editor must round-trip configuration it does not edit. It used to rebuild
 * catalogConfig from `{}` on every save, silently deleting coverage, materials, equipment, variant
 * inclusions / quantity overrides, add-on compatibility and payment timing.
 *
 *   bun test src/components/services   (from apps/admin-panel)
 */
import { describe, expect, test } from "bun:test";
import { configIssues, extrasFromRow, extrasToInput } from "../ServiceConfigEditor";
import type { AdminServiceRow, ServiceCatalogConfig } from "@/services/admin-api";

const STORED: ServiceCatalogConfig = {
  materialPolicy: "PROFESSIONAL_PROVIDED",
  equipmentPolicy: "CUSTOMER_PROVIDED",
  coverage: { pincodes: ["110001"] },
  materials: [{ name: "Shampoo", provider: "PROFESSIONAL" }],
  variants: [
    { id: "fabric", name: "Fabric", price: 150, inclusions: ["Vacuum"], quantity: { min: 1, max: 4 } },
  ],
  addons: [{ id: "guard", name: "Guard", price: 99, compatibleVariantIds: ["fabric"], description: "Protective coat" }],
  payment: { paymentTiming: "BEFORE_DISPATCH", walletAllowed: true },
  duration: { minMin: 30, maxMin: 90, serviceMin: 60 },
  safety: { warnings: ["Keep pets away"] },
};

const row = (cfg: ServiceCatalogConfig): AdminServiceRow =>
  ({
    id: "s1",
    name: "Sofa",
    slug: "sofa",
    description: "Sofa cleaning",
    detailedDescription: null,
    category: "cleaning",
    subcategory: null,
    basePrice: 150,
    minPrice: null,
    maxPrice: null,
    estimatedDuration: 60,
    icon: null,
    isActive: true,
    isFeatured: false,
    isPopular: false,
    bookingCount: 0,
    availableCities: [],
    createdAt: "2026-09-21T00:00:00Z",
    catalogConfig: cfg,
    taxonomy: { category: { slug: "home-cleaning", name: "Home Cleaning" }, subcategory: { slug: "furnishings", name: "Furnishings" } },
    serviceCode: "sofa",
  }) as AdminServiceRow;

describe("extrasToInput merges onto the stored configuration", () => {
  test("an untouched save keeps every field the form does not model", () => {
    const out = extrasToInput(extrasFromRow(row(STORED)), STORED).catalogConfig!;
    expect(out.coverage).toEqual({ pincodes: ["110001"] });
    expect(out.materials).toEqual([{ name: "Shampoo", provider: "PROFESSIONAL" }]);
    expect(out.safety).toEqual({ warnings: ["Keep pets away"] });
    expect(out.payment?.paymentTiming).toBe("BEFORE_DISPATCH");
    expect(out.duration).toMatchObject({ minMin: 30, maxMin: 90, serviceMin: 60 });
    expect(out.variants?.[0]).toMatchObject({ id: "fabric", inclusions: ["Vacuum"], quantity: { min: 1, max: 4 } });
    expect(out.addons?.[0]).toMatchObject({ id: "guard", compatibleVariantIds: ["fabric"], description: "Protective coat" });
  });
  test("a field the form owns can still be cleared", () => {
    const e = { ...extrasFromRow(row(STORED)), equipmentPolicy: "" };
    const out = extrasToInput(e, STORED).catalogConfig!;
    expect(out.equipmentPolicy).toBeUndefined();
    expect(out.materialPolicy).toBe("PROFESSIONAL_PROVIDED");
  });
  test("add-on dependency lists are owned by the form: set, kept, and cleared deliberately", () => {
    const e = extrasFromRow(row(STORED));
    expect(e.addons[0]!.compatible).toBe("fabric"); // loaded from the stored row
    e.addons = [{ ...e.addons[0]!, conflicts: "", requires: "", maxQuantity: "2" }];
    const kept = extrasToInput(e, STORED).catalogConfig!;
    expect(kept.addons?.[0]).toMatchObject({ compatibleVariantIds: ["fabric"], maxQuantity: 2, description: "Protective coat" });
    e.addons = [{ ...e.addons[0]!, compatible: "" }];
    const cleared = extrasToInput(e, STORED).catalogConfig!;
    expect(cleared.addons?.[0]?.compatibleVariantIds).toBeUndefined();
    expect(cleared.addons?.[0]?.description).toBe("Protective coat");
  });
  test("taxonomy and internal code travel to the API", () => {
    const e = { ...extrasFromRow(row(STORED)), internalServiceCode: "OPS.1" };
    const input = extrasToInput(e, STORED);
    expect(input.categorySlug).toBe("home-cleaning");
    expect(input.subcategorySlug).toBe("furnishings");
    expect(input.internalServiceCode).toBe("OPS.1");
  });
  test("editing only prices keeps coverage, materials and add-on compatibility (Phase 05)", () => {
    const e = { ...extrasFromRow(row(STORED)), minPrice: "120", maxPrice: "220" };
    e.variants = e.variants.map((v) => ({ ...v, price: "175" }));
    const input = extrasToInput(e, STORED);
    expect(input.minPrice).toBe(120);
    expect(input.maxPrice).toBe(220);
    const out = input.catalogConfig!;
    expect(out.variants?.[0]).toMatchObject({ id: "fabric", price: 175, inclusions: ["Vacuum"], quantity: { min: 1, max: 4 } });
    expect(out.coverage).toEqual({ pincodes: ["110001"] });
    expect(out.materials).toEqual([{ name: "Shampoo", provider: "PROFESSIONAL" }]);
    expect(out.addons?.[0]?.compatibleVariantIds).toEqual(["fabric"]);
  });
});

describe("Phase 06 requirements in the editor", () => {
  const WITH_REQS: ServiceCatalogConfig = {
    ...STORED,
    requirements: [
      { id: "steam", itemCode: "steam-cleaner", responsibility: "PROFESSIONAL", charge: "INCLUDED", partnerInstructions: "Check the hose", internalNote: "Rental #A12", sortOrder: 2, active: true },
      { id: "water", itemCode: "water-access", responsibility: "CUSTOMER", enforcement: "REQUIRED_BEFORE_BOOKING", verification: "CUSTOMER_ATTESTATION", active: true },
    ],
    requirementItems: { "steam-cleaner": { code: "steam-cleaner", kind: "EQUIPMENT", name: "Steam cleaner", isActive: true } },
  };

  test("untouched requirements round-trip exactly; server-owned requirementItems never goes back", () => {
    const out = extrasToInput(extrasFromRow(row(WITH_REQS)), WITH_REQS).catalogConfig as ServiceCatalogConfig;
    expect(out.requirements).toEqual(WITH_REQS.requirements);
    expect(out.requirementItems).toBeUndefined();
  });

  test("editing one requirement keeps every other piece of configuration (merge, not rebuild)", () => {
    const e = extrasFromRow(row(WITH_REQS));
    e.requirementAssignments = e.requirementAssignments.map((r) => (r.id === "steam" ? { ...r, responsibility: "CUSTOMER", charge: "NOT_APPLICABLE" } : r));
    const out = extrasToInput(e, WITH_REQS).catalogConfig as ServiceCatalogConfig;
    expect(out.requirements?.find((r) => r.id === "steam")).toMatchObject({ responsibility: "CUSTOMER", charge: "NOT_APPLICABLE", partnerInstructions: "Check the hose", internalNote: "Rental #A12" });
    expect(out.requirements?.find((r) => r.id === "water")).toEqual(WITH_REQS.requirements![1]);
    // Nothing stored is lost. (The editor also normalises variant `active` and payment booleans to explicit
    // values — pre-existing behaviour from Phase 00–04, recorded in the Phase 06 doc, not changed here.)
    for (const k of ["coverage", "materials", "variants", "addons", "payment", "duration", "safety"] as const) expect(out[k], k).toMatchObject(STORED[k] as object);
  });

  test("removing every requirement clears the key; a service without requirements stays without", () => {
    const e = extrasFromRow(row(WITH_REQS));
    e.requirementAssignments = [];
    expect((extrasToInput(e, WITH_REQS).catalogConfig as ServiceCatalogConfig).requirements).toBeUndefined();
    expect((extrasToInput(extrasFromRow(row(STORED)), STORED).catalogConfig as ServiceCatalogConfig).requirements).toBeUndefined();
  });
});

describe("Phase 10–11 sections in the editor", () => {
  /** Every key the new sections own, plus fields inside them this console has no input for. */
  const FULL: ServiceCatalogConfig = {
    ...STORED,
    variants: [{ id: "fabric", name: "Fabric", price: 150, active: true }],
    requirements: [{ id: "power", itemCode: "power-access", responsibility: "CUSTOMER", enforcement: "REQUIRED_AT_START", verification: "PARTNER_CHECK", active: true }],
    execution: {
      steps: [
        { id: "protect", title: "Protect the area", kind: "PREPARATION", sortOrder: 10, materials: ["Floor sheet"], equipment: ["Tape"] },
        {
          id: "clean",
          title: "Deep clean",
          description: "Work top to bottom",
          kind: "WORK",
          mandatory: false,
          skipPolicy: "SKIP_WITH_REASON",
          evidence: "BEFORE_AFTER_PHOTOS",
          estimatedMinutes: 45,
          dependsOn: ["protect"],
          safetyRequirement: "power",
          ppe: ["Gloves"],
          warnings: ["Wet floor"],
          when: { variantIds: ["fabric"], minQuantity: 2 },
          sortOrder: 20,
          active: false,
        },
      ],
    },
    safety: {
      information: "Ventilate the room",
      warnings: ["Keep pets away"],
      prohibitedConditions: ["Exposed wiring"],
      customerRequirements: ["Clear the room"],
      providerRequirements: ["Test on a hidden patch"],
      medicalDisclaimer: "Not a medical service",
      emergencyProtocol: "Call 112",
      ppe: ["Mask"],
      chemicalRestrictions: ["No bleach"],
      incidentProtocol: "Stop and report",
    },
    customerPolicy: { age: { mode: "ADULT_ONLY", adultAge: 18 }, version: 3 },
    quality: { checklist: ["Dry"], completionCriteria: ["No streaks"], customerConfirmation: true, professionalConfirmation: true, complaintWindowDays: 7, confirmationWindowHours: 24, revisitPolicy: "One revisit" },
    warranty: { enabled: true, durationDays: 30, startEvent: "CONFIRMATION", eligibleIssueTypes: ["DAMAGE", "QUALITY"], exclusions: ["Misuse"], proofRequired: true, reworkFirst: false, refundAllowed: false, damagePolicy: "We repair it", guarantee: "Redo if unhappy" },
    rework: { fee: "WAIVED", sameProviderPreferred: true, windowDays: 14 },
    providerRequirements: {
      requiredSkills: ["sofa-cleaning"],
      skillLevel: "senior",
      kycRequired: true,
      backgroundCheckRequired: true,
      experienceYears: 2,
      trainingModules: ["upholstery-basics"],
      skills: [{ code: "upholstery", minLevel: "SKILLED", verifiedOnly: true }, { code: "stain-removal" }],
      requiredCertifications: [{ type: "chem-handling", verificationRequired: true }, { type: "first-aid" }],
      requiredEquipment: [{ type: "steam-cleaner", requirement: "REQUIRED" }],
      requiredInsurance: [{ type: "public-liability" }],
      languages: [{ code: "hi", minProficiency: "CONVERSATIONAL" }, { code: "en" }],
    },
    matching: { ratingWeight: 0.4, preferredProvider: true, strategy: "nearest" },
    trust: { badges: ["insured"] },
  };
  const out = (e: ReturnType<typeof extrasFromRow>, base: ServiceCatalogConfig) => extrasToInput(e, base).catalogConfig as ServiceCatalogConfig;

  test("an untouched save round-trips every new section exactly, and keeps keys the form does not model", () => {
    const o = out(extrasFromRow(row(FULL)), FULL);
    for (const k of ["execution", "safety", "customerPolicy", "quality", "warranty", "rework", "providerRequirements", "matching"] as const) expect(o[k], k).toEqual(FULL[k]);
    expect(o.trust).toEqual({ badges: ["insured"] });
    expect(o.coverage).toEqual({ pincodes: ["110001"] });
    expect(configIssues(extrasFromRow(row(FULL)))).toEqual([]);
  });

  test("customerConfirmation is not a form field: a stored value passes through, true or false, and is never invented", () => {
    // Nothing in the backend reads it (the customer is always asked), so the form neither offers nor rewrites it.
    expect("customerConfirmation" in extrasFromRow(row(FULL))).toBe(false);
    for (const stored of [true, false]) {
      const cfg: ServiceCatalogConfig = { ...FULL, quality: { ...FULL.quality, customerConfirmation: stored } };
      const e = extrasFromRow(row(cfg));
      e.confirmationWindowHours = "72"; // editing the quality block around it does not touch it
      const q = out(e, cfg).quality!;
      expect(q.customerConfirmation).toBe(stored);
      expect(q.confirmationWindowHours).toBe(72);
    }
    const none: ServiceCatalogConfig = { quality: { checklist: ["Dry"] } };
    expect("customerConfirmation" in out(extrasFromRow(row(none)), none).quality!).toBe(false);
  });

  test("a service with none of the new keys gains none on an untouched save", () => {
    const o = out(extrasFromRow(row(STORED)), STORED);
    for (const k of ["execution", "customerPolicy", "warranty", "rework", "providerRequirements", "matching", "quality"] as const) expect(o[k], k).toBeUndefined();
    expect(o.safety).toEqual({ warnings: ["Keep pets away"] });
    expect(extrasToInput(extrasFromRow(), null).catalogConfig?.execution).toBeUndefined();
  });

  test("blank strings and empty lists are omitted, never saved as empty values", () => {
    const e = extrasFromRow(row(FULL));
    e.safety = { ...e.safety, information: "   ", warnings: "\n \n", ppe: "", incidentProtocol: "" };
    e.warranty = { ...e.warranty, guarantee: " ", damagePolicy: "", exclusions: "", eligibleIssueTypes: [] };
    e.completionCriteria = " \n";
    e.confirmationWindowHours = "";
    e.providerRequirements = { ...e.providerRequirements, trainingModules: [], skills: [{ code: "  ", minLevel: "", verifiedOnly: false }], languages: [], experienceYears: "" };
    e.executionSteps = e.executionSteps.map((s) => ({ ...s, description: " ", ppe: "", warnings: "", materials: " ", equipment: "", dependsOn: [], safetyRequirement: "", whenVariants: "", whenMinQuantity: "", estimatedMinutes: "" }));
    const o = out(e, FULL);
    expect(o.safety).toEqual({ prohibitedConditions: ["Exposed wiring"], customerRequirements: ["Clear the room"], providerRequirements: ["Test on a hidden patch"], medicalDisclaimer: "Not a medical service", emergencyProtocol: "Call 112", chemicalRestrictions: ["No bleach"] });
    for (const k of ["guarantee", "damagePolicy", "exclusions", "eligibleIssueTypes"] as const) expect(k in o.warranty!, k).toBe(false);
    expect("completionCriteria" in o.quality!).toBe(false);
    expect("confirmationWindowHours" in o.quality!).toBe(false);
    for (const k of ["trainingModules", "skills", "languages", "experienceYears"] as const) expect(k in o.providerRequirements!, k).toBe(false);
    expect(o.providerRequirements).toMatchObject({ requiredSkills: ["sofa-cleaning"], skillLevel: "senior", requiredInsurance: [{ type: "public-liability" }] });
    for (const s of o.execution!.steps) for (const k of ["description", "ppe", "warnings", "materials", "equipment", "dependsOn", "safetyRequirement", "when", "estimatedMinutes"]) expect(k in s, s.id + "." + k).toBe(false);
    // Nothing anywhere in the saved document is an empty string or an empty array.
    const empties: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (v === "" || (Array.isArray(v) && v.length === 0)) empties.push(path);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path + "." + k);
    };
    walk(o, "cfg");
    expect(empties).toEqual([]);
  });

  test("clearing a whole section removes its key", () => {
    const e = extrasFromRow(row(FULL));
    e.executionSteps = [];
    e.agePolicy = { ...e.agePolicy, mode: "" };
    e.rework = { fee: "", sameProviderPreferred: false, windowDays: "" };
    const o = out(e, FULL);
    expect(o.execution).toBeUndefined();
    expect(o.customerPolicy).toEqual({ version: 3 }); // the age block goes; the rest of the policy stays
    // A boolean that was stored explicitly is written back as false, not silently dropped.
    expect(o.rework).toEqual({ sameProviderPreferred: false });
  });

  test("work plan: a mandatory step is always saved NOT_SKIPPABLE; new steps omit backend defaults", () => {
    const e = extrasFromRow(row(FULL));
    e.executionSteps = e.executionSteps.map((s) => (s.id === "clean" ? { ...s, mandatory: true, skipPolicy: "SKIP_WITH_REASON" } : s));
    e.executionSteps.push({ ...e.executionSteps[0]!, key: "n9", id: "handover", title: "Hand over", kind: "CLOSEOUT", materials: "", equipment: "", sortOrder: "30" });
    const steps = out(e, FULL).execution!.steps;
    expect(steps.find((s) => s.id === "clean")).toMatchObject({ mandatory: true, skipPolicy: "NOT_SKIPPABLE" });
    expect(steps.find((s) => s.id === "handover")).toEqual({ id: "handover", title: "Hand over", kind: "CLOSEOUT", sortOrder: 30 });
    expect(steps.every((s) => !("key" in s))).toBe(true);
  });

  test("steps load in the order the professional sees them (sortOrder, then id)", () => {
    const cfg: ServiceCatalogConfig = { execution: { steps: [{ id: "b", title: "B", kind: "WORK", sortOrder: 20 }, { id: "z", title: "Z", kind: "WORK", sortOrder: 10 }, { id: "a", title: "A", kind: "WORK", sortOrder: 20 }] } };
    expect(extrasFromRow(row(cfg)).executionSteps.map((s) => s.id)).toEqual(["z", "a", "b"]);
  });

  test("configIssues reports what the backend would refuse", () => {
    const messages = (e: ReturnType<typeof extrasFromRow>) => configIssues(e).map((i) => i.tab + ": " + i.message);
    const age = extrasFromRow(row(FULL));
    age.agePolicy = { mode: "MINIMUM_AGE", minimumAge: "", adultAge: "18", guardianMinimumAge: "" };
    expect(messages(age).some((m) => m.startsWith("audience:") && m.includes("required"))).toBe(true);

    const warranty = extrasFromRow(row(FULL));
    warranty.warranty = { ...warranty.warranty, enabled: true, durationDays: "0" };
    expect(messages(warranty).some((m) => m.startsWith("warranty:") && m.includes("duration"))).toBe(true);

    const plan = extrasFromRow(row(FULL));
    plan.executionSteps = plan.executionSteps.map((s) => ({ ...s, active: true }));
    plan.executionSteps[0] = { ...plan.executionSteps[0]!, id: "Protect Area", dependsOn: ["clean"] };
    plan.executionSteps[1] = { ...plan.executionSteps[1]!, id: "clean", dependsOn: ["Protect Area"], safetyRequirement: "missing-req", whenVariants: "leather" };
    const planMessages = messages(plan).filter((m) => m.startsWith("workplan:"));
    expect(planMessages.some((m) => m.includes("Step 1") && m.includes("Lowercase"))).toBe(true);
    expect(planMessages.some((m) => m.includes("loop"))).toBe(true);
    expect(planMessages.some((m) => m.includes("missing-req"))).toBe(true);
    expect(planMessages.some((m) => m.includes("leather"))).toBe(true);

    const pro = extrasFromRow(row(FULL));
    pro.providerRequirements = { ...pro.providerRequirements, languages: [{ code: "hindi", minProficiency: "" }], skills: [{ code: "Bad Code", minLevel: "", verifiedOnly: false }], experienceYears: "99" };
    expect(messages(pro).filter((m) => m.startsWith("professionals:")).length).toBe(3);

    const quality = extrasFromRow(row(FULL));
    quality.confirmationWindowHours = "0";
    expect(messages(quality).some((m) => m.startsWith("quality:"))).toBe(true);
  });
});
