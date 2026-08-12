import "../src/load-env";
import { prisma, seedAdversarialFixtures, cleanupAdversarialFixtures, futureSlot } from "../src/__tests__/helpers/adversarial-fixtures";
import { bookingService } from "../src/services/booking.service";
import { rbacService } from "../src/services/rbac.service";

const RUN = `diag-${Date.now().toString(36)}`;
await rbacService.bootstrap();
const ctx = await seedAdversarialFixtures(RUN);
const slot = futureSlot(9999);
try {
  const r = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    scheduledDate: slot.toISOString(),
    addressId: ctx.addressAId,
  });
  console.log(JSON.stringify(r, null, 2));
} catch (e) {
  console.error("THREW", e);
}
await cleanupAdversarialFixtures(RUN);
await prisma.$disconnect();
