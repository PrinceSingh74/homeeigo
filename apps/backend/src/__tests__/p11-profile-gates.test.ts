/**
 * Phase 11 — provider profile gates and the completion attestation, pure (no database).
 *
 * `kycRequired`, `backgroundCheckRequired`, `experienceYears` and training were accepted by the
 * catalogue schema and read by nothing: an admin could require a background check and every
 * unchecked professional was still matched. These tests pin that each one now refuses, that
 * unknown facts fail closed, and that a service which asks for nothing is unaffected.
 */
import { describe, expect, test } from "bun:test";
import {
  EMPTY_CAPABILITY_ROWS,
  MATCHING_REJECTION_REASONS,
  capabilityRequirementsFromConfig,
  evaluateCapabilityGates,
  evaluateProfileGates,
  type ProviderCapabilityRows,
  type ProviderProfileFacts,
} from "../lib/provider-capability";
import { MATCHING_GATE_ORDER } from "../lib/matching-gates";
import { isBusinessRow } from "../lib/analytics-scope";
import { serviceCatalogConfigSchema } from "../lib/service-catalog-config";
import { deriveQualityVerdict } from "../lib/quality-verdict";
import { qualityFromSnapshot, qualitySnapshot } from "../lib/service-runtime-policy";
import { buildWarrantySnapshot } from "../lib/service-warranty";
import { resolveExecutionPlan } from "../lib/service-execution";

const NOW = new Date("2026-10-05T06:00:00.000Z");

const CLEARED: ProviderProfileFacts = { kycVerified: true, backgroundCheck: "CLEARED", experienceYears: 5, completedTrainingModules: ["deep-clean-basics"] };

function gate(cfg: unknown, profile: ProviderProfileFacts | null | undefined) {
  const rows: ProviderCapabilityRows = { ...EMPTY_CAPABILITY_ROWS, ...(profile === undefined ? {} : { profile }) };
  return evaluateCapabilityGates({
    requirements: capabilityRequirementsFromConfig(cfg),
    rows,
    serviceId: "svc",
    serviceBusinessId: null,
    serviceCapability: "LEGACY_FALLBACK",
    legacyOffersService: true,
    bookingIsBusiness: true,
    isBusinessOrigin: isBusinessRow,
    now: NOW,
  }).map((r) => r.reason);
}

describe("profile requirements are read from the catalogue", () => {
  test("a service that asks for nothing has no profile requirement", () => {
    expect(capabilityRequirementsFromConfig({ providerRequirements: { requiredSkills: [] } }).profile).toBeUndefined();
    expect(capabilityRequirementsFromConfig(null).profile).toBeUndefined();
    expect(gate({}, null)).toEqual([]);
  });

  test("each switch maps to its requirement; trust flags ask for the same thing", () => {
    const p = capabilityRequirementsFromConfig({
      providerRequirements: { kycRequired: true, backgroundCheckRequired: true, experienceYears: 2, trainingModules: ["deep-clean-basics"] },
    }).profile!;
    expect(p).toEqual({ kycRequired: true, backgroundCheckRequired: true, minExperienceYears: 2, trainingModules: ["deep-clean-basics"] });
    const viaTrust = capabilityRequirementsFromConfig({ providerRequirements: {}, trust: { backgroundCheckRequired: true, verifiedProfessionalRequired: true } }).profile!;
    expect(viaTrust.backgroundCheckRequired).toBe(true);
    expect(viaTrust.kycRequired).toBe(true);
  });

  test("the schema accepts the new keys and still refuses unknown ones", () => {
    const cfg = serviceCatalogConfigSchema.parse({ providerRequirements: { backgroundCheckRequired: true, trainingModules: ["deep-clean-basics"] } });
    expect(cfg.providerRequirements?.trainingModules).toEqual(["deep-clean-basics"]);
    expect(() => serviceCatalogConfigSchema.parse({ providerRequirements: { policeCheck: true } })).toThrow();
  });
});

