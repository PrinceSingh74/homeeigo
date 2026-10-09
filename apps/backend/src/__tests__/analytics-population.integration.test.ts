/**
 * Phase 15.3 — analytics population governance, against the real isolated test database.
 *
 * The policy under test is the existing one, not a new one:
 *   - `analytics-scope.ts`: a row is business when its `data_origin` is NULL (UNKNOWN) or REAL;
 *     payments and ratings inherit from their booking, subscriptions / gift cards from their user.
 *   - booking provenance is stamped at creation from the customer (`createBooking`), and a later
 *     label reaches the children through `propagateNonBusinessOrigins` (provenance-report --apply).
 *   - the public review population is `publicReviewWhere` (public, unflagged, business).
 *
 * Booking-scoped facts (bookings, GMV, ratings, booking analytics events) follow the BOOKING's label;
 * customer-scoped facts (customer counts) follow the CUSTOMER's. The mixed rows below exist to prove
 * each fact follows its own owner and nothing else.
 *
 * Isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DataOrigin } from "@prisma/client";
import prisma from "../lib/prisma";
import app from "../index";
import { analyticsWhere, analyticsWhereVia } from "../lib/analytics-scope";
import { CUSTOMER_CATALOG_WHERE } from "../lib/service-domain";
import { propagateNonBusinessOrigins } from "../lib/provenance-propagation";
import { bootstrapEventConsumers } from "../events/consumers";
import { outboxDrainer } from "./helpers/outbox-drain";
import { financeDashboardService } from "../services/finance-dashboard.service";
import { invoiceReportService } from "../services/invoice-report.service";
import { ratingService } from "../services/rating.service";
import { providerService } from "../services/provider.service";
import { statsService } from "../services/stats.service";
import { adminReviewService } from "../services/admin.service";
import { cacheService } from "../services/cache.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `apop-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let slotN = 0;
let seq = 0;

/** Inside the service's 30-day advance window: four non-overlapping slots a day, from day 2. */
function nextSlot(): Date {
  const n = slotN++;
  return istSlot(2 + Math.floor(n / 4), ["08:00", "11:00", "14:00", "17:00"][n % 4]);
}

function istSlot(daysAhead: number, hhmm = "10:00"): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

async function call(method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as any };
}

const outbox = outboxDrainer();
const drainOutbox = () => outbox.drain();

/** A booking made through the customer's own door: quote, then create. No provider (dispatch picks). */
async function book(who: "A" | "B"): Promise<{ status: number; json: any }> {
  const user = who === "A" ? ctx.customerA : ctx.customerB;
  const addressId = who === "A" ? ctx.addressAId : ctx.addressBId;
  const q = await call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, addressId }, bearer(user));
  if (q.status !== 200) return q;
  const r = await call(
    "POST",
    "/api/bookings",
    { serviceId: ctx.serviceId, addressId, scheduledDate: nextSlot().toISOString(), quoteToken: q.json.data.quote.quoteToken },
    bearer(user),
    { "Idempotency-Key": `${RUN}-${(seq += 1)}` },
  );
  return r;
}

const setUserOrigin = (id: string, origin: DataOrigin | null) => prisma.user.update({ where: { id }, data: { dataOrigin: origin } });
const setBooking = (id: string, data: { dataOrigin?: DataOrigin | null; userId?: string }) => prisma.booking.update({ where: { id }, data });
const bookingOrigin = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { dataOrigin: true } })).dataOrigin;

let originA: DataOrigin | null = null;
let originB: DataOrigin | null = null;
const created: string[] = [];

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  outbox.begin();
  bootstrapEventConsumers();
  ctx = await seedAdversarialFixtures(RUN);
  originA = (await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { dataOrigin: true } })).dataOrigin;
  originB = (await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerB.id }, select: { dataOrigin: true } })).dataOrigin;
}, 180_000);

