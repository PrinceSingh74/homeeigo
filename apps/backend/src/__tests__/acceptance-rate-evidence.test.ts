import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AssignmentAttemptStatus } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import {
  ACCEPTANCE_TERMINAL_STATUSES,
  ACCEPTANCE_WINDOW_DAYS,
  acceptanceRatePct,
  acceptanceWindowStart,
} from "../lib/acceptance-rate";

/**
 * 6B — an acceptance rate must never be invented.
 *
 * ── The property ────────────────────────────────────────────────────────────
 *
 *     NO EVIDENCE  !=  100%
 *     NO EVIDENCE  !=  0%
 *
 * Both are fabrications, pointing in opposite directions: 0 says "this partner always refuses",
 * 100 says "this partner never refuses". Neither is a measurement, and the column that holds them
 * cannot tell them apart from a real 0 or a real 100.
 *
 * The suite that was meant to defend this asserted `accepted / all < 0.5` against whatever the
 * shared test database happened to contain, with a comment citing "7.5% platform-wide". It failed
 * once the database held more accepted attempts — it was measuring the fixture, not the code, and
 * would have passed just as happily against a service that fabricated. These cases assert the
 * behaviour instead, over the full matrix of evidence states.
 */
const RUN = `acc-rate-${Date.now().toString(36)}`;
const DAY = 86_400_000;
let ctx: AdvCtx;
let dbOk = false;

/**
 * One booking + job per attempt. `assignment_attempts` carries a unique (job_id, provider_id) —
 * a provider is offered a given job once — so several attempts for one provider need several jobs.
 */
