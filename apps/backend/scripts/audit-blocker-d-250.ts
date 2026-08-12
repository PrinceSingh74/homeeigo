import "../src/load-env";
import {
  prisma,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  futureSlot,
} from "../src/__tests__/helpers/adversarial-fixtures";
import { bookingService } from "../src/services/booking.service";
import { rbacService } from "../src/services/rbac.service";

const RUN_ID = `svc250-${Date.now().toString(36)}`;
await rbacService.bootstrap();
const ctx = await seedAdversarialFixtures(RUN_ID);
const slot = futureSlot(700);

const results = await Promise.all(
  Array.from({ length: 250 }, () =>
    bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      scheduledDate: slot.toISOString(),
      addressId: ctx.addressAId,
    }),
  ),
);

const successCount = results.filter((r) => "booking" in r && r.booking).length;
const providerUnavailableCount = results.filter(
  (r) => "error" in r && r.error === "PROVIDER_UNAVAILABLE",
).length;
const p2034Count = results.filter((r) => JSON.stringify(r).includes("P2034")).length;

console.log(
  JSON.stringify(
    {
      blocker: "D-service-250",
      concurrency: 250,
      successCount,
      providerUnavailableCount,
      p2034Count,
      throwCount: results.filter((r) => r instanceof Error).length,
      errorHistogram: results.reduce(
        (acc, r) => {
          const key = "error" in r ? r.error : "booking";
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    },
    null,
    2,
  ),
);

await cleanupAdversarialFixtures(RUN_ID);
await prisma.$disconnect();
