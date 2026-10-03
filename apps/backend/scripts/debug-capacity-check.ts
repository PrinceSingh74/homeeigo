import "../src/load-env";
import prisma from "../src/lib/prisma";
import { partnerOperationsService } from "../src/services/partner-operations.service";

const PROVIDER_IDS = ["cmq9h687s0005tz8swhtkju1p", "cmsitqxy40002tzbczjyo2ex8"];

async function main() {
  const providers = await prisma.provider.findMany({
    where: { id: { in: PROVIDER_IDS } },
    select: { id: true, maxConcurrentJobs: true, maxJobsPerDay: true, user: { select: { email: true } } },
  });
  console.log("Provider capacity limits:");
  console.log(JSON.stringify(providers, null, 2));

  for (const p of PROVIDER_IDS) {
    console.log(`\n--- ${p} ---`);
    const activeBookings = await prisma.booking.findMany({
      where: { providerId: p, status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] } },
      select: { id: true, bookingNumber: true, status: true },
    });
    console.log("Active bookings (counted toward concurrent capacity):", JSON.stringify(activeBookings, null, 2));

    const sentOffers = await prisma.assignmentAttempt.findMany({
      where: { providerId: p, status: "SENT" },
      select: { id: true, jobId: true, dispatchedAt: true, job: { select: { bookingId: true, booking: { select: { bookingNumber: true, status: true } } } } },
    });
    console.log("Live SENT offers (ALSO counted toward capacity):", JSON.stringify(sentOffers, null, 2));
  }

  console.log("\n--- Real loadCapacityMap() result ---");
  const capMap = await partnerOperationsService.loadCapacityMap(PROVIDER_IDS, new Date());
  console.log(JSON.stringify(Array.from(capMap.entries()), null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
