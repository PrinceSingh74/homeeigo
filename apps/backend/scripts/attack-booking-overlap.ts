/**
 * Booking concurrency attack (isolated homigo_test). Fires N concurrent
 * booking.create() for the SAME user + SAME slot + SAME service, and proves the
 * DB allows EXACTLY ONE — no duplicate, no slot overlap, no unhandled crash.
 *
 *   NODE_ENV=test bun run scripts/attack-booking-overlap.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";

async function seed() {
  const svc = await prisma.service.create({
    data: { name: `atk-svc-${Date.now()}`, slug: `atk-svc-${Date.now()}`, description: "x", category: "cleaning", basePrice: 500, estimatedDuration: 60 },
  });
  return svc.id;
}

async function freshUser() {
  const u = await prisma.user.create({
    data: { email: `bk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@homigo.test`, phoneNumber: `+9195${Math.floor(1000000 + Math.random() * 8999999)}`, firstName: "Bk", lastName: "Race", password: "x".repeat(20) },
  });
  const a = await prisma.address.create({
    data: { userId: u.id, label: "Home", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.07, longitude: 72.87 },
  });
  return { userId: u.id, addressId: a.id };
}

async function attack(N: number, serviceId: string): Promise<boolean> {
  const { userId, addressId } = await freshUser();
  const slot = new Date(Date.now() + 5 * 86400_000).toISOString(); // same fixed future slot for all N

  const ops: Promise<unknown>[] = [];
  for (let i = 0; i < N; i++) {
    ops.push(bookingService.create(userId, { serviceId, scheduledDate: slot, addressId }));
  }
  const results = await Promise.allSettled(ops);

  let success = 0;
  let rejected = 0;
  let crashed = 0;
  for (const r of results) {
    if (r.status === "rejected") crashed++;
    else if (r.value && typeof r.value === "object" && "error" in (r.value as object)) rejected++;
    else success++;
  }

  // Ground truth: how many bookings actually landed for this user at this slot?
  const dbCount = await prisma.booking.count({ where: { userId, scheduledDate: new Date(slot) } });

  const pass = success === 1 && dbCount === 1 && crashed === 0;
  console.log(
    `  N=${String(N).padStart(3)}  success=${success} (want 1)  rejected=${rejected}  crashed/throw=${crashed} (want 0)  DB rows=${dbCount} (want 1)  → ${pass ? "✅ no duplicate/overlap" : "❌ FAIL"}`,
  );
  return pass;
}

async function main() {
  console.log("🔨 Booking overlap attack — same user, same slot (isolated homigo_test):");
  const serviceId = await seed();
  let all = true;
  for (const N of [50, 100, 250, 500]) all = (await attack(N, serviceId)) && all;
  console.log(all ? "\n✅ VERIFIED: exactly one booking per slot under concurrency (0 duplicate, 0 overlap, 0 crash)" : "\n❌ duplicate/overlap/crash reproduced");
  await prisma.$disconnect();
  process.exit(all ? 0 : 1);
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