describe("profile gates", () => {
  const ALL = { providerRequirements: { kycRequired: true, backgroundCheckRequired: true, experienceYears: 3, trainingModules: ["deep-clean-basics", "chemical-safety"] } };

  test("a professional who meets everything passes", () => {
    expect(gate(ALL, { ...CLEARED, completedTrainingModules: ["deep-clean-basics", "chemical-safety"] })).toEqual([]);
  });

  test("each unmet requirement is its own reason, with the missing module named", () => {
    const r = evaluateProfileGates(capabilityRequirementsFromConfig(ALL).profile, { kycVerified: false, backgroundCheck: "PENDING", experienceYears: 1, completedTrainingModules: ["deep-clean-basics"] });
    expect(r).toEqual([
      { reason: "KYC_UNVERIFIED", detail: "identity_not_verified" },
      { reason: "BACKGROUND_CHECK_NOT_CLEARED", detail: "PENDING" },
      { reason: "EXPERIENCE_INSUFFICIENT", detail: "1<3" },
      { reason: "TRAINING_INCOMPLETE", detail: "chemical-safety" },
    ]);
  });

  test("a failed or missing background check is not a cleared one", () => {
    for (const state of ["NOT_DONE", "PENDING", "FAILED"] as const) {
      expect(gate({ providerRequirements: { backgroundCheckRequired: true } }, { ...CLEARED, backgroundCheck: state })).toEqual(["BACKGROUND_CHECK_NOT_CLEARED"]);
    }
  });

  test("facts that were not loaded fail closed", () => {
    expect(gate(ALL, undefined)).toEqual(["KYC_UNVERIFIED", "BACKGROUND_CHECK_NOT_CLEARED", "EXPERIENCE_INSUFFICIENT", "TRAINING_INCOMPLETE", "TRAINING_INCOMPLETE"]);
    expect(gate(ALL, null)).toHaveLength(5);
  });

  test("a requirement that is not set never rejects, whatever the professional's record says", () => {
    const blank: ProviderProfileFacts = { kycVerified: false, backgroundCheck: "FAILED", experienceYears: 0, completedTrainingModules: [] };
    expect(gate({ providerRequirements: { requiredSkills: [] } }, blank)).toEqual([]);
  });

  test("the four reasons are in the canonical order, after the capability gates and before availability", () => {
    for (const r of ["KYC_UNVERIFIED", "BACKGROUND_CHECK_NOT_CLEARED", "EXPERIENCE_INSUFFICIENT", "TRAINING_INCOMPLETE"] as const) {
      expect(MATCHING_REJECTION_REASONS).toContain(r);
      expect(MATCHING_GATE_ORDER.indexOf(r)).toBeGreaterThan(MATCHING_GATE_ORDER.indexOf("LANGUAGE_MISMATCH"));
      expect(MATCHING_GATE_ORDER.indexOf(r)).toBeLessThan(MATCHING_GATE_ORDER.indexOf("PROVIDER_NOT_AVAILABLE"));
    }
  });
});

describe("professional confirmation", () => {
  const cfg = serviceCatalogConfigSchema.parse({ quality: { completionCriteria: ["Floor is dry", "No residue on surfaces"], professionalConfirmation: true } });
  const policy = qualitySnapshot(cfg);
  const base = { executionSteps: [], executionGate: null, safetyGate: null, openIncidents: [] };
  const evidence = { photos: 0, hasBefore: false, hasAfter: false, checklistComplete: true, missingChecklistItems: [] };

  test("criteria and the attestation switch are frozen, and survive a snapshot round trip", () => {
    expect(policy).toMatchObject({ completionCriteria: ["Floor is dry", "No residue on surfaces"], professionalConfirmation: true });
    expect(qualityFromSnapshot({ quality: JSON.parse(JSON.stringify(policy)) })).toMatchObject({ completionCriteria: ["Floor is dry", "No residue on surfaces"], professionalConfirmation: true });
  });

  test("a booking frozen before the field existed asks for no attestation", () => {
    const old = qualityFromSnapshot({ quality: { proofRequired: false, beforeAfterPhotos: false, checklist: ["Wipe surfaces"], warrantyDays: 0, customerConfirmation: false } })!;
    expect(old.professionalConfirmation).toBeUndefined();
    const v = deriveQualityVerdict({ ...base, qualityPolicy: old, evidence });
    expect(v.reasonCodes).not.toContain("QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED");
  });

  test("without the attestation the job goes back for rework; with it the job passes", () => {
    const refused = deriveQualityVerdict({ ...base, qualityPolicy: policy, evidence });
    expect(refused.verdict).toBe("REWORK_REQUIRED");
    expect(refused.reasonCodes).toEqual(["QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED"]);
    const passed = deriveQualityVerdict({ ...base, qualityPolicy: policy, evidence: { ...evidence, professionalConfirmed: true } });
    expect(passed.verdict).toBe("PASS");
  });

  test("the attestation never stands in for proof", () => {
    const strict = qualitySnapshot(serviceCatalogConfigSchema.parse({ quality: { proofRequired: true, professionalConfirmation: true } }));
    const v = deriveQualityVerdict({ ...base, qualityPolicy: strict, evidence: { ...evidence, professionalConfirmed: true } });
    expect(v.verdict).toBe("REWORK_REQUIRED");
    expect(v.reasonCodes).toEqual(["QUALITY_PROOF_REQUIRED"]);
  });
});

describe("warranty texts and step materials are frozen with the booking", () => {
  test("guarantee and damage policy ride on warranty.v1; a legacy warranty has neither", () => {
    const w = buildWarrantySnapshot(serviceCatalogConfigSchema.parse({ warranty: { enabled: true, durationDays: 7, guarantee: "We come back free.", damagePolicy: "Report within 24 hours." } }));
    expect(w.guarantee).toBe("We come back free.");
    expect(w.damagePolicy).toBe("Report within 24 hours.");
    expect(buildWarrantySnapshot({ quality: { warrantyDays: 7 } }).guarantee ?? null).toBeNull();
  });

  test("a step carries its own materials and equipment into the resolved plan", () => {
    const cfg = serviceCatalogConfigSchema.parse({
      execution: { steps: [{ id: "scrub", title: "Scrub the floor", kind: "WORK", materials: ["Neutral floor cleaner"], equipment: ["Scrubbing machine"] }, { id: "dry", title: "Dry", kind: "CLOSEOUT" }] },
    });
    const plan = resolveExecutionPlan(cfg, { variantId: null, addonIds: [], quantity: 1 });
    if (!plan.ok) throw new Error("plan should resolve");
    expect(plan.steps.find((s) => s.code === "scrub")).toMatchObject({ materials: ["Neutral floor cleaner"], equipment: ["Scrubbing machine"] });
    expect(plan.steps.find((s) => s.code === "dry")).toMatchObject({ materials: [], equipment: [] });
  });
});
