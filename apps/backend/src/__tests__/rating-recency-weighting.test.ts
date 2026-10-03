import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { ratingService } from "../services/rating.service";

/**
 * 5B — the recency-weighted provider rating now uses date-floored aggregates instead of loading the
 * provider's entire rating history. That is only a performance change if it returns the same number,
 * and the one place it could quietly stop doing so is the tier boundary.
 *
 * The original test was `Math.floor(ageMs / DAY) <= 7`, which TRUNCATES: a review 7.9 days old has
 * `daysOld === 7` and earns the 3x weight. The equivalent SQL floor is `created_at > now - 8 days`.
 * The obvious-looking `now - 7 days` would demote that review to 2x and move the published rating of
 * every partner with recent reviews — a product change disguised as an optimisation.
 *
 * These cases are differential: the legacy algorithm is reimplemented here verbatim and both are run
 * over data placed deliberately either side of each boundary. If the floors drift, the two disagree.
 */
const RUN = `rating-weight-${Date.now().toString(36)}`;
const DAY = 86_400_000;
let ctx: AdvCtx;
let dbOk = false;

/** The implementation as it stood before 5B — the reference the new one must match. */
function legacyWeightedRating(rows: Array<{ stars: number; createdAt: Date }>, now: number): number {
  if (rows.length === 0) return 0;
  let totalScore = 0;
  let totalWeight = 0;
  for (const r of rows) {
    const daysOld = Math.floor((now - r.createdAt.getTime()) / DAY);
    const weight = daysOld <= 7 ? 3 : daysOld <= 30 ? 2 : 1;
    totalScore += r.stars * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return 0;
  return Math.round((totalScore / totalWeight) * 10) / 10;
}

/** Seed one rating `ageDays` old. Bookings carry a slot-exclusion constraint, so slots are staggered. */
async function seedRating(index: number, stars: number, ageDays: number) {
  const bookingId = `${RUN}-b-${index}`;
  await prisma.$executeRawUnsafe(
    // W2-D4: a booking inherits a NON-business customer's origin, exactly as bookingService.create
    // writes it; a business customer's booking stays NULL. Without this the raw row was business
    // while its (fixture) partner is not, and the population-scoped rating correctly ignored it.
    `INSERT INTO bookings (id, booking_number, user_id, service_id, address_id, scheduled_date, base_amount, final_amount, total_amount, updated_at, created_at, data_origin)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' hours')::interval, 100, 100, 100, NOW(), NOW(),
             (SELECT CASE WHEN u.data_origin IS NULL OR u.data_origin = 'REAL' THEN NULL ELSE u.data_origin END FROM users u WHERE u.id = $3))`,
    bookingId, `${RUN}-BN-${index}`, ctx.customerA.id, ctx.serviceId, ctx.addressAId, String(index + 1),
  );
  const createdAt = new Date(Date.now() - ageDays * DAY);
  await prisma.$executeRawUnsafe(
    `INSERT INTO ratings (id, booking_id, user_id, provider_id, rating, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    `${RUN}-r-${index}`, bookingId, ctx.customerA.id, ctx.providerId, stars, createdAt,
  );
}

async function clearRatings() {
  await prisma.rating.deleteMany({ where: { providerId: ctx.providerId } });
  await prisma.booking.deleteMany({ where: { id: { startsWith: `${RUN}-b-` } } });
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN);
  await clearRatings();
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  await clearRatings();
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("recency-weighted provider rating", () => {
  test("no ratings yields 0, not NaN from an empty division", async () => {
    if (!dbOk) return;
    await clearRatings();
    expect(await ratingService.calculateProviderRating(ctx.providerId)).toBe(0);
  });

  test("matches the legacy algorithm across every tier boundary", async () => {
    if (!dbOk) return;
    await clearRatings();

    /**
     * Ages chosen to sit either side of each truncation boundary. 7.9d and 30.9d are the ones a
     * naive `now - 7d` / `now - 30d` floor would misclassify; the stars differ per row so a
     * misweighting cannot cancel out in the average.
     */
    const rows: Array<{ stars: number; ageDays: number }> = [
      { stars: 5, ageDays: 0.1 },
      { stars: 1, ageDays: 6.9 },
      { stars: 5, ageDays: 7.5 },
      { stars: 1, ageDays: 7.9 },
      { stars: 5, ageDays: 8.1 },
      { stars: 2, ageDays: 29.9 },
      { stars: 5, ageDays: 30.5 },
      { stars: 1, ageDays: 30.9 },
      { stars: 4, ageDays: 31.2 },
      { stars: 3, ageDays: 400 },
    ];
    for (const [i, r] of rows.entries()) await seedRating(i, r.stars, r.ageDays);

    const stored = await prisma.rating.findMany({
      where: { providerId: ctx.providerId },
      select: { stars: true, createdAt: true },
    });
    expect(stored.length).toBe(rows.length);

    const expected = legacyWeightedRating(stored, Date.now());
    expect(await ratingService.calculateProviderRating(ctx.providerId)).toBe(expected);
  });

  test("a review at 7.9 days still carries the 3x weight — the floor is 8 days, not 7", async () => {
    if (!dbOk) return;
    await clearRatings();
    // One 5-star review just under the truncation boundary, one 1-star review well past it.
    await seedRating(100, 5, 7.9);
    await seedRating(101, 1, 400);

    // 3x weight: (3*5 + 1*1) / (3 + 1) = 4.0. A 7-day floor would demote it: (2*5+1)/3 = 3.7.
    expect(await ratingService.calculateProviderRating(ctx.providerId)).toBe(4);
  });

  test("a review at 30.9 days still carries the 2x weight — the floor is 31 days, not 30", async () => {
    if (!dbOk) return;
    await clearRatings();
    await seedRating(102, 5, 30.9);
    await seedRating(103, 1, 400);

    // 2x weight: (2*5 + 1)/(2 + 1) = 3.7. A 30-day floor would give (5 + 1)/2 = 3.0.
    expect(await ratingService.calculateProviderRating(ctx.providerId)).toBe(3.7);
  });

  test("a rating exactly on the boundary falls to the lower tier, as truncation always did", async () => {
    if (!dbOk) return;
    await clearRatings();
    // Exactly 8.0 days: floor(8) is not <= 7, so legacy gave it 2x. `gt` excludes it from the high
    // tier and `lte` admits it to the medium one — the same side of the line, by construction.
    await seedRating(110, 5, 8);
    await seedRating(111, 1, 400);
    expect(await ratingService.calculateProviderRating(ctx.providerId)).toBe(3.7);
  });

  test("a future-dated rating is weighted like a brand-new one, not silently dropped", async () => {
    if (!dbOk) return;
    await clearRatings();
    /**
     * Clock skew between app servers can stamp a review slightly ahead of now. Legacy produced a
     * negative daysOld, which passes `<= 7` and earns 3x. A range filter can quietly exclude such a
     * row instead, which would drop a real review out of the average — so the top tier is left
     * open-ended (`gt` only) rather than bounded at now.
     */
    await seedRating(112, 5, -0.5);
    await seedRating(113, 1, 400);
    expect(await ratingService.calculateProviderRating(ctx.providerId)).toBe(4);

    const stored = await prisma.rating.findMany({
      where: { providerId: ctx.providerId },
      select: { stars: true, createdAt: true },
    });
    expect(await ratingService.calculateProviderRating(ctx.providerId)).toBe(
      legacyWeightedRating(stored, Date.now()),
    );
  });

  test("a provider whose reviews are all ancient still averages them, not returns 0", async () => {
    if (!dbOk) return;
    await clearRatings();
    await seedRating(114, 4, 500);
    await seedRating(115, 2, 900);
    // Both weight 1 → (4 + 2) / 2 = 3.0. An empty high/medium tier must contribute 0, not NaN.
    expect(await ratingService.calculateProviderRating(ctx.providerId)).toBe(3);
  });
});
