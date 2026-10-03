/**
 * Release certification Ph20 — object-level authorization over real HTTP (`app.handle`).
 *
 * Every case is attacker-vs-victim with a VALID token for the attacker, and every refusal is
 * followed by a DB read proving the victim's row did not change. A 4xx alone is not the claim;
 * "nothing moved" is.
 */
import "../load-env";
import { describe, it, expect, beforeAll } from "bun:test";
import app from "../index";
import prisma from "../lib/prisma";
import { JWTService } from "../services/jwt.service";
import { seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";

const jwt = new JWTService();
const tok = (u: { id: string; email: string | null }) => jwt.generateAccessToken({ userId: u.id, email: u.email! });

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, text: await res.text() };
}

let A: AdvCtx; // provider A + customers A/B + admins
let B: AdvCtx; // an unrelated provider B
let bookingId: string;
let paymentId: string;

beforeAll(async () => {
  A = await seedAdversarialFixtures(`idor-a-${Date.now().toString(36)}`);
  B = await seedAdversarialFixtures(`idor-b-${Date.now().toString(36)}`);
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `IDOR-${A.runId}`,
      userId: A.customerA.id,
      serviceId: A.serviceId,
      addressId: A.addressAId,
      providerId: A.providerId,
      status: "ACCEPTED",
      scheduledDate: new Date(Date.now() + 72 * 3_600_000),
      baseAmount: 500,
      taxes: 50,
      finalAmount: 550,
      totalAmount: 550,
      paymentStatus: "PENDING",
    },
  });
  bookingId = booking.id;
  const payment = await prisma.payment.create({
    data: { bookingId, userId: A.customerA.id, amount: 550, currency: "INR", status: "PENDING", paymentMethod: "razorpay", razorpayOrderId: `order_idor_${A.runId}`, idempotencyKey: `idor-${A.runId}` },
  });
  paymentId = payment.id;
});

const snapshotBooking = () =>
  prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { status: true, providerId: true, paymentStatus: true, updatedAt: true } });

describe("customer B against customer A's resources", () => {
  it("cannot read A's booking", async () => {
    const r = await call("GET", `/api/bookings/${bookingId}`, tok(A.customerB));
    expect([403, 404]).toContain(r.status);
    expect(r.text).not.toContain(A.customerA.id); // no leak of the owner in the refusal
  });

  it("cannot cancel A's booking, and the booking does not move", async () => {
    const before = await snapshotBooking();
    const r = await call("POST", `/api/bookings/${bookingId}/cancel`, tok(A.customerB), { reason: "idor" });
    expect([403, 404]).toContain(r.status);
    expect(await snapshotBooking()).toEqual(before);
  });

  it("cannot open a payment order on A's booking", async () => {
    const orders = await prisma.payment.count({ where: { bookingId } });
    const r = await call("POST", "/api/payments/create-order", tok(A.customerB), { bookingId });
    expect([403, 404]).toContain(r.status);
    expect(await prisma.payment.count({ where: { bookingId } })).toBe(orders);
  });

  it("cannot read A's payment", async () => {
    const r = await call("GET", `/api/payments/${paymentId}`, tok(A.customerB));
    expect([403, 404]).toContain(r.status);
  });

  it("cannot edit or delete A's address", async () => {
    const before = await prisma.address.findUniqueOrThrow({ where: { id: A.addressAId } });
    const put = await call("PUT", `/api/users/addresses/${A.addressAId}`, tok(A.customerB), { label: "pwned" });
    const del = await call("DELETE", `/api/users/addresses/${A.addressAId}`, tok(A.customerB));
    const def = await call("POST", `/api/users/addresses/${A.addressAId}/set-default`, tok(A.customerB));
    for (const r of [put, del, def]) expect([403, 404]).toContain(r.status);
    const after = await prisma.address.findUniqueOrThrow({ where: { id: A.addressAId } });
    expect({ label: after.label, userId: after.userId, isDefault: after.isDefault, deletedAt: (after as { deletedAt?: unknown }).deletedAt })
      .toEqual({ label: before.label, userId: before.userId, isDefault: before.isDefault, deletedAt: (before as { deletedAt?: unknown }).deletedAt });
  });
});

