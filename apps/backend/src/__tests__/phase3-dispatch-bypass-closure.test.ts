/**
 * Phase 3 — bypass closure: direct booking + admin reassign must pass assertOfferEligible.
 *   NODE_ENV=test bun test src/__tests__/phase3-dispatch-bypass-closure.test.ts
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  heartbeatFresh,
  cleanupAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { bookingService } from "../services/booking.service";
import { adminBookingOperationsService } from "../services/admin-booking-operations.service";
import { partnerOperationsService } from "../services/partner-operations.service";
import { PRESENCE_FRESH_SEC } from "../lib/partner-presence.config";
import { BookingStatus, PaymentStatus } from "@prisma/client";

const RUN_ID = `phase3-bypass-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
const JOB_LAT = 28.62;
const JOB_LNG = 77.37;

function futureSlot(hours = 2): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function adminBookingSlot(testIndex: number): Date {
  return new Date(Date.now() + (48 + testIndex * 6) * 3600_000);
}

/**
 * Reuses the fixture's presence session and continues its per-provider location sequence. The
 * suite used to mint a second session and restart the sequence at 1, which the presence service
 * correctly rejected (`Location sequence must increase` / STALE_SESSION).
 */
async function seedFreshPresence() {
  await heartbeatFresh(ctx, { latitude: JOB_LAT, longitude: JOB_LNG });
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN_ID);
}, 60_000);

afterAll(async () => {
  if (dbOk) {
    await prisma.partnerPresence.deleteMany({ where: { providerId: ctx.providerId } }).catch(() => {});
    await cleanupAdversarialFixtures(RUN_ID);
  }
}, 60_000);

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable");
    return true;
  }
  return false;
}

describe.serial("Phase 3 — direct booking bypass closure", () => {
  beforeEach(async () => {
    if (!dbOk) return;
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: {
        isOnline: true,
        pausedAt: null,
        lifecycleState: "ACTIVE",
        isApproved: true,
        isBanned: false,
        isActive: true,
        workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        workingHoursStart: "00:00",
        workingHoursEnd: "23:59",
        serviceRadiusKm: 50,
        baseLatitude: JOB_LAT,
        baseLongitude: JOB_LNG,
        serviceRegions: [],
      },
    });
    await partnerOperationsService.setOnline(ctx.providerId, true);
  });

  test("direct booking with providerId rejects STALE_PRESENCE", async () => {
    if (skipIfNoDb()) return;

    const staleAt = new Date(Date.now() - (PRESENCE_FRESH_SEC + 120) * 1000);
    await prisma.partnerPresence.upsert({
      where: { providerId: ctx.providerId },
      create: {
        providerId: ctx.providerId,
        lastHeartbeatAt: staleAt,
        lastSeenAt: staleAt,
        lastLocationAt: staleAt,
        lastLocationLat: JOB_LAT,
        lastLocationLng: JOB_LNG,
      },
      update: {
        lastHeartbeatAt: staleAt,
        lastSeenAt: staleAt,
        lastLocationAt: staleAt,
        lastLocationLat: JOB_LAT,
        lastLocationLng: JOB_LNG,
      },
    });

    const result = await bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      addressId: ctx.addressAId,
      scheduledDate: futureSlot(),
    });

    expect(result.error).toBe("PROVIDER_UNAVAILABLE");
    expect("booking" in result).toBe(false);
  });

  test("direct booking with providerId allowed when presence fresh", async () => {
    if (skipIfNoDb()) return;

    await seedFreshPresence();

    const result = await bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      addressId: ctx.addressAId,
      scheduledDate: futureSlot(5),
    });

    expect(result.error).toBeUndefined();
    expect(result.booking).toBeDefined();
    const row = await prisma.booking.findFirst({
      where: { id: result.booking!.id },
      select: { providerId: true },
    });
    expect(row?.providerId).toBe(ctx.providerId);
  });
});

