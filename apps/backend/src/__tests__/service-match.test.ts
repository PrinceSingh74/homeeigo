import { describe, expect, test } from "bun:test";
import type { ServiceMatchTokens } from "../lib/service-match";
import { providerOffersService } from "../lib/service-match";

const plumbingRepairTokens: ServiceMatchTokens = {
  serviceId: "svc-plumbing-uuid",
  category: "repair",
  serviceSlug: "plumbing",
  categoryServiceIds: ["svc-plumbing-uuid", "svc-ac-uuid"],
  partnerRegistrationSlugs: ["repair", "plumbing", "ac-repair", "electrician", "appliance-repair"],
};

describe("providerOffersService", () => {
  test("matches partner registration slug plumbing to repair-category service", () => {
    expect(providerOffersService(["plumbing"], plumbingRepairTokens)).toBe(true);
  });

  test("matches ac-repair partner to repair-category ac-service", () => {
    const tokens: ServiceMatchTokens = {
      ...plumbingRepairTokens,
      serviceSlug: "ac-service",
      partnerRegistrationSlugs: ["repair", "ac-repair", "plumbing", "electrician", "appliance-repair"],
    };
    expect(providerOffersService(["ac-repair"], tokens)).toBe(true);
  });

  test("matches cleaning category directly", () => {
    const tokens: ServiceMatchTokens = {
      serviceId: "svc-deep",
      category: "cleaning",
      serviceSlug: "deep-cleaning",
      categoryServiceIds: ["svc-deep"],
      partnerRegistrationSlugs: ["cleaning", "pest-control"],
    };
    expect(providerOffersService(["cleaning"], tokens)).toBe(true);
  });

  test("rejects unrelated partner slug", () => {
    expect(providerOffersService(["salon"], plumbingRepairTokens)).toBe(false);
  });
});
