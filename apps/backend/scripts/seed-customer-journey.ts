/**
 * Seeds a deterministic, trackable, UNPAID booking for customer@homigo.demo so the customer
 * Playwright journey (login → address → booking → assignment → tracking → checkout → completion)
 * runs without depending on the flaky multi-step booking UI or the live assignment race.
 *
 * - Booking CREATION uses the REAL endpoint the UI calls (POST /api/bookings).
 * - Provider ASSIGNMENT + tracking are forced via prisma (status ACCEPTED + providerId + tracking),
 *   bypassing only the non-deterministic dispatch engine.
 *
 * Prints the bookingId on the last stdout line. Run:
 *   bun --env-file=.env run scripts/seed-customer-journey.ts
 */
import prisma from "../src/lib/prisma";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";

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
  const token = await login();
  const user = await prisma.user.findFirstOrThrow({ where: { email: "customer@homigo.demo" }, select: { id: true, defaultAddressId: true, walletBalance: true } });
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
