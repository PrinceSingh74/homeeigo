/**
 * Phase 11 — provider capability: pure rules (validity arithmetic, route permissions, the error
 * table and the unknown-code guard). No database.
 */
import { describe, expect, test } from "bun:test";
import {
  certificationValidity,
  equipmentUsable,
  insuranceValidity,
  membershipAuthorizes,
  skillSatisfies,
  type ProviderCertificationRow,
  type ProviderInsuranceRow,
} from "../lib/provider-capability";
import { resolveAdminRoutePermission } from "../lib/admin-route-permissions";
import { CAPABILITY_ERRORS, CAPABILITY_ERROR_STATUS, isCapabilityKind } from "../services/provider-capability.service";
import { capabilityResponse } from "../routes/provider-capabilities";

const now = new Date("2026-09-24T10:00:00Z");
const day = 86_400_000;
const cert = (o: Partial<ProviderCertificationRow>): ProviderCertificationRow => ({ id: 1, providerId: "p", certificationType: "electrical-license", status: "VERIFIED", issuedAt: null, expiresAt: null, revokedAt: null, dataOrigin: "REAL", ...o });
const ins = (o: Partial<ProviderInsuranceRow>): ProviderInsuranceRow => ({ id: 1, providerId: "p", insuranceType: "public-liability", status: "VERIFIED", effectiveFrom: null, expiresAt: new Date(now.getTime() + 90 * day), revokedAt: null, dataOrigin: "REAL", ...o });

describe("validity arithmetic", () => {
  test("certification: verified+future = VALID; past expiry = EXPIRED even if VERIFIED; revoked beats everything; declared = UNVERIFIED", () => {
    expect(certificationValidity(cert({ expiresAt: new Date(now.getTime() + day) }), now)).toBe("VALID");
    expect(certificationValidity(cert({ expiresAt: new Date(now.getTime() - 1) }), now)).toBe("EXPIRED");
    expect(certificationValidity(cert({ expiresAt: now }), now)).toBe("EXPIRED");
    expect(certificationValidity(cert({ status: "REVOKED", revokedAt: now, expiresAt: new Date(now.getTime() + day) }), now)).toBe("REVOKED");
    expect(certificationValidity(cert({ status: "DECLARED" }), now)).toBe("UNVERIFIED");
    expect(certificationValidity(cert({ status: "REJECTED" }), now)).toBe("REJECTED");
  });
  test("insurance: not-yet-effective, expired, unverified", () => {
    expect(insuranceValidity(ins({}), now)).toBe("VALID");
    expect(insuranceValidity(ins({ effectiveFrom: new Date(now.getTime() + day) }), now)).toBe("NOT_YET_EFFECTIVE");
    expect(insuranceValidity(ins({ expiresAt: new Date(now.getTime() - day) }), now)).toBe("EXPIRED");
    expect(insuranceValidity(ins({ status: "DECLARED" }), now)).toBe("UNVERIFIED");
  });
  test("equipment is usable only when VERIFIED, operational and inspection not overdue", () => {
    const e = { id: 1, providerId: "p", equipmentType: "ladder", status: "VERIFIED" as const, operational: "OPERATIONAL" as const, inspectionDueAt: null, dataOrigin: "REAL" as const };
    expect(equipmentUsable(e, now)).toBe(true);
    expect(equipmentUsable({ ...e, inspectionDueAt: new Date(now.getTime() - 1) }, now)).toBe(false);
    expect(equipmentUsable({ ...e, operational: "OUT_OF_SERVICE" }, now)).toBe(false);
    expect(equipmentUsable({ ...e, status: "DECLARED" }, now)).toBe(false);
  });
  test("skill: expired or revoked never satisfies; verifiedOnly refuses DECLARED", () => {
    const s = { id: 1, providerId: "p", skillCode: "wiring", level: "SKILLED" as const, status: "DECLARED" as const, source: "SELF", expiresAt: null, dataOrigin: "REAL" as const };
    expect(skillSatisfies(s, { code: "wiring" }, now)).toBe(true);
    expect(skillSatisfies(s, { code: "wiring", verifiedOnly: true }, now)).toBe(false);
    expect(skillSatisfies({ ...s, status: "VERIFIED", expiresAt: new Date(now.getTime() - 1) }, { code: "wiring" }, now)).toBe(false);
    expect(skillSatisfies({ ...s, status: "REVOKED" }, { code: "wiring" }, now)).toBe(false);
  });
  test("membership authorises only inside its period, while active, for an ACTIVE business", () => {
    const m = { id: 1, businessId: "b", providerId: "p", role: "MEMBER", active: true, effectiveFrom: new Date(now.getTime() - day), effectiveTo: null, businessStatus: "ACTIVE" as const };
    expect(membershipAuthorizes(m, "b", now)).toBe(true);
    expect(membershipAuthorizes(m, "other", now)).toBe(false);
    expect(membershipAuthorizes({ ...m, active: false }, "b", now)).toBe(false);
    expect(membershipAuthorizes({ ...m, businessStatus: "SUSPENDED" }, "b", now)).toBe(false);
    expect(membershipAuthorizes({ ...m, effectiveTo: now }, "b", now)).toBe(false);
    expect(membershipAuthorizes({ ...m, effectiveFrom: new Date(now.getTime() + day) }, "b", now)).toBe(false);
  });
});

