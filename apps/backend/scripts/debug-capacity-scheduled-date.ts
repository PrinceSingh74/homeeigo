import "../src/load-env";
import prisma from "../src/lib/prisma";
import { partnerOperationsService } from "../src/services/partner-operations.service";

const PROVIDER_ID = "cmq9h687s0005tz8swhtkju1p"; // partner@homigo.demo
const BOOKING_ID = "cmt72e41w008mtzc0vi9w4je1";

async function main() {
  const booking = await prisma.booking.findUnique({ where: { id: BOOKING_ID }, select: { scheduledDate: true } });
  console.log("Booking scheduledDate:", booking!.scheduledDate.toISOString());

  const capMap = await partnerOperationsService.loadCapacityMap([PROVIDER_ID], booking!.scheduledDate);
  console.log("\nCapacity at the booking's actual scheduledDate:");
  console.log(JSON.stringify(Array.from(capMap.entries()), null, 2));

  // Also check assertOfferEligible directly, since that's the OTHER gate (working hours, breaks, radius, regions)
  const provider = await prisma.provider.findUnique({ where: { id: PROVIDER_ID } });
  console.log("\nProvider working hours / schedule fields:");
  console.log(JSON.stringify({
    workingHoursStart: provider?.workingHoursStart,
    workingHoursEnd: provider?.workingHoursEnd,
    breakWindows: provider?.breakWindows,
    timezone: provider?.timezone,
    serviceRadiusKm: provider?.serviceRadiusKm,
    baseLatitude: provider?.baseLatitude,
    baseLongitude: provider?.baseLongitude,
    serviceRegions: provider?.serviceRegions,
  }, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
