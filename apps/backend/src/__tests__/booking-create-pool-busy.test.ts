/**
 * A booking that could not be created because the database was busy is a RETRYABLE refusal.
 *
 * Found by the coding-phase operational certification (2026-09-27): ten concurrent booking creates
 * against the isolated backend returned `400 POOL_BUSY` — the service's transaction retries on
 * serialization conflicts / pool exhaustion had run out, and the create route has no branch for that
 * code, so its fail-closed catch-all answered 400. A 400 tells every client the request itself is
 * wrong and must not be retried. Reschedule already maps the same service error to 429 with
 * Retry-After; create now does the same.
 *
 * `bookingService.create` is replaced for the duration of each test (it is an object method, not an
 * ESM binding), so the route's mapping is exercised without having to manufacture contention.
 */
import "../load-env";
import { afterEach, describe, expect, test } from "bun:test";
import app from "../index";
import { bookingService } from "../services/booking.service";
import { JWTService } from "../services/jwt.service";
import prisma from "../lib/prisma";
import { provenanceForNewUser } from "../lib/data-provenance";

const original = bookingService.create.bind(bookingService);
afterEach(() => {
  (bookingService as { create: typeof bookingService.create }).create = original;
});

async function customerToken() {
  const email = `pbusy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.test`;
  const u = await prisma.user.create({
    data: {
      ...provenanceForNewUser(email),
      email,
      phoneNumber: `+9172${Math.floor(1e7 + Math.random() * 8e7)}`,
      firstName: "Pool",
      lastName: "Busy",
      password: "x".repeat(20),
      role: "CUSTOMER",
      isEmailVerified: true,
      walletBalance: 0,
    } as never,
  });
  return new JWTService().generateAccessToken({ userId: u.id, email });
}

async function postBooking(token: string) {
  const res = await app.handle(
    new Request("http://localhost/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ serviceId: "svc_any", addressId: "addr_any", scheduledDate: new Date(Date.now() + 5 * 86_400_000).toISOString() }),
    }),
  );
  return { status: res.status, retryAfter: res.headers.get("retry-after"), json: (await res.json()) as { success: boolean; code?: string } };
}

describe("booking create under database contention", () => {
  test("POOL_BUSY is a 429 with Retry-After, not a permanent 400", async () => {
    const token = await customerToken();
    (bookingService as { create: unknown }).create = async () => ({ error: "POOL_BUSY" as const });
    const r = await postBooking(token);
    expect(r.status).toBe(429);
    expect(r.retryAfter).toBe("3");
    expect(r.json.success).toBe(false);
    expect(r.json.code).toBe("POOL_BUSY");
  }, 60_000);

  test("control: an unmapped refusal still fails closed as 400 (never 201)", async () => {
    const token = await customerToken();
    (bookingService as { create: unknown }).create = async () => ({ error: "SOMETHING_NEW" });
    const r = await postBooking(token);
    expect(r.status).toBe(400);
    expect(r.json.success).toBe(false);
    expect(r.json.code).toBe("SOMETHING_NEW");
  }, 60_000);
});
