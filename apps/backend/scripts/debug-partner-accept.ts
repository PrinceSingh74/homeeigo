import "../src/load-env";
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";

async function main() {
  const pending = await prisma.booking.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      provider: { include: { user: { select: { firstName: true, lastName: true } } } },
      service: { select: { name: true } },
    },
  });

  console.log("=== PENDING bookings ===");
  for (const b of pending) {
    console.log({
      id: b.id,
      number: b.bookingNumber,
      providerId: b.providerId,
      provider: b.provider
        ? `${b.provider.user.firstName} ${b.provider.user.lastName}`
        : null,
      service: b.service.name,
    });

    if (b.providerId) {
      const result = await bookingService.accept(b.providerId, b.id, 30);
      console.log("  accept attempt:", result);
    } else {
      console.log("  accept attempt: SKIP (no provider_id)");
    }
  }

  await prisma.$disconnect();
}
main();
