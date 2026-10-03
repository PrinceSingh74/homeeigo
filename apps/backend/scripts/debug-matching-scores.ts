import "../src/load-env";
import { matchingService } from "../src/services/matching.service";
import prisma from "../src/lib/prisma";

const BOOKING_ID = "cmt72e41w008mtzc0vi9w4je1";

async function main() {
  const booking = await prisma.booking.findUnique({
    where: { id: BOOKING_ID },
    include: { address: true },
  });
  if (!booking) throw new Error("booking not found");

  console.log("Running the REAL matching engine for this exact booking...\n");
  const matches = await matchingService.findBestProviders({
    serviceId: booking.serviceId,
    customerId: booking.userId,
    latitude: booking.address!.latitude,
    longitude: booking.address!.longitude,
    scheduledDate: booking.scheduledDate,
    maxResults: 15,
  });

  console.log(`Total candidates found: ${matches.length}\n`);

  // Enrich with real email so we can see who's who
  const providerIds = matches.map((m) => m.providerId);
  const providers = await prisma.provider.findMany({
    where: { id: { in: providerIds } },
    select: { id: true, rating: true, totalReviews: true, completionRate: true, user: { select: { email: true } } },
  });
  const byId = new Map(providers.map((p) => [p.id, p]));

  for (const m of matches) {
    const p = byId.get(m.providerId);
    console.log(`${p?.user.email ?? "?"} (${m.providerId})`);
    console.log(`  totalScore=${m.totalScore}  rating=${p?.rating} reviews=${p?.totalReviews} completion=${p?.completionRate}`);
    console.log(`  breakdown:`, JSON.stringify(m));
    console.log();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
