/**
 * Phase 10 §9 — safety holds end to end on the isolated test DB, through the real routes.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { bookingRequirementService } from "../services/booking-requirement.service";
import { partnerSafetyService } from "../services/partner-safety.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { BOOKING_CREATE_PATH, withQuoteToken } from "./helpers/quote-token";

const RUN = `p10s9-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let addr: { latitude: number; longitude: number };
const itemIds: string[] = [];
let hoursAhead = 80;

type Res = { status: number; json: any };
async function call(method: string, path: string, body?: unknown, token?: string | null): Promise<Res> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  // Booking create requires a price quote (QUOTE_REQUIRED otherwise) — quote first, as a client does.
  if (method === "POST" && path === BOOKING_CREATE_PATH) body = await withQuoteToken(app, token, body);
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const customer = () => bearer(ctx.customerA);
const admin = () => bearer(ctx.superAdmin);
const partner = () => bearer({ id: ctx.vendorUserId, email: `${RUN}@partner.test` });

const SAFETY = {
  prohibitedConditions: ["Gas smell in the room", "Exposed live wiring"],
  warnings: ["Keep children away from the work area"],
  customerRequirements: ["Switch off the mains before the visit"],
  providerRequirements: ["Insulated gloves"],
  medicalDisclaimer: "This service is not medical treatment.",
  emergencyProtocol: "Leave the room and call 112.",
};

async function book(): Promise<string> {
  hoursAhead += 24;
  const r = await call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 2, scheduledDate: futureSlot(hoursAhead).toISOString() }, customer());
  if (r.status !== 201) throw new Error(`book: ${r.status} ${JSON.stringify(r.json)}`);
  const id: string = r.json.data.booking?.id ?? r.json.data.id;
  await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date() } });
  return id;
}
const start = (id: string) => call("POST", `/api/bookings/${id}/start`, { latitude: addr.latitude, longitude: addr.longitude }, partner());
const raise = (id: string, condition: string, token = partner()) => call("POST", `/api/bookings/${id}/safety/prohibited-condition`, { condition, note: "strong smell near the kitchen" }, token);

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
  const it = await call("POST", "/api/admin/requirement-items", { code: `${RUN}-mains`, kind: "CUSTOMER_PRECONDITION", name: "Mains switched off", customerLabel: "Mains switched off" }, admin());
  if (it.status !== 200) throw new Error(`item: ${JSON.stringify(it.json)}`);
  itemIds.push(it.json.data.item.id);
  const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, {
    pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250,
    catalogConfig: {
      materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED", coverage: { pincodes: [] },
      quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
      variants: [{ id: "fabric", name: "Fabric", price: 250 }], variantRequired: true, addons: [],
      safety: SAFETY,
      requirements: [{ id: "mains", itemCode: `${RUN}-mains`, responsibility: "CUSTOMER", enforcement: "REQUIRED_AT_START", verification: "PARTNER_CHECK" }],
    },
  }, admin());
  if (r.status !== 200) throw new Error(`service: ${JSON.stringify(r.json)}`);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.serviceRequirement.deleteMany({ where: { itemId: { in: itemIds } } }).catch(() => {});
  await prisma.partnerSafetyIncident.deleteMany({ where: { providerId: ctx.providerId } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
  await prisma.serviceRequirementItem.deleteMany({ where: { id: { in: itemIds } } }).catch(() => {});
}, 60_000);

describe.serial("§9 safety holds through the real routes", () => {
  let id = "";
  test("the booking freezes the service's safety rules; the customer sees warnings and disclaimer but not provider requirements", async () => {
    if (!dbOk) return;
    id = await book();
    const snap = (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { serviceConfigSnapshot: true } })).serviceConfigSnapshot as { safety: { schema: string; prohibitedConditions: string[] } };
    expect(snap.safety.schema).toBe("safety.v1");
    expect(snap.safety.prohibitedConditions).toEqual(SAFETY.prohibitedConditions);
    const c = await call("GET", `/api/bookings/${id}/safety`, undefined, customer());
    expect(c.json.data.safety).toMatchObject({ medicalDisclaimer: SAFETY.medicalDisclaimer, emergencyProtocol: SAFETY.emergencyProtocol });
    expect(JSON.stringify(c.json)).not.toContain("Insulated gloves");
    const p = await call("GET", `/api/bookings/${id}/safety`, undefined, partner());
    expect(p.json.data.canReport).toEqual(SAFETY.prohibitedConditions);
    expect((await call("GET", `/api/bookings/${id}/safety`, undefined, bearer(ctx.customerB))).status).toBe(404);
  });

  test("an unlisted condition is refused (report an incident instead); a customer cannot raise a hold", async () => {
    if (!dbOk) return;
    const r = await raise(id, "Something I made up");
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("CONDITION_NOT_CONFIGURED");
    expect([401, 403]).toContain((await raise(id, "Gas smell in the room", customer())).status);
  });

  test("raising a listed condition opens an incident in the existing queue and an ACTIVE hold; raising it again is idempotent", async () => {
    if (!dbOk) return;
    const r = await raise(id, "gas smell in the room");
    expect(r.status).toBe(200);
    expect(r.json.data.changed).toBe(true);
    const again = await raise(id, "Gas smell in the room");
    expect(again.json.data.changed).toBe(false);
    const holds = await prisma.$queryRaw<{ state: string; condition: string }[]>`SELECT state, condition FROM booking_safety_holds WHERE booking_id = ${id}`;
    expect(holds).toEqual([{ state: "ACTIVE", condition: "Gas smell in the room" }]);
    const incidents = await prisma.partnerSafetyIncident.findMany({ where: { bookingId: id }, select: { type: true, status: true } });
    expect(incidents).toEqual([{ type: "LOCATION_DANGER", status: "OPEN" }]);
  });

  test("precedence: START is refused with SAFETY_HOLD_ACTIVE even though a precondition is also unresolved", async () => {
    if (!dbOk) return;
    const r = await start(id);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("SAFETY_HOLD_ACTIVE");
    expect(r.json.error).toContain("Gas smell in the room");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true } })).status).toBe("ACCEPTED");
    const c = await call("GET", `/api/bookings/${id}/safety`, undefined, customer());
    expect(c.json.data.gate.ok).toBe(false);
    expect(c.json.data.holds).toEqual([{ condition: "Gas smell in the room" }]);
    expect(JSON.stringify(c.json)).not.toContain("strong smell near the kitchen");
  });

  test("X-51: while a hold stands, /actions disables Start with the safety message and a refused start leaves the customer's PIN unverified; ownership is checked before safety", async () => {
    if (!dbOk) return;
    const { bookingStartOtpService } = await import("../services/booking-start-otp.service");
    // A second job at the door with no PIN verified yet.
    const b2 = await book();
    const now = new Date();
    await prisma.booking.update({ where: { id: b2 }, data: { status: "EN_ROUTE", enRouteAt: now, arrivedAt: now, startOtpVerifiedAt: null } });
    const open = await call("GET", `/api/bookings/${b2}/actions`, undefined, partner());
    expect(open.json.data.safetyGate).toMatchObject({ ok: true, blocking: 0 });
    expect(open.json.data.requiredGates).not.toContain("SAFETY_CLEARED");
    expect((await raise(b2, "Exposed live wiring")).status).toBe(200);
    const held = await call("GET", `/api/bookings/${b2}/actions`, undefined, partner());
    expect(held.json.data.safetyGate).toMatchObject({ ok: false });
    expect(held.json.data.requiredGates).toContain("SAFETY_CLEARED");
    expect(held.json.data.disabledReasons.START_SERVICE).toContain("safety hold");
    // The correct PIN, refused by the hold: nothing is recorded as verified.
    expect((await bookingStartOtpService.issue(ctx.providerId, b2)).ok).toBe(true);
    const view = await bookingStartOtpService.customerView(ctx.customerA.id, b2);
    if (!view.ok || !view.pin) throw new Error(`no pin: ${JSON.stringify(view)}`);
    const r = await call("POST", `/api/bookings/${b2}/start`, { latitude: addr.latitude, longitude: addr.longitude, otp: view.pin }, partner());
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("SAFETY_HOLD_ACTIVE");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b2 }, select: { startOtpVerifiedAt: true, status: true } }))).toEqual({ startOtpVerifiedAt: null, status: "EN_ROUTE" });
    // A booking this partner does not hold answers 404, never its safety state.
    const foreign = await book();
    await prisma.booking.update({ where: { id: foreign }, data: { providerId: null, status: "PENDING" } });
    await prisma.$executeRaw`INSERT INTO booking_safety_holds (booking_id, source, condition, raised_by_role, raised_by_id) VALUES (${foreign}, 'PROHIBITED_CONDITION', 'Gas smell in the room', 'ADMIN', ${ctx.superAdmin.id})`;
    const f = await call("POST", `/api/bookings/${foreign}/start`, { latitude: addr.latitude, longitude: addr.longitude }, partner());
    expect(f.status).toBe(404);
    expect(JSON.stringify(f.json)).not.toContain("Gas smell");
  });

  test("only an admin releases a hold, with a reason; partners and customers cannot", async () => {
    if (!dbOk) return;
    const [{ id: holdId }] = await prisma.$queryRaw<{ id: bigint }[]>`SELECT id FROM booking_safety_holds WHERE booking_id = ${id}`;
    const path = `/api/admin/bookings/${id}/safety/holds/${holdId}/release`;
    expect((await call("POST", path, { reason: "checked" }, partner())).status).toBe(403);
    expect((await call("POST", path, { reason: "checked" }, customer())).status).toBe(403);
    expect((await call("POST", path, { reason: "x" }, admin())).status).toBe(400);
    // Defence in depth: the service refuses a blank reason on its own, not only the route schema.
    const { bookingSafetyService } = await import("../services/booking-safety.service");
    expect(await bookingSafetyService.adminRelease({ bookingId: id, holdId: Number(holdId), adminId: ctx.superAdmin.id, reason: "  x " })).toEqual({ ok: false, error: "REASON_REQUIRED" });
    const ok = await call("POST", path, { reason: "gas board confirmed no leak" }, admin());
    expect(ok.status).toBe(200);
    expect((await call("POST", path, { reason: "again please" }, admin())).json.code).toBe("HOLD_NOT_ACTIVE");
  });

  test("the linked incident still blocks START until safety operations resolve it in its own queue", async () => {
    if (!dbOk) return;
    const blocked = await start(id);
    expect(blocked.json.code).toBe("SAFETY_HOLD_ACTIVE");
    expect(blocked.json.data.blocking).toEqual([expect.objectContaining({ kind: "SAFETY_INCIDENT", type: "LOCATION_DANGER" })]);
    const inc = await prisma.partnerSafetyIncident.findFirstOrThrow({ where: { bookingId: id } });
    await partnerSafetyService.resolve(inc.id, ctx.superAdmin.id, "verified safe by gas board");
    // With safety clear, the next gate in precedence answers: the precondition.
    expect((await start(id)).json.code).toBe("REQUIREMENT_GATE_BLOCKED");
    await bookingRequirementService.partnerCheck({ bookingId: id, providerId: ctx.providerId, userId: ctx.vendorUserId, code: "mains", outcome: "SATISFIED", latitude: addr.latitude, longitude: addr.longitude });
    expect((await start(id)).status).toBe(200);
  });

  test("a hold raised mid-job stops completion", async () => {
    if (!dbOk) return;
    await raise(id, "Exposed live wiring");
    const r = await call("POST", `/api/bookings/${id}/complete`, { latitude: addr.latitude, longitude: addr.longitude }, partner());
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("SAFETY_HOLD_ACTIVE");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true } })).status).toBe("IN_PROGRESS");
  });

  test("the audit names every raise and release; released holds and the audit are immutable below the application", async () => {
    if (!dbOk) return;
    const view = await call("GET", `/api/admin/bookings/${id}/safety`, undefined, admin());
    expect(view.status).toBe(200);
    expect(view.json.data.audit.map((a: { action: string; condition: string; actor_type: string }) => [a.action, a.condition, a.actor_type])).toEqual([
      ["RAISED", "Gas smell in the room", "partner"],
      ["RELEASED", "Gas smell in the room", "admin"],
      ["RAISED", "Exposed live wiring", "partner"],
    ]);
    await expect(Promise.resolve(prisma.$executeRaw`UPDATE booking_safety_holds SET state = 'ACTIVE', released_by_id = NULL, released_at = NULL WHERE booking_id = ${id} AND state = 'RELEASED'`)).rejects.toThrow(/immutable/);
    await expect(Promise.resolve(prisma.$executeRaw`UPDATE booking_safety_audit SET action = 'X' WHERE booking_id = ${id}`)).rejects.toThrow(/append-only/);
  });
});
