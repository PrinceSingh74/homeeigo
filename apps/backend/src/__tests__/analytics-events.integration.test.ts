/**
 * Phase 15.1 — the funnel event store and its ingest boundary.
 *
 * What this proves, in the order the section asks for it: a valid event is stored with the
 * context it claims, a malformed one is refused, a client cannot mint a backend-authoritative
 * name, a redelivery does not double-count, a variant/add-on belonging to another service is
 * refused, an unknown service or version is refused, and provenance is stamped from the server's
 * own view of the actor (or the booking) so a fixture actor never lands in the business
 * population while a business actor does.
 *
 * Runs on the isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { analyticsWhere } from "../lib/analytics-scope";
import { recordAuthoritativeEvent, analyticsEnvironment } from "../services/analytics-events.service";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  fixturePhone,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { LIVE_FIXTURE_SERVICE } from "./helpers/live-fixture-service";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `aev-${Date.now().toString(36)}`;
const TAG = `adv-${RUN}`;
let ctx: AdvCtx;
let dbOk = false;

/** Second service, so a variant of one can be offered against the other. */
let otherServiceId = "";
let draftServiceId = "";
/** A customer the server considers business (declared REAL), unlike the @adv.test fixtures. */
let businessUserId = "";
let businessToken = "";
let fixtureBookingId = "";

let seq = 0;
const eventId = (label: string) => `${RUN}-${label}-${(seq += 1)}`;

type PostResult = { status: number; body: { success: boolean; error?: string; data?: { id: string; duplicate: boolean } } };

