/**
 * Phase 10 §6 — requirement gates, end to end on the isolated test database, through the real routes.
 *
 * One service with four Phase 06 requirements — a REQUIRED_BEFORE_ARRIVAL partner check, a
 * REQUIRED_AT_START partner check, a REQUIRED_BEFORE_BOOKING attestation and an INFORMATIONAL
 * item — booked by a fixture customer and worked by the fixture partner. Each test is a row of the
 * §6 defect matrix, plus the controls that prove a refusal is the rule and not a broken fixture.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { sumCounter } from "../lib/metrics";
import { bookingService } from "../services/booking.service";
import { bookingRequirementService } from "../services/booking-requirement.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, keepPresenceFresh, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `p10s6-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let addr: { latitude: number; longitude: number };
const itemIds: string[] = [];
let hoursAhead = 100;

type Res = { status: number; json: any };
async function call(method: string, path: string, body?: unknown, token?: string | null, headers: Record<string, string> = {}): Promise<Res> {
  const h: Record<string, string> = { "Content-Type": "application/json", ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const customer = () => bearer(ctx.customerA);
const admin = () => bearer(ctx.superAdmin);
const partner = () => bearer({ id: ctx.vendorUserId, email: `${RUN}@partner.test` });

const CONFIG = {
  materialPolicy: "PROFESSIONAL_PROVIDED",
  equipmentPolicy: "PROFESSIONAL_PROVIDED",
  coverage: { pincodes: [] as string[] },
  quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
  variants: [{ id: "fabric", name: "Fabric", price: 250 }],
  variantRequired: true,
  addons: [] as unknown[],
};
const codeOf = (c: string) => `${RUN}-${c}`;
const REQUIREMENTS = [
  { id: "socket", itemCode: codeOf("socket"), responsibility: "CUSTOMER", enforcement: "REQUIRED_BEFORE_ARRIVAL", verification: "PARTNER_CHECK", customerNote: "A 3-pin socket within 5 m.", sortOrder: 1 },
  { id: "shutoff", itemCode: codeOf("shutoff"), responsibility: "CUSTOMER", enforcement: "REQUIRED_AT_START", verification: "PARTNER_CHECK", sortOrder: 2 },
  { id: "water", itemCode: codeOf("water"), responsibility: "CUSTOMER", enforcement: "REQUIRED_BEFORE_BOOKING", verification: "CUSTOMER_ATTESTATION", sortOrder: 3 },
  { id: "info", itemCode: codeOf("info"), responsibility: "CUSTOMER", enforcement: "INFORMATIONAL", sortOrder: 4 },
];

const version = async () => (await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { version: true } })).version;
const saveRequirements = (requirements: unknown[]) =>
  version().then((v) => call("PUT", `/api/admin/services/${ctx.serviceId}`, { catalogConfig: { ...CONFIG, requirements }, expectedVersion: v, changeReason: "§6 test" }, admin()));

/** A paid, accepted booking on the fixture partner, OTP already verified — the state a partner starts from. */
async function readyBooking(): Promise<string> {
  hoursAhead += 24;
  const sel = { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 2, scheduledDate: futureSlot(hoursAhead).toISOString(), requirementAttestations: ["water"] };
  const r = await call("POST", "/api/bookings", sel, customer());
  if (r.status !== 201) throw new Error(`booking create: ${r.status} ${JSON.stringify(r.json)}`);
  const id: string = r.json.data.booking?.id ?? r.json.data.id;
  await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date() } });
  return id;
}
const statusOf = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
const stateOf = async (id: string, code: string) =>
  (await prisma.$queryRaw<{ state: string; version: number }[]>`SELECT state, version FROM booking_requirement_states WHERE booking_id = ${id} AND code = ${code}`)[0]!;