describe("partner B against partner A's job", () => {
  /**
   * Each action is attempted from the state in which partner A COULD perform it, and only 403/404 is
   * accepted — so the refusal can only be ownership. (A first version used one ACCEPTED booking and
   * "any 4xx", which the state machine or body validation alone would have satisfied — independent
   * review, 2026-09-20.)
   */
  const cases: Array<{ action: string; from: "ACCEPTED" | "EN_ROUTE" | "IN_PROGRESS"; arrived?: boolean }> = [
    { action: "en-route", from: "ACCEPTED" },
    { action: "arrived", from: "EN_ROUTE" },
    { action: "start", from: "EN_ROUTE", arrived: true },
    { action: "complete", from: "IN_PROGRESS", arrived: true },
  ];
  for (const c of cases) {
    it(`cannot ${c.action} a job assigned to partner A (from ${c.from})`, async () => {
      await prisma.booking.update({
        where: { id: bookingId },
        data: { status: c.from, enRouteAt: null, arrivedAt: c.arrived ? new Date() : null },
      });
      const before = await snapshotBooking();
      const vendorB = await prisma.user.findUniqueOrThrow({ where: { id: B.vendorUserId } });
      const r = await call("POST", `/api/bookings/${bookingId}/${c.action}`, tok(vendorB), {
        latitude: 19.076, longitude: 72.8777, otp: "0000",
      });
      expect([403, 404]).toContain(r.status);
      expect(await snapshotBooking()).toEqual(before);
    });
  }

  it("positive control: partner A CAN take the same action from the same state", async () => {
    await prisma.booking.update({ where: { id: bookingId }, data: { status: "ACCEPTED", arrivedAt: null, enRouteAt: null } });
    const vendorA = await prisma.user.findUniqueOrThrow({ where: { id: A.vendorUserId } });
    const r = await call("POST", `/api/bookings/${bookingId}/en-route`, tok(vendorA), { latitude: 19.076, longitude: 72.8777 });
    expect(r.status).toBe(200);
    expect((await snapshotBooking()).status).toBe("EN_ROUTE");
    await prisma.booking.update({ where: { id: bookingId }, data: { status: "ACCEPTED" } });
  });

  it("cannot read the customer contact of partner A's job", async () => {
    const vendorB = await prisma.user.findUniqueOrThrow({ where: { id: B.vendorUserId } });
    const r = await call("GET", `/api/bookings/${bookingId}/contact`, tok(vendorB));
    expect([403, 404]).toContain(r.status);
  });
});

describe("role and account state", () => {
  it("a customer token is refused on admin routes", async () => {
    const r = await call("GET", "/api/admin/users", tok(A.customerA));
    expect([401, 403]).toContain(r.status);
  });

  it("a deactivated account's still-unexpired token is refused", async () => {
    await prisma.user.update({ where: { id: A.customerB.id }, data: { isActive: false } });
    try {
      const r = await call("GET", "/api/users/addresses", tok(A.customerB));
      expect([401, 403]).toContain(r.status);
    } finally {
      await prisma.user.update({ where: { id: A.customerB.id }, data: { isActive: true } });
    }
  });

  it("an admin demoted to CUSTOMER loses admin access with the token minted while admin", async () => {
    const admin = A.supportAdmin;
    const token = tok(admin);
    const ok = await call("GET", "/api/admin/support/tickets", token);
    expect(ok.status).toBeLessThan(400);
    const role = admin.role;
    await prisma.user.update({ where: { id: admin.id }, data: { role: "CUSTOMER" } });
    try {
      const r = await call("GET", "/api/admin/support/tickets", token);
      expect([401, 403]).toContain(r.status);
    } finally {
      await prisma.user.update({ where: { id: admin.id }, data: { role } });
    }
  });
});
