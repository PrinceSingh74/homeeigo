/**
 * Seeds one customer + partner + service in the ISOLATED test database so the Phase 07/08 schedule
 * rules can be verified in a real browser without touching live data.
 *
 * Run from apps/backend:  bun --env-file=.env.test scripts/seed-schedule-browser-fixtures.ts
 * It refuses to run against anything but a database whose name contains "test".
 */
import prisma from "../src/lib/prisma";
import { seedAdversarialFixtures } from "../src/__tests__/helpers/adversarial-fixtures";

const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
if (!/test/i.test(db)) {
  console.error(`REFUSING: current_database() = ${db}, which is not a test database.`);
  process.exit(2);
}

const run = `sched0708-${Date.now().toString(36)}`;
const ctx = await seedAdversarialFixtures(run);

// A service whose rules the browser run can exercise: 48h lead time, so "today" is always refused.
await prisma.service.update({
  where: { id: ctx.serviceId },
  data: {
    name: `Schedule Rules Demo ${run}`,
    catalogConfig: { availability: { minimumLeadTimeMinutes: 2880 } },
  },
});
await prisma.provider.update({
  where: { id: ctx.providerId },
  data: { workingHoursStart: "09:00", workingHoursEnd: "18:00", timezone: "Asia/Kolkata" },
});

console.log(
  JSON.stringify(
    {
      run,
      database: db,
      password: "AdvTest@123",
      customerEmail: ctx.customerA.email,
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      addressId: ctx.addressAId,
      rules: { minimumLeadTimeMinutes: 2880, workingHours: "09:00-18:00 IST" },
    },
    null,
    2,
  ),
);
await prisma.$disconnect();
