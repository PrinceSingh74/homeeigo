/**
 * Phase 11 — canonical matching hard gates, pure (no database).
 *
 * The order is a contract: an operator reading a rejection sees the most fundamental failure first
 * (population, then business, then capability, then availability, location, presence, capacity).
 */
import { describe, expect, test } from "bun:test";
import {
  MATCHING_GATE_ORDER,
  availabilityGate,
  countRejections,
  distanceBoundGate,
  evaluateMatchingGates,
  serviceAreaGate,
} from "../lib/matching-gates";
import { MATCHING_REJECTION_REASONS, EMPTY_CAPABILITY_ROWS, type ProviderCapabilityRows } from "../lib/provider-capability";
import { isBusinessRow } from "../lib/analytics-scope";
import { capabilityRejections, requirementsForMode, type ServiceGateContext } from "../services/provider-capability-loader";

const NOW = new Date("2026-09-24T06:00:00.000Z");
const ALWAYS = { workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], workingHoursStart: "00:00", workingHoursEnd: "23:59", timezone: "Asia/Kolkata" };

describe("gate order", () => {
  test("the order covers every machine-readable reason exactly once", () => {
    expect([...MATCHING_GATE_ORDER].sort()).toEqual([...MATCHING_REJECTION_REASONS].sort());
    expect(new Set(MATCHING_GATE_ORDER).size).toBe(MATCHING_GATE_ORDER.length);
  });

  test("every failing gate is reported, in the mandated order, regardless of input order", () => {
    const r = evaluateMatchingGates({
      providerIsBusiness: false,
      bookingIsBusiness: true,
      capability: [
        { reason: "LANGUAGE_MISMATCH", detail: "hi" },
        { reason: "BUSINESS_NOT_AUTHORIZED", detail: "biz" },
        { reason: "CERTIFICATION_EXPIRED", detail: "gas" },
      ],
      notAvailable: "offline",
      location: "outside_service_radius",
      presenceFresh: false,
      capacityFull: true,
    });
    expect(r.map((x) => x.reason)).toEqual([
      "PROVENANCE_INVALID",
      "BUSINESS_NOT_AUTHORIZED",
      "CERTIFICATION_EXPIRED",
      "LANGUAGE_MISMATCH",
      "PROVIDER_NOT_AVAILABLE",
      "LOCATION_GATE_FAILED",
      "PRESENCE_STALE",
      "CAPACITY_EXCEEDED",
    ]);
  });

  test("a clean candidate has no rejection", () => {
    expect(evaluateMatchingGates({ providerIsBusiness: true, bookingIsBusiness: true, capability: [], notAvailable: null, location: null, presenceFresh: true, capacityFull: false })).toEqual([]);
  });

  test("provenance is symmetric: a business provider is refused for a non-business booking too", () => {
    const r = evaluateMatchingGates({ providerIsBusiness: true, bookingIsBusiness: false, capability: [], notAvailable: null, location: null, presenceFresh: true, capacityFull: false });
    expect(r).toEqual([{ reason: "PROVENANCE_INVALID", detail: "business_provider" }]);
  });

  test("counts tally providers per reason, once per provider", () => {
    expect(countRejections([{ reasons: ["PRESENCE_STALE", "PRESENCE_STALE"] }, { reasons: ["PRESENCE_STALE", "CAPACITY_EXCEEDED"] }])).toEqual({ PRESENCE_STALE: 2, CAPACITY_EXCEEDED: 1 });
  });
});

describe("availability / location predicates (shared with the score)", () => {
  test("offline, paused, outside hours and break are each named", () => {
    expect(availabilityGate({ isOnline: false, pausedAt: null, ...ALWAYS }, NOW, NOW)).toBe("offline");
    expect(availabilityGate({ isOnline: true, pausedAt: NOW, ...ALWAYS }, NOW, NOW)).toBe("paused");
    // An EMPTY workingDays is "unset = 24/7" by design (incomplete profiles are not punished); NOW is a Thursday.
    expect(availabilityGate({ isOnline: true, pausedAt: null, ...ALWAYS, workingDays: ["Mon"] }, NOW, NOW)).toBe("outside_working_hours");
    expect(availabilityGate({ isOnline: true, pausedAt: null, ...ALWAYS, breakWindows: [{ start: "00:00", end: "23:58" }] }, NOW, NOW)).toBe("break_active");
    expect(availabilityGate({ isOnline: true, pausedAt: null, ...ALWAYS }, NOW, NOW)).toBeNull();
  });

  test("unknown distance never passes a boundary", () => {
    expect(distanceBoundGate(null, 50)).toBe("position_unknown");
    expect(distanceBoundGate(50.1, 50)).toBe("beyond_max_distance");
    expect(distanceBoundGate(50, 50)).toBeNull();
    expect(serviceAreaGate({ serviceRadiusKm: 10, serviceRegions: [], hasOrigin: true }, null, undefined)).toBe("outside_service_radius");
    expect(serviceAreaGate({ serviceRadiusKm: 10, serviceRegions: [], hasOrigin: true }, 10.5, undefined)).toBe("outside_service_radius");
    expect(serviceAreaGate({ serviceRadiusKm: 10, serviceRegions: ["noida"], hasOrigin: true }, 3, new Set(["gurgaon"]))).toBe("outside_service_zone");
    expect(serviceAreaGate({ serviceRadiusKm: 10, serviceRegions: ["noida"], hasOrigin: true }, 3, new Set(["noida sector 62"]))).toBeNull();
  });
});

