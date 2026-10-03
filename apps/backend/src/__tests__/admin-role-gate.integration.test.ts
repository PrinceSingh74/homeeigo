/**
 * Phase 20 — requireRole("ADMIN") routes outside /api/admin enforce the same boundary as /api/admin:
 * an ADMIN-role user is an admin only while an ACTIVE AdminUser record exists.
 *   cd apps/backend && bun test D:/homigo/apps/backend/src/__tests__/admin-role-gate.integration.test.ts
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { rbacService } from "../services/rbac.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `arg-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
}, 90_000);

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN);
}, 60_000);

const cities = (token: string) =>
  app.handle(new Request("http://localhost/api/digital-twin/cities", { headers: { Authorization: `Bearer ${token}` } }));

describe.serial("ADMIN role gate outside /api/admin", () => {
  test("an active admin passes", async () => {
    if (!dbOk) return;
    expect((await cities(bearer(ctx.superAdmin))).status).toBe(200);
  });

  test("an ADMIN-role user with no AdminUser record is refused (was: allowed)", async () => {
    if (!dbOk) return;
    expect((await cities(bearer(ctx.legacyAdmin))).status).toBe(403);
  });

  test("a deactivated admin is refused even while holding a still-valid access token", async () => {
    if (!dbOk) return;
    const token = bearer(ctx.financeAdmin); // minted before the deactivation
    expect((await cities(token)).status).toBe(200);
    await prisma.adminUser.updateMany({ where: { userId: ctx.financeAdmin.id }, data: { isActive: false } });
    expect((await cities(token)).status).toBe(403);
    await prisma.adminUser.updateMany({ where: { userId: ctx.financeAdmin.id }, data: { isActive: true } });
  });

  test("revokeRole ends the session: the old token no longer authenticates", async () => {
    if (!dbOk) return;
    const superCtx = await rbacService.resolveAdminContext(ctx.superAdmin.id);
    const target = await prisma.adminUser.findFirstOrThrow({ where: { userId: ctx.supportAdmin.id } });
    const token = bearer(ctx.supportAdmin);
    await rbacService.revokeRole(superCtx!, target.id);
    const res = await cities(token);
    expect([401, 403]).toContain(res.status);
  });
});
