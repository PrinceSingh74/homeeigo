import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const numbers = [
    "HOMIGO-20260611-00004",
    "HOMIGO-20260611-00003",
    "HOMIGO-20260611-00002",
    "HOMIGO-20260611-00001",
  ];

  for (const n of numbers) {
    const b = await prisma.booking.findFirst({
      where: { bookingNumber: n },
      include: {
        provider: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!b) {
      console.log(n, "NOT FOUND");
      continue;
    }
    const job = await prisma.assignmentJob.findUnique({ where: { bookingId: b.id } });
    const attempts = job
      ? await prisma.assignmentAttempt.findMany({ where: { jobId: job.id }, orderBy: { dispatchedAt: "desc" } })
      : [];
    console.log("\n", n, {
      id: b.id,
      status: b.status,
      providerId: b.providerId,
      providerName: b.provider
        ? `${b.provider.user.firstName} ${b.provider.user.lastName}`
        : null,
      jobStatus: job?.status,
      attempts: attempts.map((a) => ({
        id: a.id.slice(0, 12),
        providerId: a.providerId.slice(0, 12),
        status: a.status,
      })),
    });
  }

  const rahul = await prisma.provider.findFirst({
    where: { user: { firstName: "Rahul", lastName: "Sharma" } },
    select: { id: true },
  });
  if (rahul) {
    const pending = await prisma.booking.findMany({
      where: { providerId: rahul.id, status: "PENDING" },
      select: { id: true, bookingNumber: true, providerId: true, status: true },
    });
    console.log("\nRahul pending bookings:", pending);
  }

  await prisma.$disconnect();
}
main();
