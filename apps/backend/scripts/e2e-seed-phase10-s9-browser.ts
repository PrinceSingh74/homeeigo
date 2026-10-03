/**
 * Seed data for the Phase 10 §9 BROWSER verification (partner reports a prohibited condition,
 * customer sees the safety pause, admin releases the hold). Isolated test database ONLY.
 *
 *   NODE_ENV=development bun --env-file=.env.test run scripts/e2e-seed-phase10-s9-browser.ts
 *
 * Configures the service's safety block THROUGH THE ADMIN API, books it through the real booking
 * service and places it at "partner arrived, paid, PIN verified". The fixture password is the
 * helper's published constant; no real credential is involved.
 */
import prisma from "../src/lib/prisma";
import app from "../src/index";
import { bearer, futureSlot, seedAdversarialFixtures } from "../src/__tests__/helpers/adversarial-fixtures";
import { bookingService } from "../src/services/booking.service";

const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
if (!/test/i.test(db)) {
  console.error(`refusing: ${db || "(no DATABASE_URL)"} is not an isolated test database`);
  process.exit(2);
}
const run = `browser-p10s9-${Date.now().toString(36)}`;
const ctx = await seedAdversarialFixtures(run);
const admin = bearer(ctx.superAdmin);
async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
await prisma.service.update({ where: { id: ctx.serviceId }, data: { name: `Browser P10 S9 ${run}`, displayName: "Browser P10 Safety" } });
const saved = await call("PUT", `/api/admin/services/${ctx.serviceId}`, {
  pricingModel: "per-unit", basePrice: 250, minPrice: 250, maxPrice: 250,
  catalogConfig: {
    materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED", coverage: { pincodes: [] },
    quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, default: 3 },
    variants: [{ id: "fabric", name: "Fabric", price: 250 }], variantRequired: true, addons: [],
    safety: {
      prohibitedConditions: ["Gas smell in the room", "Exposed live wiring"],
      warnings: ["Keep children away from the work area"],
      customerRequirements: ["Open a window before the visit"],
      providerRequirements: ["Insulated gloves"],
      medicalDisclaimer: "This service is not medical treatment.",
      emergencyProtocol: "Leave the room and call 112.",
    },
  },
}, admin);
if (saved.status !== 200) throw new Error(`service: ${saved.status} ${JSON.stringify(saved.json)}`);
const created = await bookingService.create(ctx.customerA.id, { serviceId: ctx.serviceId, addressId: ctx.addressAId, scheduledDate: futureSlot(72).toISOString(), variantId: "fabric", quantity: 2 });
if (!("booking" in created) || !created.booking) {
  console.error("booking create failed", JSON.stringify(created));
  process.exit(1);
}
const id = created.booking.id;
await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date(), enRouteAt: new Date(), arrivedAt: new Date() } });
const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
console.log(JSON.stringify({ run, bookingId: id, bookingNumber: created.booking.bookingNumber, address: { latitude: a.latitude, longitude: a.longitude } }, null, 2));
await prisma.$disconnect();
process.exit(0);