describe("admin route permissions", () => {
  const cases: Array<[string, string, string, string]> = [
    ["GET", "/api/admin/providers/p1/capabilities", "USERS", "READ"],
    ["POST", "/api/admin/providers/p1/capabilities/certifications/5/verify", "USERS", "APPROVE"],
    ["POST", "/api/admin/providers/p1/capabilities/skills/5/reject", "USERS", "APPROVE"],
    ["POST", "/api/admin/providers/p1/capabilities/insurance/5/revoke", "USERS", "APPROVE"],
    ["PATCH", "/api/admin/providers/p1/capabilities/insurance/5", "USERS", "UPDATE"],
    ["POST", "/api/admin/providers/p1/services/s1/approve", "USERS", "APPROVE"],
    ["POST", "/api/admin/providers/p1/services/s1/suspend", "USERS", "APPROVE"],
    ["GET", "/api/admin/providers/p1/service-skills", "USERS", "READ"],
    ["GET", "/api/admin/service-skill-requests", "USERS", "READ"],
    ["GET", "/api/admin/businesses", "USERS", "READ"],
    ["GET", "/api/admin/businesses/b1", "USERS", "READ"],
    ["POST", "/api/admin/businesses", "USERS", "UPDATE"],
    ["PATCH", "/api/admin/businesses/b1", "USERS", "UPDATE"],
    ["POST", "/api/admin/businesses/b1/providers/p1", "USERS", "APPROVE"],
    ["DELETE", "/api/admin/businesses/b1/providers/p1", "USERS", "APPROVE"],
    ["GET", "/api/admin/skills", "SETTINGS", "READ"],
    ["POST", "/api/admin/skills", "SETTINGS", "CREATE"],
    ["PATCH", "/api/admin/skills/wiring", "SETTINGS", "UPDATE"],
    ["PUT", "/api/admin/services/s1/business", "SETTINGS", "UPDATE"],
  ];
  for (const [m, p, resource, action] of cases) {
    test(`${m} ${p} → ${resource}/${action}`, () => {
      expect(resolveAdminRoutePermission(m, p)).toEqual({ resource, action } as never);
    });
  }
  test("an unknown capability action is unmapped (denied by default)", () => {
    expect(resolveAdminRoutePermission("POST", "/api/admin/providers/p1/capabilities/skills/5/activate")).toBeNull();
    expect(resolveAdminRoutePermission("POST", "/api/admin/providers/p1/services/s1/activate")).toBeNull();
  });
});

describe("error table and the unknown-code guard", () => {
  test("every service error code has an HTTP status", () => {
    for (const code of Object.values(CAPABILITY_ERRORS)) expect(typeof CAPABILITY_ERROR_STATUS[code]).toBe("number");
    expect(CAPABILITY_ERROR_STATUS.CAPABILITY_LOCKED).toBe(409);
    expect(CAPABILITY_ERROR_STATUS.SERVICE_NOT_OPERATIONAL).toBe(409);
    expect(CAPABILITY_ERROR_STATUS.BUSINESS_NOT_AUTHORIZED).toBe(409);
    expect(CAPABILITY_ERROR_STATUS.REASON_REQUIRED).toBe(400);
  });
  test("an unknown error code is a 500 failure, never success", () => {
    const set: { status?: number | string } = {};
    const out = capabilityResponse(set, { ok: false, error: "SOMETHING_NEW" as never });
    expect(set.status).toBe(500);
    expect(out.success).toBe(false);
  });
  test("gate refusals carry data.blocking", () => {
    const set: { status?: number | string } = {};
    const out = capabilityResponse(set, { ok: false, error: "BUSINESS_NOT_AUTHORIZED", blocking: ["BUSINESS_NOT_AUTHORIZED"] }) as { code: string; data?: { blocking: string[] } };
    expect(set.status).toBe(409);
    expect(out.code).toBe("BUSINESS_NOT_AUTHORIZED");
    expect(out.data?.blocking).toEqual(["BUSINESS_NOT_AUTHORIZED"]);
  });
  test("kinds are a closed set (identifiers for raw SQL come only from it)", () => {
    expect(isCapabilityKind("skills")).toBe(true);
    expect(isCapabilityKind("services")).toBe(false);
    expect(isCapabilityKind("provider_skills; DROP TABLE x")).toBe(false);
  });
});