describe("capability reason codes through the loader's wrapper", () => {
  const base = (over: Partial<ServiceGateContext> = {}): ServiceGateContext => ({
    serviceId: "svc", serviceBusinessId: null, mode: "LEGACY_FALLBACK",
    requirements: requirementsForMode({}, "LEGACY_FALLBACK"), legacyRequiredSkills: [], bookingIsBusiness: true, ...over,
  });
  const rows = (over: Partial<ProviderCapabilityRows>): ProviderCapabilityRows => ({ ...EMPTY_CAPABILITY_ROWS, ...over });
  const cert = (over: object) => ({ id: 1, providerId: "p", certificationType: "gas-safety", status: "VERIFIED" as const, issuedAt: null, expiresAt: null, revokedAt: null, dataOrigin: null, ...over });

  test("legacy mode: a provider with no typed rows passes on the legacy rule; STRICT refuses SERVICE_CAPABILITY_MISSING", () => {
    expect(capabilityRejections(EMPTY_CAPABILITY_ROWS, base(), true, NOW)).toEqual([]);
    expect(capabilityRejections(EMPTY_CAPABILITY_ROWS, base({ mode: "STRICT" }), true, NOW).map((r) => r.reason)).toEqual(["SERVICE_CAPABILITY_MISSING"]);
  });

  test("legacy mode: a provider WITH typed rows needs an ACTIVE one for this service", () => {
    const r = rows({ services: [{ id: 1, providerId: "p", serviceId: "other", status: "ACTIVE", source: "ADMIN", dataOrigin: null }] });
    expect(capabilityRejections(r, base(), true, NOW).map((x) => x.reason)).toEqual(["SERVICE_CAPABILITY_MISSING"]);
  });

  test("certifications: missing / expired / unverified are distinct codes", () => {
    const ctx = base({ requirements: requirementsForMode({ providerRequirements: { requiredCertifications: [{ type: "gas-safety" }] } }, "LEGACY_FALLBACK") });
    expect(capabilityRejections(EMPTY_CAPABILITY_ROWS, ctx, true, NOW).map((x) => x.reason)).toEqual(["CERTIFICATION_MISSING"]);
    expect(capabilityRejections(rows({ certifications: [cert({ expiresAt: new Date(NOW.getTime() - 1000) })] }), ctx, true, NOW).map((x) => x.reason)).toEqual(["CERTIFICATION_EXPIRED"]);
    expect(capabilityRejections(rows({ certifications: [cert({ status: "DECLARED" })] }), ctx, true, NOW).map((x) => x.reason)).toEqual(["CERTIFICATION_UNVERIFIED"]);
    expect(capabilityRejections(rows({ certifications: [cert({})] }), ctx, true, NOW)).toEqual([]);
  });

  test("a fixture certificate proves nothing for a business booking (and vice versa)", () => {
    const ctx = base({ requirements: requirementsForMode({ providerRequirements: { requiredCertifications: [{ type: "gas-safety" }] } }, "LEGACY_FALLBACK") });
    expect(capabilityRejections(rows({ certifications: [cert({ dataOrigin: "FIXTURE" })] }), ctx, true, NOW).map((x) => x.reason)).toEqual(["CERTIFICATION_MISSING"]);
    expect(capabilityRejections(rows({ certifications: [cert({ dataOrigin: "FIXTURE" })] }), { ...ctx, bookingIsBusiness: false }, true, NOW)).toEqual([]);
    // GF10 — UNKNOWN (NULL) provenance counts as business by the existing owner policy.
    expect(isBusinessRow(null)).toBe(true);
    expect(capabilityRejections(rows({ certifications: [cert({ dataOrigin: null })] }), ctx, true, NOW)).toEqual([]);
  });

  test("LEGACY mode does not re-read legacy requiredSkills strings as typed skills (no double rejection); STRICT does", () => {
    const cfg = { providerRequirements: { requiredSkills: ["deep-clean"] } };
    expect(requirementsForMode(cfg, "LEGACY_FALLBACK").requiredSkills).toEqual([]);
    expect(requirementsForMode(cfg, "STRICT").requiredSkills).toEqual([{ code: "deep-clean" }]);
    const typed = { providerRequirements: { requiredSkills: ["deep-clean"], skills: [{ code: "sofa-shampoo" }] } };
    expect(requirementsForMode(typed, "LEGACY_FALLBACK").requiredSkills).toEqual([{ code: "sofa-shampoo" }]);
  });

  test("business service: membership required, and it must be active in an ACTIVE business", () => {
    const ctx = base({ serviceBusinessId: "biz-1" });
    const m = (over: object) => ({ id: 1, businessId: "biz-1", providerId: "p", role: "MEMBER", active: true, effectiveFrom: new Date(NOW.getTime() - 86_400_000), effectiveTo: null, businessStatus: "ACTIVE" as const, ...over });
    expect(capabilityRejections(EMPTY_CAPABILITY_ROWS, ctx, true, NOW).map((x) => x.reason)).toEqual(["BUSINESS_NOT_AUTHORIZED"]);
    expect(capabilityRejections(rows({ memberships: [m({})] }), ctx, true, NOW)).toEqual([]);
    expect(capabilityRejections(rows({ memberships: [m({ businessStatus: "SUSPENDED" })] }), ctx, true, NOW).map((x) => x.reason)).toEqual(["BUSINESS_NOT_AUTHORIZED"]);
    expect(capabilityRejections(rows({ memberships: [m({ businessId: "biz-2" })] }), ctx, true, NOW).map((x) => x.reason)).toEqual(["BUSINESS_NOT_AUTHORIZED"]);
  });
});
