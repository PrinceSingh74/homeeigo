/**
 * Seed data for the Phase 05 admin + partner BROWSER verification. Isolated test database ONLY.
 *
 *   NODE_ENV=development bun --env-file=.env.test run scripts/e2e-seed-phase05-browser.ts
 *
 * Creates (via the existing adversarial fixture helper): customers, a partner, admins, and one
 * service configured with variants, add-ons and an hourly-style quantity rule, then a real booking
 * through the booking service (quote → snapshot) assigned to the partner, plus a second booking
 * inside the D1 reserved window attempt. Prints the ids/emails the browser script needs.
 * The fixture password is the helper's published constant; no real credential is involved.
 */
import { Prisma, BookingStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { seedAdversarialFixtures, futureSlot } from "../src/__tests__/helpers/adversarial-fixtures";
import { bookingService } from "../src/services/booking.service";

const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
if (!/test/i.test(db)) {
  console.error(`refusing: ${db || "(no DATABASE_URL)"} is not an isolated test database`);
  process.exit(2);
}

const run = `browser-p05-${Date.now().toString(36)}`;
const ctx = await seedAdversarialFixtures(run);
await prisma.service.update({
  where: { id: ctx.serviceId },
  data: {
    name: `Browser P05 Sofa ${run}`,
    displayName: "Browser P05 Sofa Cleaning",
    pricingModel: "per-unit",
    basePrice: 250,
    minPrice: 250,
    maxPrice: 250,
    partnerSlotPolicy: "DURATION",
    catalogConfig: {
      materialPolicy: "PROFESSIONAL_PROVIDED",
      equipmentPolicy: "PROFESSIONAL_PROVIDED",
      coverage: { pincodes: [] },
      materials: [{ name: "Shampoo kit", provider: "PROFESSIONAL" }],
      quantity: { type: "SOFA_SEAT", unitLabel: "seat", unitLabelPlural: "seats", min: 1, max: 6, step: 1, durationPerUnitMin: 15 },
      variants: [
        { id: "fabric", name: "Fabric", price: 250, durationMin: 45 },
        { id: "leather", name: "Leather", price: 400, durationMin: 60 },
      ],
      variantRequired: true,
      duration: { preparationMin: 10, cleanupMin: 15 },
      addons: [
        { id: "stain-guard", name: "Stain guard", price: 99, durationMin: 10, compatibleVariantIds: ["fabric"] },
        { id: "deodorise", name: "Deodorise", price: 49, durationMin: 5, maxQuantity: 3 },
      ],
    } as Prisma.InputJsonValue,
  },
});

const when = futureSlot(72);
const created = await bookingService.create(ctx.customerA.id, {
  serviceId: ctx.serviceId,
  addressId: ctx.addressAId,
  scheduledDate: when.toISOString(),
  variantId: "fabric",
  quantity: 3,
  addonIds: ["stain-guard", "deodorise"],
  addonQuantities: { deodorise: 2 },
});
if (!("booking" in created) || !created.booking) {
  console.error("booking create failed", JSON.stringify(created));
  process.exit(1);
}
await prisma.booking.update({ where: { id: created.booking.id }, data: { providerId: ctx.providerId, status: BookingStatus.ACCEPTED } });
const row = await prisma.booking.findUniqueOrThrow({ where: { id: created.booking.id } });
const [slot] = await prisma.$queryRaw<{ s: Date; e: Date }[]>`
  SELECT provider_slot_start AS s, provider_slot_end AS e FROM bookings WHERE id = ${row.id}`;

console.log(
  JSON.stringify(
    {
      run,
      database: db,
      password: "AdvTest@123",
      superAdminEmail: ctx.superAdmin.email,
      supportAdminEmail: ctx.supportAdmin.email,
      partnerEmail: `adv-${run}-vendor@adv.test`,
      customerEmail: ctx.customerA.email,
      serviceId: ctx.serviceId,
      bookingId: row.id,
      bookingNumber: row.bookingNumber,
      scheduledDate: row.scheduledDate,
      estimatedDuration: row.estimatedDuration,
      slotDurationMinutes: row.slotDurationMinutes,
      providerSlot: slot,
      finalAmount: row.finalAmount,
    },
    null,
    2,
  ),
);
await prisma.$disconnect();
process.exit(0);
