import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const todaysBookings = await prisma.booking.findMany({
    where: { createdAt: { gte: startOfToday } },
    select: {
      id: true, bookingNumber: true, status: true, providerId: true,
      createdAt: true, acceptedAt: true, finalAmount: true,
      service: { select: { name: true } },
      provider: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`=== AAJ (${startOfToday.toISOString().slice(0, 10)}) KI SAARI BOOKINGS ===`);
  console.log(`Total: ${todaysBookings.length}\n`);

  const byStatus: Record<string, number> = {};
  for (const b of todaysBookings) {
    byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
  }
  console.log("Status breakdown:", JSON.stringify(byStatus, null, 2));

  console.log("\n--- Har booking ki detail ---\n");
  for (const b of todaysBookings) {
    console.log(`${b.bookingNumber} [${b.id}]`);
    console.log(`  status=${b.status} service=${b.service.name} amount=₹${b.finalAmount}`);
    console.log(`  created=${b.createdAt.toISOString()}`);
    if (b.acceptedAt) console.log(`  accepted=${b.acceptedAt.toISOString()} by ${b.provider?.user.firstName} ${b.provider?.user.lastName}`);
    console.log();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
