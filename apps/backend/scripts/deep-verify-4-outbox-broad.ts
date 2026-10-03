import "../src/load-env";
import prisma from "../src/lib/prisma";
import { eventPlatformConfig } from "../src/events/core/config";

async function main() {
  console.log("eventPlatformConfig.outboxEnabled:", eventPlatformConfig.outboxEnabled);
  console.log("eventPlatformConfig.partnerEventsEnabled:", eventPlatformConfig.partnerEventsEnabled);

  const recentPartnerDispatched = await prisma.eventOutbox.findMany({
    where: { eventType: "homigo.partner.dispatched" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, aggregateId: true, createdAt: true, publishedAt: true, status: true },
  });
  console.log("\nMost recent homigo.partner.dispatched events (any booking):");
  console.log(JSON.stringify(recentPartnerDispatched, null, 2));

  const anyOutboxRecent = await prisma.eventOutbox.count({
    where: { createdAt: { gte: new Date(Date.now() - 3600_000) } },
  });
  console.log("\nAny outbox rows at all in the last hour (any event type):", anyOutboxRecent);

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
