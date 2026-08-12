/**
 * Phase 4 — Assignment dispatch race attack (isolated homigo_test).
 *   A) Double dispatch via N concurrent processQueue()  → expect ONE SENT attempt.
 *   B) Worst-case via N concurrent dispatchToNextProvider() (bypasses the queue
 *      lock) → characterises whether the Redis/in-memory lock is the sole guard.
 *   C) Concurrent accept by the dispatched provider → exactly one ACCEPTED.
 *
 *   NODE_ENV=test bun run scripts/attack-assignment-dispatch.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";
import { assignmentEngine } from "../src/services/assignment-engine.service";

const LAT = 19.076;
const LNG = 72.8777;

async function makeService() {
  const s = await prisma.service.create({
    data: { name: `as-svc-${Date.now()}`, slug: `as-svc-${Date.now()}`, description: "x", category: "cleaning", basePrice: 500, estimatedDuration: 60 },
  });
  return s;
}

async function makeProvider(serviceId: string, category: string) {
  const u = await prisma.user.create({
    data: { email: `pv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@homigo.test`, phoneNumber: `+9192${Math.floor(1000000 + Math.random() * 8999999)}`, firstName: "Pv", lastName: "Z", password: "x".repeat(20), role: "VENDOR" },
  });
  const p = await prisma.provider.create({
    data: { userId: u.id, serviceCategories: [serviceId, category], serviceRegions: ["Mumbai"], isActive: true, isVerified: true, isApproved: true, isOnline: true, rating: 4.5 },
  });
  await prisma.location.create({ data: { providerId: p.id, latitude: LAT + Math.random() * 0.01, longitude: LNG + Math.random() * 0.01 } });
  return p.id;
}

let slotCounter = 0;
async function makeBookingJob(serviceId: string): Promise<{ bookingId: string; jobId: string }> {
  const u = await prisma.user.create({
    data: { email: `cu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@homigo.test`, phoneNumber: `+9191${Math.floor(1000000 + Math.random() * 8999999)}`, firstName: "Cu", lastName: "B", password: "x".repeat(20) },
  });
  const a = await prisma.address.create({ data: { userId: u.id, label: "Home", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: LAT, longitude: LNG } });
  // Unique slot per round so fresh providers are never blocked by a prior round's
  // tentative assignment (provider_slot exclusion). Keeps the harness deterministic.
  const dayOffset = 3 + (slotCounter++ % 20);
  const created = await bookingService.create(u.id, { serviceId, addressId: a.id, scheduledDate: new Date(Date.now() + dayOffset * 86400_000).toISOString() });
  if (!("booking" in created)) throw new Error("booking setup failed: " + JSON.stringify(created));
  const job = await assignmentEngine.createJob(created.booking.id);
  return { bookingId: created.booking.id, jobId: job.id };
}

async function dispatchAttack(N: number, serviceId: string, category: string, direct: boolean): Promise<boolean> {
  // fresh providers each round so matching always has candidates
  await Promise.all([makeProvider(serviceId, category), makeProvider(serviceId, category), makeProvider(serviceId, category)]);
  const { bookingId, jobId } = await makeBookingJob(serviceId);

  const ops: Promise<unknown>[] = [];
  for (let i = 0; i < N; i++) {
    ops.push(direct ? (assignmentEngine as unknown as { dispatchToNextProvider(j: string): Promise<boolean> }).dispatchToNextProvider(jobId) : assignmentEngine.processQueue());
  }
  const results = await Promise.allSettled(ops);
  const crashed = results.filter((r) => r.status === "rejected").length;

  const sentAttempts = await prisma.assignmentAttempt.count({ where: { jobId, status: "SENT" } });
  const allAttempts = await prisma.assignmentAttempt.count({ where: { jobId } });
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { providerId: true, status: true } });
  const distinctProviders = await prisma.assignmentAttempt.findMany({ where: { jobId, status: "SENT" }, select: { providerId: true }, distinct: ["providerId"] });

  const pass = sentAttempts === 1 && distinctProviders.length === 1 && crashed === 0 && booking.providerId !== null;
  console.log(
    `  [${direct ? "DIRECT (no lock)" : "processQueue (lock)"}] N=${String(N).padStart(3)}  SENT=${sentAttempts} (want 1)  totalAttempts=${allAttempts}  distinctProviders=${distinctProviders.length} (want 1)  booking.provider=${booking.providerId ? "1" : "0"}  crashed=${crashed}  → ${pass ? "✅ single dispatch" : "❌ DUPLICATE DISPATCH"}`,
  );
  return pass;
}

async function acceptAttack(N: number, serviceId: string, category: string): Promise<boolean> {
  await Promise.all([makeProvider(serviceId, category), makeProvider(serviceId, category)]);
  const { bookingId, jobId } = await makeBookingJob(serviceId);
  await assignmentEngine.processQueue(); // dispatch to one provider
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { providerId: true } });
  if (!booking.providerId) { console.log(`  [accept] N=${N} no dispatch — skip`); return false; }

  const ops: Promise<unknown>[] = [];
  for (let i = 0; i < N; i++) ops.push(bookingService.accept(booking.providerId, bookingId));
  const results = await Promise.allSettled(ops);
  const crashed = results.filter((r) => r.status === "rejected").length;
  const okCount = results.filter((r) => r.status === "fulfilled" && (r.value as { ok?: boolean })?.ok === true).length;

  const acceptedAttempts = await prisma.assignmentAttempt.count({ where: { jobId, status: "ACCEPTED" } });
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });

  const pass = b.status === "ACCEPTED" && b.providerId === booking.providerId && acceptedAttempts <= 1 && crashed === 0;
  console.log(
    `  [accept] N=${String(N).padStart(3)}  accept.ok=${okCount}  acceptedAttempts=${acceptedAttempts} (want ≤1)  bookingStatus=${b.status}  singleProvider=${b.providerId === booking.providerId}  crashed=${crashed}  → ${pass ? "✅ one provider wins" : "❌ FAIL"}`,
  );
  return pass;
}

async function main() {
  console.log("🔨 Assignment dispatch race attack (isolated homigo_test):");
  const svc = await makeService();
  let all = true;

  console.log("\nA) Double dispatch via concurrent processQueue (lock-protected):");
  for (const N of [50, 100, 250, 500]) all = (await dispatchAttack(N, svc.id, svc.category, false)) && all;

  console.log("\nB) Worst-case: direct dispatchToNextProvider (NO queue lock):");
  const directResults: boolean[] = [];
  for (const N of [50, 250]) directResults.push(await dispatchAttack(N, svc.id, svc.category, true));

  console.log("\nC) Concurrent accept (multiple attempts, one provider):");
  for (const N of [50, 100, 250, 500]) all = (await acceptAttack(N, svc.id, svc.category)) && all;

  console.log(`\nProcessQueue dispatch + accept: ${all ? "✅ SAFE" : "❌ DEFECT"}`);
  console.log(`Direct (unlocked) dispatch duplicated: ${directResults.includes(false) ? "YES — lock is the sole guard (see report)" : "no"}`);
  await prisma.$disconnect();
  process.exit(all ? 0 : 1);
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
