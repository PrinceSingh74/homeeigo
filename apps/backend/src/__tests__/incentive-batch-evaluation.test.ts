import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { partnerIncentivePayoutService, startOfDay } from "../services/partner-incentive-payout.service";
import { partnerOsService } from "../services/partner-os.service";

/**
 * 5D — incentive rule progress is now read for a whole batch of partners at once instead of six
 * queries per partner.
 *
 * Batching a READ that decides who gets paid is not a neutral refactor. The per-provider version
 * could not attribute anything to the wrong partner because it only ever held one partner's rows;
 * the batch holds everyone's and has to group them. A grouping mistake does not look like a crash —
 * it looks like a partner being told a bonus is already `paid` when it is not, or being measured
 * against someone else's progress. So the cases below check attribution across partners with
 * deliberately different progress, not merely that the fast path returns something.
 *
 * The batch and single-provider paths share one implementation on purpose: two definitions of
 * "daily" is how a partner qualifies on one screen and not on another.
 */
const RUN = `inc-batch-${Date.now().toString(36)}`;
const DAY = 86_400_000;
const HOUR = 3_600_000;
/**
 * Every case seeds work "N hours ago" and then evaluates. With a wall-clock `new Date()` those
 * offsets fell into the PREVIOUS business day whenever the suite ran shortly after midnight
 * (Asia/Kolkata), so the file passed or failed by time of day. Evaluating at a fixed midday instant
 * of the current business day removes that dependency without weakening any assertion.
 */
const EVAL_AT = new Date(startOfDay(new Date()).getTime() + 12 * HOUR);
let ctx: AdvCtx;
let dbOk = false;
let providerB = "";
const DAILY_RULE = `${RUN}-daily`;
const STREAK_RULE = `${RUN}-streak`;

async function makeSecondProvider() {
  const userId = `${RUN}-u2`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO users (id, first_name, last_name, password, email, role, updated_at, created_at)
     VALUES ($1, 'Batch', 'Partner', 'x', $2, 'VENDOR', NOW(), NOW())`,
    userId,
    `${RUN}-p2@test.local`,
  );
  const id = `${RUN}-p2`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO providers (id, user_id, updated_at, created_at) VALUES ($1, $2, NOW(), NOW())`,
    id,
    userId,
  );
  return id;
}

async function seedCompletedBooking(providerId: string, index: number, ageMs: number) {
  const id = `${RUN}-b-${providerId.slice(-4)}-${index}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO bookings (id, booking_number, user_id, provider_id, service_id, address_id, scheduled_date,
                           base_amount, final_amount, total_amount, status, completed_at, updated_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' hours')::interval, 100, 100, 100, 'COMPLETED', $8, NOW(), NOW())`,
    id,
    `${id}-BN`,
    ctx.customerA.id,
    providerId,
    ctx.serviceId,
    ctx.addressAId,
    String(index + 1),
    new Date(EVAL_AT.getTime() - ageMs),
  );
}