afterAll(async () => {
  if (!dbOk) return;
  await outbox.restore();
  const users = [ctx?.customerA?.id, ctx?.customerB?.id].filter(Boolean) as string[];
  await prisma.analyticsEvent.deleteMany({ where: { OR: [{ eventId: { startsWith: RUN } }, { bookingId: { in: created } }, { actorUserId: { in: users } }] } });
  await prisma.$executeRaw`DELETE FROM booking_idempotency_keys WHERE user_id = ANY(${users})`;
  await prisma.rating.deleteMany({ where: { bookingId: { in: created } } });
  await prisma.payment.deleteMany({ where: { bookingId: { in: created } } });
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

/* ───────────────────────────── booking provenance at the creation boundary ───────────────────────────── */

describe.serial("15.3.2 — booking provenance is stamped where the booking is made", () => {
  test("a non-business customer's booking is born with the customer's label; the same booking is out of every booking KPI", async () => {
    expect(dbOk).toBe(true);
    expect(originA).not.toBeNull(); // the fixture customer is classified at signup (provenanceForNewUser)
    const r = await book("A");
    expect(r.status).toBe(201);
    const id = r.json.data.booking?.id ?? r.json.data.id;
    created.push(id);
    expect(await bookingOrigin(id)).toBe(originA as never);
    expect(await prisma.booking.count({ where: { id, ...analyticsWhere() } })).toBe(0);
  });

  test("a business (UNKNOWN) customer's booking stays NULL — creation never invents REAL — and IS business", async () => {
    await setUserOrigin(ctx.customerB.id, null);
    const r = await book("B");
    expect(r.status).toBe(201);
    const id = r.json.data.booking?.id ?? r.json.data.id;
    created.push(id);
    expect(await bookingOrigin(id)).toBeNull();
    expect(await prisma.booking.count({ where: { id, ...analyticsWhere() } })).toBe(1);
  });

  test("a business customer cannot book a non-commercial service: the quote and the booking are refused, nothing is written", async () => {
    const before = await prisma.booking.count({ where: { userId: ctx.customerB.id } });
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { dataOrigin: "TEST" } });
    try {
      const q = await call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, addressId: ctx.addressBId }, bearer(ctx.customerB));
      expect(q.status).not.toBe(200);
      const r = await call(
        "POST",
        "/api/bookings",
        { serviceId: ctx.serviceId, addressId: ctx.addressBId, scheduledDate: nextSlot().toISOString(), quoteToken: "x" },
        bearer(ctx.customerB),
      );
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.json.success).toBe(false);
    } finally {
      await prisma.service.update({ where: { id: ctx.serviceId }, data: { dataOrigin: null } });
    }
    expect(await prisma.booking.count({ where: { userId: ctx.customerB.id } })).toBe(before);
  });

  test("a customer labelled AFTER booking: propagation carries the label to the booking and its analytics rows; REAL and business rows are untouched", async () => {
    await setUserOrigin(ctx.customerB.id, null);
    const r = await book("B");
    expect(r.status).toBe(201);
    const late = r.json.data.booking?.id ?? r.json.data.id;
    created.push(late);
    const declaredReal = await book("B");
    const realId = declaredReal.json.data.booking?.id ?? declaredReal.json.data.id;
    created.push(realId);
    await setBooking(realId, { dataOrigin: "REAL" });
    await drainOutbox();
    const eventsBefore = await prisma.analyticsEvent.findMany({ where: { bookingId: late }, select: { dataOrigin: true } });
    expect(eventsBefore.length).toBeGreaterThan(0);
    expect(eventsBefore.every((e) => e.dataOrigin === null)).toBe(true);

    // The backfill classifies the customer by evidence found later.
    await setUserOrigin(ctx.customerB.id, "INFERRED_TEST");
    const carried = await propagateNonBusinessOrigins(prisma);
    expect(carried.bookings).toBeGreaterThanOrEqual(1);
    expect(await bookingOrigin(late)).toBe("INFERRED_TEST");
    expect(await bookingOrigin(realId)).toBe("REAL"); // a declared label is never overwritten
    const eventsAfter = await prisma.analyticsEvent.findMany({ where: { bookingId: late }, select: { dataOrigin: true } });
    expect(eventsAfter.every((e) => e.dataOrigin === "INFERRED_TEST")).toBe(true);
    // Idempotent: a second run has nothing left to write for these rows.
    await propagateNonBusinessOrigins(prisma);
    expect(await bookingOrigin(late)).toBe("INFERRED_TEST");
    await setUserOrigin(ctx.customerB.id, null);
  });
});

/* ───────────────────────────── 15.3.4 population matrix ───────────────────────────── */

