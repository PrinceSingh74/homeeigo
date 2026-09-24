import { describe, expect, test } from "bun:test";
import { classifyServiceSkill, withServiceTokens, withoutServiceTokens } from "../lib/partner-service-skills";

describe("partner service skill lanes", () => {
  test("signup skills stay performing until a typed row exists", () => {
    expect(classifyServiceSkill({ offersViaCategories: true, capabilityStatus: null, hasAnyCapabilityRow: false })).toBe("performing");
    expect(classifyServiceSkill({ offersViaCategories: false, capabilityStatus: null, hasAnyCapabilityRow: false })).toBe("available");
  });

  test("once any capability row exists, only an ACTIVE row performs that service", () => {
    expect(classifyServiceSkill({ offersViaCategories: true, capabilityStatus: null, hasAnyCapabilityRow: true })).toBe("available");
    expect(classifyServiceSkill({ offersViaCategories: false, capabilityStatus: "ACTIVE", hasAnyCapabilityRow: true })).toBe("performing");
    expect(classifyServiceSkill({ offersViaCategories: false, capabilityStatus: "REQUESTED", hasAnyCapabilityRow: true })).toBe("pending");
    expect(classifyServiceSkill({ offersViaCategories: true, capabilityStatus: "SUSPENDED", hasAnyCapabilityRow: true })).toBe("suspended");
    expect(classifyServiceSkill({ offersViaCategories: true, capabilityStatus: "REVOKED", hasAnyCapabilityRow: true })).toBe("revoked");
  });

  test("approval adds this service's id and slug, and removal leaves other signup labels", () => {
    expect(withServiceTokens(["cleaning", "plumbing"], "svc_spa", "spa")).toEqual(["cleaning", "plumbing", "svc_spa", "spa"]);
    expect(withServiceTokens(["spa", "svc_spa"], "svc_spa", "spa")).toEqual(["spa", "svc_spa"]);
    expect(withoutServiceTokens(["cleaning", "svc_spa", "spa"], "svc_spa", "spa")).toEqual(["cleaning"]);
  });
});
