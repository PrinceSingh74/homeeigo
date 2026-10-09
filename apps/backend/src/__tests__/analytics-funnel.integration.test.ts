/**
 * Phase 15.2 — the real customer funnel, end to end, into `analytics_events`.
 *
 * Every step below goes through the same door a customer uses: the public ingest endpoint for
 * the browse events, `POST /api/bookings/price-quote`, `POST /api/bookings`,
 * `POST /api/payments/create-order` / the wallet checkout, the partner's completion, the
 * customer's cancellation — and then the outbox is drained exactly as the processor drains it.
 * Nothing here writes an analytics row by hand and then claims the funnel produced it.
 *
 * Proven, in the order the section asks for it:
 *   view → click → variant → option → add-on → booking_started   (client door, authenticated)
 *   → quote_generated → booking_created → checkout_started           (backend door, via route + outbox)
 *   booking_completed, repeat_booking, cancelled                      (outbox projection)
 *   duplicates collapse (client replay, idempotent create, outbox redelivery, double complete,
 *   double cancel), failed operations record nothing, a client cannot mint a backend name, and
 *   provenance follows the actor / booking into the population policy.
 *
 * Isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { analyticsWhere, isBusinessRow } from "../lib/analytics-scope";
import { outboxDrainer } from "./helpers/outbox-drain";
import { bootstrapEventConsumers } from "../events/consumers";
import { projectFunnelDomainEvent } from "../services/analytics-funnel.service";
import { analyticsEnvironment } from "../services/analytics-events.service";
import { bookingService } from "../services/booking.service";
import type { HomigoEvent } from "../events/core/homigo-event";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  heartbeatFresh,
  payWithRealWallet,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `afn-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let day = 5;
let seq = 0;
const SESSION = `${RUN}-session`;
const eventId = (label: string) => `${RUN}-${label}-${(seq += 1)}`;

function istSlot(daysAhead: number, hhmm = "11:00"): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

async function call(method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, headers: res.headers, json: (await res.json()) as any };
}

const customer = () => bearer(ctx.customerA);

/** Drain the outbox the way the processor does — past other suites' leftover backlog. */
const outbox = outboxDrainer();
async function drainOutbox(): Promise<void> {
  await outbox.drain();
}

async function quoteFor(body: Record<string, unknown>) {
  const r = await call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, addressId: ctx.addressAId, ...body }, customer());
  return r;
}

async function createBooking(slot: Date, key: string) {
  const q = await quoteFor({});
  expect(q.status).toBe(200);
  const r = await call(
    "POST",
    "/api/bookings",
    { serviceId: ctx.serviceId, providerId: ctx.providerId, addressId: ctx.addressAId, scheduledDate: slot.toISOString(), quoteToken: q.json.data.quote.quoteToken },
    customer(),
    { "Idempotency-Key": key },
  );
  return r;
}

const rowsFor = (where: Record<string, unknown>) => prisma.analyticsEvent.findMany({ where, orderBy: { receivedAt: "asc" } });

/** The outbox row that carried one domain event for one booking (published or not). */
async function outboxEventFor(bookingId: string, type: string): Promise<HomigoEvent> {
  const rows = await prisma.eventOutbox.findMany({ where: { aggregateId: bookingId, eventType: type }, select: { payload: true } });
  expect(rows.length).toBe(1);
  return rows[0]!.payload as unknown as HomigoEvent;
}

let bookingOne = "";
let bookingTwo = "";
let bookingThree = "";
let actorOrigin: string | null = null;

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
  await prisma.serviceVariant.create({ data: { serviceId: ctx.serviceId, code: "deep", name: "Deep clean", price: 900 } });
  await prisma.serviceAddon.create({ data: { serviceId: ctx.serviceId, code: "balcony", name: "Balcony", price: 150 } });
  actorOrigin = (await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { dataOrigin: true } })).dataOrigin;
}, 180_000);

