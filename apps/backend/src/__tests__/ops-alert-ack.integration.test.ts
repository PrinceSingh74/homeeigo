/**
 * Phase 21 — ops alert acknowledgement is server-side, shared, permissioned and expiring.
 *   cd apps/backend && bun test D:/homigo/apps/backend/src/__tests__/ops-alert-ack.integration.test.ts
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { opsAlertAckService } from "../services/ops-alert-ack.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `oaa-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
const KEY = `PROVIDER_OFFLINE:bk${Date.now().toString(36)}:pr1`;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
}, 90_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.$executeRaw`DELETE FROM ops_alert_acknowledgements WHERE alert_key LIKE ${"%" + KEY.split(":")[1] + "%"}`;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

async function call(method: "GET" | "POST", as: AdvCtx["superAdmin"], body?: unknown) {
  const res = await app.handle(
    new Request("http://localhost/api/admin/ops-alerts/acks", {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(as)}` },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  return { status: res.status, json: (await res.json()) as { success: boolean; data?: any; code?: string } };
}

describe.serial("ops alert acknowledgements", () => {
  test("an operations-capable admin acknowledges; every admin with read access sees it", async () => {
    if (!dbOk) return;
    const ack = await call("POST", ctx.superAdmin, { keys: [KEY] });
    expect(ack.status).toBe(200);
    expect(ack.json.data.acknowledged).toBe(1);

    const seenByFinance = await call("GET", ctx.financeAdmin); // ANALYTICS:READ, different admin
    expect(seenByFinance.status).toBe(200);
    const row = seenByFinance.json.data.acks.find((a: { alertKey: string }) => a.alertKey === KEY);
    expect(row?.acknowledgedBy).toBe(ctx.superAdmin.id);
  });

  test("read-only roles cannot acknowledge (fail closed)", async () => {
    if (!dbOk) return;
    expect((await call("POST", ctx.financeAdmin, { keys: [KEY] })).status).toBe(403);
    expect((await call("POST", ctx.supportAdmin, { keys: [KEY] })).status).toBe(403);
    expect((await call("POST", ctx.customerA as AdvCtx["superAdmin"], { keys: [KEY] })).status).toBeGreaterThanOrEqual(401);
  });

  test("malformed keys are refused, never stored", async () => {
    if (!dbOk) return;
    const r = await call("POST", ctx.superAdmin, { keys: ["../../etc", "x".repeat(250), "lower:case:no"] });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("INVALID_ALERT_KEYS");
  });

  test("an acknowledgement expires, so a still-present condition alerts again", async () => {
    if (!dbOk) return;
    const past = new Date(Date.now() - 13 * 3_600_000);
    const key = `ETA_BREACH:${KEY.split(":")[1]}x:pr2`;
    await opsAlertAckService.acknowledge([key], ctx.superAdmin.id, past);
    const active = await opsAlertAckService.active();
    expect(active.some((a) => a.alertKey === key)).toBe(false);
  });
});
