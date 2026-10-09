/**
 * Phase 15.2 — fixtures and read-back for the customer funnel browser E2E
 * (apps/web/e2e/analytics-funnel.spec.ts). ISOLATED TEST DATABASE ONLY.
 *
 *   cd apps/backend
 *   bun --env-file=.env.test run scripts/e2e-analytics-funnel.ts seed <runId>
 *   bun --env-file=.env.test run scripts/e2e-analytics-funnel.ts rows <runId> <customerUserId>
 *   bun --env-file=.env.test run scripts/e2e-analytics-funnel.ts cleanup <runId>
 *
 * `seed` creates the standard adversarial fixture set (customer with a default Noida address, an
 * active partner, admins) and binds the fixture service to the customer catalogue's Salon at Home
 * page (`/services/beauty/salon-at-home`) with two variants, one add-on and two audiences — the
 * real detail page then shows an audience choice, an option choice and an add-on, which is what the
 * funnel's client events are about. The write goes through catalogService.update, the same validated,
 * versioned write an admin makes, so the relational variant / add-on rows the booking path checks
 * exist too. Nothing is booked here; the browser does that.
 *
 * `rows` prints the analytics rows attributed to the fixture customer (actor) or the fixture
 * service, as JSON on the last line. `cleanup` removes the analytics rows, then the fixtures.
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { catalogService } from "../src/services/catalog.service";
import { cleanupAdversarialFixtures, seedAdversarialFixtures } from "../src/__tests__/helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "../src/__tests__/helpers/isolated-test-db";

const [mode, runId, customerUserId] = process.argv.slice(2);
if (!mode || !runId || !["seed", "rows", "cleanup"].includes(mode)) {
  console.error("usage: e2e-analytics-funnel.ts <seed|rows|cleanup> <runId> [customerUserId]");
  process.exit(2);
}

const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
refuseIfNotIsolatedTestDb(db);

const tag = `adv-${runId}`;
/** The customer catalogue binds this page to the backend slug `salon-at-home` (lib/catalog/taxonomy.ts). */
const BOUND_SLUG = "salon-at-home";
const fixtureSlug = `adv-service-${tag}`;

if (mode === "cleanup") {
  const service = await prisma.service.findFirst({ where: { OR: [{ slug: BOUND_SLUG, name: { contains: tag } }, { slug: fixtureSlug }] }, select: { id: true } });
  const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
  const removed = await prisma.analyticsEvent.deleteMany({
    where: {
      OR: [
        ...(service ? [{ serviceId: service.id }] : []),
        ...(users.length ? [{ actorUserId: { in: users.map((u) => u.id) } }] : []),
        ...(customerUserId ? [{ actorUserId: customerUserId }] : []),
      ],
    },
  });
  if (service) {
    await prisma.serviceAddon.deleteMany({ where: { serviceId: service.id } });
    await prisma.serviceVariant.deleteMany({ where: { serviceId: service.id } });
    // Hand the slug back so the shared cleanup (which finds services by tag) owns the delete.
    await prisma.service.update({ where: { id: service.id }, data: { slug: fixtureSlug } });
  }
  for (const u of users) {
    await prisma.$executeRaw`DELETE FROM booking_idempotency_keys WHERE user_id = ${u.id}`.catch(() => undefined);
  }
  await cleanupAdversarialFixtures(runId);
  const left = await prisma.service.count({ where: { slug: BOUND_SLUG } });
  console.log(JSON.stringify({ cleaned: runId, database: db, analyticsRowsRemoved: removed.count, boundSlugLeft: left }));
  process.exit(0);
}

if (mode === "rows") {
  const service = await prisma.service.findFirst({ where: { slug: BOUND_SLUG, name: { contains: tag } }, select: { id: true } });
  const rows = await prisma.analyticsEvent.findMany({
    where: { OR: [{ actorUserId: customerUserId ?? "" }, { serviceId: service?.id ?? "" }] },
    orderBy: [{ receivedAt: "asc" }, { eventName: "asc" }],
  });
  const bookings = await prisma.booking.findMany({
    where: { userId: customerUserId ?? "" },
    select: { id: true, status: true, paymentStatus: true, serviceConfigVersion: true, finalAmount: true },
  });
  const outbox = await prisma.eventOutbox.findMany({
    where: { aggregateId: { in: bookings.map((b) => b.id) } },
    select: { eventId: true, eventType: true, status: true, aggregateId: true },
  });
  console.log(JSON.stringify({ database: db, rows, bookings, outbox }));
  process.exit(0);
}

// seed
const existing = await prisma.service.findFirst({ where: { slug: BOUND_SLUG }, select: { id: true, name: true } });
if (existing) {
  console.error(`a service already holds slug ${BOUND_SLUG} on ${db} (${existing.name}) — clean it up first`);
  process.exit(1);
}
const ctx = await seedAdversarialFixtures(runId);

const before = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { catalogConfig: true, version: true } });
const policyBefore = process.env.SERVICE_LIVE_EDIT_POLICY;
process.env.SERVICE_LIVE_EDIT_POLICY = "direct";
const saved = await catalogService.update(
  ctx.serviceId,
  {
    slug: BOUND_SLUG,
    catalogConfig: {
      ...((before.catalogConfig as Record<string, unknown> | null) ?? {}),
      audiences: ["women", "men"],
      variants: [
        { id: "classic", name: "Classic session", price: 500, sortOrder: 1 },
        { id: "deluxe", name: "Deluxe session", price: 800, sortOrder: 2 },
      ],
      addons: [{ id: "facial", name: "Express facial", price: 150, sortOrder: 1 }],
    },
    expectedVersion: before.version,
    changeReason: "Phase 15.2 funnel browser fixture",
  },
  ctx.superAdmin.id,
);
if (policyBefore === undefined) delete process.env.SERVICE_LIVE_EDIT_POLICY;
else process.env.SERVICE_LIVE_EDIT_POLICY = policyBefore;
if ("error" in saved && saved.error) throw new Error(`service: ${JSON.stringify(saved)}`);

const service = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { id: true, slug: true, version: true, name: true } });
const variants = await prisma.serviceVariant.findMany({ where: { serviceId: service.id }, select: { code: true } });
const addons = await prisma.serviceAddon.findMany({ where: { serviceId: service.id }, select: { code: true } });
const origin = await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { dataOrigin: true } });

console.log(
  JSON.stringify({
    runId,
    database: db,
    password: "AdvTest@123",
    customer: { email: `${tag}-a@adv.test`, id: ctx.customerA.id, addressId: ctx.addressAId, dataOrigin: origin.dataOrigin },
    partner: { userId: ctx.vendorUserId, providerId: ctx.providerId },
    service: { id: service.id, slug: service.slug, version: service.version, name: service.name, path: `/services/beauty/${BOUND_SLUG}` },
    variants: variants.map((v) => v.code),
    addons: addons.map((a) => a.code),
  }),
);
process.exit(0);
