/**
 * Phase 15.3 — fault injection for booking provenance (fail closed) and analytics durability.
 *
 * Real isolated database, real app, real outbox. The ONLY change is a proxy over the real Prisma
 * client that can make one specific call fail on demand. `spyOn(prisma.model, ...)` cannot patch the
 * `$extends`-wrapped client (see data-archival-failure-injection.inject.ts), so the module is
 * replaced with `mock.module` — which is process-global, hence the `.inject.ts` suffix: this file
 * runs as its own `bun test` process, never combined with others.
 *
 * Proven:
 *   - an unreadable customer origin refuses the booking: 503, no booking, no outbox event, no
 *     analytics row, idempotency key released — and the same key succeeds once the read recovers.
 *   - outbox-projected analytics (booking_created …) are DURABLE: a transient write failure is
 *     retried inline; a persistent one is dead-lettered and replays to exactly one row.
 *   - quote_generated and wallet-only checkout_started are BEST-EFFORT: a write failure leaves the
 *     business result untouched and the analytics row is lost — nothing retries it.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import realPrismaImport from "../lib/prisma";

const REAL = realPrismaImport;
const faults = {
  /** Fail this many origin-only user reads (a transient blip), then behave. */
  originReadFailures: 0,
  /** Throw this many times from analyticsEvent.create, then behave. -1 = always. */
  analyticsCreateFailures: 0,
};

const isOriginOnlyRead = (args: unknown) => {
  const select = (args as { select?: Record<string, unknown> } | undefined)?.select;
  return !!select && Object.keys(select).length === 1 && select.dataOrigin === true;
};

function delegateProxy(name: string, delegate: object): object {
  return new Proxy(delegate, {
    get(d, m) {
      const f = Reflect.get(d, m) as unknown;
      if (name === "user" && m === "findUnique") {
        return (args: unknown) => {
          if (faults.originReadFailures > 0 && isOriginOnlyRead(args)) {
            faults.originReadFailures -= 1;
            return Promise.reject(new Error("injected: connection terminated reading users.data_origin"));
          }
          return (f as (a: unknown) => unknown).call(d, args);
        };
      }
      if (name === "analyticsEvent" && m === "create") {
        return (args: unknown) => {
          if (faults.analyticsCreateFailures !== 0) {
            if (faults.analyticsCreateFailures > 0) faults.analyticsCreateFailures -= 1;
            return Promise.reject(new Error("injected: connection terminated writing analytics_events"));
          }
          return (f as (a: unknown) => unknown).call(d, args);
        };
      }
      return typeof f === "function" ? (f as (...a: unknown[]) => unknown).bind(d) : f;
    },
  });
}

const proxied = new Proxy(REAL as object, {
  get(target, prop) {
    const v = Reflect.get(target, prop) as unknown;
    if ((prop === "user" || prop === "analyticsEvent") && v && typeof v === "object") return delegateProxy(prop, v);
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  },
});

mock.module("../lib/prisma", () => ({ default: proxied, prisma: proxied }));

const { default: app } = await import("../index");
const { bootstrapEventConsumers } = await import("../events/consumers");
const { replayDeadLetterById } = await import("../events/core/replay");
const { ANALYTICS_FUNNEL_CONSUMER_NAME } = await import("../events/consumers/analytics-funnel.consumer");
const fixtures = await import("./helpers/adversarial-fixtures");
const { refuseIfNotIsolatedTestDb } = await import("./helpers/isolated-test-db");
const { outboxDrainer } = await import("./helpers/outbox-drain");
const { walletService } = await import("../services/wallet.service");
const { walletCheckoutService } = await import("../services/wallet-checkout.service");

const RUN = `adur-${Date.now().toString(36)}`;
let ctx: Awaited<ReturnType<typeof fixtures.seedAdversarialFixtures>>;
let dbOk = false;
let slotN = 0;
let seq = 0;
const created: string[] = [];
const outbox = outboxDrainer();

function nextSlot(): Date {
  const n = slotN++;
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + (2 + Math.floor(n / 4)) * 86_400_000));
  return new Date(`${ymd}T${["08:00", "11:00", "14:00", "17:00"][n % 4]}:00+05:30`);
}

async function call(method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, headers: res.headers, json: (await res.json()) as any };
}

const token = () => fixtures.bearer(ctx.customerB);
const quote = () => call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, addressId: ctx.addressBId }, token());
const create = (quoteToken: string, key: string) =>
  call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressBId, scheduledDate: nextSlot().toISOString(), quoteToken }, token(), { "Idempotency-Key": key });

