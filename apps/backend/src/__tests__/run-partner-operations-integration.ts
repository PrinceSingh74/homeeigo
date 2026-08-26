/**
 * Section 02 partner operations integration — isolated homigo_test.
 * Run via: bun --env-file=.env.test src/__tests__/run-partner-operations-integration.ts
 *
 * bun test + Prisma query engine is unreliable on Windows when the default
 * query_engine DLL is locked; this script matches the P1/P2 runner pattern.
 */
process.env.NODE_ENV = "test";
process.env.EVENTS_OUTBOX_ENABLED = process.env.EVENTS_OUTBOX_ENABLED ?? "false";
process.env.EVENTS_CONSUMERS_ENABLED = process.env.EVENTS_CONSUMERS_ENABLED ?? "false";

console.log("[ops] start");
await import("../load-env");
console.log("[ops] env db=", (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0]);

const { BookingStatus, PaymentStatus } = await import("@prisma/client");
const {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  futureSlot,
} = await import("./helpers/adversarial-fixtures");
const { partnerOperationsService } = await import("../services/partner-operations.service");
const { matchingService } = await import("../services/matching.service");
const { bookingService } = await import("../services/booking.service");
const { EVENT_TYPES } = await import("../events/catalog/event-types");
const {
  buildPartnerPausedEvent,
  buildPartnerOnlineEvent,
  buildPartnerAvailabilityUpdatedEvent,
  buildPartnerServiceAreaUpdatedEvent,
} = await import("../events/catalog/partner.events");

let failed = 0;
let passed = 0;

function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed += 1;
    console.error("  FAIL", msg);
  } else {
    passed += 1;
    console.log("  PASS", msg);
  }
}

async function assertRejects(fn: () => Promise<unknown>, re: RegExp, msg: string) {
  try {
    await fn();
    failed += 1;
    console.error("  FAIL", msg, "(did not throw)");
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (re.test(text)) {
      passed += 1;
      console.log("  PASS", msg);
    } else {
      failed += 1;
      console.error("  FAIL", msg, text);
    }
  }
}

const RUN_ID = `ops-${Date.now().toString(36)}`;

if (!(await dbReachable())) {
  throw new Error("[ops] PostgreSQL unreachable");
}

const ctx = await seedAdversarialFixtures(RUN_ID);
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

