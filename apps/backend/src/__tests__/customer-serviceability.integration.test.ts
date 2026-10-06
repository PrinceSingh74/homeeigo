/**
 * GET /api/services/:id/serviceability through the real route: the customer gets one of five
 * statuses and a sentence for THEIR address, and nothing about why.
 *
 * Runs on the isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import app from "../index";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `csrv-${Date.now().toString(36)}`;
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
  ctx = await seedAdversarialFixtures(RUN);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

async function ask(qs: string, token: string | null = bearer(ctx.customerA), serviceId = ctx.serviceId) {
  const res = await app.handle(new Request(`http://localhost/api/services/${serviceId}/serviceability${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }));
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text || "{}") as { code?: string; data?: { status: string; message: string } } };
}
const date = () => futureSlot(24 * 5).toISOString().slice(0, 10);

describe.serial("GET /api/services/:id/serviceability", () => {
  test("a bookable service at the customer's own pinned address is available, with and without a date", async () => {
    expect(dbOk).toBe(true);
    const r = await ask(`?addressId=${ctx.addressAId}`);
    expect(r.status).toBe(200);
    expect(r.json.data).toEqual({ status: "AVAILABLE", message: "Available for your location" });
    const dated = await ask(`?addressId=${ctx.addressAId}&date=${date()}`);
    expect(dated.status).toBe(200);
    expect(["AVAILABLE", "LIMITED"]).toContain(dated.json.data!.status);
    expect(Object.keys(dated.json.data!).sort()).toEqual(["message", "status"]);
  });

  test("it needs a signed-in customer, an address, and that address must be theirs", async () => {
    expect(dbOk).toBe(true);
    expect((await ask(`?addressId=${ctx.addressAId}`, null)).status).toBe(401);
    expect((await ask("")).status).toBe(400);
    const others = await ask(`?addressId=${ctx.addressBId}`);
    expect(others.status).toBe(404);
    expect(others.json.code).toBe("ADDRESS_NOT_FOUND");
    expect((await ask(`?addressId=${ctx.addressAId}`, bearer(ctx.customerA), "no-such-service")).status).toBe(404);
  });

  test("outside the service's PIN codes: not available, and the answer does not say which rule refused", async () => {
    expect(dbOk).toBe(true);
    const before = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { catalogConfig: true } });
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { catalogConfig: { ...((before.catalogConfig as object) ?? {}), coverage: { pincodes: ["999999"] } } } });
    try {
      const r = await ask(`?addressId=${ctx.addressAId}`);
      expect(r.json.data).toEqual({ status: "NOT_AVAILABLE", message: "This service is not currently available in your area" });
      expect(r.text).not.toMatch(/pincode|999999|zone|coverage/i);
    } finally {
      // `undefined` would leave the test coverage in place; a null config is restored as a database NULL.
      await prisma.service.update({ where: { id: ctx.serviceId }, data: { catalogConfig: before.catalogConfig === null ? Prisma.DbNull : before.catalogConfig } });
    }
  });

  test("an address with no map pin needs confirmation", async () => {
    expect(dbOk).toBe(true);
    const before = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
    // The column is not nullable: an address saved without a real pin holds 0,0.
    await prisma.address.update({ where: { id: ctx.addressAId }, data: { latitude: 0, longitude: 0 } });
    try {
      expect((await ask(`?addressId=${ctx.addressAId}`)).json.data).toEqual({ status: "NEEDS_CONFIRMATION", message: "We need to confirm that we can serve this address." });
    } finally {
      await prisma.address.update({ where: { id: ctx.addressAId }, data: before });
    }
  });

  test("a paused service is temporarily unavailable; a draft is not disclosed at all", async () => {
    expect(dbOk).toBe(true);
    const live = { lifecycleStatus: "ACTIVE", isActive: true, isBookable: true, isCustomerVisible: true } as const;
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { lifecycleStatus: "PAUSED", isActive: false, isBookable: false, isCustomerVisible: false } });
    try {
      expect((await ask(`?addressId=${ctx.addressAId}`)).json.data).toEqual({ status: "TEMPORARILY_UNAVAILABLE", message: "This service is temporarily unavailable." });
      await prisma.service.update({ where: { id: ctx.serviceId }, data: { lifecycleStatus: "DRAFT" } });
      expect((await ask(`?addressId=${ctx.addressAId}`)).status).toBe(404);
    } finally {
      await prisma.service.update({ where: { id: ctx.serviceId }, data: live });
    }
  });
});
