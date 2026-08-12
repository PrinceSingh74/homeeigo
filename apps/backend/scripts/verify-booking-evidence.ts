import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const booking = await prisma.booking.findFirst({
    where: { bookingNumber: "HOMIGO-20260611-00003" },
    include: { provider: true },
  });
  console.log("BOOKING:", booking);

  if (booking) {
    const job = await prisma.assignmentJob.findUnique({ where: { bookingId: booking.id } });
    const attempts = job
      ? await prisma.assignmentAttempt.findMany({ where: { jobId: job.id }, orderBy: { dispatchedAt: "asc" } })
      : [];
    const audits = job
      ? await prisma.assignmentAudit.findMany({ where: { jobId: job.id }, orderBy: { createdAt: "asc" } })
      : [];
    console.log("JOB:", job);
    console.log("ATTEMPTS:", attempts);
    console.log("AUDITS (last 5):", audits.slice(-5));
  }

  await prisma.$disconnect();
}
main();
