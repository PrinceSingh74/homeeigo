import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const bookingIds = [
    "cmq8andpg03h4tznwvlfcnozz",
    "cmqfibjyc029vtzzclrqgh10a",
    "cmqfibsbi02antzzcqnh1w5i2",
  ];
  const jobs = await prisma.assignmentJob.findMany({
    where: { bookingId: { in: bookingIds } },
    select: { id: true, bookingId: true, status: true, dispatchAttempts: true, maxAttempts: true },
  });
  console.log(JSON.stringify(jobs, null, 2));

  // Breakdown of AssignmentJob.status for ALL jobs behind a PENDING/providerId-null booking.
  const breakdown = await prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
    SELECT aj.status, COUNT(*) as count
    FROM assignment_jobs aj
    JOIN bookings b ON b.id = aj.booking_id
    WHERE b.status = 'PENDING' AND b.provider_id IS NULL
    GROUP BY aj.status
  `;
  console.log("\nAssignmentJob.status breakdown for PENDING/unassigned bookings:");
  console.log(breakdown.map((r) => `${r.status}: ${r.count}`).join(", "));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
