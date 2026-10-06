/**
 * Phase 09 — bounded idempotency for booking create.
 *
 * The property: with an `Idempotency-Key`, N attempts of the SAME request produce exactly ONE
 * booking, however they are spaced — sequential retries, or all at once. And the guard is honest in
 * both directions: it never replays a booking for a DIFFERENT request under a reused key, and it
 * never touches a request that sends no key.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  heartbeatFresh,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import {
  bookingIdempotencyService,
  bookingRequestFingerprint,
  isValidIdempotencyKey,
} from "../services/booking-idempotency.service";

const RUN = `p09idem-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let day = 3;

function istSlot(daysAhead: number, hhmm = "10:00"): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

const quoteTokens = new Map<string, Promise<string | undefined>>();

async function tokenFor(body: Record<string, unknown>): Promise<string | undefined> {
  const key = JSON.stringify({
    serviceId: body.serviceId,
    addressId: body.addressId,
    quantity: body.quantity ?? null,
    variantId: body.variantId ?? null,
    addonIds: body.addonIds ?? null,
  });
  let pending = quoteTokens.get(key);
  if (!pending) {
    pending = (async () => {
      const quote = await app.handle(
        new Request("http://localhost/api/bookings/price-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(ctx.customerA)}` },
          body: JSON.stringify({
            serviceId: body.serviceId,
            addressId: body.addressId,
            quantity: body.quantity,
            variantId: body.variantId,
            addonIds: body.addonIds,
            addonQuantities: body.addonQuantities,
            packagePrice: body.packagePrice,
            couponCode: body.couponCode,
          }),
        }),
      );
      const quoted = (await quote.json()) as { data?: { quote?: { quoteToken?: string } } };
      return quoted.data?.quote?.quoteToken;
    })();
    quoteTokens.set(key, pending);
  }
  return pending;
}

async function post(body: Record<string, unknown>, key?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${bearer(ctx.customerA)}`,
  };
  if (key) headers["Idempotency-Key"] = key;
  const payload = body.quoteToken ? body : { ...body, quoteToken: await tokenFor(body) };
  const res = await app.handle(new Request("http://localhost/api/bookings", { method: "POST", headers, body: JSON.stringify(payload) }));
  return { status: res.status, replayed: res.headers.get("idempotent-replayed"), json: (await res.json()) as any };
}

const request = (slot: Date, extra: Record<string, unknown> = {}) => ({
  serviceId: ctx.serviceId,
  providerId: ctx.providerId,
  addressId: ctx.addressAId,
  scheduledDate: slot.toISOString(),
  ...extra,
});

const bookingsAt = (slot: Date) =>
  prisma.booking.count({ where: { userId: ctx.customerA.id, scheduledDate: slot, status: { notIn: ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER"] } } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.$executeRaw`DELETE FROM booking_idempotency_keys WHERE user_id = ${ctx?.customerA?.id ?? ""}`;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("key and fingerprint rules (pure)", () => {
  test("keys must be printable, without spaces, and within the length budget", () => {
    expect(isValidIdempotencyKey("3f1c9a2e-7b8d-4c1e-9a0b-6d5e4f3a2b1c")).toBe(true);
    expect(isValidIdempotencyKey("a".repeat(128))).toBe(true);
    expect(isValidIdempotencyKey("a".repeat(129))).toBe(false);
    expect(isValidIdempotencyKey("short")).toBe(false);
    expect(isValidIdempotencyKey("has space here")).toBe(false);
    expect(isValidIdempotencyKey("tab\there")).toBe(false);
  });

  test("the fingerprint ignores key order and add-on order, and sees every field that changes the booking", () => {
    const base = { serviceId: "s", addressId: "a", scheduledDate: "2026-12-24T04:30:00.000Z", addonIds: ["x", "y"] };
    expect(bookingRequestFingerprint(base)).toBe(bookingRequestFingerprint({ ...base, addonIds: ["y", "x"] }));
    expect(bookingRequestFingerprint(base)).toBe(bookingRequestFingerprint({ addonIds: ["x", "y"], scheduledDate: base.scheduledDate, addressId: "a", serviceId: "s" }));
    expect(bookingRequestFingerprint(base)).not.toBe(bookingRequestFingerprint({ ...base, scheduledDate: "2026-12-24T05:30:00.000Z" }));
    expect(bookingRequestFingerprint(base)).not.toBe(bookingRequestFingerprint({ ...base, quantity: 2 }));
    expect(bookingRequestFingerprint(base)).not.toBe(bookingRequestFingerprint({ ...base, couponCode: "SAVE10" }));
  });
});

describe.serial("over HTTP", () => {
  test("a retry with the same key replays the same booking — one row, 201 then 200", async () => {
    if (!dbOk) return;
    await heartbeatFresh(ctx);
    const slot = istSlot((day += 1));
    const key = `${RUN}-retry-${crypto.randomUUID()}`;

    const first = await post(request(slot), key);
    expect(first.status).toBe(201);
    const id = first.json.data.booking.id;

    const second = await post(request(slot), key);
    expect(second.status).toBe(200);
    expect(second.replayed).toBe("true");
    expect(second.json.replayed).toBe(true);
    expect(second.json.data.booking.id).toBe(id);
    expect(await bookingsAt(slot)).toBe(1);
  });

  test("the same key for a DIFFERENT request is refused, and creates nothing", async () => {
    if (!dbOk) return;
    const slotA = istSlot((day += 1));
    const slotB = istSlot((day += 1));
    const key = `${RUN}-reuse-${crypto.randomUUID()}`;
    const first = await post(request(slotA), key);
    expect(first.status).toBe(201);

    const other = await post(request(slotB), key);
    expect(other.status).toBe(409);
    expect(other.json.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await bookingsAt(slotB)).toBe(0);
  });

  test("a refused request does not burn the key: fix the request and the same key works", async () => {
    if (!dbOk) return;
    const key = `${RUN}-refused-${crypto.randomUUID()}`;
    // Refused INSIDE create (another customer's address), not by the route schema — so the key was
    // claimed by the guard and has to be released by it.
    const refused = await post(request(istSlot((day += 1)), { addressId: ctx.addressBId }), key);
    expect(refused.status).toBe(400);
    // Another customer's address cannot be quoted, so create stops at the quote gate and releases the key.
    expect(refused.json.code).toBe("QUOTE_REQUIRED");

    // Same key, corrected request: a first attempt, not a reuse and not a replay.
    const slot = istSlot((day += 1));
    const ok = await post(request(slot), key);
    expect(ok.status).toBe(201);
    expect(await bookingsAt(slot)).toBe(1);
  });

  test("a malformed key is refused up front and creates nothing", async () => {
    if (!dbOk) return;
    const slot = istSlot((day += 1));
    const bad = await post(request(slot), "no");
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("INVALID_IDEMPOTENCY_KEY");
    expect(await bookingsAt(slot)).toBe(0);
  });

  test("no key means today's behaviour: two identical requests are two attempts (the second collides on the slot)", async () => {
    if (!dbOk) return;
    const slot = istSlot((day += 1));
    const a = await post(request(slot));
    expect(a.status).toBe(201);
    const b = await post(request(slot));
    // Not a replay and not an idempotency refusal — the ordinary overlap rule, exactly as before.
    expect([400, 409]).toContain(b.status);
    expect(["OVERLAPPING_BOOKING", "PROVIDER_UNAVAILABLE"]).toContain(b.json.code);
    expect(b.replayed).toBeNull();
  });

  test("20 concurrent identical requests with one key → exactly one booking, the rest replay or wait", async () => {
    if (!dbOk) return;
    await heartbeatFresh(ctx);
    const slot = istSlot((day += 1), "12:00");
    const key = `${RUN}-race-${crypto.randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => post(request(slot), key)));

    const created = results.filter((r) => r.status === 201);
    const replayed = results.filter((r) => r.status === 200 && r.replayed === "true");
    const inFlight = results.filter((r) => r.status === 409 && r.json.code === "IDEMPOTENCY_IN_PROGRESS");
    const other = results.filter((r) => ![201, 200, 409].includes(r.status) || (r.status === 409 && r.json.code !== "IDEMPOTENCY_IN_PROGRESS"));

    expect(created.length).toBe(1);
    expect(other).toEqual([]);
    expect(created.length + replayed.length + inFlight.length).toBe(20);
    const ids = new Set([...created, ...replayed].map((r) => r.json.data.booking.id));
    expect(ids.size).toBe(1);
    expect(await bookingsAt(slot)).toBe(1);

    // Whoever was told "in flight" retries and gets the replay.
    if (inFlight.length > 0) {
      const again = await post(request(slot), key);
      expect(again.status).toBe(200);
      expect(again.json.data.booking.id).toBe(created[0]!.json.data.booking.id);
    }
  });
});

describe.serial("bounded", () => {
  test("an expired key is reclaimed by the next request rather than replaying a stale answer", async () => {
    if (!dbOk) return;
    const key = `${RUN}-expired-${crypto.randomUUID()}`;
    const slot = istSlot((day += 1));
    const first = await post(request(slot), key);
    expect(first.status).toBe(201);

    // Age the record past its lifetime.
    await prisma.$executeRaw`UPDATE booking_idempotency_keys SET expires_at = NOW() - INTERVAL '1 minute' WHERE key = ${key}`;

    // Same key, a different request: not a reuse refusal — the old record is expired and reclaimed.
    const slot2 = istSlot((day += 1));
    const second = await post(request(slot2), key);
    expect(second.status).toBe(201);
    expect(second.json.data.booking.id).not.toBe(first.json.data.booking.id);
  });

  test("the sweep removes expired records and reports a real count", async () => {
    if (!dbOk) return;
    const keys = Array.from({ length: 3 }, (_, i) => `${RUN}-sweep-${i}-${crypto.randomUUID()}`);
    for (const k of keys) {
      const claim = await bookingIdempotencyService.begin(ctx.customerA.id, k, "hash");
      expect(claim.state).toBe("PROCEED");
    }
    await prisma.$executeRaw`UPDATE booking_idempotency_keys SET expires_at = NOW() - INTERVAL '1 minute' WHERE key = ANY(${keys})`;
    const before = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM booking_idempotency_keys WHERE key = ANY(${keys})`;
    expect(Number(before[0]!.n)).toBe(3);

    const swept = await bookingIdempotencyService.sweepExpired();
    expect(swept).toBeGreaterThanOrEqual(3);
    const after = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM booking_idempotency_keys WHERE key = ANY(${keys})`;
    expect(Number(after[0]!.n)).toBe(0);
  });

  test("a completed record whose booking is deleted becomes unreplayable, never a phantom", async () => {
    if (!dbOk) return;
    const key = `${RUN}-orphan-${crypto.randomUUID()}`;
    const slot = istSlot((day += 1));
    const first = await post(request(slot), key);
    expect(first.status).toBe(201);
    const id = first.json.data.booking.id;
    await prisma.payment.deleteMany({ where: { bookingId: id } });
    await prisma.booking.delete({ where: { id } });

    const again = await post(request(slot), key);
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});

describe.serial("the deployed mobile offline queue contract", () => {
  /**
   * §42/§78 — the mobile app's offline queue replays a queued booking with its queue id as the
   * `Idempotency-Key`, and treats a 409 as PERMANENT unless the code is `IDEMPOTENCY_IN_PROGRESS`
   * (lib/offline/queue-core.ts `isPermanentFailure`). A server that answered with any other code
   * for the in-flight case made the queue DROP the booking silently. The deployed client's contract
   * is authoritative, so these assertions pin the exact strings it keys on.
   */
  test("an in-flight duplicate answers 409 IDEMPOTENCY_IN_PROGRESS — the code the client retries", async () => {
    if (!dbOk) return;
    const slot = istSlot((day += 1), "13:00");
    const key = `${RUN}-mobile-${crypto.randomUUID()}`;
    // Two at once: one wins, and any loser must be told to retry, never to give up.
    const [a, b] = await Promise.all([post(request(slot), key), post(request(slot), key)]);
    const inFlight = [a, b].filter((r) => r.status === 409 && r.json.code === "IDEMPOTENCY_IN_PROGRESS");
    const replays = [a, b].filter((r) => r.status === 200 && r.replayed === "true");
    const created = [a, b].filter((r) => r.status === 201);

    expect(created.length).toBe(1);
    expect(inFlight.length + replays.length).toBe(1);
    // Whichever the loser got, it must not be a code the queue treats as permanent.
    for (const r of [a, b]) {
      if (r.status === 409) expect(r.json.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    }
  });

  test("a queue id from the mobile generator is accepted as a key", async () => {
    if (!dbOk) return;
    // Exactly the shape `makeQueueId()` produces: `${Date.now()}-${8 random base36}`.
    const queueId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const slot = istSlot((day += 1), "14:00");
    const res = await post(request(slot), queueId);
    expect(res.status).toBe(201);
    // …and replays the same booking on the retry the queue would perform.
    const retry = await post(request(slot), queueId);
    expect(retry.status).toBe(200);
    expect(retry.json.data.booking.id).toBe(res.json.data.booking.id);
  });
});