afterAll(async () => {
  if (!dbOk) return;
  const ids = [bookingOne, bookingTwo, bookingThree].filter(Boolean);
  await prisma.analyticsEvent.deleteMany({ where: { OR: [{ eventId: { startsWith: RUN } }, { bookingId: { in: ids } }, { actorUserId: ctx?.customerA?.id ?? "" }] } });
  await prisma.$executeRaw`DELETE FROM booking_idempotency_keys WHERE user_id = ${ctx?.customerA?.id ?? ""}`;
  await outbox.restore();
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("client door — browse and selection, from the customer's session", () => {
  test("service_view → service_click → variant → option → add-on → booking_started, each one row, attributed to the actor and the server's version", async () => {
    expect(dbOk).toBe(true);
    const service = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { version: true } });
    const base = { serviceId: ctx.serviceId, sessionId: SESSION, source: "CUSTOMER_WEB", platform: "WEB" };
    const steps: Array<[string, Record<string, unknown>]> = [
      ["SERVICE_VIEW", { eventId: eventId("view"), metadata: { page: "service-detail", slug: "adv" } }],
      ["SERVICE_CLICK", { eventId: eventId("click"), metadata: { surface: "card" } }],
      ["VARIANT_SELECTED", { eventId: eventId("variant"), variantId: "deep" }],
      ["OPTION_SELECTED", { eventId: eventId("option"), optionId: "women" }],
      ["ADDON_SELECTED", { eventId: eventId("addon"), addonId: "balcony" }],
      ["BOOKING_STARTED", { eventId: eventId("started"), metadata: { entry: "service-detail-cta" } }],
    ];
    for (const [eventName, extra] of steps) {
      const r = await call("POST", "/api/analytics/events", { ...base, eventName, ...extra }, customer());
      expect([eventName, r.status]).toEqual([eventName, 201]);
    }
    const rows = await rowsFor({ sessionId: SESSION });
    expect(rows.map((r) => String(r.eventName))).toEqual(steps.map(([n]) => n));
    for (const row of rows) {
      expect(row.actorUserId).toBe(ctx.customerA.id);
      expect(row.serviceId).toBe(ctx.serviceId);
      expect(row.serviceVersionId).toBe(service.version);
      expect(row.source).toBe("CUSTOMER_WEB");
      expect(row.platform).toBe("WEB");
      expect(row.dataOrigin).toBe(actorOrigin as never);
    }
    expect(rows.find((r) => r.eventName === "VARIANT_SELECTED")!.variantId).toBe("deep");
    expect(rows.find((r) => r.eventName === "OPTION_SELECTED")!.optionId).toBe("women");
    expect(rows.find((r) => r.eventName === "ADDON_SELECTED")!.addonId).toBe("balcony");
  });

  test("double-click, refresh, back/forward: the same deterministic id is one row, a different selection is another", async () => {
    const id = `${RUN}-view-dup`;
    const body = { eventId: id, eventName: "SERVICE_VIEW", serviceId: ctx.serviceId, sessionId: SESSION, source: "CUSTOMER_WEB", platform: "WEB" };
    const first = await call("POST", "/api/analytics/events", body, customer());
    const second = await call("POST", "/api/analytics/events", body, customer());
    const third = await call("POST", "/api/analytics/events", body, customer());
    expect([first.status, second.status, third.status]).toEqual([201, 200, 200]);
    expect(second.json.data.duplicate).toBe(true);
    expect(await prisma.analyticsEvent.count({ where: { eventId: id } })).toBe(1);

    // Variant A then variant B are two legitimate selections — two rows.
    await prisma.serviceVariant.create({ data: { serviceId: ctx.serviceId, code: "standard", name: "Standard", price: 500 } });
    const a = await call("POST", "/api/analytics/events", { ...body, eventId: eventId("var-a"), eventName: "VARIANT_SELECTED", variantId: "deep" }, customer());
    const b = await call("POST", "/api/analytics/events", { ...body, eventId: eventId("var-b"), eventName: "VARIANT_SELECTED", variantId: "standard" }, customer());
    expect([a.status, b.status]).toEqual([201, 201]);
  });

  test("a client cannot mint any backend-authoritative name", async () => {
    for (const eventName of ["QUOTE_GENERATED", "CHECKOUT_STARTED", "BOOKING_CREATED", "BOOKING_COMPLETED", "CANCELLED", "REPEAT_BOOKING"]) {
      const r = await call(
        "POST",
        "/api/analytics/events",
        { eventId: eventId("spoof"), eventName, serviceId: ctx.serviceId, bookingId: "whatever", sessionId: SESSION, source: "CUSTOMER_WEB", platform: "WEB" },
        customer(),
      );
      expect([eventName, r.status]).toEqual([eventName, 403]);
    }
    expect(await prisma.analyticsEvent.count({ where: { eventId: { startsWith: `${RUN}-spoof` } } })).toBe(0);
  });
});