async function seedCheckIn(providerId: string, index: number, ageMs: number, now = EVAL_AT) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO partner_attendance_sessions (id, provider_id, check_in_at) VALUES ($1, $2, $3)`,
    `${RUN}-a-${providerId.slice(-4)}-${index}`,
    providerId,
    new Date(now.getTime() - ageMs),
  );
}

async function seedRules() {
  await prisma.partnerIncentiveRule.createMany({
    data: [
      {
        code: DAILY_RULE,
        name: "3 jobs today",
        period: "DAILY",
        metric: "completed_jobs",
        threshold: 3,
        bonusAmount: 100,
      },
      {
        code: STREAK_RULE,
        name: "3-day streak",
        period: "STREAK",
        metric: "active_days",
        threshold: 3,
        bonusAmount: 250,
      },
    ],
  });
}

async function clearAll() {
  await prisma.partnerIncentivePayout.deleteMany({
    where: { providerId: { in: [ctx.providerId, providerB] } },
  });
  await prisma.partnerIncentiveRule.deleteMany({ where: { code: { startsWith: RUN } } });
  /**
   * Every booking and check-in for these two providers, not just the ones this file inserted. The
   * shared fixture seeds completed bookings of its own, so counting only `RUN`-prefixed rows made
   * the thresholds below depend on what the fixture happened to leave behind — the assertions were
   * measuring the fixture, not the batch. Both providers exist only for this run, so this is scoped.
   */
  await prisma.partnerAttendanceSession.deleteMany({
    where: { providerId: { in: [ctx.providerId, providerB] } },
  });
  await prisma.booking.deleteMany({ where: { providerId: { in: [ctx.providerId, providerB] } } });
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN);
  providerB = await makeSecondProvider();
  await clearAll();
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  await clearAll();
  await prisma.$executeRawUnsafe(`DELETE FROM providers WHERE id = $1`, providerB);
  await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = $1`, `${RUN}-u2`);
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("batched incentive evaluation", () => {
  test("each partner's progress is attributed to that partner, not pooled across the batch", async () => {
    if (!dbOk) return;
    await clearAll();
    await seedRules();

    // A has 3 completed jobs today; B has 1. Only A clears the DAILY threshold of 3.
    for (let i = 0; i < 3; i++) await seedCompletedBooking(ctx.providerId, i, (i + 1) * HOUR);
    await seedCompletedBooking(providerB, 0, HOUR);

    const now = EVAL_AT;
    const batch = await partnerIncentivePayoutService.computeRuleProgressBatch(
      [ctx.providerId, providerB],
      now,
    );

    const aDaily = batch.get(ctx.providerId)!.find((r) => r.code === DAILY_RULE)!;
    const bDaily = batch.get(providerB)!.find((r) => r.code === DAILY_RULE)!;

    expect(aDaily.current).toBe(3);
    expect(aDaily.eligible).toBe(true);
    expect(bDaily.current).toBe(1);
    expect(bDaily.eligible).toBe(false);
  });

  test("the batch returns exactly what the single-provider path returns", async () => {
    if (!dbOk) return;
    await clearAll();
    await seedRules();
    for (let i = 0; i < 4; i++) await seedCompletedBooking(ctx.providerId, i, (i + 1) * HOUR);
    await seedCompletedBooking(providerB, 0, 2 * HOUR);
    for (let d = 0; d < 3; d++) await seedCheckIn(ctx.providerId, d, d * DAY + HOUR);

    // A fixed instant, or the two paths would be compared across different `now` values.
    const now = EVAL_AT;
    const batch = await partnerIncentivePayoutService.computeRuleProgressBatch(
      [ctx.providerId, providerB],
      now,
    );

    for (const providerId of [ctx.providerId, providerB]) {
      const single = await partnerIncentivePayoutService.computeRuleProgress(providerId, now);
      expect(JSON.stringify(batch.get(providerId))).toBe(JSON.stringify(single));
    }
  });

  /**
   * The streak counts distinct UTC calendar dates in the 7 days before `now`. This test used to seed
   * "1 day + 5 hours ago"-style offsets from the wall clock and let the service read its own clock, so
   * whether two offsets fell on one date depended on the hour the suite ran: before 06:00 UTC,
   * "2 days + 6 hours ago" crossed midnight and four check-ins became three days. The check-ins are now
   * placed on calendar days relative to an explicit `now`, and the property is asserted at instants on
   * both sides of midnight — the production rule is unchanged.
   */
  test("a streak counts distinct days, not check-in sessions — at any time of day", async () => {
    if (!dbOk) return;
    const anchors = ["00:00:01", "05:45:00", "12:00:00", "23:59:59"];
    for (const [n, t] of anchors.entries()) {
      await clearAll();
      await seedRules();
      const now = new Date(`2026-03-10T${t}Z`);
      const at = (daysBack: number, hh: number) => {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack, hh));
        return now.getTime() - d.getTime();
      };
      // Four check-ins but only two distinct days — a partner cannot farm a streak by clocking in twice.
      await seedCheckIn(ctx.providerId, n * 10 + 0, at(1, 9), now);
      await seedCheckIn(ctx.providerId, n * 10 + 1, at(1, 13), now);
      await seedCheckIn(ctx.providerId, n * 10 + 2, at(2, 9), now);
      await seedCheckIn(ctx.providerId, n * 10 + 3, at(2, 13), now);

      const snapshot = await partnerIncentivePayoutService.loadProgressSnapshot(ctx.providerId, now);
      expect({ anchor: t, streak: snapshot.streak }).toEqual({ anchor: t, streak: 2 });

      const rules = await partnerIncentivePayoutService.computeRuleProgress(ctx.providerId, now);
      const streak = rules.find((r) => r.code === STREAK_RULE)!;
      expect({ anchor: t, current: streak.current, eligible: streak.eligible }).toEqual({ anchor: t, current: 2, eligible: false });
    }
  });

  test("an existing payout marks only its own partner as paid", async () => {
    if (!dbOk) return;
    await clearAll();
    await seedRules();
    for (let i = 0; i < 3; i++) await seedCompletedBooking(ctx.providerId, i, (i + 1) * HOUR);
    for (let i = 0; i < 3; i++) await seedCompletedBooking(providerB, i, (i + 1) * HOUR);

    const now = EVAL_AT;
    const before = await partnerIncentivePayoutService.computeRuleProgressBatch(
      [ctx.providerId, providerB],
      now,
    );
    const dailyRule = before.get(ctx.providerId)!.find((r) => r.code === DAILY_RULE)!;
    expect(dailyRule.eligible).toBe(true);

    // Partner A has already been paid this period. Partner B has not.
    await prisma.partnerIncentivePayout.create({
      data: {
        providerId: ctx.providerId,
        ruleId: dailyRule.id,
        amount: 100,
        periodKey: dailyRule.periodKey,
      },
    });

    const after = await partnerIncentivePayoutService.computeRuleProgressBatch(
      [ctx.providerId, providerB],
      now,
    );
    expect(after.get(ctx.providerId)!.find((r) => r.code === DAILY_RULE)!.paid).toBe(true);
    // The whole point: B must NOT inherit A's payout.
    expect(after.get(providerB)!.find((r) => r.code === DAILY_RULE)!.paid).toBe(false);
  });

  test("a partner with no activity gets zeros, not a missing entry", async () => {
    if (!dbOk) return;
    await clearAll();
    await seedRules();
    await seedCompletedBooking(ctx.providerId, 0, HOUR);

    const batch = await partnerIncentivePayoutService.computeRuleProgressBatch([
      ctx.providerId,
      providerB,
    ]);
    expect(batch.has(providerB)).toBe(true);
    expect(batch.get(providerB)!.every((r) => r.current === 0 && !r.eligible)).toBe(true);
  });

  test("with no active rules the batch returns empty progress for everyone, without erroring", async () => {
    if (!dbOk) return;
    await clearAll(); // deliberately no rules of our own
    /**
     * A database built from the migrations (i.e. production-shaped) always carries the platform
     * default rules that 20260708120000_partner_os_v2 seeds (inc_weekly_18, inc_monthly_75, …), so
     * "no active rules" has to be created, not assumed. The old push-built test DB had none, which
     * is the only reason this passed there. Deactivate every active rule, restore exactly those.
     */
    const active = await prisma.partnerIncentiveRule.findMany({ where: { isActive: true }, select: { id: true } });
    await prisma.partnerIncentiveRule.updateMany({ where: { id: { in: active.map((r) => r.id) } }, data: { isActive: false } });
    try {
      const batch = await partnerIncentivePayoutService.computeRuleProgressBatch([
        ctx.providerId,
        providerB,
      ]);
      expect(batch.get(ctx.providerId)).toEqual([]);
      expect(batch.get(providerB)).toEqual([]);

      // The snapshot is still available to callers that ask for it directly.
      const view = await partnerIncentivePayoutService.computeIncentiveView(ctx.providerId);
      expect(view.rules).toEqual([]);
      expect(view.progress).toEqual({ daily: 0, weekly: 0, monthly: 0, streak: 0 });
    } finally {
      await prisma.partnerIncentiveRule.updateMany({ where: { id: { in: active.map((r) => r.id) } }, data: { isActive: true } });
    }
  });

  test("an empty batch is a no-op, not a query for every provider in the table", async () => {
    if (!dbOk) return;
    expect((await partnerIncentivePayoutService.computeRuleProgressBatch([])).size).toBe(0);
    expect((await partnerIncentivePayoutService.loadProgressSnapshots([])).size).toBe(0);
  });

  test("expired and not-yet-started rules are excluded for the whole batch", async () => {
    if (!dbOk) return;
    await clearAll();
    await prisma.partnerIncentiveRule.createMany({
      data: [
        {
          code: `${RUN}-expired`,
          name: "over",
          period: "DAILY",
          metric: "completed_jobs",
          threshold: 1,
          bonusAmount: 10,
          expiresAt: new Date(Date.now() - DAY),
        },
        {
          code: `${RUN}-future`,
          name: "later",
          period: "DAILY",
          metric: "completed_jobs",
          threshold: 1,
          bonusAmount: 10,
          startsAt: new Date(Date.now() + DAY),
        },
        {
          code: `${RUN}-live`,
          name: "now",
          period: "DAILY",
          metric: "completed_jobs",
          threshold: 1,
          bonusAmount: 10,
        },
      ],
    });
    await seedCompletedBooking(ctx.providerId, 0, HOUR);

    const batch = await partnerIncentivePayoutService.computeRuleProgressBatch([
      ctx.providerId,
      providerB,
    ]);
    for (const providerId of [ctx.providerId, providerB]) {
      const codes = batch.get(providerId)!.map((r) => r.code);
      expect(codes).toContain(`${RUN}-live`);
      expect(codes).not.toContain(`${RUN}-expired`);
      expect(codes).not.toContain(`${RUN}-future`);
    }
  });

  test("the partner-facing incentives screen reports the same streak the rules were judged on", async () => {
    if (!dbOk) return;
    await clearAll();
    await seedRules();
    // Two distinct active days and two completed jobs today.
    await seedCheckIn(ctx.providerId, 0, 1 * DAY + 1 * HOUR);
    await seedCheckIn(ctx.providerId, 1, 2 * DAY + 1 * HOUR);
    for (let i = 0; i < 2; i++) await seedCompletedBooking(ctx.providerId, i, (i + 1) * HOUR);

    /**
     * `getIncentives` used to call `computeRuleProgress` and `loadProgressSnapshot` separately, from
     * two independent `new Date()` values — so the streak beside the rules was not necessarily the
     * streak the rules were judged against. It is now one pass, and this pins that they agree.
     */
    const screen = await partnerOsService.getIncentives(ctx.providerId);
    const streakRule = screen.rules.find((r) => r.code === STREAK_RULE)!;

    expect(screen.streakDays).toBe(2);
    expect(streakRule.current).toBe(screen.streakDays);
    expect(screen.rules.find((r) => r.code === DAILY_RULE)!.current).toBe(2);
    expect(Array.isArray(screen.payouts)).toBe(true);
  });
});
