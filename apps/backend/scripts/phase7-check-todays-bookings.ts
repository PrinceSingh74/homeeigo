import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const todaysBookings = await prisma.booking.findMany({
    where: { bookingNumber: { startsWith: "HOMIGO-20260824" } },
    select: {
      id: true, bookingNumber: true, status: true, providerId: true, createdAt: true,
      assignmentJob: {
        select: {
          id: true, status: true, dispatchAttempts: true,
          attempts: { select: { providerId: true, status: true, dispatchedAt: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Today's bookings (${todaysBookings.length}):\n`);
  for (const b of todaysBookings) {
    console.log(`${b.bookingNumber} [${b.id}]`);
    console.log(`  status=${b.status} providerId=${b.providerId ?? "null"} created=${b.createdAt.toISOString()}`);
    if (b.assignmentJob) {
      console.log(`  job: status=${b.assignmentJob.status} attempts=${b.assignmentJob.dispatchAttempts}`);
      for (const a of b.assignmentJob.attempts) {
        console.log(`    -> offered to ${a.providerId}: ${a.status} at ${a.dispatchedAt.toISOString()}`);
      }
    } else {
      console.log("  job: NONE (no AssignmentJob row at all)");
    }
    console.log();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