describe.serial("backend door — quote", () => {
  test("quote_generated is recorded from the real quote, with its fingerprint, version and amount; the token never lands in metadata", async () => {
    const before = await prisma.analyticsEvent.count({ where: { eventName: "QUOTE_GENERATED", actorUserId: ctx.customerA.id } });
    const r = await quoteFor({ variantId: "deep" });
    expect(r.status).toBe(200);
    const q = r.json.data.quote;
    const rows = await rowsFor({ eventName: "QUOTE_GENERATED", actorUserId: ctx.customerA.id, quoteFingerprint: q.selectionFingerprint });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[rows.length - 1]!;
    expect(row.serviceId).toBe(ctx.serviceId);
    expect(row.serviceVersionId).toBe(q.serviceVersion);
    expect(row.variantId).toBe("deep");
    expect(row.source).toBe("BACKEND");
    expect(row.platform).toBe("SERVER");
    expect(row.dataOrigin).toBe(actorOrigin as never);
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.finalAmountPaise).toBe(q.finalAmountPaise);
    expect(Object.keys(meta).some((k) => /token|secret|card/i.test(k))).toBe(false);
    expect(JSON.stringify(meta)).not.toContain(q.quoteToken);
    expect(await prisma.analyticsEvent.count({ where: { eventName: "QUOTE_GENERATED", actorUserId: ctx.customerA.id } })).toBe(before + 1);
  });

  test("a quote that fails (stale catalogue version, another customer's address) records nothing", async () => {
    const before = await prisma.analyticsEvent.count({ where: { eventName: "QUOTE_GENERATED", actorUserId: ctx.customerA.id } });
    const stale = await quoteFor({ serviceVersion: 999_999 });
    expect(stale.status).toBe(409);
    const foreign = await quoteFor({ addressId: ctx.addressBId });
    expect(foreign.status).toBe(404);
    expect(await prisma.analyticsEvent.count({ where: { eventName: "QUOTE_GENERATED", actorUserId: ctx.customerA.id } })).toBe(before);
  });

  test("each successful quote answer is its own row, even when both responses carry the same token", async () => {
    const before = await prisma.analyticsEvent.count({ where: { eventName: "QUOTE_GENERATED", actorUserId: ctx.customerA.id } });
    const a = await quoteFor({ variantId: "deep", quantity: 1 });
    const b = await quoteFor({ variantId: "deep", quantity: 1 });
    expect([a.status, b.status]).toEqual([200, 200]);
    const after = await prisma.analyticsEvent.count({ where: { eventName: "QUOTE_GENERATED", actorUserId: ctx.customerA.id } });
    // signQuote expires on a whole second, so these two answers may share one token string.
    // The customer received both, so the funnel keeps both rows.
    expect(after - before).toBe(2);
    const rows = await rowsFor({ eventName: "QUOTE_GENERATED", actorUserId: ctx.customerA.id, quoteFingerprint: a.json.data.quote.selectionFingerprint });
    expect(new Set(rows.map((r) => r.eventId)).size).toBe(rows.length);
  });
});

