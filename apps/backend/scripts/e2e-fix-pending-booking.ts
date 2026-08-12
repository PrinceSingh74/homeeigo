/**
 * Re-dispatch the latest pending booking after service-match fix, then accept.
 *   bun run scripts/e2e-fix-pending-booking.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { assignmentEngine } from "../src/services/assignment-engine.service";
import { bookingService } from "../src/services/booking.service";
import { providerService } from "../src/services/provider.service";

const line = (s: string) => console.log(s);

async function main() {
  const booking = await prisma.booking.findFirst({
    where: { status: "PENDING", providerId: null },
    orderBy: { createdAt: "desc" },
  });
  if (!booking) throw new Error("No pending booking");

  line(`TARGET booking_id=${booking.id} booking_number=${booking.bookingNumber}`);

  const result = await assignmentEngine.processQueue();
  line(`processQueue: processed=${result.processed} dispatched=${result.dispatched}`);

  const job = await prisma.assignmentJob.findUnique({ where: { bookingId: booking.id } });
  const attempt = job
    ? await prisma.assignmentAttempt.findFirst({
        where: { jobId: job.id },
        orderBy: { dispatchedAt: "desc" },
      })
    : null;
  const b1 = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });

  line(`assignment_job_id     = ${job?.id ?? "NONE"}`);
  line(`assignment_attempt_id = ${attempt?.id ?? "NONE"}`);
  line(`provider_id selected  = ${attempt?.providerId ?? b1.providerId ?? "NONE"}`);
  line(`job.status            = ${job?.status ?? "N/A"}`);
  line(`attempt.status        = ${attempt?.status ?? "N/A"}`);
  line(`booking.provider_id   = ${b1.providerId ?? "NULL"}`);

  if (!attempt?.providerId) {
    line("\n❌ DISPATCH FAILED — cannot proceed to accept");
    await prisma.$disconnect();
    process.exit(1);
  }

  const partnerPending = await providerService.myBookings(attempt.providerId, { status: "pending" });
  const partnerList = partnerPending.bookings;
  const partnerSees = partnerList.some((b) => b.id === booking.id);
  line(`\nPartner pending API: count=${partnerList.length} contains_booking=${partnerSees}`);

  const notifs = await prisma.notification.findMany({
    where: {
      type: "BOOKING_REQUEST",
      referenceId: booking.id,
    },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  line(`BOOKING_REQUEST notification: ${notifs.length > 0 ? `id=${notifs[0].id}` : "NONE"}`);

  const acc = await bookingService.accept(attempt.providerId, booking.id, 30);
  const b2 = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });

  line(`\nACCEPT result: ${"error" in acc ? acc.error : "ok"}`);
  line(`Final status        = ${b2.status}`);
  line(`Final provider_id   = ${b2.providerId}`);
  line(`accepted_at         = ${b2.acceptedAt?.toISOString() ?? "NULL"}`);

  const pass =
    !("error" in acc) &&
    b2.status === "ACCEPTED" &&
    b2.providerId === attempt.providerId &&
    !!b2.acceptedAt &&
    partnerSees;

  line(`\n${pass ? "✅ E2E PASS" : "❌ E2E FAIL"}`);
  await prisma.$disconnect();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
