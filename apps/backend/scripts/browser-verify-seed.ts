/**
 * Seeds one set of signed-in fixtures for browser verification of the service control plane, the
 * customer booking page and the partner job page, on the ISOLATED TEST DATABASE ONLY.
 *
 *   cd apps/backend
 *   NODE_ENV=test SERVICE_LIVE_EDIT_POLICY=four-eyes bun run scripts/browser-verify-seed.ts <runId> <out.json>
 *
 * Refuses to run unless the connected database name contains "test". Writes the fixture emails
 * (password AdvTest@123) and ids to <out.json>. Remove the rows with the cleanup mode:
 *
 *   NODE_ENV=test bun run scripts/browser-verify-seed.ts <runId> --cleanup
 */
import "../src/load-env";
import { writeFileSync } from "node:fs";
import prisma from "../src/lib/prisma";
import { catalogService } from "../src/services/catalog.service";
import { cleanupAdversarialFixtures, futureSlot, seedAdversarialFixtures } from "../src/__tests__/helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "../src/__tests__/helpers/isolated-test-db";
import { createBookingWithQuote } from "../src/__tests__/helpers/quote-token";

const [runId, out] = process.argv.slice(2);
if (!runId || !out) {
  console.error("usage: browser-verify-seed.ts <runId> <out.json | --cleanup>");
  process.exit(2);
}

const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
refuseIfNotIsolatedTestDb(db);

const tag = `adv-${runId}`;

if (out === "--cleanup") {
  const mine = await prisma.service.findMany({ where: { name: { startsWith: `Browser ${runId} ` } }, select: { id: true } });
  for (const s of mine) {
    await prisma.serviceConfigVersion.deleteMany({ where: { serviceId: s.id } });
    await prisma.service.delete({ where: { id: s.id } }).catch(() => {});
  }
  // Categories the browser run added through the category manager.
  const cats = await prisma.serviceCategory.deleteMany({ where: { name: { startsWith: `Browser ${runId} ` } } });
  await cleanupAdversarialFixtures(runId);
  console.log(`cleaned ${runId} on ${db} (${mine.length} services, ${cats.count} categories)`);
  process.exit(0);
}

const ctx = await seedAdversarialFixtures(runId);

async function service(name: string) {
  const created = await catalogService.create(
    {
      name: `Browser ${runId} ${name}`,
      description: "A fixture service with a real description",
      category: "cleaning",
      basePrice: 300,
      estimatedDuration: 60,
      catalogConfig: { materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED" },
      isActive: false,
    },
    ctx.supportAdmin.id,
  );
  if (!("service" in created) || !created.service) throw new Error(`create ${name}: ${JSON.stringify(created)}`);
  await prisma.service.update({ where: { id: created.service.id }, data: { lifecycleStatus: "READY_FOR_REVIEW", updatedBy: ctx.supportAdmin.id } });
  return created.service.id;
}

// 1. In review, waiting for an approver who is not its editor.
const inReviewId = await service("in review");

// 2. Live with two published versions and (under four-eyes) a pending revision proposed by the support admin.
const liveId = await service("live");
const approved = await catalogService.approve(liveId, ctx.superAdmin.id);
if ("error" in approved && approved.error) throw new Error(`approve: ${JSON.stringify(approved)}`);
const published = await catalogService.transition(liveId, "ACTIVE", ctx.superAdmin.id);
if ("error" in published && published.error) throw new Error(`publish: ${JSON.stringify(published)}`);
const policyBefore = process.env.SERVICE_LIVE_EDIT_POLICY;
process.env.SERVICE_LIVE_EDIT_POLICY = "direct";
const second = await catalogService.update(liveId, { basePrice: 350, minPrice: 350, maxPrice: 350, changeReason: "First price change" }, ctx.superAdmin.id);
if ("error" in second && second.error) throw new Error(`second version: ${JSON.stringify(second)}`);
process.env.SERVICE_LIVE_EDIT_POLICY = "four-eyes";
const proposed = await catalogService.update(liveId, { basePrice: 450, minPrice: 450, maxPrice: 450, changeReason: "Annual price review" }, ctx.supportAdmin.id);
if (!("pendingRevision" in proposed)) throw new Error(`propose: ${JSON.stringify(proposed)}`);
if (policyBefore === undefined) delete process.env.SERVICE_LIVE_EDIT_POLICY;
else process.env.SERVICE_LIVE_EDIT_POLICY = policyBefore;

// 3. A job the fixture partner holds, with a customer note, for the partner job page.
const booked = await createBookingWithQuote(ctx.customerA.id, {
  serviceId: ctx.serviceId,
  addressId: ctx.addressAId,
  quantity: 1,
  scheduledDate: futureSlot(400).toISOString(),
  description: "Gate code 4421, dog at home",
});
if (!("booking" in booked) || !booked.booking) throw new Error(`booking: ${JSON.stringify(booked)}`);
await prisma.booking.update({ where: { id: booked.booking.id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS" } });

// Give the audit writes (fire-and-forget) a moment to land before the process exits.
await new Promise((resolve) => setTimeout(resolve, 1500));

writeFileSync(
  out,
  JSON.stringify(
    {
      runId,
      database: db,
      password: "AdvTest@123",
      customer: { email: `${tag}-a@adv.test`, id: ctx.customerA.id, addressId: ctx.addressAId },
      partner: { email: `${tag}-vendor@adv.test`, userId: ctx.vendorUserId, providerId: ctx.providerId },
      superAdmin: { email: `${tag}-super-admin@adv.test`, id: ctx.superAdmin.id },
      supportAdmin: { email: `${tag}-support-admin@adv.test`, id: ctx.supportAdmin.id },
      bookableServiceId: ctx.serviceId,
      inReviewServiceId: inReviewId,
      liveServiceId: liveId,
      partnerBookingId: booked.booking.id,
    },
    null,
    2,
  ),
);
console.log(`seeded ${runId} on ${db}`);
process.exit(0);