describe.serial("backend door — booking created and checkout started, via the outbox", () => {
  test("booking_created follows the committed booking through the outbox, once, with the frozen catalogue version", async () => {
    await heartbeatFresh(ctx);
    const key = `${RUN}-create-${crypto.randomUUID()}`;
    const slot = istSlot((day += 1));
    const r = await createBooking(slot, key);
    expect(r.status).toBe(201);
    bookingOne = r.json.data.booking.id;

    // Nothing is in analytics before the outbox publishes — the fact is in `bookings`, not here.
    expect(await prisma.analyticsEvent.count({ where: { bookingId: bookingOne, eventName: "BOOKING_CREATED" } })).toBe(0);
    await drainOutbox();

    const rows = await rowsFor({ bookingId: bookingOne, eventName: "BOOKING_CREATED" });
    expect(rows.length).toBe(1);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingOne } });
    expect(rows[0]!.serviceId).toBe(booking.serviceId);
    expect(rows[0]!.serviceVersionId).toBe(booking.serviceConfigVersion);
    expect(rows[0]!.actorUserId).toBe(ctx.customerA.id);
    expect(rows[0]!.dataOrigin).toBe(booking.dataOrigin);
    expect(rows[0]!.source).toBe("BACKEND");
    expect((rows[0]!.metadata as any).status).toBe(booking.status);
    // The projection id is the outbox event id: a redelivery is the same row.
    const event = await outboxEventFor(bookingOne, "homigo.booking.created");
    expect(rows[0]!.eventId).toBe(`booking_created_${event.id}`);
  });

  test("an idempotent replay of the create and a redelivery of the outbox event both leave one booking_created row", async () => {
    const key = `${RUN}-replay-${crypto.randomUUID()}`;
    const slot = istSlot((day += 1));
    const first = await createBooking(slot, key);
    expect(first.status).toBe(201);
    bookingTwo = first.json.data.booking.id;
    const second = await call(
      "POST",
      "/api/bookings",
      { serviceId: ctx.serviceId, providerId: ctx.providerId, addressId: ctx.addressAId, scheduledDate: slot.toISOString(), quoteToken: (await quoteFor({})).json.data.quote.quoteToken },
      customer(),
      { "Idempotency-Key": key },
    );
    expect(second.status).toBe(200);
    expect(second.json.data.booking.id).toBe(bookingTwo);
    await drainOutbox();
    expect(await prisma.analyticsEvent.count({ where: { bookingId: bookingTwo, eventName: "BOOKING_CREATED" } })).toBe(1);

    // The consumer sees the same event again (a retried batch): still one row.
    const event = await outboxEventFor(bookingTwo, "homigo.booking.created");
    await projectFunnelDomainEvent(event);
    await projectFunnelDomainEvent(event);
    expect(await prisma.analyticsEvent.count({ where: { bookingId: bookingTwo, eventName: "BOOKING_CREATED" } })).toBe(1);
  });

  test("a booking create that fails records no booking_created", async () => {
    const before = await prisma.analyticsEvent.count({ where: { eventName: "BOOKING_CREATED", actorUserId: ctx.customerA.id } });
    const q = await quoteFor({});
    const r = await call(
      "POST",
      "/api/bookings",
      { serviceId: ctx.serviceId, providerId: ctx.providerId, addressId: ctx.addressBId, scheduledDate: istSlot((day += 1)).toISOString(), quoteToken: q.json.data.quote.quoteToken },
      customer(),
    );
    expect(r.status).toBeGreaterThanOrEqual(400);
    await drainOutbox();
    expect(await prisma.analyticsEvent.count({ where: { eventName: "BOOKING_CREATED", actorUserId: ctx.customerA.id } })).toBe(before);
  });

  test("checkout_started follows the gateway order through the outbox, once, without payment secrets", async () => {
    const o = await call("POST", "/api/payments/create-order", { bookingId: bookingOne }, customer());
    expect(o.status).toBe(200);
    // A second create-order reuses the same payment — no second checkout.
    const again = await call("POST", "/api/payments/create-order", { bookingId: bookingOne }, customer());
    expect(again.status).toBe(200);
    await drainOutbox();

    const rows = await rowsFor({ bookingId: bookingOne, eventName: "CHECKOUT_STARTED" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.serviceId).toBe(ctx.serviceId);
    expect(rows[0]!.actorUserId).toBe(ctx.customerA.id);
    const meta = rows[0]!.metadata as Record<string, unknown>;
    expect(meta.tender).toBe("gateway");
    expect(Object.keys(meta).some((k) => /token|secret|card|cvv|key/i.test(k))).toBe(false);
    expect(JSON.stringify(meta)).not.toMatch(/order_|pay_|rzp_/);
  });

  test("a wallet-only checkout — no Payment row, no outbox event — still records checkout_started once", async () => {
    await payWithRealWallet(bookingTwo, ctx.customerA.id);
    // Fire-and-forget after commit: give it a tick.
    await new Promise((r) => setTimeout(r, 300));
    const rows = await rowsFor({ bookingId: bookingTwo, eventName: "CHECKOUT_STARTED" });
    expect(rows.length).toBe(1);
    expect((rows[0]!.metadata as any).tender).toBe("wallet");
    expect(rows[0]!.eventId.startsWith("checkout_wallet_")).toBe(true);
  });
});

