/**
 * Seeds a deterministic, trackable, UNPAID booking for customer@homigo.demo so the customer
 * Playwright journey (login → address → booking → assignment → tracking → checkout → completion)
 * runs without depending on the flaky multi-step booking UI or the live assignment race.
 *
 * - Booking CREATION uses the REAL endpoint the UI calls (POST /api/bookings).
 * - Provider ASSIGNMENT + tracking are forced via prisma (status ACCEPTED + providerId + tracking),
 *   bypassing only the non-deterministic dispatch engine.
 *
 * Prints the bookingId on the last stdout line. Run against an isolated database + backend:
 *   SMOKE_BASE=http://localhost:3100 bun --env-file=.env.test run scripts/seed-customer-journey.ts
 *
 * Declared target (scripts/lib/script-target.ts): it forces a booking to ACCEPTED and writes tracking
 * rows directly, so it refuses any non-test database unless `--allow-live` is on the command line. The
 * old usage line (`--env-file=.env`) pointed it at the live homigo_db by default.
 */
import prisma from "../src/lib/prisma";
import { requireDeclaredTarget } from "./lib/script-target";

const TARGET = requireDeclaredTarget({ label: "seed-customer-journey" });
const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";

/**
 * This script talks to TWO things: Prisma (the database named by DATABASE_URL) and an HTTP backend
 * (BASE). Nothing made them agree. Run with NODE_ENV=test to seed homigo_test, it still defaulted to
 * the dev backend on :3000 — so it logged in against the LIVE dev database and posted a booking
 * there with ids read from the test database. On 2026-09-21 that produced a confusing 400 ("Invalid
 * service or address"); had the ids happened to exist, it would have written a booking to homigo_db.
 *
 * Same principle as the DDL target guard: a script that reaches a database must state which one.
 */
async function assertBackendMatchesDatabase(): Promise<void> {
  // Checked whenever the database is a test one (not only under NODE_ENV=test): a test-database seed
  // talking to a live backend is the 2026-09-21 mix-up, whatever NODE_ENV says.
  if (TARGET.live) return;
  // `isolatedDatabase` is a top-level field of /health (src/index.ts), beside `environment`.
  const health = (await fetch(`${BASE}/health`)
    .then((r) => r.json())
    .catch(() => null)) as { isolatedDatabase?: boolean } | null;
  if (!health) throw new Error(`REFUSING: ${BASE}/health did not answer`);
  if (health.isolatedDatabase !== true) {
    throw new Error(
      `REFUSING: this seeds a test database (${TARGET.database}), but ${BASE} is not running against an isolated one. ` +
        "Point SMOKE_BASE at the isolated backend (e.g. http://localhost:3100).",
    );
  }
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "customer@homigo.demo", password: "Homigo@123", setAuthCookies: false }),
  });
  const j = (await res.json()) as any;
  const token = j?.data?.accessToken ?? j?.accessToken;
  if (!token) throw new Error(`login failed: ${JSON.stringify(j).slice(0, 160)}`);
  return token;
}

async function main() {
  const user = await prisma.user.findFirstOrThrow({ where: { email: "customer@homigo.demo" }, select: { id: true, defaultAddressId: true, walletBalance: true } });

  // Reuse the unpaid assigned booking this script already created. A second run must not invent a
  // new booking id, and it must not post a second booking when the journey has not paid the first.
  // After the journey pays, paymentStatus is no longer PENDING and a new booking is created below
  // through POST /api/bookings.
  const existing = await prisma.booking.findFirst({
    where: {
      userId: user.id,
      status: "ACCEPTED",
      paymentStatus: "PENDING",
      providerId: { not: null },
      finalAmount: { gt: 0, lte: user.walletBalance },
      tracking: { isNot: null },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, bookingNumber: true, finalAmount: true, paymentStatus: true, status: true },
  });
  if (existing) {
    console.error(`reusing booking ${existing.bookingNumber} status=${existing.status} pay=${existing.paymentStatus} amount=${existing.finalAmount}`);
    console.log(existing.id);
    process.exit(0);
  }

  await assertBackendMatchesDatabase();
  const token = await login();
  const addressId = user.defaultAddressId ?? (await prisma.address.findFirstOrThrow({ where: { userId: user.id }, select: { id: true } })).id;
  const service = await prisma.service.findFirstOrThrow({ where: { isActive: true, basePrice: { lte: Math.min(user.walletBalance, 1500) } }, select: { id: true, name: true } });
  const provider = await prisma.provider.findFirstOrThrow({ where: { isApproved: true, isActive: true }, select: { id: true } });

  // Within the 30-day booking window; randomized day+minute to avoid OVERLAPPING / slot conflicts.
  const daysAhead = 7 + Math.floor(Math.random() * 18); // 7..24 days
  const scheduledDate = new Date(Date.now() + daysAhead * 86_400_000);
  scheduledDate.setHours(9 + Math.floor(Math.random() * 8), Math.floor(Math.random() * 60), 0, 0);

  const res = await fetch(`${BASE}/api/bookings`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ serviceId: service.id, addressId, scheduledDate: scheduledDate.toISOString() }),
  });
  const j = (await res.json()) as any;
  if (!res.ok || !(j?.data?.booking?.id || j?.data?.id)) throw new Error(`create booking failed (${res.status}): ${JSON.stringify(j).slice(0, 200)}`);
  const bookingId: string = j.data.booking?.id ?? j.data.id;

  // Force a deterministic trackable + unpaid state (assignment + tracking).
  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "ACCEPTED", providerId: provider.id, paymentStatus: "PENDING", eta: 18 },
  });
  await prisma.tracking.upsert({
    where: { bookingId },
    create: { bookingId, status: "ON_THE_WAY", totalDistance: 4.2, lastUpdateAt: new Date() },
    update: { status: "ON_THE_WAY", totalDistance: 4.2, lastUpdateAt: new Date() },
  });

  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { bookingNumber: true, finalAmount: true, paymentStatus: true, status: true } });
  console.error(`seeded booking ${b.bookingNumber} status=${b.status} pay=${b.paymentStatus} amount=${b.finalAmount} service="${service.name}"`);
  console.log(bookingId); // last stdout line = bookingId
  process.exit(0);
}

main().catch((e) => { console.error("SEED FAIL:", e instanceof Error ? e.message : e); process.exit(1); });
