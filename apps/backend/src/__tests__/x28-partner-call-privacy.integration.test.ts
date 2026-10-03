/**
 * X-28 — owner decision 2026-09-29 (privacy first): a partner never receives the customer's full phone
 * number. There is no masked-call relay yet, so partner → customer direct calling is withheld and the
 * partner is pointed at in-app chat; the partner sees the masked number only. (Customer → partner calling
 * is outside this decision and unchanged.)
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `x28-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let id = "";
let customerDigits = "";

async function call(method: string, path: string, body?: unknown, token?: string | null) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, text: await res.text() };
}
const partner = () => bearer({ id: ctx.vendorUserId, email: `${RUN}@partner.test` });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  const r = await call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressAId, quantity: 1, scheduledDate: futureSlot(230).toISOString() }, bearer(ctx.customerA));
  if (r.status !== 201) throw new Error(`book: ${r.status} ${r.text}`);
  const j = JSON.parse(r.text);
  id = j.data.booking?.id ?? j.data.id;
  await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS" } });
  // The customer's subscriber number (last 10 digits) as the fixture stored it — never to reach the partner.
  const { userPiiService } = await import("../services/user-pii.service");
  const u = await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { id: true, phoneNumber: true, phoneEncrypted: true } });
  customerDigits = ((await userPiiService.resolvePhone(u)) ?? "").replace(/\D/g, "").slice(-10);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("X-28: the partner never receives the customer's full phone number", () => {
  test("setup sanity: the fixture customer has a phone number", () => {
    if (!dbOk) return;
    expect(customerDigits).toHaveLength(10);
  });

  test("partner → customer direct call is withheld (no relay): 409 CALL_RELAY_UNAVAILABLE, no number, points to chat", async () => {
    if (!dbOk) return;
    const r = await call("POST", `/api/bookings/${id}/call`, {}, partner());
    expect(r.status).toBe(409);
    const j = JSON.parse(r.text);
    expect(j.code).toBe("CALL_RELAY_UNAVAILABLE");
    expect(j.data?.alternative).toBe("CHAT");
    expect(r.text).not.toContain("tel:");
    expect(r.text).not.toContain(customerDigits);
  });

  test("the partner's contact view shows the masked number only and canCall false", async () => {
    if (!dbOk) return;
    const r = await call("GET", `/api/bookings/${id}/contact`, undefined, partner());
    expect(r.status).toBe(200);
    const j = JSON.parse(r.text);
    expect(j.data.canCall).toBe(false);
    expect(j.data.callUnavailableReason).toBe("CALL_RELAY_UNAVAILABLE");
    expect(j.data.phoneMasked).toMatch(/•/);
    expect(r.text).not.toContain(customerDigits);
  });

  test("no partner-visible booking payload carries the full number", async () => {
    if (!dbOk) return;
    for (const path of [`/api/bookings/${id}`, `/api/bookings/${id}/actions`, "/api/providers/me/bookings?limit=50"]) {
      const r = await call("GET", path, undefined, partner());
      expect(r.status, path).toBe(200);
      expect(r.text, path).not.toContain(customerDigits);
    }
  });

  test("the withheld attempt is recorded without the number", async () => {
    if (!dbOk) return;
    const rows = await prisma.activityLog.findMany({ where: { bookingId: id, action: "CUSTOMER_CALL_WITHHELD" }, select: { description: true } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(rows)).not.toContain(customerDigits);
  });
});