async function seedAttempt(index: number, status: AssignmentAttemptStatus, ageMs: number) {
  const bookingId = `${RUN}-b-${index}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO bookings (id, booking_number, user_id, provider_id, service_id, address_id, scheduled_date,
                           base_amount, final_amount, total_amount, updated_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' hours')::interval, 100, 100, 100, NOW(), NOW())`,
    bookingId,
    `${bookingId}-BN`,
    ctx.customerA.id,
    ctx.providerId,
    ctx.serviceId,
    ctx.addressAId,
    String(index + 1),
  );
  const jobId = `${RUN}-j-${index}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO assignment_jobs (id, booking_id, status, created_at, updated_at)
     VALUES ($1, $2, 'PENDING', NOW(), NOW())`,
    jobId,
    bookingId,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO assignment_attempts (id, job_id, provider_id, status, dispatched_at)
     VALUES ($1, $2, $3, $4::"AssignmentAttemptStatus", $5)`,
    `${RUN}-a-${index}`,
    jobId,
    ctx.providerId,
    status,
    new Date(Date.now() - ageMs),
  );
}

async function clearAttempts() {
  await prisma.$executeRawUnsafe(`DELETE FROM assignment_attempts WHERE id LIKE $1`, `${RUN}-a-%`);
  await prisma.$executeRawUnsafe(`DELETE FROM assignment_jobs WHERE id LIKE $1`, `${RUN}-j-%`);
  await prisma.$executeRawUnsafe(`DELETE FROM bookings WHERE id LIKE $1`, `${RUN}-b-%`);
  // Attempts seeded by other suites for this fixture provider would skew every measurement below.
  await prisma.assignmentAttempt.deleteMany({ where: { providerId: ctx.providerId } });
}

/** The measurement the provider column performs, expressed through the shared definition. */
async function measure(): Promise<number | null> {
  const since = acceptanceWindowStart();
  const [accepted, terminal] = await Promise.all([
    prisma.assignmentAttempt.count({
      where: { providerId: ctx.providerId, status: AssignmentAttemptStatus.ACCEPTED, dispatchedAt: { gte: since } },
    }),
    prisma.assignmentAttempt.count({
      where: { providerId: ctx.providerId, status: { in: ACCEPTANCE_TERMINAL_STATUSES }, dispatchedAt: { gte: since } },
    }),
  ]);
  return acceptanceRatePct(accepted, terminal);
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN);
  await clearAttempts();
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  await clearAttempts();
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("acceptanceRatePct — the shared definition", () => {
  test("no observations is null, not 0 and not 100", () => {
    expect(acceptanceRatePct(0, 0)).toBeNull();
  });

  test("a zero denominator is null however the numerator reads", () => {
    // A numerator without a denominator is not evidence of anything.
    expect(acceptanceRatePct(5, 0)).toBeNull();
    expect(acceptanceRatePct(0, 0)).toBeNull();
  });

  test("one observation is a real measurement, not discarded as too small", () => {
    expect(acceptanceRatePct(1, 1)).toBe(100);
    expect(acceptanceRatePct(0, 1)).toBe(0);
  });

  test("all accepted is 100 and none accepted is 0 — real extremes are reportable", () => {
    expect(acceptanceRatePct(40, 40)).toBe(100);
    expect(acceptanceRatePct(0, 40)).toBe(0);
  });

  test("an impossible sample is null rather than a number above 100", () => {
    // More acceptances than terminal outcomes means the caller counted wrong; returning 125% would
    // launder that mistake into a plausible-looking statistic.
    expect(acceptanceRatePct(5, 4)).toBeNull();
    expect(acceptanceRatePct(-1, 4)).toBeNull();
  });

  test("non-finite input is null, never NaN%", () => {
    expect(acceptanceRatePct(Number.NaN, 10)).toBeNull();
    expect(acceptanceRatePct(3, Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("SENT is not a terminal outcome — a pending offer is not a refusal", () => {
    // Counting in-flight broadcasts as refusals would depress every rate the moment dispatch fires.
    expect(ACCEPTANCE_TERMINAL_STATUSES).not.toContain(AssignmentAttemptStatus.SENT);
    expect(ACCEPTANCE_TERMINAL_STATUSES).toContain(AssignmentAttemptStatus.ACCEPTED);
    expect(ACCEPTANCE_TERMINAL_STATUSES).toContain(AssignmentAttemptStatus.REJECTED);
    expect(ACCEPTANCE_TERMINAL_STATUSES).toContain(AssignmentAttemptStatus.TIMEOUT);
  });
});

describe("measured against real dispatch rows", () => {
  test("a provider with no attempts at all measures as unknown", async () => {
    if (!dbOk) return;
    await clearAttempts();
    expect(await measure()).toBeNull();
  });

  test("a provider with only pending offers measures as unknown, not 0%", async () => {
    if (!dbOk) return;
    await clearAttempts();
    await seedAttempt(0, AssignmentAttemptStatus.SENT, 3_600_000);
    await seedAttempt(1, AssignmentAttemptStatus.SENT, 7_200_000);

    // Two offers are out and neither has been answered. That is not a 0% acceptor.
    expect(await measure()).toBeNull();
  });

  test("a provider whose only outcomes are older than the window measures as unknown", async () => {
    if (!dbOk) return;
    await clearAttempts();
    await seedAttempt(2, AssignmentAttemptStatus.ACCEPTED, (ACCEPTANCE_WINDOW_DAYS + 5) * DAY);
    await seedAttempt(3, AssignmentAttemptStatus.REJECTED, (ACCEPTANCE_WINDOW_DAYS + 9) * DAY);

    /**
     * The original defect: a provider who went quiet for a month was re-scored as a PERFECT
     * acceptor the next time they were dispatched to. Silence is not evidence of acceptance.
     */
    expect(await measure()).toBeNull();
  });

  test("partial data measures only what is inside the window", async () => {
    if (!dbOk) return;
    await clearAttempts();
    await seedAttempt(4, AssignmentAttemptStatus.ACCEPTED, 1 * DAY);
    await seedAttempt(5, AssignmentAttemptStatus.REJECTED, 2 * DAY);
    await seedAttempt(6, AssignmentAttemptStatus.SENT, 1 * DAY); // ignored — not terminal
    await seedAttempt(7, AssignmentAttemptStatus.ACCEPTED, (ACCEPTANCE_WINDOW_DAYS + 3) * DAY); // outside

    // 1 accepted of 2 terminal, inside the window.
    expect(await measure()).toBe(50);
  });

  test("a provider with no accepted offers measures 0%, which is a real measurement", async () => {
    if (!dbOk) return;
    await clearAttempts();
    await seedAttempt(8, AssignmentAttemptStatus.REJECTED, 1 * DAY);
    await seedAttempt(9, AssignmentAttemptStatus.TIMEOUT, 2 * DAY);

    // 0 here is earned, and must be distinguishable from the null above.
    expect(await measure()).toBe(0);
  });

  test("a provider who accepted everything measures 100%, which is also real", async () => {
    if (!dbOk) return;
    await clearAttempts();
    await seedAttempt(10, AssignmentAttemptStatus.ACCEPTED, 1 * DAY);
    await seedAttempt(11, AssignmentAttemptStatus.ACCEPTED, 2 * DAY);

    expect(await measure()).toBe(100);
  });

  test("a timeout counts as a refusal, so an ignored offer cannot flatter the rate", async () => {
    if (!dbOk) return;
    await clearAttempts();
    await seedAttempt(12, AssignmentAttemptStatus.ACCEPTED, 1 * DAY);
    await seedAttempt(13, AssignmentAttemptStatus.TIMEOUT, 1 * DAY);

    // Ignoring offers must not read the same as never receiving them.
    expect(await measure()).toBe(50);
  });
});
