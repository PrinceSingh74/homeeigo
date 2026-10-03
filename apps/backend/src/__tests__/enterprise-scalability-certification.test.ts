/**
 * Enterprise scalability certification — reschedule concurrency under gate + retry.
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { BookingStatus } from "@prisma/client";
import fs from "fs";
import path from "path";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  deleteBookingsForUsers,
  keepPresenceFresh,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { bookingService } from "../services/booking.service";
import { prismaPoolConfigFromUrl } from "../lib/database-url";
import { rescheduleGateStats } from "../lib/reschedule-gate";

const RUN_ID = `scale-${Date.now().toString(36)}`;
const DOCS = path.join(import.meta.dir, "../../docs/enterprise-scalability-certification.md");

type ScaleRow = {
  n: number;
  verdict: "PASS" | "FAIL";
  ok: number;
  total: number;
  p2037: number;
  poolBusy: number;
  corrupt: number;
  duplicates: number;
  overlaps: number;
};

const scaleResults: ScaleRow[] = [];
let audit: Record<string, string | number> = {};

let ctx: AdvCtx;
let dbOk = false;

/** The ceiling `providers_max_concurrent_jobs_range` enforces in the database. */
const PROVIDER_MAX_CONCURRENT = 20;

function soakSlot(hoursFromNow: number): Date {
  const capped = Math.min(hoursFromNow, 29 * 24 - 2);
  const d = new Date(Date.now() + capped * 3_600_000);
  d.setMinutes(0, 0, 0);
  return d;
}

beforeAll(async () => {
  process.env.RESCHEDULE_MAX_INFLIGHT = process.env.RESCHEDULE_MAX_INFLIGHT ?? "32";
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN_ID);
  // These suites pack one partner's calendar with bookings exactly 1 hour apart to load the
  // booking / reschedule paths. Since owner decision D1 (2026-09-21) a DURATION-policy service
  // reserves [start − 30, start + duration + 30), so 1-hour spacing is (correctly) refused. Slot width
  // is not what these suites test — it is pinned by partner-slot-duration.integration.test.ts — so
  // their fixture service keeps the fixed 60-minute window.
  await prisma.service.update({ where: { id: ctx.serviceId }, data: { partnerSlotPolicy: "FIXED" } });
  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: {
      workingHoursStart: "00:00",
      workingHoursEnd: "23:59",
      workingDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      isOnline: true,
    },
  });
  /**
   * Give the fixture partner the platform's maximum concurrent-job capacity.
   *
   * This suite measures RESCHEDULE concurrency, and it seeded up to 50 bookings on one partner and
   * marked each ACCEPTED. `partner-operations.assertOfferEligible` counts every booking in a
   * concurrent status toward `maxConcurrentJobs`, which the fixture sets to 4 — so the fifth seed
   * was refused with PROVIDER_UNAVAILABLE and the suite died in setup, never reaching the load it
   * exists to apply. The failure was read as a scale problem; it was a capacity gate doing its job.
   *
   * 20 is the ceiling the database enforces (`providers_max_concurrent_jobs_range`), so the seed
   * count below is clamped to it rather than assuming a partner can hold an unbounded forward book.
   */
  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: { maxConcurrentJobs: PROVIDER_MAX_CONCURRENT },
  });
  await deleteBookingsForUsers([ctx.customerA.id, ctx.customerB.id]);

  const pool = prismaPoolConfigFromUrl();
  const maxConn = await prisma.$queryRaw<Array<{ max_connections: string }>>`
    SHOW max_connections
  `;
  audit = {
    prismaConnectionLimit: pool.connectionLimit,
    prismaPoolTimeoutSec: pool.poolTimeoutSec,
    rescheduleMaxInflight: Number(process.env.RESCHEDULE_MAX_INFLIGHT),
    postgresMaxConnections: Number(maxConn[0]?.max_connections ?? 0),
  };
});

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);

  const lines = [
    "# Enterprise Scalability Certification",
    "",
    `**Executed:** ${new Date().toISOString()}`,
    `**Run ID:** \`${RUN_ID}\``,
    "",
    "## Pool audit",
    "",
    ...Object.entries(audit).map(([k, v]) => `- **${k}:** ${v}`),
    "",
    "## Concurrent reschedule results",
    "",
    "| Concurrent | Verdict | Success | P2037 | POOL_BUSY | Corrupt | Duplicates | Overlaps |",
    "|------------|---------|---------|-------|-----------|---------|------------|----------|",
    ...scaleResults.map(
      (r) =>
        `| ${r.n} | **${r.verdict}** | ${r.ok}/${r.total} (${Math.round((r.ok / r.total) * 100)}%) | ${r.p2037} | ${r.poolBusy} | ${r.corrupt} | ${r.duplicates} | ${r.overlaps} |`,
    ),
    "",
    "## Remediation applied",
    "",
    "- `reschedule-gate.ts` — semaphore backpressure (`RESCHEDULE_MAX_INFLIGHT=32`)",
    "- `db-retry.ts` — P2037/P2034 retry (20 attempts, jittered backoff)",
    "- `booking.service.ts` — outer `runRescheduleWithRetry`, deferred notifications",
    "- `prisma-errors.ts` — `PrismaClientUnknownRequestError` write-conflict detection",
    "- Shared Prisma singleton in adversarial fixtures (removed duplicate pool)",
    "",
  ];
  fs.writeFileSync(DOCS, lines.join("\n"));
}, 600_000);