type Row = { label: string; customer: "A" | "B"; customerOrigin: DataOrigin | null; bookingOrigin: DataOrigin | null; business: boolean };

/**
 * Expected inclusion is DERIVED from the policy, not chosen per row: a booking-scoped fact is
 * business iff the booking's own label is NULL or REAL, whatever its customer's label.
 */
const MATRIX: Row[] = [
  { label: "REAL customer + REAL booking", customer: "B", customerOrigin: "REAL", bookingOrigin: "REAL", business: true },
  { label: "REAL customer + TEST booking (business service + test booking)", customer: "B", customerOrigin: "REAL", bookingOrigin: "TEST", business: false },
  { label: "TEST customer + REAL booking (declared on the booking)", customer: "A", customerOrigin: "TEST", bookingOrigin: "REAL", business: true },
  { label: "TEST customer + TEST booking", customer: "A", customerOrigin: "TEST", bookingOrigin: "TEST", business: false },
  { label: "FIXTURE booking", customer: "A", customerOrigin: "TEST", bookingOrigin: "FIXTURE", business: false },
  { label: "CERTIFICATION booking", customer: "A", customerOrigin: "TEST", bookingOrigin: "CERTIFICATION", business: false },
  { label: "SYNTHETIC booking (inferred)", customer: "A", customerOrigin: "TEST", bookingOrigin: "INFERRED_SYNTHETIC", business: false },
  { label: "UNKNOWN customer + UNKNOWN booking", customer: "B", customerOrigin: null, bookingOrigin: null, business: true },
];

