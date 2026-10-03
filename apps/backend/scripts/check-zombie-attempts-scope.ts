import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const zombies = await prisma.assignmentAttempt.findMany({
    where: {
      status: "SENT",
      job: {
        booking: {
          status: { in: ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "REJECTED", "COMPLETED"] },
        },
      },
    },
    select: {
      id: true,
      providerId: true,
      dispatchedAt: true,
      job: { select: { bookingId: true, booking: { select: { bookingNumber: true, status: true } } } },
    },
  });

  console.log(`Total zombie SENT attempts (booking already terminal) system-wide: ${zombies.length}\n`);

  const byProvider = new Map<string, number>();
  for (const z of zombies) {
    byProvider.set(z.providerId, (byProvider.get(z.providerId) ?? 0) + 1);
  }
  console.log("By provider:");
  for (const [pid, count] of byProvider) {
    console.log(`  ${pid}: ${count}`);
  }

  const byBookingStatus = new Map<string, number>();
  for (const z of zombies) {
    const s = z.job.booking.status;
    byBookingStatus.set(s, (byBookingStatus.get(s) ?? 0) + 1);
  }
  console.log("\nBy underlying booking status:");
  for (const [s, count] of byBookingStatus) {
    console.log(`  ${s}: ${count}`);
  }

  console.log("\nOldest 5:");
  const sorted = [...zombies].sort((a, b) => a.dispatchedAt.getTime() - b.dispatchedAt.getTime()).slice(0, 5);
  for (const z of sorted) {
    console.log(`  ${z.dispatchedAt.toISOString()} provider=${z.providerId} booking=${z.job.booking.bookingNumber} (${z.job.booking.status})`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
