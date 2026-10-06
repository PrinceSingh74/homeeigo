/**
 * Services Phase 2 — the booking API prices variant × quantity × add-ons on the
 * server, persists the selection, and rejects tampering. Goes through the real
 * HTTP routes because Elysia's route schema silently strips undeclared fields.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  futureSlot,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { bookingPricingService } from "../services/booking-pricing.service";

const RUN_ID = `svcsel-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN_ID);
  await prisma.service.update({
    where: { id: ctx.serviceId },
    data: {
      pricingModel: "hourly",
      catalogConfig: {
        bookingMode: "HOURLY",
        quantity: { type: "HOUR", unitLabel: "hour", unitLabelPlural: "hours", min: 1, max: 4, step: 1, unitPrice: 200 },
        addons: [
          { id: "fridge", name: "Fridge Cleaning", price: 99 },
          { id: "sofa", name: "Sofa Cleaning", price: 149 },
        ],
      },
    },
  });
}, 90_000);

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

async function post(path: string, body: unknown) {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(ctx.customerA)}` },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as { success: boolean; code?: string; data?: any } };
}

describe.serial("service selection → server price → persisted booking", () => {
  test("price-quote: 3 hours + shared add-on priced server-side", async () => {
    if (!dbOk) return;
    const { status, json } = await post("/api/bookings/price-quote", {
      serviceId: ctx.serviceId,
      quantity: 3,
      addonIds: ["fridge"],
    });
    expect(status).toBe(200);
    expect(json.data.quote.packagePrice).toBe(600);
    expect(json.data.quote.addonTotal).toBe(99);
    expect(json.data.quote.baseAmount).toBe(699);
    expect(json.data.quote.selection).toMatchObject({ quantity: 3, quantityType: "HOUR", unitPrice: 200, durationMinutes: 180 });
  });

  test("price-quote prices at the booking's own address; someone else's address is not found (no IDOR)", async () => {
    if (!dbOk) return;
    const own = await post("/api/bookings/price-quote", { serviceId: ctx.serviceId, quantity: 2, addressId: ctx.addressAId });
    expect(own.status).toBe(200);
    const foreign = await post("/api/bookings/price-quote", { serviceId: ctx.serviceId, quantity: 2, addressId: ctx.addressBId });
    expect(foreign.status).toBe(404);
    expect(foreign.json.code).toBe("ADDRESS_NOT_FOUND");
  });

  test("tampering is rejected with a specific code", async () => {
    if (!dbOk) return;
    const cases: [Record<string, unknown>, string][] = [
      [{ quantity: 9 }, "INVALID_QUANTITY"],
      [{ quantity: 0 }, "VALIDATION_ERROR"],
      [{ quantity: -1 }, "VALIDATION_ERROR"],
      // Non-integers are stopped by the zod schema before pricing.
      [{ quantity: 2.5 }, "VALIDATION_ERROR"],
      [{ quantity: 2, packagePrice: 1 }, "INVALID_SELECTION"],
      [{ addonIds: ["gold-plated"] }, "INVALID_ADDON"],
      [{ variantId: "does-not-exist" }, "INVALID_VARIANT"],
      [{ audience: "women" }, "INVALID_AUDIENCE"],
      [{ professionalPreference: "FEMALE" }, "INVALID_PREFERENCE"],
    ];
    for (const [extra, code] of cases) {
      const quote = await post("/api/bookings/price-quote", { serviceId: ctx.serviceId, ...extra });
      expect({ extra, status: quote.status, code: quote.json.code }).toEqual({ extra, status: 400, code });
    }
  });

  test("create: selection survives the route and is stored with the server total", async () => {
    if (!dbOk) return;
    const addr = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId } });
    const expected = await bookingPricingService.quote({
      userId: ctx.customerA.id,
      serviceId: ctx.serviceId,
      quantity: 4,
      addonIds: ["fridge", "sofa"],
      // The quote token is bound to the booking's address (selection fingerprint); without it the create answers QUOTE_MISMATCH.
      addressId: ctx.addressAId,
      lat: addr.latitude,
      lng: addr.longitude,
    });
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;

    const { status, json } = await post("/api/bookings", {
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      scheduledDate: futureSlot(72).toISOString(),
      quantity: 4,
      addonIds: ["fridge", "sofa"],
      description: "Hourly help — 4 hours. Tasks: Laundry.",
      // A client-supplied total is not part of the contract and must be ignored.
      finalAmount: 1,
      totalAmount: 1,
      // Duration and price fields are not in the contract either (Elysia strips them): the
      // server derives duration from quantity × service duration and prices from the catalogue.
      estimatedDuration: 1,
      durationMinutes: 1,
      unitPrice: 1,
      basePrice: 1,
      addons: [{ id: "fridge", name: "Fridge Cleaning", price: 0 }],
      quoteToken: expected.breakdown.quoteToken,
    });
    expect(status).toBe(201);
    const id = json.data.booking?.id ?? json.data.id;
    const row = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(row.finalAmount).toBe(expected.breakdown.finalAmount);
    expect(row.estimatedDuration).toBe(240);
    expect(row.serviceSelection).toMatchObject({ quantity: 4, quantityType: "HOUR", unitPrice: 200, unitLabel: "hours" });
    expect(row.addons).toEqual([
      { id: "fridge", name: "Fridge Cleaning", price: 99 },
      { id: "sofa", name: "Sofa Cleaning", price: 149 },
    ]);
    // 4 × 200 + 99 + 149 = 1048 before surge/discount/tax.
    expect(expected.breakdown.packagePrice + expected.breakdown.addonTotal).toBe(1048);
    expect(row.description).toContain("4 hours");
  });

  test("create rejects an out-of-range quantity instead of booking it", async () => {
    if (!dbOk) return;
    const before = await prisma.booking.count({ where: { userId: ctx.customerA.id } });
    const { status, json } = await post("/api/bookings", {
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      scheduledDate: futureSlot(96).toISOString(),
      quantity: 12,
    });
    expect(status).toBe(400);
    expect(json.code).toBe("INVALID_QUANTITY");
    expect(await prisma.booking.count({ where: { userId: ctx.customerA.id } })).toBe(before);
  });
});
