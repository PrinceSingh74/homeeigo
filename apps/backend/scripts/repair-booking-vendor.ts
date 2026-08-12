/**
 * Repair ACCEPTED booking with null provider_id from assignment attempt evidence.
 *   bun run scripts/repair-booking-vendor.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { AssignmentAttemptStatus, AssignmentJobStatus } from "@prisma/client";
import { adminService } from "../src/services/admin.service";

const BOOKING_NUMBER = "HOMIGO-20260611-00003";

async function main() {
  const booking = await prisma.booking.findFirst({ where: { bookingNumber: BOOKING_NUMBER } });
  if (!booking) throw new Error("Booking not found");

  if (booking.status === "ACCEPTED" && !booking.providerId) {
    const attempt = await prisma.assignmentAttempt.findFirst({
      where: { job: { bookingId: booking.id } },
      orderBy: { dispatchedAt: "desc" },
    });
    if (!attempt) throw new Error("No assignment attempt to recover provider from");

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: { providerId: attempt.providerId },
      });
      const job = await tx.assignmentJob.findUnique({ where: { bookingId: booking.id } });
      if (job) {
        await tx.assignmentJob.update({
          where: { id: job.id },
          data: {
            status: AssignmentJobStatus.ACCEPTED,
            acceptedAt: booking.acceptedAt ?? now,
            timeoutAt: null,
            currentProviderId: attempt.providerId,
          },
        });
        await tx.assignmentAttempt.updateMany({
          where: { jobId: job.id, providerId: attempt.providerId },
          data: {
            status: AssignmentAttemptStatus.ACCEPTED,
            respondedAt: booking.acceptedAt ?? now,
          },
        });
      }
    });
    console.log(`Repaired provider_id → ${attempt.providerId}`);
  }

  const row = await prisma.booking.findFirst({
    where: { bookingNumber: BOOKING_NUMBER },
    include: { provider: { include: { user: true } } },
  });
  console.log("\n=== DB after repair ===");
  console.log({
    booking_id: row?.id,
    provider_id: row?.providerId,
    provider_name: row?.provider
      ? `${row.provider.user.firstName} ${row.provider.user.lastName}`
      : null,
    status: row?.status,
  });

  const api = await adminService.listBookings({ page: "1", limit: "50" });
  const hit = api.bookings.find((b) => b.bookingNumber === BOOKING_NUMBER);
  console.log("\n=== Admin API payload (this booking) ===");
  console.log(JSON.stringify(hit, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