async function post(body: Record<string, unknown>, token?: string): Promise<PostResult> {
  const res = await app.handle(
    new Request("http://localhost/api/analytics/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as PostResult["body"] };
}

/** A well-formed anonymous service_view, which individual tests then spoil one field at a time. */
function view(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: eventId("view"),
    eventName: "SERVICE_VIEW",
    serviceId: ctx.serviceId,
    sessionId: `${RUN}-session-anon`,
    source: "CUSTOMER_WEB",
    platform: "WEB",
    ...extra,
  };
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);

  await prisma.serviceVariant.create({
    data: { serviceId: ctx.serviceId, code: "deep", name: "Deep clean", price: 900 },
  });
  await prisma.serviceAddon.create({
    data: { serviceId: ctx.serviceId, code: "balcony", name: "Balcony", price: 150 },
  });

  const other = await prisma.service.create({
    data: {
      ...LIVE_FIXTURE_SERVICE,
      name: `Adv Other ${TAG}`,
      slug: `adv-other-${TAG}`,
      description: "Second service for cross-service checks",
      category: "cleaning",
      basePrice: 400,
      estimatedDuration: 60,
      availableCities: ["Noida"],
    },
  });
  otherServiceId = other.id;
  await prisma.serviceVariant.create({
    data: { serviceId: otherServiceId, code: "other-only", name: "Other only", price: 500 },
  });

  // Defaults make a new row a draft (migration 20261006190000) — exactly the unpublished case.
  const draft = await prisma.service.create({
    data: {
      name: `Adv Draft ${TAG}`,
      slug: `adv-draft-${TAG}`,
      description: "Draft service",
      category: "cleaning",
      basePrice: 400,
      estimatedDuration: 60,
    },
  });
  draftServiceId = draft.id;

  const businessUser = await prisma.user.create({
    data: {
      email: `${TAG}-biz@adv.test`,
      phoneNumber: fixturePhone(RUN, "biz"),
      firstName: "Business",
      lastName: "Customer",
      password: "x",
      role: "CUSTOMER",
      isEmailVerified: true,
      // Declared, not inferred: this row stands in for a genuine customer so the predicate's
      // INCLUDE side is proven, not only its exclude side.
      dataOrigin: "REAL",
    },
  });
  businessUserId = businessUser.id;
  businessToken = bearer(businessUser);

  const booking = await prisma.booking.findFirstOrThrow({
    where: { userId: ctx.customerA.id },
    select: { id: true },
  });
  fixtureBookingId = booking.id;
}, 180_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.analyticsEvent.deleteMany({ where: { eventId: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: businessUserId } }).catch(() => {});
  await prisma.service.deleteMany({ where: { id: { in: [otherServiceId, draftServiceId].filter(Boolean) } } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("POST /api/analytics/events", () => {
  test("stores a valid anonymous service_view with the service version the server resolved", async () => {
    expect(dbOk).toBe(true);
    const id = eventId("valid");
    const r = await post(view({ eventId: id }));
    expect(r.status).toBe(201);
    expect(r.body.success).toBe(true);

    const service = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { version: true } });
    const row = await prisma.analyticsEvent.findUniqueOrThrow({ where: { eventId: id } });
    expect(row.eventName).toBe("SERVICE_VIEW");
    expect(row.serviceId).toBe(ctx.serviceId);
    expect(row.serviceVersionId).toBe(service.version);
    expect(row.sessionId).toBe(`${RUN}-session-anon`);
    expect(row.environment).toBe(analyticsEnvironment());
    expect(row.actorUserId).toBeNull();
    expect(row.bookingId).toBeNull();
  });

  test("a variant / option / add-on event is accepted only for a selection the service actually has", async () => {
    const good = await post(
      view({ eventId: eventId("variant-ok"), eventName: "VARIANT_SELECTED", variantId: "deep" }),
    );
    expect(good.status).toBe(201);

    const addon = await post(
      view({ eventId: eventId("addon-ok"), eventName: "ADDON_SELECTED", addonId: "balcony" }),
    );
    expect(addon.status).toBe(201);

    const option = await post(
      view({ eventId: eventId("option-ok"), eventName: "OPTION_SELECTED", optionId: "women" }),
    );
    expect(option.status).toBe(201);

    const unknownVariant = await post(
      view({ eventId: eventId("variant-bad"), eventName: "VARIANT_SELECTED", variantId: "no-such-variant" }),
    );
    expect(unknownVariant.status).toBe(400);
    expect(unknownVariant.body.error).toBe("VARIANT_NOT_ON_SERVICE");

    const unknownAddon = await post(
      view({ eventId: eventId("addon-bad"), eventName: "ADDON_SELECTED", addonId: "no-such-addon" }),
    );
    expect(unknownAddon.body.error).toBe("ADDON_NOT_ON_SERVICE");
  });

  test("a variant of another service is refused against this one", async () => {
    const r = await post(
      view({ eventId: eventId("cross"), eventName: "VARIANT_SELECTED", variantId: "other-only" }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("VARIANT_NOT_ON_SERVICE");

    const sameVariantOnItsOwnService = await post(
      view({
        eventId: eventId("cross-ok"),
        eventName: "VARIANT_SELECTED",
        serviceId: otherServiceId,
        variantId: "other-only",
      }),
    );
    expect(sameVariantOnItsOwnService.status).toBe(201);
  });

  test("an unknown service, an unpublished service and an unknown version are each refused", async () => {
    const unknown = await post(view({ eventId: eventId("svc-missing"), serviceId: "svc_does_not_exist" }));
    expect(unknown.body.error).toBe("SERVICE_NOT_FOUND");

    const draft = await post(view({ eventId: eventId("svc-draft"), serviceId: draftServiceId }));
    expect(draft.body.error).toBe("SERVICE_NOT_VISIBLE");

    const badVersion = await post(view({ eventId: eventId("ver-bad"), serviceVersionId: 9_999 }));
    expect(badVersion.body.error).toBe("SERVICE_VERSION_NOT_FOUND");
  });

  test("malformed events are refused and nothing is written", async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["eventId too short", { eventId: "x" }],
      ["unknown name", { eventId: eventId("m1"), eventName: "SERVICE_HOVERED" }],
      ["unknown source", { eventId: eventId("m2"), source: "CARRIER_PIGEON" }],
      ["unknown platform", { eventId: eventId("m3"), platform: "FAX" }],
      ["unparseable timestamp", { eventId: eventId("m4"), occurredAt: "not-a-date" }],
      ["timestamp far in the future", { eventId: eventId("m5"), occurredAt: new Date(Date.now() + 86_400_000).toISOString() }],
      ["missing serviceId on a service event", { eventId: eventId("m6"), serviceId: undefined }],
      ["variant event with no variant", { eventId: eventId("m7"), eventName: "VARIANT_SELECTED" }],
    ];
    for (const [label, patch] of cases) {
      const body = view(patch);
      if ("serviceId" in patch && patch.serviceId === undefined) delete body.serviceId;
      const r = await post(body);
      expect({ label, status: r.status }).toEqual({ label, status: 400 });
      expect({ label, error: r.body.error }).toEqual({ label, error: "MALFORMED_EVENT" });
    }
    const written = await prisma.analyticsEvent.count({ where: { eventId: { startsWith: `${RUN}-m` } } });
    expect(written).toBe(0);
  });

  test("a client cannot mint a backend-authoritative event", async () => {
    for (const name of ["QUOTE_GENERATED", "CHECKOUT_STARTED", "BOOKING_CREATED", "BOOKING_COMPLETED", "CANCELLED", "REPEAT_BOOKING"]) {
      const r = await post(
        view({ eventId: eventId(`forge-${name}`), eventName: name, bookingId: fixtureBookingId }),
        bearer(ctx.customerA),
      );
      expect({ name, status: r.status }).toEqual({ name, status: 403 });
      expect(r.body.error).toBe("UNAUTHORIZED_EVENT");
    }
    const forged = await prisma.analyticsEvent.count({ where: { eventId: { startsWith: `${RUN}-forge` } } });
    expect(forged).toBe(0);
  });

  test("a redelivered event is acknowledged once and stored once", async () => {
    const id = eventId("dup");
    const first = await post(view({ eventId: id }));
    const second = await post(view({ eventId: id }));
    const third = await post(view({ eventId: id, eventName: "SERVICE_CLICK" }));

    expect(first.status).toBe(201);
    expect(first.body.data?.duplicate).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.data?.duplicate).toBe(true);
    // A second delivery that disagrees about the payload still stores nothing new: the key wins.
    expect(third.body.data?.duplicate).toBe(true);
    expect(await prisma.analyticsEvent.count({ where: { eventId: id } })).toBe(1);
    const row = await prisma.analyticsEvent.findUniqueOrThrow({ where: { eventId: id } });
    expect(row.eventName).toBe("SERVICE_VIEW");
  });

  test("a customer cannot attach another customer's booking", async () => {
    const r = await post(
      view({ eventId: eventId("bk-steal"), eventName: "BOOKING_STARTED", bookingId: fixtureBookingId }),
      bearer(ctx.customerB),
    );
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("BOOKING_ACTOR_MISMATCH");
  });

  test("sensitive-looking metadata keys and values are dropped, not stored", async () => {
    const id = eventId("meta");
    const r = await post(
      view({
        eventId: id,
        metadata: { listPosition: 3, searchTerm: "deep clean", authToken: "abc.def.ghi", cardNumber: "4111111111111111" },
      }),
    );
    expect(r.status).toBe(201);
    const row = await prisma.analyticsEvent.findUniqueOrThrow({ where: { eventId: id } });
    expect(row.metadata).toEqual({ listPosition: 3, searchTerm: "deep clean" });
  });
});

