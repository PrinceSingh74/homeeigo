/**
 * Phase D — customer age policy end to end on the isolated test DB, through the real routes.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { BOOKING_CREATE_PATH, withQuoteToken } from "./helpers/quote-token";

const RUN = `p10age-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
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

/** YYYY-MM-DD `years` before today's IST date (28 Feb stands in for 29 Feb). */
function yearsAgo(years: number): string {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("-");
  const dd = m === "02" && d === "29" ? "28" : d;
  return `${Number(y) - years}-${m}-${dd}`;
}

async function configure(customerPolicy: unknown) {
  const r = await call("PUT", `/api/admin/services/${ctx.serviceId}`, {
    pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250,
    catalogConfig: {
      materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED", coverage: { pincodes: [] },
      quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
      variants: [{ id: "fabric", name: "Fabric", price: 250 }], variantRequired: true, addons: [],
      ...(customerPolicy ? { customerPolicy } : {}),
    },
  }, admin());
  if (r.status !== 200) throw new Error(`service: ${r.status} ${JSON.stringify(r.json)}`);
}

function bookBody(extra: Record<string, unknown> = {}) {
  hoursAhead += 24;
  return { serviceId: ctx.serviceId, addressId: ctx.addressAId, variantId: "fabric", quantity: 2, scheduledDate: futureSlot(hoursAhead).toISOString(), ...extra };
}
const bookingId = (r: Res): string => r.json.data.booking?.id ?? r.json.data.id;

type Row = { id: bigint; booking_id: string | null; mode: string; outcome: string; reason_code: string; inputs: any; policy_version: string };
const rows = () => prisma.$queryRaw<Row[]>`SELECT id, booking_id, mode, outcome, reason_code, inputs, policy_version FROM customer_policy_decisions WHERE customer_id = ${ctx.customerA.id} ORDER BY id`;
const lastRow = async () => (await rows()).at(-1)!;
const setDobDirect = (value: string) => prisma.user.update({ where: { id: ctx.customerA.id }, data: { dateOfBirth: new Date(`${value}T00:00:00Z`) } });