async function bookOk(): Promise<string> {
  const q = await quote();
  expect(q.status).toBe(200);
  const r = await create(q.json.data.quote.quoteToken, `${RUN}-${(seq += 1)}`);
  expect(r.status).toBe(201);
  created.push(r.json.data.booking.id);
  return r.json.data.booking.id;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await fixtures.dbReachable();
  if (!dbOk) return;
  const [{ db }] = await REAL.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  outbox.begin();
  bootstrapEventConsumers();
  ctx = await fixtures.seedAdversarialFixtures(RUN);
  // A business (UNKNOWN) customer: the population a fail-open would have silently joined.
  await REAL.user.update({ where: { id: ctx.customerB.id }, data: { dataOrigin: null } });
}, 180_000);

afterAll(async () => {
  faults.originReadFailures = 0;
  faults.analyticsCreateFailures = 0;
  if (!dbOk) return;
  await outbox.restore();
  await REAL.analyticsEvent.deleteMany({ where: { OR: [{ bookingId: { in: created } }, { actorUserId: ctx?.customerB?.id ?? "" }] } });
  await REAL.eventDeadLetter.deleteMany({ where: { consumerName: ANALYTICS_FUNNEL_CONSUMER_NAME, eventId: { in: (await REAL.eventOutbox.findMany({ where: { aggregateId: { in: created } }, select: { eventId: true } })).map((e) => e.eventId) } } });
  await REAL.$executeRaw`DELETE FROM booking_idempotency_keys WHERE user_id = ${ctx?.customerB?.id ?? ""}`;
  await fixtures.cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("15.3.2 — customer provenance unreadable → booking refused (fail closed)", () => {
  /**
   * The customer is NON-business (the fixture customer, classified at signup). Under the old
   * `.catch(() => null)` a one-off read failure stamped their booking NULL — business — and every
   * later read succeeded, so nothing else noticed: test traffic silently entered every KPI.
   */
  test("transient origin read failure for a non-business customer: 503 PROVENANCE_UNAVAILABLE, nothing written; the retry books with the customer's label", async () => {
    expect(dbOk).toBe(true);
    const customer = ctx.customerA;
    const origin = (await REAL.user.findUniqueOrThrow({ where: { id: customer.id }, select: { dataOrigin: true } })).dataOrigin;
    expect(origin).not.toBeNull();
    const bookingsBefore = await REAL.booking.count({ where: { userId: customer.id } });
    const outboxBefore = await REAL.eventOutbox.count({ where: { eventType: "homigo.booking.created" } });
    const paymentsBefore = await REAL.payment.count({ where: { userId: customer.id } }); // the seed pays one
    const quoteA = () => call("POST", "/api/bookings/price-quote", { serviceId: ctx.serviceId, addressId: ctx.addressAId }, fixtures.bearer(customer));
    const createA = (quoteToken: string, key: string) =>
      call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: nextSlot().toISOString(), quoteToken }, fixtures.bearer(customer), { "Idempotency-Key": key });
    const q = await quoteA();
    expect(q.status).toBe(200);
    const key = `${RUN}-failclosed`;

    faults.originReadFailures = 1;
    const refused = await createA(q.json.data.quote.quoteToken, key);
    faults.originReadFailures = 0;

    expect(refused.status).toBe(503);
    expect(refused.json).toMatchObject({ success: false, code: "PROVENANCE_UNAVAILABLE" });
    expect(refused.headers.get("Retry-After")).toBe("3");
    expect(await REAL.booking.count({ where: { userId: customer.id } })).toBe(bookingsBefore);
    expect(await REAL.eventOutbox.count({ where: { eventType: "homigo.booking.created" } })).toBe(outboxBefore);
    expect(await REAL.analyticsEvent.count({ where: { actorUserId: customer.id, eventName: "BOOKING_CREATED" } })).toBe(0);
    expect(await REAL.payment.count({ where: { userId: customer.id } })).toBe(paymentsBefore);

    // Not a poisoned key: once the read recovers, the identical request books — with the label.
    const q2 = await quoteA();
    const ok = await createA(q2.json.data.quote.quoteToken, key);
    expect(ok.status).toBe(201);
    created.push(ok.json.data.booking.id);
    const row = await REAL.booking.findUniqueOrThrow({ where: { id: ok.json.data.booking.id }, select: { dataOrigin: true } });
    expect(row.dataOrigin).toBe(origin as never);
  });
});

