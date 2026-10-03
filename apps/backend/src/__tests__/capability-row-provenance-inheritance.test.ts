/**
 * Phase 11 — a capability row with UNKNOWN provenance belongs to its provider's population.
 *
 * Found on live homigo_db 2026-09-28: the demo partner's 50 capability rows predate provenance
 * (data_origin NULL). When its user was labelled INFERRED_SYNTHETIC, NULL rows read as "business",
 * became invisible to the non-business bookings that partner serves, and — because a provider WITH
 * rows no longer gets the legacy fallback — it matched no service at all.
 */
import { describe, expect, test } from "bun:test";
import { EMPTY_CAPABILITY_ROWS, NO_CAPABILITY_REQUIREMENTS, type ProviderCapabilityRows } from "../lib/provider-capability";
import { capabilityRejections, type ServiceGateContext } from "../services/provider-capability-loader";

const NOW = new Date("2026-09-28T06:00:00.000Z");
const SERVICE = "svc-bathroom";

function ctx(bookingIsBusiness: boolean, mode: "STRICT" | "LEGACY_FALLBACK" = "LEGACY_FALLBACK"): ServiceGateContext {
  return { serviceId: SERVICE, serviceBusinessId: null, mode, requirements: NO_CAPABILITY_REQUIREMENTS, legacyRequiredSkills: [], bookingIsBusiness };
}
function rowsWith(origin: ProviderCapabilityRows["services"][number]["dataOrigin"], status = "ACTIVE"): ProviderCapabilityRows {
  return { ...EMPTY_CAPABILITY_ROWS, services: [{ id: 1, providerId: "p1", serviceId: SERVICE, status: status as never, source: "LEGACY", dataOrigin: origin }] };
}
const reasons = (r: ReturnType<typeof capabilityRejections>) => r.map((x) => x.reason);

describe("capability row provenance inheritance", () => {
  test("synthetic provider + UNKNOWN row → counts for a non-business booking (the live regression)", () => {
    expect(reasons(capabilityRejections(rowsWith(null), ctx(false), true, NOW, "INFERRED_SYNTHETIC"))).toEqual([]);
    expect(reasons(capabilityRejections(rowsWith(null), ctx(false, "STRICT"), false, NOW, "INFERRED_SYNTHETIC"))).toEqual([]);
  });

  test("synthetic provider + UNKNOWN row never satisfies a business booking", () => {
    expect(reasons(capabilityRejections(rowsWith(null), ctx(true), true, NOW, "INFERRED_SYNTHETIC"))).toContain("SERVICE_CAPABILITY_MISSING");
  });

  test("business provider + UNKNOWN row → business, as before", () => {
    expect(reasons(capabilityRejections(rowsWith(null), ctx(true), true, NOW, null))).toEqual([]);
    expect(reasons(capabilityRejections(rowsWith(null), ctx(false), true, NOW, null))).toContain("SERVICE_CAPABILITY_MISSING");
  });

  test("an explicitly labelled fixture row on a business provider stays invisible to a business booking", () => {
    expect(reasons(capabilityRejections(rowsWith("INFERRED_TEST"), ctx(true), true, NOW, null))).toContain("SERVICE_CAPABILITY_MISSING");
  });

  test("an explicit label is never overridden by the provider's population", () => {
    // A row explicitly labelled business on a synthetic provider stays business: inheritance fills UNKNOWN only.
    expect(reasons(capabilityRejections(rowsWith("REAL"), ctx(false), true, NOW, "INFERRED_SYNTHETIC"))).toContain("SERVICE_CAPABILITY_MISSING");
  });

  test("a REVOKED row inherits too, and still grants nothing", () => {
    expect(reasons(capabilityRejections(rowsWith(null, "REVOKED"), ctx(false), true, NOW, "INFERRED_SYNTHETIC"))).toContain("SERVICE_CAPABILITY_MISSING");
  });
});
