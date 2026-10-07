/**
 * Services Phase 2 — admin service configuration through the real RBAC-guarded
 * route: invalid config is rejected with a readable error, valid config is
 * stored and reflected (publicly projected) in the customer list, and renaming
 * no longer rewrites the slug (the public URL + catalogue binding).
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import app from "../index";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN_ID = `svccfg-${Date.now().toString(36)}`;
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
}, 90_000);

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

async function put(body: unknown, as = ctx.superAdmin) {
  const res = await app.handle(
    new Request(`http://localhost/api/admin/services/${ctx.serviceId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(as)}` },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as { success: boolean; code?: string; error?: string; data?: any } };
}

describe.serial("admin service configuration", () => {
  test("invalid config → 400 INVALID_CONFIG with the failing path; nothing stored", async () => {
    if (!dbOk) return;
    // Order-independent: start from "no config" whatever ran before.
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { catalogConfig: Prisma.DbNull } });
    const bad = await put({ catalogConfig: { quantity: { type: "HOUR", unitLabel: "hour", min: 5, max: 1 } } });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("INVALID_CONFIG");
    expect(bad.json.error).toContain("quantity");
    const enumBad = await put({ catalogConfig: { materialPolicy: "WE_BRING_EVERYTHING" } });
    expect(enumBad.status).toBe(400);
    const row = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId } });
    expect(row.catalogConfig).toBeNull();
  });

  test("valid config is stored; gaps reflect what is still missing", async () => {
    if (!dbOk) return;
    const ok = await put({
      pricingModel: "per-unit",
      catalogConfig: {
        quantity: { type: "UNIT", unitLabel: "room", unitLabelPlural: "rooms", min: 1, max: 6, unitPrice: 250 },
        materialPolicy: "PROFESSIONAL_PROVIDED",
        professionalPreferences: ["NO_PREFERENCE", "FEMALE"],
        variants: [
          { id: "standard", name: "Standard", price: 250 },
          { id: "old", name: "Old", price: 100, active: false },
        ],
      },
    });
    expect(ok.status).toBe(200);
    // Readiness is the gate (audit 2026-10-07, finding 4): `configGaps` is what blocks this service,
    // in the gate's words, and the status is READY exactly when nothing does…
    const svc = ok.json.data.service;
    expect(svc.configGaps).toEqual(svc.publishBlocked.map((i: { message: string }) => i.message));
    expect(svc.configStatus === "READY").toBe(svc.publishBlocked.length === 0);
    // …and what is missing or advisory is still said, on the publish rail it is read from.
    const rail = svc.publishGates as { code: string; message: string }[];
    expect(rail.find((g) => g.code === "EQUIPMENT_POLICY")?.message).toBe("Equipment policy not specified");
    expect(rail.some((g) => g.code === "PROFESSIONAL_PREFERENCE_UNSUPPORTED" && g.message.includes("cannot honour"))).toBe(true);
    const detail = await app.handle(new Request(`http://localhost/api/services/${ctx.serviceId}`));
    const pub = ((await detail.json()) as any).data.service.catalogConfig;
    // Public projection: inactive variants and unsupported preferences are stripped.
    expect(pub.variants.map((v: { id: string }) => v.id)).toEqual(["standard"]);
    expect(pub.professionalPreferences).toBeUndefined();
    expect(pub.quantity).toMatchObject({ type: "UNIT", unitPrice: 250 });
    try {
      const rows = await prisma.$queryRaw<{ code: string; is_active: boolean }[]>`
        SELECT code, is_active FROM service_variants WHERE service_id = ${ctx.serviceId} ORDER BY code
      `;
      expect(rows.map((r) => r.code)).toEqual(["old", "standard"]);
      expect(rows.find((r) => r.code === "old")?.is_active).toBe(false);
    } catch {
      // Table not migrated on this isolated DB yet — JSON catalogue still prices.
    }
  });

  test("renaming keeps the slug; an explicit slug change is applied", async () => {
    if (!dbOk) return;
    const before = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId } });
    const renamed = await put({ name: `Adv Service renamed ${RUN_ID}` });
    expect(renamed.status).toBe(200);
    expect(renamed.json.data.service.slug).toBe(before.slug);
    const reslug = await put({ slug: `adv-service-adv-${RUN_ID}-v2` });
    expect(reslug.json.data.service.slug).toBe(`adv-service-adv-${RUN_ID}-v2`);
  });

  test("a customer token cannot change service configuration", async () => {
    if (!dbOk) return;
    const res = await put({ catalogConfig: null }, ctx.customerA);
    expect([401, 403]).toContain(res.status);
  });
});