const DOB_15 = () => yearsAgo(15);
const DOB_30 = () => yearsAgo(30);
const DOB_16 = () => yearsAgo(16);

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  await prisma.user.update({ where: { id: ctx.customerA.id }, data: { dateOfBirth: null } });
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  // Test-only, isolated DB: the decision log is append-only by trigger (and its booking FK is
  // ON DELETE SET NULL, which the trigger also refuses), so fixture cleanup bypasses triggers.
  const ids = [ctx.customerA.id, ctx.customerB.id];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.$executeRaw`DELETE FROM customer_policy_decisions WHERE customer_id = ANY(${ids})`;
  }).catch((e) => console.warn("decision cleanup", e));
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("Phase D — customer age policy through the real routes", () => {
  test("a service with no age policy books without a DOB and records no decision", async () => {
    if (!dbOk) return;
    await configure(null);
    const r = await call("POST", "/api/bookings", bookBody(), customer());
    expect(r.status).toBe(201);
    const snap = (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId(r) }, select: { serviceConfigSnapshot: true } })).serviceConfigSnapshot as any;
    expect(snap.customerPolicy).toBeNull();
    expect(await rows()).toHaveLength(0);
  });

  test("mode NONE books with no DOB; NOT_APPLICABLE decision recorded with the booking", async () => {
    if (!dbOk) return;
    await configure({ age: { mode: "NONE" }, version: 1 });
    const r = await call("POST", "/api/bookings", bookBody(), customer());
    expect(r.status).toBe(201);
    const row = await lastRow();
    expect(row).toMatchObject({ booking_id: bookingId(r), mode: "NONE", outcome: "NOT_APPLICABLE", reason_code: "AGE_POLICY_NONE", policy_version: "customer-policy.v1" });
    expect(row.inputs).toEqual({ ageKnown: false, ageYears: null, guardianAttested: false });
  });

  test("an admin cannot publish MINIMUM_AGE without a minimumAge (no legal age assumed)", async () => {
    if (!dbOk) return;
    await expect(configure({ age: { mode: "ADULT_ONLY" } })).rejects.toThrow(/service: 4\d\d/);
  });

  test("MINIMUM_AGE without a DOB: quote explains, create refuses 422 AGE_VERIFICATION_REQUIRED and records the refusal", async () => {
    if (!dbOk) return;
    await configure({ age: { mode: "MINIMUM_AGE", minimumAge: 16 }, version: 2 });
    const before = (await rows()).length;
    const q = await call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, variantId: "fabric", quantity: 2, addressId: ctx.addressAId }, customer());
    expect(q.status).toBe(200);
    expect(q.json.data.customerPolicy).toMatchObject({ outcome: "REFUSED", reasonCode: "AGE_VERIFICATION_REQUIRED", dateOfBirthSet: false, policy: { mode: "MINIMUM_AGE", minimumAge: 16 } });
    expect((await rows()).length).toBe(before); // the quote is read-only

    const bookingsBefore = await prisma.booking.count({ where: { userId: ctx.customerA.id } });
    const r = await call("POST", "/api/bookings", bookBody(), customer());
    expect(r.status).toBe(422);
    expect(r.json.success).toBe(false);
    expect(r.json.code).toBe("AGE_VERIFICATION_REQUIRED");
    expect(r.json.error).toContain("date of birth");
    expect(await prisma.booking.count({ where: { userId: ctx.customerA.id } })).toBe(bookingsBefore);
    const row = await lastRow();
    expect(row).toMatchObject({ booking_id: null, outcome: "REFUSED", reason_code: "AGE_VERIFICATION_REQUIRED", mode: "MINIMUM_AGE" });
  });

  test("customer records a DOB once (value never echoed); below the minimum → 403 AGE_BELOW_MINIMUM", async () => {
    if (!dbOk) return;
    expect((await call("PUT", "/api/users/me/date-of-birth", { dateOfBirth: "2999-01-01" }, customer())).json.code).toBe("DOB_IN_FUTURE");
    expect((await call("PUT", "/api/users/me/date-of-birth", { dateOfBirth: "2001-02-30" }, customer())).json.code).toBe("DOB_INVALID");
    const set = await call("PUT", "/api/users/me/date-of-birth", { dateOfBirth: DOB_15() }, customer());
    expect(set.status).toBe(200);
    expect(JSON.stringify(set.json)).not.toContain(DOB_15());
    const me = await call("GET", "/api/users/me", undefined, customer());
    expect(me.json.data.user.dateOfBirthSet).toBe(true);
    expect(JSON.stringify(me.json)).not.toContain(DOB_15());
    expect(JSON.stringify(me.json)).not.toContain("dateOfBirth\":");

    const r = await call("POST", "/api/bookings", bookBody(), customer());
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("AGE_BELOW_MINIMUM");
    expect(await lastRow()).toMatchObject({ booking_id: null, outcome: "REFUSED", reason_code: "AGE_BELOW_MINIMUM", inputs: { ageKnown: true, ageYears: 15, guardianAttested: false } });

    // The audit entry names the event, never the value.
    const logs = await prisma.activityLog.findMany({ where: { userId: ctx.customerA.id, action: "CUSTOMER_DOB_RECORDED" }, select: { description: true } });
    expect(logs.length).toBe(1);
    expect(logs[0]!.description ?? "").not.toContain(DOB_15());
  });

  test("a second, different DOB is 409 DOB_LOCKED; the same value is an idempotent 200; partners cannot use the route", async () => {
    if (!dbOk) return;
    const again = await call("PUT", "/api/users/me/date-of-birth", { dateOfBirth: DOB_30() }, customer());
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("DOB_LOCKED");
    const same = await call("PUT", "/api/users/me/date-of-birth", { dateOfBirth: DOB_15() }, customer());
    expect(same.status).toBe(200);
    expect(same.json.data.changed).toBe(false);
    expect((await call("PUT", "/api/users/me/date-of-birth", { dateOfBirth: DOB_30() }, partner())).status).toBe(403);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { dateOfBirth: true } });
    expect(u.dateOfBirth!.toISOString().slice(0, 10)).toBe(DOB_15());
  });

  test("support corrects the DOB (reason required, customer cannot use the admin route); above the minimum books", async () => {
    if (!dbOk) return;
    const path = `/api/admin/users/${ctx.customerA.id}/date-of-birth`;
    expect((await call("PUT", path, { dateOfBirth: DOB_30(), reason: "ID checked by support" }, customer())).status).toBe(403);
    expect([400, 422]).toContain((await call("PUT", path, { dateOfBirth: DOB_30() }, admin())).status);
    const ok = await call("PUT", path, { dateOfBirth: DOB_30(), reason: "ID checked by support" }, admin());
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.json)).not.toContain(DOB_30());

    const r = await call("POST", "/api/bookings", bookBody(), customer());
    expect(r.status).toBe(201);
    const id = bookingId(r);
    expect(await lastRow()).toMatchObject({ booking_id: id, outcome: "ALLOWED", reason_code: "AGE_ALLOWED", inputs: { ageKnown: true, ageYears: 30, guardianAttested: false } });
    const snap = (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { serviceConfigSnapshot: true } })).serviceConfigSnapshot as any;
    expect(snap.customerPolicy).toEqual({ age: { mode: "MINIMUM_AGE", minimumAge: 16 }, version: 2 });

    // Partners never see the DOB, the age, or the policy decision.
    await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED" } });
    const p = await call("GET", `/api/bookings/${id}`, undefined, partner());
    expect(p.status).toBe(200);
    const body = JSON.stringify(p.json);
    for (const needle of [DOB_30(), "dateOfBirth", "date_of_birth", "ageYears", "customerPolicy", "guardianAttested"]) expect(body).not.toContain(needle);
  });

  test("GUARDIAN_REQUIRED: a minor is refused without an attestation and books with one (recorded as an attestation)", async () => {
    if (!dbOk) return;
    await configure({ age: { mode: "GUARDIAN_REQUIRED", guardianMinimumAge: 18 }, version: 3 });
    await setDobDirect(DOB_16());
    const refused = await call("POST", "/api/bookings", bookBody(), customer());
    expect(refused.status).toBe(422);
    expect(refused.json.code).toBe("GUARDIAN_ATTESTATION_REQUIRED");
    expect(await lastRow()).toMatchObject({ outcome: "REFUSED", reason_code: "GUARDIAN_ATTESTATION_REQUIRED", inputs: { ageYears: 16, guardianAttested: false } });

    const q = await call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, variantId: "fabric", quantity: 2, addressId: ctx.addressAId, guardianAttested: true }, customer());
    expect(q.json.data.customerPolicy).toMatchObject({ outcome: "ALLOWED", reasonCode: "AGE_ALLOWED" });

    const ok = await call("POST", "/api/bookings", bookBody({ guardianAttested: true }), customer());
    expect(ok.status).toBe(201);
    expect(await lastRow()).toMatchObject({ booking_id: bookingId(ok), outcome: "ALLOWED", inputs: { ageYears: 16, guardianAttested: true }, policy_version: "customer-policy.v3" });
  });

  test("no decision row ever contains the date of birth; the log is append-only", async () => {
    if (!dbOk) return;
    const all = await rows();
    expect(all.length).toBeGreaterThanOrEqual(6);
    const text = JSON.stringify(all.map((r) => ({ ...r, id: Number(r.id) })));
    for (const d of [DOB_15(), DOB_16(), DOB_30()]) expect(text).not.toContain(d);
    for (const r of all) expect(Object.keys(r.inputs).sort()).toEqual(["ageKnown", "ageYears", "guardianAttested"]);
    const target = all[0]!.id;
    await expect((async () => prisma.$executeRaw`UPDATE customer_policy_decisions SET outcome = 'ALLOWED' WHERE id = ${target}`)()).rejects.toThrow(/append-only/);
    await expect((async () => prisma.$executeRaw`DELETE FROM customer_policy_decisions WHERE id = ${target}`)()).rejects.toThrow(/append-only/);
  });

  test("admin decision list (USERS READ) carries no DOB; customers and partners cannot read it", async () => {
    if (!dbOk) return;
    const path = `/api/admin/customer-policy/decisions?customerId=${ctx.customerA.id}&serviceId=${ctx.serviceId}`;
    const r = await call("GET", path, undefined, admin());
    expect(r.status).toBe(200);
    expect(r.json.data.deployed).toBe(true);
    expect(r.json.data.decisions.length).toBe((await rows()).length);
    const text = JSON.stringify(r.json);
    for (const d of [DOB_15(), DOB_16(), DOB_30(), "dateOfBirth"]) expect(text).not.toContain(d);
    expect([401, 403]).toContain((await call("GET", path, undefined, customer())).status);
    expect([401, 403]).toContain((await call("GET", path, undefined, partner())).status);
  });

  test("a refusal is never 201 success, whatever the policy code", async () => {
    if (!dbOk) return;
    await configure({ age: { mode: "ADULT_ONLY", adultAge: 40 } });
    const r = await call("POST", "/api/bookings", bookBody(), customer());
    expect(r.status).toBe(403);
    expect(r.json.success).toBe(false);
    expect(r.json.code).toBe("ADULT_REQUIRED");
  });
});
