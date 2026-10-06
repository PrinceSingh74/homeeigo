/**
 * Seeds the fixtures for one browser journey — customer pays, partner arrives, starts with the
 * customer's PIN, works the execution plan, ticks the quality checklist, uploads proof and completes —
 * on the ISOLATED TEST DATABASE ONLY.
 *
 *   cd apps/backend
 *   NODE_ENV=test bun run scripts/browser-journey-seed.ts <runId> <out.json>
 *   NODE_ENV=test bun run scripts/browser-journey-seed.ts <runId> --cleanup
 *
 * The service gets a real execution plan (a plain step, a step that needs a note, a step that needs
 * a photo, an optional step), a quality checklist with proof required, and one requirement the
 * partner must check on arrival. Nothing is booked here: the booking is made in the browser.
 */
import "../src/load-env";
import { writeFileSync } from "node:fs";
import prisma from "../src/lib/prisma";
import { catalogService } from "../src/services/catalog.service";
import { requirementCatalogService } from "../src/services/requirement-catalog.service";
import { cleanupAdversarialFixtures, seedAdversarialFixtures } from "../src/__tests__/helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "../src/__tests__/helpers/isolated-test-db";

const [runId, out] = process.argv.slice(2);
if (!runId || !out) {
  console.error("usage: browser-journey-seed.ts <runId> <out.json | --cleanup>");
  process.exit(2);
}

const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
refuseIfNotIsolatedTestDb(db);

const tag = `adv-${runId}`;
const itemCode = `${runId}-power`;

if (out === "--cleanup") {
  const items = await prisma.serviceRequirementItem.findMany({ where: { code: itemCode }, select: { id: true } });
  await prisma.serviceRequirement.deleteMany({ where: { itemId: { in: items.map((i) => i.id) } } }).catch(() => {});
  await cleanupAdversarialFixtures(runId);
  await prisma.serviceRequirementItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } }).catch(() => {});
  console.log(`cleaned ${runId} on ${db}`);
  process.exit(0);
}

const ctx = await seedAdversarialFixtures(runId);

const item = await requirementCatalogService.create(
  { code: itemCode, kind: "CUSTOMER_PRECONDITION", name: "Power point access", customerLabel: "A working power point near the work area" },
  ctx.superAdmin.id,
);
if (!("item" in item) || !item.item) throw new Error(`requirement item: ${JSON.stringify(item)}`);

const before = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { catalogConfig: true, version: true } });
const policyBefore = process.env.SERVICE_LIVE_EDIT_POLICY;
process.env.SERVICE_LIVE_EDIT_POLICY = "direct";
const saved = await catalogService.update(
  ctx.serviceId,
  {
    catalogConfig: {
      ...((before.catalogConfig as Record<string, unknown> | null) ?? {}),
      materialPolicy: "PROFESSIONAL_PROVIDED",
      equipmentPolicy: "PROFESSIONAL_PROVIDED",
      requirements: [{ id: "power", itemCode, responsibility: "CUSTOMER", enforcement: "REQUIRED_AT_START", verification: "PARTNER_CHECK", sortOrder: 1 }],
      execution: {
        steps: [
          { id: "prep", title: "Protect the floor", kind: "PREPARATION", sortOrder: 1 },
          { id: "inspect", title: "Inspect and note the condition", kind: "WORK", evidence: "NOTE", dependsOn: ["prep"], sortOrder: 2 },
          { id: "work", title: "Do the work", kind: "WORK", evidence: "PHOTO", dependsOn: ["inspect"], sortOrder: 3 },
          { id: "tidy", title: "Tidy up", kind: "CLOSEOUT", mandatory: false, skipPolicy: "SKIP_WITH_REASON", sortOrder: 4 },
        ],
      },
      quality: { checklist: ["Work area left clean", "Customer shown the result"], proofRequired: true },
    },
    expectedVersion: before.version,
    changeReason: "Browser journey fixture",
  },
  ctx.superAdmin.id,
);
if (policyBefore === undefined) delete process.env.SERVICE_LIVE_EDIT_POLICY;
else process.env.SERVICE_LIVE_EDIT_POLICY = policyBefore;
if ("error" in saved && saved.error) throw new Error(`service: ${JSON.stringify(saved)}`);

const address = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
const service = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { name: true, slug: true, basePrice: true } });

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
      service: { id: ctx.serviceId, name: service.name, slug: service.slug, basePrice: Number(service.basePrice) },
      job: { latitude: address.latitude, longitude: address.longitude },
    },
    null,
    2,
  ),
);
console.log(`seeded ${runId} on ${db}`);
process.exit(0);