const auditCount = async (id: string, code?: string) =>
  Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM booking_requirement_audit WHERE booking_id = ${id} AND (${code ?? null}::text IS NULL OR code = ${code ?? null})`)[0]!.n);
const notifications = (userId: string, type: string, referenceId: string) => prisma.notification.count({ where: { userId, type, referenceId } });
const check = (id: string, code: string, outcome: "SATISFIED" | "FAILED", extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  call("POST", `/api/bookings/${id}/requirements/${code}/check`, { outcome, latitude: addr.latitude, longitude: addr.longitude, ...extra }, partner(), headers);
const start = (id: string, extra: Record<string, unknown> = {}) => call("POST", `/api/bookings/${id}/start`, { latitude: addr.latitude, longitude: addr.longitude, ...extra }, partner());

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
  addr = { latitude: a.latitude as number, longitude: a.longitude as number };
  for (const d of [
    { code: codeOf("socket"), kind: "CUSTOMER_PRECONDITION", name: "Working power socket", customerLabel: "A working power socket near the sofa" },
    { code: codeOf("shutoff"), kind: "CUSTOMER_PRECONDITION", name: "Water shut-off access", customerLabel: "Access to the water shut-off valve" },
    { code: codeOf("water"), kind: "CUSTOMER_PRECONDITION", name: "Running water access", customerLabel: "Access to running water" },
    { code: codeOf("info"), kind: "CUSTOMER_PRECONDITION", name: "Pets kept away", customerLabel: "Pets kept in another room" },
  ]) {
    const r = await call("POST", "/api/admin/requirement-items", d, admin());
    if (r.status !== 200) throw new Error(`item: ${JSON.stringify(r.json)}`);
    itemIds.push(r.json.data.item.id);
  }
  const base = await call("PUT", `/api/admin/services/${ctx.serviceId}`, { pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250, catalogConfig: CONFIG }, admin());
  if (base.status !== 200) throw new Error(`service: ${JSON.stringify(base.json)}`);
  const saved = await saveRequirements(REQUIREMENTS);
  if (saved.status !== 200) throw new Error(`requirements: ${JSON.stringify(saved.json)}`);
  await keepPresenceFresh(ctx);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.serviceRequirement.deleteMany({ where: { itemId: { in: itemIds } } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
  await prisma.serviceRequirementItem.deleteMany({ where: { id: { in: itemIds } } }).catch(() => {});
}, 60_000);

describe.serial("snapshot → state: rows are born with the booking, from its own snapshot", () => {
  let id = "";
  test("gated items get state rows in the create transaction; the attested one is born SATISFIED; copy items get none", async () => {
    if (!dbOk) return;
    id = await readyBooking();
    const rows = await prisma.$queryRaw<{ code: string; state: string; evidence_kind: string | null; enforcement: string }[]>`
      SELECT code, state, evidence_kind, enforcement FROM booking_requirement_states WHERE booking_id = ${id} ORDER BY code`;
    expect(rows).toEqual([
      { code: "shutoff", state: "UNRESOLVED", evidence_kind: null, enforcement: "REQUIRED_AT_START" },
      { code: "socket", state: "UNRESOLVED", evidence_kind: null, enforcement: "REQUIRED_BEFORE_ARRIVAL" },
      { code: "water", state: "SATISFIED", evidence_kind: "CUSTOMER_ATTESTATION", enforcement: "REQUIRED_BEFORE_BOOKING" },
    ]);
    expect(await auditCount(id)).toBe(3);
    const audit = await prisma.$queryRaw<{ action: string; actor_type: string | null }[]>`SELECT action, actor_type FROM booking_requirement_audit WHERE booking_id = ${id} LIMIT 1`;
    expect(audit[0]).toEqual({ action: "MATERIALIZED", actor_type: "customer" });
  });

  test("the view: customer and partner see the same items and gate; the customer never sees a partner's note (R7 for outsiders)", async () => {
    if (!dbOk) return;
    const c = await call("GET", `/api/bookings/${id}/requirements`, undefined, customer());
    expect(c.status).toBe(200);
    expect(c.json.data.enforced).toBe(true);
    expect(c.json.data.items.map((i: { code: string; state: string; label: string }) => [i.code, i.state, i.label])).toEqual([
      ["shutoff", "UNRESOLVED", "Access to the water shut-off valve"],
      ["socket", "UNRESOLVED", "A working power socket near the sofa"],
      ["water", "SATISFIED", "Access to running water"],
    ]);
    expect(c.json.data.gate.start.ok).toBe(false);
    expect(c.json.data.gate.start.blocking.map((b: { code: string }) => b.code)).toEqual(["socket", "shutoff"]);
    const p = await call("GET", `/api/bookings/${id}/requirements`, undefined, partner());
    expect(p.status).toBe(200);
    expect(p.json.data.items.find((i: { code: string }) => i.code === "socket").actions).toEqual(["CHECK"]);
    // Another customer, and a partner who is not assigned, learn nothing.
    expect((await call("GET", `/api/bookings/${id}/requirements`, undefined, bearer(ctx.customerB))).status).toBe(404);
    expect((await call("GET", `/api/bookings/${id}/requirements`, undefined, bearer(ctx.supportAdmin))).status).toBe(404);
  });

  test("R1/R2: START is refused with the structured contract while a partner check is unrecorded; the booking does not move", async () => {
    if (!dbOk) return;
    const blockedBefore = sumCounter("start_blocked_by_requirement_total");
    const r = await start(id);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("REQUIREMENT_GATE_BLOCKED");
    expect(r.json.error).toBe("Before starting, resolve: A working power socket near the sofa, Access to the water shut-off valve");
    expect(r.json.data.enforcementPoint).toBe("AT_START");
    expect(r.json.data.blocking).toEqual([
      expect.objectContaining({ code: "socket", enforcementPoint: "BEFORE_ARRIVAL", reason: "PARTNER_CHECK_REQUIRED", remediation: expect.objectContaining({ role: "PARTNER" }) }),
      expect.objectContaining({ code: "shutoff", enforcementPoint: "AT_START", reason: "PARTNER_CHECK_REQUIRED" }),
    ]);
    expect(JSON.stringify(r.json)).not.toContain("A 3-pin socket");
    expect(await statusOf(id)).toBe("ACCEPTED");
    expect(sumCounter("start_blocked_by_requirement_total")).toBe(blockedBefore + 1);
  });

  test("R6: a client boolean changes nothing — the body is not the authority", async () => {
    if (!dbOk) return;
    const r = await start(id, { requirementsSatisfied: true, checklistComplete: true, requirements: { socket: "SATISFIED", shutoff: "SATISFIED" } });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("REQUIREMENT_GATE_BLOCKED");
  });

  test("R19: /actions carries the server gate before arrival, and once arrived disables START with the gate's message", async () => {
    if (!dbOk) return;
    const before = await call("GET", `/api/bookings/${id}/actions`, undefined, partner());
    expect(before.status).toBe(200);
    expect(before.json.data.requirementGate).toEqual({ ok: false, blocking: 2, message: "Before starting, resolve: A working power socket near the sofa, Access to the water shut-off valve" });
    expect(before.json.data.availableActions).not.toContain("START_SERVICE");
  });

  test("arrival is recorded (a fact) and answers with what blocks START; /actions now names the gate", async () => {
    if (!dbOk) return;
    const r = await call("POST", `/api/bookings/${id}/arrived`, { latitude: addr.latitude, longitude: addr.longitude }, partner());
    expect(r.status).toBe(200);
    expect(r.json.data.booking.arrivedAt).toBeTruthy();
    expect(r.json.data.requirementGate.ok).toBe(false);
    expect(r.json.data.requirementGate.blocking.map((b: { code: string }) => b.code)).toEqual(["socket"]);
    const a = await call("GET", `/api/bookings/${id}/actions`, undefined, partner());
    expect(a.json.data.availableActions).toContain("START_SERVICE");
    expect(a.json.data.requiredGates).toContain("REQUIREMENTS_RESOLVED");
    expect(a.json.data.disabledReasons.START_SERVICE).toBe("Before starting, resolve: A working power socket near the sofa, Access to the water shut-off valve");
  });

  test("R4/R5: a customer cannot satisfy a partner check; a partner cannot satisfy a customer attestation; copy items have no state", async () => {
    if (!dbOk) return;
    const c1 = await call("POST", `/api/bookings/${id}/requirements/socket/customer`, { action: "ATTEST" }, customer());
    expect(c1.status).toBe(403);
    expect(c1.json.code).toBe("REQUIREMENT_TRANSITION_FORBIDDEN");
    const c2 = await call("POST", `/api/bookings/${id}/requirements/socket/customer`, { action: "READY" }, customer());
    expect(c2.status).toBe(403);
    const p1 = await check(id, "water", "SATISFIED");
    expect(p1.status).toBe(403);
    expect(p1.json.code).toBe("REQUIREMENT_TRANSITION_FORBIDDEN");
    const p2 = await check(id, "info", "SATISFIED");
    expect(p2.status).toBe(404);
    expect(p2.json.code).toBe("REQUIREMENT_NOT_FOUND");
    expect((await stateOf(id, "socket")).state).toBe("UNRESOLVED");
    expect((await stateOf(id, "water")).state).toBe("SATISFIED");
  });

  test("R7/R23: an unassigned partner, or another customer, cannot touch the booking's requirements", async () => {
    if (!dbOk) return;
    const outsider = await call("POST", `/api/bookings/${id}/requirements/socket/customer`, { action: "READY" }, bearer(ctx.customerB));
    expect(outsider.status).toBe(404);
    // The support admin has no provider record: the partner route refuses before any requirement is read.
    const notPartner = await call("POST", `/api/bookings/${id}/requirements/socket/check`, { outcome: "SATISFIED", latitude: addr.latitude, longitude: addr.longitude }, bearer(ctx.supportAdmin));
    expect([401, 403, 404]).toContain(notPartner.status);
    expect((await stateOf(id, "socket")).state).toBe("UNRESOLVED");
  });

  test("R22: a check from across town is not evidence — proximity is enforced like arrival", async () => {
    if (!dbOk) return;
    const far = await check(id, "socket", "SATISFIED", { latitude: addr.latitude + 1 });
    expect(far.status).toBe(400);
    expect(far.json.code).toBe("OUTSIDE_SERVICE_AREA");
    expect((await stateOf(id, "socket")).state).toBe("UNRESOLVED");
  });

  test("a FAILED check blocks with a customer remediation, tells the customer once, and is idempotent (R15/R16/R25)", async () => {
    if (!dbOk) return;
    const auditBefore = await auditCount(id, "socket");
    const first = await check(id, "socket", "FAILED", { note: "no socket within reach of the sofa" });
    expect(first.status).toBe(200);
    expect(first.json.data).toMatchObject({ code: "socket", state: "FAILED", changed: true });
    expect(first.json.data.gate.blocking.find((b: { code: string }) => b.code === "socket")).toMatchObject({ state: "FAILED", reason: "CUSTOMER_PRECONDITION_MISSING", remediation: { role: "CUSTOMER" } });
    expect(await notifications(ctx.customerA.id, "booking_requirement_missing", `${id}:socket`)).toBe(1);
    expect(await auditCount(id, "socket")).toBe(auditBefore + 1);

    const again = await check(id, "socket", "FAILED", { note: "no socket within reach of the sofa" });
    expect(again.status).toBe(200);
    expect(again.json.data.changed).toBe(false);
    expect(await auditCount(id, "socket")).toBe(auditBefore + 1);
    expect(await notifications(ctx.customerA.id, "booking_requirement_missing", `${id}:socket`)).toBe(1);

    // The customer sees the state and the remediation, never the partner's note.
    const c = await call("GET", `/api/bookings/${id}/requirements`, undefined, customer());
    const socket = c.json.data.items.find((i: { code: string }) => i.code === "socket");
    expect(socket).toMatchObject({ state: "FAILED", note: null, actions: ["READY"], blocking: { reason: "CUSTOMER_PRECONDITION_MISSING" } });
    expect(JSON.stringify(c.json)).not.toContain("no socket within reach");
  });

  test("the customer sends it back for re-check: FAILED → UNRESOLVED, the partner is told, START stays refused", async () => {
    if (!dbOk) return;
    const r = await call("POST", `/api/bookings/${id}/requirements/socket/customer`, { action: "READY", note: "extension cord placed" }, customer());
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ state: "UNRESOLVED", changed: true });
    expect(await notifications(ctx.vendorUserId, "booking_requirement_recheck", `${id}:socket:${(await stateOf(id, "socket")).version}`)).toBe(1);
    expect((await start(id)).status).toBe(409);
  });

  test("both checks recorded on site → the gate opens and START succeeds; the customer is not spammed", async () => {
    if (!dbOk) return;
    expect((await check(id, "socket", "SATISFIED")).json.data.state).toBe("SATISFIED");
    const last = await check(id, "shutoff", "SATISFIED");
    expect(last.json.data.gate.ok).toBe(true);
    const a = await call("GET", `/api/bookings/${id}/actions`, undefined, partner());
    expect(a.json.data.requiredGates).not.toContain("REQUIREMENTS_RESOLVED");
    const r = await start(id);
    expect(r.status).toBe(200);
    expect(await statusOf(id)).toBe("IN_PROGRESS");
    expect(await notifications(ctx.customerA.id, "booking_requirement_missing", `${id}:socket`)).toBe(1);
  });

  test("R18/R8: editing the service's requirements afterwards does not touch the booking's rows or snapshot", async () => {
    if (!dbOk) return;
    const before = await prisma.$queryRaw<{ code: string; state: string; version: number }[]>`SELECT code, state, version FROM booking_requirement_states WHERE booking_id = ${id} ORDER BY code`;
    // The catalogue now says the socket is only informational and the pets item is gated at start.
    const changed = REQUIREMENTS.map((r) =>
      r.id === "socket" ? { ...r, enforcement: "INFORMATIONAL", verification: "NONE" } : r.id === "info" ? { ...r, enforcement: "REQUIRED_AT_START", verification: "PARTNER_CHECK" } : r,
    );
    expect((await saveRequirements(changed)).status).toBe(200);
    const after = await prisma.$queryRaw<{ code: string; state: string; version: number }[]>`SELECT code, state, version FROM booking_requirement_states WHERE booking_id = ${id} ORDER BY code`;
    expect(after).toEqual(before);
    const v = await call("GET", `/api/bookings/${id}/requirements`, undefined, customer());
    expect(v.json.data.items.map((i: { code: string }) => i.code)).toEqual(["shutoff", "socket", "water"]);
    expect((await saveRequirements(REQUIREMENTS)).status).toBe(200);
  });

  test("a finished booking's requirements are read-only", async () => {
    if (!dbOk) return;
    await prisma.booking.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
    const r = await check(id, "socket", "FAILED");
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("INVALID_STATUS");
  });
});

describe.serial("expiry, admin, concurrency", () => {
  test("R9: a reschedule after the checks makes the evidence EXPIRED — START refused with REQUIREMENT_EXPIRED", async () => {
    if (!dbOk) return;
    const id = await readyBooking();
    await check(id, "socket", "SATISFIED");
    await check(id, "shutoff", "SATISFIED");
    expect((await call("GET", `/api/bookings/${id}/requirements`, undefined, partner())).json.data.gate.start.ok).toBe(true);
    hoursAhead += 24;
    await prisma.booking.update({ where: { id }, data: { scheduledDate: futureSlot(hoursAhead) } });
    const v = await call("GET", `/api/bookings/${id}/requirements`, undefined, partner());
    expect(v.json.data.items.filter((i: { code: string }) => i.code !== "water").map((i: { state: string }) => i.state)).toEqual(["EXPIRED", "EXPIRED"]);
    const r = await start(id);
    expect(r.status).toBe(409);
    expect(r.json.data.blocking[0].reason).toBe("REQUIREMENT_EXPIRED");
    // The attestation given at booking is not appointment-bound.
    expect(v.json.data.items.find((i: { code: string }) => i.code === "water").state).toBe("SATISFIED");
  });

  test("R17: only an authorised admin can force a re-check, with a reason; the audit names them with request and trace ids", async () => {
    if (!dbOk) return;
    const id = await readyBooking();
    await check(id, "socket", "SATISFIED");
    expect((await call("POST", `/api/admin/bookings/${id}/requirements/socket/recheck`, { reason: "customer disputes" }, customer())).status).toBe(403);
    expect((await call("POST", `/api/admin/bookings/${id}/requirements/socket/recheck`, { reason: "customer disputes" }, partner())).status).toBe(403);
    const a = await call("POST", `/api/admin/bookings/${id}/requirements/socket/recheck`, { reason: "customer disputes the socket" }, admin(), { "x-request-id": `${RUN}-req` });
    expect(a.status).toBe(200);
    expect(a.json.data.state).toBe("UNRESOLVED");
    const view = await call("GET", `/api/admin/bookings/${id}/requirements`, undefined, admin());
    expect(view.status).toBe(200);
    const last = view.json.data.audit.filter((x: { code: string }) => x.code === "socket").at(-1);
    expect(last).toMatchObject({ action: "ADMIN_RECHECK", fromState: "SATISFIED", toState: "UNRESOLVED", actorType: "admin", actorId: ctx.superAdmin.id });
    expect(last.reason).toContain("customer disputes the socket");
    expect(last.requestId).toBeTruthy();
    // No admin path marks a requirement satisfied.
    expect((await call("POST", `/api/admin/bookings/${id}/requirements/socket/satisfy`, { reason: "x" }, admin())).status).toBe(404);
  });

  test("R14: a check and a start racing resolve deterministically — a started job always has its evidence", async () => {
    if (!dbOk) return;
    const id = await readyBooking();
    await check(id, "socket", "SATISFIED");
    const results = await Promise.all([
      ...Array.from({ length: 4 }, () => bookingService.start(ctx.providerId, id, addr.latitude, addr.longitude).then(() => "started" as const, (e: Error) => e.message)),
      bookingRequirementService.partnerCheck({ bookingId: id, providerId: ctx.providerId, userId: ctx.vendorUserId, code: "shutoff", outcome: "SATISFIED", latitude: addr.latitude, longitude: addr.longitude }).then((r) => (r.ok ? "checked" : r.error)),
    ]);
    const started = results.filter((r) => r === "started").length;
    const refused = results.filter((r) => r === "REQUIREMENT_GATE_BLOCKED").length;
    expect(results).toContain("checked");
    // Every start either started or was refused by the gate — never a crash, a deadlock or a lost write.
    expect(results.filter((r) => !["started", "REQUIREMENT_GATE_BLOCKED", "checked"].includes(r))).toEqual([]);
    expect(started + refused).toBe(4);
    const status = await statusOf(id);
    expect(status).toBe(started > 0 ? "IN_PROGRESS" : "ACCEPTED");
    if (started > 0) expect((await stateOf(id, "shutoff")).state).toBe("SATISFIED");
    const transitions = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM booking_status_history WHERE booking_id = ${id} AND new_status = 'IN_PROGRESS'`;
    expect(Number(transitions[0]!.n)).toBe(started > 0 ? 1 : 0);
  });

  test("two conflicting checks on the same item: both are serialised, the audit shows both, the last one stands", async () => {
    if (!dbOk) return;
    const id = await readyBooking();
    const before = await auditCount(id, "socket");
    const out = await Promise.all([check(id, "socket", "SATISFIED"), check(id, "socket", "FAILED", { note: "gone" })]);
    expect(out.map((r) => r.status)).toEqual([200, 200]);
    const rows = await prisma.$queryRaw<{ to_state: string }[]>`SELECT to_state FROM booking_requirement_audit WHERE booking_id = ${id} AND code = 'socket' ORDER BY id`;
    expect(rows.length).toBe(before + 2);
    expect((await stateOf(id, "socket")).state).toBe(rows.at(-1)!.to_state);
  });

  test("cross-domain: reassigning the partner sends every partner check back for re-checking; the booking-time attestation stays", async () => {
    if (!dbOk) return;
    const id = await readyBooking();
    await check(id, "socket", "SATISFIED");
    await check(id, "shutoff", "FAILED");
    const reset = await bookingRequirementService.resetPartnerChecksAfterReassignment({ bookingId: id, adminId: ctx.superAdmin.id, reason: "partner unavailable" });
    expect(reset).toBe(2);
    expect((await stateOf(id, "socket")).state).toBe("UNRESOLVED");
    expect((await stateOf(id, "shutoff")).state).toBe("UNRESOLVED");
    expect((await stateOf(id, "water")).state).toBe("SATISFIED");
    const rows = await prisma.$queryRaw<{ code: string; action: string; actor_type: string | null; reason: string | null }[]>`
      SELECT code, action, actor_type, reason FROM booking_requirement_audit WHERE booking_id = ${id} AND action = 'PARTNER_REASSIGNED' ORDER BY code`;
    expect(rows.map((r) => [r.code, r.actor_type])).toEqual([["shutoff", "admin"], ["socket", "admin"]]);
    expect(rows[0]!.reason).toContain("partner unavailable");
    expect((await start(id)).status).toBe(409);
    // Idempotent: nothing left to reset.
    expect(await bookingRequirementService.resetPartnerChecksAfterReassignment({ bookingId: id, adminId: ctx.superAdmin.id, reason: "again" })).toBe(0);
  });

  test("the audit is append-only below the application", async () => {
    if (!dbOk) return;
    await expect(Promise.resolve(prisma.$executeRaw`UPDATE booking_requirement_audit SET to_state = 'SATISFIED' WHERE id = (SELECT max(id) FROM booking_requirement_audit)`)).rejects.toThrow(/append-only/);
  });
});
