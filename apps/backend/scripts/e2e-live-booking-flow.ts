/**
 * Full live-DB E2E: create booking → dispatch → partner sees → accept.
 *   bun run scripts/e2e-live-booking-flow.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";
import { assignmentEngine } from "../src/services/assignment-engine.service";
import { providerService } from "../src/services/provider.service";

const line = (s: string) => console.log(s);

async function main() {
  const service = await prisma.service.findFirst({
    where: { category: "cleaning", isActive: true, name: { contains: "Deep Cleaning" } },
  });
  const provider = await prisma.provider.findFirst({
    where: { isOnline: true, isActive: true, isApproved: true, currentLocation: { isNot: null } },
    include: { currentLocation: true },
  });
  const customer = await prisma.user.findFirst({
    where: { role: "CUSTOMER" },
    include: { addresses: { take: 1 } },
  });

  if (!service || !provider || !customer?.addresses[0]) {
    throw new Error("Missing service/provider/customer for live E2E");
  }

  line(`Using service=${service.name} provider=${provider.id} customer=${customer.id}`);

  const created = await bookingService.create(customer.id, {
    serviceId: service.id,
    scheduledDate: new Date(Date.now() + 3 * 86400_000).toISOString(),
    addressId: customer.addresses[0].id,
  });
  if ("error" in created) throw new Error(created.error);

  const bookingId = created.booking.id;
  line(`\n1. BOOKING SAVED: id=${bookingId} number=${created.booking.bookingNumber} status=${created.booking.status}`);

  const job1 = await prisma.assignmentJob.findUnique({ where: { bookingId } });
  line(`2. ASSIGNMENT JOB: id=${job1?.id} status=${job1?.status}`);

  const pq = await assignmentEngine.processQueue();
  line(`3. processQueue: processed=${pq.processed} dispatched=${pq.dispatched}`);

  const job2 = await prisma.assignmentJob.findUnique({ where: { bookingId } });
  const attempt = job2
    ? await prisma.assignmentAttempt.findFirst({ where: { jobId: job2.id }, orderBy: { dispatchedAt: "desc" } })
    : null;
  const b1 = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });

  line(`4. DISPATCH: attempt_id=${attempt?.id ?? "NONE"} provider=${attempt?.providerId ?? "NONE"}`);
  line(`   booking.provider_id=${b1.providerId ?? "NULL"} job.status=${job2?.status}`);

  const partnerPending = attempt
    ? await providerService.myBookings(attempt.providerId, { status: "pending" })
    : null;
  const partnerSees = partnerPending?.bookings.some((b) => b.id === bookingId) ?? false;
  line(`5. PARTNER REQUESTS API: pending_count=${partnerPending?.bookings.length ?? 0} sees_booking=${partnerSees}`);

  const notif = await prisma.notification.findFirst({
    where: { type: "BOOKING_REQUEST", referenceId: bookingId },
    orderBy: { createdAt: "desc" },
  });
  line(`6. WEBSOCKET NOTIF (persisted): ${notif ? `id=${notif.id} user=${notif.userId}` : "NONE"}`);

  if (!attempt) {
    line("\n❌ FAIL at dispatch");
    await prisma.$disconnect();
    process.exit(1);
  }

  const acc = await bookingService.accept(attempt.providerId, bookingId, 30);
  const b2 = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  line(`\n7. ACCEPT: ${"error" in acc ? acc.error : "ok"}`);
  line(`   status=${b2.status} provider_id=${b2.providerId} accepted_at=${b2.acceptedAt?.toISOString()}`);

  const pass =
    !("error" in acc) && b2.status === "ACCEPTED" && b2.providerId === attempt.providerId && partnerSees;
  line(`\n${pass ? "✅ FULL E2E PASS" : "❌ FAIL"}`);
  await prisma.$disconnect();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