describe.serial("15.3.4 — population matrix across bookings, payments, reviews and customers", () => {
  const ids: string[] = [];
  const amountOf = (i: number) => 1000 + i * 37; // distinct, so a wrong row changes the sum visibly
  let gmvBefore = 0;
  let revenueBefore = 0;
  let statsBefore = { reviewCount: 0 };
  let adminBefore = { totalReviews: 0, flaggedReviews: 0, publishedReviews: 0 };

  test("arrange: eight real bookings, labelled the way provenance labels arrive (creation stamp or backfill), each paid and rated", async () => {
    gmvBefore = (await financeDashboardService.getOverview(1)).gmv;
    revenueBefore = (await invoiceReportService.adminRevenueReport()).streams.bookings;
    await cacheService.invalidate("stats:overview");
    statsBefore = await statsService.overview();
    adminBefore = (await adminReviewService.list({ page: "1", limit: "1" })).stats;

    await setUserOrigin(ctx.customerB.id, null);
    for (let i = 0; i < MATRIX.length; i++) {
      const r = await book("A");
      expect([MATRIX[i]!.label, r.status]).toEqual([MATRIX[i]!.label, 201]);
      const id = r.json.data.booking?.id ?? r.json.data.id;
      ids.push(id);
      created.push(id);
      const row = MATRIX[i]!;
      const userId = row.customer === "A" ? ctx.customerA.id : ctx.customerB.id;
      await setBooking(id, { dataOrigin: row.bookingOrigin, userId });
      await prisma.payment.create({
        data: {
          bookingId: id,
          userId,
          amount: amountOf(i),
          amountPaid: amountOf(i),
          paymentMethod: "razorpay",
          status: "SUCCESS",
          completedAt: new Date(),
          razorpayOrderId: `order_${RUN}_${i}`,
          idempotencyKey: `${RUN}-pay-${i}`,
        },
      });
      await prisma.rating.create({
        data: { bookingId: id, userId, providerId: ctx.providerId, stars: (i % 5) + 1, reviewText: `${RUN} review ${i}` },
      });
    }
    await setUserOrigin(ctx.customerA.id, "TEST");
    await setUserOrigin(ctx.customerB.id, "REAL");
  }, 180_000);

  test("bookings: business rows are exactly the ones the policy derives — REAL and UNKNOWN in, every other label out, customer label irrelevant", async () => {
    const inScope = await prisma.booking.findMany({ where: { id: { in: ids }, ...analyticsWhere() }, select: { id: true } });
    const expected = ids.filter((_, i) => MATRIX[i]!.business);
    expect(new Set(inScope.map((b) => b.id))).toEqual(new Set(expected));
    expect(expected.length).toBe(3); // REAL+REAL, TEST-customer+REAL-booking, UNKNOWN+UNKNOWN
  });

  test("payments inherit from the booking: the finance GMV and the revenue report grow by exactly the business payments", async () => {
    const businessSum = MATRIX.reduce((s, r, i) => (r.business ? s + amountOf(i) : s), 0);
    const gmvAfter = (await financeDashboardService.getOverview(1)).gmv;
    const revenueAfter = (await invoiceReportService.adminRevenueReport()).streams.bookings;
    expect(Math.round((gmvAfter - gmvBefore) * 100) / 100).toBe(businessSum);
    expect(Math.round((revenueAfter - revenueBefore) * 100) / 100).toBe(businessSum);
    const viaPolicy = await prisma.payment.aggregate({ where: { bookingId: { in: ids }, ...analyticsWhereVia("payment") }, _sum: { amountPaid: true } });
    expect(viaPolicy._sum.amountPaid).toBe(businessSum);
  });

  test("customers follow their own label: REAL counted, TEST not — independent of the bookings they hold", async () => {
    const scoped = await prisma.user.findMany({ where: { id: { in: [ctx.customerA.id, ctx.customerB.id] }, ...analyticsWhere() }, select: { id: true } });
    expect(scoped.map((u) => u.id)).toEqual([ctx.customerB.id]);
    await setUserOrigin(ctx.customerB.id, null); // UNKNOWN is business, by the documented policy
    expect(await prisma.user.count({ where: { id: ctx.customerB.id, ...analyticsWhere() } })).toBe(1);
    await setUserOrigin(ctx.customerB.id, "REAL");
  });

  test("public reviews: list, count, distribution and average are one population — business, public, unflagged", async () => {
    const svc = await ratingService.listPublicForService(ctx.serviceId, { limit: "30" });
    const businessStars = MATRIX.map((r, i) => (r.business ? (i % 5) + 1 : null)).filter((s): s is number => s != null);
    expect(svc.ratingCount).toBe(businessStars.length);
    expect(svc.total).toBe(businessStars.length);
    expect(Object.values(svc.distribution).reduce((a, b) => a + b, 0)).toBe(svc.ratingCount);
    const avg = Math.round((businessStars.reduce((a, b) => a + b, 0) / businessStars.length) * 10) / 10;
    expect(svc.averageRating).toBe(avg);
    for (const r of svc.reviews) expect(String(r.reviewText)).toContain(RUN);

    const pub = await providerService.reviews(ctx.providerId, { limit: "50" }, "public");
    expect(pub.ratingCount).toBe(businessStars.length);
    expect(pub.total).toBe(businessStars.length);
    expect(pub.reviews.every((r) => !("tipAmount" in r))).toBe(true);
    const own = await providerService.reviews(ctx.providerId, { limit: "50" }, "owner");
    expect(own.total).toBe(MATRIX.length); // the partner sees every review about them

    await cacheService.invalidate("stats:overview");
    const stats = await statsService.overview();
    expect(stats.reviewCount - statsBefore.reviewCount).toBe(businessStars.length);

    const admin = (await adminReviewService.list({ page: "1", limit: "1" })).stats;
    expect(admin.totalReviews - adminBefore.totalReviews).toBe(MATRIX.length); // moderation sees every row
    expect(admin.publishedReviews - adminBefore.publishedReviews).toBe(businessStars.length);
  });

  test("moderation moves every public figure together: flag → out, re-approve → back, hide → out", async () => {
    const businessIdx = MATRIX.findIndex((r) => r.business);
    const target = await prisma.rating.findUniqueOrThrow({ where: { bookingId: ids[businessIdx]! } });
    const count = async () => (await ratingService.listPublicForService(ctx.serviceId, {})).ratingCount;
    const base = await count();
    await adminReviewService.moderate(target.id, { isFlagged: true });
    expect(await count()).toBe(base - 1);
    expect((await providerService.reviews(ctx.providerId, {}, "public")).ratingCount).toBe(base - 1);
    await adminReviewService.moderate(target.id, { isFlagged: false });
    expect(await count()).toBe(base);
    await adminReviewService.moderate(target.id, { isPublic: false });
    expect(await count()).toBe(base - 1);
    const dist = (await ratingService.listPublicForService(ctx.serviceId, {})).distribution;
    expect(Object.values(dist).reduce((a, b) => a + b, 0)).toBe(base - 1);
    await adminReviewService.moderate(target.id, { isPublic: true });
  });

  test("admin review summary over HTTP (what the Reviews page and Marketplace HQ read): authoritative DB totals, independent of the page size", async () => {
    const get = (qs: string) => call("GET", `/api/admin/reviews${qs}`, undefined, bearer(ctx.superAdmin));
    const six = await get("?page=1&limit=6"); // Marketplace HQ's request
    const one = await get("?page=1&limit=1");
    expect([six.status, one.status]).toEqual([200, 200]);
    expect(six.json.data.reviews.length).toBeLessThanOrEqual(6);
    expect(six.json.data.stats).toEqual(one.json.data.stats); // never derived from the visible rows
    const { publicReviewWhere } = await import("../lib/public-reviews");
    const [total, hidden, flagged, published, avg] = await Promise.all([
      prisma.rating.count(),
      prisma.rating.count({ where: { isPublic: false } }),
      prisma.rating.count({ where: { isFlagged: true } }),
      prisma.rating.count({ where: publicReviewWhere() }),
      prisma.rating.aggregate({ where: publicReviewWhere(), _avg: { stars: true } }),
    ]);
    const s = six.json.data.stats;
    expect([s.totalReviews, s.hiddenReviews, s.flaggedReviews, s.publishedReviews]).toEqual([total, hidden, flagged, published]);
    expect(s.publishedAverageRating).toBe(avg._avg.stars == null ? null : Math.round(avg._avg.stars * 100) / 100);
    expect("averageRating" in s).toBe(false); // the retired contract is gone
  });

  test("test service + business booking (service reclassified after sale): the booking-scoped fact keeps the booking's label; the catalogue drops the service", async () => {
    const businessId = ids[0]!;
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { dataOrigin: "TEST" } });
    try {
      expect(await prisma.booking.count({ where: { id: businessId, ...analyticsWhere() } })).toBe(1);
      expect(await prisma.service.count({ where: { id: ctx.serviceId, ...CUSTOMER_CATALOG_WHERE } })).toBe(0);
    } finally {
      await prisma.service.update({ where: { id: ctx.serviceId }, data: { dataOrigin: null } });
    }
  });
});