describe.serial("Phase 3 — admin reassign bypass closure", () => {
  beforeEach(async () => {
    if (!dbOk) return;
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: {
        isOnline: true,
        pausedAt: null,
        lifecycleState: "ACTIVE",
        isApproved: true,
        isBanned: false,
        isActive: true,
        workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        workingHoursStart: "00:00",
        workingHoursEnd: "23:59",
        serviceRadiusKm: 50,
        baseLatitude: JOB_LAT,
        baseLongitude: JOB_LNG,
        serviceRegions: [],
      },
    });
    await partnerOperationsService.setOnline(ctx.providerId, true);
  });

  /**
   * `withinPresenceHorizon`: since 2026-10-01 live presence is required only for a job inside the 24 h
   * horizon (lib/scheduled-offer-presence) — the rule dispatch and accept already applied, now also
   * admin reassign. The STALE_PRESENCE / emergency-override cases test that override discipline, so
   * their job must sit where presence is actually required: a few hours out, not 48 h+.
   */
  async function createPendingBooking(testIndex: number, opts: { withinPresenceHorizon?: boolean } = {}) {
    // 8 + 3·index hours (14 h, 20 h, 23 h): inside the horizon, clear of each other and of the 2 h / 5 h
    // bookings earlier in this file — one customer, so overlapping windows hit bookings_user_slot_excl.
    const scheduledDate = opts.withinPresenceHorizon
      ? new Date(Date.now() + (8 + testIndex * 3) * 3600_000)
      : adminBookingSlot(testIndex);
    const b = await prisma.booking.create({
      data: {
        bookingNumber: `P3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: ctx.customerA.id,
        serviceId: ctx.serviceId,
        addressId: ctx.addressAId,
        scheduledDate,
        baseAmount: 500,
        finalAmount: 500,
        totalAmount: 500,
        status: BookingStatus.PENDING,
        paymentStatus: PaymentStatus.SUCCESS,
      },
    });
    return b.id;
  }

  test("admin reassign rejects SUSPENDED partner", async () => {
    if (skipIfNoDb()) return;

    await seedFreshPresence();
    const bookingId = await createPendingBooking(1);

    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: { lifecycleState: "SUSPENDED" },
    });

    await expect(
      adminBookingOperationsService.reassignProvider(
        bookingId,
        ctx.superAdmin.id,
        ctx.providerId,
        "cert reassign suspended",
      ),
    ).rejects.toThrow(/REASSIGN_BLOCKED:(ACCOUNT_RESTRICTED|NOT_ACTIVE)/);
  });

  test("admin reassign rejects STALE_PRESENCE without emergency override", async () => {
    if (skipIfNoDb()) return;

    const bookingId = await createPendingBooking(2, { withinPresenceHorizon: true });
    const staleAt = new Date(Date.now() - (PRESENCE_FRESH_SEC + 120) * 1000);
    await prisma.partnerPresence.upsert({
      where: { providerId: ctx.providerId },
      create: {
        providerId: ctx.providerId,
        lastHeartbeatAt: staleAt,
        lastSeenAt: staleAt,
        lastLocationAt: staleAt,
        lastLocationLat: JOB_LAT,
        lastLocationLng: JOB_LNG,
      },
      update: {
        lastHeartbeatAt: staleAt,
        lastSeenAt: staleAt,
        lastLocationAt: staleAt,
      },
    });

    await expect(
      adminBookingOperationsService.reassignProvider(
        bookingId,
        ctx.superAdmin.id,
        ctx.providerId,
        "cert reassign stale",
      ),
    ).rejects.toThrow(/REASSIGN_BLOCKED:STALE_PRESENCE/);
  });

  test("admin reassign succeeds when partner is eligible", async () => {
    if (skipIfNoDb()) return;

    await seedFreshPresence();
    const bookingId = await createPendingBooking(3);

    const result = await adminBookingOperationsService.reassignProvider(
      bookingId,
      ctx.superAdmin.id,
      ctx.providerId,
      "cert reassign ok",
    );

    expect(result.ok).toBe(true);
    const updated = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(updated?.providerId).toBe(ctx.providerId);
    expect(updated?.status).toBe(BookingStatus.ASSIGNED);
  });

  test("admin emergency override allows STALE_PRESENCE with audit", async () => {
    if (skipIfNoDb()) return;

    const bookingId = await createPendingBooking(4, { withinPresenceHorizon: true });
    const staleAt = new Date(Date.now() - (PRESENCE_FRESH_SEC + 120) * 1000);
    await prisma.partnerPresence.upsert({
      where: { providerId: ctx.providerId },
      create: {
        providerId: ctx.providerId,
        lastHeartbeatAt: staleAt,
        lastSeenAt: staleAt,
        lastLocationAt: staleAt,
        lastLocationLat: JOB_LAT,
        lastLocationLng: JOB_LNG,
      },
      update: { lastHeartbeatAt: staleAt, lastSeenAt: staleAt },
    });

    const result = await adminBookingOperationsService.reassignProvider(
      bookingId,
      ctx.superAdmin.id,
      ctx.providerId,
      "emergency ops recovery",
      undefined,
      false,
      {
        adminId: ctx.superAdmin.id,
        reason: "Emergency dispatch — partner app offline, phone confirmed on-site",
        overrideType: "EMERGENCY_DISPATCH",
        overrideAuditId: `audit-${RUN_ID}`,
      },
    );

    expect(result.ok).toBe(true);

    const audit = await prisma.activityLog.findFirst({
      where: {
        bookingId,
        action: { contains: "DISPATCH_ELIGIBILITY_OVERRIDE" },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
  });

  test("emergency override rejects when adminId does not match actor", async () => {
    if (skipIfNoDb()) return;

    const bookingId = await createPendingBooking(5, { withinPresenceHorizon: true });
    const staleAt = new Date(Date.now() - (PRESENCE_FRESH_SEC + 120) * 1000);
    await prisma.partnerPresence.upsert({
      where: { providerId: ctx.providerId },
      create: {
        providerId: ctx.providerId,
        lastHeartbeatAt: staleAt,
        lastSeenAt: staleAt,
        lastLocationAt: staleAt,
        lastLocationLat: JOB_LAT,
        lastLocationLng: JOB_LNG,
      },
      update: { lastHeartbeatAt: staleAt, lastSeenAt: staleAt },
    });

    await expect(
      adminBookingOperationsService.reassignProvider(
        bookingId,
        ctx.superAdmin.id,
        ctx.providerId,
        "tampered override actor",
        undefined,
        false,
        {
          adminId: ctx.financeAdmin.id,
          reason: "wrong actor id in override payload",
          overrideType: "EMERGENCY_DISPATCH",
        },
      ),
    ).rejects.toThrow(/REASSIGN_BLOCKED:STALE_PRESENCE/);
  });

  test("emergency override does not bypass SUSPENDED lifecycle", async () => {
    if (skipIfNoDb()) return;

    const bookingId = await createPendingBooking(6);
    const staleAt = new Date(Date.now() - (PRESENCE_FRESH_SEC + 120) * 1000);
    await prisma.partnerPresence.upsert({
      where: { providerId: ctx.providerId },
      create: {
        providerId: ctx.providerId,
        lastHeartbeatAt: staleAt,
        lastSeenAt: staleAt,
        lastLocationAt: staleAt,
        lastLocationLat: JOB_LAT,
        lastLocationLng: JOB_LNG,
      },
      update: { lastHeartbeatAt: staleAt, lastSeenAt: staleAt },
    });
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: { lifecycleState: "SUSPENDED" },
    });

    await expect(
      adminBookingOperationsService.reassignProvider(
        bookingId,
        ctx.superAdmin.id,
        ctx.providerId,
        "override on suspended",
        undefined,
        false,
        {
          adminId: ctx.superAdmin.id,
          reason: "must not bypass lifecycle",
          overrideType: "EMERGENCY_DISPATCH",
        },
      ),
    ).rejects.toThrow(/REASSIGN_BLOCKED:(ACCOUNT_RESTRICTED|NOT_ACTIVE)/);
  });
});
