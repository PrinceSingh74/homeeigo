/**
 * Phase 10 §9 — safety operations, found on the emulator 2026-09-29:
 *
 *  X-55  no admin route PLACED a hold (only partners could raise one, although the table's `source`
 *        CHECK already allows ADMIN); and a release answered `{ released: true }` with no word that the
 *        linked incident still blocks START, so the admin believed the job was clear.
 *  X-60  a released hold (and a resolved incident) was never pushed: the partner's job screen kept Start
 *        disabled until it was reopened. Raising a hold published `execution.blocked`; nothing
 *        published the reverse.
 *
 * Through the real routes on the isolated test DB; frames are observed on the booking room.
 */
import "../load-env";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { roomManager } from "../lib/websocket";
import { partnerSafetyService } from "../services/partner-safety.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { BOOKING_CREATE_PATH, withQuoteToken } from "./helpers/quote-token";

const RUN = `x55x60-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let addr: { latitude: number; longitude: number };
let hoursAhead = 90;

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

async function book(): Promise<string> {
  hoursAhead += 24;
  const r = await call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 2, scheduledDate: futureSlot(hoursAhead).toISOString() }, customer());
  if (r.status !== 201) throw new Error(`book: ${r.status} ${JSON.stringify(r.json)}`);
  const id: string = r.json.data.booking?.id ?? r.json.data.id;
  await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date() } });
  return id;
}
const start = (id: string) => call("POST", `/api/bookings/${id}/start`, { latitude: addr.latitude, longitude: addr.longitude }, partner());
const place = (id: string, body: Record<string, unknown>, token = admin()) => call("POST", `/api/admin/bookings/${id}/safety/holds`, body, token);
const holdRows = (id: string) => prisma.$queryRaw<Array<{ id: bigint; source: string; raised_by_role: string; state: string; condition: string; note: string | null }>>`SELECT id, source, raised_by_role, state, condition, note FROM booking_safety_holds WHERE booking_id = ${id} ORDER BY id`;

/** booking.requirement frames broadcast on the booking room, captured while the spy is active. */
let frames: Array<{ bookingId: string; event: string; code: string | null; state: string | null; gate: { ok: boolean; blocking: unknown[] } }> = [];
let spy: ReturnType<typeof spyOn> | null = null;
function capture() {
  frames = [];
  spy = spyOn(roomManager, "broadcast").mockImplementation(((room: string, msg: { type?: string; data?: any }) => {
    if (room.startsWith("booking:") && msg?.type === "booking.requirement") frames.push(msg.data);
    return 0;
  }) as never);
}
async function frameFor(id: string, event: string) {
  for (let i = 0; i < 40; i++) {
    const f = frames.find((x) => x.bookingId === id && x.event === event);
    if (f) return f;
    await Bun.sleep(50);
  }
  return null;
}
afterEach(() => { spy?.mockRestore(); spy = null; });

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
  const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, {
    pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250,
    catalogConfig: {
      materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED", coverage: { pincodes: [] },
      quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
      variants: [{ id: "fabric", name: "Fabric", price: 250 }], variantRequired: true, addons: [],
      safety: { prohibitedConditions: ["Gas smell in the room"], warnings: ["Keep children away from the work area"], emergencyProtocol: "Leave the room and call 112." },
    },
    changeReason: "x55/x60 test service",
  }, admin());
  if (r.status !== 200) throw new Error(`service: ${JSON.stringify(r.json)}`);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.partnerSafetyIncident.deleteMany({ where: { providerId: ctx.providerId } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("X-55: safety operations place a hold", () => {
  let id = "";

  test("only an admin places a hold; a condition and a reason are required", async () => {
    if (!dbOk) return;
    id = await book();
    expect((await place(id, { condition: "Customer reported a threat", reason: "call from customer" }, partner())).status).toBe(403);
    expect((await place(id, { condition: "Customer reported a threat", reason: "call from customer" }, customer())).status).toBe(403);
    expect((await place(id, { condition: "Customer reported a threat", reason: "x" })).status).toBe(400);
    expect((await place(id, { condition: "", reason: "call from customer" })).status).toBe(400);
    expect(await holdRows(id)).toHaveLength(0);
  });

  test("an admin hold is ACTIVE, attributed to ADMIN, blocks START, shows on the partner's /actions, and is pushed", async () => {
    if (!dbOk) return;
    capture();
    const r = await place(id, { condition: "Customer reported a threat", reason: "call from customer at 10:40" });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.data).toMatchObject({ changed: true, gate: { ok: false } });
    const rows = await holdRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "ADMIN", raised_by_role: "ADMIN", state: "ACTIVE", condition: "Customer reported a threat", note: "call from customer at 10:40" });
    const f = await frameFor(id, "execution.blocked");
    expect(f?.gate.ok).toBe(false);
    expect(f?.code).toBe("safety");
    const blocked = await start(id);
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe("SAFETY_HOLD_ACTIVE");
    const actions = await call("GET", `/api/bookings/${id}/actions`, undefined, partner());
    expect(actions.json.data.safetyGate.ok).toBe(false);
  });

  test("placing the same condition again is idempotent", async () => {
    if (!dbOk) return;
    const again = await place(id, { condition: "Customer reported a threat", reason: "second call" });
    expect(again.status).toBe(200);
    expect(again.json.data.changed).toBe(false);
    expect(await holdRows(id)).toHaveLength(1);
  });

  test("the admin's internal reason is visible to safety operations only — the partner and customer see the condition, never the note", async () => {
    if (!dbOk) return;
    const p = await call("GET", `/api/bookings/${id}/safety`, undefined, partner());
    expect(p.status).toBe(200);
    expect(p.json.data.holds[0].condition).toBe("Customer reported a threat");
    expect(p.json.data.holds[0].note).toBeNull();
    expect(JSON.stringify(p.json)).not.toContain("call from customer at 10:40");
    const c = await call("GET", `/api/bookings/${id}/safety`, undefined, customer());
    expect(JSON.stringify(c.json)).not.toContain("call from customer at 10:40");
    const a = await call("GET", `/api/admin/bookings/${id}/safety`, undefined, admin());
    expect(a.json.data.holds[0].note).toBe("call from customer at 10:40");
  });

  test("the audit names the admin as the raiser", async () => {
    if (!dbOk) return;
    const view = await call("GET", `/api/admin/bookings/${id}/safety`, undefined, admin());
    expect(view.json.data.audit.map((a: { action: string; actor_type: string; actor_id: string }) => [a.action, a.actor_type, a.actor_id])).toEqual([["RAISED", "admin", ctx.superAdmin.id]]);
  });

  test("an admin hold with no incident is cleared by its release alone; the release says the gate is open and pushes it (X-60)", async () => {
    if (!dbOk) return;
    const [{ id: holdId }] = await holdRows(id);
    capture();
    const rel = await call("POST", `/api/admin/bookings/${id}/safety/holds/${holdId}/release`, { reason: "police confirmed no threat" }, admin());
    expect(rel.status).toBe(200);
    expect(rel.json.data).toMatchObject({ released: true, gate: { ok: true } });
    const f = await frameFor(id, "execution.unblocked");
    expect(f?.gate.ok).toBe(true);
    expect((await start(id)).status).toBe(200);
  });

  test("a finished or unknown booking cannot be put on hold", async () => {
    if (!dbOk) return;
    const done = await book();
    await prisma.booking.update({ where: { id: done }, data: { status: "CANCELLED_BY_USER" } });
    const r = await place(done, { condition: "Customer reported a threat", reason: "late report" });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("INVALID_STATUS");
    expect((await place("cm-no-such-booking-000000", { condition: "Customer reported a threat", reason: "late report" })).status).toBe(404);
  });
});

describe.serial("X-60: a partner-raised hold — release then incident resolve are each pushed with the gate they leave", () => {
  let id = "";

  test("release while the linked incident is still open: pushed, and both the push and the response say START is still blocked", async () => {
    if (!dbOk) return;
    id = await book();
    const raised = await call("POST", `/api/bookings/${id}/safety/prohibited-condition`, { condition: "Gas smell in the room" }, partner());
    expect(raised.status).toBe(200);
    const [{ id: holdId }] = await holdRows(id);
    capture();
    const rel = await call("POST", `/api/admin/bookings/${id}/safety/holds/${holdId}/release`, { reason: "gas board confirmed no leak" }, admin());
    expect(rel.status).toBe(200);
    expect(rel.json.data.released).toBe(true);
    expect(rel.json.data.gate.ok).toBe(false);
    expect(rel.json.data.gate.message).toContain("open safety incident");
    const f = await frameFor(id, "execution.blocked");
    expect(f).not.toBeNull();
    expect(f!.state).toBe("SAFETY_HOLD_RELEASED");
  });

  test("resolving the incident in its own queue pushes execution.unblocked and START is allowed", async () => {
    if (!dbOk) return;
    const inc = await prisma.partnerSafetyIncident.findFirstOrThrow({ where: { bookingId: id } });
    capture();
    await partnerSafetyService.resolve(inc.id, ctx.superAdmin.id, "verified safe by gas board");
    const f = await frameFor(id, "execution.unblocked");
    expect(f?.gate.ok).toBe(true);
    expect(f?.state).toBe("SAFETY_INCIDENT_RESOLVED");
    expect((await start(id)).status).toBe(200);
  });

  test("an incident with no booking resolves without publishing anything", async () => {
    if (!dbOk) return;
    const standalone = await partnerSafetyService.reportIssue({ providerId: ctx.providerId, userId: ctx.vendorUserId, type: "LOCATION_DANGER", notes: "standalone report" });
    capture();
    await partnerSafetyService.resolve(standalone.id, ctx.superAdmin.id, "checked");
    await Bun.sleep(300);
    expect(frames).toHaveLength(0);
  });
});
