import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { earningsLiveService } from "../services/earnings-live.service";
import { CREDITED_EARNING_WHERE } from "../lib/earning-settlement";

/**
 * 5C — the live partner earnings payload now uses date-floored aggregates instead of loading the
 * provider's entire credited earnings history. It is only a performance change if the numbers a
 * partner sees are unchanged, and there are two ways it could stop being one:
 *
 *   1. `netEarning` is a Float. A SQL SUM and a JS reduce add in different orders, so they can
 *      differ in the last bits. Both are rounded to paise before leaving the service, which should
 *      absorb that — "should" is not evidence, so it is asserted against the legacy reduce here.
 *   2. The four windows are NESTED (today ⊆ week ⊆ month ⊆ all), not disjoint. Treating them as
 *      disjoint buckets, as the rating tiers legitimately are, would understate every window.
 *
 * The REVERSED row matters too: only CREDITED earnings count, and an aggregate that forgets the
 * status filter would quietly pay a partner for reversed money.
 */
const RUN = `earn-agg-${Date.now().toString(36)}`;
const DAY = 86_400_000;
let ctx: AdvCtx;
let dbOk = false;

/** The implementation as it stood before 5C — the reference the new one must match. */
async function legacyEarningsData(providerId: string) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const earnings = await prisma.earning.findMany({
    where: { providerId, ...CREDITED_EARNING_WHERE },
    orderBy: { earningDate: "desc" },
  });
  const sum = (rows: typeof earnings) => rows.reduce((s, e) => s + e.netEarning, 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    totalEarnings: r2(sum(earnings)),
    todayEarnings: r2(sum(earnings.filter((e) => new Date(e.earningDate) >= today))),
    weeklyEarnings: r2(sum(earnings.filter((e) => new Date(e.earningDate) >= weekStart))),
    monthlyEarnings: r2(sum(earnings.filter((e) => new Date(e.earningDate) >= monthStart))),
    completedBookings: earnings.length,
  };
}

async function seedEarning(index: number, netEarning: number, ageMs: number, status = "CREDITED") {
  await prisma.$executeRawUnsafe(
    `INSERT INTO earnings (id, provider_id, gross_amount, commission, net_earning, tax, payment_status, earning_date, created_at)
     VALUES ($1, $2, $3, 0, $4, 0, $5::"EarningSettlementStatus", $6, NOW())`,
    `${RUN}-e-${index}`, ctx.providerId, netEarning, netEarning, status,
    new Date(Date.now() - ageMs),
  );
}