describe.serial("backend door — completion, repeat, cancellation", () => {
  test("booking_completed follows the authoritative COMPLETED commit; a second complete call adds nothing", async () => {
    await prisma.booking.update({ where: { id: bookingOne }, data: { status: "IN_PROGRESS", startedAt: new Date(), acceptedAt: new Date() } });
    const done = await bookingService.complete(ctx.providerId, bookingOne, null, null, "done");
    expect("error" in done).toBe(false);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingOne } })).status).toBe("COMPLETED");
    await drainOutbox();
    expect(await prisma.analyticsEvent.count({ where: { bookingId: bookingOne, eventName: "BOOKING_COMPLETED" } })).toBe(1);

    // The partner's app retries: the booking is already COMPLETED, nothing new is emitted or recorded.
    await bookingService.complete(ctx.providerId, bookingOne, null, null, "done-again").catch(() => undefined);
    await drainOutbox();
    const event = await outboxEventFor(bookingOne, "homigo.booking.completed");
    await projectFunnelDomainEvent(event);
    expect(await prisma.analyticsEvent.count({ where: { bookingId: bookingOne, eventName: "BOOKING_COMPLETED" } })).toBe(1);
  });

  test("repeat_booking follows the existing definition: a completion with an earlier completed booking by the same customer", async () => {
    // The fixture customer already owns one COMPLETED booking (the refund fixture), so bookingOne is
    // this customer's second completion and IS a repeat; a customer with none would get no row.
    const priorCompleted = await prisma.booking.count({ where: { userId: ctx.customerA.id, status: "COMPLETED", id: { not: bookingOne } } });
    const repeatOne = await rowsFor({ bookingId: bookingOne, eventName: "REPEAT_BOOKING" });
    expect(repeatOne.length).toBe(priorCompleted > 0 ? 1 : 0);

    await prisma.booking.update({ where: { id: bookingTwo }, data: { status: "IN_PROGRESS", startedAt: new Date(), acceptedAt: new Date() } });
    const done = await bookingService.complete(ctx.providerId, bookingTwo, null, null, "done");
    expect("error" in done).toBe(false);
    await drainOutbox();
    const repeatTwo = await rowsFor({ bookingId: bookingTwo, eventName: "REPEAT_BOOKING" });
    expect(repeatTwo.length).toBe(1);
    const meta = repeatTwo[0]!.metadata as Record<string, unknown>;
    expect(meta.definition).toBe("customer_completed_count_gt_1");
    expect(meta.sameService).toBe(true);
    expect(repeatTwo[0]!.serviceId).toBe(ctx.serviceId);
    expect(repeatTwo[0]!.actorUserId).toBe(ctx.customerA.id);
    // Redelivery of the completion event does not mint a second repeat.
    await projectFunnelDomainEvent(await outboxEventFor(bookingTwo, "homigo.booking.completed"));
    expect(await prisma.analyticsEvent.count({ where: { bookingId: bookingTwo, eventName: "REPEAT_BOOKING" } })).toBe(1);
  });

  test("cancelled follows the committed cancellation; a failed cancellation (already completed, already cancelled) records nothing", async () => {
    const key = `${RUN}-cancel-${crypto.randomUUID()}`;
    const r = await createBooking(istSlot((day += 1)), key);
    expect(r.status).toBe(201);
    bookingThree = r.json.data.booking.id;

    const c = await call("POST", `/api/bookings/${bookingThree}/cancel`, { reason: "Cancelled by user", cancelledBy: "user" }, customer());
    expect(c.status).toBe(200);
    await drainOutbox();
    const rows = await rowsFor({ bookingId: bookingThree, eventName: "CANCELLED" });
    expect(rows.length).toBe(1);
    expect((rows[0]!.metadata as any).cancelledBy).toBe("user");
    expect(rows[0]!.serviceId).toBe(ctx.serviceId);

    const again = await call("POST", `/api/bookings/${bookingThree}/cancel`, { reason: "again", cancelledBy: "user" }, customer());
    expect(again.status).toBeGreaterThanOrEqual(400);
    const completed = await call("POST", `/api/bookings/${bookingOne}/cancel`, { reason: "too late", cancelledBy: "user" }, customer());
    expect(completed.status).toBeGreaterThanOrEqual(400);
    await drainOutbox();
    expect(await prisma.analyticsEvent.count({ where: { bookingId: bookingThree, eventName: "CANCELLED" } })).toBe(1);
    expect(await prisma.analyticsEvent.count({ where: { bookingId: bookingOne, eventName: "CANCELLED" } })).toBe(0);
  });
});

describe.serial("population and provenance", () => {
  test("every funnel row of this fixture customer carries the actor's / booking's origin and sits outside the business population", async () => {
    const rows = await rowsFor({ OR: [{ actorUserId: ctx.customerA.id }, { sessionId: SESSION }] });
    expect(rows.length).toBeGreaterThan(10);
    expect(actorOrigin).not.toBeNull();
    for (const row of rows) {
      expect(row.dataOrigin).toBe(actorOrigin as never);
      expect(row.environment).toBe(analyticsEnvironment());
    }
    const business = await prisma.analyticsEvent.count({ where: { AND: [{ actorUserId: ctx.customerA.id }, analyticsWhere()] } });
    expect(isBusinessRow(actorOrigin as never)).toBe(false);
    expect(business).toBe(0);
  });
});
