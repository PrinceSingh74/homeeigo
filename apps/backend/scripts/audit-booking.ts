import "../src/load-env";
import prisma from "../src/lib/prisma";

const BOOKING_NUMBER = "HOMIGO-20260611-00003";

async function main() {
  const booking = await prisma.booking.findFirst({
    where: { bookingNumber: BOOKING_NUMBER },
    include: {
      provider: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
      user: { select: { firstName: true, lastName: true, email: true } },
      service: { select: { name: true } },
    },
  });

  console.log("=== 1. bookings table ===");
  console.log(JSON.stringify(booking, null, 2));

  if (!booking) {
    await prisma.$disconnect();
    process.exit(1);
  }

  const job = await prisma.assignmentJob.findUnique({ where: { bookingId: booking.id } });
  console.log("\n=== 2. assignment_job ===");
  console.log(JSON.stringify(job, null, 2));

  const attempts = job
    ? await prisma.assignmentAttempt.findMany({
        where: { jobId: job.id },
        include: { provider: { include: { user: { select: { firstName: true, lastName: true } } } } },
        orderBy: { dispatchedAt: "asc" },
      })
    : [];
  console.log("\n=== 3. assignment_attempts ===");
  console.log(JSON.stringify(attempts, null, 2));

  if (booking.providerId) {
    const provider = await prisma.provider.findUnique({
      where: { id: booking.providerId },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });
    console.log("\n=== 4. provider table ===");
    console.log(JSON.stringify(provider, null, 2));
  }

  await prisma.$disconnect();
}
main();