describe.serial("provenance stamping", () => {
  test("an event from a fixture actor is stamped non-business and the business population excludes it", async () => {
    const id = eventId("pop-fixture");
    const r = await post(view({ eventId: id }), bearer(ctx.customerA));
    expect(r.status).toBe(201);

    const actor = await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { dataOrigin: true } });
    expect(actor.dataOrigin).not.toBeNull();
    const row = await prisma.analyticsEvent.findUniqueOrThrow({ where: { eventId: id } });
    expect(row.dataOrigin).toBe(actor.dataOrigin);
    expect(row.actorUserId).toBe(ctx.customerA.id);

    const inBusiness = await prisma.analyticsEvent.count({ where: { eventId: id, ...analyticsWhere() } });
    expect(inBusiness).toBe(0);
    const inAll = await prisma.analyticsEvent.count({ where: { eventId: id, ...analyticsWhere("ALL") } });
    expect(inAll).toBe(1);
  });

  test("an event from a business actor is counted by the business population", async () => {
    const id = eventId("pop-business");
    const r = await post(view({ eventId: id }), businessToken);
    expect(r.status).toBe(201);
    const row = await prisma.analyticsEvent.findUniqueOrThrow({ where: { eventId: id } });
    expect(row.dataOrigin).toBe("REAL");
    expect(await prisma.analyticsEvent.count({ where: { eventId: id, ...analyticsWhere() } })).toBe(1);
  });

  test("an anonymous event carries UNKNOWN provenance, which counts as business", async () => {
    const id = eventId("pop-anon");
    await post(view({ eventId: id }));
    const row = await prisma.analyticsEvent.findUniqueOrThrow({ where: { eventId: id } });
    expect(row.dataOrigin).toBeNull();
    expect(await prisma.analyticsEvent.count({ where: { eventId: id, ...analyticsWhere() } })).toBe(1);
  });

  test("the client cannot declare its own provenance", async () => {
    const id = eventId("pop-claim");
    // `dataOrigin` is not part of the request schema; sending it must change nothing.
    const r = await post(view({ eventId: id, dataOrigin: "REAL", environment: "production" }), bearer(ctx.customerA));
    expect(r.status).toBe(201);
    const row = await prisma.analyticsEvent.findUniqueOrThrow({ where: { eventId: id } });
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { dataOrigin: true } });
    expect(row.dataOrigin).toBe(actor.dataOrigin);
    expect(row.environment).toBe(analyticsEnvironment());
  });

  test("a booking-bound authoritative event inherits the booking's provenance, not the caller's", async () => {
    const id = eventId("auth-booking");
    const result = await recordAuthoritativeEvent(
      {
        eventId: id,
        eventName: "BOOKING_COMPLETED",
        bookingId: fixtureBookingId,
        source: "BACKEND",
        platform: "SERVER",
      },
      null,
    );
    expect(result.ok).toBe(true);
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixtureBookingId },
      select: { dataOrigin: true, serviceId: true },
    });
    const row = await prisma.analyticsEvent.findUniqueOrThrow({ where: { eventId: id } });
    expect(row.dataOrigin).toBe(booking.dataOrigin);
    expect(row.serviceId).toBe(booking.serviceId);
    expect(row.source).toBe("BACKEND");
    expect(row.platform).toBe("SERVER");
  });

  test("an authoritative event for a booking that does not exist is refused", async () => {
    const result = await recordAuthoritativeEvent(
      {
        eventId: eventId("auth-missing"),
        eventName: "BOOKING_COMPLETED",
        bookingId: "bkg_does_not_exist",
        source: "BACKEND",
        platform: "SERVER",
      },
      null,
    );
    expect(result).toEqual({ ok: false, error: "BOOKING_NOT_FOUND", detail: undefined });
  });
});
