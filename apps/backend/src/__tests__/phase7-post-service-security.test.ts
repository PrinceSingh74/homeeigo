/**
 * Phase 7, Step 7B/7C — security tests for the rebooking and satisfaction-intelligence routes.
 *
 * Real HTTP requests against the real app (`app.handle`), real seeded users/bookings, a real
 * admin-issued feature-flag row. No service function called directly and no auth bypassed —
 * exactly the path a real client hits.
 */
import "../load-env";
import { provenanceForNewUser } from "../lib/data-provenance";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import app from "../index";
import prisma from "../lib/prisma";
import { JWTService } from "../services/jwt.service";
import { PlatformIntelligenceService } from "../services/platform-intelligence.service";
import { invalidateFlagCache } from "../services/feature-flag.service";
import { LIVE_FIXTURE_SERVICE } from "./helpers/live-fixture-service";

const jwt = new JWTService();
const RUN_ID = `p7sec-${Date.now().toString(36)}`;
const platformIntel = new PlatformIntelligenceService();

async function dbReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

let dbOk = false;
let customerA: { id: string; email: string };
let customerB: { id: string; email: string };
let adminId: string;
let serviceId: string;
let providerId: string;
let bookingId: string;

function bearer(user: { id: string; email: string }): string {
  return jwt.generateAccessToken({ userId: user.id, email: user.email });
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  if (!admin) throw new Error("No real ADMIN user found — cannot exercise the hardened flag-write path");
  adminId = admin.id;

  const passwordHash = await Bun.password.hash("Phase7Sec@123", { algorithm: "bcrypt", cost: 4 });

  const a = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${RUN_ID}-a@p7sec.test`),
      email: `${RUN_ID}-a@p7sec.test`,
      phoneNumber: `+1666${Date.now().toString().slice(-7)}0`,
      firstName: "Customer",
      lastName: "A",
      password: passwordHash,
      role: "CUSTOMER",
      isEmailVerified: true,
    },
  });
  customerA = { id: a.id, email: a.email! };

  const b = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${RUN_ID}-b@p7sec.test`),
      email: `${RUN_ID}-b@p7sec.test`,
      phoneNumber: `+1666${Date.now().toString().slice(-7)}1`,
      firstName: "Customer",
      lastName: "B",
      password: passwordHash,
      role: "CUSTOMER",
      isEmailVerified: true,
    },
  });
  customerB = { id: b.id, email: b.email! };

  const vendor = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${RUN_ID}-vendor@p7sec.test`),
      email: `${RUN_ID}-vendor@p7sec.test`,
      phoneNumber: `+1666${Date.now().toString().slice(-7)}2`,
      firstName: "Vendor",
      lastName: "Test",
      password: passwordHash,
      role: "VENDOR",
      isEmailVerified: true,
    },
  });

  const provider = await prisma.provider.create({
    data: { userId: vendor.id, isApproved: true, isActive: true, serviceCategories: ["cleaning"] },
  });
  providerId = provider.id;

  const service = await prisma.service.create({
    data: { ...LIVE_FIXTURE_SERVICE,
      name: `P7Sec Service ${RUN_ID}`,
      slug: `p7sec-service-${RUN_ID}`,
      description: "Phase 7 security test fixture",
      category: "cleaning",
      basePrice: 400,
      estimatedDuration: 60,
      isActive: true,
    },
  });
  serviceId = service.id;

  const address = await prisma.address.create({
    data: {
      userId: customerA.id,
      label: "Test",
      addressLine1: "1 Test St",
      city: "Noida",
      state: "UP",
      zipCode: "201301",
      fullAddress: "1 Test St, Noida, UP 201301",
      latitude: 28.6,
      longitude: 77.3,
    },
  });

  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `P7SEC-${RUN_ID}`,
      userId: customerA.id,
      providerId,
      serviceId,
      addressId: address.id,
      status: BookingStatus.COMPLETED,
      scheduledDate: new Date(),
      completedAt: new Date(),
      baseAmount: 400,
      finalAmount: 400,
      totalAmount: 400,
      paymentStatus: PaymentStatus.SUCCESS,
      paymentMethod: "razorpay",
    },
  });
  bookingId = booking.id;

  await prisma.rating.create({
    data: { bookingId, userId: customerA.id, providerId, stars: 5 },
  });

  // Enable AI_REBOOKING and AI_SATISFACTION_INTELLIGENCE at 100% through the real hardened
  // admin write path, so the "enabled" branch of both routes is genuinely exercised too, not
  // only the fail-closed default.
  await platformIntel.upsertFlag(
    { key: "AI_REBOOKING", enabled: true, rolloutPct: 100, environment: process.env.APP_ENV || process.env.NODE_ENV || "development" },
    { adminId, userId: adminId },
    "Phase 7 Step 7B security test — enable for real-path coverage",
  );
  await platformIntel.upsertFlag(
    { key: "AI_SATISFACTION_INTELLIGENCE", enabled: true, rolloutPct: 100, environment: process.env.APP_ENV || process.env.NODE_ENV || "development" },
    { adminId, userId: adminId },
    "Phase 7 Step 7C security test — enable for real-path coverage",
  );
});

afterAll(async () => {
  if (!dbOk) return;
  await prisma.platformFeatureFlag.deleteMany({ where: { key: { in: ["AI_REBOOKING", "AI_SATISFACTION_INTELLIGENCE"] } } });
  await invalidateFlagCache("AI_REBOOKING");
  await invalidateFlagCache("AI_SATISFACTION_INTELLIGENCE");
  await prisma.rating.deleteMany({ where: { bookingId } });
  await prisma.booking.deleteMany({ where: { id: bookingId } });
  await prisma.service.deleteMany({ where: { id: serviceId } });
  await prisma.provider.deleteMany({ where: { id: providerId } });
  await prisma.user.deleteMany({
    where: { email: { in: [customerA?.email, customerB?.email, `${RUN_ID}-vendor@p7sec.test`].filter(Boolean) as string[] } },
  });
});

describe("Phase 7 Step 7B/7C — post-service intelligence security", () => {
  describe("Authentication", () => {
    test("rebooking: unauthenticated request is rejected (401)", async () => {
      if (!dbOk) return;
      const res = await app.handle(new Request("http://localhost/api/customer-intel/rebooking"));
      expect(res.status).toBe(401);
    });

    test("satisfaction: unauthenticated request is rejected (401)", async () => {
      if (!dbOk) return;
      const res = await app.handle(new Request(`http://localhost/api/customer-intel/satisfaction/${bookingId}`));
      expect(res.status).toBe(401);
    });
  });

  describe("Cross-customer isolation", () => {
    test("satisfaction: customer B cannot read customer A's booking signal (403)", async () => {
      if (!dbOk) return;
      const res = await app.handle(
        new Request(`http://localhost/api/customer-intel/satisfaction/${bookingId}`, {
          headers: { Authorization: `Bearer ${bearer(customerB)}` },
        }),
      );
      expect(res.status).toBe(403);
    });

    test("satisfaction: nonexistent booking returns 404, not a data leak", async () => {
      if (!dbOk) return;
      const res = await app.handle(
        new Request(`http://localhost/api/customer-intel/satisfaction/does-not-exist`, {
          headers: { Authorization: `Bearer ${bearer(customerA)}` },
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("Real-data behaviour (flags enabled)", () => {
    test("rebooking: owner gets real suggestions, IDOR-safe (uses token identity only)", async () => {
      if (!dbOk) return;
      const res = await app.handle(
        new Request("http://localhost/api/customer-intel/rebooking", {
          headers: { Authorization: `Bearer ${bearer(customerA)}` },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data.enabled).toBe(true);
      expect(body.data.rulesVersion).toBe("rules.v3");
      expect(Array.isArray(body.data.suggestions)).toBe(true);
    });

    test("satisfaction: owner gets real signal reflecting the seeded 5-star rating", async () => {
      if (!dbOk) return;
      const res = await app.handle(
        new Request(`http://localhost/api/customer-intel/satisfaction/${bookingId}`, {
          headers: { Authorization: `Bearer ${bearer(customerA)}` },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data.enabled).toBe(true);
      expect(body.data.signal.rating).toBe(5);
      expect(body.data.signal.bookingId).toBe(bookingId);
      expect(body.data.signal.customerId).toBe(customerA.id);
      // No support ticket was ever created for this booking — must report 0, not fabricate one.
      expect(body.data.signal.supportTicketCount).toBe(0);
      expect(body.data.signal.followupEligible).toBe(true);
    });
  });

  describe("Fail-closed default (flag absent for a fresh key)", () => {
    test("a not-yet-provisioned Phase 7 flag still reports disabled for any user", async () => {
      if (!dbOk) return;
      // AI_FOLLOW_UP was never given a row in this suite — must be FLAG_MISSING -> false.
      const { evaluateFlag } = await import("../services/feature-flag.service");
      const decision = await evaluateFlag("AI_FOLLOW_UP", customerA.id);
      expect(decision.enabled).toBe(false);
      expect(decision.reason).toBe("FLAG_MISSING");
    });
  });

  describe("Side-effect isolation", () => {
    test("reading rebooking + satisfaction mutates no bookings, payments, or ratings", async () => {
      if (!dbOk) return;
      const before = await Promise.all([
        prisma.booking.count(),
        prisma.payment.count(),
        prisma.rating.count(),
      ]);

      await app.handle(
        new Request("http://localhost/api/customer-intel/rebooking", {
          headers: { Authorization: `Bearer ${bearer(customerA)}` },
        }),
      );
      await app.handle(
        new Request(`http://localhost/api/customer-intel/satisfaction/${bookingId}`, {
          headers: { Authorization: `Bearer ${bearer(customerA)}` },
        }),
      );

      const after = await Promise.all([
        prisma.booking.count(),
        prisma.payment.count(),
        prisma.rating.count(),
      ]);

      expect(after).toEqual(before);
    });
  });
});
