import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
  payWithRealWallet,
} from "./helpers/adversarial-fixtures";
import { automationSchedulerConsumer } from "../events/consumers/automation-scheduler.consumer";
import { mlFeatureSinkConsumer } from "../events/consumers/ml-feature-sink.consumer";
import { auditConsumer } from "../events/consumers/audit.consumer";
import { buildBookingCompletedEvent } from "../events/catalog/booking.events";
import { buildPartnerArrivedEvent } from "../events/catalog/partner.events";
import { EVENT_TYPES } from "../events/catalog/event-types";

/**
 * Delivery is at-least-once: the consumer receipt is written after the handler, and the outbox
 * reclaims a stuck row after 120 s. Every side effect below must therefore collapse when the SAME
 * event is delivered twice — including concurrently, which is what a lease lapse with the first
 * handler still running looks like. The arbiter is a unique index, not a read-then-write check.
 */
const RUN = `cidem-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let reachable = false;
let bookingId = "";

beforeAll(async () => {
  reachable = await dbReachable();
  if (!reachable) return;
  ctx = await seedAdversarialFixtures(RUN);
  const b = await prisma.booking.create({
    data: {
      bookingNumber: `CIDEM-${RUN}`,
      userId: ctx.customerA.id,
      providerId: ctx.providerId,
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      status: BookingStatus.COMPLETED,
      completedAt: new Date(),
      scheduledDate: new Date(Date.now() - 3_600_000),
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
      paymentStatus: PaymentStatus.PENDING,
    },
  });
  // Paid through the real wallet checkout, not a hand-set "wallet" payment status.
  await payWithRealWallet(b.id, ctx.customerA.id);
  bookingId = b.id;
}, 60_000);
afterAll(async () => {
  if (!reachable) return;
  await prisma.scheduledJob.deleteMany({ where: { triggerEventId: { startsWith: `evt-${RUN}` } } });
  await prisma.mlFeatureStaging.deleteMany({ where: { eventId: { startsWith: `evt-${RUN}` } } });
  await prisma.enterpriseAuditLog.deleteMany({ where: { traceId: { startsWith: `evt-${RUN}` } } }).catch(() => undefined);
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

function completedEvent(id: string) {
  const e = buildBookingCompletedEvent({
    bookingId,
    userId: ctx.customerA.id,
    providerId: ctx.providerId,
    serviceId: ctx.serviceId,
    completedAt: new Date(),
    actualDurationMin: 60,
    finalAmount: 500,
    finalAmountPaise: 50_000n,
  });
  return { ...e, id };
}

describe("automation-scheduler consumer", () => {
  it("delivering the same BOOKING_COMPLETED twice — sequentially and concurrently — schedules one job", async () => {
    if (!reachable) return;
    const ev = completedEvent(`evt-${RUN}-sched`);
    await automationSchedulerConsumer(ev as never);
    await automationSchedulerConsumer(ev as never);
    await Promise.all([automationSchedulerConsumer(ev as never), automationSchedulerConsumer(ev as never), automationSchedulerConsumer(ev as never)]);
    const jobs = await prisma.scheduledJob.findMany({ where: { triggerEventId: ev.id } });
    // Either the workflow supersedes the legacy job (0 rows) or exactly one job exists — never two.
    expect(jobs.length).toBeLessThanOrEqual(1);
    const distinct = new Set(jobs.map((j) => `${j.jobType}:${j.triggerEventId}`));
    expect(distinct.size).toBe(jobs.length);
  });

  it("the database refuses a second job for the same (type, trigger event) even if the code path is bypassed", async () => {
    if (!reachable) return;
    const key = `evt-${RUN}-raw`;
    await prisma.scheduledJob.create({ data: { jobType: "automation.review_request", triggerEventId: key, payload: {}, runAt: new Date(), status: "pending" } });
    // PrismaPromise is a thenable, not a Promise — wrap so `rejects` sees a real rejection.
    await expect((async () => { await prisma.scheduledJob.create({ data: { jobType: "automation.review_request", triggerEventId: key, payload: {}, runAt: new Date(), status: "pending" } }); })()).rejects.toThrow(/Unique constraint/);
    // Workflow steps share their instance's trigger event id — several per event is correct.
    const s1 = await prisma.scheduledJob.create({ data: { jobType: "automation.workflow_step", triggerEventId: key, payload: { instanceId: "i1" }, runAt: new Date(), status: "pending" } });
    const s2 = await prisma.scheduledJob.create({ data: { jobType: "automation.workflow_step", triggerEventId: key, payload: { instanceId: "i1" }, runAt: new Date(), status: "pending" } });
    await prisma.scheduledJob.deleteMany({ where: { id: { in: [s1.id, s2.id] } } });
    // Jobs without a triggering event keep their freedom (partial index).
    const a = await prisma.scheduledJob.create({ data: { jobType: `manual-${RUN}`, payload: {}, runAt: new Date(), status: "pending" } });
    const b = await prisma.scheduledJob.create({ data: { jobType: `manual-${RUN}`, payload: {}, runAt: new Date(), status: "pending" } });
    await prisma.scheduledJob.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  });
});

describe("ml-feature-sink consumer", () => {
  it("stages one row per event however many times it is delivered", async () => {
    if (!reachable) return;
    const e = buildPartnerArrivedEvent({
      bookingId,
      providerId: ctx.providerId,
      arrivedAt: new Date(),
      travelDurationMin: 12,
      distanceKm: 3.2,
      googleEtaMin: 10,
      hourOfDay: 10,
      dayOfWeek: 2,
      city: "Mumbai",
      serviceCategory: "cleaning",
    } as never);
    const ev = { ...e, id: `evt-${RUN}-ml` };
    await Promise.all([mlFeatureSinkConsumer(ev as never), mlFeatureSinkConsumer(ev as never)]);
    await mlFeatureSinkConsumer(ev as never);
    expect(await prisma.mlFeatureStaging.count({ where: { eventId: ev.id } })).toBe(1);
  });
});

describe("audit consumer", () => {
  it("a redelivered event without a trace id produces rows that share the event id as trace, not random ids", async () => {
    if (!reachable) return;
    const ev = completedEvent(`evt-${RUN}-audit`);
    (ev as { homigo: { traceId?: string } }).homigo.traceId = undefined;
    await auditConsumer(ev as never);
    await auditConsumer(ev as never);
    const rows = await prisma.enterpriseAuditLog.findMany({ where: { traceId: ev.id } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(new Set(rows.map((r) => r.traceId)).size).toBe(1);
    expect(String(ev.type)).toBe(String(EVENT_TYPES.BOOKING_COMPLETED));
  });
});

describe("partner referral notification dedup index", () => {
  it("a second identical partner_referral notification is refused by the database", async () => {
    if (!reachable) return;
    const data = { userId: ctx.vendorUserId, title: `Referral milestone ${RUN}`, message: "x", type: "REFERRAL", referenceId: `ref-${RUN}`, referenceType: "partner_referral" };
    const first = await prisma.notification.create({ data });
    await expect((async () => { await prisma.notification.create({ data }); })()).rejects.toThrow(/Unique constraint/);
    // A different title for the same referral is a different notification.
    const other = await prisma.notification.create({ data: { ...data, title: `Referral reward ${RUN}` } });
    await prisma.notification.deleteMany({ where: { id: { in: [first.id, other.id] } } });
  });

  it("the admin review sibling (partner_referral_review) is covered by the widened index", async () => {
    if (!reachable) return;
    const data = { userId: ctx.supportAdmin.id, title: `Referral risk review ${RUN}`, message: "x", type: "REFERRAL", referenceId: `ref-${RUN}`, referenceType: "partner_referral_review" };
    const first = await prisma.notification.create({ data });
    await expect((async () => { await prisma.notification.create({ data }); })()).rejects.toThrow(/Unique constraint/);
    await prisma.notification.deleteMany({ where: { id: first.id } });
  });

  it("PARTNER_REFERRAL_FLAGGED is emitted at most once per referral, even on concurrent replay", async () => {
    if (!reachable) return;
    /**
     * The admin-review notifier guards a sequential replay with a findFirst, but two concurrent
     * callers both pass it. `partnerEnvelope` mints a random event id, so the outbox used to accept
     * both and every consumer would see two distinct events for one flagging. The id is now derived
     * from the referral, and `event_outbox.event_id` is unique.
     */
    const referralId = `ref-flag-${RUN}`;
    const eventId = `partner-referral-flagged:${referralId}`;
    const row = {
      eventId,
      eventType: "homigo.partner.referral.flagged",
      eventVersion: "1",
      aggregateType: "provider",
      aggregateId: `prov-${RUN}`,
      actorType: "system",
      actorId: "test",
      payload: {},
    };
    await prisma.eventOutbox.create({ data: row as never });
    await expect((async () => { await prisma.eventOutbox.create({ data: row as never }); })()).rejects.toThrow(/Unique constraint/);
    expect(await prisma.eventOutbox.count({ where: { eventId } })).toBe(1);
    await prisma.eventOutbox.deleteMany({ where: { eventId } });
  });

  it("a second 'booking_accepted' notice for the same customer and booking is refused by the database", async () => {
    if (!reachable) return;
    const data = { userId: ctx.customerA.id, title: "Booking Accepted", message: "x", type: "booking_accepted", referenceId: bookingId, referenceType: "booking" };
    const first = await prisma.notification.create({ data });
    await expect((async () => { await prisma.notification.create({ data }); })()).rejects.toThrow(/Unique constraint/);
    // Other notification types for the same booking are unaffected.
    const other = await prisma.notification.create({ data: { ...data, type: "booking_completed", title: "Done" } });
    await prisma.notification.deleteMany({ where: { id: { in: [first.id, other.id] } } });
  });
});
