import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const bookings = await prisma.booking.findMany({
    where: { createdAt: { gte: startOfToday } },
    select: {
      id: true, bookingNumber: true, status: true, userId: true,
      assignmentJob: {
        select: {
          status: true, dispatchAttempts: true,
          attempts: { select: { providerId: true, status: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const b of bookings) {
    const j = b.assignmentJob;
    const sentTo = j?.attempts.filter((a) => a.status === "SENT").length ?? 0;
    console.log(
      `${b.bookingNumber}: booking=${b.status} | job=${j?.status ?? "NONE"} attempts=${j?.dispatchAttempts ?? "-"} | offered-to=${j?.attempts.length ?? 0} providers (${sentTo} currently SENT/live)`,
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