/* ───────────────────────────── 15.3.3 event validity vs KPI eligibility ───────────────────────────── */

describe.serial("15.3.3 — a valid event is kept; KPI eligibility is a separate question", () => {
  test("a non-business actor's valid event persists with its label and is NOT business; a business actor's is", async () => {
    await setUserOrigin(ctx.customerA.id, "TEST");
    await setUserOrigin(ctx.customerB.id, "REAL");
    const base = { eventName: "SERVICE_VIEW", serviceId: ctx.serviceId, sessionId: `${RUN}-s`, source: "CUSTOMER_WEB", platform: "WEB" };
    const a = await call("POST", "/api/analytics/events", { ...base, eventId: `${RUN}-ev-a` }, bearer(ctx.customerA));
    const b = await call("POST", "/api/analytics/events", { ...base, eventId: `${RUN}-ev-b` }, bearer(ctx.customerB));
    expect([a.status, b.status]).toEqual([201, 201]);
    const rows = await prisma.analyticsEvent.findMany({ where: { eventId: { in: [`${RUN}-ev-a`, `${RUN}-ev-b`] } }, select: { eventId: true, dataOrigin: true } });
    expect(rows).toHaveLength(2); // both valid, both kept
    expect(rows.find((r) => r.eventId === `${RUN}-ev-a`)?.dataOrigin).toBe("TEST");
    expect(rows.find((r) => r.eventId === `${RUN}-ev-b`)?.dataOrigin).toBe("REAL");
    const business = await prisma.analyticsEvent.findMany({ where: { eventId: { in: [`${RUN}-ev-a`, `${RUN}-ev-b`] }, ...analyticsWhere() }, select: { eventId: true } });
    expect(business.map((r) => r.eventId)).toEqual([`${RUN}-ev-b`]);
  });

  test("a client cannot declare its own population: a dataOrigin in the body is ignored, the server's label stands", async () => {
    const r = await call(
      "POST",
      "/api/analytics/events",
      { eventId: `${RUN}-ev-forge`, eventName: "SERVICE_VIEW", serviceId: ctx.serviceId, sessionId: `${RUN}-s`, source: "CUSTOMER_WEB", platform: "WEB", dataOrigin: "REAL", metadata: { dataOrigin: "REAL" } },
      bearer(ctx.customerA),
    );
    expect(r.status).toBe(201);
    const row = await prisma.analyticsEvent.findUniqueOrThrow({ where: { eventId: `${RUN}-ev-forge` }, select: { dataOrigin: true } });
    expect(row.dataOrigin).toBe("TEST");
  });

  test("a booking-attached event takes the booking's label, not the actor's: TEST booking of a REAL customer is excluded", async () => {
    await setUserOrigin(ctx.customerB.id, "REAL");
    const r = await book("B");
    expect(r.status).toBe(201);
    const id = r.json.data.booking?.id ?? r.json.data.id;
    created.push(id);
    await setBooking(id, { dataOrigin: "TEST" });
    await drainOutbox();
    const ev = await prisma.analyticsEvent.findFirstOrThrow({ where: { bookingId: id, eventName: "BOOKING_CREATED" }, select: { dataOrigin: true, actorUserId: true } });
    expect(ev.actorUserId).toBe(ctx.customerB.id);
    expect(ev.dataOrigin).toBe("TEST");
    expect(await prisma.analyticsEvent.count({ where: { bookingId: id, ...analyticsWhere() } })).toBe(0);
  });
});

