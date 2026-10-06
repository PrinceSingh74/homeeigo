/**
 * The customer-facing "Your professional" section. Every line is a requirement the matching gates
 * enforce before a professional can be offered the job (lib/provider-capability.ts), read through
 * the same function matching uses. Nothing is said that is not enforced, and internal codes
 * (skill codes, certificate types, training module slugs, equipment) never appear.
 */
import { describe, expect, test } from "bun:test";
import { customerProfessionalView } from "../lib/customer-visit";
import { serviceCatalogConfigSchema } from "../lib/service-catalog-config";

const cfg = (providerRequirements: Record<string, unknown>) => serviceCatalogConfigSchema.parse({ providerRequirements });

describe("customerProfessionalView", () => {
  test("nothing configured means no section, not a generic promise", () => {
    expect(customerProfessionalView(null)).toBeNull();
    expect(customerProfessionalView(serviceCatalogConfigSchema.parse({}))).toBeNull();
    expect(customerProfessionalView(cfg({}))).toBeNull();
  });

  test("each enforced requirement becomes one plain statement, in a fixed order", () => {
    const view = customerProfessionalView(
      cfg({
        kycRequired: true,
        backgroundCheckRequired: true,
        experienceYears: 3,
        trainingModules: ["deep-cleaning-basics"],
        requiredCertifications: [{ type: "electrical-licence", verificationRequired: true }],
        requiredInsurance: [{ type: "public-liability" }],
      }),
    );
    expect(view).toEqual({
      statements: [
        { code: "IDENTITY_VERIFIED", text: "Their identity is verified before they can take this job." },
        { code: "BACKGROUND_CHECKED", text: "They have a cleared background check." },
        { code: "EXPERIENCE", text: "They have at least 3 years of experience." },
        { code: "TRAINED", text: "They have completed our training for this service." },
        { code: "CERTIFIED", text: "They hold the certification this service requires." },
        { code: "INSURED", text: "They carry the insurance this service requires." },
      ],
    });
  });

  test("the legacy verified-professional switch is the identity requirement matching enforces", () => {
    expect(customerProfessionalView(cfg({ verifiedProfessionalRequired: true }))?.statements.map((s) => s.code)).toEqual(["IDENTITY_VERIFIED"]);
  });

  test("one year reads as one year; zero is not a requirement", () => {
    expect(customerProfessionalView(cfg({ experienceYears: 1 }))?.statements[0]?.text).toBe("They have at least 1 year of experience.");
    expect(customerProfessionalView(cfg({ experienceYears: 0 }))).toBeNull();
  });

  test("display-only and deprecated fields say nothing: they are not enforced", () => {
    expect(customerProfessionalView(cfg({ trainingRequired: true, skillLevel: "expert", certifications: ["Some free text"] }))).toBeNull();
  });

  test("no internal code reaches the customer", () => {
    const json = JSON.stringify(
      customerProfessionalView(
        cfg({
          trainingModules: ["deep-cleaning-basics"],
          requiredCertifications: [{ type: "electrical-licence" }],
          requiredInsurance: [{ type: "public-liability" }],
          skills: [{ code: "sofa-shampoo", minLevel: "EXPERT" }],
          requiredEquipment: [{ type: "wet-vacuum", requirement: "REQUIRED" }],
        }),
      ),
    );
    for (const internal of ["deep-cleaning-basics", "electrical-licence", "public-liability", "sofa-shampoo", "wet-vacuum", "EXPERT"]) {
      expect(json).not.toContain(internal);
    }
  });
});
