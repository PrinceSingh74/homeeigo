import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  // A real customer with a repeat completed booking (for a substantive rebooking observation).
  const repeatCustomers = await prisma.booking.groupBy({
    by: ["userId"],
    where: { status: "COMPLETED" },
    _count: { userId: true },
    having: { userId: { _count: { gt: 1 } } },
    orderBy: { _count: { userId: "desc" } },
    take: 5,
  });
  console.log("Real customers with >1 completed booking:", JSON.stringify(repeatCustomers, null, 2));

  // A real completed booking that also has a real rating (for a substantive satisfaction observation).
  const ratedBooking = await prisma.rating.findFirst({
    select: { bookingId: true, userId: true, stars: true, booking: { select: { status: true, serviceId: true } } },
    orderBy: { createdAt: "desc" },
  });
  console.log("\nMost recent real rated booking:", JSON.stringify(ratedBooking, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