async function clearEarnings() {
  await prisma.earning.deleteMany({ where: { providerId: ctx.providerId } });
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN);
  await clearEarnings();
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  await clearEarnings();
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("live partner earnings payload", () => {
  test("a partner with no earnings gets zeros, not nulls from empty aggregates", async () => {
    if (!dbOk) return;
    await clearEarnings();
    const data = await earningsLiveService.getEarningsData(ctx.vendorUserId);
    expect(data.totalEarnings).toBe(0);
    expect(data.todayEarnings).toBe(0);
    expect(data.completedBookings).toBe(0);
    expect(data.lastEarning).toBeUndefined();
  });

  test("matches the legacy reduce on float amounts across all four windows", async () => {
    if (!dbOk) return;
    await clearEarnings();
    /**
     * Amounts with awkward binary fractions, so SQL SUM and JS reduce genuinely add in different
     * orders, but all PAISE-QUANTIZED — which is what `roundCurrency` guarantees at the write path
     * and what the next test pins. Ages place rows inside today, this week, this month and before it.
     */
    const rows = [
      { net: 0.1, ageMs: 60_000 },
      { net: 0.2, ageMs: 120_000 },
      { net: 1234.57, ageMs: 3 * 3_600_000 },
      { net: 99.99, ageMs: 2 * DAY },
      { net: 0.01, ageMs: 4 * DAY },
      { net: 815.33, ageMs: 10 * DAY },
      { net: 7777.77, ageMs: 45 * DAY },
      { net: 3.33, ageMs: 400 * DAY },
    ];
    for (const [i, r] of rows.entries()) await seedEarning(i, r.net, r.ageMs);

    const expected = await legacyEarningsData(ctx.providerId);
    const actual = await earningsLiveService.getEarningsData(ctx.vendorUserId);

    expect(actual.totalEarnings).toBe(expected.totalEarnings);
    expect(actual.todayEarnings).toBe(expected.todayEarnings);
    expect(actual.weeklyEarnings).toBe(expected.weeklyEarnings);
    expect(actual.monthlyEarnings).toBe(expected.monthlyEarnings);
    expect(actual.completedBookings).toBe(expected.completedBookings);
  });

  test("the windows are nested, not disjoint — the month includes today's money", async () => {
    if (!dbOk) return;
    await clearEarnings();
    // One earning minutes old, one earlier this month. Both are inside the month window.
    await seedEarning(20, 100, 60_000);
    await seedEarning(21, 250, 0); // now
    const data = await earningsLiveService.getEarningsData(ctx.vendorUserId);

    expect(data.todayEarnings).toBe(350);
    expect(data.monthlyEarnings).toBeGreaterThanOrEqual(data.weeklyEarnings);
    expect(data.weeklyEarnings).toBeGreaterThanOrEqual(data.todayEarnings);
    expect(data.totalEarnings).toBeGreaterThanOrEqual(data.monthlyEarnings);
  });

  test("REVERSED earnings are excluded from every window — a partner is not paid for reversed money", async () => {
    if (!dbOk) return;
    await clearEarnings();
    await seedEarning(30, 500, 60_000, "CREDITED");
    await seedEarning(31, 9999, 60_000, "REVERSED");

    const data = await earningsLiveService.getEarningsData(ctx.vendorUserId);
    expect(data.totalEarnings).toBe(500);
    expect(data.todayEarnings).toBe(500);
    expect(data.completedBookings).toBe(1);
  });

  test("lastEarning reports the newest credited earning, not the newest row", async () => {
    if (!dbOk) return;
    await clearEarnings();
    await seedEarning(40, 111, 2 * DAY, "CREDITED");
    await seedEarning(41, 222, 1 * DAY, "CREDITED");
    await seedEarning(42, 999, 0, "REVERSED");

    const data = await earningsLiveService.getEarningsData(ctx.vendorUserId);
    expect(data.lastEarning?.amount).toBe(222);
  });

  test("pendingAmount stays exactly 0 — the semantics are still an owner decision, not a fix", async () => {
    if (!dbOk) return;
    await clearEarnings();
    await seedEarning(50, 400, 60_000, "CREDITED");
    await seedEarning(51, 800, 60_000, "REVERSED");

    // Unchanged from before 5C. If this ever becomes non-zero, someone chose a definition of
    // "pending" — that is a product decision and must arrive with its own test, not as a side
    // effect of an optimisation.
    expect((await earningsLiveService.getEarningsData(ctx.vendorUserId)).pendingAmount).toBe(0);
  });

  test("the float sum agrees with the exact paise column — the guarantee the aggregate rests on", async () => {
    if (!dbOk) return;
    await clearEarnings();
    /**
     * Why this test exists.
     *
     * Moving from a JS reduce to a SQL SUM changes the ORDER in which floats are added, and
     * `net_earning` is a double. Order only stops mattering when every addend is paise-quantized:
     * the exact sum of values k/100 is itself exactly m/100, which sits a full half-paise away from
     * any rounding boundary, so no summation order can round it differently. `roundCurrency` gives
     * that at the write path — but NOTHING IN THE DATABASE ENFORCES IT. There is no CHECK
     * constraint on `net_earning`.
     *
     * So the invariant is pinned against the one exact record of the same money: `net_earning_paise`
     * is a BigInt maintained by the `trg_sync_earnings_paise` trigger. If a sub-paise amount is ever
     * written, the float total and the paise total separate, and this fails — surfacing a data
     * defect instead of letting a partner's displayed earnings drift by a paise.
     */
    const amounts = [0.1, 0.2, 1234.57, 99.99, 0.01, 815.33, 7777.77, 3.33];
    for (const [i, net] of amounts.entries()) await seedEarning(60 + i, net, (i + 1) * 60_000);

    const agg = await prisma.earning.aggregate({
      where: { providerId: ctx.providerId, ...CREDITED_EARNING_WHERE },
      _sum: { netEarning: true, netEarningPaise: true },
    });

    const floatTotal = Math.round((agg._sum.netEarning ?? 0) * 100) / 100;
    const paiseTotal = Number(agg._sum.netEarningPaise ?? 0n) / 100;
    expect(floatTotal).toBe(paiseTotal);

    // And that is the number the service reports.
    const data = await earningsLiveService.getEarningsData(ctx.vendorUserId);
    expect(data.totalEarnings).toBe(paiseTotal);
  });
});