try {
  console.log("[ops] readiness + online/offline/pause");
  {
    const ready = await partnerOperationsService.snapshot(ctx.providerId);
    assert(ready.readiness.ready === true, "readiness ready");
    assert(ready.operationalStatus === "offline", "starts offline");

    const on = await partnerOperationsService.setOnline(ctx.providerId, true);
    assert(on.isOnline === true, "go online");
    assert(on.operationalStatus === "available", "status available");

    const paused = await partnerOperationsService.pause(ctx.providerId, "break");
    assert(paused.operationalStatus === "paused", "pause");
    assert(paused.pauseReason === "break", "pause reason persisted");

    const resumed = await partnerOperationsService.resume(ctx.providerId);
    assert(resumed.operationalStatus === "available", "resume");

    const off = await partnerOperationsService.setOnline(ctx.providerId, false);
    assert(off.isOnline === false, "go offline");
    assert(off.operationalStatus === "offline", "status offline");
  }

  console.log("[ops] schedule persist + validation");
  {
    const saved = await partnerOperationsService.updateAvailabilityConfig(ctx.providerId, {
      workingDays: ["Mon", "Wed", "Fri", "Sun"],
      workingHoursStart: "09:00",
      workingHoursEnd: "18:00",
      breakWindows: [{ start: "13:00", end: "14:00" }],
      maxJobsPerDay: 5,
      maxConcurrentJobs: 2,
    });
    assert(JSON.stringify(saved.workingDays) === JSON.stringify(["Mon", "Wed", "Fri", "Sun"]), "working days persist");
    assert(saved.workingHoursStart === "09:00" && saved.workingHoursEnd === "18:00", "hours persist");
    assert(saved.maxJobsPerDay === 5 && saved.maxConcurrentJobs === 2, "capacity persist");
    await assertRejects(
      () =>
        partnerOperationsService.updateAvailabilityConfig(ctx.providerId, {
          workingHoursStart: "18:00",
          workingHoursEnd: "09:00",
        }),
      /start must be before end/i,
      "rejects overnight / inverted hours",
    );
  }

  console.log("[ops] service area");
  {
    const ok = await partnerOperationsService.updateServiceArea(ctx.providerId, {
      city: "Noida",
      serviceRegions: ["Sector 45", "Sector 46", "Sector 47"],
      serviceRadiusKm: 5,
      baseLatitude: 28.57,
      baseLongitude: 77.32,
    });
    assert(JSON.stringify(ok.serviceRegions) === JSON.stringify(["Sector 45", "Sector 46", "Sector 47"]), "regions persist");
    assert(ok.serviceRadiusKm === 5, "radius persist");
    await assertRejects(
      () => partnerOperationsService.updateServiceArea(ctx.providerId, { serviceRadiusKm: 0 }),
      /radius/i,
      "rejects invalid radius",
    );
    await assertRejects(
      () =>
        partnerOperationsService.updateServiceArea(ctx.providerId, {
          baseLatitude: 40.7,
          baseLongitude: -74.0,
        }),
      /India|service area/i,
      "rejects coordinates outside India",
    );
  }

  console.log("[ops] suspended cannot go online");
  {
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { isBanned: true, isOnline: false } });
    await assertRejects(
      () => partnerOperationsService.setOnline(ctx.providerId, true),
      /unavailable/i,
      "suspended partner cannot go online",
    );
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { isBanned: false } });
  }

  console.log("[ops] matching eligibility");
  {
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
    assert(!offline.some((m) => m.providerId === ctx.providerId), "offline excluded from matching");

    await partnerOperationsService.setOnline(ctx.providerId, true);
    const online = await matchingService.findBestProviders({
      serviceId: ctx.serviceId,
      latitude: 28.62,
      longitude: 77.37,
      scheduledDate: new Date(),
    });
    assert(online.some((m) => m.providerId === ctx.providerId), "online included in matching");
    const reranked = await matchingService.reRankProviders(
      ctx.serviceId,
      { latitude: 28.62, longitude: 77.37 },
      [],
    );
    assert(reranked.some((m) => m.providerId === ctx.providerId), "reRank includes the same eligible partner");
    assert(
      reranked.every((m) => m.availability),
      "reRank only returns availability=true candidates",
    );

    await partnerOperationsService.pause(ctx.providerId, "personal");
    const paused = await matchingService.findBestProviders({
      serviceId: ctx.serviceId,
      latitude: 28.62,
      longitude: 77.37,
      scheduledDate: new Date(),
    });
    assert(!paused.some((m) => m.providerId === ctx.providerId), "paused excluded from matching");
    await partnerOperationsService.resume(ctx.providerId);
  }

  console.log("[ops] concurrent accept race");
  {
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: { isOnline: true, pausedAt: null, maxConcurrentJobs: 1 },
    });
    const mk = async (when: Date) =>
      prisma.booking.create({
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
    const a = await mk(futureSlot(3));
    const b = await mk(futureSlot(6));
    const [r1, r2] = await Promise.all([
      bookingService.accept(ctx.providerId, a.id),
      bookingService.accept(ctx.providerId, b.id),
    ]);
    const wins = [r1, r2].filter((r) => r.ok);
    const losses = [r1, r2].filter((r) => !r.ok);
    assert(wins.length === 1, "exactly one concurrent accept wins");
    assert(losses.length === 1, "exactly one concurrent accept loses");
    const err = losses[0] && "error" in losses[0] ? String(losses[0].error) : "";
    assert(/CAPACITY_LIMIT|ALREADY_CLAIMED|PROVIDER_UNAVAILABLE/.test(err), `loser error is capacity/claim (${err})`);
    const acceptedCount = await prisma.booking.count({
      where: { id: { in: [a.id, b.id] }, status: BookingStatus.ACCEPTED },
    });
    assert(acceptedCount === 1, "DB has exactly one accepted booking after 1-slot race");
    await prisma.booking.updateMany({
      where: { providerId: ctx.providerId, status: { in: [BookingStatus.ACCEPTED, BookingStatus.PENDING] } },
      data: { status: BookingStatus.CANCELLED_BY_PROVIDER },
    });
    const leftover = await prisma.booking.count({
      where: {
        providerId: ctx.providerId,
        status: { in: [BookingStatus.ACCEPTED, BookingStatus.ASSIGNED, BookingStatus.EN_ROUTE, BookingStatus.IN_PROGRESS] },
      },
    });
    assert(leftover === 0, "cleared active jobs before 2-slot race");

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
    const tWins = triple.filter((r) => r.ok);
    const tLoss = triple.filter((r) => !r.ok);
    assert(tWins.length === 2, `maxConcurrent=2: two of three concurrent accepts win (got ${tWins.length})`);
    assert(tLoss.length === 1, `maxConcurrent=2: one of three concurrent accepts loses (got ${tLoss.length})`);
    const tErr = tLoss[0] && "error" in tLoss[0] ? String(tLoss[0].error) : "";
    assert(/CAPACITY_LIMIT|ALREADY_CLAIMED|PROVIDER_UNAVAILABLE/.test(tErr), `triple loser error (${tErr})`);
    const acceptedIds = [c.id, d.id, e.id];
    const acceptedTwo = await prisma.booking.count({
      where: { id: { in: acceptedIds }, status: BookingStatus.ACCEPTED },
    });
    assert(acceptedTwo === 2, "DB has exactly two accepted bookings after 2-slot race");
  }

  console.log("[ops] event catalog");
  {
    assert(EVENT_TYPES.PARTNER_ONLINE === "homigo.partner.online", "online event type");
    assert(EVENT_TYPES.PARTNER_PAUSED === "homigo.partner.paused", "paused event type");
    assert(EVENT_TYPES.PARTNER_AVAILABILITY_UPDATED === "homigo.partner.availability.updated", "availability event type");
    assert(EVENT_TYPES.PARTNER_SERVICE_AREA_UPDATED === "homigo.partner.service_area.updated", "service area event type");
    const paused = buildPartnerPausedEvent({ providerId: "p1", pausedAt: new Date(), reason: "break" });
    const online = buildPartnerOnlineEvent({ providerId: "p1", onlineSince: new Date() });
    assert(paused.id !== online.id, "event ids are unique");
    assert(
      buildPartnerAvailabilityUpdatedEvent({
        providerId: "p1",
        workingDays: ["Mon"],
        workingHoursStart: "09:00",
        workingHoursEnd: "18:00",
      }).type === EVENT_TYPES.PARTNER_AVAILABILITY_UPDATED,
      "availability event builder",
    );
    assert(
      buildPartnerServiceAreaUpdatedEvent({
        providerId: "p1",
        serviceRegions: ["Noida"],
        serviceRadiusKm: 5,
      }).type === EVENT_TYPES.PARTNER_SERVICE_AREA_UPDATED,
      "service area event builder",
    );
  }
} finally {
  await new Promise((r) => setTimeout(r, 300));
  await cleanupAdversarialFixtures(RUN_ID).catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
}

console.log(`\n[ops] ${passed} pass, ${failed} fail`);
if (failed > 0) process.exit(1);

// This runner uses top-level `await import(...)` only (no static imports), so TypeScript treats it
// as a script rather than a module and rejects every top-level await (TS1375). An explicit empty
// export makes it a module — the same fix TypeScript's own diagnostic recommends.
export {};
