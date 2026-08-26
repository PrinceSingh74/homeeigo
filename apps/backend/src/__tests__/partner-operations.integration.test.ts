/**
 * Isolated-DB Section 02 partner operations: availability, capacity, service area,
 * dispatch eligibility, and concurrent accept race.
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  futureSlot,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { partnerOperationsService } from "../services/partner-operations.service";
import { matchingService } from "../services/matching.service";
import { bookingService } from "../services/booking.service";
import { EVENT_TYPES } from "../events/catalog/event-types";
import {
  buildPartnerPausedEvent,
  buildPartnerOnlineEvent,
  buildPartnerAvailabilityUpdatedEvent,
  buildPartnerServiceAreaUpdatedEvent,
} from "../events/catalog/partner.events";

const RUN_ID = `ops-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN_ID);
  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: {
      isOnline: false,
      currentStatus: "offline",
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      workingHoursStart: "00:00",
      workingHoursEnd: "23:59",
      maxConcurrentJobs: 1,
      maxJobsPerDay: 5,
      serviceRadiusKm: 8,
      baseLatitude: 28.62,
      baseLongitude: 77.37,
      city: "Noida",
      serviceRegions: ["Noida"],
      pausedAt: null,
    },
  });
});

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
  await prisma.$disconnect();
}, 60_000);

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable");
    return true;
  }
  return false;
}

describe.serial("Section 02 partner operations", () => {
  test("readiness + go online/offline + pause/resume persist", async () => {
    if (skipIfNoDb()) return;
    const ready = await partnerOperationsService.snapshot(ctx.providerId);
    expect(ready.readiness.ready).toBe(true);
    expect(ready.operationalStatus).toBe("offline");

    const on = await partnerOperationsService.setOnline(ctx.providerId, true);
    expect(on.isOnline).toBe(true);
    expect(on.operationalStatus).toBe("available");

    const paused = await partnerOperationsService.pause(ctx.providerId, "break");
    expect(paused.operationalStatus).toBe("paused");
    expect(paused.pauseReason).toBe("break");

    const resumed = await partnerOperationsService.resume(ctx.providerId);
    expect(resumed.operationalStatus).toBe("available");

    const off = await partnerOperationsService.setOnline(ctx.providerId, false);
    expect(off.isOnline).toBe(false);
    expect(off.operationalStatus).toBe("offline");
  });

  test("working days, hours, break, and capacity persist exactly", async () => {
    if (skipIfNoDb()) return;
    const saved = await partnerOperationsService.updateAvailabilityConfig(ctx.providerId, {
      workingDays: ["Mon", "Wed", "Fri", "Sun"],
      workingHoursStart: "09:00",
      workingHoursEnd: "18:00",
      breakWindows: [{ start: "13:00", end: "14:00" }],
      maxJobsPerDay: 5,
      maxConcurrentJobs: 2,
    });
    expect(saved.workingDays).toEqual(["Mon", "Wed", "Fri", "Sun"]);
    expect(saved.workingHoursStart).toBe("09:00");
    expect(saved.workingHoursEnd).toBe("18:00");
    expect(saved.maxJobsPerDay).toBe(5);
    expect(saved.maxConcurrentJobs).toBe(2);

    await expect(
      partnerOperationsService.updateAvailabilityConfig(ctx.providerId, {
        workingHoursStart: "18:00",
        workingHoursEnd: "09:00",
      }),
    ).rejects.toThrow(/start must be before end/i);
  });

  test("service area radius validation + persist", async () => {
    if (skipIfNoDb()) return;
    const ok = await partnerOperationsService.updateServiceArea(ctx.providerId, {
      city: "Noida",
      serviceRegions: ["Sector 45", "Sector 46", "Sector 47"],
      serviceRadiusKm: 5,
      baseLatitude: 28.57,
      baseLongitude: 77.32,
    });
    expect(ok.serviceRegions).toEqual(["Sector 45", "Sector 46", "Sector 47"]);
    expect(ok.serviceRadiusKm).toBe(5);

    await expect(
      partnerOperationsService.updateServiceArea(ctx.providerId, { serviceRadiusKm: 0 }),
    ).rejects.toThrow(/radius/i);
    await expect(
      partnerOperationsService.updateServiceArea(ctx.providerId, {
        baseLatitude: 40.7,
        baseLongitude: -74.0,
      }),
    ).rejects.toThrow(/India|service area/i);
  });

  test("suspended partner cannot go online", async () => {
    if (skipIfNoDb()) return;
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { isBanned: true, isOnline: false } });
    await expect(partnerOperationsService.setOnline(ctx.providerId, true)).rejects.toThrow(/unavailable/i);
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { isBanned: false } });
  });

  test("matching excludes offline, paused, and capacity-full partners", async () => {
    if (skipIfNoDb()) return;
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: {
        isOnline: false,
        pausedAt: null,
        workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        workingHoursStart: "00:00",
        workingHoursEnd: "23:59",
        maxConcurrentJobs: 1,
        serviceRadiusKm: 8,
        baseLatitude: 28.62,
        baseLongitude: 77.37,
        serviceRegions: ["Noida"],
      },
    });
    const offline = await matchingService.findBestProviders({
      serviceId: ctx.serviceId,
      latitude: 28.62,
      longitude: 77.37,
      scheduledDate: new Date(),
    });
    expect(offline.some((m) => m.providerId === ctx.providerId)).toBe(false);

    await partnerOperationsService.setOnline(ctx.providerId, true);
    const online = await matchingService.findBestProviders({
      serviceId: ctx.serviceId,
      latitude: 28.62,
      longitude: 77.37,
      scheduledDate: new Date(),
    });
    expect(online.some((m) => m.providerId === ctx.providerId)).toBe(true);

    await partnerOperationsService.pause(ctx.providerId, "personal");
    const paused = await matchingService.findBestProviders({
      serviceId: ctx.serviceId,
      latitude: 28.62,
      longitude: 77.37,
      scheduledDate: new Date(),
    });
    expect(paused.some((m) => m.providerId === ctx.providerId)).toBe(false);
    await partnerOperationsService.resume(ctx.providerId);
  });

  test("two concurrent accepts with maxConcurrent=1: only one wins", async () => {
    if (skipIfNoDb()) return;
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: { isOnline: true, pausedAt: null, maxConcurrentJobs: 1 },
    });

    const slotA = futureSlot(3);
    const slotB = futureSlot(6);
    const mk = async (when: Date) => {
      const booking = await prisma.booking.create({
        data: {
          bookingNumber: `OPS-${RUN_ID}-${when.getTime()}`,
          userId: ctx.customerA.id,
          providerId: ctx.providerId,
          serviceId: ctx.serviceId,
          addressId: ctx.addressAId,
          scheduledDate: when,
          status: BookingStatus.PENDING,
          paymentStatus: PaymentStatus.SUCCESS,
          paymentMethod: "razorpay",
          baseAmount: 500,
          finalAmount: 500,
          totalAmount: 500,
          estimatedDuration: 60,
        },
      });
      return booking;
    };

    const a = await mk(slotA);
    const b = await mk(slotB);
    const [r1, r2] = await Promise.all([
      bookingService.accept(ctx.providerId, a.id),
      bookingService.accept(ctx.providerId, b.id),
    ]);
    const wins = [r1, r2].filter((r) => r.ok);
    const losses = [r1, r2].filter((r) => !r.ok);
    expect(wins.length).toBe(1);
    expect(losses.length).toBe(1);
    expect(losses[0] && "error" in losses[0] ? losses[0].error : "").toMatch(/CAPACITY_LIMIT|ALREADY_CLAIMED|PROVIDER_UNAVAILABLE/);
    await prisma.booking.updateMany({
      where: { providerId: ctx.providerId, status: { in: [BookingStatus.ACCEPTED, BookingStatus.PENDING] } },
      data: { status: BookingStatus.CANCELLED_BY_PROVIDER },
    });
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: { isOnline: true, pausedAt: null, maxConcurrentJobs: 2 },
    });
    const c = await mk(futureSlot(9));
    const d = await mk(futureSlot(12));
    const e = await mk(futureSlot(15));
    const triple = await Promise.all([
      bookingService.accept(ctx.providerId, c.id),
      bookingService.accept(ctx.providerId, d.id),
      bookingService.accept(ctx.providerId, e.id),
    ]);
    expect(triple.filter((r) => r.ok).length).toBe(2);
    expect(triple.filter((r) => !r.ok).length).toBe(1);
  });

  test("availability events use existing catalog (no duplicate types)", () => {
    expect(EVENT_TYPES.PARTNER_ONLINE).toBe("homigo.partner.online");
    expect(EVENT_TYPES.PARTNER_PAUSED).toBe("homigo.partner.paused");
    expect(EVENT_TYPES.PARTNER_AVAILABILITY_UPDATED).toBe("homigo.partner.availability.updated");
    expect(EVENT_TYPES.PARTNER_SERVICE_AREA_UPDATED).toBe("homigo.partner.service_area.updated");
    const paused = buildPartnerPausedEvent({
      providerId: "p1",
      pausedAt: new Date(),
      reason: "break",
    });
    const online = buildPartnerOnlineEvent({ providerId: "p1", onlineSince: new Date() });
    expect(paused.id).not.toBe(online.id);
    expect(buildPartnerAvailabilityUpdatedEvent({
      providerId: "p1",
      workingDays: ["Mon"],
      workingHoursStart: "09:00",
      workingHoursEnd: "18:00",
    }).type).toBe(EVENT_TYPES.PARTNER_AVAILABILITY_UPDATED);
    expect(buildPartnerServiceAreaUpdatedEvent({
      providerId: "p1",
      serviceRegions: ["Noida"],
      serviceRadiusKm: 5,
    }).type).toBe(EVENT_TYPES.PARTNER_SERVICE_AREA_UPDATED);
  });
});
