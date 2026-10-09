/**
 * Customer-facing reviews of one service: only real, public, unflagged ratings, with the reviewer
 * reduced to a first name and an initial. No ids, no surname, no contact details.
 *
 * Runs on the isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { withQuoteToken } from "./helpers/quote-token";

const RUN = `srev-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
const bookingIds: string[] = [];
let hours = 340;

async function completedBooking(customer: AdvCtx["customerA"], addressId: string): Promise<string> {
  hours += 24;
  const token = bearer(customer);
  const body = await withQuoteToken(app, token, { serviceId: ctx.serviceId, addressId, quantity: 1, scheduledDate: futureSlot(hours).toISOString() });
  const r = await app.handle(
    new Request("http://localhost/api/bookings", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }),
  );
  const j = (await r.json()) as { data: { booking?: { id: string }; id?: string } };
  if (r.status !== 201) throw new Error(`book: ${r.status} ${JSON.stringify(j)}`);
  const id = j.data.booking?.id ?? j.data.id ?? "";
  await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "COMPLETED", completedAt: new Date(), paymentStatus: "SUCCESS" } });
  bookingIds.push(id);
  return id;
}

async function reviews(serviceId: string, qs = "") {
  const res = await app.handle(new Request(`http://localhost/api/services/${serviceId}/reviews${qs}`));
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text || "{}") as { data?: { reviews: any[]; total: number; averageRating: number | null; distribution: Record<string, number> } } };
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
  // The scenario's customers are real (UNKNOWN = business), so their bookings are born business at
  // creation. The fixture seed classifies them at signup; without this every review is a fixture's.
  await prisma.user.update({ where: { id: ctx.customerA.id }, data: { firstName: "Asha", lastName: "Krishnan", dataOrigin: null } });
  await prisma.user.update({ where: { id: ctx.customerB.id }, data: { dataOrigin: null } });
  const shown = await completedBooking(ctx.customerA, ctx.addressAId);
  const flagged = await completedBooking(ctx.customerA, ctx.addressAId);
  const anonymous = await completedBooking(ctx.customerB, ctx.addressBId);
  const starsOnly = await completedBooking(ctx.customerB, ctx.addressBId);
  await prisma.rating.create({ data: { bookingId: shown, userId: ctx.customerA.id, providerId: ctx.providerId, stars: 5, reviewText: `Spotless work ${RUN}`, providerResponse: "Thank you" } });
  await prisma.rating.create({ data: { bookingId: flagged, userId: ctx.customerA.id, providerId: ctx.providerId, stars: 1, reviewText: `Flagged text ${RUN}`, isFlagged: true } });
  await prisma.rating.create({ data: { bookingId: anonymous, userId: ctx.customerB.id, providerId: ctx.providerId, stars: 4, reviewText: `Anonymous praise ${RUN}`, isAnonymous: true } });
  await prisma.rating.create({ data: { bookingId: starsOnly, userId: ctx.customerB.id, providerId: ctx.providerId, stars: 3 } });
  // Public and unflagged, but on a FIXTURE booking: valid data, never a customer-facing review.
  const fixture = await completedBooking(ctx.customerB, ctx.addressBId);
  await prisma.booking.update({ where: { id: fixture }, data: { dataOrigin: "FIXTURE" } });
  await prisma.rating.create({ data: { bookingId: fixture, userId: ctx.customerB.id, providerId: ctx.providerId, stars: 1, reviewText: `Fixture text ${RUN}` } });
}, 180_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.rating.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("GET /api/services/:id/reviews", () => {
  test("is public and lists written, public, unflagged reviews of this service only", async () => {
    expect(dbOk).toBe(true);
    const r = await reviews(ctx.serviceId);
    expect(r.status).toBe(200);
    const texts = r.json.data!.reviews.map((x) => x.reviewText);
    expect(texts).toContain(`Spotless work ${RUN}`);
    expect(texts).toContain(`Anonymous praise ${RUN}`);
    expect(texts).not.toContain(`Flagged text ${RUN}`);
    expect(texts).not.toContain(`Fixture text ${RUN}`);
    expect(r.json.data!.total).toBe(2);
  });

  test("the reviewer is a first name and an initial, or anonymous: no surname, ids or contact details", async () => {
    expect(dbOk).toBe(true);
    const r = await reviews(ctx.serviceId);
    const shown = r.json.data!.reviews.find((x) => x.reviewText === `Spotless work ${RUN}`);
    expect(shown.name).toBe("Asha K");
    expect(shown.providerResponse).toBe("Thank you");
    expect(Object.keys(shown).sort()).toEqual(["createdAt", "id", "name", "providerResponse", "rating", "reviewText"]);
    const anon = r.json.data!.reviews.find((x) => x.reviewText === `Anonymous praise ${RUN}`);
    expect(anon.name).toBe("HOMEEIGO Customer");
    expect(r.text).not.toContain("Krishnan");
    for (const secret of [ctx.customerA.id, ctx.customerB.id, ctx.providerId, ...bookingIds]) expect(r.text).not.toContain(secret);
  });

  // The fixture's 1★ is in neither the distribution nor the average.
  test("the star distribution counts every public unflagged business rating, including ones without text", async () => {
    expect(dbOk).toBe(true);
    const d = (await reviews(ctx.serviceId)).json.data!;
    expect(d.distribution).toEqual({ "1": 0, "2": 0, "3": 1, "4": 1, "5": 1 });
    expect(d.averageRating).toBe(4);
  });

  test("the page size is capped and an unknown service is 404", async () => {
    expect(dbOk).toBe(true);
    const one = await reviews(ctx.serviceId, "?limit=1");
    expect(one.json.data!.reviews.length).toBe(1);
    expect(one.json.data!.total).toBe(2);
    expect((await reviews("does-not-exist")).status).toBe(404);
  });
});
