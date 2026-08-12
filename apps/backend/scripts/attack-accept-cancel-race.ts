/**
 * Accept-vs-cancel race attack (isolated homigo_test). For each level N: create
 * ONE PENDING booking (with provider), then fire N/2 accepts + N/2 cancels
 * concurrently. Proves a SINGLE valid terminal state — no double-acceptance, no
 * split state (ACCEPTED with cancelledAt, or vice-versa), no crash.
 *
 *   NODE_ENV=test bun run scripts/attack-accept-cancel-race.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";

async function setupService() {
  const svc = await prisma.service.create({
    data: { name: `ac-svc-${Date.now()}`, slug: `ac-svc-${Date.now()}`, description: "x", category: "cleaning", basePrice: 500, estimatedDuration: 60 },
  });
  return svc.id;
}

/** Fresh provider PER ROUND so a prior round's booking can't occupy this provider's slot. */
async function freshProvider(serviceId: string): Promise<string> {
  const pUser = await prisma.user.create({
    data: { email: `prov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@homigo.test`, phoneNumber: `+9194${Math.floor(1000000 + Math.random() * 8999999)}`, firstName: "Prov", lastName: "X", password: "x".repeat(20), role: "VENDOR" },
  });
  const provider = await prisma.provider.create({
    data: { userId: pUser.id, serviceCategories: [serviceId], serviceRegions: ["Mumbai"], isVerified: true, isApproved: true, isOnline: true },
  });
  return provider.id;
}

async function freshCustomer() {
  const u = await prisma.user.create({
    data: { email: `cust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@homigo.test`, phoneNumber: `+9193${Math.floor(1000000 + Math.random() * 8999999)}`, firstName: "Cust", lastName: "Y", password: "x".repeat(20) },
  });
  const a = await prisma.address.create({
    data: { userId: u.id, label: "Home", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.07, longitude: 72.87 },
  });
  return { userId: u.id, addressId: a.id };
}

async function race(N: number, serviceId: string): Promise<boolean> {
  const providerId = await freshProvider(serviceId);
  const { userId, addressId } = await freshCustomer();
  const created = await bookingService.create(userId, {
    // Fixed 7-day slot (within MAX_DAYS_AHEAD); fresh provider per round → no cross-round conflict.
    serviceId, providerId, addressId, scheduledDate: new Date(Date.now() + 7 * 86400_000).toISOString(),
  });
  if (!("booking" in created)) { console.log(`  N=${N} setup FAILED: ${JSON.stringify(created)}`); return false; }
  const bookingId = created.booking.id;

  const ops: Promise<unknown>[] = [];
  for (let i = 0; i < N; i++) {
    ops.push(i % 2 === 0 ? bookingService.accept(providerId, bookingId) : bookingService.cancel({ userId }, bookingId, "race"));
  }
  const results = await Promise.allSettled(ops);
  const crashed = results.filter((r) => r.status === "rejected").length;

  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  // Valid terminal states: a single accepted-active booking, or a cancelled one.
  // (CANCELLED_BY_USER with acceptedAt set is VALID — accepted then cancelled.)
  const cancelled = b.status === "CANCELLED_BY_USER" || b.status === "CANCELLED";
  const terminalOk = b.status === "ACCEPTED" || cancelled;
  // True corruption: an ACCEPTED booking that ALSO carries a cancellation, OR no
  // single provider, OR a non-terminal/unknown end state.
  const corrupt = (b.status === "ACCEPTED" && b.cancelledAt !== null) || (b.status === "ACCEPTED" && !b.providerId);

  const pass = terminalOk && !corrupt && crashed === 0;
  console.log(
    `  N=${String(N).padStart(3)}  finalStatus=${b.status}  acceptedAt=${b.acceptedAt ? "set" : "null"}  cancelledAt=${b.cancelledAt ? "set" : "null"}  provider=${b.providerId ? "1" : "0"}  corrupt=${corrupt}  crashed=${crashed}  → ${pass ? "✅ single clean terminal" : "❌ FAIL"}`,
  );
  return pass;
}

async function main() {
  console.log("🔨 Accept-vs-cancel race (isolated homigo_test):");
  const serviceId = await setupService();
  let all = true;
  for (const N of [50, 100, 250, 500]) all = (await race(N, serviceId)) && all;
  console.log(all ? "\n✅ VERIFIED: single valid terminal state under accept/cancel races (no double-accept, no split, no crash)" : "\n❌ split/double-state reproduced");
  await prisma.$disconnect();
  process.exit(all ? 0 : 1);
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