describe.serial("15.3.6 — outbox-projected analytics are DURABLE", () => {
  test("transient analytics write failure: the consumer retries inline and the row lands exactly once", async () => {
    const id = await bookOk();
    faults.analyticsCreateFailures = 1;
    await outbox.drain();
    faults.analyticsCreateFailures = 0;
    expect(await REAL.analyticsEvent.count({ where: { bookingId: id, eventName: "BOOKING_CREATED" } })).toBe(1);
  }, 60_000);

  test("persistent failure: the booking stands, the event is dead-lettered (auditable), and replay lands exactly one row", async () => {
    const id = await bookOk();
    faults.analyticsCreateFailures = -1;
    await outbox.drain();
    faults.analyticsCreateFailures = 0;

    expect(await REAL.booking.count({ where: { id } })).toBe(1); // the business fact is untouched
    expect(await REAL.analyticsEvent.count({ where: { bookingId: id, eventName: "BOOKING_CREATED" } })).toBe(0);
    const ev = await REAL.eventOutbox.findFirstOrThrow({ where: { aggregateId: id, eventType: "homigo.booking.created" }, select: { eventId: true } });
    const dlq = await REAL.eventDeadLetter.findFirstOrThrow({ where: { eventId: ev.eventId, consumerName: ANALYTICS_FUNNEL_CONSUMER_NAME } });

    const replay = await replayDeadLetterById(dlq.id, true);
    expect(replay.replayed).toBe(true);
    expect(await REAL.analyticsEvent.count({ where: { bookingId: id, eventName: "BOOKING_CREATED" } })).toBe(1);
    // A second (forced) replay is a duplicate, collapsed on the deterministic event id.
    await replayDeadLetterById(dlq.id, true).catch(() => undefined);
    expect(await REAL.analyticsEvent.count({ where: { bookingId: id, eventName: "BOOKING_CREATED" } })).toBe(1);
  }, 60_000);
});

describe.serial("15.3.6 — the after-commit recorders are BEST-EFFORT (classified, not hidden)", () => {
  test("quote_generated: a failed analytics write does not fail the quote — and the row is lost", async () => {
    const quotes = () => REAL.analyticsEvent.count({ where: { eventName: "QUOTE_GENERATED", actorUserId: ctx.customerB.id } });
    const before = await quotes();
    faults.analyticsCreateFailures = -1;
    const q = await quote();
    faults.analyticsCreateFailures = 0;
    expect(q.status).toBe(200);
    expect(q.json.data.quote.quoteToken).toBeTruthy();
    expect(await quotes()).toBe(before);
    // Control: the same request without the fault IS recorded — the absence above is the fault.
    expect((await quote()).status).toBe(200);
    expect(await quotes()).toBe(before + 1);
  });

  test("wallet-only checkout_started: the payment commits, the analytics row is lost, and nothing (no outbox row) will ever retry it", async () => {
    const id = await bookOk();
    const booking = await REAL.booking.findUniqueOrThrow({ where: { id }, select: { finalAmount: true } });
    const topUp = await walletService.addMoney(ctx.customerB.id, booking.finalAmount);
    if ("error" in topUp) throw new Error(String(topUp.error));
    await walletService.verifyTopUp(ctx.customerB.id, { razorpayOrderId: topUp.razorpayOrderId, razorpayPaymentId: `pay_${RUN}`, razorpaySignature: "fixture" });

    faults.analyticsCreateFailures = -1;
    const paid = await walletCheckoutService.payBookingFromWallet(ctx.customerB.id, id);
    await new Promise((r) => setTimeout(r, 750)); // the recorder runs after the response, unawaited
    faults.analyticsCreateFailures = 0;

    expect("ok" in paid && paid.ok).toBe(true);
    const after = await REAL.booking.findUniqueOrThrow({ where: { id }, select: { paymentStatus: true } });
    expect(after.paymentStatus).toBe("SUCCESS");
    expect(await REAL.analyticsEvent.count({ where: { bookingId: id, eventName: "CHECKOUT_STARTED" } })).toBe(0);
    const [{ n }] = await REAL.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM event_outbox WHERE event_type = 'homigo.checkout.started' AND payload->'data'->>'bookingId' = ${id}`;
    expect(n).toBe(0);
    await outbox.drain();
    expect(await REAL.analyticsEvent.count({ where: { bookingId: id, eventName: "CHECKOUT_STARTED" } })).toBe(0);
  }, 60_000);
});