async function seedAcceptedBooking(hoursFromNow: number) {
  const slot = soakSlot(hoursFromNow);
  // Presence is set once in beforeAll; by the 500 case the earlier cases have outlasted
  // PRESENCE_FRESH_SEC and every direct create is refused as a stale partner (PROVIDER_UNAVAILABLE).
  await keepPresenceFresh(ctx);
  const created = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    scheduledDate: slot.toISOString(),
    addressId: ctx.addressAId,
  });
  if (!("booking" in created) || !created.booking) {
    throw new Error(`booking create failed: ${JSON.stringify(created)}`);
  }
  await prisma.booking.update({
    where: { id: created.booking.id },
    data: { status: BookingStatus.ACCEPTED },
  });
  return created.booking.id;
}

async function runConcurrentReschedules(total: number) {
  // Clamped to what one partner may actually hold concurrently — see beforeAll. The concurrency
  // under test is the number of PARALLEL RESCHEDULES (`total`), not the size of the booking set.
  const bookingCount = Math.max(10, Math.min(PROVIDER_MAX_CONCURRENT, Math.floor(total / 10)));
  await deleteBookingsForUsers([ctx.customerA.id]);
  const bookingIds: string[] = [];
  // Seed in 600h+ band; reschedule targets use 100h+ band (both within 29-day cap, no buffer overlap).
  for (let i = 0; i < bookingCount; i++) {
    bookingIds.push(await seedAcceptedBooking(600 + i));
  }

  await keepPresenceFresh(ctx);
  const tasks = Array.from({ length: total }, (_, i) => {
    const bookingId = bookingIds[i % bookingIds.length]!;
    // Unique target slots (≥1h apart) within the 29-day window.
    const slot = soakSlot(100 + i);
    return bookingService
      .update(ctx.customerA.id, bookingId, { scheduledDate: slot.toISOString() })
      .catch((e) => ({ error: String(e) }));
  });

  const outcomes = await Promise.all(tasks);
  const ok = outcomes.filter((o) => o && typeof o === "object" && "ok" in o && o.ok).length;
  const p2037 = outcomes.filter(
    (o) =>
      String(o).includes("P2037") ||
      String(o).toLowerCase().includes("too many clients"),
  ).length;
  const poolBusy = outcomes.filter(
    (o) => o && typeof o === "object" && "error" in o && o.error === "POOL_BUSY",
  ).length;

  const rows = await prisma.booking.findMany({ where: { id: { in: bookingIds } } });
  const corrupt = rows.filter((r) => !r.scheduledDate).length;

  const dupNumbers = await prisma.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint AS c FROM (
      SELECT booking_number FROM bookings WHERE user_id = ${ctx.customerA.id}
      GROUP BY booking_number HAVING COUNT(*) > 1
    ) d
  `;
  const duplicates = Number(dupNumbers[0]?.c ?? 0);

  const overlapRows = await prisma.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint AS c FROM (
      SELECT a.id
      FROM bookings a
      JOIN bookings b ON a.user_id = b.user_id AND a.id < b.id
      WHERE a.user_id = ${ctx.customerA.id}
        AND a.status IN ('PENDING','ACCEPTED','ASSIGNED','EN_ROUTE','IN_PROGRESS')
        AND b.status IN ('PENDING','ACCEPTED','ASSIGNED','EN_ROUTE','IN_PROGRESS')
        AND ABS(EXTRACT(EPOCH FROM (a.scheduled_date - b.scheduled_date))) < 1800
    ) o
  `;
  const overlaps = Number(overlapRows[0]?.c ?? 0);

  return {
    ok,
    total,
    p2037,
    poolBusy,
    corrupt,
    duplicates,
    overlaps,
    bookingCount,
    gate: rescheduleGateStats(),
  };
}

describe.serial("Enterprise scalability — concurrent reschedule", () => {
  for (const n of [100, 250, 500]) {
    test(`${n} concurrent reschedules`, async () => {
      if (!dbOk) return;
      const r = await runConcurrentReschedules(n);
      const rate = r.ok / r.total;
      const pass =
        rate >= 0.95 &&
        r.p2037 === 0 &&
        r.poolBusy === 0 &&
        r.corrupt === 0 &&
        r.duplicates === 0 &&
        r.overlaps === 0;
      scaleResults.push({
        n,
        verdict: pass ? "PASS" : "FAIL",
        ok: r.ok,
        total: r.total,
        p2037: r.p2037,
        poolBusy: r.poolBusy,
        corrupt: r.corrupt,
        duplicates: r.duplicates,
        overlaps: r.overlaps,
      });
      expect(r.corrupt).toBe(0);
      expect(r.duplicates).toBe(0);
      expect(r.overlaps).toBe(0);
      expect(r.p2037).toBe(0);
      expect(r.poolBusy).toBe(0);
      expect(rate).toBeGreaterThanOrEqual(0.95);
    }, 300_000);
  }
});