/* ───────────────────────────── 15.3.6 durability of the outbox-projected events ───────────────────────────── */

describe.serial("15.3.6 — committed business facts survive a down or crashed worker", () => {
  test("worker down: the booking commits, its event waits PENDING, and the analytics row lands once the worker drains", async () => {
    await setUserOrigin(ctx.customerB.id, null);
    const r = await book("B");
    expect(r.status).toBe(201);
    const id = r.json.data.booking?.id ?? r.json.data.id;
    created.push(id);
    const outbox = await prisma.eventOutbox.findFirstOrThrow({ where: { aggregateId: id, eventType: "homigo.booking.created" }, select: { status: true } });
    expect(outbox.status).toBe("PENDING");
    expect(await prisma.analyticsEvent.count({ where: { bookingId: id, eventName: "BOOKING_CREATED" } })).toBe(0);
    await drainOutbox();
    expect(await prisma.analyticsEvent.count({ where: { bookingId: id, eventName: "BOOKING_CREATED" } })).toBe(1);
  });

  test("worker crash mid-delivery: a stale PROCESSING claim is recovered and delivered exactly once; a redelivery adds nothing", async () => {
    const r = await book("B");
    expect(r.status).toBe(201);
    const id = r.json.data.booking?.id ?? r.json.data.id;
    created.push(id);
    // Simulate a worker that claimed the row and died before publishing.
    await prisma.eventOutbox.updateMany({
      where: { aggregateId: id, eventType: "homigo.booking.created" },
      data: { status: "PROCESSING", lockedAt: new Date(Date.now() - 24 * 3600_000), lockedBy: "dead-worker" },
    });
    expect(await prisma.analyticsEvent.count({ where: { bookingId: id, eventName: "BOOKING_CREATED" } })).toBe(0);
    const { recovered } = await drainOutbox();
    expect(recovered).toBeGreaterThanOrEqual(1);
    expect(await prisma.analyticsEvent.count({ where: { bookingId: id, eventName: "BOOKING_CREATED" } })).toBe(1);
    // Redelivery of the already-published event (the outbox's at-least-once contract).
    await prisma.eventOutbox.updateMany({ where: { aggregateId: id, eventType: "homigo.booking.created" }, data: { status: "PENDING", availableAt: new Date(0) } });
    await prisma.eventConsumerReceipt.deleteMany({ where: { consumerName: "analytics-funnel.v1", eventId: { in: (await prisma.eventOutbox.findMany({ where: { aggregateId: id }, select: { eventId: true } })).map((e) => e.eventId) } } });
    await drainOutbox();
    expect(await prisma.analyticsEvent.count({ where: { bookingId: id, eventName: "BOOKING_CREATED" } })).toBe(1);
  });
});
