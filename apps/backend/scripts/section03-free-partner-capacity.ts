import "dotenv/config";
import { requireDeclaredTarget } from "./lib/script-target";
import { BookingStatus, PrismaClient } from "@prisma/client";
requireDeclaredTarget({ label: "section03-free-partner-capacity" });

const p = new PrismaClient();

async function main() {
  const provider = await p.provider.findFirst({
    where: { user: { email: "partner@homigo.demo" } },
  });
  if (!provider) throw new Error("no provider");

  await p.provider.update({
    where: { id: provider.id },
    data: { maxConcurrentJobs: 10, isOnline: true, pausedAt: null },
  });

  const active = await p.booking.findMany({
    where: {
      OR: [
        {
          providerId: provider.id,
          status: { in: ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] },
        },
        {
          // Stale live-cert / debug offers clog the partner inbox and steal UI taps.
          bookingNumber: { startsWith: "S03L-" },
          status: { in: ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] },
        },
        {
          bookingNumber: { startsWith: "DBG-" },
          status: { in: ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] },
        },
      ],
    },
    select: { id: true, status: true, bookingNumber: true },
  });

  for (const b of active) {
    await p.booking.update({
      where: { id: b.id },
      data: {
        status: BookingStatus.CANCELLED_BY_PROVIDER,
        cancelledAt: new Date(),
        cancellationReason: "s03 capacity free for live cert",
        providerId: provider.id,
      },
    });
    console.log("cancelled", b.bookingNumber, b.status);
  }
  console.log(
    JSON.stringify(
      {
        providerId: provider.id,
        remaining: await p.booking.count({
          where: {
            providerId: provider.id,
            status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] },
          },
        }),
      },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
