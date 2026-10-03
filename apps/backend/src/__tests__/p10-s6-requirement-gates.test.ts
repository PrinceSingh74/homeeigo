/**
 * Phase 10 §6 — requirement gates: the pure rules.
 *
 * The gate, the responsibility model and the error contract as functions of a booking's snapshot and
 * its state rows. Every case maps to a row of the §6 defect matrix (R-numbers in the test names).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canTransitionRequirement,
  effectiveState,
  enforcementPointOf,
  evaluateRequirementGate,
  gateMessage,
  gatedItemsFromSnapshot,
  pointsRequiredFor,
  RequirementGateError,
  REQUIREMENT_GATE_BLOCKED,
  type RequirementStateRow,
} from "../lib/requirement-gates";
import { getAvailableJobActions } from "../lib/job-action-policy";

const BACKEND = resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");
const DAY = new Date("2026-10-01T04:30:00.000Z");

function row(over: Partial<RequirementStateRow> & { code: string }): RequirementStateRow {
  return {
    bookingId: "b1", itemCode: over.code, kind: "CUSTOMER_PRECONDITION", enforcement: "REQUIRED_BEFORE_ARRIVAL", verification: "PARTNER_CHECK",
    responsibility: "CUSTOMER", optional: false, serviceVersion: 3, state: "UNRESOLVED", resolvedByRole: null, resolvedById: null,
    evidenceKind: null, evidenceRef: null, evidenceLat: null, evidenceLng: null, note: null, validForScheduledAt: null, resolvedAt: null,
    version: 1, updatedAt: DAY, ...over,
  };
}
const satisfied = (code: string, over: Partial<RequirementStateRow> = {}) =>
  row({ code, state: "SATISFIED", resolvedByRole: "PARTNER", resolvedById: "p1", evidenceKind: "PARTNER_CHECK", evidenceRef: "partner-check:r1", validForScheduledAt: DAY, resolvedAt: DAY, ...over });

describe("enforcement points come from the Phase 06 vocabulary — nothing invented", () => {
  test("the three gated values map; copy-only values have no point", () => {
    expect(enforcementPointOf("REQUIRED_BEFORE_BOOKING")).toBe("BEFORE_BOOKING");
    expect(enforcementPointOf("REQUIRED_BEFORE_ARRIVAL")).toBe("BEFORE_ARRIVAL");
    expect(enforcementPointOf("REQUIRED_AT_START")).toBe("AT_START");
    expect(enforcementPointOf("INFORMATIONAL")).toBeNull();
    expect(enforcementPointOf("WARNING")).toBeNull();
  });

  test("START is gated on BEFORE_ARRIVAL and AT_START; arrival evaluation looks at BEFORE_ARRIVAL only", () => {
    expect(pointsRequiredFor("START")).toEqual(["BEFORE_ARRIVAL", "AT_START"]);
    expect(pointsRequiredFor("ARRIVAL")).toEqual(["BEFORE_ARRIVAL"]);
  });

  test("gated items are read from the booking's requirements.v1 snapshot; INFORMATIONAL/WARNING are copy (R8/R18)", () => {
    const snap = {
      requirements: {
        schema: "requirements.v1", serviceVersion: 3,
        items: [
          { code: "water", itemCode: "running-water-access", kind: "CUSTOMER_PRECONDITION", name: "Running water access", customerLabel: "Access to running water", enforcement: "REQUIRED_BEFORE_ARRIVAL", verification: "PARTNER_CHECK", responsibility: "CUSTOMER", optional: false, attested: false },
          { code: "shampoo", itemCode: "shampoo", kind: "MATERIAL", name: "Shampoo", enforcement: "INFORMATIONAL", verification: "NONE", responsibility: "PROFESSIONAL", optional: false, attested: false },
          { code: "attest", itemCode: "attest", kind: "CUSTOMER_PRECONDITION", name: "Attested", enforcement: "REQUIRED_BEFORE_BOOKING", verification: "CUSTOMER_ATTESTATION", responsibility: "CUSTOMER", optional: false, attested: true },
        ],
      },
    };
    const out = gatedItemsFromSnapshot(snap)!;
    expect(out.serviceVersion).toBe(3);
    expect(out.items.map((i) => i.code)).toEqual(["attest", "water"]);
    expect(out.items[1]).toMatchObject({ enforcementPoint: "BEFORE_ARRIVAL", customerLabel: "Access to running water" });
  });

  test("a booking without a snapshot has nothing to gate on — nothing is fabricated", () => {
    expect(gatedItemsFromSnapshot(null)).toBeNull();
    expect(gatedItemsFromSnapshot({})).toBeNull();
    expect(gatedItemsFromSnapshot({ requirements: { schema: "requirements.v0", items: [] } })).toBeNull();
  });
});

describe("the gate", () => {
  test("no gated requirement → not blocked (unrelated services are not blocked)", () => {
    expect(evaluateRequirementGate({ target: "START", rows: [], scheduledDate: DAY })).toEqual({ target: "START", ok: true, evaluated: 0, blocking: [] });
  });

  test("R1: an unchecked REQUIRED_BEFORE_ARRIVAL partner check blocks START with PARTNER_CHECK_REQUIRED", () => {
    const g = evaluateRequirementGate({ target: "START", rows: [row({ code: "water" })], scheduledDate: DAY, labels: { water: "Access to running water" } });
    expect(g.ok).toBe(false);
    expect(g.blocking).toEqual([
      expect.objectContaining({ code: "water", label: "Access to running water", enforcementPoint: "BEFORE_ARRIVAL", state: "UNRESOLVED", reason: "PARTNER_CHECK_REQUIRED", remediation: expect.objectContaining({ role: "PARTNER" }) }),
    ]);
  });

  test("R2: an unchecked REQUIRED_AT_START item blocks START too", () => {
    const g = evaluateRequirementGate({ target: "START", rows: [row({ code: "shutoff", enforcement: "REQUIRED_AT_START" })], scheduledDate: DAY });
    expect(g.ok).toBe(false);
    expect(g.blocking[0]!.enforcementPoint).toBe("AT_START");
  });

  test("arrival evaluation reports BEFORE_ARRIVAL items only", () => {
    const g = evaluateRequirementGate({ target: "ARRIVAL", rows: [row({ code: "water" }), row({ code: "shutoff", enforcement: "REQUIRED_AT_START" })], scheduledDate: DAY });
    expect(g.evaluated).toBe(1);
    expect(g.blocking.map((b) => b.code)).toEqual(["water"]);
  });

  test("a FAILED customer precondition blocks with CUSTOMER_PRECONDITION_MISSING and a customer remediation", () => {
    const g = evaluateRequirementGate({ target: "START", rows: [row({ code: "water", state: "FAILED", resolvedByRole: "PARTNER", resolvedById: "p1", evidenceKind: "PARTNER_CHECK", resolvedAt: DAY })], scheduledDate: DAY });
    expect(g.blocking[0]).toMatchObject({ state: "FAILED", reason: "CUSTOMER_PRECONDITION_MISSING", remediation: { role: "CUSTOMER" } });
  });

  test("satisfied on the same appointment passes; optional items never block", () => {
    const g = evaluateRequirementGate({ target: "START", rows: [satisfied("water"), row({ code: "nice", optional: true })], scheduledDate: DAY });
    expect(g.ok).toBe(true);
    expect(g.evaluated).toBe(1);
  });

  test("R9: a partner check made for a different appointment is EXPIRED and blocks — a reschedule invalidates evidence", () => {
    const moved = new Date(DAY.getTime() + 86_400_000);
    expect(effectiveState(satisfied("water"), moved)).toBe("EXPIRED");
    const g = evaluateRequirementGate({ target: "START", rows: [satisfied("water")], scheduledDate: moved });
    expect(g.blocking[0]).toMatchObject({ state: "EXPIRED", reason: "REQUIREMENT_EXPIRED" });
  });

  test("a booking-time attestation is not appointment-bound and does not expire", () => {
    const moved = new Date(DAY.getTime() + 86_400_000);
    expect(effectiveState(satisfied("attest", { validForScheduledAt: null, evidenceKind: "CUSTOMER_ATTESTATION" }), moved)).toBe("SATISFIED");
  });

  test("deterministic order: enforcement point, then code — regardless of input order", () => {
    const rows = [row({ code: "z", enforcement: "REQUIRED_AT_START" }), row({ code: "m" }), row({ code: "a", enforcement: "REQUIRED_AT_START" }), row({ code: "b" })];
    const once = evaluateRequirementGate({ target: "START", rows, scheduledDate: DAY }).blocking.map((b) => b.code);
    const twice = evaluateRequirementGate({ target: "START", rows: [...rows].reverse(), scheduledDate: DAY }).blocking.map((b) => b.code);
    expect(once).toEqual(["b", "m", "a", "z"]);
    expect(twice).toEqual(once);
  });

  test("the message is human-safe: labels only", () => {
    const g = evaluateRequirementGate({ target: "START", rows: [row({ code: "water" })], scheduledDate: DAY, labels: { water: "Access to running water" } });
    expect(gateMessage(g)).toBe("Before starting, resolve: Access to running water");
    expect(gateMessage(g)).not.toContain("water:");
    const err = new RequirementGateError(g);
    expect(err.message).toBe(REQUIREMENT_GATE_BLOCKED);
    expect(err.code).toBe("REQUIREMENT_GATE_BLOCKED");
  });
});

describe("responsibility model — who may move what (R4, R5, R17)", () => {
  const partnerCheck = row({ code: "water" });
  const attestation = row({ code: "attest", enforcement: "REQUIRED_BEFORE_BOOKING", verification: "CUSTOMER_ATTESTATION" });

  test("R4: a customer cannot satisfy a partner check — not even their own booking's", () => {
    expect(canTransitionRequirement({ row: partnerCheck, actor: { role: "CUSTOMER", isOwner: true }, to: "SATISFIED" }).ok).toBe(false);
  });

  test("the customer can only send a FAILED partner check back for re-checking", () => {
    expect(canTransitionRequirement({ row: partnerCheck, actor: { role: "CUSTOMER", isOwner: true }, to: "UNRESOLVED" }).ok).toBe(false);
    expect(canTransitionRequirement({ row: { ...partnerCheck, state: "FAILED" }, actor: { role: "CUSTOMER", isOwner: true }, to: "UNRESOLVED" }).ok).toBe(true);
    expect(canTransitionRequirement({ row: { ...partnerCheck, state: "FAILED" }, actor: { role: "CUSTOMER", isOwner: false }, to: "UNRESOLVED" }).ok).toBe(false);
  });

  test("R5: a partner cannot satisfy a customer attestation", () => {
    expect(canTransitionRequirement({ row: attestation, actor: { role: "PARTNER", isAssignedPartner: true }, to: "SATISFIED" }).ok).toBe(false);
  });

  test("the assigned partner records SATISFIED or FAILED on a partner check; an unassigned partner records nothing (R7)", () => {
    expect(canTransitionRequirement({ row: partnerCheck, actor: { role: "PARTNER", isAssignedPartner: true }, to: "SATISFIED" }).ok).toBe(true);
    expect(canTransitionRequirement({ row: partnerCheck, actor: { role: "PARTNER", isAssignedPartner: true }, to: "FAILED" }).ok).toBe(true);
    expect(canTransitionRequirement({ row: partnerCheck, actor: { role: "PARTNER", isAssignedPartner: true }, to: "UNRESOLVED" }).ok).toBe(false);
    expect(canTransitionRequirement({ row: partnerCheck, actor: { role: "PARTNER", isAssignedPartner: false }, to: "SATISFIED" }).ok).toBe(false);
  });

  test("R17: an admin can only force a re-check — there is no admin 'mark satisfied'", () => {
    expect(canTransitionRequirement({ row: { ...partnerCheck, state: "FAILED" }, actor: { role: "ADMIN" }, to: "UNRESOLVED" }).ok).toBe(true);
    expect(canTransitionRequirement({ row: partnerCheck, actor: { role: "ADMIN" }, to: "SATISFIED" }).ok).toBe(false);
    expect(canTransitionRequirement({ row: partnerCheck, actor: { role: "ADMIN" }, to: "FAILED" }).ok).toBe(false);
  });

  test("an informational item has no state to move", () => {
    const r = canTransitionRequirement({ row: { ...partnerCheck, enforcement: "INFORMATIONAL" }, actor: { role: "PARTNER", isAssignedPartner: true }, to: "SATISFIED" });
    expect(r).toEqual({ ok: false, error: "REQUIREMENT_NOT_GATED" });
  });
});

describe("the job-action policy reflects the server gate (R19)", () => {
  // Arrived, OTP not yet verified: the stage at which START_SERVICE is offered.
  const arrived = { status: "EN_ROUTE", enRouteAt: DAY, arrivedAt: DAY, paymentStatus: "SUCCESS", startOtpVerifiedAt: null };

  test("with the gate blocked, START_SERVICE is offered but disabled with the gate's message and a named gate", () => {
    const a = getAvailableJobActions({ ...arrived, requirementGate: { ok: false, blocking: 1, message: "Before starting, resolve: Access to running water" } });
    expect(a.availableActions).toContain("START_SERVICE");
    expect(a.requiredGates).toContain("REQUIREMENTS_RESOLVED");
    expect(a.disabledReasons.START_SERVICE).toBe("Before starting, resolve: Access to running water");
  });

  test("with the gate open — or not supplied (a client mirror) — nothing changes: only the OTP gate remains", () => {
    const open = getAvailableJobActions({ ...arrived, requirementGate: { ok: true, blocking: 0, message: "" } });
    expect(open.requiredGates).not.toContain("REQUIREMENTS_RESOLVED");
    expect(open.disabledReasons.START_SERVICE).toBe("Customer OTP required");
    expect(getAvailableJobActions(arrived).requiredGates).not.toContain("REQUIREMENTS_RESOLVED");
  });

  test("payment still wins: an unpaid AND blocked job says payment first", () => {
    const a = getAvailableJobActions({ ...arrived, paymentStatus: "PENDING", requirementGate: { ok: false, blocking: 1, message: "x" } });
    expect(a.disabledReasons.START_SERVICE).toBe("Payment confirmation pending");
    expect(a.requiredGates).toEqual(expect.arrayContaining(["PAYMENT_SETTLED", "REQUIREMENTS_RESOLVED"]));
  });
});

describe("structure — the chain is wired where it must be", () => {
  test("START consults the gate inside its transaction, before the status write", () => {
    const s = read("src/services/booking.service.ts");
    const gate = s.indexOf("await bookingRequirementService.assertStartAllowed(tx, id);");
    const write = s.indexOf('data: { status: "IN_PROGRESS", startedAt },', gate);
    const txStart = s.lastIndexOf("prisma.$transaction(async (tx) =>", gate);
    expect(gate).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(gate);
    expect(txStart).toBeGreaterThan(0);
  });

  test("the START gate locks the state rows it evaluates (R14)", () => {
    const s = read("src/services/booking-requirement.service.ts");
    expect(s).toContain("listRequirementStates(tx, bookingId, { lock: true })");
    expect(read("src/lib/booking-requirement-store.ts")).toContain("ORDER BY code FOR UPDATE");
  });

  test("state rows are born with the booking, in its transaction, from its snapshot", () => {
    const s = read("src/services/booking.service.ts");
    expect(s).toContain("await bookingRequirementService.materializeForNewBooking(tx, {");
    expect(s).toContain("snapshot: { requirements: requirementsSnapshot },");
  });

  test("R6: no route accepts a client's opinion of satisfaction — the partner sends what they FOUND, the server decides", () => {
    const r = read("src/routes/bookings.ts");
    expect(r).toContain('outcome: t.Union([t.Literal("SATISFIED"), t.Literal("FAILED")]),');
    expect(/satisfied:\s*t\.Boolean|checked:\s*t\.Boolean|complete:\s*t\.Boolean/.test(r)).toBe(false);
    expect(r).toContain("if (err instanceof RequirementGateError) {");
  });

  test("R24: realtime is published after the mutation, by the one publisher", () => {
    const s = read("src/services/booking-requirement.service.ts");
    const commit = s.indexOf("isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted");
    const publish = s.lastIndexOf("publishBookingRequirementBackground({");
    expect(publish).toBeGreaterThan(commit);
    expect(read("src/lib/booking-realtime.ts")).toContain("export async function publishBookingRequirement(");
  });

  test("audit is written by a trigger the application cannot skip, and is append-only", () => {
    const sql = read("prisma/migrations/20260924150000_booking_requirement_states/migration.sql");
    expect(sql).toContain('CREATE TRIGGER "booking_requirement_states_audit_trg"');
    expect(sql).toContain("booking_requirement_audit is append-only");
    for (const col of ["request_id", "trace_id", "actor_type", "actor_id", "reason", "from_state", "to_state", "evidence_ref", "idempotency_key", "service_version"]) {
      expect(sql).toContain(`"${col}"`);
    }
    expect(/\b(DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN)\b/i.test(sql)).toBe(false);
  });

  test("cross-domain: admin reassignment invalidates the previous partner's checks", () => {
    const s = read("src/services/admin-booking-operations.service.ts");
    const hook = s.indexOf("await bookingRequirementService.resetPartnerChecksAfterReassignment({ bookingId, adminId, reason });");
    const publish = s.indexOf("status: BookingStatus.ASSIGNED,", hook);
    expect(hook).toBeGreaterThan(0);
    expect(publish).toBeGreaterThan(hook);
  });

  test("the admin routes are permission-mapped (a hidden button is not a control)", () => {
    const p = read("src/lib/admin-route-permissions.ts");
    expect(p).toContain("/requirements$/, resource: \"BOOKINGS\", action: \"READ\"");
    expect(p).toContain("/requirements\\/[^/]+\\/recheck$/, resource: \"BOOKINGS\", action: \"UPDATE\"");
  });
});
