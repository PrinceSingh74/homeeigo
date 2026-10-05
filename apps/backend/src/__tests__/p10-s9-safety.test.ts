/**
 * Phase 10 §9 — safety: pure rules and structural wiring.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSafetySnapshot, customerSafetyView, evaluateSafetyGate, matchProhibitedCondition, safetyFromSnapshot, safetyGateMessage } from "../lib/service-safety";

const BACKEND = resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");

const cfg = {
  safety: {
    prohibitedConditions: ["Gas smell in the room", "Exposed live wiring"],
    warnings: ["Keep children away from the work area"],
    customerRequirements: ["Switch off the mains before the visit"],
    providerRequirements: ["Insulated gloves"],
    medicalDisclaimer: "This service is not medical treatment.",
    emergencyProtocol: "Leave the room and call 112.",
  },
  safetyNotes: ["Ventilate the room"],
};

describe("snapshot — frozen, nothing invented", () => {
  test("an unconfigured service has an empty safety snapshot, not a generic one", () => {
    expect(buildSafetySnapshot(null)).toEqual({ schema: "safety.v1", prohibitedConditions: [], warnings: [], customerRequirements: [], providerRequirements: [], information: null, medicalDisclaimer: null, emergencyProtocol: null, ppe: [], chemicalRestrictions: [], incidentProtocol: null });
  });

  test("a snapshot frozen before PPE / chemical restrictions / incident protocol reads them as none", () => {
    const old = { schema: "safety.v1", prohibitedConditions: ["Gas smell in the room"], warnings: [], customerRequirements: [], providerRequirements: [], information: null, medicalDisclaimer: null, emergencyProtocol: null };
    const s = safetyFromSnapshot({ safety: old })!;
    expect(s.ppe).toEqual([]);
    expect(s.chemicalRestrictions).toEqual([]);
    expect(s.incidentProtocol).toBeNull();
    expect(s.prohibitedConditions).toEqual(["Gas smell in the room"]);
  });

  test("PPE and the incident protocol are for the professional; chemical restrictions reach the customer too", () => {
    const s = buildSafetySnapshot({ safety: { ppe: ["Goggles"], chemicalRestrictions: ["No acid cleaners"], incidentProtocol: "Call the desk." } });
    expect(s.ppe).toEqual(["Goggles"]);
    const v = customerSafetyView(s)!;
    expect(v.chemicalRestrictions).toEqual(["No acid cleaners"]);
    expect(v).not.toHaveProperty("ppe");
    expect(v).not.toHaveProperty("incidentProtocol");
  });

  test("configured content is frozen verbatim; legacy safety notes become warnings", () => {
    const s = buildSafetySnapshot(cfg);
    expect(s.prohibitedConditions).toEqual(["Gas smell in the room", "Exposed live wiring"]);
    expect(s.warnings).toEqual(["Keep children away from the work area", "Ventilate the room"]);
    expect(safetyFromSnapshot({ safety: s })).toEqual(s);
    expect(safetyFromSnapshot({})).toBeNull();
  });

  test("the customer projection never includes the professional's requirements", () => {
    const v = customerSafetyView(buildSafetySnapshot(cfg))!;
    expect(v).not.toHaveProperty("providerRequirements");
    expect(v.medicalDisclaimer).toBe("This service is not medical treatment.");
  });
});

describe("gate", () => {
  test("no hold, no open incident → not blocked", () => {
    expect(evaluateSafetyGate([], [])).toEqual({ ok: true, blocking: [] });
  });
  test("an ACTIVE hold blocks; a RELEASED one does not", () => {
    expect(evaluateSafetyGate([{ id: 1, condition: "Gas smell in the room", source: "PROHIBITED_CONDITION", state: "ACTIVE", incidentId: null }], []).ok).toBe(false);
    expect(evaluateSafetyGate([{ id: 1, condition: "x", source: "PROHIBITED_CONDITION", state: "RELEASED", incidentId: null }], []).ok).toBe(true);
  });
  test("an open incident blocks; a resolved one does not", () => {
    expect(evaluateSafetyGate([], [{ id: "i", type: "SOS", status: "ACKNOWLEDGED" }]).ok).toBe(false);
    expect(evaluateSafetyGate([], [{ id: "i", type: "SOS", status: "RESOLVED" }]).ok).toBe(true);
  });
  test("the message is human-safe and names the condition, not internals", () => {
    const g = evaluateSafetyGate([{ id: 9, condition: "Gas smell in the room", source: "PROHIBITED_CONDITION", state: "ACTIVE", incidentId: "inc" }], [{ id: "inc", type: "LOCATION_DANGER", status: "OPEN" }]);
    expect(safetyGateMessage(g)).toBe("Work is on safety hold — prohibited condition reported: Gas smell in the room; 1 open safety incident. Our safety team must clear it first.");
  });
  test("a partner can only raise a condition the booking's frozen list names (case/space-insensitive)", () => {
    const s = buildSafetySnapshot(cfg);
    expect(matchProhibitedCondition(s, "  gas smell IN the room ")).toBe("Gas smell in the room");
    expect(matchProhibitedCondition(s, "Something else")).toBeNull();
    expect(matchProhibitedCondition(null, "Gas smell in the room")).toBeNull();
  });
});

describe("structure — precedence and wiring", () => {
  test("START: safety is checked before the requirement gate", () => {
    const s = read("src/services/booking.service.ts");
    const safety = s.indexOf('await bookingSafetyService.assertSafe(tx, id, "START");');
    const req = s.indexOf("await bookingRequirementService.assertStartAllowed(tx, id);");
    expect(safety).toBeGreaterThan(0);
    expect(req).toBeGreaterThan(safety);
  });
  test("COMPLETE: safety before the execution gate; steps gated too", () => {
    const s = read("src/services/booking.service.ts");
    expect(s.indexOf('await bookingSafetyService.assertSafe(tx, id, "COMPLETE");')).toBeLessThan(s.indexOf("await bookingExecutionService.assertCompletionAllowed(tx, id);"));
    expect(read("src/services/booking-execution.service.ts")).toContain('await bookingSafetyService.assertSafe(tx, b.id, "STEP");');
  });
  test("the booking snapshot freezes safety, and the readiness check can now fire", () => {
    const d = read("src/lib/service-domain.ts");
    expect(d).toContain("safety: buildSafetySnapshot(cfg),");
    expect(d.includes('cfg?.safetyNotes?.length || cfg?.safety ? "ok" : "ok"')).toBe(false);
  });
  test("escalation reuses the existing incident queue — no second incident system", () => {
    expect(read("src/services/booking-safety.service.ts")).toContain("partnerSafetyService.reportIssue({");
  });
  test("migration: additive, released holds immutable, audit append-only", () => {
    const sql = read("prisma/migrations/20260924200000_booking_safety_holds/migration.sql");
    expect(sql).toContain("a released hold is immutable");
    expect(sql).toContain("booking_safety_audit is append-only");
    expect(/\b(DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN)\b/i.test(sql)).toBe(false);
  });
  test("admin release is permission-mapped at APPROVE strength", () => {
    expect(read("src/lib/admin-route-permissions.ts")).toContain('/safety\\/holds\\/[^/]+\\/release$/, resource: "BOOKINGS", action: "APPROVE"');
  });
});
