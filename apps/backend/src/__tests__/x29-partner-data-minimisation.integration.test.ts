/**
 * X-29 (partner exposure audit 2026-09-28, engineering part): a partner received data it has no use
 * for and that no partner client reads — the customer's refund amount / refund status / fee / tender
 * in the booking row and in realtime frames, raw evidence storage keys and raw media URLs, and the
 * internal assignment-job id in the offer push. Data minimisation, server side; the partner still
 * receives everything its apps render (status, payment gate, no-show fee confirmation, evidence
 * access URLs). Admin free-text wording is a product decision and is not changed here.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../lib/prisma";
import app from "../index";
import { roomManager, type WSConnection } from "../lib/websocket";
import { publishBookingStatus } from "../lib/booking-realtime";
import { CUSTOMER_MONEY_KEYS, partnerNeverSees, withoutCustomerMoney } from "../lib/privacy-policy.engine";
import { jobEvidenceService } from "../services/job-evidence.service";
import { bookingCaseService } from "../services/booking-case.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `x29-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let id = "";

async function call(method: string, path: string, token: string) {
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: { Authorization: `Bearer ${token}` } }));
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
  const quote = await app.handle(new Request("http://localhost/api/bookings/price-quote", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(ctx.customerA)}` },
    body: JSON.stringify({ serviceId: ctx.serviceId, addressId: ctx.addressAId, quantity: 1 }),
  }));
  const quoted = (await quote.json()) as { data?: { quote?: { quoteToken?: string } } };
  const r = await app.handle(new Request("http://localhost/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(ctx.customerA)}` },
    body: JSON.stringify({
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      quantity: 1,
      scheduledDate: futureSlot(250).toISOString(),
      quoteToken: quoted.data?.quote?.quoteToken,
    }),
  }));
  const j = (await r.json()) as { data: { booking?: { id: string }; id?: string } };
  if (r.status !== 201) throw new Error(`book: ${r.status}`);
  id = j.data.booking?.id ?? j.data.id ?? "";
  await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", refundAmount: 250, refundStatus: "processed" } });
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("X-29: partner payloads carry no customer-money or storage internals", () => {
  test("the privacy policy names the customer-money keys and strips them", () => {
    for (const k of ["refundAmount", "refundStatus", "cancellationFee", "refundMessage", "refundTender"]) {
      expect([...CUSTOMER_MONEY_KEYS] as string[]).toContain(k);
      expect(partnerNeverSees()).toContain(k);
    }
    expect(withoutCustomerMoney({ status: "cancelled", refundAmount: 10, refundStatus: "processed", cancelledBy: "customer" })).toEqual({ status: "cancelled", cancelledBy: "customer" });
  });

  test("GET /api/bookings/:id — the partner row has no refund fields; the customer's still does", async () => {
    if (!dbOk) return;
    const p = await call("GET", `/api/bookings/${id}`, partner());
    expect(p.status).toBe(200);
    const pb = JSON.parse(p.text).data.booking;
    expect(pb.status).toBeDefined();
    expect("refundAmount" in pb).toBe(false);
    expect("refundStatus" in pb).toBe(false);
    const c = await call("GET", `/api/bookings/${id}`, bearer(ctx.customerA));
    expect(JSON.parse(c.text).data.booking.refundAmount).toBe(250);
  });

  test("realtime: the partner's copy of a cancellation frame has no refund / fee fields; the customer's keeps them", async () => {
    if (!dbOk) return;
    const got: Record<string, unknown[]> = { customer: [], vendor: [] };
    const conn = (userId: string, userType: "customer" | "vendor"): WSConnection => ({
      userId, userType, connectionId: `${RUN}-${userType}`, connectedAt: new Date(), lastPing: new Date(), rooms: new Set(),
      close: () => undefined,
      send: (m: string) => { got[userType].push(JSON.parse(m)); },
    } as unknown as WSConnection);
    const customer = conn(ctx.customerA.id, "customer");
    const vendor = conn(ctx.vendorUserId, "vendor");
    roomManager.addToRoom(`booking:${id}`, customer);
    roomManager.addToRoom(`booking:${id}`, vendor);
    try {
      await publishBookingStatus({
        bookingId: id, status: "CANCELLED_BY_USER", userId: ctx.customerA.id, providerUserId: ctx.vendorUserId,
        extra: { cancelledBy: "customer", refundAmount: 250, refundStatus: "processed", cancellationFee: 40, refundMessage: "₹250 back to your wallet" },
      });
      const v = JSON.stringify(got.vendor);
      const cs = JSON.stringify(got.customer);
      expect(got.vendor.length).toBe(2); // booking room + partner's user envelope
      expect(got.customer.length).toBe(2);
      for (const k of ["refundAmount", "refundStatus", "cancellationFee", "refundMessage"]) expect(v).not.toContain(`"${k}"`);
      expect(v).toContain("cancelled_by_user");
      expect(v).toContain('"cancelledBy":"customer"');
      expect(cs).toContain('"refundAmount":250');
      expect(cs).toContain('"cancellationFee":40');
    } finally {
      roomManager.removeAllRooms(customer);
      roomManager.removeAllRooms(vendor);
    }
  });

  test("job evidence: a partner sees an access URL, never raw media URLs or storage keys in metadata", async () => {
    if (!dbOk) return;
    await jobEvidenceService.recordStage({ bookingId: id, providerId: ctx.providerId, stage: "START", metadata: { note: "gate code 12", mediaUrls: ["https://bucket.example/raw/abc.jpg"] } as never });
    const rows = await jobEvidenceService.listForBooking(id, { userId: ctx.vendorUserId, providerId: ctx.providerId, isAdmin: false } as never);
    const text = JSON.stringify(rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(text).not.toContain("bucket.example/raw");
    expect(text).not.toContain("mediaStorageKey\":\"");
    const admin = await jobEvidenceService.listForBooking(id, { userId: "admin", isAdmin: true } as never);
    expect(JSON.stringify(admin)).toContain("bucket.example/raw");
  });

  test("case evidence: only an admin sees the raw storage key", () => {
    const rows = [{ id: 1n, kind: "CUSTOMER_MEDIA", job_evidence_id: null, media_storage_key: "cases/raw/key.jpg", media_url: "/api/media/1", note: null, actor_type: "CUSTOMER", actor_id: "u1", created_at: new Date() }];
    const svc = bookingCaseService as unknown as { evidenceFor(a: string, r: typeof rows): Record<string, unknown>[] };
    expect(svc.evidenceFor("PARTNER", rows).some((e) => e.mediaStorageKey)).toBe(false);
    expect(svc.evidenceFor("CUSTOMER", rows).some((e) => e.mediaStorageKey)).toBe(false);
    expect(svc.evidenceFor("ADMIN", rows)[0].mediaStorageKey).toBe("cases/raw/key.jpg");
  });

  test("the offer push carries no internal assignment-job id", () => {
    const src = readFileSync(join(import.meta.dir, "..", "services", "assignment-engine.service.ts"), "utf8");
    expect(src).not.toMatch(/assignmentJobId:\s*jobId/);
  });

  // Last in the file: it cancels the shared booking.
  test("a partner who cancels the job is told it is cancelled, not what the customer gets back", async () => {
    if (!dbOk) return;
    const res = await app.handle(
      new Request(`http://localhost/api/bookings/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${partner()}` },
        body: JSON.stringify({ reason: "Vehicle broke down on the way" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { booking: Record<string, unknown> } };
    expect(body.data.booking.status).toBeDefined();
    for (const key of ["refundAmount", "refundStatus", "cancellationFee", "refundMessage"]) expect(key in body.data.booking).toBe(false);
  });
});
